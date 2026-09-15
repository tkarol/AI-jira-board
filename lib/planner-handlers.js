'use strict';

/*
 * Request handlers for the planner, shared by server.js and api/*.js.
 * Each returns { status, json }.
 */

const { createStore } = require('./store');
const { ApiError } = require('./board');
const domain = require('./planner');
const media = require('./media');
const publish = require('./publish');

const plannerStore = createStore({
  localFile: 'planner.json',
  repoPath: process.env.GITHUB_PLANNER_PATH || 'planner.json',
  defaultDoc: domain.DEFAULT_PLANNER,
});

async function getPlanner() {
  const doc = await plannerStore.read();
  // Advertise which platforms have server-side credentials (never the tokens).
  return { status: 200, json: { ...doc, publishing: { facebook: publish.facebookConfigured() } } };
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
    case 'publish':
      return publishPost(id);
    default:
      throw new ApiError(404, 'unknown action');
  }
}

// --- real publishing --------------------------------------------------------

// Send ONE approved post to its connected platform(s). Only approved/scheduled
// posts can be published — the approval gate holds even here.
async function publishPost(id) {
  const planner = await plannerStore.read();
  const post = (planner.posts || []).find((p) => p.id === id);
  if (!post) throw new ApiError(404, 'post not found');
  if (post.status !== 'approved' && post.status !== 'scheduled') {
    throw new ApiError(409, 'only approved posts can be published — approve it first');
  }
  const connected = post.platforms.filter((p) => publish.PUBLISHERS[p] && publish.PUBLISHERS[p].configured());
  if (connected.length === 0) {
    throw new ApiError(400, 'no connected platform on this post (only Facebook is wired up so far)');
  }

  const mediaList = (post.mediaIds || [])
    .map((mid) => (planner.media || []).find((m) => m.id === mid))
    .filter(Boolean);

  // Publish to each connected platform (currently just Facebook).
  let result = { platform: connected[0], ok: false, error: 'not attempted' };
  try {
    const r = await publish.PUBLISHERS[connected[0]].publish(post, mediaList);
    result = { platform: connected[0], ok: true, url: r.url, id: r.id };
  } catch (e) {
    result = { platform: connected[0], ok: false, error: e.message };
  }

  const updated = await plannerStore.mutate(
    (p) => domain.recordPublish(p, id, result),
    () => `planner: publish post ${id} to ${result.platform} (${result.ok ? 'ok' : 'failed'})`
  );

  if (!result.ok) throw new ApiError(502, `${result.platform} publish failed: ${result.error}`);
  return { status: 200, json: updated };
}

// Publish every scheduled post whose time has arrived. Used by the scheduler.
async function publishDue() {
  const planner = await plannerStore.read();
  const now = Date.now();
  const due = (planner.posts || []).filter(
    (p) => p.status === 'scheduled' && p.scheduledAt && Date.parse(p.scheduledAt) <= now
  );
  const results = [];
  for (const post of due) {
    try {
      await publishPost(post.id);
      results.push({ id: post.id, ok: true });
    } catch (e) {
      results.push({ id: post.id, ok: false, error: e.message });
    }
  }
  return { status: 200, json: { checked: due.length, results } };
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

// --- content ideas ----------------------------------------------------------

async function createIdea(body) {
  const idea = await plannerStore.mutate(
    (p) => domain.createIdea(p, body),
    (i) => `studio: add idea "${i.title}"`
  );
  return { status: 201, json: idea };
}

async function updateIdea(id, body) {
  const idea = await plannerStore.mutate(
    (p) => domain.updateIdea(p, id, body),
    (i) => `studio: edit idea "${i.title}"`
  );
  return { status: 200, json: idea };
}

async function deleteIdea(id) {
  const removed = await plannerStore.mutate(
    (p) => domain.deleteIdea(p, id),
    (i) => `studio: delete idea "${i.title}"`
  );
  return { status: 200, json: removed };
}

async function ideaAction(id, action) {
  if (action === 'convert') {
    const post = await plannerStore.mutate(
      (p) => domain.convertIdeaToPost(p, id),
      () => `studio: idea ${id} -> draft post`
    );
    return { status: 201, json: post };
  }
  const idea = await plannerStore.mutate(
    (p) => domain.setIdeaStatus(p, id, action),
    () => `studio: idea ${id} -> ${action}`
  );
  return { status: 200, json: idea };
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
  createIdea,
  updateIdea,
  deleteIdea,
  ideaAction,
  publishPost,
  publishDue,
};
