'use strict';

const { createPost } = require('../lib/planner-handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../lib/vercel');

// POST /api/posts -> create a draft (or needs_approval) post
module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, methodNotAllowed());
  try {
    ok(res, await createPost(readBody(req)));
  } catch (e) {
    fail(res, e);
  }
};
