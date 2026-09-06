# Putting this online for a team

One server runs the web app, the API and the database — three containers
behind one reverse proxy. Everyone opens the same URL, signs in
with their own account, and sees the same workspace — the same templates,
series and content, live. There is nothing to seed: shared data is shared
because it is one database, not because a copy was handed out.

## What changes on a server

**The model stays on your machines.** This used to say a server has no CLI and
no login, so it needs an `ANTHROPIC_API_KEY` at real money per run. That is no
longer the shape. The server holds the UI, the API, Postgres and the frames,
and makes every decision; the writing happens on a **worker** — a process on
each teammate's own computer, signed in under their own CLI, using their own
GPU. See `docs/WORKER.md`.

So the server needs no key, no `claude`, no ffmpeg for a link, and no GPU.
What it needs is at least one enrolled machine, or nothing can run: **Settings
→ Machines**, mint a token, paste it into that computer's worker. A run with
no capable machine says so by name and by install command rather than quietly
spending money.

`ANTHROPIC_API_KEY` still works, and is still off by default. A workspace can
switch on **API fallback**, which lets the server write a section itself when
no machine is awake. It is per workspace and opt-in on purpose: a fallback
that fired by itself would spend real money at exactly the moment nobody was
watching. `run_sections.wrote_with` records which machine — or `server:api` —
wrote each section, and `runs.created_by` who pressed the button.

**Two hostnames.** The web app answers on `APP_HOST` and the NestJS API on
`API_HOST`; the browser calls the API directly, cross-origin. The session
cookie is set by the API and read by both, which works because both hosts sit
under `COOKIE_DOMAIN` (`.content.yourcompany.com`). Put them on unrelated
domains and you need `COOKIE_SAMESITE=none` — and you should not.

`WEB_ORIGIN` now carries a second job. It is still the CORS allow-list, and it
is also what the desktop app's one-time sign-in hand-off is allowed to redirect
to — an endpoint that sets a session cookie and then redirects is worth more to
an attacker than either half, so `next` is refused unless it matches. It has to
be the **exact** origin the app was built with as `CONTENTOS_CONSOLE_URL`:
scheme, host and port. Get it wrong and nothing breaks loudly — teammates just
quietly get asked to sign in a second time, in the webview, having already
signed in to the app.

**Not Vercel, and now for a smaller reason.** A run is no longer a loop inside
the API: `advance()` enqueues jobs and returns, and a worker claims them. But
the API still holds long-poll connections for workers claiming work, runs a
reaper on a timer, and serves frame uploads — none of which survives a
function that is frozen between requests.

The box is much cheaper than it was, though. It no longer downloads video,
cuts frames for a link, or runs a model; it serves pages and holds rows. A
small VPS — Hetzner, DigitalOcean, 2GB of RAM — is comfortable rather than
tight. `ffmpeg` is still in the API image because a **browser upload** is cut
on the server, where its bytes already are; whisper is not, because
transcription is a job over a 16 kHz WAV that goes to a machine with a GPU.

**Secrets travel with the data.** `CONTENTOS_SECRET` encrypts the API keys in
the settings table. Move the database without moving that value and every saved
key becomes unreadable, which looks like the keys vanished.

In production it is now **required**: the API refuses to start without it,
rather than falling back to a key derived from `DATABASE_URL`. That fallback
was the quieter failure of the two — it works until the day somebody rotates
the database password, and then every key saved under the old one decrypts to
nothing and reads on the page as though it had never been pasted. An install
that has been running on the fallback needs `CONTENTOS_SECRET` set before it
will boot again, and the keys saved under the fallback have to be re-entered
once; there is no way to recover them, because the value that encrypted them
was never written down.

## First deploy

On a machine with Docker, pointed at by a domain's A record:

```bash
git clone <your repo> contentos && cd contentos
cp .env.production.example .env.production   # fill in every line
docker compose -f docker-compose.prod.yml up -d --build
```

That brings up four containers: Postgres, the API, the web app, and Traefik,
which gets a TLS certificate for `APP_HOST` and `API_HOST` on its own.
Migrations and the seed run inside the API as it starts, before it listens —
not something you run.

The web app learns the API's address at **build** time (`NEXT_PUBLIC_API_URL`
is a build arg in the compose file), so changing `API_HOST` means rebuilding
the `app` image, not restarting it.

Open `https://APP_HOST`. The first account you make is the owner.

### Then enrol a machine, or nothing can run

The server writes nothing by itself. Until one computer is enrolled, every run
ends `unroutable` with a sentence naming the tool nobody has.

**Settings → Machines → Enrol.** The token is shown once and kept only as a
sha256 — losing it means revoking and enrolling again. On that computer:

```bash
CONTENTOS_API_URL=https://API_HOST CONTENTOS_WORKER_TOKEN=<the token> npm run worker
```

It registers, reports what it has (`claude`, `yt-dlp`, `ffmpeg`, `whisper`, …),
and starts asking for work. Integrations then shows that machine's tools, and
the row goes green. Anything missing is an install command on **that**
computer, not on the server — which is the distinction the page is built to
draw. Full options are in `docs/WORKER.md`.

One machine is enough to start. A second is how a run gets faster: sections in
the same dependency wave go to different computers, which is why
`max_concurrency` defaults to 1 — one machine is one CLI login.

### The desktop app, for people who do not use a terminal

The command above is the developer's way in. Everyone else gets an installer,
and the two addresses on this page are **baked into it at build time** so that
nobody is asked to type a hostname:

```bash
CONTENTOS_CONSOLE_URL=https://APP_HOST \
CONTENTOS_API_URL=https://API_HOST \
  npm run desktop:installer
```

Both, and neither derived from the other. `api.` in front of the web host is
this repo's compose convention rather than a rule — this page says plainly the
two may live anywhere — and a guess that is usually right fails on somebody
else's DNS long after whoever guessed has stopped looking.

Build it without them and it still works, but every teammate is asked for the
addresses at install time, which is the thing this removes. The script says so,
loudly, before and after the build.

What a teammate then does: run the installer, click through SmartScreen's
warning (it is unsigned — see `docs/DECISIONS.md`), and **sign in with their
own email and password**. The app mints its own machine token from that
session and starts the worker; nobody pastes anything.

The **Settings → Machines** flow above is still there and still works — it is
the way to enrol a machine that is not running the desktop app, and the way to
revoke one. It is no longer what an ordinary install involves.

Then, from your laptop, ask the API the questions that matter:

```bash
API_URL=https://API_HOST WEB_ORIGIN=https://APP_HOST SESSION=<your cookie value> npm run api:smoke
```

It says whether the API is up, refuses a missing and a forged cookie, answers
for yours, and allows the web origin through CORS. The cookie value is in your
browser's devtools under Application → Cookies → `contentos_session`.

Four of its lines are about the second credential, and they are the ones worth
reading twice. A worker holds a bearer token rather than a cookie, and the
entire reason it has its own credential is that neither reaches the other's
routes: a **session must not be able to claim jobs**, and a **stolen worker
token must not read the content library**. Both are one decorator away from
being wrong, neither shows up on any screen, so both are asserted here.

It also prints how many machines are enrolled. Zero is not a failed deploy,
but it is the reason nothing runs.

## Deploying on Dokploy

Dokploy runs its own Traefik on :80 and :443. `docker-compose.prod.yml` ships
one too, so those two fight for a socket — use **`docker-compose.dokploy.yml`**
instead. It is the same three containers with the proxy removed and no
published ports at all: Dokploy's proxy reaches the containers over its own
network, and the domains are set in its UI rather than in labels here. Two
places writing Traefik rules for one service is how a deploy serves the wrong
container.

**Create → Compose**, point it at this repository and that file, then:

| Where | What |
| --- | --- |
| Environment | `POSTGRES_PASSWORD`, `CONTENTOS_SECRET`, `APP_HOST`, `API_HOST`, `COOKIE_DOMAIN` |
| Domains | `APP_HOST` → service **app**, port **3333** |
| Domains | `API_HOST` → service **api**, port **4000** |
| Build arguments, on **app** | `NEXT_PUBLIC_API_URL=https://API_HOST` |

That last row is a build argument and not an environment variable. The browser
bundle is compiled with the API's address inside it, so changing `API_HOST`
means rebuilding the app image, not restarting it — and Dokploy's two fields
look alike while only one of them reaches a `next build`.

`COOKIE_DOMAIN` still has to be the parent of both hosts (`.content.example.com`
for `content.example.com` and `api.content.example.com`), or the session cookie
the API sets never reaches the console.

### Then build the desktop app, on your own machine

Dokploy builds the server. The app is built where you are and handed to people:

```bash
CONTENTOS_CONSOLE_URL=https://APP_HOST \
CONTENTOS_API_URL=https://API_HOST \
  npm run desktop:installer
```

→ `src-tauri/target/release/bundle/nsis/Content OS_<version>_x64-setup.exe`.

**The one setting that breaks quietly.** `WEB_ORIGIN` on the server is set from
`APP_HOST`, and it is also the only origin the desktop app's sign-in hand-off
may redirect to. It must equal `CONTENTOS_CONSOLE_URL` **exactly** — scheme,
host and port, no trailing slash. Get it wrong and nothing errors anywhere:
teammates simply get asked to sign in a second time inside the app, having
already signed in to it, and there is no message saying why.

Everything else a teammate needs is inside the installer. They run it, click
through SmartScreen (it is unsigned, deliberately — `docs/DECISIONS.md`), and
sign in with their own email and password. No address to type, no token to
paste.

Rebuild and re-send the installer when the addresses change or the worker does.
A change to a prompt, a template or a screen needs no new installer at all —
that is the server's, and it is why the console stays hosted.

## Bringing your existing work across

```bash
# on your laptop
npm run db:dump backup.sql

# copy it over, then on the server
docker compose -f docker-compose.prod.yml cp backup.sql app:/tmp/backup.sql
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U contentos contentos < backup.sql
```

Everything comes across: templates, series, topics, every run and every written
section — including the users table, so **your existing account and password
work on the server** and there is no owner to claim.

## Letting your team in

Signup closes the moment the console has an owner, so nobody can wander in.
Everyone after you arrives on an invite:

**Settings → Team → Create invite link.** The link is copied to your clipboard;
send it however you already talk. It works **once** and expires in 14 days. An
email on the invite locks it to that address. An unused link can be revoked.

**Settings → Team → Who has access** lists everyone with an account. Removing
someone deletes their sessions with the row, so it takes effect on their next
request rather than whenever they next sign out — and what they wrote stays,
because runs and topics belong to the workspace, not to the person who pressed
the button. The owner cannot be removed, and nobody can remove themselves:
either would leave a console with no way back into it.

There are no roles: everyone who is in can read and change everything, the same
way they could if you handed them the laptop. If you need someone who can only
read, that is a feature to build, not a setting to find.

## Keeping it

The workspace is the `pgdata` volume. `sourcedata` holds what a source left
behind, and it is smaller than it used to be: a **fetched link** downloads its
video on the worker and sends back only the stills and a 16 kHz WAV, so the
server never stores the video at all. An **upload** is the exception — those
bytes arrived here and stay here.

Either way it is a second volume rather than part of the dump below, because
it is bulk that a re-fetch can rebuild while the database is the part that
cannot be.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump --clean --if-exists -U contentos contentos > backup-$(date +%F).sql
```

Put that on a schedule somewhere off the server. A dump is a few hundred
kilobytes; there is no excuse for not having yesterday's.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

The app runs pending migrations as it starts. If you would rather run them
first — before anything serves — `npm run db:migrate` does exactly that against
whatever `DATABASE_URL` points at.

## What used to be here

This section offered an alternative for when the API bill was the problem: put
only the database online, keep the app on every laptop, and let each person
write with their own `claude` login. It is gone because the worker split is
that idea done properly.

It bought no API bill at the price of handing everyone the repo, a Node
toolchain, and a `DATABASE_URL` that can drop every table. The worker gets the
same thing — each person's own subscription, their own GPU — while the
database stays behind the API, the UI is one URL nobody has to install, and a
teammate holds a token that reaches six endpoints instead of credentials that
reach everything.

If the server itself is the objection rather than its cost, the honest small
setup is one always-on computer running the whole thing behind a tunnel
(Cloudflare Tunnel, Tailscale), with the worker beside it. Same code, same
enrolment, no VPS. The trade is that when that computer sleeps, so does the
console.
