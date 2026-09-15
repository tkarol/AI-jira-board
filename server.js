'use strict';

/*
 * Zero-dependency Kanban board server.
 *
 * The entire board lives in board.json (see CLAUDE.md for the schema).
 * This server just serves the web UI and exposes a small REST API that
 * reads and writes that one file. No database, no npm install.
 *
 *   node server.js            # starts on http://localhost:3000
 *   PORT=8080 node server.js  # custom port
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const BOARD_FILE = path.join(ROOT, 'board.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_CATEGORIES = ['business', 'personal'];

// --- board persistence ------------------------------------------------------

function readBoard() {
  const raw = fs.readFileSync(BOARD_FILE, 'utf8');
  return JSON.parse(raw);
}

// Writes are serialized so concurrent requests can't interleave and corrupt
// the file. Each write goes to a temp file then atomically renames into place.
let writeChain = Promise.resolve();
function writeBoard(board) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = BOARD_FILE + '.' + process.pid + '.tmp';
        const data = JSON.stringify(board, null, 2) + '\n';
        fs.writeFile(tmp, data, (err) => {
          if (err) return reject(err);
          fs.rename(tmp, BOARD_FILE, (err2) => (err2 ? reject(err2) : resolve()));
        });
      }),
    // keep the chain alive even if a previous write rejected
    () => {}
  );
  return writeChain;
}

function newId() {
  return 't_' + crypto.randomBytes(6).toString('hex');
}

function nextOrder(board, columnId) {
  const inCol = board.tasks.filter((t) => t.column === columnId);
  if (inCol.length === 0) return 0;
  return Math.max(...inCol.map((t) => (typeof t.order === 'number' ? t.order : 0))) + 1;
}

function clampEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// --- HTTP helpers -----------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('Request body too large'));
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// --- static files -----------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside public/
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

// --- API --------------------------------------------------------------------

async function handleApi(req, res, urlPath) {
  // GET /api/board -> full board
  if (req.method === 'GET' && urlPath === '/api/board') {
    return sendJson(res, 200, readBoard());
  }

  // POST /api/tasks -> create a task
  if (req.method === 'POST' && urlPath === '/api/tasks') {
    const body = await readRequestBody(req);
    const board = readBoard();

    const title = String(body.title || '').trim();
    if (!title) return sendJson(res, 400, { error: 'title is required' });

    const column =
      body.column && board.columns.some((c) => c.id === body.column)
        ? body.column
        : board.columns[0].id;

    const now = new Date().toISOString();
    const task = {
      id: newId(),
      title,
      description: String(body.description || ''),
      column,
      category: clampEnum(body.category, VALID_CATEGORIES, 'personal'),
      priority: clampEnum(body.priority, VALID_PRIORITIES, 'medium'),
      order: nextOrder(board, column),
      createdAt: now,
      updatedAt: now,
    };
    board.tasks.push(task);
    await writeBoard(board);
    return sendJson(res, 201, task);
  }

  // PATCH /api/tasks/:id -> update fields (title, description, column, category, priority, order)
  const taskMatch = urlPath.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
    const id = taskMatch[1];
    const body = await readRequestBody(req);
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) return sendJson(res, 404, { error: 'task not found' });

    if (typeof body.title === 'string') task.title = body.title.trim() || task.title;
    if (typeof body.description === 'string') task.description = body.description;
    if (typeof body.category === 'string')
      task.category = clampEnum(body.category, VALID_CATEGORIES, task.category);
    if (typeof body.priority === 'string')
      task.priority = clampEnum(body.priority, VALID_PRIORITIES, task.priority);
    if (typeof body.column === 'string' && board.columns.some((c) => c.id === body.column)) {
      if (body.column !== task.column && typeof body.order !== 'number') {
        task.order = nextOrder(board, body.column);
      }
      task.column = body.column;
    }
    if (typeof body.order === 'number') task.order = body.order;
    task.updatedAt = new Date().toISOString();

    await writeBoard(board);
    return sendJson(res, 200, task);
  }

  // DELETE /api/tasks/:id
  if (taskMatch && req.method === 'DELETE') {
    const id = taskMatch[1];
    const board = readBoard();
    const idx = board.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'task not found' });
    const [removed] = board.tasks.splice(idx, 1);
    await writeBoard(board);
    return sendJson(res, 200, removed);
  }

  // POST /api/reorder -> bulk set { id, column, order } for drag-and-drop
  if (req.method === 'POST' && urlPath === '/api/reorder') {
    const body = await readRequestBody(req);
    const board = readBoard();
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const now = new Date().toISOString();
    for (const u of updates) {
      const task = board.tasks.find((t) => t.id === u.id);
      if (!task) continue;
      if (typeof u.column === 'string' && board.columns.some((c) => c.id === u.column)) {
        task.column = u.column;
      }
      if (typeof u.order === 'number') task.order = u.order;
      task.updatedAt = now;
    }
    await writeBoard(board);
    return sendJson(res, 200, readBoard());
  }

  return sendJson(res, 404, { error: 'unknown endpoint' });
}

// --- server -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch((err) => {
      sendJson(res, 400, { error: err.message || 'bad request' });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Board running at  http://localhost:${PORT}\n  Data file:        ${BOARD_FILE}\n`);
});
