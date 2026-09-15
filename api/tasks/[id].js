'use strict';

const { updateTask, deleteTask } = require('../../lib/handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../../lib/vercel');

// PATCH/PUT /api/tasks/:id -> update    DELETE /api/tasks/:id -> delete
module.exports = async (req, res) => {
  const id = req.query.id;
  try {
    if (req.method === 'PATCH' || req.method === 'PUT') {
      return ok(res, await updateTask(id, readBody(req)));
    }
    if (req.method === 'DELETE') {
      return ok(res, await deleteTask(id));
    }
    return fail(res, methodNotAllowed());
  } catch (e) {
    fail(res, e);
  }
};
