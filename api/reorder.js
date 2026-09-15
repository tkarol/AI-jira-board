'use strict';

const { reorder } = require('../lib/handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../lib/vercel');

// POST /api/reorder  -> bulk { id, column, order } updates for drag-and-drop
module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, methodNotAllowed());
  try {
    ok(res, await reorder(readBody(req)));
  } catch (e) {
    fail(res, e);
  }
};
