"""Profile: `/v1/me/profile`, the 18+ confirmation, and the issue flags a
profile uses (`beginner`, `areas`)."""

from __future__ import annotations

from holt_server import schema
from holt_server.db import GitHubConnection, Profile, now

PREFS = {"languages": ["Python", " rust ", "python"], "topics": ["Web Framework", "cli"],
         "days": 3, "contributions": ["docs", "tests", "docs"], "level": "experienced"}


def put(h, json, user="u1"):
    return h.put("/v1/me/profile", json, user=user)


def rows(h, model, user):
    async def q():
        async with h.svc.db.session() as s:
            return await s.get(model, user)
    return h.client.portal.call(q)


def test_signed_in_only(h):
    for r in (h.get("/v1/me/profile"), h.put("/v1/me/profile", PREFS),
              h.delete("/v1/me/profile")):
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"


def test_no_profile_until_saved(h):
    assert h.get("/v1/me/profile", user="u1").json() == {"profile": None, "adult_confirmed": False}


def test_first_save_needs_the_18_plus_confirmation(h):
    r = put(h, PREFS)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"
    assert "18" in r.json()["error"]["message"]
    assert rows(h, Profile, "u1") is None


def test_save_normalises_and_reads_back(h):
    r = put(h, {**PREFS, "adult_confirmed": True})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["adult_confirmed"] is True
    p = got["profile"]
    assert p["languages"] == ["python", "rust"]
    assert p["topics"] == ["web-framework", "cli"]
    assert (p["days"], p["contributions"], p["level"]) == (3, ["docs", "tests"], "experienced")
    assert p["updated_at"].endswith("Z")
    assert h.get("/v1/me/profile", user="u1").json() == got
    assert rows(h, Profile, "u1").adult_confirmed_at is not None
    # Other users don't see it.
    assert h.get("/v1/me/profile", user="u2").json()["profile"] is None


def test_later_saves_dont_ask_again(h):
    put(h, {**PREFS, "adult_confirmed": True})
    first = rows(h, Profile, "u1").adult_confirmed_at
    r = put(h, {"languages": ["go"], "level": "newcomer"})
    assert r.status_code == 200, r.text
    p = r.json()["profile"]
    assert (p["languages"], p["topics"], p["days"], p["contributions"], p["level"]) == (
        ["go"], [], 7, [], "newcomer")
    assert rows(h, Profile, "u1").adult_confirmed_at == first


def test_connected_github_counts_as_the_confirmation(h):
    async def connect():
        async with h.svc.db.session() as s:
            s.add(GitHubConnection(user_id="u1", github_id=1, login="octo",
                                   connected_at=now(), adult_confirmed_at=now()))
            await s.commit()
    h.client.portal.call(connect)
    assert h.get("/v1/me/profile", user="u1").json()["adult_confirmed"] is True
    r = put(h, PREFS)
    assert r.status_code == 200, r.text
    # Their confirmation is the connection's; none is recorded here.
    assert rows(h, Profile, "u1").adult_confirmed_at is None


def test_bad_input_is_a_plain_400(h):
    for bad in ({"level": "expert"}, {"contributions": ["marketing"]}, {"days": 0},
                {"days": 365}, {"topics": ["c++"]}, {"languages": ["x" * 41]},
                {"languages": [str(i) for i in range(11)]}):
        r = put(h, {**bad, "adult_confirmed": True})
        assert r.status_code == 400, (bad, r.text)
        assert r.json()["error"]["code"] == "invalid_request"


def test_delete_forgets_it(h):
    put(h, {**PREFS, "adult_confirmed": True})
    r = h.delete("/v1/me/profile", user="u1")
    assert r.status_code == 200
    assert r.json() == {"profile": None, "adult_confirmed": False}
    assert rows(h, Profile, "u1") is None
    assert h.delete("/v1/me/profile", user="u1").status_code == 200


def test_starter_issues_carry_beginner_and_areas():
    issue = schema.StarterIssue(number=1, title="Fix typo in README", url="u",
                                labels=["good first issue", "documentation"])
    assert issue.beginner is True
    assert issue.areas == ["docs"]
    dumped = issue.model_dump(mode="json")
    assert dumped["beginner"] is True and dumped["areas"] == ["docs"]
    plain = schema.StarterIssue(number=2, title="Crash when config is empty", url="u",
                                labels=["help wanted", "bug"])
    assert (plain.beginner, plain.areas) == (False, ["code"])
    # Stored results that already carry the fields validate too.
    assert schema.StarterIssue.model_validate(dumped).areas == ["docs"]
