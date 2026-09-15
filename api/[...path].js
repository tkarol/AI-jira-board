'use strict';

/*
 * Single catch-all API function. Vercel's Hobby plan caps a deployment at 12
 * serverless functions, so instead of one file per route we route everything
 * through here, dispatching to the same shared handlers the local dev server
 * (server.js) uses. One function, all endpoints.
 */

const board = require('../lib/handlers');
const planner = require('../lib/planner-handlers');
const { readBody, ok, fail } = require('../lib/vercel');

async function dispatch(seg, method, body) {
  const [a, b, c] = seg;

  // --- board ---
  if (a === 'board' && seg.length === 1 && method === 'GET') return board.getBoard();
  if (a === 'tasks' && seg.length === 1 && method === 'POST') return board.createTask(body);
  if (a === 'tasks' && seg.length === 2) {
    if (method === 'PATCH' || method === 'PUT') return board.updateTask(b, body);
    if (method === 'DELETE') return board.deleteTask(b);
  }
  if (a === 'reorder' && seg.length === 1 && method === 'POST') return board.reorder(body);

  // --- planner: posts / media / accounts ---
  if (a === 'planner' && seg.length === 1 && method === 'GET') return planner.getPlanner();
  if (a === 'posts' && seg.length === 1 && method === 'POST') return planner.createPost(body);
  if (a === 'posts' && seg.length === 3 && method === 'POST') return planner.postAction(b, c);
  if (a === 'posts' && seg.length === 2) {
    if (method === 'PATCH' || method === 'PUT') return planner.updatePost(b, body);
    if (method === 'DELETE') return planner.deletePost(b);
  }
  if (a === 'media' && seg.length === 1) {
    if (method === 'GET') return planner.listMedia();
    if (method === 'POST') return planner.uploadMedia(body);
  }
  if (a === 'media' && seg.length === 2) {
    if (method === 'PATCH' || method === 'PUT') return planner.updateMedia(b, body);
    if (method === 'DELETE') return planner.deleteMedia(b);
  }
  if (a === 'accounts' && seg.length === 2 && (method === 'PATCH' || method === 'PUT')) {
    return planner.updateAccount(b, body);
  }

  // --- studio: content ideas ---
  if (a === 'ideas' && seg.length === 1 && method === 'POST') return planner.createIdea(body);
  if (a === 'ideas' && seg.length === 3 && method === 'POST') return planner.ideaAction(b, c);
  if (a === 'ideas' && seg.length === 2) {
    if (method === 'PATCH' || method === 'PUT') return planner.updateIdea(b, body);
    if (method === 'DELETE') return planner.deleteIdea(b);
  }

  return { status: 404, json: { error: 'unknown endpoint' } };
}

module.exports = async (req, res) => {
  const seg = [].concat(req.query.path || []);
  const method = req.method;
  const body = method === 'POST' || method === 'PATCH' || method === 'PUT' ? readBody(req) : {};
  try {
    ok(res, await dispatch(seg, method, body));
  } catch (e) {
    fail(res, e);
  }
};
