'use strict';

/*
 * Request-level handlers shared by the local dev server (server.js) and the
 * Vercel serverless functions (api/*.js). Each returns { status, json }.
 * Domain errors surface as ApiError with a .status the transport maps to HTTP.
 */

const store = require('./store');
const domain = require('./board');

async function getBoard() {
  return { status: 200, json: await store.readBoard() };
}

async function createTask(body) {
  const task = await store.mutate(
    (board) => domain.createTask(board, body),
    (t) => `board: add task "${t.title}"`
  );
  return { status: 201, json: task };
}

async function updateTask(id, body) {
  const task = await store.mutate(
    (board) => domain.updateTask(board, id, body),
    (t) => `board: update task "${t.title}"`
  );
  return { status: 200, json: task };
}

async function deleteTask(id) {
  const removed = await store.mutate(
    (board) => domain.deleteTask(board, id),
    (t) => `board: delete task "${t.title}"`
  );
  return { status: 200, json: removed };
}

async function reorder(body) {
  const board = await store.mutate(
    (b) => domain.reorder(b, body.updates),
    () => 'board: reorder cards'
  );
  return { status: 200, json: board };
}

module.exports = { getBoard, createTask, updateTask, deleteTask, reorder };
