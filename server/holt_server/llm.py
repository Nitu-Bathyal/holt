"""Model clients for the engine, built per job.

`holt.model` reads keys from the process environment and records a trajectory
file per call, which is right for the CLI and wrong for a shared server: here
the key is the server's OpenRouter key, passed in per job, and nothing is
written to disk. These implement the same `ModelClient`
protocol (`complete`, `usage`, `replayed`), so the pipeline cannot tell.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from holt.model import Usage, _check_finished, max_output_tokens

PROVIDERS = ("openrouter", "openai", "anthropic", "gemini")

BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": None,
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
}

DEFAULT_MODELS = {
    "openrouter": "openai/gpt-5-mini",
    "openai": "gpt-5-mini",
    "anthropic": "claude-haiku-4-5",
    "gemini": "gemini-2.5-flash",
}

TIMEOUT_S = 180.0
RETRIES = 2


def provider_for(base_url: str | None) -> str:
    """Which wire dialect an OpenAI-compatible endpoint speaks, from its URL.

    OpenAI's own API rejects `max_tokens` for its gpt-5 models, and OpenRouter
    reads it; the server used to send OpenRouter's fields to whatever
    OPENROUTER_BASE_URL pointed at.
    """
    host = (base_url or "").lower()
    # Azure OpenAI's v1 endpoint takes OpenAI's own parameters, and the model
    # is the deployment's name (docs/ops/azure-openai.md).
    if "api.openai.com" in host or any(
            h in host for h in (".openai.azure.com", ".services.ai.azure.com",
                                ".cognitiveservices.azure.com")):
        return "openai"
    if "generativelanguage.googleapis.com" in host:
        return "gemini"
    return "openrouter"


# Models that take a reasoning effort. Others reject the parameter.
_REASONING = re.compile(r"^(?:openai/)?(?:gpt-5|o\d)")


@dataclass
class ModelSpec:
    provider: str
    model: str
    api_key: str = field(repr=False)
    base_url: str | None = None
    # "minimal", "low", "medium" or "high"; empty leaves the provider's default.
    reasoning_effort: str = ""

    @property
    def label(self) -> str:
        return self.model


@dataclass
class OpenAICompatible:
    """OpenRouter, OpenAI and Gemini: the OpenAI chat-completions wire format."""

    spec: ModelSpec
    replayed: bool = False
    usage: Usage = field(default_factory=Usage)
    _client: Any = None

    def __post_init__(self) -> None:
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self.spec.api_key,
                base_url=self.spec.base_url or BASE_URLS.get(self.spec.provider),
                timeout=TIMEOUT_S,
                max_retries=RETRIES,
            )

    def options(self, label: str) -> dict[str, Any]:
        """The provider's own names for the output cap and reasoning effort.

        A cap on every call, so a runaway answer can't run up the bill. OpenAI
        itself takes `max_completion_tokens` (reasoning models refuse
        `max_tokens`) and `reasoning_effort`; OpenRouter takes `max_tokens`
        and `reasoning: {effort}`; Gemini takes `max_tokens`.
        """
        spec = self.spec
        if spec.provider == "openai":
            out: dict[str, Any] = {"max_completion_tokens": max_output_tokens(label)}
            if spec.reasoning_effort and _REASONING.match(spec.model):
                out["reasoning_effort"] = spec.reasoning_effort
            return out
        out = {"max_tokens": max_output_tokens(label)}
        if spec.provider == "openrouter" and spec.reasoning_effort:
            out["extra_body"] = {"reasoning": {"effort": spec.reasoning_effort}}
        return out

    def complete(self, *, label: str, system: str, prompt: str, schema: dict) -> dict:
        started = time.monotonic()
        response = self._client.chat.completions.create(
            model=self.spec.model,
            **self.options(label),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": label, "schema": schema, "strict": True},
            },
        )
        u = response.usage
        if u is not None:  # counted even when the answer is cut off: it was paid for
            self.usage.add(self.spec.model, u.prompt_tokens or 0, u.completion_tokens or 0,
                           label=label, ms=_ms(started))
        choice = response.choices[0]
        _check_finished(label, self.spec.model, getattr(choice, "finish_reason", None))
        content = choice.message.content or ""
        return json.loads(_strip_fence(content))


@dataclass
class Anthropic:
    spec: ModelSpec
    replayed: bool = False
    usage: Usage = field(default_factory=Usage)
    _client: Any = None

    def __post_init__(self) -> None:
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(
                api_key=self.spec.api_key, timeout=TIMEOUT_S, max_retries=RETRIES
            )

    def complete(self, *, label: str, system: str, prompt: str, schema: dict) -> dict:
        started = time.monotonic()
        response = self._client.messages.create(
            model=self.spec.model,
            max_tokens=max_output_tokens(label),
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )
        u = response.usage
        self.usage.add(self.spec.model, u.input_tokens, u.output_tokens,
                       label=label, ms=_ms(started))
        stop = getattr(response, "stop_reason", None)
        if stop == "refusal":
            raise RuntimeError(f"{self.spec.model} declined the {label} request")
        _check_finished(label, self.spec.model, stop)
        text = next(b.text for b in response.content if b.type == "text")
        return json.loads(_strip_fence(text))


def _ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def _strip_fence(text: str) -> str:
    """Some OpenRouter models wrap JSON in a Markdown fence despite the schema."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    return text


def build(spec: ModelSpec):
    return Anthropic(spec) if spec.provider == "anthropic" else OpenAICompatible(spec)
