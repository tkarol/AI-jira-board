'use strict';

// --- platform metadata ------------------------------------------------------

const PLATFORMS = {
  twitter: { name: 'X / Twitter', short: 'X', emoji: '𝕏', limit: 280 },
  instagram: { name: 'Instagram', short: 'IG', emoji: '📸', limit: 2200, requiresImage: true },
  facebook: { name: 'Facebook', short: 'FB', emoji: '👥', limit: 63206 },
};

const COLUMNS = [
  { id: 'draft', name: 'Draft', match: (s) => s === 'draft' },
  { id: 'needs_approval', name: 'Needs approval', match: (s) => s === 'needs_approval' },
  { id: 'approved', name: 'Approved / Scheduled', match: (s) => ['approved', 'scheduled', 'failed'].includes(s) },
  { id: 'posted', name: 'Posted', match: (s) => s === 'posted' },
];

// --- state ------------------------------------------------------------------

let data = { accounts: [], media: [], posts: [] };
let editingId = null;
let compose = { platforms: new Set(), mediaIds: [] };
let pickerSelection = new Set();

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const mediaById = (id) => data.media.find((m) => m.id === id);

// --- API --------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function load() {
  data = await api('GET', '/api/planner');
  renderPosts();
  renderPhotos();
  renderAccounts();
}

// --- tabs -------------------------------------------------------------------

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  const tab = btn.dataset.tab;
  $$('#tabs .chip').forEach((c) => c.classList.toggle('active', c === btn));
  $('#posts-view').hidden = tab !== 'posts';
  $('#photos-view').hidden = tab !== 'photos';
  $('#accounts-view').hidden = tab !== 'accounts';
});

// --- posts ------------------------------------------------------------------

function platformBadge(id) {
  const p = PLATFORMS[id];
  return p ? `<span class="pbadge" title="${p.name}">${p.emoji} ${p.short}</span>` : '';
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderPosts() {
  const view = $('#posts-view');
  view.innerHTML = '';
  for (const col of COLUMNS) {
    const posts = data.posts
      .filter((p) => col.match(p.status))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    const colEl = document.createElement('section');
    colEl.className = 'column';
    colEl.innerHTML = `<div class="column-header"><span>${col.name}</span><span class="column-count">${posts.length}</span></div>`;

    const cards = document.createElement('div');
    cards.className = 'column-cards';
    for (const post of posts) cards.appendChild(renderPostCard(post));
    colEl.appendChild(cards);
    view.appendChild(colEl);
  }
}

function renderPostCard(post) {
  const el = document.createElement('article');
  el.className = 'card post-card' + (post.status === 'failed' ? ' failed' : '');

  const thumbs = post.mediaIds
    .map(mediaById)
    .filter(Boolean)
    .map((m) => `<img class="thumb" src="${m.url}" alt="${escapeHtml(m.filename)}" />`)
    .join('');

  const text = post.content ? escapeHtml(post.content) : '<em class="muted">(no text)</em>';
  const badges = post.platforms.map(platformBadge).join('');
  const when = post.scheduledAt
    ? `<span class="when">🕒 ${fmtWhen(post.scheduledAt)}</span>`
    : '';
  const by = post.createdBy === 'hermes' ? '<span class="tag hermes">Hermes</span>' : '';
  const failed = post.status === 'failed' ? '<span class="tag priority-high">failed</span>' : '';

  el.innerHTML = `
    <div class="post-text">${text}</div>
    ${thumbs ? `<div class="thumb-row">${thumbs}</div>` : ''}
    <div class="card-meta">${badges}${when}${by}${failed}</div>
    <div class="post-actions">${postActions(post)}</div>`;

  el.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => doAction(post, btn.dataset.act));
  });
  return el;
}

function postActions(post) {
  const b = (act, label, cls = 'ghost') =>
    `<button class="btn ${cls} small" data-act="${act}">${label}</button>`;
  switch (post.status) {
    case 'draft':
      return b('edit', 'Edit') + b('submit', 'Submit') + b('delete', 'Delete', 'danger');
    case 'needs_approval':
      return b('edit', 'Edit') + b('approve', '✅ Approve', 'primary') + b('delete', 'Delete', 'danger');
    case 'approved':
    case 'scheduled':
    case 'failed':
      return b('revert', 'Back to draft') + b('posted', '✔ Mark posted', 'primary') + b('delete', 'Delete', 'danger');
    case 'posted':
      return b('delete', 'Delete', 'danger');
    default:
      return '';
  }
}

async function doAction(post, act) {
  try {
    if (act === 'edit') return openCompose(post);
    if (act === 'delete') {
      if (!confirm('Delete this post?')) return;
      await api('DELETE', `/api/posts/${post.id}`);
    } else if (act === 'submit') {
      await api('PATCH', `/api/posts/${post.id}`, { status: 'needs_approval' });
    } else if (act === 'approve') {
      if (!confirm('Approve this post? It becomes ready to publish.')) return;
      await api('POST', `/api/posts/${post.id}/approve`);
    } else if (act === 'revert') {
      await api('POST', `/api/posts/${post.id}/revert`);
    } else if (act === 'posted') {
      await api('POST', `/api/posts/${post.id}/posted`);
    }
    await load();
  } catch (e) {
    alert(e.message);
  }
}

// --- compose ----------------------------------------------------------------

function openCompose(post) {
  editingId = post ? post.id : null;
  compose.platforms = new Set(post ? post.platforms : ['twitter']);
  compose.mediaIds = post ? [...post.mediaIds] : [];
  $('#compose-heading').textContent = post ? 'Edit post' : 'New post';
  $('#compose-text').value = post ? post.content : '';
  $('#compose-notes').value = post ? post.notes || '' : '';
  $('#compose-schedule').value = post && post.scheduledAt ? toInputValue(post.scheduledAt) : '';
  $('#compose-delete').hidden = !post;
  renderPlatformPicker();
  renderAttachStrip();
  updateComposeMeta();
  $('#compose-backdrop').hidden = false;
  $('#compose-text').focus();
}

function closeCompose() {
  $('#compose-backdrop').hidden = true;
  editingId = null;
}

function renderPlatformPicker() {
  $('#platform-picker').innerHTML = Object.entries(PLATFORMS)
    .map(([id, p]) => {
      const on = compose.platforms.has(id) ? ' on' : '';
      return `<button type="button" class="ptoggle${on}" data-platform="${id}">${p.emoji} ${p.name}</button>`;
    })
    .join('');
  $$('#platform-picker .ptoggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.platform;
      if (compose.platforms.has(id)) compose.platforms.delete(id);
      else compose.platforms.add(id);
      btn.classList.toggle('on');
      updateComposeMeta();
    });
  });
}

function renderAttachStrip() {
  const strip = $('#attach-strip');
  if (compose.mediaIds.length === 0) {
    strip.innerHTML = '<span class="muted">No photos attached.</span>';
    return;
  }
  strip.innerHTML = compose.mediaIds
    .map(mediaById)
    .filter(Boolean)
    .map(
      (m) =>
        `<span class="attach-item"><img src="${m.url}" alt="" /><button type="button" data-remove="${m.id}">✕</button></span>`
    )
    .join('');
  strip.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      compose.mediaIds = compose.mediaIds.filter((id) => id !== btn.dataset.remove);
      renderAttachStrip();
      updateComposeMeta();
    });
  });
}

function updateComposeMeta() {
  const len = $('#compose-text').value.length;
  const selected = [...compose.platforms];
  const limits = selected.map((id) => PLATFORMS[id].limit);
  const min = limits.length ? Math.min(...limits) : null;
  $('#char-count').textContent = min ? `${len} / ${min} chars` : `${len} chars`;

  const warns = [];
  if (min && len > min) {
    const over = selected.filter((id) => len > PLATFORMS[id].limit).map((id) => PLATFORMS[id].short);
    warns.push(`Too long for ${over.join(', ')}`);
  }
  if (compose.platforms.has('instagram') && compose.mediaIds.length === 0) {
    warns.push('Instagram needs a photo');
  }
  $('#platform-warning').textContent = warns.join(' · ');
}

$('#compose-text').addEventListener('input', updateComposeMeta);
$('#new-post-btn').addEventListener('click', () => openCompose(null));
$('#compose-cancel').addEventListener('click', closeCompose);
$('#compose-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#compose-backdrop')) closeCompose();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#picker-backdrop').hidden) return closePicker();
    if (!$('#compose-backdrop').hidden) closeCompose();
  }
});

function composePayload(status) {
  const schedule = $('#compose-schedule').value;
  return {
    content: $('#compose-text').value,
    platforms: [...compose.platforms],
    mediaIds: compose.mediaIds,
    scheduledAt: schedule ? fromInputValue(schedule) : null,
    notes: $('#compose-notes').value,
    status,
  };
}

async function saveCompose(status) {
  try {
    const payload = composePayload(status);
    if (editingId) await api('PATCH', `/api/posts/${editingId}`, payload);
    else await api('POST', '/api/posts', payload);
    closeCompose();
    await load();
  } catch (e) {
    alert(e.message);
  }
}

$('#compose-draft').addEventListener('click', () => saveCompose('draft'));
$('#compose-submit').addEventListener('click', () => saveCompose('needs_approval'));
$('#compose-delete').addEventListener('click', async () => {
  if (!editingId || !confirm('Delete this post?')) return;
  try {
    await api('DELETE', `/api/posts/${editingId}`);
    closeCompose();
    await load();
  } catch (e) {
    alert(e.message);
  }
});

// --- photo picker (attach to compose) ---------------------------------------

$('#attach-btn').addEventListener('click', () => {
  pickerSelection = new Set(compose.mediaIds);
  renderPicker();
  $('#picker-backdrop').hidden = false;
});
function closePicker() {
  $('#picker-backdrop').hidden = true;
}
function renderPicker() {
  const grid = $('#picker-grid');
  if (data.media.length === 0) {
    grid.innerHTML = '<p class="muted">No photos yet. Upload some in the Photos tab.</p>';
    return;
  }
  grid.innerHTML = data.media
    .map(
      (m) =>
        `<button type="button" class="photo-cell${pickerSelection.has(m.id) ? ' selected' : ''}" data-id="${m.id}">
          <img src="${m.url}" alt="${escapeHtml(m.filename)}" /></button>`
    )
    .join('');
  grid.querySelectorAll('.photo-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const id = cell.dataset.id;
      if (pickerSelection.has(id)) pickerSelection.delete(id);
      else pickerSelection.add(id);
      cell.classList.toggle('selected');
    });
  });
}
$('#picker-done').addEventListener('click', () => {
  compose.mediaIds = data.media.map((m) => m.id).filter((id) => pickerSelection.has(id));
  closePicker();
  renderAttachStrip();
  updateComposeMeta();
});

// --- photos tab -------------------------------------------------------------

function renderPhotos() {
  const grid = $('#photo-grid');
  if (data.media.length === 0) {
    grid.innerHTML = '<p class="muted">No photos yet. Upload some to use in your posts.</p>';
    return;
  }
  grid.innerHTML = data.media
    .map(
      (m) => `
      <figure class="photo-tile">
        <img src="${m.url}" alt="${escapeHtml(m.filename)}" />
        <figcaption>
          <input class="caption-input" data-id="${m.id}" value="${escapeHtml(m.caption || '')}" placeholder="Add a caption…" />
          <button class="btn danger small" data-del="${m.id}">Delete</button>
        </figcaption>
      </figure>`
    )
    .join('');

  grid.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this photo? It will be removed from any posts using it.')) return;
      try {
        await api('DELETE', `/api/media/${btn.dataset.del}`);
        await load();
      } catch (e) {
        alert(e.message);
      }
    })
  );
  grid.querySelectorAll('.caption-input').forEach((input) =>
    input.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/media/${input.dataset.id}`, { caption: input.value });
      } catch (e) {
        alert(e.message);
      }
    })
  );
}

$('#photo-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const status = $('#upload-status');
  let done = 0;
  for (const file of files) {
    status.textContent = `Uploading ${done + 1} of ${files.length}…`;
    try {
      const img = await resizeImage(file);
      await api('POST', '/api/media', img);
      done++;
    } catch (err) {
      status.textContent = `Upload failed: ${err.message}`;
      return;
    }
  }
  status.textContent = `Uploaded ${done} photo${done === 1 ? '' : 's'}.`;
  await load();
  setTimeout(() => (status.textContent = ''), 3000);
});

// Downscale to <= 2048px and re-encode as JPEG so uploads stay small.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not a valid image'));
      img.onload = () => {
        const max = 2048;
        let { width, height } = img;
        if (width > max || height > max) {
          const scale = Math.min(max / width, max / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({
          filename: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg',
          contentType: 'image/jpeg',
          dataBase64: dataUrl.split(',')[1],
          width,
          height,
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- accounts tab -----------------------------------------------------------

function renderAccounts() {
  $('#accounts-list').innerHTML = data.accounts
    .map((a) => {
      const p = PLATFORMS[a.platform] || { emoji: '🔗', name: a.platform };
      return `
      <div class="account-row" data-id="${a.id}">
        <span class="account-name">${p.emoji} ${escapeHtml(a.displayName)}</span>
        <input class="text-input handle" placeholder="@handle" value="${escapeHtml(a.handle || '')}" />
        <label class="toggle"><input type="checkbox" class="connected" ${a.connected ? 'checked' : ''} /> Connected</label>
      </div>`;
    })
    .join('');

  $$('#accounts-list .account-row').forEach((row) => {
    const id = row.dataset.id;
    const save = async () => {
      try {
        await api('PATCH', `/api/accounts/${id}`, {
          handle: row.querySelector('.handle').value,
          connected: row.querySelector('.connected').checked,
        });
      } catch (e) {
        alert(e.message);
      }
    };
    row.querySelector('.handle').addEventListener('change', save);
    row.querySelector('.connected').addEventListener('change', save);
  });
}

// --- utils ------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// datetime-local <-> ISO, respecting the user's local timezone
function toInputValue(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function fromInputValue(local) {
  return new Date(local).toISOString();
}

// --- boot -------------------------------------------------------------------

load().catch((err) => {
  document.body.innerHTML = `<p style="padding:24px">Could not load planner: ${escapeHtml(err.message)}</p>`;
});
