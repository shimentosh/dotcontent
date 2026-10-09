# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub instead: open the **Security** tab of this
repository and choose **Report a vulnerability**. Include the steps to
reproduce it and the version or commit you tested.

You will get an answer within a few days. Once the problem is fixed, the
advisory is published with credit to you, unless you would rather stay
anonymous.

## What is in scope

- The console (`app/`, `components/`, `lib/`) and the API (`api/`)
- Sign-in, sessions, invites and machine tokens
- The worker (`worker/`) and the desktop app (`src-tauri/`)
- How API keys are stored (encrypted with `DOTCONTENT_SECRET`)

## Running it safely

- **Always set `DOTCONTENT_SECRET` on a server**, and keep it. It encrypts the
  API keys saved in Settings.
- **Serve the console and the API over HTTPS.** `docker-compose.prod.yml`
  does this with Let's Encrypt.
- **A machine token is a password.** Anyone holding one can claim jobs as
  that machine. Revoke it in **Settings → Machines** when a laptop leaves the
  team.
