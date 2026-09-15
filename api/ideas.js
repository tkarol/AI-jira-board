'use strict';

const { createIdea } = require('../lib/planner-handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../lib/vercel');

// POST /api/ideas -> create a content idea (shootable brief)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, methodNotAllowed());
  try {
    ok(res, await createIdea(readBody(req)));
  } catch (e) {
    fail(res, e);
  }
};
