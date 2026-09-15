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
const t = domain.createTask(board, { title: '  Hello  ', category: 'birdie_bus', priority: 'high' });
assert.strictEqual(t.title, 'Hello', 'title trimmed');
assert.strictEqual(t.column, 'todo', 'defaults to first column');
assert.strictEqual(t.category, 'birdie_bus');
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

// --- planner domain ---------------------------------------------------------
const planner = require('../lib/planner');

function makePlanner() {
  return { meta: { version: 1 }, accounts: planner.DEFAULT_PLANNER.accounts.map((a) => ({ ...a })), media: [], posts: [] };
}

let pl = makePlanner();

// empty post rejected
assert.throws(() => planner.createPost(pl, { content: '  ', platforms: [] }), /needs text or/);

// create filters invalid platforms
const post = planner.createPost(pl, { content: 'Hello world', platforms: ['twitter', 'bogus'], createdBy: 'hermes' });
assert.deepStrictEqual(post.platforms, ['twitter'], 'invalid platform dropped');
assert.strictEqual(post.status, 'draft');
assert.strictEqual(post.createdBy, 'hermes');

// approval gate: generic update cannot set approved
assert.throws(() => planner.updatePost(pl, post.id, { status: 'approved' }), /approve\/revert actions/);

// submit for approval is allowed
planner.updatePost(pl, post.id, { status: 'needs_approval' });
assert.strictEqual(pl.posts[0].status, 'needs_approval');

// approve with no platforms should fail
const p2 = planner.createPost(pl, { content: 'x', platforms: [] });
assert.throws(() => planner.approvePost(pl, p2.id), /at least one platform/);

// approve -> approved (no schedule) ; with schedule -> scheduled
const approved = planner.approvePost(pl, post.id);
assert.strictEqual(approved.status, 'approved');
assert.ok(approved.approvedAt);

// editing an approved post is blocked (must revert first)
assert.throws(() => planner.updatePost(pl, post.id, { content: 'new' }), (e) => e.status === 409);

// revert -> draft, then schedule + approve -> scheduled
planner.revertPost(pl, post.id);
planner.updatePost(pl, post.id, { scheduledAt: '2999-01-01T10:00:00.000Z' });
assert.strictEqual(planner.approvePost(pl, post.id).status, 'scheduled');

// media add + reference cleanup on delete
const m = planner.addMedia(pl, { filename: 'a.jpg', url: 'https://x/a.jpg', pathname: 'uploads/a.jpg' });
planner.revertPost(pl, post.id);
planner.updatePost(pl, post.id, { mediaIds: [m.id] });
assert.deepStrictEqual(pl.posts.find((x) => x.id === post.id).mediaIds, [m.id]);
planner.removeMedia(pl, m.id);
assert.deepStrictEqual(pl.posts.find((x) => x.id === post.id).mediaIds, [], 'media detached from post on delete');

// createPost with only a photo (no text) is allowed
const m2 = planner.addMedia(pl, { filename: 'b.jpg', url: 'https://x/b.jpg' });
const photoPost = planner.createPost(pl, { content: '', mediaIds: [m2.id], platforms: ['instagram'] });
assert.strictEqual(photoPost.mediaIds.length, 1);

// --- content ideas (Studio) -------------------------------------------------
pl.ideas = [];
assert.throws(() => planner.createIdea(pl, {}), /at least a title/);

const idea = planner.createIdea(pl, {
  hook: 'Watch this',
  platforms: ['tiktok', 'bogus', 'instagram'],
  shots: [
    { angle: 'close up', action: 'show it', say: 'here it is', seconds: '5' },
    { angle: '', action: '', say: '' }, // empty shot dropped
  ],
  hashtags: 'founder, #smallbiz',
  createdBy: 'hermes',
});
assert.deepStrictEqual(idea.platforms, ['tiktok', 'instagram'], 'invalid platform dropped');
assert.strictEqual(idea.shots.length, 1, 'empty shot dropped');
assert.strictEqual(idea.shots[0].seconds, 5, 'seconds coerced to number');
assert.deepStrictEqual(idea.hashtags, ['#founder', '#smallbiz'], 'hashtags normalized');
assert.strictEqual(idea.status, 'idea');
assert.strictEqual(idea.title, 'Watch this', 'title falls back to hook');

// status transitions
planner.setIdeaStatus(pl, idea.id, 'to_record');
assert.strictEqual(pl.ideas[0].status, 'to_record');
assert.throws(() => planner.setIdeaStatus(pl, idea.id, 'bogus'), (e) => e.status === 404);

// convert to a draft post
const postsBefore = pl.posts.length;
const genPost = planner.convertIdeaToPost(pl, idea.id);
assert.strictEqual(pl.posts.length, postsBefore + 1, 'post created from idea');
assert.strictEqual(genPost.status, 'draft');
assert.deepStrictEqual(genPost.platforms, ['tiktok', 'instagram']);
assert.strictEqual(pl.ideas[0].postId, genPost.id, 'idea linked to post');

// delete
planner.deleteIdea(pl, idea.id);
assert.strictEqual(pl.ideas.length, 0);

console.log('✓ all smoke tests passed');
