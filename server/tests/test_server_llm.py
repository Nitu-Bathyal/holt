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


# --- OpenAI-compatible endpoints ------------------------------------------------


@pytest.mark.parametrize(("url", "provider"), [
    ("https://openrouter.ai/api/v1", "openrouter"),
    ("https://api.openai.com/v1", "openai"),
    ("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini"),
    ("https://holt.openai.azure.com/openai/v1/", "openai"),
    ("https://holt.services.ai.azure.com/openai/v1/", "openai"),
    ("https://holt.cognitiveservices.azure.com/openai/v1/", "openai"),
    (None, "openrouter"),
])
def test_the_provider_is_read_from_the_endpoint(url, provider):
    assert llm.provider_for(url) == provider


def test_openai_gets_its_own_names_for_the_cap_and_the_effort():
    fake = FakeChat()
    client = llm.OpenAICompatible(llm.ModelSpec(
        provider="openai", model="gpt-5-mini", api_key="sk-test",
        reasoning_effort="low"), _client=fake)
    call(client)
    assert fake.kwargs["max_completion_tokens"] == max_output_tokens("narrate")
    assert fake.kwargs["reasoning_effort"] == "low"
    assert "max_tokens" not in fake.kwargs and "extra_body" not in fake.kwargs


def test_a_model_without_reasoning_gets_no_effort():
    fake = FakeChat()
    client = llm.OpenAICompatible(llm.ModelSpec(
        provider="openai", model="gpt-4.1-mini", api_key="sk-test",
        reasoning_effort="low"), _client=fake)
    call(client)
    assert "reasoning_effort" not in fake.kwargs


def test_openrouter_gets_max_tokens_and_its_reasoning_field():
    fake = FakeChat()
    client = llm.OpenAICompatible(llm.ModelSpec(
        provider="openrouter", model="openai/gpt-5-mini", api_key="sk-test",
        reasoning_effort="low"), _client=fake)
    call(client)
    assert fake.kwargs["max_tokens"] == max_output_tokens("narrate")
    assert fake.kwargs["extra_body"] == {"reasoning": {"effort": "low"}}
    assert "reasoning_effort" not in fake.kwargs
    # No effort configured: nothing is sent, the provider's default applies.
    fake = FakeChat()
    call(llm.OpenAICompatible(spec("openrouter"), _client=fake))
    assert "extra_body" not in fake.kwargs


def test_each_call_records_its_stage_and_time():
    client = llm.OpenAICompatible(spec("openrouter"), _client=FakeChat())
    call(client)
    [entry] = client.usage.calls
    assert entry["label"] == "narrate" and entry["output_tokens"] == 50
    assert isinstance(entry["ms"], int) and entry["ms"] >= 0
    assert set(client.usage.stage_ms()) == {"narrate"}


@pytest.mark.parametrize(("env", "provider"), [
    ({}, "openrouter"),
    ({"OPENROUTER_BASE_URL": "https://api.openai.com/v1"}, "openai"),
    ({"OPENROUTER_BASE_URL": "https://proxy.local/v1", "HOLT_MODEL_PROVIDER": "openai"},
     "openai"),
])
def test_the_servers_spec_follows_its_endpoint(tmp_path, env, provider):
    import asyncio

    from conftest import make_settings
    from holt_server.services import Services

    svc = Services(make_settings(tmp_path, OPENROUTER_API_KEY="sk-test",
                                 HOLT_MODEL_REASONING_EFFORT="low", **env))
    made = asyncio.run(svc.model_spec_for(None))
    assert (made.provider, made.reasoning_effort) == (provider, "low")
