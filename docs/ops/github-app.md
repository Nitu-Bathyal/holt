# Reading GitHub as the Holt GitHub App

The server reads GitHub as a GitHub App owned by `holt-oss` instead of with
personal tokens. For the reasons, see
[ADR 0001](../adr/0001-read-github-as-a-github-app.md). This page covers
the one-time setup, how to check it works, and how to undo it.

Until the three variables in step 4 are set, nothing changes: the server
keeps reading with `GITHUB_TOKENS`.

## 1. Create the App

Open https://github.com/organizations/holt-oss/settings/apps/new (you need
to be an owner of `holt-oss`) and fill in:

| Field | Value |
|---|---|
| GitHub App name | `holt-oss-reader` (any unused name) |
| Homepage URL | `https://githolt.com` |
| Callback URL | leave empty |
| Request user authorization (OAuth) during installation | unticked |
| Webhook → Active | **unticked** (the server receives nothing from GitHub) |
| Repository permissions | **Metadata: Read-only**. Leave everything else at "No access". |
| Organization and account permissions | all "No access" |
| Where can this GitHub App be installed? | **Only on this account** |

Click **Create GitHub App**. On the page that opens:

- Note the **App ID** near the top of the page.
- Under **Private keys**, click **Generate a private key**. A `.pem` file
  downloads. It is the App's password: don't email it, paste it anywhere or
  commit it.

## 2. Install it on holt-oss

In the App's settings, open **Install App**, then **Install** next to
`holt-oss`, and choose **All repositories**. Metadata read-only exposes
nothing that isn't already public.

The page you land on is
`https://github.com/organizations/holt-oss/settings/installations/<number>`.
That number is the **installation ID**.

## 3. Put the key on the server

Send the `.pem` to the server (`hup` from the laptop, so it lands in
`~/inbox/<timestamp>/`). Then, on the server:

```sh
install -m 640 ~/inbox/<timestamp>/*.private-key.pem ~/.config/holt/github-app.pem
chmod 700 ~/.config/holt
shred -u ~/inbox/<timestamp>/*.private-key.pem
```

Also delete the downloaded copy on the laptop.

The key is `640`, not `600`. The server runs as its own user inside the
container and reads the key through the file's group, which is your
private group (`aahil`, no other members). Compose adds that group to the
server container (`group_add`) and mounts the file read-only at
`/run/secrets/github_app_key`.

## 4. Add three lines to the secrets file

Pause the auto-deploy first, so it doesn't pick up the change before you
have checked it:

```sh
deploy/prod/follow.sh --pause "switching to the GitHub App"
```

Then add these lines to `~/.config/holt/secrets.env`:

```sh
GITHUB_APP_ID=<App ID from step 1>
GITHUB_APP_INSTALLATION_ID=<installation ID from step 2>
GITHUB_APP_PRIVATE_KEY_FILE=/home/aahil/.config/holt/github-app.pem
```

Use the full path, not `~`. Leave `GITHUB_TOKENS` in the file: while the App
is set up it isn't used, and it's your way back.

## 5. Check it

```sh
deploy/prod/github-app.sh
```

It runs in the deployed server image with production's settings and prints
no token or key. A working setup looks like this:

```
GitHub App: holt-oss-reader (app 123456, installation 12345678)
GraphQL points left: 4999 (resets 2026-10-01T10:00:00Z)
public repositories outside holt-oss: readable
```

"readable" means it read `pallets/flask` the way a report does: pull
requests with their timelines, a file, a search, and a user by id. If the
output says `error:` or `NOT readable`, go to "Undo" below and send the
output to the maintainers. Don't switch production over.

## 6. Switch production over

```sh
FORCE=1 deploy/prod/deploy.sh
deploy/prod/follow.sh --resume
```

The server's log then says `reading GitHub as the GitHub App (app …,
installation …)`, and every hour or so `got a new installation token for the
GitHub App`.

Staging uses the same App. It reads the same three lines from the same
file, and its next build picks them up. Production and staging then share
one budget of 5,000 points an hour. Staging runs one job at a time, so its
share is small.

## Undo

Delete or comment out the three `GITHUB_APP_*` lines in
`~/.config/holt/secrets.env`, then run:

```sh
FORCE=1 deploy/prod/deploy.sh
```

The server is back on `GITHUB_TOKENS`, or on `gh auth token` if that line
is missing too. If only some of the three lines are set, the deploy stops
and says which are missing. The server never quietly falls back to personal
tokens.

## Replacing the key

In the App's settings, generate a new private key. Replace
`~/.config/holt/github-app.pem` as in step 3, then run
`FORCE=1 deploy/prod/deploy.sh`. Once the server's log shows a new
installation token, delete the old key on GitHub.

## Where things are

- The code: `server/holt_server/github_app.py` (the JWT, the installation
  token, its renewal) and `server/holt_server/github.py` (the pool every
  server-side reader leases from).
- The variables: `server/README.md`, "Environment". The server also accepts
  the key inline, as `GITHUB_APP_PRIVATE_KEY`, for local runs.
- The wiring: `deploy/prod/env.sh`, `deploy/staging/preview.sh`, and the
  `compose.yml` files in `deploy/prod/` and `deploy/staging/`.
