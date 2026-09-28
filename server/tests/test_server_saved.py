"""Saved repos: `/v1/me/saved` (API.md, "Saved repos")."""

from __future__ import annotations

from conftest import STATS, canned_report
from holt_server import saved
from holt_server.db import RepoMeta, Report, SavedRepo


def add(h, *items):
    async def go():
        async with h.svc.db.session() as s:
            s.add_all(items)
            await s.commit()
    h.client.portal.call(go)


def report(repo, verdict="viable", mode="rules"):
    body = canned_report(repo, mode, 7, verdict)
    body["stats"] = dict(STATS)
    return Report(repo=repo, repo_key=repo.lower(), mode=mode, days=7, report=body)


def save(h, repo, user="u1"):
    return h.put(f"/v1/me/saved/{repo}", user=user)


def listed(h, user="u1"):
    r = h.get("/v1/me/saved", user=user)
    assert r.status_code == 200, r.text
    return r.json()


def test_save_then_list(h):
    r = save(h, "pallets/flask")
    assert r.status_code == 200, r.text
    got = r.json()
    assert (got["repo"], got["saved"]) == ("pallets/flask", True)
    assert got["saved_at"].endswith("Z")
    body = listed(h)
    assert [s["repo"] for s in body["saved"]] == ["pallets/flask"]
    assert body["saved"][0]["saved_at"] == got["saved_at"]


def test_signed_in_only(h):
    for r in (h.get("/v1/me/saved"), h.delete("/v1/me/saved"),
              h.get("/v1/me/saved/pallets/flask"), save(h, "pallets/flask", user=None),
              h.delete("/v1/me/saved/pallets/flask")):
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"


def test_needs_the_internal_key(h):
    assert h.client.get("/v1/me/saved", headers={"X-Holt-User": "u1"}).status_code == 401


def test_saving_twice_keeps_one_row_and_the_first_time(h):
    first = save(h, "pallets/flask").json()
    again = save(h, "Pallets/Flask")
    assert again.status_code == 200, again.text
    assert again.json() == first
    assert [s["repo"] for s in listed(h)["saved"]] == ["pallets/flask"]


def test_unsave_is_idempotent(h):
    save(h, "pallets/flask")
    for _ in range(2):
        r = h.delete("/v1/me/saved/pallets/flask", user="u1")
        assert r.status_code == 200, r.text
        assert r.json() == {"repo": "pallets/flask", "saved": False, "saved_at": None}
    assert listed(h)["saved"] == []


def test_state_of_one_repo(h):
    assert h.get("/v1/me/saved/pallets/flask", user="u1").json() == {
        "repo": "pallets/flask", "saved": False, "saved_at": None}
    at = save(h, "pallets/flask").json()["saved_at"]
    assert h.get("/v1/me/saved/PALLETS/flask", user="u1").json() == {
        "repo": "pallets/flask", "saved": True, "saved_at": at}


def test_each_user_sees_only_their_own(h):
    save(h, "pallets/flask", user="u1")
    save(h, "octo/one", user="u2")
    assert [s["repo"] for s in listed(h, "u1")["saved"]] == ["pallets/flask"]
    assert [s["repo"] for s in listed(h, "u2")["saved"]] == ["octo/one"]
    assert h.get("/v1/me/saved/octo/one", user="u1").json()["saved"] is False


def test_newest_first(h):
    for repo in ("octo/one", "octo/two", "octo/three"):
        save(h, repo)
    assert [s["repo"] for s in listed(h)["saved"]] == ["octo/three", "octo/two", "octo/one"]


def test_bad_repo_is_refused(h):
    r = save(h, "octo/x!y")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_repo"


def test_list_carries_the_discover_card(h):
    add(h, report("octo/one", "not_viable"),
        RepoMeta(repo_key="octo/one", repo="Octo/One", description="A tool.",
                 language="Rust", stars=321, topics=["cli"]))
    save(h, "octo/one")
    save(h, "octo/unchecked")
    items = {s["repo"]: s for s in listed(h)["saved"]}
    card = items["Octo/One"]["card"]
    assert (card["verdict"], card["headline"], card["tone"]) == (
        "not_viable", "Not worth your time", "bad")
    assert (card["description"], card["language"], card["stars"]) == ("A tool.", "Rust", 321)
    assert card["reason"] and card["stats"]["outsider_attempts"] == STATS["outsider_attempts"]
    # No report yet: saved all the same, with no card.
    assert items["octo/unchecked"]["card"] is None


def test_card_is_the_latest_rules_report_only(h):
    add(h, report("octo/one", "not_viable"))
    add(h, report("octo/one", "viable"), report("octo/one", "insufficient_evidence", mode="ai"))
    save(h, "octo/one")
    assert listed(h)["saved"][0]["card"]["verdict"] == "viable"


def test_saving_uses_githubs_casing_when_known(h):
    add(h, report("Octo/One"))
    assert save(h, "octo/one").json()["repo"] == "Octo/One"


def test_there_is_a_most(h, monkeypatch):
    monkeypatch.setattr(saved, "MAX_SAVED", 2)
    save(h, "octo/one")
    save(h, "octo/two")
    r = save(h, "octo/three")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"
    # Saving one already saved is still fine at the most.
    assert save(h, "octo/two").status_code == 200


def test_writes_are_rate_limited_apart_from_analyses(h, monkeypatch):
    monkeypatch.setattr(saved, "WRITES_PER_HOUR", 2)
    save(h, "octo/one")
    h.delete("/v1/me/saved/octo/one", user="u1")
    r = save(h, "octo/one")
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    # Reading the list isn't a write.
    assert h.get("/v1/me/saved", user="u1").status_code == 200
    # Someone else has their own count.
    assert save(h, "octo/one", user="u2").status_code == 200


def test_delete_all_removes_only_this_users_rows(h):
    save(h, "octo/one", user="u1")
    save(h, "octo/two", user="u1")
    save(h, "octo/one", user="u2")
    r = h.delete("/v1/me/saved", user="u1")
    assert r.status_code == 200, r.text
    assert r.json()["saved"] == []
    assert listed(h, "u1")["saved"] == []
    assert [s["repo"] for s in listed(h, "u2")["saved"]] == ["octo/one"]


def test_forget_deletes_a_users_saved_rows(h):
    save(h, "octo/one", user="u1")
    save(h, "octo/one", user="u2")

    async def go():
        async with h.svc.db.session() as s:
            await saved.forget(s, "u1")
            await s.commit()
            return [r.user_id for r in (await s.execute(
                SavedRepo.__table__.select())).all()]
    assert h.client.portal.call(go) == ["u2"]
