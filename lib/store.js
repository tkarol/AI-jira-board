'use strict';

/*
 * Persistence factory. Each call to createStore() returns a small store bound to
 * one JSON document in the repo (e.g. board.json, planner.json). Two backends:
 *
 *   - GitHub backend  (GITHUB_TOKEN/OWNER/REPO set — i.e. on Vercel):
 *       reads/writes the document via the GitHub Contents API. Every save is a
 *       commit, so the repo is the single source of truth the web app and an AI
 *       agent (with repo access) both share.
 *   - File backend    (no token — local dev):
 *       reads/writes the JSON file on local disk.
 *
 * Each store exposes read() and mutate(applyFn, messageFn).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const gh = {
  token: process.env.GITHUB_TOKEN,
  owner: process.env.GITHUB_OWNER,
  repo: process.env.GITHUB_REPO,
  branch: process.env.GITHUB_DATA_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || 'main',
};

function usingGitHub() {
  return Boolean(gh.token && gh.owner && gh.repo);
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serialize = (doc) => JSON.stringify(doc, null, 2) + '\n';

function ghFetch(method, url, body) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${gh.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'ai-jira-board',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function createStore({ localFile, repoPath, defaultDoc }) {
  const absLocal = path.join(ROOT, localFile);
  const contentsUrl = () =>
    `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${encodeURIComponent(repoPath)}`;

  // --- GitHub backend ---
  async function ghRead() {
    const res = await ghFetch('GET', `${contentsUrl()}?ref=${encodeURIComponent(gh.branch)}`);
    if (res.status === 404) return { doc: clone(defaultDoc), sha: null };
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { doc: JSON.parse(content), sha: data.sha };
  }

  async function ghWrite(doc, sha, message) {
    const res = await ghFetch('PUT', contentsUrl(), {
      message: message || `update ${repoPath}`,
      content: Buffer.from(serialize(doc)).toString('base64'),
      branch: gh.branch,
      sha: sha || undefined,
    });
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
      const { doc, sha } = await ghRead();
      const result = applyFn(doc); // may throw ApiError (propagates, no write)
      const message = typeof messageFn === 'function' ? messageFn(result, doc) : messageFn;
      try {
        await ghWrite(doc, sha, message);
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

  // --- File backend ---
  function fileRead() {
    try {
      return JSON.parse(fs.readFileSync(absLocal, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') {
        fs.writeFileSync(absLocal, serialize(defaultDoc));
        return clone(defaultDoc);
      }
      throw e;
    }
  }

  let chain = Promise.resolve();
  function fileMutate(applyFn) {
    const run = async () => {
      const doc = fileRead();
      const result = applyFn(doc);
      const tmp = absLocal + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, serialize(doc));
      fs.renameSync(tmp, absLocal);
      return result;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  return {
    read: async () => (usingGitHub() ? (await ghRead()).doc : fileRead()),
    mutate: (applyFn, messageFn) =>
      usingGitHub() ? ghMutate(applyFn, messageFn) : fileMutate(applyFn),
  };
}

module.exports = { createStore, usingGitHub };
