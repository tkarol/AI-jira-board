'use strict';

// Small helpers shared by the Vercel serverless functions in api/.

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function ok(res, result) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.json);
}

function fail(res, err) {
  const status = err && err.status ? err.status : 500;
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error: (err && err.message) || 'error' });
}

function methodNotAllowed() {
  return Object.assign(new Error('method not allowed'), { status: 405 });
}

module.exports = { readBody, ok, fail, methodNotAllowed };
