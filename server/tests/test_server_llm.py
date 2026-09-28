"""The server's model clients: an output cap on every call, and a cut-off
answer is an error, never half a JSON object. Fake SDK clients, no network."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from holt_server import engine, llm
from holt_server.errors import ApiError

from holt.model import OutputLimitReached, max_output_tokens

SCHEMA = {"type": "object"}


class FakeChat:
    def __init__(self, finish_reason: str = "stop", content: str = '{"ok": true}') -> None:
        self.kwargs: dict = {}
        self.finish_reason = finish_reason
        self.content = content
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            choices=[SimpleNamespace(finish_reason=self.finish_reason,
                                     message=SimpleNamespace(content=self.content))],
            usage=SimpleNamespace(prompt_tokens=100, completion_tokens=50))


class FakeMessages:
    def __init__(self, stop_reason: str = "end_turn") -> None:
        self.kwargs: dict = {}
        self.stop_reason = stop_reason
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            content=[SimpleNamespace(type="text", text='{"ok": true}')],
            usage=SimpleNamespace(input_tokens=100, output_tokens=50))


def spec(provider: str) -> llm.ModelSpec:
    return llm.ModelSpec(provider=provider, model="some/model", api_key="sk-test")


def call(client) -> dict:
    return client.complete(label="narrate", system="s", prompt="p", schema=SCHEMA)


@pytest.mark.parametrize(("provider", "param", "other"), [
    ("openrouter", "max_tokens", "max_completion_tokens"),
    ("gemini", "max_tokens", "max_completion_tokens"),
    ("openai", "max_completion_tokens", "max_tokens"),
])
def test_openai_compatible_sends_an_output_cap(provider, param, other):
    fake = FakeChat()
    client = llm.OpenAICompatible(spec(provider), _client=fake)
    assert call(client) == {"ok": True}
    assert fake.kwargs[param] == max_output_tokens("narrate")
    assert other not in fake.kwargs
    assert client.usage.output_tokens == 50


def test_anthropic_sends_the_stage_cap():
    fake = FakeMessages()
    client = llm.Anthropic(spec("anthropic"), _client=fake)
    assert call(client) == {"ok": True}
    assert fake.kwargs["max_tokens"] == max_output_tokens("narrate")


@pytest.mark.parametrize("client", [
    lambda: llm.OpenAICompatible(spec("openrouter"), _client=FakeChat("length", '{"ok": tr')),
    lambda: llm.Anthropic(spec("anthropic"), _client=FakeMessages("max_tokens")),
])
def test_a_cut_off_answer_raises_and_is_an_upstream_error(client):
    c = client()
    with pytest.raises(OutputLimitReached) as err:
        call(c)
    assert c.usage.output_tokens == 50  # paid for, so still counted
    translated = engine.translate(err.value, "o/r")
    assert isinstance(translated, ApiError) and translated.code == "upstream"
    assert "AI model" in translated.message
