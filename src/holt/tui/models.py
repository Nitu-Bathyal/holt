"""Choosing which model answers, and finding out whether it can.

`holt models` on the command line takes a provider and a model id and trusts you
to know both. An interface can do better: ask the provider what it actually has,
and try a real call before you find out mid-run that the endpoint is down.

Everything here is Textual-free and synchronous, so it can be tested without a
terminal and run on a worker thread by the screen that uses it. Nothing in this
file decides *what a model costs* or *what the defaults are* — `holt.model` owns
both, and this asks it.

Two facts this module exists to keep in front of the user:

* **A non-default configuration breaks replay of the committed recordings.**
  Those were recorded under the pinned ids, and the engine fails loudly rather
  than serving another model's answers. That is correct behaviour and it is not
  a surprise anybody should get later.
* **An unpriced model records cost as zero.** Not "free" — unknown. The
  interface says so wherever a price would otherwise appear.

Only models that can hold a conversation are offered. Every stage of the engine
calls `chat.completions`, so an embedding or reranking model listed here is not
a choice, it is a trap — Ollama in particular serves `nomic-embed-text` from the
same `/v1/models` as everything else, and picking it fails at the first stage
with a message about the model not supporting generate. What is filtered out is
counted and reported rather than silently dropped.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

from holt import model as model_module

#: How long any network call here may take. Short: this is an interactive
#: screen, and a provider that cannot answer in this long is a provider you
#: want to be told about rather than wait for.
TIMEOUT_S = 12.0

#: Hard stop on every outbound call in this module.
#:
#: Listing a provider is cheap, but testing a connection is a real inference
#: request, and against a local endpoint that means loading a model into RAM on
#: the user's machine. That must only ever happen because someone pressed the
#: key for it — never from a test, a script, or a screen doing it eagerly. The
#: tests set this, so the suite physically cannot reach a provider.
NO_NETWORK_ENV = "HOLT_NO_NETWORK"


def network_allowed() -> bool:
    return os.environ.get(NO_NETWORK_ENV, "") in ("", "0", "false", "False")


_BLOCKED = "Network calls are disabled here (HOLT_NO_NETWORK)."

#: Shown when a provider cannot be listed. Curated rather than invented: these
#: are ids the SDKs document, used only as a starting point the user can edit,
#: and always labelled as not having come from the provider.
FALLBACK_MODELS: dict[str, tuple[str, ...]] = {
    "anthropic": ("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"),
    "openai": (model_module.SMALL, model_module.LARGE),
}


# ─── which models are actually models you can talk to ───────────────────────

#: Ollama's own word, in `/api/show`, for a model that can be generated from.
#: An embedding model reports `["embedding"]` and nothing else.
OLLAMA_CHAT_CAPABILITY = "completion"

#: Substrings that mark an id as something other than a chat model, used only
#: where the provider will not say. Deliberately short: these are the families
#: that actually turn up in a `/v1/models` listing next to chat models, and a
#: longer list of guesses would start hiding models that do work. The cost of a
#: miss here is one clear error from the provider; the cost of over-matching is
#: a model you own and cannot select.
NON_CHAT_MARKERS: tuple[str, ...] = (
    "embed",  # nomic-embed-text, mxbai-embed-large, text-embedding-3-small
    "rerank",  # bge-reranker, and the Ollama ports of it
    "whisper",  # speech to text
    "transcribe",  # gpt-4o-transcribe, gpt-4o-mini-transcribe — also speech
    "diarize",  # gpt-4o-transcribe-diarize
    "dall-e",  # images
    "gpt-image",  # images, under a name that otherwise reads as a chat model
    "sora",  # video
    "realtime",  # a websocket session, not a chat completion
    "tts-",  # openai's tts-1, tts-1-hd
    "-tts",
    "moderation",  # omni-moderation-latest, text-moderation-*
)


def looks_like_chat(model_id: str) -> bool:
    """A name-based guess, for providers that do not publish capabilities."""
    lowered = model_id.lower()
    return not any(marker in lowered for marker in NON_CHAT_MARKERS)


# ─── the order they are offered in ──────────────────────────────────────────

#: Sunk to the bottom rather than hidden. These are real chat models and
#: selecting one is allowed; they are simply not what anybody scrolling this
#: list is looking for, and alphabetical order put `babbage-002` above `gpt-5`.
#: Hiding them would be a different and worse decision — the provider offers
#: them, so the list says so.
DEPRIORITISED: tuple[str, ...] = (
    "babbage",
    "davinci",
    "-instruct",
    "-preview",
    "-audio",
    "chatgpt-",
)


def rank(model: Model) -> tuple:
    """Sort key. Lower sorts first.

    "Popular" is not a fact this tool has any way of knowing, so it is not
    guessed at. What it *does* know is which models it can state a cost for and
    which one it is pinned to, and those are exactly the ones worth reaching
    first — a model holt cannot price is one whose runs record as $0, which is
    a worse starting point than any popularity ordering would fix.

    Four tiers, then alphabetical inside each so the order is stable and a
    second look finds a model where the first one left it.
    """
    pinned = model.id in (model_module.SMALL, model_module.LARGE)
    lowered = model.id.lower()
    legacy = any(marker in lowered for marker in DEPRIORITISED)
    if pinned:
        tier = 0
    elif legacy:
        tier = 3
    elif model.priced:
        tier = 1
    else:
        tier = 2
    return (tier, model.id)


def in_offer_order(models: list[Model]) -> list[Model]:
    return sorted(models, key=rank)


def matches(model: Model, needle: str) -> bool:
    """Substring, case-insensitive. A provider with 80 ids needs a filter.

    Deliberately not fuzzy: you are looking for a model whose name you already
    partly know, and a fuzzy match that surfaces `gpt-4o` for "o1" would make
    the list less trustworthy rather than more helpful.
    """
    return needle.strip().lower() in model.id.lower()


@dataclass(slots=True)
class Provider:
    name: str
    key_env: str
    base_url: str

    @property
    def key_set(self) -> bool:
        return bool(os.environ.get(self.key_env))

    @property
    def needs_base_url(self) -> bool:
        """`openai-compatible` and `azure` are only meaningful once you say where."""
        return self.name in model_module.NEEDS_BASE_URL and not self.base_url

    def status(self) -> str:
        """One line about whether this provider could be used right now."""
        if self.needs_base_url:
            return "set a base url first"
        if self.name == "ollama":
            # Local, and usually keyless. Whether it is running is a question
            # only a connection test can answer, so do not imply either way.
            return self.base_url
        if self.key_set:
            return f"{self.key_env} is set"
        return f"{self.key_env} is not set"

    @property
    def usable(self) -> bool:
        if self.needs_base_url:
            return False
        return self.key_set or self.name == "ollama"


def providers(config: model_module.ModelsConfig | None = None) -> list[Provider]:
    """Every provider the engine knows, with the current config filled in."""
    config = config or model_module.load_models_config()
    out = []
    for name, preset in model_module.PROVIDER_PRESETS.items():
        # The configured values win, but only for the provider they belong to.
        key_env = preset.get("api_key_env", "OPENAI_API_KEY")
        base_url = preset.get("base_url", "")
        if config.provider == name:
            key_env = config.resolved_key_env()
            base_url = config.resolved_base_url()
        out.append(Provider(name=name, key_env=key_env, base_url=base_url))
    return out


@dataclass(slots=True)
class Model:
    id: str
    priced: bool = False
    #: True when the provider told us about it, False when it came from
    #: `FALLBACK_MODELS`. The screen labels the difference.
    from_provider: bool = True
    #: USD per million tokens, (input, output). `None` when this build has no
    #: rate for the id — which is not the same as the model being free.
    rates: tuple[float, float] | None = None
    #: False when the rate came from the snapshot a floating alias points at.
    exact: bool = True

    @property
    def pricing(self) -> str:
        """The actual rate, because "priced" answers nobody's question.

        A reader choosing a model is deciding what a run will cost. "priced"
        told them a price exists somewhere and made them go and find it.
        """
        if self.rates is None:
            return "unpriced — cost recorded as 0"
        rate_in, rate_out = self.rates
        figure = f"${rate_in:.2f} in / ${rate_out:.2f} out  per M tokens"
        # `≈` because an alias can be repointed under us. Better a rate marked
        # approximate than a confident number that quietly goes stale.
        return figure if self.exact else f"≈ {figure}"


@dataclass(slots=True)
class Listing:
    models: list[Model] = field(default_factory=list)
    error: str = ""
    #: Set when the list is `FALLBACK_MODELS` rather than the provider's answer.
    guessed: bool = False
    #: How many the provider offered that cannot hold a conversation. Reported,
    #: because a list shorter than `ollama list` needs to say why.
    hidden: int = 0

    @property
    def ok(self) -> bool:
        return not self.error


def list_models(provider: Provider) -> Listing:
    """Ask the provider what it has. Never raises; the error is the result.

    Runs on a worker thread. A provider that is unreachable, unauthorised or
    simply not running produces a sentence, not a traceback.
    """
    if not network_allowed():
        return _fallback(provider, _BLOCKED)
    if provider.needs_base_url:
        return Listing(error="Set a base url for this provider first.")

    key = os.environ.get(provider.key_env, "")
    if not key and provider.name != "ollama":
        return _fallback(provider, f"{provider.key_env} is not set.")

    try:
        if provider.name == "anthropic":
            ids = _list_anthropic(key)
        else:
            ids = _list_openai_wire(provider, key)
        chat = _chat_only(provider, ids)
    except Exception as exc:  # noqa: BLE001 - reported to the user as prose
        return _fallback(provider, explain(exc, provider))

    if not ids:
        return _fallback(provider, "The provider returned no models.")

    hidden = len(ids) - len(chat)
    if not chat:
        # Everything it has is an embedding model or similar. Said plainly:
        # an empty list under a working connection otherwise reads as a bug.
        return Listing(
            error=(
                f"{provider.name} has {len(ids)} model"
                f"{'' if len(ids) == 1 else 's'} and none of them can hold a "
                "conversation. Holt calls chat completions at every stage; "
                "`ollama pull qwen3` gets something it can use."
                if provider.name == "ollama"
                else f"{provider.name} offered {len(ids)} model"
                f"{'' if len(ids) == 1 else 's'} and none of them can hold a "
                "conversation. Holt calls chat completions at every stage."
            ),
            hidden=len(ids),
        )

    return Listing(models=in_offer_order([_model(i) for i in chat]), hidden=hidden)


def _chat_only(provider: Provider, ids: list[str]) -> list[str]:
    """Just the ids that can be chatted with.

    Asked of the provider where the provider will answer, and guessed from the
    name only where it will not. Ollama publishes capabilities per model and is
    also the provider that most needs the filter, since a local install
    routinely holds an embedding model pulled for something else entirely.
    """
    if provider.name == "ollama":
        capabilities = _ollama_capabilities(provider, ids)
        return [
            model_id
            for model_id in ids
            # `None` means Ollama would not say for this one — fall back to the
            # name rather than dropping a model on no evidence.
            if (
                looks_like_chat(model_id)
                if capabilities.get(model_id) is None
                else OLLAMA_CHAT_CAPABILITY in capabilities[model_id]
            )
        ]
    return [model_id for model_id in ids if looks_like_chat(model_id)]


def _ollama_native(base_url: str) -> str:
    """`http://host:11434/v1` → `http://host:11434`.

    Capabilities are not part of the OpenAI-compatible surface, so this one
    question is asked of Ollama's own API at the same host.
    """
    root = (base_url or "http://localhost:11434/v1").rstrip("/")
    return root[: -len("/v1")] if root.endswith("/v1") else root


def _ollama_capabilities(
    provider: Provider, ids: list[str]
) -> dict[str, tuple[str, ...] | None]:
    """What each model can do, according to Ollama. Never raises.

    `/api/show` reads the manifest on disk — it does not load the model into
    memory, which is the only reason this is acceptable to do for every model
    the moment somebody opens the list. The one call in this file that *does*
    load a model is `test_connection`, and that happens because a key was
    pressed for it.

    A model Ollama will not answer for maps to `None`, which is a different
    thing from "has no capabilities" and is treated differently by the caller.
    """
    import httpx

    root = _ollama_native(provider.base_url)
    found: dict[str, tuple[str, ...] | None] = {}
    try:
        with httpx.Client(timeout=TIMEOUT_S) as client:
            for model_id in ids:
                try:
                    response = client.post(
                        f"{root}/api/show", json={"model": model_id}
                    )
                    response.raise_for_status()
                    raw = response.json().get("capabilities") or []
                    # An Ollama old enough not to report capabilities returns
                    # nothing here. That is "would not say", not "can do
                    # nothing", and hiding every model over it would be wrong.
                    found[model_id] = tuple(str(c) for c in raw) or None
                except Exception:  # noqa: BLE001 - one model, not the listing
                    found[model_id] = None
    except Exception:  # noqa: BLE001 - no native API here; names it is
        return {}
    return found


def _model(model_id: str, from_provider: bool = True) -> Model:
    """One row, with whatever `holt.model` knows about what it costs."""
    rates, exact = model_module.resolve_price(model_id)
    return Model(
        id=model_id,
        priced=rates is not None,
        from_provider=from_provider,
        rates=rates,
        exact=exact,
    )


def _fallback(provider: Provider, error: str) -> Listing:
    """What we know without asking, clearly labelled as exactly that."""
    known = FALLBACK_MODELS.get(provider.name, ())
    return Listing(
        models=[_model(i, from_provider=False) for i in known],
        error=error,
        guessed=bool(known),
    )


def _list_openai_wire(provider: Provider, key: str) -> list[str]:
    from openai import OpenAI

    client = OpenAI(
        api_key=key or "not-needed",
        base_url=provider.base_url or None,
        timeout=TIMEOUT_S,
        max_retries=0,
    )
    return sorted({m.id for m in client.models.list()})


def _list_anthropic(key: str) -> list[str]:
    from anthropic import Anthropic

    client = Anthropic(api_key=key, timeout=TIMEOUT_S, max_retries=0)
    return sorted({m.id for m in client.models.list(limit=100)})


@dataclass(slots=True)
class Probe:
    ok: bool
    detail: str
    seconds: float = 0.0


def test_connection(provider: Provider, model_id: str) -> Probe:
    """Make the smallest real call this provider allows, and time it.

    Listing models proves the endpoint is reachable and the key is accepted.
    This proves the *chosen model* answers, which is a different question and
    the one that bites during a run.
    """
    if not network_allowed():
        return Probe(False, _BLOCKED)
    key = os.environ.get(provider.key_env, "")
    if provider.needs_base_url:
        return Probe(False, "Set a base url for this provider first.")
    if not key and provider.name != "ollama":
        return Probe(False, f"{provider.key_env} is not set.")
    if not model_id:
        return Probe(False, "Choose a model first.")

    started = time.monotonic()
    try:
        if provider.name == "anthropic":
            from anthropic import Anthropic

            Anthropic(api_key=key, timeout=TIMEOUT_S, max_retries=0).messages.create(
                model=model_id,
                max_tokens=1,
                messages=[{"role": "user", "content": "ping"}],
            )
        else:
            _ping_openai(provider, key, model_id)
    except Exception as exc:  # noqa: BLE001 - the point is to report it
        return Probe(False, explain(exc, provider), time.monotonic() - started)

    elapsed = time.monotonic() - started
    return Probe(True, f"{model_id} answered in {elapsed:.1f}s", elapsed)


def _ping_openai(provider: Provider, key: str, model_id: str) -> None:
    """One chat completion, under whichever token-cap parameter is accepted.

    The GPT-5 family rejects `max_tokens` outright and wants
    `max_completion_tokens`; OpenAI-compatible servers that predate the rename
    know only `max_tokens`. Neither name reaches every provider this screen can
    be pointed at, so the current one goes first and the older one only after
    the server names that parameter as the thing it refused. Any other failure
    is the answer to the question this probe asked, and is raised as itself.
    """
    from openai import OpenAI

    client = OpenAI(
        api_key=key or "not-needed",
        base_url=provider.base_url or None,
        timeout=TIMEOUT_S,
        max_retries=0,
    )
    # A cap of 16 rather than 1: reasoning models spend the cap on thinking
    # before emitting a visible token, and some refuse a cap smaller than that.
    # Sixteen output tokens is a fraction of a cent on the priciest model here.
    names = ("max_completion_tokens", "max_tokens")
    for index, name in enumerate(names):
        try:
            client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": "ping"}],
                **{name: 16},
            )
            return
        except Exception as exc:  # noqa: BLE001 - retried below, or re-raised
            if index == len(names) - 1 or not _rejected_parameter(exc, name):
                raise


def _rejected_parameter(exc: BaseException, name: str) -> bool:
    """Did the server refuse the request *because of* this parameter?

    Only then is the other spelling worth a second call. A 401, a 404 or a rate
    limit says nothing about parameter names, and retrying one of those would
    spend a second call to arrive at the same failure under a different name.
    """
    lowered = str(exc).lower()
    if name not in lowered:
        return False
    return any(
        phrase in lowered
        for phrase in (
            "unsupported",
            "not supported",
            "unrecognized",
            "unknown",
            "extra inputs",
            "unexpected keyword",
        )
    )


def explain(exc: BaseException, provider: Provider) -> str:
    """An error a person can act on.

    The failures that actually happen when pointing a tool at a model endpoint
    get a sentence saying what to do. Anything else is reported as itself: a
    confident wrong guess is worse than the raw text.
    """
    text = str(exc)
    lowered = text.lower()
    name = type(exc).__name__

    if "connection" in lowered or "connect" in lowered or "refused" in lowered:
        if provider.name == "ollama":
            return (
                f"Nothing is listening on {provider.base_url}. "
                "Start Ollama with `ollama serve`."
            )
        return f"Could not reach {provider.base_url or provider.name}."
    if "timeout" in lowered or "timed out" in lowered:
        return f"{provider.name} did not answer within {TIMEOUT_S:.0f}s."
    if "401" in text or "unauthorized" in lowered or "authentication" in lowered:
        return f"{provider.key_env} was rejected by {provider.name}."
    if "403" in text or "permission" in lowered:
        return f"{provider.key_env} is not permitted to do this."
    if "404" in text or "not_found" in lowered or "does not exist" in lowered:
        return "That model does not exist for this provider or key."
    if "429" in text or "rate" in lowered and "limit" in lowered:
        return f"{provider.name} is rate limiting. Wait a moment."
    return f"{name}: {text[:160]}"


# ─── applying a choice ──────────────────────────────────────────────────────


def apply(provider: Provider, model_id: str) -> model_module.ModelsConfig:
    """Save the choice and opt this process into it.

    Writes the same `models.toml` the command line writes, so choosing here and
    choosing with `holt models` are the same act.
    """
    config = model_module.load_models_config()
    config.provider = provider.name
    config.model = model_id
    config.base_url = provider.base_url if provider.base_url else ""
    config.api_key_env = provider.key_env
    model_module.save_models_config(config)
    model_module.enable_user_models_config(config)
    return config


def reset() -> model_module.ModelsConfig:
    """Back to the pinned defaults the benchmark was measured on."""
    path = model_module.models_config_path()
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass
    default = model_module.ModelsConfig()
    model_module.enable_user_models_config(default)
    return default


def replay_warning(config: model_module.ModelsConfig) -> str:
    """What a non-default configuration costs you. Empty when on the defaults.

    Not phrased as an error, because it is not one — it is the reproducibility
    guarantee doing its job. But it is never hidden either: finding out that
    `--replay` no longer works, during a demo, would be the worse outcome.
    """
    if config.is_default():
        return ""
    return (
        "Not the defaults. The committed recordings were made with the pinned "
        "models, so replaying them under this configuration fails loudly rather "
        "than serving another model's answers. Recordings you make now replay "
        "under this configuration."
    )
