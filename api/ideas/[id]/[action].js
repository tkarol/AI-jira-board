'use strict';

const { ideaAction } = require('../../../lib/planner-handlers');
const { ok, fail, methodNotAllowed } = require('../../../lib/vercel');

// POST /api/ideas/:id/convert | /to_record | /recorded | /edited | /posted | /idea
module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, methodNotAllowed());
  try {
    ok(res, await ideaAction(req.query.id, req.query.action));
  } catch (e) {
    fail(res, e);
  }
};
