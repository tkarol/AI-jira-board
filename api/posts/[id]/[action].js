'use strict';

const { postAction } = require('../../../lib/planner-handlers');
const { ok, fail, methodNotAllowed } = require('../../../lib/vercel');

// POST /api/posts/:id/approve | /revert | /posted  (approval is a human action)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, methodNotAllowed());
  try {
    ok(res, await postAction(req.query.id, req.query.action));
  } catch (e) {
    fail(res, e);
  }
};
