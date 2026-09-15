'use strict';

// --- state ------------------------------------------------------------------

// Category ids must match VALID_CATEGORIES in lib/board.js. Labels are display-only.
const CATEGORIES = [
  { id: 'birdie_bus', label: 'Birdie Bus' },
  { id: 'booz_allen', label: 'Booz Allen' },
  { id: 'personal', label: 'Personal' },
];
const DEFAULT_CATEGORY = 'personal';
const categoryLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: id }).label;

let board = { meta: {}, columns: [], tasks: [] };
let activeFilter = 'all';
let editingId = null;

// Columns the user has collapsed (persisted per-browser).
const collapsedColumns = new Set(loadCollapsed());
function loadCollapsed() {
  try {
    return JSON.parse(localStorage.getItem('collapsedColumns') || '[]');
  } catch {
    return [];
  }
}
function toggleColumn(id, colEl) {
  if (collapsedColumns.has(id)) collapsedColumns.delete(id);
  else collapsedColumns.add(id);
  colEl.classList.toggle('collapsed');
  try {
    localStorage.setItem('collapsedColumns', JSON.stringify([...collapsedColumns]));
  } catch {
    /* ignore storage errors (private mode etc.) */
  }
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Build the filter chips and the category dropdowns from CATEGORIES.
function populateCategoryUI() {
  $('#filters').innerHTML =
    `<button class="chip active" data-filter="all">All</button>` +
    CATEGORIES.map((c) => `<button class="chip" data-filter="${c.id}">${c.label}</button>`).join('');

  const options = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('#qa-category').innerHTML = options;
  $('#qa-category').value = DEFAULT_CATEGORY;
  $('#edit-category').innerHTML = options;
}

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

async function loadBoard() {
  board = await api('GET', '/api/board');
  render();
}

// --- rendering --------------------------------------------------------------

function tasksFor(columnId) {
  return board.tasks
    .filter((t) => t.column === columnId)
    .filter((t) => activeFilter === 'all' || t.category === activeFilter)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function render() {
  $('#board-title').textContent = (board.meta && board.meta.title) || 'My Board';
  document.title = (board.meta && board.meta.title) || 'My Board';
  populateColumnSelects();

  const boardEl = $('#board');
  boardEl.innerHTML = '';

  for (const col of board.columns) {
    const tasks = tasksFor(col.id);
    const colEl = document.createElement('section');
    colEl.className = 'column' + (collapsedColumns.has(col.id) ? ' collapsed' : '');
    colEl.dataset.column = col.id;

    const header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML = `
      <button class="col-toggle"><span class="caret">▾</span>${escapeHtml(col.name)}</button>
      <span class="col-head-right">
        <span class="column-count">${tasks.length}</span>
        <button class="col-add" title="Add a card" aria-label="Add a card">+</button>
      </span>`;
    header.querySelector('.col-toggle').addEventListener('click', () => toggleColumn(col.id, colEl));
    header.querySelector('.col-add').addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsedColumns.has(col.id)) toggleColumn(col.id, colEl);
      quickAddInColumn(col.id);
    });
    colEl.appendChild(header);

    const cards = document.createElement('div');
    cards.className = 'column-cards';
    cards.dataset.column = col.id;
    for (const task of tasks) cards.appendChild(renderCard(task));
    colEl.appendChild(cards);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-card';
    addBtn.textContent = '+ Add a card';
    addBtn.addEventListener('click', () => quickAddInColumn(col.id));
    colEl.appendChild(addBtn);

    setupColumnDnd(cards);
    boardEl.appendChild(colEl);
  }
}

function renderCard(task) {
  const el = document.createElement('article');
  el.className = `card priority-${task.priority}`;
  el.draggable = true;
  el.dataset.id = task.id;

  const hasDesc = task.description && task.description.trim().length > 0;
  // One-tap move buttons for every column except the one the card is in.
  const moveButtons = board.columns
    .filter((c) => c.id !== task.column)
    .map((c) => `<button class="move-btn to-${c.id}" data-move="${c.id}">${escapeHtml(c.name)}</button>`)
    .join('');

  el.innerHTML = `
    <div class="card-title">${escapeHtml(task.title)}</div>
    <div class="card-meta">
      <span class="tag cat-${task.category}">${escapeHtml(categoryLabel(task.category))}</span>
      <span class="tag priority-${task.priority}">${task.priority}</span>
      ${hasDesc ? '<span class="card-desc-indicator" title="Has description">☰</span>' : ''}
    </div>
    ${moveButtons ? `<div class="move-row">${moveButtons}</div>` : ''}`;

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-move]')) return; // don't open the editor when moving
    if (el.dataset.swiped) { delete el.dataset.swiped; return; } // ignore click after a swipe
    openEditModal(task.id);
  });
  el.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveTask(task.id, btn.dataset.move);
    })
  );
  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  attachSwipe(el, task);
  return el;
}

// Swipe a card left/right (on touch) to move it to the next/previous column.
function attachSwipe(el, task) {
  let startX = 0;
  let startY = 0;
  let active = false;
  el.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      active = true;
    },
    { passive: true }
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      if (!active) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        el.dataset.swiped = '1';
        el.style.transition = 'none';
        el.style.transform = `translateX(${dx}px)`;
        el.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 400));
      }
    },
    { passive: true }
  );
  const end = (e) => {
    if (!active) return;
    active = false;
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
    if (!el.dataset.swiped) return;
    const dx = (e.changedTouches ? e.changedTouches[0].clientX : startX) - startX;
    const cols = board.columns.map((c) => c.id);
    const idx = cols.indexOf(task.column);
    if (dx <= -60 && idx < cols.length - 1) moveTask(task.id, cols[idx + 1]);
    else if (dx >= 60 && idx > 0) moveTask(task.id, cols[idx - 1]);
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// Move a card to another column with one tap (optimistic, then persist).
async function moveTask(id, columnId) {
  const task = board.tasks.find((t) => t.id === id);
  if (task) task.column = columnId; // optimistic
  render();
  try {
    await api('PATCH', `/api/tasks/${id}`, { column: columnId });
    await loadBoard();
  } catch (e) {
    alert('Could not move card: ' + e.message);
    await loadBoard();
  }
}

// --- drag and drop ----------------------------------------------------------

function setupColumnDnd(cardsEl) {
  cardsEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    cardsEl.classList.add('drag-over');
    const dragging = $('.card.dragging');
    if (!dragging) return;
    const after = getDragAfterElement(cardsEl, e.clientY);
    if (after == null) cardsEl.appendChild(dragging);
    else cardsEl.insertBefore(dragging, after);
  });
  cardsEl.addEventListener('dragleave', () => cardsEl.classList.remove('drag-over'));
  cardsEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    cardsEl.classList.remove('drag-over');
    await persistColumnOrder(cardsEl.dataset.column);
  });
}

function getDragAfterElement(container, y) {
  const cards = Array.from(container.querySelectorAll('.card:not(.dragging)'));
  return cards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

// After a drop, read the new DOM order of every column and persist it.
async function persistColumnOrder(_columnId) {
  const updates = [];
  $$('.column-cards').forEach((cardsEl) => {
    const colId = cardsEl.dataset.column;
    Array.from(cardsEl.querySelectorAll('.card')).forEach((cardEl, index) => {
      updates.push({ id: cardEl.dataset.id, column: colId, order: index });
    });
  });
  // optimistic local update so the UI doesn't flicker
  for (const u of updates) {
    const t = board.tasks.find((x) => x.id === u.id);
    if (t) {
      t.column = u.column;
      t.order = u.order;
    }
  }
  try {
    board = await api('POST', '/api/reorder', { updates });
  } catch (e) {
    alert('Could not save changes: ' + e.message);
  }
  render();
}

// --- quick add --------------------------------------------------------------

function populateColumnSelects() {
  const options = board.columns
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');
  $('#qa-column').innerHTML = options;
  $('#edit-column').innerHTML = options;
}

function toggleQuickAdd(show, columnId) {
  const form = $('#quick-add');
  form.hidden = !show;
  if (show) {
    if (columnId) $('#qa-column').value = columnId;
    $('#qa-title').focus();
  }
}

function quickAddInColumn(columnId) {
  toggleQuickAdd(true, columnId);
}

$('#quick-add-btn').addEventListener('click', () => {
  const form = $('#quick-add');
  toggleQuickAdd(form.hidden);
});
$('#qa-cancel').addEventListener('click', () => toggleQuickAdd(false));

$('#quick-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#qa-title').value.trim();
  if (!title) return;
  const task = {
    title,
    category: $('#qa-category').value,
    priority: $('#qa-priority').value,
    column: $('#qa-column').value,
  };
  try {
    await api('POST', '/api/tasks', task);
    $('#qa-title').value = '';
    await loadBoard();
    $('#qa-title').focus();
  } catch (err) {
    alert('Could not add: ' + err.message);
  }
});

// --- filters ----------------------------------------------------------------

$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  $$('.chip').forEach((c) => c.classList.toggle('active', c === btn));
  render();
});

// --- edit modal -------------------------------------------------------------

function openEditModal(id) {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) return;
  editingId = id;
  $('#edit-title').value = task.title;
  $('#edit-description').value = task.description || '';
  $('#edit-category').value = task.category;
  $('#edit-priority').value = task.priority;
  $('#edit-column').value = task.column;
  $('#modal-backdrop').hidden = false;
  $('#edit-title').focus();
}

function closeModal() {
  $('#modal-backdrop').hidden = true;
  editingId = null;
}

$('#edit-cancel').addEventListener('click', closeModal);
$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#modal-backdrop')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal();
});

$('#edit-save').addEventListener('click', async () => {
  if (!editingId) return;
  const update = {
    title: $('#edit-title').value.trim(),
    description: $('#edit-description').value,
    category: $('#edit-category').value,
    priority: $('#edit-priority').value,
    column: $('#edit-column').value,
  };
  try {
    await api('PATCH', `/api/tasks/${editingId}`, update);
    closeModal();
    await loadBoard();
  } catch (err) {
    alert('Could not save: ' + err.message);
  }
});

$('#edit-delete').addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Delete this card?')) return;
  try {
    await api('DELETE', `/api/tasks/${editingId}`);
    closeModal();
    await loadBoard();
  } catch (err) {
    alert('Could not delete: ' + err.message);
  }
});

// --- utils ------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- boot -------------------------------------------------------------------

populateCategoryUI();
loadBoard().catch((err) => {
  document.body.innerHTML = `<p style="padding:24px">Could not load board: ${escapeHtml(
    err.message
  )}</p>`;
});
