'use strict';

const { getBoard } = require('../lib/handlers');
const { ok, fail, methodNotAllowed } = require('../lib/vercel');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return fail(res, methodNotAllowed());
  try {
    ok(res, await getBoard());
  } catch (e) {
    fail(res, e);
  }
};
