'use strict';

/*
 * Photo blob storage. Two backends:
 *   - Vercel Blob  (BLOB_READ_WRITE_TOKEN set — production): stores the bytes in
 *     your Vercel Blob store and returns a public URL.
 *   - Local disk   (no token — dev): writes to ./uploads and serves /uploads/*.
 *
 * Only the returned URL + metadata is ever stored in the repo — never the bytes.
 * The @vercel/blob SDK is lazy-required so local dev works without installing it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function usingBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function safeName(name) {
  return String(name || 'photo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-80);
}

async function save({ filename, contentType, buffer }) {
  const key = `uploads/${crypto.randomBytes(6).toString('hex')}-${safeName(filename)}`;

  if (usingBlob()) {
    const { put } = require('@vercel/blob');
    const res = await put(key, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: res.url, pathname: res.pathname || key };
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const base = path.basename(key);
  fs.writeFileSync(path.join(UPLOAD_DIR, base), buffer);
  return { url: `/uploads/${base}`, pathname: `uploads/${base}` };
}

async function remove(media) {
  if (!media) return;
  try {
    if (media.url && /^https?:\/\//.test(media.url)) {
      const { del } = require('@vercel/blob');
      await del(media.url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } else if (media.pathname) {
      fs.unlinkSync(path.join(__dirname, '..', media.pathname));
    }
  } catch {
    // Best-effort: a missing blob/file shouldn't block removing the metadata.
  }
}

module.exports = { save, remove, usingBlob };
