(function() {
'use strict';

/* ========== CONSTANTS ========== */
const STORE = 'items';
const SETTINGS_STORE = 'settings';
const DB_NAME = 'PocketFlowDB';
const DB_VER = 1;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ========== DATABASE ========== */
class DB {
  constructor() {
    this.db = null;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('timestamp', 'timestamp', { unique: false });
          s.createIndex('pinned', 'pinned', { unique: false });
          s.createIndex('favorited', 'favorited', { unique: false });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { this.db = e.target.result; resolve(); };
      req.onerror = e => reject(e.target.error);
    });
  }

  _tx(name, mode) {
    return this.db.transaction(name, mode).objectStore(name);
  }

  async add(store, data) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').add(data);
      r.onsuccess = () => resolve(r.result);
      r.onerror = e => reject(e.target.error);
    });
  }

  async put(store, data) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').put(data);
      r.onsuccess = () => resolve(r.result);
      r.onerror = e => reject(e.target.error);
    });
  }

  async get(store, id) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readonly').get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = e => reject(e.target.error);
    });
  }

  async getAll(store) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readonly').getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = e => reject(e.target.error);
    });
  }

  async delete(store, id) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').delete(id);
      r.onsuccess = () => resolve();
      r.onerror = e => reject(e.target.error);
    });
  }

  async clear(store) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').clear();
      r.onsuccess = () => resolve();
      r.onerror = e => reject(e.target.error);
    });
  }

  async getByIndex(store, idx, val) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readonly').index(idx).getAll(val);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = e => reject(e.target.error);
    });
  }

  async getByType(type) {
    return this.getByIndex(STORE, 'type', type);
  }

  async getSetting(key, def = null) {
    const v = await this.get(SETTINGS_STORE, key);
    return v ? v.value : def;
  }

  async setSetting(key, value) {
    return this.put(SETTINGS_STORE, { key, value });
  }
}

/* ========== STATE ========== */
const state = {
  db: new DB(),
  items: [],
  panelOpen: false,
  theme: 'dark',
  autoDelete: 'never',
  settings: {},
  clipboardWatcher: null,
  editingNote: null,
  searchFilter: 'all',
  bubblePos: { x: 16, y: 100 }
};

/* ========== ICON HELPER ========== */
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

/* ========== NOTIFICATION ========== */
function notify(text, type = 'info', duration = 3000) {
  const container = document.getElementById('notifications');
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  const iconMap = { success: 'check', error: 'delete', warning: 'warning', info: 'info' };
  const iconDiv = document.createElement('div');
  iconDiv.className = 'notif-icon';
  iconDiv.append(icon(iconMap[type] || 'info'));
  el.append(iconDiv);
  const textSpan = document.createElement('span');
  textSpan.className = 'notif-text';
  textSpan.textContent = text;
  el.append(textSpan);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'notif-close';
  closeBtn.append(icon('close'));
  closeBtn.addEventListener('click', () => removeNotif(el));
  el.append(closeBtn);
  container.append(el);
  setTimeout(() => removeNotif(el), duration);
}

function removeNotif(el) {
  if (!el.parentNode) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 300);
}

/* ========== TIME HELPERS ========== */
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

/* ========== DATABASE OPERATIONS ========== */
async function loadItems() {
  state.items = await state.db.getAll(STORE);
  state.items.sort((a, b) => b.timestamp - a.timestamp);
}

async function addItem(data) {
  const item = {
    id: genId(),
    timestamp: Date.now(),
    pinned: false,
    favorited: false,
    ...data
  };
  await state.db.add(STORE, item);
  state.items.unshift(item);
  updateBadge();
  return item;
}

async function updateItem(item) {
  await state.db.put(STORE, item);
}

async function deleteItem(id) {
  await state.db.delete(STORE, id);
  state.items = state.items.filter(i => i.id !== id);
  updateBadge();
}

async function togglePin(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.pinned = !item.pinned;
  await updateItem(item);
  return item;
}

async function toggleFav(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.favorited = !item.favorited;
  await updateItem(item);
  return item;
}

async function renameItem(id, newTitle) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.title = newTitle;
  await updateItem(item);
  return item;
}

async function clearAllData() {
  await state.db.clear(STORE);
  state.items = [];
  updateBadge();
  renderAll();
  notify('All data cleared', 'warning');
}

function updateBadge() {
  const badge = document.getElementById('bubble-badge');
  if (!badge) return;
  const count = state.items.filter(i => !i.pinned).length;
  badge.textContent = count > 99 ? '99+' : count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

/* ========== SETTINGS ========== */
async function loadSettings() {
  state.theme = await state.db.getSetting('theme', 'dark');
  state.autoDelete = await state.db.getSetting('autoDelete', 'never');
  applyTheme(state.theme);
  document.getElementById('auto-delete-select').value = state.autoDelete;
  if (state.theme === 'dark') {
    document.getElementById('theme-dark').classList.add('active');
    document.getElementById('theme-light').classList.remove('active');
  } else {
    document.getElementById('theme-light').classList.add('active');
    document.getElementById('theme-dark').classList.remove('active');
  }
}

async function setTheme(t) {
  state.theme = t;
  await state.db.setSetting('theme', t);
  applyTheme(t);
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
}

/* ========== AUTO DELETE ========== */
let autoDeleteTimer = null;

function startAutoDelete() {
  if (autoDeleteTimer) clearInterval(autoDeleteTimer);
  if (state.autoDelete === 'never') return;
  autoDeleteTimer = setInterval(runAutoDelete, 60000);
}

async function runAutoDelete() {
  if (state.autoDelete === 'never') return;
  const maxAge = parseInt(state.autoDelete);
  const now = Date.now();
  const toDelete = state.items.filter(i => !i.pinned && (now - i.timestamp) > maxAge);
  for (const item of toDelete) {
    await deleteItem(item.id);
  }
  if (toDelete.length) {
    renderAll();
  }
}

/* ========== BUBBLE DRAG ========== */
function initBubble() {
  const bubble = document.getElementById('bubble');
  if (!bubble) return;
  let isDragging = false;
  let startX, startY, origX, origY;
  let moved = false;
  let tapTimeout = null;
  let longPressTimeout = null;
  let lastTap = 0;

  // Restore position
  try {
    const saved = localStorage.getItem('pocketflow_bubble_pos');
    if (saved) {
      const p = JSON.parse(saved);
      bubble.style.left = p.x + 'px';
      bubble.style.top = p.y + 'px';
      state.bubblePos = p;
    } else {
      positionBubble(bubble);
    }
  } catch {
    positionBubble(bubble);
  }

  function positionBubble(b) {
    b.style.left = '16px';
    b.style.top = '100px';
  }

  function getPos(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  function onStart(e) {
    isDragging = true;
    moved = false;
    const p = getPos(e);
    const rect = bubble.getBoundingClientRect();
    startX = p.x;
    startY = p.y;
    origX = rect.left;
    origY = rect.top;
    bubble.style.transition = 'none';
    clearTimeout(longPressTimeout);
    longPressTimeout = setTimeout(() => {
      if (!moved && isDragging) {
        openTab('settings');
        openPanel();
        notify('Long press → Settings opened', 'info');
      }
    }, 800);
  }

  function onMove(e) {
    if (!isDragging) return;
    const p = getPos(e);
    const dx = p.x - startX;
    const dy = p.y - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    const newX = origX + dx;
    const newY = origY + dy;
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 60;
    bubble.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
    bubble.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
    if (e.cancelable) e.preventDefault();
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    clearTimeout(longPressTimeout);
    bubble.style.transition = 'left 0.3s ease, top 0.3s ease';
    snapToEdge(bubble);

    if (!moved) {
      // Check double tap
      const now = Date.now();
      if (now - lastTap < 350) {
        // Double tap
        clearTimeout(tapTimeout);
        lastTap = 0;
        openQuickPocket();
        return;
      }
      lastTap = now;
      tapTimeout = setTimeout(() => {
        // Single tap
        togglePanel();
      }, 350);
    }
  }

  function snapToEdge(b) {
    const rect = b.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    const left = rect.left;
    const top = rect.top;
    const bottom = window.innerHeight - rect.bottom;
    let newX = parseInt(b.style.left);
    let newY = parseInt(b.style.top);
    // Snap horizontally to nearest edge
    if (left < right) {
      newX = 8;
    } else {
      newX = window.innerWidth - 64;
    }
    // Keep vertical within bounds
    if (top < 20) newY = 8;
    else if (bottom < 20) newY = window.innerHeight - 64;
    b.style.left = newX + 'px';
    b.style.top = newY + 'px';
    state.bubblePos = { x: newX, y: newY };
    try { localStorage.setItem('pocketflow_bubble_pos', JSON.stringify(state.bubblePos)); } catch {}
  }

  bubble.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  bubble.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

/* ========== PANEL ========== */
function openPanel() {
  if (state.panelOpen) return;
  state.panelOpen = true;
  document.getElementById('panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
  document.body.classList.add('panel-open');
  renderAll();
}

function closePanel() {
  if (!state.panelOpen) return;
  state.panelOpen = false;
  document.getElementById('panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('open');
  document.body.classList.remove('panel-open');
  document.getElementById('panel-back').style.display = 'none';
}

function togglePanel() {
  if (state.panelOpen) closePanel();
  else openPanel();
}

function openTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  const content = document.getElementById(`tab-${name}`);
  if (tab) tab.classList.add('active');
  if (content) content.classList.add('active');
  document.getElementById('panel-back').style.display = 'none';
}

/* ========== QUICK POCKET ========== */
function openQuickPocket() {
  const qp = document.getElementById('quick-pocket');
  qp.classList.add('open');
  qp.querySelector('textarea').focus();
}

function closeQuickPocket() {
  document.getElementById('quick-pocket').classList.remove('open');
}

async function saveQuickPocket() {
  const textarea = document.getElementById('quick-pocket-input');
  const text = textarea.value.trim();
  if (!text) return;
  await addItem({
    type: 'text',
    title: text.slice(0, 60),
    content: text,
    contentType: 'text/plain'
  });
  textarea.value = '';
  closeQuickPocket();
  notify('Item saved to Pocket', 'success');
  renderAll();
}

/* ========== RENDER HELPERS ========== */
function formatType(type) {
  const map = { text: 'Text', image: 'Image', file: 'File', link: 'Link', note: 'Note', clipboard: 'Clipboard', screenshot: 'Screenshot' };
  return map[type] || type;
}

function getTypeIcon(type) {
  const map = { text: 'notes', image: 'image', file: 'file', link: 'link', note: 'notes', clipboard: 'clipboard', screenshot: 'screenshot' };
  return map[type] || 'file';
}

function createActions(item, opts = {}) {
  const div = document.createElement('div');
  div.className = 'item-actions';
  const btns = [
    { icon: 'copy', title: 'Copy', action: () => copyItem(item) },
    { icon: 'share', title: 'Share', action: () => shareItem(item) },
    { icon: 'pin', title: 'Pin', cls: item.pinned ? 'active' : '', action: async () => { await togglePin(item.id); renderAll(); } },
    { icon: 'favorite', title: 'Favorite', cls: item.favorited ? 'active' : '', action: async () => { await toggleFav(item.id); renderAll(); } },
    { icon: 'rename', title: 'Rename', action: () => promptRename(item) },
    { icon: 'delete', title: 'Delete', action: async () => { await deleteItem(item.id); renderAll(); notify('Item deleted', 'error'); } }
  ];
  for (const b of btns) {
    if (opts.exclude && opts.exclude.includes(b.icon)) continue;
    const btn = document.createElement('button');
    btn.className = `${b.icon}-btn` + (b.cls ? ' ' + b.cls : '');
    btn.title = b.title;
    btn.append(icon(b.icon));
    btn.addEventListener('click', e => { e.stopPropagation(); b.action(); });
    div.append(btn);
  }
  return div;
}

function createCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card' + (item.pinned ? ' pinned' : '') + (item.favorited ? ' favorited' : '');
  card.dataset.id = item.id;

  if (item.type === 'image' || item.type === 'screenshot') {
    const img = document.createElement('img');
    img.className = 'item-preview-img';
    img.src = item.content;
    img.alt = item.title || 'Image';
    img.loading = 'lazy';
    img.addEventListener('click', () => showImagePreview(item.content));
    card.append(img);
  } else if (item.type === 'file' && item.contentType && item.contentType.startsWith('image/')) {
    const img = document.createElement('img');
    img.className = 'item-preview-img';
    img.src = item.content;
    img.alt = item.title || 'Image';
    img.loading = 'lazy';
    img.addEventListener('click', () => showImagePreview(item.content));
    card.append(img);
  } else {
    const iconDiv = document.createElement('div');
    iconDiv.className = 'item-type-icon';
    iconDiv.append(icon(getTypeIcon(item.type)));
    card.append(iconDiv);
  }

  if (item.pinned) {
    const pinBadge = document.createElement('div');
    pinBadge.className = 'item-pinned-badge';
    pinBadge.append(icon('pin'));
    card.append(pinBadge);
  }

  const title = document.createElement('div');
  title.className = 'item-title';
  title.textContent = item.title || formatType(item.type);
  card.append(title);

  const meta = document.createElement('div');
  meta.className = 'item-meta';
  meta.textContent = `${formatType(item.type)} · ${timeAgo(item.timestamp)}`;
  if (item.fileSize) meta.textContent += ` · ${formatSize(item.fileSize)}`;
  card.append(meta);

  // Preview text for text/clipboard
  if ((item.type === 'text' || item.type === 'clipboard') && item.content) {
    const preview = document.createElement('div');
    preview.className = 'text-preview';
    preview.textContent = item.content.length > 120 ? item.content.slice(0, 120) + '...' : item.content;
    card.append(preview);
  }

  if (item.type === 'link' && item.content) {
    const link = document.createElement('a');
    link.className = 'link-preview';
    link.href = item.content;
    link.textContent = item.content.length > 50 ? item.content.slice(0, 50) + '...' : item.content;
    link.target = '_blank';
    link.rel = 'noopener';
    card.append(link);
  }

  card.append(createActions(item));
  return card;
}

function createClipboardItem(item) {
  const div = document.createElement('div');
  div.className = 'clipboard-item' + (item.pinned ? ' pinned' : '');
  div.dataset.id = item.id;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'clip-icon';
  iconDiv.append(icon('clipboard'));
  div.append(iconDiv);

  const content = document.createElement('div');
  content.className = 'clip-content';

  const text = document.createElement('div');
  text.className = 'clip-text';
  text.textContent = item.content || item.title || '';
  content.append(text);

  const time = document.createElement('div');
  time.className = 'clip-time';
  time.textContent = formatTime(item.timestamp);
  content.append(time);
  div.append(content);

  const actions = document.createElement('div');
  actions.className = 'clip-actions';

  const copyBtn = document.createElement('button');
  copyBtn.title = 'Copy';
  copyBtn.append(icon('copy'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      notify('Copied to clipboard', 'success');
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = item.content;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      notify('Copied to clipboard', 'success');
    }
  });
  actions.append(copyBtn);

  const pinBtn = document.createElement('button');
  pinBtn.title = 'Pin';
  pinBtn.className = item.pinned ? 'active' : '';
  pinBtn.append(icon('pin'));
  pinBtn.addEventListener('click', async () => { await togglePin(item.id); renderAll(); });
  actions.append(pinBtn);

  const shareBtn = document.createElement('button');
  shareBtn.title = 'Share';
  shareBtn.append(icon('share'));
  shareBtn.addEventListener('click', () => shareItem(item));
  actions.append(shareBtn);

  const delBtn = document.createElement('button');
  delBtn.title = 'Delete';
  delBtn.append(icon('delete'));
  delBtn.addEventListener('click', async () => { await deleteItem(item.id); renderAll(); notify('Deleted', 'error'); });
  actions.append(delBtn);

  div.append(actions);
  return div;
}

function createFileItem(item) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.id = item.id;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'file-icon';
  iconDiv.append(icon(getTypeIcon(item.type)));
  div.append(iconDiv);

  const info = document.createElement('div');
  info.className = 'file-info';

  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = item.fileName || item.title || 'Untitled';
  info.append(name);

  const size = document.createElement('div');
  size.className = 'file-size';
  size.textContent = formatSize(item.fileSize) + ' · ' + formatType(item.type) + ' · ' + timeAgo(item.timestamp);
  info.append(size);
  div.append(info);

  const actions = document.createElement('div');
  actions.className = 'file-actions';

  if (item.type === 'image' || item.type === 'screenshot' || (item.contentType && item.contentType.startsWith('image/'))) {
    const viewBtn = document.createElement('button');
    viewBtn.title = 'Preview';
    viewBtn.append(icon('image'));
    viewBtn.addEventListener('click', () => showImagePreview(item.content));
    actions.append(viewBtn);
  }

  const downloadBtn = document.createElement('button');
  downloadBtn.title = 'Download';
  downloadBtn.append(icon('download'));
  downloadBtn.addEventListener('click', () => downloadItem(item));
  actions.append(downloadBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.title = 'Delete';
  deleteBtn.append(icon('delete'));
  deleteBtn.addEventListener('click', async () => { await deleteItem(item.id); renderAll(); notify('Deleted', 'error'); });
  actions.append(deleteBtn);

  div.append(actions);
  return div;
}

function createNoteCard(item) {
  const card = document.createElement('div');
  card.className = 'note-card' + (item.pinned ? ' pinned' : '') + (item.favorited ? ' favorited' : '');
  card.dataset.id = item.id;

  const title = document.createElement('div');
  title.className = 'note-title';
  title.textContent = item.title || 'Untitled Note';
  card.append(title);

  const body = document.createElement('div');
  body.className = 'note-body';
  body.textContent = item.content || '';
  card.append(body);

  const meta = document.createElement('div');
  meta.className = 'note-meta';
  meta.textContent = timeAgo(item.timestamp);
  card.append(meta);

  const actions = document.createElement('div');
  actions.className = 'note-actions';

  const editBtn = document.createElement('button');
  editBtn.title = 'Edit';
  editBtn.append(icon('edit'));
  editBtn.addEventListener('click', () => openNoteEditor(item));
  actions.append(editBtn);

  const pinBtn = document.createElement('button');
  pinBtn.title = 'Pin';
  pinBtn.className = item.pinned ? 'active' : '';
  pinBtn.append(icon('pin'));
  pinBtn.addEventListener('click', async () => { await togglePin(item.id); renderAll(); });
  actions.append(pinBtn);

  const favBtn = document.createElement('button');
  favBtn.title = 'Favorite';
  favBtn.className = item.favorited ? 'active' : '';
  favBtn.append(icon('favorite'));
  favBtn.addEventListener('click', async () => { await toggleFav(item.id); renderAll(); });
  actions.append(favBtn);

  const copyBtn = document.createElement('button');
  copyBtn.title = 'Copy';
  copyBtn.append(icon('copy'));
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(item.content || ''); notify('Copied', 'success'); } catch {}
  });
  actions.append(copyBtn);

  const delBtn = document.createElement('button');
  delBtn.title = 'Delete';
  delBtn.append(icon('delete'));
  delBtn.addEventListener('click', async () => { await deleteItem(item.id); renderAll(); notify('Note deleted', 'error'); });
  actions.append(delBtn);

  card.append(actions);
  return card;
}

function createScreenshotItem(item) {
  const div = document.createElement('div');
  div.className = 'screenshot-item';
  div.dataset.id = item.id;

  const img = document.createElement('img');
  img.src = item.content;
  img.alt = item.title || 'Screenshot';
  img.loading = 'lazy';
  img.addEventListener('click', () => showImagePreview(item.content));
  div.append(img);

  const overlay = document.createElement('div');
  overlay.className = 'screenshot-overlay';

  const shareBtn = document.createElement('button');
  shareBtn.title = 'Share';
  shareBtn.append(icon('share'));
  shareBtn.addEventListener('click', e => { e.stopPropagation(); shareItem(item); });
  overlay.append(shareBtn);

  const downloadBtn = document.createElement('button');
  downloadBtn.title = 'Download';
  downloadBtn.append(icon('download'));
  downloadBtn.addEventListener('click', e => { e.stopPropagation(); downloadItem(item); });
  overlay.append(downloadBtn);

  const delBtn = document.createElement('button');
  delBtn.title = 'Delete';
  delBtn.append(icon('delete'));
  delBtn.addEventListener('click', e => { e.stopPropagation(); deleteItem(item.id); renderAll(); notify('Deleted', 'error'); });
  overlay.append(delBtn);

  div.append(overlay);
  return div;
}

/* ========== RENDER ALL ========== */
function renderAll() {
  renderDashboard();
  renderRecent();
  renderClipboard();
  renderPocket();
  renderScreenshots();
  renderFiles();
  renderNotes();
  renderSearch();
}

function renderDashboard() {
  const total = state.items.length;
  const clipboard = state.items.filter(i => i.type === 'clipboard').length;
  const favorites = state.items.filter(i => i.favorited).length;
  const images = state.items.filter(i => i.type === 'image' || i.type === 'screenshot').length;
  const notes = state.items.filter(i => i.type === 'note').length;
  const files = state.items.filter(i => i.type === 'file').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-clipboard').textContent = clipboard;
  document.getElementById('stat-favorites').textContent = favorites;
  document.getElementById('stat-images').textContent = images;
  document.getElementById('stat-notes').textContent = notes;
  document.getElementById('stat-files').textContent = files;

  // Activity
  const list = document.getElementById('activity-list');
  list.innerHTML = '';
  const recent = state.items.slice(0, 10);
  if (!recent.length) {
    list.innerHTML = '<div class="activity-empty">No recent activity</div>';
    return;
  }
  for (const item of recent) {
    const el = document.createElement('div');
    el.className = 'activity-item';
    el.append(icon(getTypeIcon(item.type)));
    const text = document.createElement('span');
    text.className = 'activity-text';
    text.textContent = `${item.title || formatType(item.type)} ${item.pinned ? '📌' : ''}`;
    el.append(text);
    const time = document.createElement('span');
    time.className = 'activity-time';
    time.textContent = timeAgo(item.timestamp);
    el.append(time);
    list.append(el);
  }
}

function renderRecent() {
  const grid = document.getElementById('recent-items-grid');
  grid.innerHTML = '';
  const items = state.items.slice(0, 20);
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><use href="#icon-recent"/></svg><p>No items yet</p></div>';
    return;
  }
  for (const item of items) {
    grid.append(createCard(item));
  }
}

function renderClipboard() {
  const list = document.getElementById('clipboard-list');
  const searchVal = (document.getElementById('clipboard-search').value || '').toLowerCase();
  list.innerHTML = '';
  let items = state.items.filter(i => i.type === 'clipboard');
  if (searchVal) items = items.filter(i => (i.content || '').toLowerCase().includes(searchVal) || (i.title || '').toLowerCase().includes(searchVal));
  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><use href="#icon-clipboard"/></svg><p>No clipboard items</p></div>';
    return;
  }
  for (const item of items) {
    list.append(createClipboardItem(item));
  }
}

function renderPocket() {
  const grid = document.getElementById('pocket-items-grid');
  grid.innerHTML = '';
  const items = state.items.filter(i => i.type !== 'clipboard' && i.type !== 'note');
  if (!items.length) {
    grid.innerHTML = '';
    return;
  }
  for (const item of items) {
    grid.append(createCard(item));
  }
}

function renderScreenshots() {
  const grid = document.getElementById('screenshot-grid');
  grid.innerHTML = '';
  const items = state.items.filter(i => i.type === 'screenshot' || (i.type === 'image'));
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><use href="#icon-screenshot"/></svg><p>No screenshots</p></div>';
    return;
  }
  for (const item of items) {
    grid.append(createScreenshotItem(item));
  }
}

function renderFiles() {
  const list = document.getElementById('file-list');
  const searchVal = (document.getElementById('files-search').value || '').toLowerCase();
  list.innerHTML = '';
  let items = state.items.filter(i => i.type === 'file');
  if (searchVal) items = items.filter(i => (i.fileName || i.title || '').toLowerCase().includes(searchVal));
  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><use href="#icon-folder"/></svg><p>No files</p></div>';
    return;
  }
  for (const item of items) {
    list.append(createFileItem(item));
  }
}

function renderNotes() {
  const grid = document.getElementById('notes-grid');
  grid.innerHTML = '';
  const items = state.items.filter(i => i.type === 'note');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><use href="#icon-notes"/></svg><p>No notes</p></div>';
    return;
  }
  for (const item of items) {
    grid.append(createNoteCard(item));
  }
}

function renderSearch() {
  const results = document.getElementById('search-results');
  const query = (document.getElementById('global-search').value || '').toLowerCase();
  if (!query) {
    results.innerHTML = '<div class="search-empty">Start typing to search across all items</div>';
    return;
  }
  let items = state.items;
  if (state.searchFilter !== 'all') {
    items = items.filter(i => i.type === state.searchFilter);
  }
  items = items.filter(i => {
    const searchable = [i.title, i.content, i.fileName, i.type].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(query);
  });
  if (!items.length) {
    results.innerHTML = '<div class="search-empty">No results found</div>';
    return;
  }
  results.innerHTML = '';
  for (const item of items) {
    results.append(createCard(item));
  }
}

/* ========== ITEM ACTIONS ========== */
async function copyItem(item) {
  let text = item.content || item.title || '';
  if (item.type === 'image' || item.type === 'screenshot') {
    try {
      const blob = await (await fetch(item.content)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      notify('Image copied to clipboard', 'success');
    } catch {
      notify('Could not copy image', 'error');
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    notify('Copied to clipboard', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    notify('Copied to clipboard', 'success');
  }
}

async function shareItem(item) {
  const shareData = {};
  if (item.type === 'image' || item.type === 'screenshot') {
    try {
      const blob = await (await fetch(item.content)).blob();
      const file = new File([blob], item.fileName || 'image.png', { type: blob.type });
      shareData.files = [file];
    } catch {}
  }
  if (item.content) shareData.text = item.content;
  if (item.title) shareData.title = item.title;
  if (navigator.share && shareData.files) {
    try { await navigator.share(shareData); return; } catch {}
  }
  if (navigator.share && shareData.text) {
    try { await navigator.share(shareData); return; } catch {}
  }
  // Fallback: copy to clipboard
  if (item.content) {
    await copyItem(item);
    notify('Shared via clipboard', 'info');
  }
}

function downloadItem(item) {
  const a = document.createElement('a');
  a.href = item.content;
  a.download = item.fileName || item.title || 'download';
  document.body.append(a);
  a.click();
  a.remove();
  notify('Download started', 'info');
}

function showImagePreview(src) {
  const existing = document.querySelector('.preview-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  const img = document.createElement('img');
  img.src = src;
  img.alt = 'Preview';
  overlay.append(img);
  const close = document.createElement('button');
  close.className = 'preview-close';
  close.append(icon('close'));
  close.addEventListener('click', () => overlay.remove());
  overlay.append(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function promptRename(item) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>Rename</h3><input type="text" class="rename-input" value="${item.title || ''}" placeholder="Enter new name">`;
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());
  actions.append(cancel);
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    const input = modal.querySelector('.rename-input');
    const val = input.value.trim();
    if (val) {
      await renameItem(item.id, val);
      renderAll();
      notify('Renamed successfully', 'success');
    }
    overlay.remove();
  });
  actions.append(save);
  modal.append(actions);
  overlay.append(modal);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  modal.querySelector('.rename-input').focus();
  modal.querySelector('.rename-input').select();
}

/* ========== CLIPBOARD CAPTURE ========== */
function initClipboardCapture() {
  // Try to capture on copy events
  document.addEventListener('copy', () => {
    setTimeout(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          await addItem({
            type: 'clipboard',
            title: text.slice(0, 60),
            content: text,
            contentType: 'text/plain'
          });
          renderAll();
          updateBadge();
          notify('Text auto-captured to clipboard history', 'info');
        }
      } catch {}
    }, 500);
  });

  // Manual capture button
  document.getElementById('clipboard-capture').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        await addItem({
          type: 'clipboard',
          title: text.slice(0, 60),
          content: text,
          contentType: 'text/plain'
        });
        renderAll();
        updateBadge();
        notify('Clipboard saved', 'success');
      } else {
        notify('Clipboard is empty', 'warning');
      }
    } catch {
      // Fallback
      notify('Could not read clipboard. Try pasting manually.', 'warning');
    }
  });

  // Capture clipboard on paste event (works even in file:// context)
  document.addEventListener('paste', async (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.trim() && state.panelOpen) {
      await addItem({
        type: 'clipboard',
        title: text.slice(0, 60),
        content: text,
        contentType: 'text/plain'
      });
      renderAll();
      updateBadge();
    }
  });

  // Clipboard search
  document.getElementById('clipboard-search').addEventListener('input', renderClipboard);
}

/* ========== DROP ZONE ========== */
function initDropZone() {
  const dz = document.getElementById('drop-zone');
  if (!dz) return;

  dz.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', async () => {
      for (const file of input.files) {
        await handleFileDrop(file);
      }
      renderAll();
    });
    input.click();
  });

  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('dragover');
  });

  dz.addEventListener('dragleave', () => {
    dz.classList.remove('dragover');
  });

  dz.addEventListener('drop', async e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const items = e.dataTransfer.items || [];
    const files = e.dataTransfer.files || [];

    // Handle text drops
    const text = e.dataTransfer.getData('text/plain');
    if (text && text.trim() && !files.length) {
      await addItem({
        type: 'text',
        title: text.slice(0, 60),
        content: text,
        contentType: 'text/plain'
      });
      renderAll();
      updateBadge();
      notify('Text saved to Pocket', 'success');
      return;
    }

    // Handle HTML drops (links)
    const html = e.dataTransfer.getData('text/html');
    if (html && !files.length && !text) {
      const match = html.match(/href="([^"]+)"/);
      if (match) {
        await addItem({
          type: 'link',
          title: match[1].slice(0, 60),
          content: match[1],
          contentType: 'text/url'
        });
        renderAll();
        updateBadge();
        notify('Link saved', 'success');
        return;
      }
    }

    // Handle files
    for (const file of files) {
      await handleFileDrop(file);
    }
    renderAll();
  });
}

async function handleFileDrop(file) {
  const isImage = file.type.startsWith('image/');
  const dataUrl = await fileToDataURL(file);
  const itemType = isImage ? 'image' : 'file';
  await addItem({
    type: itemType,
    title: file.name,
    content: dataUrl,
    contentType: file.type,
    fileName: file.name,
    fileSize: file.size
  });
  notify(`${file.name} saved`, 'success');
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ========== FILE UPLOAD ========== */
function initFileUpload() {
  document.getElementById('file-upload').addEventListener('change', async e => {
    for (const file of e.target.files) {
      await handleFileDrop(file);
    }
    renderAll();
    notify('Files uploaded', 'success');
    e.target.value = '';
  });

  document.getElementById('files-search').addEventListener('input', renderFiles);
}

/* ========== SCREENSHOT UPLOAD ========== */
function initScreenshotUpload() {
  document.getElementById('screenshot-upload').addEventListener('change', async e => {
    for (const file of e.target.files) {
      const dataUrl = await fileToDataURL(file);
      await addItem({
        type: 'screenshot',
        title: file.name || 'Screenshot',
        content: dataUrl,
        contentType: file.type,
        fileName: file.name,
        fileSize: file.size
      });
    }
    renderAll();
    notify('Screenshots saved', 'success');
    e.target.value = '';
  });
}

/* ========== NOTES ========== */
function initNotes() {
  document.getElementById('note-new').addEventListener('click', () => {
    state.editingNote = null;
    document.getElementById('note-editor').style.display = 'block';
    document.getElementById('note-title').value = '';
    document.getElementById('note-body').value = '';
    document.getElementById('note-title').focus();
  });

  document.getElementById('note-save').addEventListener('click', async () => {
    const title = document.getElementById('note-title').value.trim();
    const body = document.getElementById('note-body').value.trim();
    if (!title && !body) return;
    if (state.editingNote) {
      state.editingNote.title = title || 'Untitled';
      state.editingNote.content = body;
      state.editingNote.timestamp = Date.now();
      await updateItem(state.editingNote);
      notify('Note updated', 'success');
    } else {
      await addItem({
        type: 'note',
        title: title || 'Untitled',
        content: body
      });
      notify('Note saved', 'success');
    }
    state.editingNote = null;
    document.getElementById('note-editor').style.display = 'none';
    renderAll();
  });

  document.getElementById('note-cancel').addEventListener('click', () => {
    state.editingNote = null;
    document.getElementById('note-editor').style.display = 'none';
  });
}

function openNoteEditor(item) {
  state.editingNote = item;
  document.getElementById('note-editor').style.display = 'block';
  document.getElementById('note-title').value = item.title || '';
  document.getElementById('note-body').value = item.content || '';
  document.getElementById('note-title').focus();
}

/* ========== SEARCH ========== */
function initSearch() {
  const searchInput = document.getElementById('global-search');
  searchInput.addEventListener('input', renderSearch);

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.searchFilter = chip.dataset.filter;
      renderSearch();
    });
  });
}

/* ========== SETTINGS ========== */
function initSettings() {
  document.getElementById('theme-light').addEventListener('click', async () => {
    await setTheme('light');
    document.getElementById('theme-dark').classList.remove('active');
    document.getElementById('theme-light').classList.add('active');
    notify('Light theme applied', 'info');
  });

  document.getElementById('theme-dark').addEventListener('click', async () => {
    await setTheme('dark');
    document.getElementById('theme-light').classList.remove('active');
    document.getElementById('theme-dark').classList.add('active');
    notify('Dark theme applied', 'info');
  });

  document.getElementById('auto-delete-select').addEventListener('change', async e => {
    state.autoDelete = e.target.value;
    await state.db.setSetting('autoDelete', state.autoDelete);
    startAutoDelete();
    notify(`Auto-delete set to ${e.target.options[e.target.selectedIndex].text}`, 'info');
  });

  document.getElementById('export-backup').addEventListener('click', async () => {
    const data = JSON.stringify(state.items, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PocketFlow_Backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify('Backup exported', 'success');
  });

  document.getElementById('import-backup').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      for (const item of data) {
        if (item.id && item.type) {
          await state.db.add(STORE, item);
        }
      }
      await loadItems();
      renderAll();
      updateBadge();
      notify(`Imported ${data.length} items`, 'success');
    } catch {
      notify('Invalid backup file', 'error');
    }
    e.target.value = '';
  });

  document.getElementById('clear-all').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      clearAllData();
    }
  });

  // Storage stats
  updateStorageStats();
}

async function updateStorageStats() {
  const count = state.items.length;
  document.getElementById('storage-count').textContent = count;
  let totalBytes = 0;
  for (const item of state.items) {
    if (item.content) totalBytes += item.content.length * 2;
    if (item.fileSize) totalBytes += item.fileSize;
  }
  document.getElementById('storage-size').textContent = formatSize(totalBytes);
}

/* ========== SHARE ========== */
function initShare() {
  document.getElementById('share-text').addEventListener('click', () => {
    const input = document.getElementById('share-text-input');
    input.value = '';
    input.focus();
    notify('Enter text to share', 'info');
  });

  document.getElementById('share-image').addEventListener('click', async () => {
    const images = state.items.filter(i => i.type === 'image' || i.type === 'screenshot');
    if (!images.length) {
      notify('No images to share. Add some first.', 'warning');
      return;
    }
    await shareItem(images[0]);
  });

  document.getElementById('share-file').addEventListener('click', async () => {
    const files = state.items.filter(i => i.type === 'file');
    if (!files.length) {
      notify('No files to share. Upload some first.', 'warning');
      return;
    }
    await shareItem(files[0]);
  });

  document.getElementById('share-native').addEventListener('click', async () => {
    if (!navigator.share) {
      notify('Native sharing not supported on this browser', 'warning');
      return;
    }
    const text = document.getElementById('share-text-input').value.trim() || 'Shared from PocketFlow!';
    try {
      await navigator.share({ title: 'PocketFlow', text });
      notify('Shared!', 'success');
    } catch {}
  });

  document.getElementById('share-send').addEventListener('click', async () => {
    const text = document.getElementById('share-text-input').value.trim();
    if (!text) {
      notify('Enter text to share', 'warning');
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'PocketFlow', text });
        return;
      } catch {}
    }
    // Fallback
    try {
      await navigator.clipboard.writeText(text);
      notify('Text copied to clipboard - ready to share!', 'success');
    } catch {
      notify('Could not share text', 'error');
    }
  });
}

/* ========== PANEL CONTROLS ========== */
function initPanelControls() {
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('panel-overlay').addEventListener('click', closePanel);

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      openTab(name);
    });
  });

  // Quick actions
  document.getElementById('quick-note').addEventListener('click', () => {
    openTab('notes');
    document.getElementById('note-new').click();
  });

  document.getElementById('quick-capture').addEventListener('click', async () => {
    openTab('clipboard');
    document.getElementById('clipboard-capture').click();
  });

  document.getElementById('quick-upload').addEventListener('click', () => {
    openTab('files');
    document.getElementById('file-upload').click();
  });

  document.getElementById('quick-paste').addEventListener('click', () => {
    openQuickPocket();
  });

  // Notifications button
  document.getElementById('notif-btn').addEventListener('click', () => {
    notify('All caught up!', 'info');
  });

  // Quick pocket
  document.getElementById('quick-pocket-save').addEventListener('click', saveQuickPocket);
  document.getElementById('quick-pocket-close').addEventListener('click', closeQuickPocket);

  // Recent refresh
  document.getElementById('recent-refresh').addEventListener('click', () => {
    renderAll();
    notify('Refreshed', 'info');
  });

  // Pocket paste
  document.getElementById('pocket-paste').addEventListener('click', openQuickPocket);

  document.getElementById('pocket-capture').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        await addItem({
          type: 'text',
          title: text.slice(0, 60),
          content: text,
          contentType: 'text/plain'
        });
        renderAll();
        notify('Text saved to Pocket', 'success');
      }
    } catch {
      notify('Could not read clipboard. Use Paste button.', 'warning');
    }
  });
}

/* ========== KEYBOARD SHORTCUTS ========== */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          togglePanel();
          break;
        case 'v':
          // On paste, if panel is open and on pocket, capture
          if (state.panelOpen) {
            setTimeout(async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                  const activeTab = document.querySelector('.tab-content.active');
                  if (activeTab && (activeTab.id === 'tab-pocket' || activeTab.id === 'tab-clipboard')) {
                    await addItem({
                      type: activeTab.id === 'tab-clipboard' ? 'clipboard' : 'text',
                      title: text.slice(0, 60),
                      content: text,
                      contentType: 'text/plain'
                    });
                    renderAll();
                    notify('Pasted content saved', 'success');
                  }
                }
              } catch {}
            }, 200);
          }
          break;
      }
    }
    if (e.key === 'Escape') {
      if (document.querySelector('.quick-pocket.open')) {
        closeQuickPocket();
      } else if (state.panelOpen) {
        closePanel();
      }
    }
  });
}

/* ========== INIT ========== */
async function init() {
  try {
    await state.db.open();
    await loadItems();
    await loadSettings();
  } catch (e) {
    console.error('DB init error:', e);
    // Fallback to localStorage
  }

  initBubble();
  initPanelControls();
  initClipboardCapture();
  initDropZone();
  initFileUpload();
  initScreenshotUpload();
  initNotes();
  initSearch();
  initSettings();
  initShare();
  initKeyboardShortcuts();

  updateBadge();
  startAutoDelete();
  renderAll();

  // Periodic refresh for auto-delete and storage stats
  setInterval(() => {
    updateStorageStats();
    updateBadge();
  }, 30000);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
