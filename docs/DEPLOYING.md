# Putting this online for a team

One server runs the app and its database. Everyone opens the same URL, signs in
with their own account, and sees the same workspace — the same templates,
series and content, live. There is nothing to seed: shared data is shared
because it is one database, not because a copy was handed out.

## What changes on a server

**The model.** Your laptop writes with the `claude` CLI, billed to your Claude
subscription. A server has no CLI and no login, so it needs an
`ANTHROPIC_API_KEY` — the app already falls back to the API when the command is
missing. That is a real cost per run, and the reason to keep an eye on who runs
what.

**Not Vercel.** A run is a loop inside the server process (`driveRun`) that
takes minutes and shells out to local binaries. Serverless kills both. A small
VPS — Hetzner, DigitalOcean, anything with 2GB of RAM — is the shape this wants.

**Secrets travel with the data.** `CONTENTOS_SECRET` encrypts the API keys in
the settings table. Move the database without moving that value and every saved
key becomes unreadable, which looks like the keys vanished.

## First deploy

On a machine with Docker, pointed at by a domain's A record:

```bash
git clone <your repo> contentos && cd contentos
cp .env.production.example .env.production   # fill in every line
docker compose -f docker-compose.prod.yml up -d --build
```

That brings up three containers: Postgres, the app, and Traefik, which gets a
TLS certificate for `APP_HOST` on its own. Migrations run before the app takes
traffic — the `command:` in the compose file does that, not you.

Open `https://APP_HOST`. The first account you make is the owner.

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

The whole workspace is the `pgdata` volume.

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

## The alternative, if the API cost is the problem

Keep the app on each person's machine and put **only the database** online
(Neon, Supabase, Railway): every laptop sets the same `DATABASE_URL`, everyone
sees the same data live, and each person writes with their own `claude` login,
so there is no API bill. The cost is that everyone needs the repo, Node and the
CLI installed, and everyone holds a database URL that can drop every table.
