'use strict';

const { updateMedia, deleteMedia } = require('../../lib/planner-handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../../lib/vercel');

// PATCH /api/media/:id -> edit caption    DELETE /api/media/:id -> remove photo
module.exports = async (req, res) => {
  const id = req.query.id;
  try {
    if (req.method === 'PATCH' || req.method === 'PUT') {
      return ok(res, await updateMedia(id, readBody(req)));
    }
    if (req.method === 'DELETE') {
      return ok(res, await deleteMedia(id));
    }
    return fail(res, methodNotAllowed());
  } catch (e) {
    fail(res, e);
  }
};
