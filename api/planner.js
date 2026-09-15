'use strict';

const { getPlanner } = require('../lib/planner-handlers');
const { ok, fail, methodNotAllowed } = require('../lib/vercel');

// GET /api/planner -> full planner document (accounts, media, posts)
module.exports = async (req, res) => {
  if (req.method !== 'GET') return fail(res, methodNotAllowed());
  try {
    ok(res, await getPlanner());
  } catch (e) {
    fail(res, e);
  }
};
