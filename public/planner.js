'use strict';

// --- platform metadata + icons ----------------------------------------------

const SVG = {
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.24 2.25h3.3l-7.2 8.26L22.5 21.75h-6.6l-5.2-6.82-5.95 6.82H1.44l7.7-8.84L1.5 2.25h6.77l4.7 6.23 5.27-6.23Zm-1.16 17.52h1.83L7.02 4.13H5.06l12.02 15.64Z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" stroke="none"/></svg>',
  facebook:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 9h2.2V6.1C15.8 6 14.9 6 14 6c-2 0-3.4 1.2-3.4 3.5V11H8v3h2.6v7h3.1v-7h2.3l.4-3h-2.7V9.8c0-.6.3-.8 1.3-.8Z"/></svg>',
  tiktok:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3c.35 2 1.6 3.5 3.5 3.8v2.5c-1.3.05-2.5-.35-3.5-1.05v5.95c0 3-2.2 5.4-5.15 5.4-2.95 0-5.35-2.4-5.35-5.35 0-2.9 2.45-5.1 5.3-4.85v2.55c-.4-.1-.85-.15-1.25-.05-1.15.2-1.95.95-1.95 2.3 0 1.35 1 2.4 2.3 2.4 1.35 0 2.4-1.05 2.4-2.95V3h3.7Z"/></svg>',
  youtube:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 7.2a2.7 2.7 0 0 0-1.9-1.9C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.5A2.7 2.7 0 0 0 2.5 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .5 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.5-4.8ZM10 15.2V8.8l5.2 3.2Z"/></svg>',
};

const PLATFORMS = {
  x: { name: 'X', limit: 280 },
  twitter: { name: 'X', limit: 280, icon: 'x' }, // legacy id alias
  instagram: { name: 'Instagram', limit: 2200, requiresImage: true },
  facebook: { name: 'Facebook', limit: 63206 },
  tiktok: { name: 'TikTok', limit: 2200 },
  youtube: { name: 'YouTube', limit: 5000 },
};
// The set shown in the pickers (order matters).
const PLATFORM_IDS = ['twitter', 'instagram', 'facebook', 'tiktok', 'youtube'];
const iconKey = (id) => PLATFORMS[id]?.icon || (id === 'twitter' ? 'x' : id);

function platformIcon(id, cls = '') {
  return `<span class="picon picon-${iconKey(id)} ${cls}">${SVG[iconKey(id)] || ''}</span>`;
}

const STATUS = {
  draft: { label: 'Draft' },
  needs_approval: { label: 'Needs approval' },
  approved: { label: 'Approved' },
  scheduled: { label: 'Scheduled' },
  posted: { label: 'Posted' },
  failed: { label: 'Failed' },
};

// --- state ------------------------------------------------------------------

let data = { accounts: [], media: [], posts: [] };
let editingId = null;
let locked = false;
let compose = { platforms: new Set(), mediaIds: [] };
let pickerSelection = new Set();
const today = new Date();
let calYear = today.getFullYear();
let calMonth = today.getMonth();

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const mediaById = (id) => data.media.find((m) => m.id === id);
const accountFor = (platform) =>
  data.accounts.find((a) => a.platform === platform) ||
  data.accounts.find((a) => a.platform === 'twitter' && platform === 'x');

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
  if (!Array.isArray(data.ideas)) data.ideas = [];
  renderAll();
}

function renderAll() {
  renderCalendar();
  renderQueue();
  renderStudio();
  renderPhotos();
  renderAccounts();
}

// --- tabs -------------------------------------------------------------------

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  const tab = btn.dataset.tab;
  $$('#tabs .chip').forEach((c) => c.classList.toggle('active', c === btn));
  $('#calendar-view').hidden = tab !== 'calendar';
  $('#queue-view').hidden = tab !== 'queue';
  $('#studio-view').hidden = tab !== 'studio';
  $('#photos-view').hidden = tab !== 'photos';
  $('#accounts-view').hidden = tab !== 'accounts';
});

// --- helpers ----------------------------------------------------------------

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function sameDay(d, y, m, day) {
  return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
}
function postPlatforms(post) {
  return (post.platforms || []).filter((p) => PLATFORMS[p]);
}

// --- calendar ---------------------------------------------------------------

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderCalendar() {
  $('#cal-title').textContent = `${MONTHS[calMonth]} ${calYear}`;
  $('#cal-weekdays').innerHTML = WEEKDAYS.map((d) => `<div>${d}</div>`).join('');

  const firstDay = new Date(calYear, calMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const scheduled = data.posts.filter((p) => p.scheduledAt);
  const grid = $('#cal-grid');
  grid.innerHTML = '';

  for (let cell = 0; cell < 42; cell++) {
    const dayNum = cell - startOffset + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const cellDate = new Date(calYear, calMonth, dayNum);
    const isToday =
      inMonth && sameDay(today, cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());

    const cellEl = document.createElement('div');
    cellEl.className = 'cal-cell' + (inMonth ? '' : ' other-month') + (isToday ? ' today' : '');

    const posts = inMonth
      ? scheduled
          .filter((p) => sameDay(new Date(p.scheduledAt), calYear, calMonth, dayNum))
          .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      : [];

    cellEl.innerHTML = `<div class="cal-daynum">${inMonth ? cellDate.getDate() : ''}</div>`;
    const chips = document.createElement('div');
    chips.className = 'cal-chips';
    for (const post of posts) chips.appendChild(calChip(post));
    cellEl.appendChild(chips);

    if (inMonth) {
      cellEl.addEventListener('click', (e) => {
        if (e.target.closest('.cal-chip')) return;
        openComposer(null, cellDate);
      });
    }
    grid.appendChild(cellEl);
  }
}

function calChip(post) {
  const el = document.createElement('button');
  el.className = `cal-chip s-${post.status}`;
  const icons = postPlatforms(post).map((p) => platformIcon(p, 'tiny')).join('');
  const text = post.content ? escapeHtml(post.content.slice(0, 40)) : '(photo post)';
  el.innerHTML = `<span class="cal-chip-time">${fmtTime(post.scheduledAt)}</span>${icons}<span class="cal-chip-text">${text}</span>`;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    openComposer(post);
  });
  return el;
}

$('#cal-prev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
$('#cal-next').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});
$('#cal-today').addEventListener('click', () => {
  calYear = today.getFullYear(); calMonth = today.getMonth();
  renderCalendar();
});

// --- queue ------------------------------------------------------------------

function renderQueue() {
  const buckets = [
    { key: 'needs', title: 'Needs your approval', match: (s) => s === 'needs_approval', sort: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
    { key: 'sched', title: 'Scheduled', match: (s) => ['approved', 'scheduled', 'failed'].includes(s), sort: (a, b) => (a.scheduledAt || '~').localeCompare(b.scheduledAt || '~') },
    { key: 'draft', title: 'Drafts', match: (s) => s === 'draft', sort: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
    { key: 'posted', title: 'Posted', match: (s) => s === 'posted', sort: (a, b) => (b.postedAt || '').localeCompare(a.postedAt || '') },
  ];
  const queue = $('#queue');
  queue.innerHTML = '';
  let total = 0;

  for (const b of buckets) {
    const posts = data.posts.filter((p) => b.match(p.status)).sort(b.sort);
    if (posts.length === 0) continue;
    total += posts.length;
    const section = document.createElement('div');
    section.className = 'queue-section' + (b.key === 'needs' ? ' highlight' : '');
    section.innerHTML = `<h3 class="queue-title">${b.title} <span class="count">${posts.length}</span></h3>`;
    const list = document.createElement('div');
    list.className = 'queue-list';
    for (const post of posts) list.appendChild(postRow(post));
    section.appendChild(list);
    queue.appendChild(section);
  }
  if (total === 0) {
    queue.innerHTML = `<div class="empty-state"><p>No posts yet.</p><button class="btn primary" id="empty-new">+ Create your first post</button></div>`;
    $('#empty-new').addEventListener('click', () => openComposer(null));
  }
}

function postRow(post) {
  const el = document.createElement('article');
  el.className = 'qrow';
  const icons = postPlatforms(post).map((p) => platformIcon(p)).join('');
  const thumb = post.mediaIds.map(mediaById).filter(Boolean)[0];
  const when = post.scheduledAt ? `🕒 ${fmtWhen(post.scheduledAt)}` : (post.status === 'posted' && post.postedAt ? `✓ ${fmtWhen(post.postedAt)}` : 'Not scheduled');
  const by = post.createdBy === 'hermes' ? '<span class="tag hermes">Hermes</span>' : '';
  const text = post.content ? escapeHtml(post.content) : '<em class="muted">(photo only)</em>';

  el.innerHTML = `
    ${thumb ? `<img class="qthumb" src="${thumb.url}" alt="" />` : '<div class="qthumb placeholder">📄</div>'}
    <div class="qbody">
      <div class="qtext">${text}</div>
      <div class="qmeta"><span class="picons">${icons}</span><span class="qwhen">${when}</span>${by}</div>
    </div>
    <div class="qactions">${postActions(post)}</div>`;

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')) return;
    openComposer(post);
  });
  el.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); doAction(post, btn.dataset.act); })
  );
  return el;
}

function postActions(post) {
  const b = (act, label, cls = 'ghost') => `<button class="btn ${cls} small" data-act="${act}">${label}</button>`;
  switch (post.status) {
    case 'draft': return b('submit', 'Submit') + b('delete', 'Delete', 'danger');
    case 'needs_approval': return b('approve', '✅ Approve', 'primary') + b('delete', 'Delete', 'danger');
    case 'approved':
    case 'scheduled':
    case 'failed': return b('posted', '✔ Posted', 'primary') + b('revert', 'Draft') + b('delete', 'Delete', 'danger');
    case 'posted': return b('delete', 'Delete', 'danger');
    default: return '';
  }
}

async function doAction(post, act) {
  try {
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
    closeComposer();
    await load();
  } catch (e) {
    alert(e.message);
  }
}

// --- composer ---------------------------------------------------------------

function openComposer(post, presetDate) {
  editingId = post ? post.id : null;
  locked = !!post && !['draft', 'needs_approval'].includes(post.status);
  compose.platforms = new Set(post ? postPlatforms(post) : ['twitter']);
  compose.mediaIds = post ? [...post.mediaIds] : [];

  $('#compose-heading').textContent = post ? (locked ? 'Post' : 'Edit post') : 'New post';
  const pill = $('#compose-status');
  pill.hidden = !post;
  if (post) {
    pill.textContent = STATUS[post.status]?.label || post.status;
    pill.className = `status-pill s-${post.status}`;
  }

  $('#compose-text').value = post ? post.content : '';
  $('#compose-notes').value = post ? post.notes || '' : '';
  let scheduleVal = '';
  if (post && post.scheduledAt) scheduleVal = toInputValue(post.scheduledAt);
  else if (presetDate) { const d = new Date(presetDate); d.setHours(9, 0, 0, 0); scheduleVal = toInputValue(d.toISOString()); }
  $('#compose-schedule').value = scheduleVal;

  // lock inputs for approved/scheduled/posted
  ['#compose-text', '#compose-notes', '#compose-schedule'].forEach((s) => ($(s).disabled = locked));
  $('#attach-btn').style.display = locked ? 'none' : '';

  renderPlatformPicker();
  renderAttachStrip();
  updatePreview();
  buildComposerActions(post);

  $('#compose-backdrop').hidden = false;
  if (!locked) $('#compose-text').focus();
}

function closeComposer() {
  $('#compose-backdrop').hidden = true;
  editingId = null;
  locked = false;
}

function renderPlatformPicker() {
  $('#platform-picker').innerHTML = PLATFORM_IDS.map((id) => {
    const on = compose.platforms.has(id) ? ' on' : '';
    return `<button type="button" class="ptoggle${on}" data-platform="${id}" ${locked ? 'disabled' : ''}>${platformIcon(id)} ${PLATFORMS[id].name}</button>`;
  }).join('');
  if (locked) return;
  $$('#platform-picker .ptoggle').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.platform;
      compose.platforms.has(id) ? compose.platforms.delete(id) : compose.platforms.add(id);
      btn.classList.toggle('on');
      updatePreview();
    })
  );
}

function renderAttachStrip() {
  const strip = $('#attach-strip');
  const items = compose.mediaIds.map(mediaById).filter(Boolean);
  if (items.length === 0) {
    strip.innerHTML = '<span class="muted">No photos attached.</span>';
    return;
  }
  strip.innerHTML = items
    .map((m) => `<span class="attach-item"><img src="${m.url}" alt="" />${locked ? '' : `<button type="button" data-remove="${m.id}">✕</button>`}</span>`)
    .join('');
  if (locked) return;
  strip.querySelectorAll('[data-remove]').forEach((btn) =>
    btn.addEventListener('click', () => {
      compose.mediaIds = compose.mediaIds.filter((id) => id !== btn.dataset.remove);
      renderAttachStrip();
      updatePreview();
    })
  );
}

function updatePreview() {
  const text = $('#compose-text').value;
  const schedule = $('#compose-schedule').value;
  const selected = [...compose.platforms];
  const media = compose.mediaIds.map(mediaById).filter(Boolean);

  // char/warn meta
  const limits = selected.map((id) => PLATFORMS[id].limit);
  const min = limits.length ? Math.min(...limits) : null;
  $('#char-count').textContent = min ? `${text.length} / ${min}` : `${text.length}`;
  const warns = [];
  if (min && text.length > min) {
    const over = selected.filter((id) => text.length > PLATFORMS[id].limit).map((id) => PLATFORMS[id].name);
    warns.push(`Too long for ${over.join(', ')}`);
  }
  if (compose.platforms.has('instagram') && media.length === 0) warns.push('Instagram needs a photo');
  $('#platform-warning').textContent = warns.join(' · ');

  // preview cards
  const box = $('#compose-preview');
  if (selected.length === 0) {
    box.innerHTML = '<div class="preview-empty muted">Pick a platform to see a preview.</div>';
    return;
  }
  box.innerHTML = selected.map((id) => previewCard(id, text, media, schedule)).join('');
}

function previewCard(id, text, media, schedule) {
  const acc = accountFor(id);
  const handle = acc && acc.handle ? acc.handle : PLATFORMS[id].name;
  const name = (acc && acc.displayName) || PLATFORMS[id].name;
  const body = text ? escapeHtml(text) : '<span class="muted">Your text will appear here…</span>';
  const imgs = media.length
    ? `<div class="preview-media${media.length > 1 ? ' multi' : ''}">${media.slice(0, 4).map((m) => `<img src="${m.url}" alt="" />`).join('')}</div>`
    : '';
  const when = schedule ? `Scheduled ${fmtWhen(fromInputValue(schedule))}` : 'Not scheduled';
  return `
    <div class="preview-card">
      <div class="preview-top">
        <span class="avatar">${platformIcon(id)}</span>
        <div class="preview-id"><b>${escapeHtml(name)}</b><span class="muted">${escapeHtml(handle)}</span></div>
      </div>
      <div class="preview-text">${body}</div>
      ${imgs}
      <div class="preview-when muted">${when}</div>
    </div>`;
}

function buildComposerActions(post) {
  const box = $('#compose-actions');
  const b = (act, label, cls = 'ghost') => `<button class="btn ${cls}" data-cact="${act}">${label}</button>`;
  let html = '';
  if (locked) {
    // read-only: show status-appropriate actions
    if (post.status === 'approved' || post.status === 'scheduled' || post.status === 'failed') {
      html = b('delete', 'Delete', 'danger') + '<span class="spacer"></span>' + b('revert', 'Back to draft') + b('posted', '✔ Mark posted', 'primary');
    } else {
      html = b('delete', 'Delete', 'danger') + '<span class="spacer"></span>' + b('close', 'Close', 'ghost');
    }
  } else {
    html =
      (editingId ? b('delete', 'Delete', 'danger') : '') +
      '<span class="spacer"></span>' +
      b('cancel', 'Cancel') +
      b('draft', 'Save draft') +
      b('submit', 'Submit for approval', 'primary');
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-cact]').forEach((btn) =>
    btn.addEventListener('click', () => composerAction(btn.dataset.cact, post))
  );
}

async function composerAction(act, post) {
  if (act === 'cancel' || act === 'close') return closeComposer();
  if (act === 'draft') return saveComposer('draft');
  if (act === 'submit') return saveComposer('needs_approval');
  // status actions operate on the existing post
  if (post) return doAction(post, act);
}

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

async function saveComposer(status) {
  try {
    const payload = composePayload(status);
    if (editingId) await api('PATCH', `/api/posts/${editingId}`, payload);
    else await api('POST', '/api/posts', payload);
    closeComposer();
    await load();
  } catch (e) {
    alert(e.message);
  }
}

['#compose-text', '#compose-schedule'].forEach((s) =>
  $(s).addEventListener('input', updatePreview)
);
$('#new-post-btn').addEventListener('click', () => openComposer(null));
$('#compose-x').addEventListener('click', closeComposer);
$('#compose-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#compose-backdrop')) closeComposer();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#picker-backdrop').hidden) return closePicker();
  if (!$('#compose-backdrop').hidden) closeComposer();
});

// --- photo picker -----------------------------------------------------------

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
    .map((m) => `<button type="button" class="photo-cell${pickerSelection.has(m.id) ? ' selected' : ''}" data-id="${m.id}"><img src="${m.url}" alt="${escapeHtml(m.filename)}" /></button>`)
    .join('');
  grid.querySelectorAll('.photo-cell').forEach((cell) =>
    cell.addEventListener('click', () => {
      const id = cell.dataset.id;
      pickerSelection.has(id) ? pickerSelection.delete(id) : pickerSelection.add(id);
      cell.classList.toggle('selected');
    })
  );
}
$('#picker-done').addEventListener('click', () => {
  compose.mediaIds = data.media.map((m) => m.id).filter((id) => pickerSelection.has(id));
  closePicker();
  renderAttachStrip();
  updatePreview();
});

// --- photos tab -------------------------------------------------------------

function renderPhotos() {
  const grid = $('#photo-grid');
  if (data.media.length === 0) {
    grid.innerHTML = '<p class="muted">No photos yet. Upload some to use in your posts.</p>';
    return;
  }
  grid.innerHTML = data.media
    .map((m) => `
      <figure class="photo-tile">
        <img src="${m.url}" alt="${escapeHtml(m.filename)}" />
        <figcaption>
          <input class="caption-input" data-id="${m.id}" value="${escapeHtml(m.caption || '')}" placeholder="Add a caption…" />
          <button class="btn danger small" data-del="${m.id}">Delete</button>
        </figcaption>
      </figure>`)
    .join('');
  grid.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this photo? It will be removed from any posts using it.')) return;
      try { await api('DELETE', `/api/media/${btn.dataset.del}`); await load(); } catch (e) { alert(e.message); }
    })
  );
  grid.querySelectorAll('.caption-input').forEach((input) =>
    input.addEventListener('change', async () => {
      try { await api('PATCH', `/api/media/${input.dataset.id}`, { caption: input.value }); } catch (e) { alert(e.message); }
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
    .map((a) => `
      <div class="account-row" data-id="${a.id}">
        <span class="account-icon">${platformIcon(a.platform)}</span>
        <span class="account-name">${escapeHtml(a.displayName)}</span>
        <input class="text-input handle" placeholder="@handle" value="${escapeHtml(a.handle || '')}" />
        <label class="toggle"><input type="checkbox" class="connected" ${a.connected ? 'checked' : ''} /> Connected</label>
      </div>`)
    .join('');
  $$('#accounts-list .account-row').forEach((row) => {
    const id = row.dataset.id;
    const save = async () => {
      try {
        await api('PATCH', `/api/accounts/${id}`, {
          handle: row.querySelector('.handle').value,
          connected: row.querySelector('.connected').checked,
        });
        await load();
      } catch (e) { alert(e.message); }
    };
    row.querySelector('.handle').addEventListener('change', save);
    row.querySelector('.connected').addEventListener('change', save);
  });
}

// --- studio (content ideas) -------------------------------------------------

const IDEA_STATUSES = ['idea', 'to_record', 'recorded', 'edited', 'posted'];
const IDEA_STATUS_LABELS = {
  idea: 'Idea',
  to_record: 'To record',
  recorded: 'Recorded',
  edited: 'Edited',
  posted: 'Posted',
};

let editingIdeaId = null;
let ideaPlatforms = new Set();
let recordIdea = null;
let recordIndex = 0;

const totalSeconds = (shots) => (shots || []).reduce((n, s) => n + (+s.seconds || 0), 0);

function renderStudio() {
  const grid = $('#ideas-grid');
  if (!data.ideas.length) {
    grid.innerHTML =
      '<div class="empty-state"><p>No content ideas yet.</p><p class="muted">Ask your AI for short-form ideas (it writes the shot list + talk track), or add one yourself.</p><button class="btn primary" id="empty-idea">+ New idea</button></div>';
    $('#empty-idea').addEventListener('click', () => openIdea(null));
    return;
  }
  const order = { idea: 0, to_record: 1, recorded: 2, edited: 3, posted: 4 };
  grid.innerHTML = '';
  data.ideas
    .slice()
    .sort(
      (a, b) =>
        (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
    )
    .forEach((idea) => grid.appendChild(ideaCard(idea)));
}

function ideaCard(idea) {
  const el = document.createElement('article');
  el.className = 'idea-card';
  const icons = (idea.platforms || []).filter((p) => PLATFORMS[p]).map((p) => platformIcon(p)).join('');
  const by = idea.createdBy === 'hermes' ? '<span class="tag hermes">Hermes</span>' : '';
  el.innerHTML = `
    <div class="idea-top"><span class="status-pill is-${idea.status}">${IDEA_STATUS_LABELS[idea.status] || idea.status}</span>${by}</div>
    <h3 class="idea-hook">${escapeHtml(idea.hook || idea.title)}</h3>
    <p class="idea-concept">${escapeHtml(idea.concept || '')}</p>
    <div class="idea-metarow"><span class="picons">${icons}</span><span class="muted">${idea.shots.length} shots · ~${totalSeconds(idea.shots)}s</span></div>
    <div class="idea-actions">
      <button class="btn primary small" data-iact="record" ${idea.shots.length ? '' : 'disabled'}>▶ Record</button>
      <button class="btn ghost small" data-iact="open">Open brief</button>
    </div>`;
  el.querySelector('[data-iact="record"]').addEventListener('click', (e) => {
    e.stopPropagation();
    if (idea.shots.length) openRecord(idea);
  });
  el.querySelector('[data-iact="open"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openIdea(idea);
  });
  el.addEventListener('click', () => openIdea(idea));
  return el;
}

// --- idea editor ---

function openIdea(idea) {
  editingIdeaId = idea ? idea.id : null;
  $('#idea-heading').textContent = idea ? 'Edit idea' : 'New idea';
  const pill = $('#idea-status');
  if (idea) {
    pill.hidden = false;
    pill.textContent = IDEA_STATUS_LABELS[idea.status] || idea.status;
    pill.className = `status-pill is-${idea.status}`;
  } else {
    pill.hidden = true;
  }
  $('#idea-title').value = idea ? idea.title || '' : '';
  $('#idea-hook').value = idea ? idea.hook || '' : '';
  $('#idea-concept').value = idea ? idea.concept || '' : '';
  $('#idea-caption').value = idea ? idea.caption || '' : '';
  $('#idea-hashtags').value = idea ? (idea.hashtags || []).join(' ') : '';
  ideaPlatforms = new Set(
    idea ? (idea.platforms || []).filter((p) => PLATFORMS[p]) : ['tiktok', 'instagram']
  );
  renderIdeaPlatforms();
  renderShots(idea ? idea.shots.map((s) => ({ ...s })) : []);
  updateIdeaDerived();
  buildIdeaActions(idea);
  $('#idea-backdrop').hidden = false;
  $('#idea-title').focus();
}

function closeIdea() {
  $('#idea-backdrop').hidden = true;
  editingIdeaId = null;
}

function renderIdeaPlatforms() {
  $('#idea-platforms').innerHTML = PLATFORM_IDS.map((id) => {
    const on = ideaPlatforms.has(id) ? ' on' : '';
    return `<button type="button" class="ptoggle${on}" data-ip="${id}">${platformIcon(id)} ${PLATFORMS[id].name}</button>`;
  }).join('');
  $$('#idea-platforms .ptoggle').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.ip;
      ideaPlatforms.has(id) ? ideaPlatforms.delete(id) : ideaPlatforms.add(id);
      btn.classList.toggle('on');
    })
  );
}

function renderShots(shots) {
  const box = $('#idea-shots');
  box.innerHTML = '';
  shots.forEach((s) => box.appendChild(shotRow(s)));
  renumberShots();
}

function shotRow(s) {
  const row = document.createElement('div');
  row.className = 'shot-row';
  row.innerHTML = `
    <div class="shot-num"></div>
    <div class="shot-fields">
      <input class="shot-angle text-input" placeholder="Camera / angle — e.g. close-up, handheld, low angle" value="${escapeHtml(s.angle || '')}" />
      <input class="shot-action text-input" placeholder="Action — what happens on screen" value="${escapeHtml(s.action || '')}" />
      <textarea class="shot-say" rows="2" placeholder="Say — the exact words to speak over this clip">${escapeHtml(s.say || '')}</textarea>
      <div class="shot-foot">
        <label class="sec-label">⏱ <input type="number" class="shot-seconds" min="0" step="1" value="${Number(s.seconds) || 0}" /> sec</label>
        <button type="button" class="btn danger small shot-del">Remove</button>
      </div>
    </div>`;
  row.querySelector('.shot-del').addEventListener('click', () => {
    const box = $('#idea-shots');
    const idx = Array.from(box.children).indexOf(row);
    const shots = collectShotsFromDom();
    shots.splice(idx, 1);
    renderShots(shots);
    updateIdeaDerived();
  });
  return row;
}

function renumberShots() {
  $$('#idea-shots .shot-num').forEach((el, i) => (el.textContent = i + 1));
}

function collectShotsFromDom() {
  return $$('#idea-shots .shot-row').map((row) => ({
    angle: row.querySelector('.shot-angle').value,
    action: row.querySelector('.shot-action').value,
    say: row.querySelector('.shot-say').value,
    seconds: +row.querySelector('.shot-seconds').value || 0,
  }));
}

function updateIdeaDerived() {
  const shots = collectShotsFromDom();
  $('#idea-voiceover').textContent = shots.map((s) => s.say).filter(Boolean).join('\n\n') || '—';
  $('#idea-duration').textContent = shots.length ? `${shots.length} shots · ~${totalSeconds(shots)}s` : '';
}

function collectIdea() {
  const payload = {
    title: $('#idea-title').value,
    hook: $('#idea-hook').value,
    concept: $('#idea-concept').value,
    platforms: [...ideaPlatforms],
    shots: collectShotsFromDom(),
    caption: $('#idea-caption').value,
    hashtags: $('#idea-hashtags').value,
  };
  const sel = $('#idea-status-sel');
  if (sel) payload.status = sel.value;
  return payload;
}

function buildIdeaActions(idea) {
  const box = $('#idea-actions');
  const b = (act, label, cls = 'ghost', extra = '') =>
    `<button class="btn ${cls}" data-iact="${act}" ${extra}>${label}</button>`;
  if (idea) {
    const sel = `<select id="idea-status-sel" class="status-select">${IDEA_STATUSES.map(
      (s) => `<option value="${s}" ${s === idea.status ? 'selected' : ''}>${IDEA_STATUS_LABELS[s]}</option>`
    ).join('')}</select>`;
    box.innerHTML =
      b('delete', 'Delete', 'danger') +
      sel +
      '<span class="spacer"></span>' +
      b('record', '▶ Record', 'ghost') +
      b('convert', 'Turn into post', 'ghost') +
      b('save', 'Save', 'primary');
  } else {
    box.innerHTML = '<span class="spacer"></span>' + b('cancel', 'Cancel') + b('save', 'Save idea', 'primary');
  }
  box.querySelectorAll('[data-iact]').forEach((btn) =>
    btn.addEventListener('click', () => ideaEditorAction(btn.dataset.iact, idea))
  );
}

async function ideaEditorAction(act, idea) {
  if (act === 'cancel') return closeIdea();
  if (act === 'save') return saveIdea();
  if (act === 'record') {
    const shots = collectShotsFromDom();
    if (!shots.length) return alert('Add at least one shot to record.');
    return openRecord({ id: editingIdeaId, shots });
  }
  if (!idea) return;
  if (act === 'delete') {
    if (!confirm('Delete this idea?')) return;
    try {
      await api('DELETE', `/api/ideas/${idea.id}`);
      closeIdea();
      await load();
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (act === 'convert') {
    try {
      await api('PATCH', `/api/ideas/${idea.id}`, collectIdea()); // save latest caption first
      await api('POST', `/api/ideas/${idea.id}/convert`);
      closeIdea();
      await load();
      alert('Added to your Queue as a draft post — attach your final video/thumbnail, then submit for approval.');
    } catch (e) {
      alert(e.message);
    }
  }
}

async function saveIdea() {
  try {
    const payload = collectIdea();
    if (editingIdeaId) await api('PATCH', `/api/ideas/${editingIdeaId}`, payload);
    else await api('POST', '/api/ideas', payload);
    closeIdea();
    await load();
  } catch (e) {
    alert(e.message);
  }
}

$('#new-idea-btn').addEventListener('click', () => openIdea(null));
$('#idea-x').addEventListener('click', closeIdea);
$('#add-shot-btn').addEventListener('click', () => {
  const shots = collectShotsFromDom();
  shots.push({ angle: '', action: '', say: '', seconds: 5 });
  renderShots(shots);
  updateIdeaDerived();
  const rows = $$('#idea-shots .shot-row');
  rows[rows.length - 1]?.querySelector('.shot-angle')?.focus();
});
$('#idea-shots').addEventListener('input', updateIdeaDerived);
$('#idea-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#idea-backdrop')) return closeIdea();
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    copyText($('#idea-voiceover').textContent);
    cp.textContent = 'Copied!';
    setTimeout(() => (cp.textContent = 'Copy'), 1200);
  }
});

// --- record mode (teleprompter) ---

function openRecord(idea) {
  recordIdea = idea;
  recordIndex = 0;
  renderRecordStep();
  $('#record-backdrop').hidden = false;
}
function closeRecord() {
  $('#record-backdrop').hidden = true;
  recordIdea = null;
}
function renderRecordStep() {
  const shots = recordIdea.shots;
  const n = shots.length;
  const body = $('#record-body');
  const prog = $('#record-progress');

  if (recordIndex >= n) {
    prog.textContent = 'All done 🎉';
    body.innerHTML = `<div class="record-done"><h2>That's every shot 🎬</h2><p class="muted">Nice work. Mark it recorded, or go back and edit a shot.</p><div class="record-done-actions"><button class="btn ghost" id="rec-copy-vo">Copy full voice-over</button>${recordIdea.id ? '<button class="btn primary" id="rec-mark">Mark as recorded</button>' : ''}</div></div>`;
    $('#record-prev').disabled = false;
    $('#record-next').hidden = true;
    $('#rec-copy-vo')?.addEventListener('click', () =>
      copyText(shots.map((s) => s.say).filter(Boolean).join('\n\n'))
    );
    $('#rec-mark')?.addEventListener('click', async () => {
      try {
        await api('POST', `/api/ideas/${recordIdea.id}/recorded`);
        closeRecord();
        await load();
      } catch (e) {
        alert(e.message);
      }
    });
    return;
  }

  const s = shots[recordIndex];
  prog.textContent = `Shot ${recordIndex + 1} of ${n}${s.seconds ? ` · ${s.seconds}s` : ''}`;
  body.innerHTML = `
    <div class="record-shotnum">${recordIndex + 1}</div>
    ${s.angle ? `<div class="record-line"><span class="record-tag">🎥 Shoot</span><div>${escapeHtml(s.angle)}</div></div>` : ''}
    ${s.action ? `<div class="record-line"><span class="record-tag">🎬 Action</span><div>${escapeHtml(s.action)}</div></div>` : ''}
    ${s.say ? `<div class="record-say"><span class="record-tag">🎙 Say</span><p>${escapeHtml(s.say)}</p></div>` : ''}`;
  $('#record-prev').disabled = recordIndex === 0;
  $('#record-next').hidden = false;
  $('#record-next').textContent = recordIndex === n - 1 ? 'Finish ✓' : 'Next ›';
}
$('#record-prev').addEventListener('click', () => {
  if (recordIndex > 0) {
    recordIndex--;
    renderRecordStep();
  }
});
$('#record-next').addEventListener('click', () => {
  recordIndex++;
  renderRecordStep();
});
$('#record-x').addEventListener('click', closeRecord);
document.addEventListener('keydown', (e) => {
  if (!$('#record-backdrop').hidden) {
    if (e.key === 'Escape') closeRecord();
    else if (e.key === 'ArrowLeft' && recordIndex > 0) {
      recordIndex--;
      renderRecordStep();
    } else if (e.key === 'ArrowRight') {
      recordIndex++;
      renderRecordStep();
    }
    return;
  }
  if (e.key === 'Escape' && !$('#idea-backdrop').hidden) closeIdea();
});

async function copyText(str) {
  try {
    await navigator.clipboard.writeText(str);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = str;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
  }
}

// --- utils ------------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
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
