# GitHub App vs machine user: what GitHub's docs say

Research for the choice between (a) a GitHub App owned by `holt-oss`, installed
only on `holt-oss`, using installation access tokens, and (b) a dedicated
machine user with fine-grained PATs. Primary sources only (docs.github.com);
every quote below is verbatim. Read 2026-09-30.

## What this means for Holt

On github.com the two options have the **same base budget**: 5,000 GraphQL
points/hour and 5,000 REST requests/hour. An installation only grows past that
when it covers more than 20 repositories or an org with more than 20 users,
and it stops at 12,500/hour. A `holt-oss` install with a handful of repos and
members stays at 5,000. The fixed 10,000 (GraphQL) / 15,000 (REST) tier is
only for installations on a GitHub Enterprise Cloud org, and a free org
doesn't qualify. Search (30 req/min) and the secondary limits (100 concurrent,
2,000 GraphQL points/min, 60 s GraphQL CPU per minute) are documented without
any difference by identity. So an App does not buy Holt more headroom by
itself. What it does buy: no human account behind the credential, 1-hour
tokens instead of long-lived PATs, and no seat. On reading **public repos the
app is not installed on**, the docs don't give a direct answer. Every
endpoint Holt uses lists "GitHub App installation access tokens" and says it
"can be used without authentication or the aforementioned permissions if only
public resources are requested". But one comparison table says "Public
repository needs to be chosen during installation", and the docs say the
"implicit permissions to read public resources" only for *user* access
tokens. GraphQL has no statement either way. **Verify with one live query
before committing.** Fine-grained PATs are documented to "include read access
to public repositories". The ToS allows one free machine account per person,
and the owner is responsible for it. It also says "You may not share API
tokens to exceed GitHub's rate limitations". The docs say nothing about
running several apps or installations to raise limits. Side finding: since
27 April 2026, installation tokens are rolling out in a new `ghs_APPID_JWT`
format. Holt's redaction regex `gh[pousr]_[A-Za-z0-9]{36,255}`
(`src/holt/evidence/redact.py:31`) won't match that format, because of the
underscore after the app ID and the JWT's `.`/`-` characters.

---

## 1. GraphQL primary rate limit

**Answer:** User/PAT: 5,000 points/hour per user. Installation, not on
Enterprise Cloud: 5,000/hour, +50 per repository (if >20 repos) and +50 per
org user (if >20 users), capped at 12,500. Installation on an Enterprise Cloud
org: fixed 10,000. `holt-oss` is presumably a free org (check org settings →
billing), so the Enterprise Cloud tier doesn't apply, and with ≤20 repos and
≤20 members the installation gets 5,000, the same as a PAT. The docs don't
say whether the +50 counts every repository or only those past the 20th.

> *For users*: 5,000 points per hour per user. This includes requests made with a personal access token as well as requests made by a GitHub App or OAuth app on behalf of a user that authorized the app. Requests made on a user's behalf by a GitHub App that is owned by a GitHub Enterprise Cloud organization have a higher rate limit of 10,000 points per hour.

> *For GitHub App installations not on a GitHub Enterprise Cloud organization*: 5,000 points per hour per installation. Installations that have more than 20 repositories receive another 50 points per hour for each repository. Installations that are on an organization that have more than 20 users receive another 50 points per hour for each user. The rate limit cannot increase beyond 12,500 points per hour. The rate limit for user access tokens (as opposed to installation access tokens) are dictated by the primary rate limit for users.

> *For GitHub App installations on a GitHub Enterprise Cloud organization*: 10,000 points per hour per installation.

URL: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api

## 2. REST primary rate limit

**Answer:** User/PAT: 5,000 requests/hour. Installation: at least 5,000, the
same +50 per repo / per user scaling as GraphQL, cap 12,500. An Enterprise
Cloud installation gets 15,000. Same conclusion as for GraphQL: for `holt-oss`
it's 5,000.

> All of these requests count towards your personal rate limit of 5,000 requests per hour.

> GitHub Apps authenticating with an installation access token use the installation's minimum rate limit of 5,000 requests per hour. If the installation is on a GitHub Enterprise Cloud organization, the installation has a rate limit of 15,000 requests per hour.

> For installations that are not on a GitHub Enterprise Cloud organization, the rate limit for the installation will scale with the number of users and repositories. Installations that have more than 20 repositories receive another 50 requests per hour for each repository. Installations that are on an organization that have more than 20 users receive another 50 requests per hour for each user. The rate limit cannot increase beyond 12,500 requests per hour.

> If you are using GitHub Apps or OAuth apps, consider upgrading to GitHub Enterprise Cloud. GitHub Apps or OAuth apps have higher rate limits for organizations that use GitHub Enterprise Cloud.

URL: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

## 3. Search limits and secondary rate limits

**Answer:** REST search allows 30 requests/min when authenticated (10/min
for code search), with no separate figure for installation tokens. `GET
/search/issues` accepts installation tokens and needs no permissions. GraphQL
`search` has no search-specific cost or limit in the docs, so the general
point formula applies (minimum 1 point per call), and results cap at 1,000.
The secondary limits are listed once, with no difference by identity: 100
concurrent requests (shared REST+GraphQL), 900 points/min per REST endpoint,
2,000 points/min for GraphQL (1 point per non-mutation query), 90 s CPU per
60 s (≤60 s for GraphQL). The docs don't say what these are counted per
(token, user, app or IP).

> The REST API has a custom rate limit for searching. For authenticated requests, you can make up to 30 requests per minute for all search endpoints except for the [Search code] endpoint. The [Search code] endpoint requires you to authenticate and limits you to 10 requests per minute. For unauthenticated requests, the rate limit allows you to make up to 10 requests per minute.

URL: https://docs.github.com/en/rest/search/search

> Fine-grained access tokens for "Search issues and pull requests" — This endpoint works with the following fine-grained token types: GitHub App user access tokens, GitHub App installation access tokens, Fine-grained personal access tokens. The fine-grained token does not require any permissions.

URL: https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests

> Perform a search across resources, returning a maximum of 1,000 results.

URL: https://docs.github.com/en/graphql/reference/search

> The minimum point value of a call to the GraphQL API is **1**.

> *Make too many concurrent requests.* No more than 100 concurrent requests are allowed. This limit is shared across the REST API and GraphQL API.
> *Make too many requests to a single endpoint per minute.* No more than 900 points per minute are allowed for REST API endpoints, and no more than 2,000 points per minute are allowed for the GraphQL API endpoint.
> *Make too many requests per minute.* No more than 90 seconds of CPU time per 60 seconds of real time is allowed. No more than 60 seconds of this CPU time may be for the GraphQL API.

> | GraphQL requests without mutations | 1 |
> | Most REST API `GET`, `HEAD`, and `OPTIONS` requests | 1 |

> These secondary rate limits are subject to change without notice. You may also encounter a secondary rate limit for undisclosed reasons.

URLs: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api and https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (identical text on both).

## 4. Can an installation token read public repos the app isn't installed on?

**Answer:** The docs don't say so outright, and they point both ways.
- **For:** every REST endpoint Holt needs (list/get pull requests, reviews,
  issues, timeline, contents, blobs, commits, search) lists installation
  tokens and says it "can be used without authentication or the
  aforementioned permissions if only public resources are requested". The
  permissions reference says its permissions "are required to access private
  resources".
- **Against:** the App-vs-OAuth table says "Public repository needs to be
  chosen during installation". The installation-auth pages describe access to
  "resources owned by the user or organization that installed the app". The
  "implicit permissions to read public resources" are stated only for user
  access tokens.
- **GraphQL:** only "the app must have certain permissions to access objects
  in the GraphQL API", with nothing on public repos.

No sentence of the form "the token will also have access to public
resources" exists on the installation-token pages or on `POST
/app/installations/{installation_id}/access_tokens` (searched 2026-09-30).
Decide by running a live GraphQL `repository(owner:"pallets",name:"flask"){pullRequests(first:1){...}}`
and one REST call with a `holt-oss` installation token. `GET /user/{account_id}`
and `GET /users/{username}` both list installation tokens and need no
permissions.

Endpoint boxes (all with the same wording apart from the permission named):

> This endpoint works with the following fine-grained token types: GitHub App user access tokens, GitHub App installation access tokens, Fine-grained personal access tokens. The fine-grained token must have the following permission set: "Pull requests" repository permissions (read). This endpoint can be used without authentication or the aforementioned permissions if only public resources are requested.

- List pull requests / Get a pull request: https://docs.github.com/en/rest/pulls/pulls
- List reviews for a pull request: https://docs.github.com/en/rest/pulls/reviews
- Get an issue ("Issues" read): https://docs.github.com/en/rest/issues/issues
- List timeline events for an issue ("Issues" or "Pull requests" read): https://docs.github.com/en/rest/issues/timeline
- Get repository content ("Contents" read): https://docs.github.com/en/rest/repos/contents
- Get a blob ("Contents" read): https://docs.github.com/en/rest/git/blobs
- List commits ("Contents" read): https://docs.github.com/en/rest/commits/commits

> Fine-grained access tokens for "Get a user using their ID" — This endpoint works with the following fine-grained token types: GitHub App user access tokens, GitHub App installation access tokens, Fine-grained personal access tokens. The fine-grained token does not require any permissions. This endpoint can be used without authentication if only public resources are requested.

(Identical for "Get a user", `GET /users/{username}`.) URL: https://docs.github.com/en/rest/users/users

> These permissions are required to access private resources. Some endpoints can also be used to access public resources without these permissions. To see whether an endpoint can access public resources without a permission, see the documentation for that endpoint.

URL: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps

Against:

> | **For access to public repositories** | Public repository needs to be chosen during installation. | `public_repo` scope. |

URL: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps

> Although GitHub Apps don't have any permissions by default, they do have implicit permissions to read public resources when acting on behalf of a user. When a user authorizes the app to act on their behalf, the GitHub App can use the resulting user access token to make requests to the REST API and the GraphQL API to read public resources.

URL: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app

> Once your GitHub App is installed on an account, you can make it authenticate as an app installation for API requests. This allows the app to access resources owned by that installation, as long as the app was granted the necessary repository access and permissions.

> App installations can also use the GraphQL API. Similar to the REST API, the app must have certain permissions to access objects in the GraphQL API. For GraphQL requests, you should test that your app has the required permissions for the GraphQL queries and mutations that you want to make.

URL: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation

For comparison, option (b):

> All fine-grained personal access tokens include read access to public repositories.

URL: https://docs.github.com/en/graphql/guides/forming-calls-with-graphql

## 5. Token lifetime, JWT, endpoints

**Answer:** An installation token lasts 1 hour. JWT: RS256; `iat` is
recommended 60 s in the past; `exp` at most 10 minutes ahead; `iss` = client
ID (recommended) or app ID; must be sent as `Authorization: Bearer`. Mint with
`POST /app/installations/{installation_id}/access_tokens` (JWT only). Find the
id with `GET /app/installations` or `GET /orgs/{org}/installation` (JWT only).
New tokens are rolling out as `ghs_APPID_JWT`, so they are not 40 characters.

> Installation tokens expire one hour from the time you create them. Using an expired token produces a status code of 401 - Unauthorized, and requires creating a new installation token.

> You must use a JWT to access this endpoint.

> Starting April 27, 2026, GitHub began a staged rollout of a stateless format (ghs\_APPID\_JWT) to all newly minted GitHub App installation tokens, making them more performant and improving the reliability of our API surface. If your application expects or relies on installation tokens being exactly 40 characters long, it may not handle this new token format correctly.

URL: https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app

> Your JWT must be signed using the `RS256` algorithm and must contain the following claims.
> `iat` … To protect against clock drift, we recommend that you set this 60 seconds in the past and ensure that your server's date and time is set accurately
> `exp` … The time must be no more than 10 minutes into the future.
> `iss` … The client ID or application ID of your GitHub App. … Use of the client ID is recommended.

> In most cases, you can use `Authorization: Bearer` or `Authorization: token` to pass a token. However, if you are passing a JSON web token (JWT), you must use `Authorization: Bearer`.

URL: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app

> You can also use the REST API to find the ID for an installation of your app. For example, you can get an installation ID with the `GET /users/{username}/installation`, `GET /repos/{owner}/{repo}/installation`, `GET /orgs/{org}/installation`, or `GET /app/installations` endpoints.

> To authenticate with an installation access token, include it in the `Authorization` header of an API request. The access token will work with both the GraphQL API and the REST API.

URL: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation

> Installation access tokens expire after one hour … You should cache tokens that you create. Before you create a new token, check your cache to see if you already have a valid token.

URL: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app

## 6. Permissions, webhook, install scope

**Answer:** An app has no permissions by default. For public data, the
endpoint docs say no permission is needed (see Q4). Current github.com docs
don't say Metadata is mandatory. Archived GHES 3.2 docs say it is on by
default and forced back to read-only whenever any repository permission is
selected. So choosing no permissions, or Metadata read-only alone, is the
minimum. A webhook is not required: untick **Active**. **Only on this
account** makes the app private, installable only on `holt-oss`.

> GitHub Apps don't have any permissions by default. … You should select the minimum permissions required for the app.

URL: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app

> GitHub Apps have the Read-only metadata permission by default. … If you set the metadata permission to No access and select a permission that requires repository access, GitHub will override your selection and set the metadata permission back to Read-only.

URL (archived, GHES 3.2): https://docs.github.com/en/enterprise-server@3.2/rest/overview/permissions-required-for-github-apps

> Optionally, if you do not want your app to receive webhook events, deselect **Active**. For example, if your app will only be used for authentication or does not need to respond to webhooks, deselect this option.

> Under "Where can this GitHub App be installed?", select **Only on this account** or **Any account**.

> A user or organization can register up to 100 GitHub Apps, but there is no limit to how many GitHub Apps can be installed on an account.

URL: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app

> If you set your GitHub App registration to private, it can only be installed on the account that owns the app.

URL: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private

## 7. Terms: machine accounts, bulk activity, rate-limit circumvention

**Answer:** A machine account is allowed: set up by a human who accepts the
Terms and is responsible for it, and at most one free machine account per
person besides their own. The AUP bans "excessive automated bulk activity"
and "undue burden". The ToS API Terms ban sharing API tokens to exceed rate
limits. The docs say nothing about registering several apps or installations
to raise limits. They do say GitHub can grant rate-limit increases per app or
per installation.

> You must be a human to create an Account. Accounts registered by "bots" or other automated methods are not permitted. We do permit machine accounts:
> A machine account is an Account set up by an individual human who accepts the Terms on behalf of the Account, provides a valid email address, and is responsible for its actions. A machine account is used exclusively for performing automated tasks. Multiple users may direct the actions of a machine account, but the owner of the Account is ultimately responsible for the machine's actions. You may maintain no more than one free machine account in addition to your free Personal Account.
> One person or legal entity may maintain no more than one free Account (if you choose to control a machine account as well, that's fine, but it can only be used for running a machine).

> Abuse or excessively frequent requests to GitHub via the API may result in the temporary or permanent suspension of your Account's access to the API. GitHub, in our sole discretion, will determine abuse or excessive usage of the API.
> You may not share API tokens to exceed GitHub's rate limitations.

URL: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service (sections B and H)

> We do not allow content or activity on GitHub that is: … using our servers for any form of excessive automated bulk activity, to place undue burden on our servers through automated means …

> Scraping refers to extracting information from our Service via an automated process, such as a bot or webcrawler. Scraping does not refer to the collection of information through our API. Please see Section H of our Terms of Service for our API Terms.

URL: https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies (sections 4 and 7)

> Continuing to make requests while you are rate limited may result in the banning of your integration.

URL: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

> Rate limit increases can be granted both at the GitHub Apps level (affecting all installations) and at the individual installation level.

URL: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps

## 8. `/rate_limit`, `rateLimit`, `viewer`, identifying the app

**Answer:** `GET /rate_limit` doesn't count against the primary limit (it can
count against the secondary limit) and accepts installation tokens. For the
GraphQL `rateLimit` field, the docs only say to prefer headers and that every
call costs at least 1 point. They don't say whether a `rateLimit`-only query
is free. `viewer` is documented only as "The currently authenticated user"
(`User!`), and the docs never say how it behaves with an installation token.
The installation-auth page's Octokit example does query `viewer { login }`
with an installation client, but don't rely on it. Test it live. To check
which app a key belongs to, use `GET /app` with a JWT. It returns `id`,
`slug`, `client_id`, `name` and `owner`, and rejects installation tokens.

> You can call the `GET /rate_limit` endpoint for a periodic overview of all resource families for the authenticated user. Calling this endpoint does not count against your primary rate limit, but it can count against your secondary rate limit.

URL: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

> Fine-grained access tokens for "Get rate limit status for the authenticated user" — This endpoint works with the following fine-grained token types: GitHub App user access tokens, GitHub App installation access tokens, Fine-grained personal access tokens. The fine-grained token does not require any permissions.

URL: https://docs.github.com/en/rest/rate-limit/rate-limit

> You can also query the `rateLimit` object to check your rate limit. When possible, you should use the rate limit response headers instead of querying the API to check your rate limit.

URL: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api

> `rateLimit` - query: The client's rate limit information. … `dryRun` (Boolean): If true, calculate the cost for the query without evaluating it.

URL: https://docs.github.com/en/graphql/reference/meta

> `viewer` - query: The currently authenticated user. **Type:** User!

URL: https://docs.github.com/en/graphql/reference/users

> Returns the GitHub App associated with the authentication credentials used. … You must use a JWT to access this endpoint.

> Fine-grained access tokens for "Get the authenticated app" — This endpoint does not work with GitHub App user access tokens, GitHub App installation access tokens, or fine-grained personal access tokens.

URL: https://docs.github.com/en/rest/apps/apps#get-the-authenticated-app

> An installation token identifies the app as a GitHub App bot account, such as @jenkins\[bot].

URL: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps

---

## Sources (all read 2026-09-30)

- https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
- https://docs.github.com/en/rest/rate-limit/rate-limit
- https://docs.github.com/en/rest/search/search
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app
- https://docs.github.com/en/rest/apps/apps
- https://docs.github.com/en/rest/users/users
- https://docs.github.com/en/rest/pulls/pulls
- https://docs.github.com/en/rest/pulls/reviews
- https://docs.github.com/en/rest/issues/issues
- https://docs.github.com/en/rest/issues/timeline
- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/rest/git/blobs
- https://docs.github.com/en/rest/commits/commits
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
- https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-installation-access-tokens
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- https://docs.github.com/en/enterprise-server@3.2/rest/overview/permissions-required-for-github-apps (archived; Metadata default)
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private
- https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
- https://docs.github.com/en/graphql/reference/search
- https://docs.github.com/en/graphql/reference/meta
- https://docs.github.com/en/graphql/reference/users
- https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts
- https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
