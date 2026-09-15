'use strict';

/*
 * Request-level handlers shared by the local dev server (server.js) and the
 * Vercel serverless functions (api/*.js). Each returns { status, json }.
 * Domain errors surface as ApiError with a .status the transport maps to HTTP.
 */

const { createStore } = require('./store');
const domain = require('./board');

const boardStore = createStore({
  localFile: 'board.json',
  repoPath: process.env.GITHUB_BOARD_PATH || 'board.json',
  defaultDoc: domain.DEFAULT_BOARD,
});

async function getBoard() {
  return { status: 200, json: await boardStore.read() };
}

async function createTask(body) {
  const task = await boardStore.mutate(
    (board) => domain.createTask(board, body),
    (t) => `board: add task "${t.title}"`
  );
  return { status: 201, json: task };
}

async function updateTask(id, body) {
  const task = await boardStore.mutate(
    (board) => domain.updateTask(board, id, body),
    (t) => `board: update task "${t.title}"`
  );
  return { status: 200, json: task };
}

async function deleteTask(id) {
  const removed = await boardStore.mutate(
    (board) => domain.deleteTask(board, id),
    (t) => `board: delete task "${t.title}"`
  );
  return { status: 200, json: removed };
}

async function reorder(body) {
  const board = await boardStore.mutate(
    (b) => domain.reorder(b, body.updates),
    () => 'board: reorder cards'
  );
  return { status: 200, json: board };
}

module.exports = { getBoard, createTask, updateTask, deleteTask, reorder };
