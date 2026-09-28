"""Help text for `holt models`.

`holt models --help` should name one working model id per common provider.
The examples live here so they can be checked against PROVIDER_PRESETS.
"""

from __future__ import annotations

MODELS_HELP_EPILOG = (
    "Examples (one working line per common provider):\n"
    "  holt models --provider gemini --model gemini-2.5-flash\n"
    "  holt models --provider openrouter --model <a model id from openrouter.ai/models>\n"
    "  holt models --provider ollama --model llama3.2\n"
    "  holt models --provider anthropic --model claude-opus-5\n"
    "  holt models --provider openai --model gpt-5-mini"
)

MODELS_HELP_PROVIDERS = ("gemini", "openrouter", "ollama", "anthropic", "openai")
