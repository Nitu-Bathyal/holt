"""Model clients for the engine, built per job.

`holt.model` reads keys from the process environment and records a trajectory
file per call, which is right for the CLI and wrong for a shared server: here
the key is the server's OpenRouter key, passed in per job, and nothing is
written to disk. These implement the same `ModelClient`
protocol (`complete`, `usage`, `replayed`), so the pipeline cannot tell.
"""

from __future__ import annotations

import json
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


@dataclass
class ModelSpec:
    provider: str
    model: str
    api_key: str = field(repr=False)
    base_url: str | None = None

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

    def complete(self, *, label: str, system: str, prompt: str, schema: dict) -> dict:
        # A cap on every call, so a runaway answer can't run up the bill. OpenAI
        # itself takes `max_completion_tokens` (reasoning models refuse
        # `max_tokens`); OpenRouter and Gemini take `max_tokens`.
        cap = ("max_completion_tokens" if self.spec.provider == "openai"
               else "max_tokens")
        response = self._client.chat.completions.create(
            model=self.spec.model,
            **{cap: max_output_tokens(label)},
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
            self.usage.add(self.spec.model, u.prompt_tokens or 0, u.completion_tokens or 0)
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
        response = self._client.messages.create(
            model=self.spec.model,
            max_tokens=max_output_tokens(label),
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )
        u = response.usage
        self.usage.add(self.spec.model, u.input_tokens, u.output_tokens)
        stop = getattr(response, "stop_reason", None)
        if stop == "refusal":
            raise RuntimeError(f"{self.spec.model} declined the {label} request")
        _check_finished(label, self.spec.model, stop)
        text = next(b.text for b in response.content if b.type == "text")
        return json.loads(_strip_fence(text))


def _strip_fence(text: str) -> str:
    """Some OpenRouter models wrap JSON in a Markdown fence despite the schema."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    return text


def build(spec: ModelSpec):
    return Anthropic(spec) if spec.provider == "anthropic" else OpenAICompatible(spec)
