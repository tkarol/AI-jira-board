# Managing this board

This project is a personal Kanban / to-do board. The **entire board is stored in
`board.json`** in this repo. That file is the single source of truth for both the
web app and you (the AI). When the user asks you to track, add, move,
re-prioritise, or clean up tasks, you do it by **editing `board.json`**.

## Where the live data lives (important)

The deployed web app (on Vercel) saves the board by **committing `board.json` to
the `board-data` branch** via the GitHub API. So:

- **The live board is `board.json` on the `board-data` branch.** Read and edit it
  there — not on a code/feature branch — so your changes and the web app's stay in
  sync. (If the project is configured to use a different branch, it's whatever
  `GITHUB_DATA_BRANCH` is set to; default is `board-data`.)
- Commit your edits straight to that branch with a clear message. The web app will
  pick them up on its next read, and vice versa.
- Alternatively, you can drive the deployed REST API (see the end of this file)
  instead of committing — either works, since both operate on the same file.
- If you're running against a **local checkout with no GitHub token**, the dev
  server reads/writes the local `board.json` file instead; edit that file.

## The data model

`board.json` has three top-level keys:

```jsonc
{
  "meta":    { "title": "My Board", "version": 1 },
  "columns": [ { "id": "todo", "name": "To Do" }, ... ],
  "tasks":   [ /* task objects */ ]
}
```

### Task object

| Field         | Type   | Rules                                                        |
| ------------- | ------ | ----------------------------------------------------------- |
| `id`          | string | Unique. Prefix `t_` + short random hex, e.g. `t_9f3a1c`.    |
| `title`       | string | Required, non-empty.                                        |
| `description` | string | May be empty `""`.                                          |
| `column`      | string | Must equal one of the `columns[].id` values.               |
| `category`    | string | Exactly `"business"` or `"personal"`.                       |
| `priority`    | string | Exactly `"low"`, `"medium"`, or `"high"`.                   |
| `order`       | number | Position within its column; lower = higher up. 0-based.     |
| `createdAt`   | string | ISO 8601 timestamp. Set once, never change it.             |
| `updatedAt`   | string | ISO 8601 timestamp. Update whenever you change the task.    |

## Rules when editing `board.json`

1. **Keep it valid JSON.** Two-space indentation, trailing newline. If it doesn't
   parse, the app breaks.
2. **Never invent a `column` value** that isn't in the `columns` array. To move a
   card, change its `column` to a valid column `id`.
3. **`id` is stable.** Never change an existing task's `id`. Generate new unique
   ids for new tasks (`t_` + 6 hex chars is fine).
4. **Timestamps:** set both `createdAt` and `updatedAt` on new tasks; bump only
   `updatedAt` on edits. Use full ISO 8601 (`new Date().toISOString()` format).
5. **Ordering:** when adding a task, give it an `order` one higher than the
   current max in its target column (or 0 if empty). When you reorder, keep
   `order` values sensible (0,1,2,…) within each column.
6. **Categories & priorities are closed sets** — don't introduce new values;
   the web UI only understands the ones above.
7. **Prefer small, surgical edits.** Change only the fields you need to.
8. **Don't delete history silently.** If the user asks to "clear" or "archive"
   Done cards, confirm first, or move them rather than delete, unless they were
   explicit about deletion.

## Common operations

- **Add a task:** append a new task object to `tasks` with a fresh id, the right
  `column`, category, priority, `order = max+1`, and both timestamps.
- **Move a card:** change its `column` (and optionally `order`), bump `updatedAt`.
- **Re-prioritise:** change `priority`, bump `updatedAt`.
- **Complete a task:** set `column` to the "Done" column's id.
- **Edit details:** change `title`/`description`, bump `updatedAt`.

## After editing

Commit your `board.json` change to the **`board-data`** branch (the branch the web
app reads and writes) with a clear message, e.g.
`board: add 3 business tasks, move passport renewal to In Progress`. Do not open a
PR for board-data changes — commit directly; this is data, not code.

You can also drive the same changes through the deployed/running server's REST API
(`GET /api/board`, `POST /api/tasks`, `PATCH /api/tasks/:id`,
`DELETE /api/tasks/:id`, `POST /api/reorder { updates: [{id, column, order}] }`) —
either approach works, since both operate on the same `board.json`.

## Code vs. data

Application code (server.js, lib/, api/, public/) is separate from the board data.
Change code on a normal feature branch/PR; change the board by committing
`board.json` to the data branch. Don't mix the two in one commit.

---

# Social media planner (`planner.json`)

A second feature: a social media planner. Its data lives in **`planner.json`** on
the **same data branch** as `board.json`. It has three parts:

```jsonc
{
  "meta":     { "version": 1 },
  "accounts": [ { "id": "acc_twitter", "platform": "twitter", "handle": "@me", "connected": false }, ... ],
  "media":    [ { "id": "m_x", "url": "https://…", "filename": "beach.jpg", "caption": "" }, ... ],
  "posts":    [ /* post objects */ ]
}
```

### Post object

| Field         | Type     | Rules                                                                 |
| ------------- | -------- | --------------------------------------------------------------------- |
| `id`          | string   | Unique, `p_` + hex.                                                    |
| `content`     | string   | The post text.                                                        |
| `platforms`   | string[] | Subset of `["twitter","instagram","facebook"]`.                       |
| `mediaIds`    | string[] | Must reference existing `media[].id` — never invent one.              |
| `scheduledAt` | string?  | ISO 8601, or `null`.                                                   |
| `status`      | string   | `draft` → `needs_approval` → `approved`/`scheduled` → `posted` (or `failed`). |
| `createdBy`   | string   | `"you"`, `"hermes"`, or `"system"`. Set `"hermes"` for posts you draft. |
| `notes`       | string   | Internal note, never published.                                       |
| `approvedAt` / `postedAt` / `results` | —      | Set by the approval / posting flow, not by you.        |

## 🔴 The approval rule (do not break this)

**Nothing publishes without the user's explicit approval.** So:

- ✅ You MAY: create posts (as `draft` or `needs_approval`), edit `content`,
  `platforms`, `mediaIds`, `scheduledAt`, and `notes` of posts that are still
  `draft`/`needs_approval`, and attach **existing** media.
- ✅ When you draft a post for the user, set `createdBy: "hermes"` and put it in
  `needs_approval` so it shows up in their approval queue.
- ⛔ You MUST NOT set a post's `status` to `approved`, `scheduled`, or `posted`.
  Those transitions are the **user's** action (the Approve / Mark-posted buttons,
  or the `POST /api/posts/:id/approve` endpoint which represents the user).
  Committing such a status change to `planner.json` yourself defeats the whole
  point of the gate — don't.
- ⛔ Do not edit a post that is already `approved`/`scheduled`/`posted`. If a
  change is needed, ask the user to revert it to draft first.

## 🔑 Secrets rule

**Never put social account tokens, API keys, or passwords in the repo** — not in
`planner.json`, not anywhere committed. Those live only in server-side env vars
(configured on Vercel). `accounts[]` holds display metadata (handle, connected
flag) only. Photos: reference existing `media[].url`; never paste image bytes or
data URLs into the repo.

## Common planner operations

- **Draft a post for approval:** append a post with `status: "needs_approval"`,
  `createdBy: "hermes"`, chosen `platforms`, optional `mediaIds`/`scheduledAt`.
- **Revise a draft:** edit its fields while it's `draft`/`needs_approval`.
- **Reference a photo:** use an existing `media[].id`; the user uploads photos in
  the web app's Photos tab (they go to blob storage, not the repo).

Commit planner changes to the **data branch** with a clear message, e.g.
`planner: draft 3 launch posts for approval`. Or use the REST API:
`GET /api/planner`, `POST /api/posts`, `PATCH /api/posts/:id`,
`DELETE /api/posts/:id`, `POST /api/posts/:id/{approve|revert|posted}`,
`GET/POST /api/media`, `PATCH/DELETE /api/media/:id`, `PATCH /api/accounts/:id`.
