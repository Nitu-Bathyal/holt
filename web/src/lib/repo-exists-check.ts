// The one repo-exists checker per server process, shared by the proxy (the
// report page's 404) and GET /api/repo-exists (the paste boxes, before they
// send a signed-out visitor to sign in). Mock mode answers from the fixtures.
import { isMockNotFound } from "./mock/fixtures";
import { probeGitHub, repoExistsChecker } from "./repo-exists";

export const repoExists = repoExistsChecker({
  probe: process.env.MOCK_API === "1" ? async (r) => (isMockNotFound(r) ? "missing" : "exists") : probeGitHub,
});
