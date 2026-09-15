'use strict';

/*
 * Persistence layer with two interchangeable backends:
 *
 *   - GitHub backend  (used when GITHUB_TOKEN/OWNER/REPO are set — i.e. on Vercel):
 *       reads and writes board.json in your repo via the GitHub Contents API.
 *       Every save is a commit, so the repo is the single source of truth that
 *       both the web app and an AI agent (with repo access) share.
 *
 *   - File backend    (fallback for local dev with no token):
 *       reads and writes ./board.json on the local disk.
 *
 * The public surface is just readBoard() and mutate(applyFn, messageFn).
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'board.json');

const cfg = {
  token: process.env.GITHUB_TOKEN,
  owner: process.env.GITHUB_OWNER,
  repo: process.env.GITHUB_REPO,
  // Branch that holds the live board data. Defaults to the branch Vercel
  // deployed from, so it always exists; set GITHUB_DATA_BRANCH to isolate data
  // commits on a dedicated branch (recommended: "board-data").
  branch: process.env.GITHUB_DATA_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || 'main',
  filePath: process.env.GITHUB_BOARD_PATH || 'board.json',
};

const DEFAULT_BOARD = {
  meta: { title: 'My Board', version: 1 },
  columns: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'todo', name: 'To Do' },
    { id: 'in_progress', name: 'In Progress' },
    { id: 'done', name: 'Done' },
  ],
  tasks: [],
};

function usingGitHub() {
  return Boolean(cfg.token && cfg.owner && cfg.repo);
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serialize = (board) => JSON.stringify(board, null, 2) + '\n';

// --- GitHub backend ---------------------------------------------------------

function contentsUrl() {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(
    cfg.filePath
  )}`;
}

function ghFetch(method, url, body) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'ai-jira-board',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ghRead() {
  const res = await ghFetch('GET', `${contentsUrl()}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return { board: clone(DEFAULT_BOARD), sha: null };
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { board: JSON.parse(content), sha: data.sha };
}

async function ghWrite(board, sha, message) {
  const res = await ghFetch('PUT', contentsUrl(), {
    message: message || 'board: update',
    content: Buffer.from(serialize(board)).toString('base64'),
    branch: cfg.branch,
    sha: sha || undefined,
  });
  // A stale sha (someone else committed in between) shows up as 409/422.
  if (res.status === 409 || res.status === 422) {
    const e = new Error('conflict');
    e.conflict = true;
    throw e;
  }
  if (!res.ok) throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
}

async function ghMutate(applyFn, messageFn) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { board, sha } = await ghRead();
    const result = applyFn(board); // may throw ApiError (propagates, no write)
    const message = typeof messageFn === 'function' ? messageFn(result, board) : messageFn;
    try {
      await ghWrite(board, sha, message);
      return result;
    } catch (e) {
      if (e.conflict) {
        lastErr = e;
        await sleep(150 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('GitHub write failed after retries');
}

// --- File backend -----------------------------------------------------------

function fileReadBoard() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      fs.writeFileSync(FILE, serialize(DEFAULT_BOARD));
      return clone(DEFAULT_BOARD);
    }
    throw e;
  }
}

// Serialize writes so concurrent requests can't interleave.
let chain = Promise.resolve();
function fileMutate(applyFn) {
  const run = async () => {
    const board = fileReadBoard();
    const result = applyFn(board);
    const tmp = FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, serialize(board));
    fs.renameSync(tmp, FILE);
    return result;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

// --- public API -------------------------------------------------------------

async function readBoard() {
  return usingGitHub() ? (await ghRead()).board : fileReadBoard();
}

async function mutate(applyFn, messageFn) {
  return usingGitHub() ? ghMutate(applyFn, messageFn) : fileMutate(applyFn);
}

module.exports = { readBoard, mutate, usingGitHub, DEFAULT_BOARD };
