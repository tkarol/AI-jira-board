'use strict';

/*
 * Pure domain operations for the social media planner (planner.json). No I/O.
 *
 * The approval gate is the important part:
 *   draft -> needs_approval -> approved -> scheduled -> posted   (or failed)
 *
 * Anyone (you, or Hermes) can create/edit posts and move them between
 * draft and needs_approval. But moving a post to approved/scheduled/posted is
 * treated as a HUMAN action: it only happens through approvePost()/markPosted()
 * (the web app's Approve / Mark-posted buttons), never through the generic
 * updatePost() path. That's what enforces "nothing goes out without my approval".
 */

const crypto = require('crypto');

const { ApiError } = require('./board');

const VALID_PLATFORMS = ['twitter', 'instagram', 'facebook'];
const EDITABLE_STATUSES = ['draft', 'needs_approval'];
const ALL_STATUSES = ['draft', 'needs_approval', 'approved', 'scheduled', 'posted', 'failed'];

const DEFAULT_PLANNER = {
  meta: { version: 1 },
  accounts: [
    { id: 'acc_twitter', platform: 'twitter', handle: '', displayName: 'X / Twitter', connected: false },
    { id: 'acc_instagram', platform: 'instagram', handle: '', displayName: 'Instagram', connected: false },
    { id: 'acc_facebook', platform: 'facebook', handle: '', displayName: 'Facebook', connected: false },
  ],
  media: [],
  posts: [
    {
      id: 'p_example',
      content: 'Example post — Hermes can draft these for you, then they wait here until you approve. Edit me, attach a photo, pick platforms, set a time.',
      platforms: ['twitter'],
      mediaIds: [],
      scheduledAt: null,
      status: 'draft',
      createdBy: 'system',
      notes: '',
      approvedAt: null,
      postedAt: null,
      results: {},
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    },
  ],
};

const newId = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
const nowIso = () => new Date().toISOString();

function cleanPlatforms(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => VALID_PLATFORMS.includes(p));
}

function cleanMediaIds(planner, list) {
  if (!Array.isArray(list)) return [];
  const known = new Set(planner.media.map((m) => m.id));
  return list.filter((id) => known.has(id));
}

// --- posts ------------------------------------------------------------------

function createPost(planner, body) {
  const content = String(body.content || '').trim();
  const platforms = cleanPlatforms(body.platforms);
  const mediaIds = cleanMediaIds(planner, body.mediaIds);
  if (!content && mediaIds.length === 0) {
    throw new ApiError(400, 'a post needs text or at least one photo');
  }
  // Callers may submit straight to needs_approval; anything else starts as draft.
  const status = body.status === 'needs_approval' ? 'needs_approval' : 'draft';
  const now = nowIso();
  const post = {
    id: newId('p'),
    content,
    platforms,
    mediaIds,
    scheduledAt: body.scheduledAt || null,
    status,
    createdBy: body.createdBy === 'hermes' ? 'hermes' : 'you',
    notes: String(body.notes || ''),
    approvedAt: null,
    postedAt: null,
    results: {},
    createdAt: now,
    updatedAt: now,
  };
  planner.posts.push(post);
  return post;
}

function findPost(planner, id) {
  const post = planner.posts.find((p) => p.id === id);
  if (!post) throw new ApiError(404, 'post not found');
  return post;
}

function updatePost(planner, id, body) {
  const post = findPost(planner, id);
  if (!EDITABLE_STATUSES.includes(post.status)) {
    throw new ApiError(
      409,
      `this post is "${post.status}" and can't be edited; move it back to draft first`
    );
  }
  if (typeof body.content === 'string') post.content = body.content.trim();
  if (Array.isArray(body.platforms)) post.platforms = cleanPlatforms(body.platforms);
  if (Array.isArray(body.mediaIds)) post.mediaIds = cleanMediaIds(planner, body.mediaIds);
  if (body.scheduledAt !== undefined) post.scheduledAt = body.scheduledAt || null;
  if (typeof body.notes === 'string') post.notes = body.notes;
  // Only draft <-> needs_approval is allowed here. Approval is a separate action.
  if (typeof body.status === 'string') {
    if (!EDITABLE_STATUSES.includes(body.status)) {
      throw new ApiError(400, 'use the approve/revert actions to change approval status');
    }
    post.status = body.status;
    if (body.status === 'draft') post.approvedAt = null;
  }
  if (!post.content && post.mediaIds.length === 0) {
    throw new ApiError(400, 'a post needs text or at least one photo');
  }
  post.updatedAt = nowIso();
  return post;
}

// Human approval gate. Sets approved, or scheduled if a future time is set.
function approvePost(planner, id) {
  const post = findPost(planner, id);
  if (post.status === 'posted') throw new ApiError(409, 'post is already posted');
  if (!post.content && post.mediaIds.length === 0) {
    throw new ApiError(400, 'nothing to approve — the post is empty');
  }
  if (post.platforms.length === 0) {
    throw new ApiError(400, 'pick at least one platform before approving');
  }
  post.status = post.scheduledAt ? 'scheduled' : 'approved';
  post.approvedAt = nowIso();
  post.updatedAt = post.approvedAt;
  return post;
}

// Send an approved/scheduled post back to draft (un-approve).
function revertPost(planner, id) {
  const post = findPost(planner, id);
  if (post.status === 'posted') throw new ApiError(409, 'post is already posted');
  post.status = 'draft';
  post.approvedAt = null;
  post.updatedAt = nowIso();
  return post;
}

// Manual "mark as posted" (until the auto-publishing engine is wired up).
function markPosted(planner, id) {
  const post = findPost(planner, id);
  post.status = 'posted';
  post.postedAt = nowIso();
  post.updatedAt = post.postedAt;
  return post;
}

function deletePost(planner, id) {
  const idx = planner.posts.findIndex((p) => p.id === id);
  if (idx === -1) throw new ApiError(404, 'post not found');
  return planner.posts.splice(idx, 1)[0];
}

// --- media ------------------------------------------------------------------

function addMedia(planner, m) {
  const media = {
    id: newId('m'),
    filename: String(m.filename || 'photo'),
    url: m.url,
    pathname: m.pathname || null,
    contentType: m.contentType || 'application/octet-stream',
    size: m.size || 0,
    width: m.width || null,
    height: m.height || null,
    caption: String(m.caption || ''),
    uploadedAt: nowIso(),
  };
  planner.media.unshift(media);
  return media;
}

function updateMedia(planner, id, body) {
  const media = planner.media.find((m) => m.id === id);
  if (!media) throw new ApiError(404, 'media not found');
  if (typeof body.caption === 'string') media.caption = body.caption;
  return media;
}

function removeMedia(planner, id) {
  const idx = planner.media.findIndex((m) => m.id === id);
  if (idx === -1) throw new ApiError(404, 'media not found');
  const [removed] = planner.media.splice(idx, 1);
  // Detach it from any posts that referenced it.
  for (const post of planner.posts) {
    if (Array.isArray(post.mediaIds) && post.mediaIds.includes(id)) {
      post.mediaIds = post.mediaIds.filter((mid) => mid !== id);
      post.updatedAt = nowIso();
    }
  }
  return removed;
}

// --- accounts ---------------------------------------------------------------

function updateAccount(planner, id, body) {
  const acc = planner.accounts.find((a) => a.id === id);
  if (!acc) throw new ApiError(404, 'account not found');
  if (typeof body.handle === 'string') acc.handle = body.handle.trim();
  if (typeof body.displayName === 'string') acc.displayName = body.displayName.trim() || acc.displayName;
  if (typeof body.connected === 'boolean') acc.connected = body.connected;
  return acc;
}

module.exports = {
  DEFAULT_PLANNER,
  VALID_PLATFORMS,
  ALL_STATUSES,
  createPost,
  updatePost,
  approvePost,
  revertPost,
  markPosted,
  deletePost,
  addMedia,
  updateMedia,
  removeMedia,
  updateAccount,
};
