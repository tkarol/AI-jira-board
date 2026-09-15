'use strict';

const { updatePost, deletePost } = require('../../lib/planner-handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../../lib/vercel');

// PATCH /api/posts/:id -> edit (draft/needs_approval only)   DELETE -> remove
module.exports = async (req, res) => {
  const id = req.query.id;
  try {
    if (req.method === 'PATCH' || req.method === 'PUT') {
      return ok(res, await updatePost(id, readBody(req)));
    }
    if (req.method === 'DELETE') {
      return ok(res, await deletePost(id));
    }
    return fail(res, methodNotAllowed());
  } catch (e) {
    fail(res, e);
  }
};
