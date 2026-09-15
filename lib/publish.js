'use strict';

/*
 * Publishing engine. Currently supports Facebook Pages via the Graph API.
 *
 * Credentials come from server-side env vars only (never the repo):
 *   META_PAGE_ID            - your Facebook Page's numeric id
 *   META_PAGE_ACCESS_TOKEN  - a long-lived Page access token (pages_manage_posts)
 *   META_GRAPH_VERSION      - optional, defaults to v21.0
 *
 * Photos are posted by URL (media live in Vercel Blob with public URLs), so the
 * repo never holds image bytes.
 */

function facebookConfigured() {
  return Boolean(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN);
}

function fbError(data, res) {
  if (data && data.error) {
    const e = data.error;
    return `${e.message}${e.code ? ` (code ${e.code})` : ''}`;
  }
  return `Graph API HTTP ${res ? res.status : '?'}`;
}

async function graphPost(path, params) {
  const version = process.env.META_GRAPH_VERSION || 'v21.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, access_token: process.env.META_PAGE_ACCESS_TOKEN }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || (data && data.error)) throw new Error(fbError(data, res));
  return data;
}

/**
 * Publish a post to the configured Facebook Page.
 * @param {object} post   - the post object (uses .content)
 * @param {object[]} media - resolved media objects (uses .url)
 * @returns {Promise<{id:string, url:string}>}
 */
async function publishToFacebook(post, media) {
  if (!facebookConfigured()) {
    throw new Error('Facebook is not connected (set META_PAGE_ID and META_PAGE_ACCESS_TOKEN)');
  }
  const pageId = process.env.META_PAGE_ID;
  const message = post.content || '';
  const photoUrls = (media || []).map((m) => m.url).filter((u) => /^https?:\/\//.test(u));

  let result;
  if (photoUrls.length === 0) {
    // text-only post
    result = await graphPost(`${pageId}/feed`, { message });
  } else if (photoUrls.length === 1) {
    // single photo with caption
    result = await graphPost(`${pageId}/photos`, { url: photoUrls[0], caption: message, published: true });
  } else {
    // multi-photo: upload each unpublished, then attach to one feed post
    const attached = [];
    for (const url of photoUrls) {
      const uploaded = await graphPost(`${pageId}/photos`, { url, published: false });
      attached.push({ media_fbid: uploaded.id });
    }
    result = await graphPost(`${pageId}/feed`, { message, attached_media: attached });
  }

  const id = result.post_id || result.id;
  return { id, url: id ? `https://www.facebook.com/${id}` : undefined };
}

// platform -> publisher. Add tiktok/instagram/etc. here as they get wired up.
const PUBLISHERS = {
  facebook: { configured: facebookConfigured, publish: publishToFacebook },
};

function configuredPlatforms() {
  return Object.keys(PUBLISHERS).filter((p) => PUBLISHERS[p].configured());
}

module.exports = { facebookConfigured, publishToFacebook, PUBLISHERS, configuredPlatforms };
