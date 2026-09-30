"""What a repository is about: the README's first line and compact numbers."""

from __future__ import annotations

from datetime import UTC, datetime

from holt.about import about_from_meta, about_lines, compact, help_links, readme_line


# --- readme_line ----------------------------------------------------------------


def test_skips_badges_and_headings():
    text = """# Flask

[![PyPI](https://img.shields.io/pypi/v/flask.svg)](https://pypi.org/project/flask/)
[![Docs](https://readthedocs.org/badge)](https://flask.palletsprojects.com/)

Flask is a lightweight [WSGI] web application framework. It is designed to make
getting started quick and easy.
"""
    assert readme_line(text) == "Flask is a lightweight WSGI web application framework."


def test_strips_markdown_inline():
    text = "A **fast**, `typed` and [friendly](https://x.y) _tool_ for ~~old~~ things."
    assert readme_line(text) == "A fast, typed and friendly tool for old things."


def test_html_header_block_is_skipped():
    text = """<p align="center">
  <img src="logo.png" alt="logo" width="200">
</p>
<h1 align="center">Thing</h1>
<!-- a comment
spanning lines -->

Thing turns YAML into diagrams.
"""
    assert readme_line(text) == "Thing turns YAML into diagrams."


def test_inline_html_in_prose_is_removed():
    assert readme_line("<b>Vite</b> is a build tool.<br>More.") == "Vite is a build tool."


def test_first_sentence_only_and_keeps_abbreviations_whole():
    text = "Requests is an HTTP library, e.g. for APIs. It is simple. More here."
    assert readme_line(text) == "Requests is an HTTP library, e.g. for APIs."


def test_paragraph_lines_join():
    text = "The quick tool\nthat reads files\nfast.\n\nSecond paragraph."
    assert readme_line(text) == "The quick tool that reads files fast."


def test_rst_title_and_directives():
    text = """Requests
========

.. image:: https://img.shields.io/pypi/v/requests.svg
    :target: https://pypi.org/project/requests/

**Requests** is a simple, yet elegant, HTTP library.
"""
    assert readme_line(text) == "Requests is a simple, yet elegant, HTTP library."


def test_skips_code_tables_lists_and_quotes():
    text = """```sh
pip install thing
```

| a | b |
|---|---|

- a list item
> a quote

Thing helps you.
"""
    assert readme_line(text) == "Thing helps you."


def test_skips_setext_heading_and_rules():
    text = "Title\n-----\n\n---\n\nBody sentence here."
    assert readme_line(text) == "Body sentence here."


def test_line_with_only_links_is_skipped():
    text = "[Docs](https://a) | [Chat](https://b) | [Blog](https://c)\n\nReal words here."
    assert readme_line(text) == "Real words here."


def test_too_short_to_say_anything_is_skipped():
    assert readme_line("WIP\n\nA tiny parser for TOML files.") == "A tiny parser for TOML files."


def test_long_sentence_is_cut_at_a_word():
    words = " ".join(["word"] * 80)
    line = readme_line(words)
    assert line is not None and len(line) <= 200 and line.endswith("…")
    assert not line.endswith(" …")


def test_nothing_usable():
    assert readme_line("") is None
    assert readme_line(None) is None
    assert readme_line("# Title\n\n[![x](y)](z)\n") is None


def test_emoji_codes_go():
    assert readme_line(":rocket: Blazing fast bundler.") == "Blazing fast bundler."


# --- compact --------------------------------------------------------------------


def test_compact_numbers():
    assert compact(0) == "0"
    assert compact(999) == "999"
    assert compact(1000) == "1k"
    assert compact(1234) == "1.2k"
    assert compact(12_345) == "12k"
    assert compact(91_234) == "91k"
    assert compact(999_999) == "1M"
    assert compact(1_250_000) == "1.3M"
    assert compact(15_000_000) == "15M"


# --- the CLI header ---------------------------------------------------------------


def test_about_lines_from_meta():
    meta = {
        "name_with_owner": "pallets/flask",
        "description": "The Python micro framework for building web applications.",
        "homepage_url": "https://flask.palletsprojects.com",
        "stargazer_count": 69_800,
        "fork_count": 16_300,
        "open_issues": 5,
        "license": "BSD-3-Clause",
        "topics": ["python", "flask", "wsgi"],
        "languages": [{"name": "Python", "share": 0.99}, {"name": "HTML", "share": 0.01}],
        "default_branch": "main",
        "pushed_at": "2026-09-27T10:00:00Z",
        "is_archived": False,
        "is_fork": False,
    }
    about = about_from_meta(meta, datetime(2010, 4, 6, tzinfo=UTC),
                            "Flask is a lightweight WSGI web application framework.")
    lines = about_lines(about, now=datetime(2026, 9, 29, tzinfo=UTC))
    assert lines[0] == "The Python micro framework for building web applications."
    assert lines[1] == "Flask is a lightweight WSGI web application framework."
    text = "\n".join(lines)
    assert "70k stars · 16k forks · 5 open issues · BSD-3-Clause" in text
    assert "Python 99% · HTML 1%" in text
    assert "python, flask, wsgi" in text
    assert "created 2010 · pushed 2 days ago · main" in text
    assert "flask.palletsprojects.com" in text


def test_about_lines_flags_and_missing_fields():
    meta = {"description": None, "stargazer_count": 1, "is_archived": True,
            "is_fork": True, "parent": "orig/thing"}
    lines = about_lines(about_from_meta(meta, None, None))
    text = "\n".join(lines)
    assert "Archived" in text and "Fork of orig/thing" in text
    assert "1 star" in text and "1 stars" not in text
    assert "None" not in text


def test_about_from_older_capture_is_still_useful():
    # Fixtures captured before these fields existed carry only the basics.
    meta = {"description": "d", "stargazer_count": 10, "pushed_at": None,
            "is_archived": False, "is_fork": False}
    assert about_lines(about_from_meta(meta, None, None))[0] == "d"


def test_nav_rows_and_contents_are_skipped():
    text = """<p align="center"><a href="a">Docs</a> - <a href="b">Community</a> - <a href="c">Roadmap</a> - <a href="d">Why PostHog?</a></p>

English · 简体中文 · Spec · Website · Discord

📕 Table of Contents

PostHog is an all-in-one developer platform for building successful products.
"""
    assert readme_line(text) == "PostHog is an all-in-one developer platform for building successful products."


def test_help_links_find_the_docs_and_chat_a_readme_points_to():
    text = """
[![Slack](https://img.shields.io/badge/slack-join-blue)](https://join.slack.com/t/openmldb/shared_invite/abc)
[![Discord](https://img.shields.io/discord/1)](https://discord.gg/xyz123)
See the [docs](https://openmldb.readthedocs.io/en/latest/), then https://discord.gg/other.
"""
    assert help_links(text) == [
        {"kind": "docs", "url": "https://openmldb.readthedocs.io/en/latest/"},
        {"kind": "discord", "url": "https://discord.gg/xyz123"},
        {"kind": "slack", "url": "https://join.slack.com/t/openmldb/shared_invite/abc"},
    ]


def test_help_links_ignore_badge_images_and_github_docs():
    assert help_links("![x](https://img.shields.io/badge/chat-gitter-green)") == []
    assert help_links("Read https://docs.github.com/en/pull-requests first.") == []
    assert help_links(None) == [] and help_links("") == []
