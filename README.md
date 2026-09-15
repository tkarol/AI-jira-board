# 🗂️ AI Jira Board

A dead-simple Kanban / to-do board for everything — business and personal.

Two ways to use it, sharing one source of truth:

1. **The web app** — quickly add a todo, write a description, set priority, and
   drag cards between columns.
2. **Your AI** — reads and edits the same board and can add, move, re-prioritise,
   or clean up cards for you.

The entire board lives in **one file: [`board.json`](./board.json)**. There's no
database and **no dependencies to install** — the server is plain Node.

---

## Run it

```bash
npm start
# or:  node server.js
```

Then open **http://localhost:3000**.

Use a different port with `PORT=8080 node server.js`.

That's it. Everything you do in the UI is saved straight to `board.json`.

---

## What you can do in the web app

- **+ Add todo** (top right) or **+ Add a card** in any column — quick-add a task
  with a category and priority.
- **Click a card** to edit its title, description, category, priority, or move it
  to another column. Delete it from the same dialog.
- **Drag cards** between columns and reorder them.
- **Filter** by All / Business / Personal at the top.

---

## Columns

The default columns are **Backlog → To Do → In Progress → Done**. Rename, add, or
remove them by editing the `columns` array in `board.json` (see below).

---

## How your AI manages the board

Because the board is just `board.json`, your AI can manage it directly. The data
schema and the rules for editing it live in [`CLAUDE.md`](./CLAUDE.md). Ask things
like:

- "Add a high-priority business task to call the accountant."
- "Move the 'renew passport' card to In Progress."
- "Clean up Done — archive anything older than a month."
- "What's on my plate for business this week?"

---

## Data model (quick reference)

```jsonc
{
  "meta":    { "title": "My Board", "version": 1 },
  "columns": [ { "id": "todo", "name": "To Do" }, ... ],
  "tasks": [
    {
      "id": "t_ab12cd",          // unique, starts with "t_"
      "title": "Call the bank",
      "description": "Ask about the wire transfer",
      "column": "todo",          // must match a column id
      "category": "business",    // "business" | "personal"
      "priority": "high",        // "low" | "medium" | "high"
      "order": 0,                // position within its column
      "createdAt": "2026-09-15T00:00:00.000Z",
      "updatedAt": "2026-09-15T00:00:00.000Z"
    }
  ]
}
```

See [`CLAUDE.md`](./CLAUDE.md) for the full contract.
