'use strict';

const { createTask } = require('../lib/handlers');
const { readBody, ok, fail, methodNotAllowed } = require('../lib/vercel');

// POST /api/tasks  -> create a task
module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, methodNotAllowed());
  try {
    ok(res, await createTask(readBody(req)));
  } catch (e) {
    fail(res, e);
  }
};
