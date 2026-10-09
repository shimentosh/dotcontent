<div align="center">

<a href="https://github.com/shimentosh/dotcontent"><img src="docs/assets/social-preview.png" alt="dotcontent, the open-source AI content generator for short-form video: scripts, captions, hooks, hashtags and YouTube SEO" width="100%"></a>

# dotcontent

### The open-source AI content generator for Reels, YouTube Shorts and TikTok

Turn one topic, website or video into a complete short-form content package:
**scripts, on-screen captions, hooks, social captions, hashtags and YouTube SEO**,
written in your brand voice by Claude, ChatGPT, Gemini or a local Ollama model.
Self-hosted, team-ready, MIT licensed.

[![License: MIT](https://img.shields.io/badge/license-MIT-0057fc.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org)
[![NestJS](https://img.shields.io/badge/NestJS-API-e0234e.svg?logo=nestjs&logoColor=white)](https://nestjs.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-4bb07a.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/shimentosh/dotcontent?style=social)](https://github.com/shimentosh/dotcontent/stargazers)

[**Quick start**](#quick-start) · [**Features**](#features) · [**Screenshots**](#screenshots) · [**How it works**](#how-it-works) · [**FAQ**](#faq) · [**Docs**](#documentation)

Built by [**dotmirror**](https://dotmirror.com)

</div>

---

## What is dotcontent?

**dotcontent** is a free, open-source, self-hosted app for producing short-form
video content with AI. You describe your content once, as a **template**: the
rules it follows and the sections it is made of. Then every **topic** becomes
a full set of ready-to-post copy in one click. A Reel, a YouTube Short or a
TikTok gets its script, captions, hook options, hashtags, titles and
description together, and every piece matches the same brand voice.

It is made for creators, social media managers and small content teams who
publish every day and are tired of pasting the same prompt into a chat window
twelve times.

## Features

### ✍️ One click, a whole content package
A template is a set of sections that run in order, and each one can read the
sections written before it. The template that ships, **Website Shorts**, writes
12 sections from a single website:

- an English and a Bangla **video script**
- **on-screen captions** and 10 spoken **hooks**
- 6 + 6 **social media captions**, with picks for Instagram, TikTok, Facebook and YouTube Shorts
- **hashtag sets**
- **YouTube SEO**: titles, a long description and tags
- a **CTA keyword** for comment-to-DM funnels

### 🧠 Use the AI you already pay for: Claude, ChatGPT, Gemini or Ollama
Sections are written by the `claude` (Claude Code), `codex` (ChatGPT) or
`gemini` CLI that is already signed in on your computer. They are billed to
your existing subscription, not per token. An Anthropic API key or a fully
local [Ollama](https://ollama.com) model works too. Each workspace picks its
own model.

### 🎬 Video to script
Paste a Reel, Short or TikTok link. The worker downloads it with **yt-dlp**,
cuts stills with **ffmpeg** and transcribes the audio with **whisper.cpp**, so
the first sections are written from what the video actually shows and says.

### 🗣️ Brand voice per workspace
One workspace per brand or client, each with its own voice, languages, goal and
model. Every section is written under the workspace voice, then the
template's purpose, then its rules. Multilingual output works out of the box:
the shipped template writes **English and Bangla (Banglish)**, and a template
can write in any language the model can.

### 🧩 Visual template builder
Build your own templates in three steps, without writing code: drag in
sections (script, hook, caption, title, description, CTA, research, plan),
write each one's instruction, set the order and dependencies. Export a
template as a `.template.json` file and import it on another console.

### 👥 Built for teams
The console runs on one server. The writing happens on teammates' own laptops,
which **claim jobs from a queue**. Close the tab and the run carries on. If a
laptop goes to sleep, another machine picks its job up. Invite teammates by link,
and manage machines and tokens in Settings. An optional **Windows desktop app**
bundles the console window and a worker.

### 🔒 Self-hosted and private
Your topics, prompts and content stay in your own Postgres. API keys are
encrypted with AES-256-GCM. Deploy with Docker Compose (Traefik and Let's
Encrypt included) or [Dokploy](https://dokploy.com).

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/home.png" alt="dotcontent home dashboard showing the current brand workspace, topics, templates and content that needs review"><br><sub><b>Home:</b> the current workspace and what is waiting on you</sub></td>
    <td width="50%"><img src="docs/assets/template.png" alt="Website Shorts template with 12 AI sections: website research, hashtags, English script, captions and YouTube SEO"><br><sub><b>Template:</b> 12 sections, each with its own instruction and model tier</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/builder.png" alt="Drag-and-drop AI template builder for scripts, hooks, captions, titles, descriptions and CTAs"><br><sub><b>Builder:</b> drag in sections and write their instructions</sub></td>
    <td width="50%"><img src="docs/assets/content.png" alt="Content list of topics grouped by series and template, each ready to run"><br><sub><b>Content:</b> topics grouped by series, one click to run</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/assets/integrations.png" alt="Integrations page listing Claude, ChatGPT, Gemini and Ollama and how each model is reached"><br><sub><b>Integrations:</b> Claude, ChatGPT, Gemini and Ollama, each probed live on the machines that run them</sub></td>
  </tr>
</table>

## Quick start

You need:

| | |
|---|---|
| **Node.js 24** | Check with `node --version`. The worker runs TypeScript directly, which needs Node 22.18 or newer. |
| **Docker** | For Postgres. Docker Desktop on Windows and macOS. |
| **A model** | At least one of: [Claude Code](https://claude.com/claude-code) (`claude`), the Codex CLI (`codex`) or the Gemini CLI (`gemini`), signed in. Or an Anthropic API key, or [Ollama](https://ollama.com). |
| **bash** | `start.sh` is a bash script. On Windows, use Git Bash. |

```bash
git clone https://github.com/shimentosh/dotcontent.git
cd dotcontent
cp .env.example .env
./start.sh
```

`start.sh` installs the dependencies, starts Postgres in Docker (port 5437),
the API on <http://localhost:4000> and the console on <http://localhost:3333>.

1. **Open <http://localhost:3333> and sign up.** The first account becomes the
   owner, and after that sign-up closes. Invite the rest of the team from
   Settings.
2. **Add this computer as a machine.** Go to **Settings → Machines**, add one and
   copy the token (it is shown once). Put it in `.env`:

   ```bash
   DOTCONTENT_WORKER_TOKEN=wrk_…
   ```

   Stop `start.sh` (Ctrl+C) and run it again. It starts a worker as well.
3. **Check your model.** **Integrations** shows each CLI and tool the machine
   can reach. **Test** sends a real one-line prompt.
4. **Optional, for video:** `npm run worker:setup` downloads pinned,
   checksummed yt-dlp, ffmpeg and whisper.cpp into `.data/tools`. It does not
   touch your PATH or need admin rights.
5. **Create.** Set your brand voice in **Workspaces**, add a topic in
   **Content**, and press **Run**.

The empty database is seeded with sample workspaces so every screen has
something in it. Delete them whenever you like.

## How it works

```
 browser ──► console (Next.js, :3333)
    │
    └──────► API (NestJS, :4000) ──► Postgres
                ▲
                │  HTTPS: claim a job, post the result
                │
           worker(s) on your team's machines
           └─ runs claude / codex / gemini / ollama, yt-dlp, ffmpeg, whisper
```

1. **Press Run.** The API queues one job for each section whose inputs are ready.
2. **A worker claims it.** The worker runs the model CLI on its own machine,
   with that machine's login, and posts the finished text back.
3. **The next sections are queued.** A section that depends on the script waits
   for the script. A failed section costs only that section, and you can
   rewrite it on its own.
4. **Read, edit, copy, download.** The reader groups sections into the
   deliverables the template declares: the script, the captions, the SEO.

The screens say *Template* where the code says `pack`, and *Machine* where it
says `worker`.

## Use cases

- **Faceless and tutorial channels:** one tool or website a day, turned into a
  Short, a Reel and a TikTok with matching captions.
- **Agencies and social media managers:** one workspace per client, each with
  its own brand voice and approval flow.
- **Bilingual creators:** English and Bangla (or any other pair) written as
  natural adaptations, not word-for-word translations.
- **Teams on AI subscriptions:** share the work across everyone's Claude,
  ChatGPT or Gemini plan instead of paying per token.

## Deploying for a team

`docker-compose.prod.yml` runs Postgres, the API, the console and Traefik with
Let's Encrypt. `docker-compose.dokploy.yml` is the same app for Dokploy. Start
from `.env.production.example`. A server has no signed-in CLI, so either set
`ANTHROPIC_API_KEY` or leave the writing to your teammates' machines.
[docs/DEPLOYING.md](docs/DEPLOYING.md) has every step.

## FAQ

<details>
<summary><b>Is dotcontent free?</b></summary>

Yes. dotcontent is open source under the MIT License: free to use, change and
self-host, including commercially. You pay only for the model you choose, and
with a CLI you already subscribe to there is no extra cost.
</details>

<details>
<summary><b>Do I need an OpenAI or Anthropic API key?</b></summary>

No. By default sections are written by the `claude`, `codex` or `gemini` CLI
signed in on a teammate's computer. An API key is optional. It is useful on a
server, or as a fallback when no machine is awake, and that fallback is off
until you turn it on.
</details>

<details>
<summary><b>Can I run it fully offline with a local model?</b></summary>

Yes. Point a workspace at [Ollama](https://ollama.com) and the whole pipeline,
including whisper.cpp transcription, runs on your own hardware.
</details>

<details>
<summary><b>Which languages does it support?</b></summary>

Templates are plain instructions, so a template can write in any language the
model writes well. The template that ships writes English and Bangla.
Each workspace records which languages it publishes in.
</details>

<details>
<summary><b>Can I write my own templates?</b></summary>

Yes. Use the builder to start from scratch, or open the shipped template and
change it. Templates can be exported and imported as JSON files, so a team can
share them.
</details>

<details>
<summary><b>Does it post to Instagram, TikTok or YouTube for me?</b></summary>

Not yet. dotcontent writes the content (scripts, captions, hashtags and SEO)
and you publish it with the tools you already use.
</details>

## Documentation

| | |
|---|---|
| [How it works](docs/HOW-IT-WORKS.md) | The longer tour: the data model, sign-in, keys, templates and video ingest |
| [Architecture](docs/ARCHITECTURE.md) | What lives where, the routes, and the data flows |
| [Worker](docs/WORKER.md) | The job queue, leases, machine tokens and the desktop app |
| [Developing](docs/DEVELOPING.md) | Running it, checking it, and the traps |
| [Deploying](docs/DEPLOYING.md) | Putting it on a server for a team (Docker Compose or Dokploy) |
| [Decisions](docs/DECISIONS.md) | Calls already made, and why |

## Project layout

```
app/          one page per route (Next.js App Router)
components/   the screens; components/ui is the UI kit every screen is built from
lib/          client state, theme and templates; lib/server touches the database
api/          the NestJS API, sharing lib/server with the root
worker/       the sidecar on a teammate's machine. It has no database.
src-tauri/    the optional Windows desktop app: the console plus a worker
tests/        vitest, pure functions only
docs/         the design, written down
```

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md),
then run the checks before you open a pull request:

```bash
npm run check   # typecheck, lint, tests, and the API's typecheck
```

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security
problems privately, as described in [SECURITY.md](SECURITY.md).

### Upgrading from Content OS

dotcontent used to be called *Content OS*. Every environment variable is now
`DOTCONTENT_*`. The old `CONTENTOS_*` names are still read when the new one is
not set, so existing `.env` files and deployments keep working. The Postgres
role, database and volume keep the name `contentos`, because renaming stored
data needs a migration, not a find-and-replace.

## License

[MIT](LICENSE) © [dotmirror](https://dotmirror.com)

<div align="center">
<sub>If dotcontent saves you time, a ⭐ on GitHub helps other creators find it.</sub>
</div>
