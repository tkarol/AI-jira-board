'use strict';

/*
 * Local development server. Serves the web UI from public/ and exposes the same
 * REST API as the deployed Vercel functions, using the same shared handlers.
 *
 * Persistence is chosen automatically (see lib/store.js):
 *   - no GitHub env vars  -> reads/writes ./board.json on disk (offline dev)
 *   - GitHub env vars set -> reads/writes board.json in your repo (same source
 *     of truth as production; put them in a .env or export them first)
 *
 *   node server.js            # http://localhost:3000
 *   PORT=8080 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const handlers = require('./lib/handlers');
const store = require('./lib/store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

async function route(req, res, urlPath) {
  const body =
    req.method === 'GET' || req.method === 'DELETE' ? {} : await readRequestBody(req);

  if (req.method === 'GET' && urlPath === '/api/board') return handlers.getBoard();
  if (req.method === 'POST' && urlPath === '/api/tasks') return handlers.createTask(body);
  if (req.method === 'POST' && urlPath === '/api/reorder') return handlers.reorder(body);

  const m = urlPath.match(/^\/api\/tasks\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (req.method === 'PATCH' || req.method === 'PUT') return handlers.updateTask(id, body);
    if (req.method === 'DELETE') return handlers.deleteTask(id);
  }
  return { status: 404, json: { error: 'unknown endpoint' } };
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (!urlPath.startsWith('/api/')) return serveStatic(req, res);

  route(req, res, urlPath)
    .then((result) => sendJson(res, result.status, result.json))
    .catch((err) => sendJson(res, err.status || 500, { error: err.message || 'error' }));
});

server.listen(PORT, () => {
  const mode = store.usingGitHub() ? 'GitHub repo (board.json)' : 'local file (board.json)';
  // eslint-disable-next-line no-console
  console.log(`\n  Board running at  http://localhost:${PORT}\n  Storing data in:  ${mode}\n`);
});
