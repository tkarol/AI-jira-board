'use strict';

const { listMedia, uploadMedia } = require('../lib/planner-handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../lib/vercel');

// GET /api/media -> list photos    POST /api/media -> upload { filename, contentType, dataBase64, width?, height? }
module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return ok(res, await listMedia());
    if (req.method === 'POST') return ok(res, await uploadMedia(readBody(req)));
    return fail(res, methodNotAllowed());
  } catch (e) {
    fail(res, e);
  }
};
