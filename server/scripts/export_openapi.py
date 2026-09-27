"""Print the API's OpenAPI document (JSON) for generating the web types.

    uv run python server/scripts/export_openapi.py > openapi.json

Builds the app without starting it: no database, no network. The version is
pinned so the generated file changes only when the contract does.
"""

from __future__ import annotations

import json
import sys

from holt_server.main import create_app
from holt_server.settings import Settings


def main() -> None:
    settings = Settings(_env_file=None, DATABASE_URL="sqlite+aiosqlite://", HOLT_ENV="dev")
    app = create_app(settings, run_jobs=False)
    app.version = "v0"
    spec = app.openapi()
    json.dump(spec, sys.stdout, indent=2, sort_keys=True, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
