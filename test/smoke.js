'use strict';

/*
 * Minimal smoke test for the domain rules and the file-backed handlers.
 * Runs against a temp board file so it never touches your real board.json.
 *   node test/smoke.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point the store at a throwaway board file (no GitHub env => file backend).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-test-'));
const tmpFile = path.join(tmpDir, 'board.json');
// store.js resolves board.json relative to its own dir; instead we drive the
// pure domain layer directly, which needs no file, plus a file round-trip.

const domain = require('../lib/board');

function makeBoard() {
  return {
    meta: { title: 'T', version: 1 },
    columns: [
      { id: 'todo', name: 'To Do' },
      { id: 'done', name: 'Done' },
    ],
    tasks: [],
  };
}

// create
let board = makeBoard();
const t = domain.createTask(board, { title: '  Hello  ', category: 'business', priority: 'high' });
assert.strictEqual(t.title, 'Hello', 'title trimmed');
assert.strictEqual(t.column, 'todo', 'defaults to first column');
assert.strictEqual(t.category, 'business');
assert.strictEqual(board.tasks.length, 1);
assert.ok(/^t_[0-9a-f]{12}$/.test(t.id), 'id format');

// invalid enum falls back
const t2 = domain.createTask(board, { title: 'X', category: 'nope', priority: 'nope' });
assert.strictEqual(t2.category, 'personal', 'bad category -> personal');
assert.strictEqual(t2.priority, 'medium', 'bad priority -> medium');

// empty title rejected
assert.throws(() => domain.createTask(board, { title: '   ' }), /title is required/);

// update + move to another column recomputes order
const moved = domain.updateTask(board, t.id, { column: 'done' });
assert.strictEqual(moved.column, 'done');
assert.strictEqual(moved.order, 0, 'first card in empty column gets order 0');

// unknown column ignored
const before = board.tasks.find((x) => x.id === t2.id).column;
domain.updateTask(board, t2.id, { column: 'ghost' });
assert.strictEqual(board.tasks.find((x) => x.id === t2.id).column, before, 'bad column ignored');

// update/delete missing -> 404
assert.throws(() => domain.updateTask(board, 'nope', {}), (e) => e.status === 404);
assert.throws(() => domain.deleteTask(board, 'nope'), (e) => e.status === 404);

// reorder
domain.reorder(board, [{ id: t2.id, column: 'done', order: 5 }]);
assert.strictEqual(board.tasks.find((x) => x.id === t2.id).order, 5);

// delete
const removed = domain.deleteTask(board, t.id);
assert.strictEqual(removed.id, t.id);
assert.strictEqual(board.tasks.length, 1);

// file round-trip: valid JSON serialization
fs.writeFileSync(tmpFile, JSON.stringify(board, null, 2) + '\n');
const reparsed = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
assert.strictEqual(reparsed.tasks.length, 1);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('✓ all smoke tests passed');
