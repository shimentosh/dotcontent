# Contributing to dotcontent

Thanks for helping. dotcontent is an open-source AI content studio: templates
that turn a topic into blog posts, social posts, emails, scripts and more. Bug
reports, fixes, new templates and docs are all welcome.

## Ways to help

- **Report a bug.** [Open an issue](../../issues/new/choose) with the steps,
  what you expected and what happened. Paste the error, and say which
  operating system and which model CLI you use.
- **Suggest a feature.** Open an issue first, so we can agree on the shape
  before you write the code.
- **Share a template.** Export it from the builder (it saves as a
  `.template.json` file) and attach it to an issue or a discussion.
- **Improve the docs.** If a step in the README did not work for you, a fix to
  that step helps the next person most.

## Set up

Follow the [Quick start](README.md#quick-start), then:

```bash
npm run check        # typecheck, lint, tests, and the API's typecheck
npm run build:check  # a production build that does not disturb the dev server
```

Both must pass before a pull request is reviewed.
[docs/DEVELOPING.md](docs/DEVELOPING.md) covers the traps: ports, migrations,
the worker and hot reload.

## House rules

[AGENTS.md](AGENTS.md) has the full list. The ones that come up most:

- **Screens are built from the UI kit** in `components/ui` (`Page`, `Button`,
  `Select`, `Modal`, `ListPanel` and the rest). Do not write a native
  `<select>`, a hand-rolled button or a modal backdrop.
- **The worker has no database.** Files in `worker/` may import only
  `lib/server/tools.ts`, `brain-defs.ts` and `brain-transports.ts` from
  `lib/server`, and they use relative imports, not `@/`.
- **The server decides, the worker executes.** A job carries finished text and
  a command, never a template or the brand voice.
- **Read [docs/DECISIONS.md](docs/DECISIONS.md)** before you change something
  that looks wrong on purpose. It usually is.

## Pull requests

1. Fork the repo and make a branch from `main`.
2. Keep one change in each pull request. A rename and a feature are two.
3. Add or update tests in `tests/` when you change logic: a status, a slug, an
   import, a parser. Screens are not tested there.
4. Explain what changed and why in the description, and how you checked it.

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), and that you will follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
