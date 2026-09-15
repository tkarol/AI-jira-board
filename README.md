# 🗂️ AI Jira Board + Social Planner

A personal **Kanban to-do board** and **social media planner** (with a short-form
**Content Studio**) that are controlled two ways at once:

1. **A web app** — you add todos, drag cards, plan posts, upload photos, and shoot
   short-form video with a step-by-step teleprompter.
2. **An AI agent** (Hermes) — reads and edits the exact same data with nothing but
   **repo access**, because the whole app is backed by JSON files in this Git repo.

There is **no database and no build step.** The data lives in two JSON files
(`board.json`, `planner.json`) committed to a Git branch; the app is plain Node +
static HTML/CSS/JS.

> **If you are an AI agent working this repo:** read
> [`CLAUDE.md`](./CLAUDE.md) — it is the operational contract (schemas, the
> approval gate, the secrets rule, which branch to commit to). This README is the
> architecture + reference. `CLAUDE.md` wins on any "how do I edit the data"
> question.

---

## Table of contents

- [The core idea](#the-core-idea-repo-as-database)
- [Architecture at a glance](#architecture-at-a-glance)
- [Repository layout](#repository-layout)
- [Branch model — code vs. data](#branch-model--code-vs-data)
- [Data model](#data-model)
  - [board.json](#boardjson-the-kanban-board)
  - [planner.json](#plannerjson-the-social-planner--studio)
- [The two golden rules](#the-two-golden-rules)
- [Run it locally](#run-it-locally)
- [Deploy to Vercel](#deploy-to-vercel)
- [Environment variables](#environment-variables)
- [REST API reference](#rest-api-reference)
- [How the web app is built](#how-the-web-app-is-built)
- [How an AI agent operates it](#how-an-ai-agent-hermes-operates-it)
- [Testing](#testing)
- [Design decisions & constraints](#design-decisions--constraints)

---

## The core idea: repo-as-database

The **GitHub repo is the database.** Both editors operate on the same two JSON
files, so they can never drift:

- The **deployed web app** reads/writes the files through the **GitHub Contents
  API** (each save is a commit).
- **Hermes** reads/writes the same files directly (commit to the branch, or call
  the REST API).

Because the data is just files in the repo, an agent needs **only repo access** —
no database credentials, no separate service.

```
        ┌──────────────┐    commits (GitHub API)    ┌────────────────────┐
  You → │  Web app      │ ─────────────────────────▶ │  board.json        │
        │  (on Vercel)  │ ◀───────────────────────── │  planner.json      │
        └──────────────┘        reads                │  on the DATA branch │
                                                      │  (default: board-data)
  Hermes ─── commits / REST API ─────────────────────▶│  (a Git branch)     │
        (repo access only)                            └────────────────────┘
```

---

## Architecture at a glance

| Layer | What it is | Files |
| ----- | ---------- | ----- |
| **Data** | Two JSON documents = the entire app state | `board.json`, `planner.json` |
| **Domain** | Pure functions that validate + mutate a document (no I/O) | `lib/board.js`, `lib/planner.js` |
| **Persistence** | Reads/writes a document via GitHub API *or* local file | `lib/store.js`, `lib/media.js` |
| **Handlers** | Request-level operations returning `{ status, json }` | `lib/handlers.js`, `lib/planner-handlers.js` |
| **Transport (prod)** | One Vercel serverless function routing all `/api/*` | `api/[...path].js` |
| **Transport (dev)** | Local Node HTTP server, same handlers | `server.js` |
| **Web UI** | Static HTML/CSS/JS (no framework, no build) | `public/*` |

The domain and handler layers are shared by **both** transports, so the local dev
server and the deployed function behave identically.

---

## Repository layout

```
.
├── board.json            # DATA: the Kanban board (source of truth on the data branch)
├── planner.json          # DATA: social posts, media metadata, accounts, content ideas
│
├── server.js             # Local dev server (node server.js). Serves public/ + /api/* + /uploads
├── vercel.json           # Vercel config (framework:null, rewrite "/" -> index.html)
├── package.json          # scripts: start, test. One dep: @vercel/blob (photos only)
├── .env.example          # All environment variables, documented
│
├── api/
│   └── [...path].js      # THE ONLY serverless function: routes every /api/* request
│
├── lib/
│   ├── board.js          # Board domain: task create/update/delete/reorder, categories
│   ├── planner.js        # Planner domain: posts, media, accounts, ideas, approval gate
│   ├── store.js          # createStore(): GitHub-API backend or local-file backend
│   ├── media.js          # Photo blobs: Vercel Blob or local ./uploads
│   ├── handlers.js       # Board request handlers (bound to a board store)
│   ├── planner-handlers.js # Planner/media/idea request handlers (bound to a planner store)
│   └── vercel.js         # Tiny helpers for the serverless function (readBody, ok, fail)
│
├── public/
│   ├── index.html        # Board page
│   ├── app.js            # Board UI: columns, cards, quick-add, drag/drop, move buttons,
│   │                     #   swipe-to-move, collapsible columns, category filters
│   ├── planner.html      # Planner page
│   ├── planner.js        # Planner UI: calendar, queue, composer+preview, photos,
│   │                     #   accounts, Content Studio, record-mode teleprompter
│   └── styles.css        # All styling (light + dark, responsive, mobile-first board)
│
├── test/smoke.js         # Domain + serialization tests (npm test)
├── CLAUDE.md             # AI-agent operational contract (READ THIS if you're the agent)
└── README.md             # This file
```

---

## Branch model — code vs. data

Two branches, two jobs. **They never git-merge into each other.**

- **`main`** — the application **code**. Vercel deploys this branch.
- **`board-data`** (the *data branch*) — the live **data** (`board.json`,
  `planner.json`). The deployed app reads/writes here at runtime.

The deployed code (from `main`) is told which branch holds the data via the
`GITHUB_DATA_BRANCH` env var (`board-data`). At runtime it calls, e.g.:

```
GET  https://api.github.com/repos/<owner>/<repo>/contents/board.json?ref=board-data
PUT  https://api.github.com/repos/<owner>/<repo>/contents/board.json   (a commit)
```

**Both branches contain copies of `board.json`/`planner.json`:**
- On `main` they are just the committed **seed/defaults** (shipped with the code).
- On `board-data` they are the **real, live data**. The app only ever touches the
  `board-data` copies (because of the env var); the seeds on `main` are ignored in
  production.

**Rule of thumb:** change *code* on `main` (PR/commit). Change *data* by committing
`board.json`/`planner.json` on `board-data`. Never mix code and data in one commit.

---

## Data model

### `board.json` (the Kanban board)

```jsonc
{
  "meta":    { "title": "My Board", "version": 1 },
  "columns": [
    { "id": "backlog", "name": "Backlog" },
    { "id": "todo", "name": "To Do" },
    { "id": "in_progress", "name": "In Progress" },
    { "id": "done", "name": "Done" }
  ],
  "tasks": [
    {
      "id": "t_ab12cd34ef56",     // unique, "t_" + hex; never change an existing id
      "title": "Call the accountant",
      "description": "",           // may be empty
      "column": "todo",            // must equal one of columns[].id
      "category": "birdie_bus",    // "birdie_bus" | "booz_allen" | "personal"
      "priority": "high",          // "low" | "medium" | "high"
      "order": 0,                  // position within its column (0-based, lower = higher)
      "createdAt": "2026-09-15T00:00:00.000Z",
      "updatedAt": "2026-09-15T00:00:00.000Z"
    }
  ]
}
```

- **Categories** (closed set): `birdie_bus`, `booz_allen`, `personal`
  (display labels: *Birdie Bus*, *Booz Allen*, *Personal*). Filter chips + the
  category dropdowns are generated from this set; to rename/add, edit both
  `lib/board.js` `VALID_CATEGORIES` and `public/app.js` `CATEGORIES`.
- **Priorities** (closed set): `low`, `medium`, `high`.
- **Columns** are editable in `board.json` (`columns[]`); the UI adapts.

### `planner.json` (the social planner + Studio)

Four sections: `accounts`, `media`, `posts`, `ideas`.

```jsonc
{
  "meta": { "version": 1 },

  // Display metadata only — NO tokens ever live here.
  "accounts": [
    { "id": "acc_twitter", "platform": "twitter", "handle": "@me", "displayName": "X / Twitter", "connected": false }
    // + instagram, facebook, tiktok, youtube
  ],

  // Photo metadata. Bytes live in Vercel Blob; the repo only holds the URL.
  "media": [
    { "id": "m_x", "url": "https://…blob…/uploads/xyz.jpg", "pathname": "uploads/xyz.jpg",
      "filename": "beach.jpg", "contentType": "image/jpeg", "size": 12345,
      "width": 2048, "height": 1365, "caption": "", "uploadedAt": "…" }
  ],

  // Scheduled/queued posts (go through the approval gate).
  "posts": [
    {
      "id": "p_x",
      "content": "Post text",
      "platforms": ["twitter", "instagram"],   // subset of the 5 platforms below
      "mediaIds": ["m_x"],                       // must reference existing media[].id
      "scheduledAt": "2026-09-20T15:00:00.000Z", // ISO or null
      "status": "needs_approval",                // see status flow below
      "createdBy": "hermes",                     // "you" | "hermes" | "system"
      "notes": "",
      "approvedAt": null, "postedAt": null, "results": {},
      "createdAt": "…", "updatedAt": "…"
    }
  ],

  // Content Studio: shootable short-form video briefs.
  "ideas": [
    {
      "id": "idea_x",
      "title": "3 things nobody tells you",
      "hook": "The scroll-stopping first line",
      "concept": "The angle/story in a sentence or two",
      "platforms": ["tiktok", "instagram", "youtube"],
      "shots": [
        { "id": "s1",
          "angle": "Talking head, phone at eye level, window light",
          "action": "Deliver the hook straight to camera",
          "say": "The EXACT words to speak over this clip (the talk track)",
          "seconds": 4 }
      ],
      "caption": "The post caption",
      "hashtags": ["#tag1", "#tag2"],
      "status": "idea",         // idea → to_record → recorded → edited → posted
      "createdBy": "hermes",
      "postId": null,           // set when the idea is turned into a post
      "createdAt": "…", "updatedAt": "…"
    }
  ]
}
```

- **Platforms** (closed set): `twitter` (shown as **X**), `instagram`,
  `facebook`, `tiktok`, `youtube`.
- **Post status flow:** `draft → needs_approval → approved`/`scheduled → posted`
  (or `failed`). A post is `scheduled` when approved *with* a `scheduledAt`,
  otherwise `approved`.
- **Idea status flow:** `idea → to_record → recorded → edited → posted`.

---

## The two golden rules

These are enforced in code and restated for agents in `CLAUDE.md`.

### 🔴 1. The approval gate (nothing posts without the human)

Hermes may **create and edit** posts while they are `draft`/`needs_approval`, and
should drop drafts into `needs_approval` for review. But **only the human** can
move a post to `approved`/`scheduled`/`posted` — via the web app's **Approve** /
**Mark posted** buttons, or `POST /api/posts/:id/approve`. The generic
`PATCH /api/posts/:id` **rejects** those status changes (HTTP 400), and an
approved post is **locked from editing** (HTTP 409) until reverted. Converting a
Studio idea to a post always produces a `draft`, never an approved post.

### 🔑 2. The secrets rule (never commit credentials)

Social account tokens / API keys / passwords **never** go in the repo — not in
`planner.json`, not anywhere committed. They live only as **server-side
environment variables** on Vercel. `accounts[]` holds display metadata (handle,
connected flag) only. Photo **bytes** never go in the repo either — they go to
Vercel Blob, and only the URL is stored.

---

## Run it locally

No install needed for the core app (the one dependency, `@vercel/blob`, is only
used for photos and is lazily required):

```bash
npm start          # or: node server.js   →   http://localhost:3000
PORT=8080 npm start
npm test           # run the smoke tests
```

**Persistence is chosen automatically** (`lib/store.js`):

- **No GitHub env vars** → reads/writes `./board.json` and `./planner.json` on
  local disk (offline dev). Uploaded photos go to `./uploads` (git-ignored).
- **GitHub env vars set** (copy `.env.example` → `.env`) → local dev uses the same
  GitHub-backed data as production.

---

## Deploy to Vercel

1. **Create the data branch** (once): `git branch board-data main && git push -u origin board-data`.
2. **GitHub token:** a fine-grained PAT scoped to this repo with **Contents:
   Read and write**.
3. **Import the repo** at [vercel.com/new](https://vercel.com/new); framework
   preset **Other** (no build command). **Production branch must be `main`.**
4. **Set env vars** (below) and deploy.
5. **Photos:** Vercel → **Storage → create a Blob store** and connect it; it
   injects `BLOB_READ_WRITE_TOKEN`. Redeploy.
6. **Privacy:** the app has no login. Turn on **Vercel Authentication**
   (Settings → Deployment Protection) so only you can open it.

Every add/edit/move/upload then commits to the `board-data` branch (photos to
Blob).

---

## Environment variables

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `GITHUB_TOKEN` | for prod | Fine-grained PAT, **Contents: Read and write** on this repo. Enables the GitHub-backed store. |
| `GITHUB_OWNER` | for prod | Repo owner, e.g. `tkarol`. |
| `GITHUB_REPO` | for prod | Repo name, e.g. `AI-jira-board`. |
| `GITHUB_DATA_BRANCH` | recommended | Branch holding the data (default `board-data`; falls back to the deployed branch if unset). |
| `GITHUB_BOARD_PATH` | optional | Path to the board file (default `board.json`). |
| `GITHUB_PLANNER_PATH` | optional | Path to the planner file (default `planner.json`). |
| `BLOB_READ_WRITE_TOKEN` | for photos | Vercel Blob store token (auto-injected when a Blob store is connected). Without it, uploads use local `./uploads`. |

If `GITHUB_TOKEN`/`OWNER`/`REPO` are **all** set, the app uses the GitHub backend;
otherwise it uses the local-file backend. Never commit real values — use `.env`
locally (git-ignored) and Vercel env vars in production.

---

## REST API reference

All endpoints are served by the single function `api/[...path].js` in production,
and by `server.js` in local dev. Bodies and responses are JSON.

**Board**

| Method | Path | Body |
| ------ | ---- | ---- |
| `GET`    | `/api/board`     | — → the whole board |
| `POST`   | `/api/tasks`     | `{ title, description?, column?, category?, priority? }` |
| `PATCH`  | `/api/tasks/:id` | any subset of task fields (incl. `column` to move) |
| `DELETE` | `/api/tasks/:id` | — |
| `POST`   | `/api/reorder`   | `{ updates: [{ id, column, order }] }` |

**Planner — posts / media / accounts**

| Method | Path | Body |
| ------ | ---- | ---- |
| `GET`    | `/api/planner`   | — → `{ meta, accounts, media, posts, ideas }` |
| `POST`   | `/api/posts`     | `{ content, platforms, mediaIds?, scheduledAt?, status?, createdBy? }` |
| `PATCH`  | `/api/posts/:id` | edit a `draft`/`needs_approval` post (cannot set approved/scheduled/posted) |
| `DELETE` | `/api/posts/:id` | — |
| `POST`   | `/api/posts/:id/approve` · `/revert` · `/posted` | **human** approval actions |
| `GET`    | `/api/media`     | — → `{ media: [...] }` |
| `POST`   | `/api/media`     | `{ filename, contentType, dataBase64, width?, height?, caption? }` (base64 upload) |
| `PATCH`  | `/api/media/:id` | `{ caption }` |
| `DELETE` | `/api/media/:id` | — (also detaches it from any posts) |
| `PATCH`  | `/api/accounts/:id` | `{ handle?, displayName?, connected? }` |

**Content Studio — ideas**

| Method | Path | Body |
| ------ | ---- | ---- |
| `POST`   | `/api/ideas`     | `{ title?, hook?, concept?, platforms?, shots?, caption?, hashtags?, status?, createdBy? }` |
| `PATCH`  | `/api/ideas/:id` | edit an idea / its shot list |
| `DELETE` | `/api/ideas/:id` | — |
| `POST`   | `/api/ideas/:id/convert` | create a linked **draft** post from the idea |
| `POST`   | `/api/ideas/:id/{to_record\|recorded\|edited\|posted\|idea}` | set the idea's status |

Errors return `{ "error": "…" }` with an appropriate HTTP status (400 validation,
404 not found, 409 conflict, 500 server).

---

## How the web app is built

Pure static HTML/CSS/JS in `public/` — **no framework, no bundler.** Two pages
that share `styles.css`:

- **Board** (`index.html` + `app.js`): columns generated from `board.json`;
  cards with category/priority pills; **quick-move buttons** under each card;
  **drag-and-drop** (desktop) and **swipe-to-move** (touch); **collapsible
  columns** (state saved in `localStorage`); a header **+** to quick-add; category
  filter chips. On phones (≤720px) columns stack vertically.
- **Planner** (`planner.html` + `planner.js`): tabs for **Calendar** (month grid,
  posts as chips on their day), **Queue** (grouped: Needs approval → Scheduled →
  Drafts → Posted), **Studio** (content ideas), **Photos** (upload → Blob;
  client-side resize to ≤2048px JPEG), **Accounts**. The composer is a two-pane
  modal with a **live per-platform preview**. **Record mode** is a full-screen
  teleprompter that steps through each idea's shots (angle + the words to say).

The UI talks only to the JSON REST API above; it holds no secrets.

---

## How an AI agent (Hermes) operates it

An agent with repo access can drive everything **two equivalent ways**:

1. **Edit the JSON files** on the `board-data` branch and commit
   (`board.json` / `planner.json`). This works even when nothing is running.
2. **Call the deployed REST API** (same effect; both hit the same files).

**Before editing, read [`CLAUDE.md`](./CLAUDE.md).** It specifies:
- the exact schemas and closed value-sets (categories, priorities, platforms);
- **commit data to the `board-data` branch**, not to `main`;
- the **approval gate** (never self-approve posts) and **secrets rule**;
- how to write great short-form **Content Studio** briefs (concrete shot lists +
  word-for-word talk tracks) — the agent is the "idea engine," since the app has
  no LLM of its own.

Typical asks: *"add a high-priority Booz Allen task to prep the QBR,"* *"move the
passport card to In Progress,"* *"draft 3 Birdie Bus TikTok ideas,"* *"queue this
week's posts for my approval."*

---

## Testing

```bash
npm test      # node test/smoke.js
```

`test/smoke.js` exercises the pure domain layer (no network): task
create/update/move/delete + validation; the planner **approval gate** (generic
edits can't approve; approved posts are edit-locked); media add/detach; and the
Studio (idea create with sanitization, status transitions, convert-to-post). The
serverless function's router is verified by hitting it with mock requests during
development.

---

## Design decisions & constraints

- **Repo-as-database** so the web app and an AI agent share one source of truth
  with only repo access. Trade-off: each web-app save is a Git commit (~1–2s);
  they land on `board-data` to keep `main`'s history clean.
- **One serverless function.** Vercel's Hobby plan caps a deployment at **12
  serverless functions**; every `api/*.js` file counts as one. All routes
  therefore go through a single catch-all, `api/[...path].js`, which parses the
  path from `req.url` and dispatches to the shared handlers.
- **No auth by default.** Use Vercel Deployment Protection for privacy.
- **Photos in Blob, not Git** — binaries bloat repos and Vercel can't write to a
  runtime filesystem. Only URLs + metadata are stored in `planner.json`.
- **Publishing is not wired up yet** (by design). The planner/Studio plan,
  approve, and track; actual auto-posting to platforms is a future step that
  plugs a provider in behind server-side env vars (e.g. an aggregator like
  Ayrshare, or per-platform APIs). Until then, "Mark posted" closes the loop.

---

_Attribution and commit conventions for AI edits are in `CLAUDE.md`._
