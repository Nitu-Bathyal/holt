"""Fills in the two config templates for up.sh (not a script to run by hand).

    render.py <deploy/monitoring> <output dir>

Reads its values from the environment up.sh sets: TARGET, PROJECT, SITE_URL
for prometheus.yml; SMTP_HOST, SMTP_USER, EMAIL_FROM, EMAIL_TO and the
switches ON_EMAIL, ON_WEBHOOK, ON_WATCHDOG for alertmanager.yml. No secret
passes through here: the SMTP password and the two URLs are files.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def fill(text: str, names: dict[str, str]) -> str:
    for name, value in names.items():
        text = text.replace(f"@{name}@", value)
    left = re.findall(r"@[A-Z_]+@", text)
    if left:
        sys.exit(f"render: nothing to put in {sorted(set(left))}")
    return text


def switched(text: str, env: dict[str, str]) -> str:
    """Keep an "#if X ... #endif" block only when ON_X is set."""
    kept, on = [], True
    for line in text.splitlines():
        if line.startswith("#if "):
            on = bool(env.get("ON_" + line.split()[1]))
        elif line.startswith("#endif"):
            on = True
        elif on:
            kept.append(line)
    return "\n".join(kept) + "\n"


def quoted(value: str) -> str:
    """Safe inside a double-quoted YAML string."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def main(argv: list[str]) -> int:
    here, out = Path(argv[0]), Path(argv[1])
    env = dict(os.environ)

    prometheus = (here / "prometheus/prometheus.yml.tmpl").read_text(encoding="utf-8")
    (out / "prometheus/prometheus.yml").write_text(fill(prometheus, {
        # Project names go into a regex that matches a container's label.
        "TARGET_PROJECT": re.escape(env["TARGET"]),
        "MON_PROJECT": re.escape(env["PROJECT"]),
        "SITE_URL": quoted(env["SITE_URL"]),
    }), encoding="utf-8")

    alertmanager = (here / "alertmanager/alertmanager.yml.tmpl").read_text(encoding="utf-8")
    (out / "alertmanager/alertmanager.yml").write_text(fill(switched(alertmanager, env), {
        name: quoted(env.get(name, ""))
        for name in ("SMTP_HOST", "SMTP_USER", "EMAIL_FROM", "EMAIL_TO")
    }), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
