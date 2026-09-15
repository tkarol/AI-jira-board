# 🗂️ AI Jira Board

A dead-simple Kanban / to-do board for everything — business and personal.

Two ways to use it, sharing **one source of truth**:

1. **The web app** — quickly add a todo, write a description, set priority, and
   drag cards between columns.
2. **Your AI** (e.g. Hermes) — reads and edits the same board and can add, move,
   re-prioritise, or clean up cards for you.

The whole board lives in **one file: [`board.json`](./board.json), stored in this
GitHub repo**. When deployed, the web app saves by committing to the repo, so the
app and your AI always see the same board. No separate database.

---

## Run it locally

No dependencies to install — the dev server is plain Node.

```bash
npm start          # or: node server.js  ->  http://localhost:3000
```

By default local dev reads/writes `./board.json` **on disk** (offline, no token
needed). To make local dev use the *same* GitHub-backed data as production, copy
`.env.example` to `.env`, fill it in, and the server will switch automatically.

Run the tests with `npm test`.

---

## Deploy to Vercel (recommended)

This is what makes the web app and your AI share one board.

### 1. Create a GitHub token for the app

Create a **fine-grained Personal Access Token** (GitHub → Settings → Developer
settings → Fine-grained tokens):

- **Repository access:** only this repo (`tkarol/ai-jira-board`).
- **Permissions:** **Contents → Read and write**.

Copy the token (starts with `github_pat_`).

### 2. (Recommended) Create a data branch

Keep the board's save-commits off your code history by giving the data its own
branch:

```bash
git branch board-data
git push -u origin board-data
```

If you skip this, leave `GITHUB_DATA_BRANCH` unset and saves go to the branch you
deploy from.

### 3. Import the repo into Vercel

- Go to [vercel.com/new](https://vercel.com/new) and import this repo.
- Framework preset: **Other** (no build step needed).
- Add these **Environment Variables**:

  | Name                 | Value                               |
  | -------------------- | ----------------------------------- |
  | `GITHUB_TOKEN`       | the `github_pat_…` token from step 1 |
  | `GITHUB_OWNER`       | `tkarol`                            |
  | `GITHUB_REPO`        | `ai-jira-board`                     |
  | `GITHUB_DATA_BRANCH` | `board-data` (from step 2)          |

- Click **Deploy**. Your board is live at the Vercel URL.

That's it. Every add / edit / move in the web app commits to `board.json` on the
`board-data` branch.

> **Note:** the app has no login. Anyone with the URL can edit the board. For a
> private personal tool, enable **Vercel Authentication** (Project → Settings →
> Deployment Protection) so only you can open it.

---

## What you can do in the web app

- **+ Add todo** (top right) or **+ Add a card** in any column.
- **Click a card** to edit its title, description, category, priority, or column;
  delete it from the same dialog.
- **Drag cards** between columns and reorder them.
- **Filter** by All / Business / Personal.

---

## How your AI manages the board

Because the board is just `board.json` in this repo, an AI agent with **repo
access** can manage it directly — no extra credentials, no database access. The
schema and editing rules live in [`CLAUDE.md`](./CLAUDE.md). Ask things like:

- "Add a high-priority business task to call the accountant."
- "Move the 'renew passport' card to In Progress."
- "Clean up Done — archive anything finished over a month ago."
- "What's on my plate for business this week?"

Your AI edits `board.json` on the **`board-data`** branch (the same branch the web
app writes to). It can also drive the deployed REST API instead (see below).

---

## 📣 Social media planner

A second view (top nav → **Planner**) for planning social posts across
**X / Twitter, Instagram, and Facebook**, with a photo library. Its data lives in
`planner.json` on the same data branch as the board.

**The approval gate is the whole point:** Hermes can *draft and schedule* posts,
but they sit in **Needs approval** until *you* hit Approve. Nothing can be marked
approved/scheduled through the normal edit path — only the Approve action (a human
action) can. So your AI can do all the work and you keep the final say.

Flow: `Draft → Needs approval → Approved / Scheduled → Posted`.

- **New post** — write text, pick platforms, attach photos, set a schedule time.
- **Photos tab** — upload images (auto-resized) to your photo library; Hermes can
  reference them in posts. Photos are stored in **Vercel Blob**, not the repo.
- **Accounts tab** — set the handle you post as (metadata only).

### Setup for photos (Vercel Blob)

1. In your Vercel project → **Storage** → create a **Blob** store and connect it.
   Vercel injects `BLOB_READ_WRITE_TOKEN` automatically.
2. Redeploy. Uploads now go to Blob. (Locally with no token, uploads fall back to
   a `./uploads` folder so dev still works.)

This adds one dependency (`@vercel/blob`), so a deploy now runs `npm install`
(Vercel does this automatically). Local `node server.js` still runs without
installing — photos just use the local fallback.

### Publishing engine — the next step

Actually auto-posting to the platforms is **not wired up yet** (by design — we
chose "planner + photos now, wire posting later"). When you're ready, we plug in a
publishing provider (an aggregator like Ayrshare, self-hosted Postiz/Mixpost, or
per-platform APIs). Its credentials go in **server-side env vars only** — never in
the repo. Until then, approved posts are your queue: hit **Mark posted** once you
publish, or we automate it.

## REST API

| Method   | Path              | Body                                             |
| -------- | ----------------- | ------------------------------------------------ |
| `GET`    | `/api/board`      | —                                                |
| `POST`   | `/api/tasks`      | `{ title, description?, column?, category?, priority? }` |
| `PATCH`  | `/api/tasks/:id`  | any subset of the task fields                    |
| `DELETE` | `/api/tasks/:id`  | —                                                |
| `POST`   | `/api/reorder`    | `{ updates: [{ id, column, order }] }`           |
| `GET`    | `/api/planner`    | — (accounts, media, posts)                       |
| `POST`   | `/api/posts`      | `{ content, platforms, mediaIds?, scheduledAt?, status? }` |
| `PATCH`  | `/api/posts/:id`  | edit a draft/needs_approval post                 |
| `POST`   | `/api/posts/:id/approve` · `/revert` · `/posted` | approval actions (human) |
| `GET/POST` | `/api/media`    | list / upload `{ filename, contentType, dataBase64 }` |
| `DELETE` | `/api/media/:id`  | —                                                |
| `PATCH`  | `/api/accounts/:id` | `{ handle?, connected? }`                       |

---

## Data model (quick reference)

```jsonc
{
  "meta":    { "title": "My Board", "version": 1 },
  "columns": [ { "id": "todo", "name": "To Do" }, ... ],
  "tasks": [
    {
      "id": "t_ab12cd34ef56",     // unique, starts with "t_"
      "title": "Call the bank",
      "description": "Ask about the wire transfer",
      "column": "todo",           // must match a column id
      "category": "business",     // "business" | "personal"
      "priority": "high",         // "low" | "medium" | "high"
      "order": 0,                 // position within its column
      "createdAt": "2026-09-15T00:00:00.000Z",
      "updatedAt": "2026-09-15T00:00:00.000Z"
    }
  ]
}
```

See [`CLAUDE.md`](./CLAUDE.md) for the full contract.

---

## How it fits together

```
              ┌──────────────┐         ┌──────────────┐
  You (web) ─▶│  Vercel app  │──commits│              │
              │ (api/*.js)   │────────▶│  board.json  │
  Your AI  ───────────────────────────▶│  in GitHub   │
  (repo access, edits board.json)      │   (repo)     │
              └──────────────┘         └──────────────┘
                     ▲                        │
                     └────────reads───────────┘
```
