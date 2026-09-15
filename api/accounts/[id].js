'use strict';

const { updateAccount } = require('../../lib/planner-handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../../lib/vercel');

// PATCH /api/accounts/:id -> edit handle / display name / connected flag (metadata only)
module.exports = async (req, res) => {
  if (req.method !== 'PATCH' && req.method !== 'PUT') return fail(res, methodNotAllowed());
  try {
    ok(res, await updateAccount(req.query.id, readBody(req)));
  } catch (e) {
    fail(res, e);
  }
};
