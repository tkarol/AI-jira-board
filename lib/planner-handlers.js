'use strict';

/*
 * Request handlers for the planner, shared by server.js and api/*.js.
 * Each returns { status, json }.
 */

const { createStore } = require('./store');
const { ApiError } = require('./board');
const domain = require('./planner');
const media = require('./media');

const plannerStore = createStore({
  localFile: 'planner.json',
  repoPath: process.env.GITHUB_PLANNER_PATH || 'planner.json',
  defaultDoc: domain.DEFAULT_PLANNER,
});

async function getPlanner() {
  return { status: 200, json: await plannerStore.read() };
}

async function createPost(body) {
  const post = await plannerStore.mutate(
    (p) => domain.createPost(p, body),
    (post) => `planner: draft post ${post.id}`
  );
  return { status: 201, json: post };
}

async function updatePost(id, body) {
  const post = await plannerStore.mutate(
    (p) => domain.updatePost(p, id, body),
    () => `planner: edit post ${id}`
  );
  return { status: 200, json: post };
}

async function approvePost(id) {
  const post = await plannerStore.mutate(
    (p) => domain.approvePost(p, id),
    (post) => `planner: approve post ${id} (${post.status})`
  );
  return { status: 200, json: post };
}

async function revertPost(id) {
  const post = await plannerStore.mutate(
    (p) => domain.revertPost(p, id),
    () => `planner: revert post ${id} to draft`
  );
  return { status: 200, json: post };
}

async function markPosted(id) {
  const post = await plannerStore.mutate(
    (p) => domain.markPosted(p, id),
    () => `planner: mark post ${id} posted`
  );
  return { status: 200, json: post };
}

async function deletePost(id) {
  const removed = await plannerStore.mutate(
    (p) => domain.deletePost(p, id),
    () => `planner: delete post ${id}`
  );
  return { status: 200, json: removed };
}

// A single "post action" dispatcher used by the POST /api/posts/:id/:action route.
async function postAction(id, action) {
  switch (action) {
    case 'approve':
      return approvePost(id);
    case 'revert':
      return revertPost(id);
    case 'posted':
      return markPosted(id);
    default:
      throw new ApiError(404, 'unknown action');
  }
}

// --- media ------------------------------------------------------------------

async function listMedia() {
  const planner = await plannerStore.read();
  return { status: 200, json: { media: planner.media } };
}

async function uploadMedia(body) {
  const dataBase64 = body.dataBase64 || '';
  if (!dataBase64) throw new ApiError(400, 'no file data (expected dataBase64)');
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) throw new ApiError(400, 'empty file');
  if (buffer.length > 10 * 1024 * 1024) throw new ApiError(413, 'photo too large (max ~10MB)');

  const stored = await media.save({
    filename: body.filename,
    contentType: body.contentType,
    buffer,
  });

  const record = await plannerStore.mutate(
    (p) =>
      domain.addMedia(p, {
        filename: body.filename,
        contentType: body.contentType,
        size: buffer.length,
        width: body.width,
        height: body.height,
        caption: body.caption,
        url: stored.url,
        pathname: stored.pathname,
      }),
    (m) => `media: add ${m.filename}`
  );
  return { status: 201, json: record };
}

async function updateMedia(id, body) {
  const record = await plannerStore.mutate(
    (p) => domain.updateMedia(p, id, body),
    () => `media: edit ${id}`
  );
  return { status: 200, json: record };
}

async function deleteMedia(id) {
  let removed;
  await plannerStore.mutate(
    (p) => {
      removed = domain.removeMedia(p, id);
      return removed;
    },
    (m) => `media: delete ${m.filename}`
  );
  await media.remove(removed); // delete the actual blob/file after metadata is gone
  return { status: 200, json: removed };
}

// --- accounts ---------------------------------------------------------------

async function updateAccount(id, body) {
  const acc = await plannerStore.mutate(
    (p) => domain.updateAccount(p, id, body),
    () => `planner: update account ${id}`
  );
  return { status: 200, json: acc };
}

module.exports = {
  getPlanner,
  createPost,
  updatePost,
  postAction,
  deletePost,
  listMedia,
  uploadMedia,
  updateMedia,
  deleteMedia,
  updateAccount,
};
