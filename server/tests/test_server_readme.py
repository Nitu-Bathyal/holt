"""The report's README section: the top of the Markdown README is read with the
batched details query, kept in repo_meta, and served in `about.readme`."""

from __future__ import annotations

from conftest import canned_report
from holt_server import discover
from holt_server.db import Report, now
from test_server_about import NODE, REPO, _served
from test_server_discover import add, lookup_with

MARKDOWN = "# Flask\n\nFlask is a lightweight WSGI web application framework.\n\n## Install\n\n    pip install flask\n"


def _details(**readmes):
    node = {**NODE, "readme0": None, "readme1": None, "readme2": None, **readmes}
    lookup, _ = lookup_with(lambda v: {"r0": node})
    return lookup._details([REPO])


def test_the_markdown_readme_is_kept():
    out = _details(readme0={"text": MARKDOWN})[REPO]
    assert out["readme"] == MARKDOWN.strip()


def test_a_lowercase_readme_md_is_kept_too():
    assert _details(readme2={"text": MARKDOWN})[REPO]["readme"] == MARKDOWN.strip()


def test_an_rst_readme_is_left_out():
    # NODE's own readme1 is the .rst one; the page only renders Markdown.
    assert _details(readme1={"text": "Flask\n=====\n\nFlask is a framework."})[REPO]["readme"] is None


def test_no_readme_is_none():
    assert _details()[REPO]["readme"] is None


def test_the_readme_is_served_with_the_about(h):
    details = _details(readme0={"text": MARKDOWN})
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    h.client.portal.call(lambda: discover.store_meta(h.svc, details))
    assert _served(h)["readme"] == MARKDOWN.strip()


def test_a_repo_read_before_the_readme_existed_serves_null(h):
    add(h, Report(repo=REPO, repo_key=REPO, mode="rules", days=7,
                  report=canned_report(REPO), created_at=now()))
    h.client.portal.call(lambda: discover.store_meta(h.svc, _details()))
    assert _served(h)["readme"] is None


def test_a_row_read_before_the_readme_was_kept_is_read_again_at_once(h):
    from holt_server.db import RepoMeta

    # Fresh (read just now), but from before `links` and `readme` were stored.
    add(h, RepoMeta(repo_key=REPO, repo=REPO, description="d", language="Python", stars=3,
                    topics=[], archived=False, fork=False, fetched_at=now()))
    assert h.client.portal.call(lambda: discover.stale_meta(h.svc, [REPO])) == [REPO]
    # Read again with the new fields: now it is as fresh as it looks.
    h.client.portal.call(lambda: discover.store_meta(h.svc, _details(readme0={"text": MARKDOWN})))
    assert h.client.portal.call(lambda: discover.stale_meta(h.svc, [REPO])) == []
