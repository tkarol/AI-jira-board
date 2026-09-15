'use strict';

/*
 * Pure domain operations on a board object. No I/O here — these just mutate a
 * plain board object in memory. Persistence lives in store.js. Keeping this
 * side-effect free means the same rules apply whether we're saving to GitHub
 * (deployed) or to a local file (offline dev).
 */

const crypto = require('crypto');

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_CATEGORIES = ['business', 'personal'];

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

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function newId() {
  return 't_' + crypto.randomBytes(6).toString('hex');
}

function clampEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function hasColumn(board, id) {
  return board.columns.some((c) => c.id === id);
}

function nextOrder(board, columnId) {
  const inCol = board.tasks.filter((t) => t.column === columnId);
  if (inCol.length === 0) return 0;
  return Math.max(...inCol.map((t) => (typeof t.order === 'number' ? t.order : 0))) + 1;
}

function createTask(board, body) {
  const title = String(body.title || '').trim();
  if (!title) throw new ApiError(400, 'title is required');

  const column =
    body.column && hasColumn(board, body.column) ? body.column : board.columns[0].id;
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
  return task;
}

function updateTask(board, id, body) {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new ApiError(404, 'task not found');

  if (typeof body.title === 'string') task.title = body.title.trim() || task.title;
  if (typeof body.description === 'string') task.description = body.description;
  if (typeof body.category === 'string')
    task.category = clampEnum(body.category, VALID_CATEGORIES, task.category);
  if (typeof body.priority === 'string')
    task.priority = clampEnum(body.priority, VALID_PRIORITIES, task.priority);
  if (typeof body.column === 'string' && hasColumn(board, body.column)) {
    if (body.column !== task.column && typeof body.order !== 'number') {
      task.order = nextOrder(board, body.column);
    }
    task.column = body.column;
  }
  if (typeof body.order === 'number') task.order = body.order;
  task.updatedAt = new Date().toISOString();
  return task;
}

function deleteTask(board, id) {
  const idx = board.tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw new ApiError(404, 'task not found');
  return board.tasks.splice(idx, 1)[0];
}

function reorder(board, updates) {
  const now = new Date().toISOString();
  for (const u of Array.isArray(updates) ? updates : []) {
    const task = board.tasks.find((t) => t.id === u.id);
    if (!task) continue;
    if (typeof u.column === 'string' && hasColumn(board, u.column)) task.column = u.column;
    if (typeof u.order === 'number') task.order = u.order;
    task.updatedAt = now;
  }
  return board;
}

module.exports = {
  ApiError,
  createTask,
  updateTask,
  deleteTask,
  reorder,
  DEFAULT_BOARD,
  VALID_PRIORITIES,
  VALID_CATEGORIES,
};
