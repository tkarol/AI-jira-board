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

const VALID_PLATFORMS = ['twitter', 'instagram', 'facebook', 'tiktok', 'youtube'];
const EDITABLE_STATUSES = ['draft', 'needs_approval'];
const ALL_STATUSES = ['draft', 'needs_approval', 'approved', 'scheduled', 'posted', 'failed'];
const IDEA_STATUSES = ['idea', 'to_record', 'recorded', 'edited', 'posted'];

const DEFAULT_PLANNER = {
  meta: { version: 1 },
  accounts: [
    { id: 'acc_twitter', platform: 'twitter', handle: '', displayName: 'X / Twitter', connected: false },
    { id: 'acc_instagram', platform: 'instagram', handle: '', displayName: 'Instagram', connected: false },
    { id: 'acc_facebook', platform: 'facebook', handle: '', displayName: 'Facebook', connected: false },
    { id: 'acc_tiktok', platform: 'tiktok', handle: '', displayName: 'TikTok', connected: false },
    { id: 'acc_youtube', platform: 'youtube', handle: '', displayName: 'YouTube', connected: false },
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
  ideas: [
    {
      id: 'idea_example',
      title: '3 things nobody tells you',
      hook: '"Nobody tells you this before you start…"',
      concept:
        'A punchy list of 3 hard-won lessons — talking to camera with quick b-roll cutaways to keep the energy up. This is a template: ask your AI to write real ones for you.',
      platforms: ['tiktok', 'instagram', 'youtube'],
      shots: [
        { id: 's1', angle: 'Talking head, phone at eye level, window light on your face', action: 'Deliver the hook straight to camera — confident, lean in slightly', say: 'Nobody tells you this before you start. Here are 3 things I learned the hard way.', seconds: 4 },
        { id: 's2', angle: 'Close-up b-roll of your hands / product / workspace', action: 'Show the thing while the voiceover plays over it', say: 'Number one: start before you feel ready — you never will.', seconds: 6 },
        { id: 's3', angle: 'Walking shot, camera slightly low, moving toward you', action: 'Walk and talk, keep the pace up', say: 'Number two: boring consistent work beats the big flashy move every time.', seconds: 6 },
        { id: 's4', angle: 'Talking head, tighter framing than shot 1', action: 'Land the last point and the call to action', say: 'Number three: your first try will be rough. Post it anyway. Follow for more.', seconds: 6 },
      ],
      caption: '3 things I wish I knew earlier 👇 Which one hit hardest?',
      hashtags: ['#smallbusiness', '#lessonslearned', '#founder'],
      status: 'idea',
      createdBy: 'system',
      notes: '',
      postId: null,
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

// --- content ideas (Studio) -------------------------------------------------

function cleanHashtags(list) {
  const arr = Array.isArray(list)
    ? list
    : String(list || '')
        .split(/[\s,]+/)
        .filter(Boolean);
  return arr.map((h) => (h.startsWith('#') ? h : '#' + h)).filter((h) => h.length > 1);
}

function cleanShots(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => ({
      id: s.id || newId('s'),
      angle: String(s.angle || ''),
      action: String(s.action || ''),
      say: String(s.say || ''),
      seconds: Number.isFinite(+s.seconds) && +s.seconds > 0 ? Math.round(+s.seconds) : 0,
    }))
    .filter((s) => s.angle || s.action || s.say);
}

function ensureIdeas(planner) {
  if (!Array.isArray(planner.ideas)) planner.ideas = [];
  return planner.ideas;
}

function findIdea(planner, id) {
  const idea = ensureIdeas(planner).find((i) => i.id === id);
  if (!idea) throw new ApiError(404, 'idea not found');
  return idea;
}

function createIdea(planner, body) {
  ensureIdeas(planner);
  const title = String(body.title || '').trim();
  const hook = String(body.hook || '').trim();
  const concept = String(body.concept || '').trim();
  if (!title && !hook && !concept) {
    throw new ApiError(400, 'an idea needs at least a title, hook, or concept');
  }
  const now = nowIso();
  const idea = {
    id: newId('idea'),
    title: title || hook.slice(0, 40) || 'Untitled idea',
    hook,
    concept,
    platforms: cleanPlatforms(body.platforms),
    shots: cleanShots(body.shots),
    caption: String(body.caption || ''),
    hashtags: cleanHashtags(body.hashtags),
    status: IDEA_STATUSES.includes(body.status) ? body.status : 'idea',
    createdBy: body.createdBy === 'hermes' ? 'hermes' : 'you',
    notes: String(body.notes || ''),
    postId: null,
    createdAt: now,
    updatedAt: now,
  };
  planner.ideas.push(idea);
  return idea;
}

function updateIdea(planner, id, body) {
  const idea = findIdea(planner, id);
  if (typeof body.title === 'string') idea.title = body.title.trim() || idea.title;
  if (typeof body.hook === 'string') idea.hook = body.hook;
  if (typeof body.concept === 'string') idea.concept = body.concept;
  if (Array.isArray(body.platforms)) idea.platforms = cleanPlatforms(body.platforms);
  if (Array.isArray(body.shots)) idea.shots = cleanShots(body.shots);
  if (typeof body.caption === 'string') idea.caption = body.caption;
  if (body.hashtags !== undefined) idea.hashtags = cleanHashtags(body.hashtags);
  if (typeof body.notes === 'string') idea.notes = body.notes;
  if (typeof body.status === 'string' && IDEA_STATUSES.includes(body.status)) idea.status = body.status;
  idea.updatedAt = nowIso();
  return idea;
}

function setIdeaStatus(planner, id, status) {
  if (!IDEA_STATUSES.includes(status)) throw new ApiError(404, 'unknown action');
  const idea = findIdea(planner, id);
  idea.status = status;
  idea.updatedAt = nowIso();
  return idea;
}

function deleteIdea(planner, id) {
  const ideas = ensureIdeas(planner);
  const idx = ideas.findIndex((i) => i.id === id);
  if (idx === -1) throw new ApiError(404, 'idea not found');
  return ideas.splice(idx, 1)[0];
}

// Graduate an idea into a draft post (caption + hashtags + platforms), so it
// flows into the normal approval queue. Video/thumbnail get attached later.
function convertIdeaToPost(planner, id) {
  const idea = findIdea(planner, id);
  const tags = (idea.hashtags || []).join(' ');
  const content = [idea.caption, tags].filter(Boolean).join('\n\n');
  const now = nowIso();
  const post = {
    id: newId('p'),
    content,
    platforms: cleanPlatforms(idea.platforms),
    mediaIds: [],
    scheduledAt: null,
    status: 'draft',
    createdBy: 'hermes',
    notes: `From idea: ${idea.title}`,
    approvedAt: null,
    postedAt: null,
    results: {},
    createdAt: now,
    updatedAt: now,
  };
  planner.posts.push(post);
  idea.postId = post.id;
  idea.updatedAt = now;
  return post;
}

module.exports = {
  DEFAULT_PLANNER,
  VALID_PLATFORMS,
  ALL_STATUSES,
  IDEA_STATUSES,
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
  createIdea,
  updateIdea,
  setIdeaStatus,
  deleteIdea,
  convertIdeaToPost,
};
