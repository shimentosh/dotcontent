# Seeing the app

Use `scripts/browse.mjs`. It launches headless Chrome if none is running, signs
in, navigates, and gives you a screenshot or a value back. Do not write another
CDP driver in a temp folder — that is what this replaced.

```bash
node scripts/browse.mjs shot content              # → .shots/content.png
node scripts/browse.mjs shot packs templates.png  # under a name you pick
node scripts/browse.mjs text content              # the page's visible text
node scripts/browse.mjs eval content "document.querySelector('h1').innerText"
node scripts/browse.mjs click "runs/run_abc123" "Read"   # click, then screenshot
node scripts/browse.mjs stop                      # close Chrome
```

Then `Read` the PNG it prints the path to.

**Leave the leading slash off the route.** Git Bash turns `/content` into
`C:/Program Files/Git/content` before the script ever sees it. The script unwinds
that when it can, but `content` always works.

Flags: `--port 3333`, `--debug 9222`, `--wait 3000` (ms to settle after
navigating — raise it for a page that fetches), `--anon` (skip signing in, to
see what a signed-out visitor gets).

## Signing in

Pages are behind `proxy.ts` — Next 16's name for what used to be
`middleware.ts`: a page load without a session cookie redirects to `/login`.
Data comes from the NestJS API on `http://localhost:4000`, whose guard answers
`401 {"error":"Sign in first"}` to anything without a live session. `browse.mjs`
borrows the newest non-expired row from the `sessions` table and sets it as the
`dotcontent_session` cookie on `localhost`, which the browser sends to both ports,
so there is no password to type. If it prints "no live session in the database",
someone has to sign in through the UI once.

`npm run api:smoke` asks the API the same six questions without a browser —
public probe, refused without a cookie, refused with a forged one, answering
for a real session, and the CORS preflight. Point it elsewhere with `API_URL`.

## Asking the database directly

Faster than clicking through the UI when you only need a fact:

```bash
npm run db:shell    # psql inside the container
```

```sql
select email from users;
select count(*) from sessions where expires_at > now();
select id, topic, state from runs order by created_at desc limit 5;
```

## Driving it by hand

When a check needs real input events — a modifier-click, a keypress — attach to
the same Chrome over the DevTools Protocol and use `Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent`. **Synthetic `MouseEvent`s dispatched from JS cannot
prove browser behaviour**: an untrusted event does not perform the default
action, so a JS-dispatched ⌘-click never opens a tab and tells you nothing.

## What a screenshot cannot tell you

It shows the pixels, not the wiring. Pair it with:

- `npm run typecheck` for renames and types.
- `document.querySelectorAll(...)` counts through `eval` for "did every row get
  the link", "is the menu above the dialog".
- `getComputedStyle(el)` for the property you actually changed — z-index, font,
  line-height — instead of judging it by eye.
