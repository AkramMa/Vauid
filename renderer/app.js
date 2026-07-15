'use strict';
/* ══════════════════════════════════════════════════════════════════════
   VauID Renderer — app.js  (main entry, loaded last via <script>)
   All page JS is also loaded via <script> tags in index.html
   ══════════════════════════════════════════════════════════════════════ */

const kb = window.vauid; // preload bridge

/* ── Router ──────────────────────────────────────────────────────────── */
const Router = {
  _current: null,
  show(pageId) {
    document.querySelectorAll('.page').forEach(p => {
      p.classList.remove('active');
      p.style.display = 'none';
      p.style.flexDirection = '';
    });
    const page = document.getElementById(pageId);
    if (page) {
      page.style.display = 'flex';
      // Vault layout and the unlock screen (rail + panel) are rows, all others are column
      page.style.flexDirection = (page.classList.contains('vault-layout') || page.classList.contains('row-layout')) ? 'row' : 'column';
      page.classList.add('active');
    }
    this._current = pageId;
  },
};

/* ── Toast ────────────────────────────────────────────────────────────── */
const Toast = {
  show(msg, type = 'info', duration = 3000) {
    const icons = { success: '✓', error: '✕', info: '●', warning: '⚠' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || '●'}</span> ${msg}`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), duration + 300);
  },
};

/* ── Modal ────────────────────────────────────────────────────────────── */
const Modal = {
  show(html, opts = {}) {
    const overlay = document.getElementById('modal-overlay');
    const box = document.getElementById('modal-box');
    const content = document.getElementById('modal-content');
    content.innerHTML = html;
    overlay.style.display = 'flex';
    box.style.maxWidth = opts.wide ? '680px' : '540px';
    overlay.onclick = (e) => { if (e.target === overlay && !opts.persistent) this.close(); };
  },
  close() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('modal-box').style.maxWidth = '540px';
    document.getElementById('modal-content').innerHTML = '';
  },
  setContent(html) {
    document.getElementById('modal-content').innerHTML = html;
  },
};

/* ── Context Menu ─────────────────────────────────────────────────────── */
const CtxMenu = {
  show(x, y, items) {
    const menu = document.getElementById('ctx-menu');
    menu.innerHTML = '';
    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        return;
      }
      if (item.colors) {
        const wrap = document.createElement('div');
        wrap.className = 'color-swatches';
        item.colors.forEach(c => {
          const sw = document.createElement('div');
          sw.className = 'color-swatch';
          sw.style.background = c;
          if (c === item.current) sw.classList.add('selected');
          sw.onclick = () => { item.oncolor(c); this.hide(); };
          wrap.appendChild(sw);
        });
        menu.appendChild(wrap);
        return;
      }
      const btn = document.createElement('button');
      btn.className = `ctx-item${item.danger ? ' danger' : ''}`;
      btn.innerHTML = `${item.icon || ''} ${item.label}`;
      btn.onclick = () => { item.action(); this.hide(); };
      menu.appendChild(btn);
    });

    menu.style.display = 'block';
    // Position after rendering so we have actual dimensions
    requestAnimationFrame(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const mw = menu.offsetWidth || 180, mh = menu.offsetHeight || 200;
      menu.style.left = (x + mw > vw ? vw - mw - 8 : x) + 'px';
      menu.style.top  = (y + mh > vh ? vh - mh - 8 : y) + 'px';
    });

    setTimeout(() => document.addEventListener('click', () => this.hide(), { once: true }), 0);
  },
  hide() {
    document.getElementById('ctx-menu').style.display = 'none';
  },
};

/* ── Clipboard ────────────────────────────────────────────────────────── */
async function copyToClipboard(text, label = 'Copied') {
  await kb.clipboard.write(text);
  Toast.show(`${label} copied`, 'success');
}

/* ── Favicon ──────────────────────────────────────────────────────────── */
function getFaviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch { return null; }
}

function typeEmoji(type) {
  return { login: '🔑', card: '💳', identity: '🪪', note: '📝', passkey: '🗝', website: '🌐' }[type] || '🔒';
}

// Local SVG icon equivalent of typeEmoji — used anywhere item-type icons are
// rendered dynamically (icons.js defines the icon() function itself).
function typeIcon(type, opts = {}) {
  const name = { login: 'key', card: 'credit-card', identity: 'user', note: 'file-text', passkey: 'fingerprint', website: 'globe' }[type] || 'lock';
  return icon(name, opts);
}

// Renders every [data-icon] element within `scope` (default: whole document)
// using the local icon set. Call this after inserting any new HTML that
// contains data-icon attributes — static markup in index.html is rendered
// once at boot; dynamically-generated HTML (from vault.js, item-form.js,
// modals, etc.) should call this itself right after setting .innerHTML.
function renderIcons(scope) {
  (scope || document).querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.iconSize, 10) || 16;
    const existingText = el.textContent.trim(); // preserve any label text next to the icon
    el.innerHTML = icon(name, { size }) + (existingText ? ' ' + existingText : '');
  });
  autoConvertEmoji(scope);
}

// Retrofit pass: recognizes common emoji used throughout the app (buttons like
// "🔑 Login", icon-only spans, etc.) on LEAF elements (no nested tags) and swaps
// the emoji for the matching local icon, preserving any trailing label text.
// This covers dynamically-generated markup across the whole app without
// needing to hand-edit every template individually.
const EMOJI_ICON_MAP = {
  '🔑':'key', '💳':'credit-card', '🪪':'user', '📝':'file-text', '🗝':'fingerprint',
  '🌐':'globe', '🔒':'lock', '🔓':'unlock', '🔐':'shield', '👁':'eye', '🙈':'eye-off',
  '📋':'copy', '🗑️':'trash', '🗑':'trash', '⭐':'star', '⚠️':'alert-triangle', '⚠':'alert-triangle',
  '⏰':'clock', '☁️':'refresh', '☁':'refresh', '🔄':'refresh', '✕':'x', '✓':'check', '📎':'paperclip',
  '📸':'camera', '🔍':'search', '✏️':'edit', '✏':'edit', '⚙️':'settings', '⚙':'settings',
  '💾':'download', '⬇':'download', '⬆':'upload', '👥':'users', 'ℹ️':'info', 'ℹ':'info',
  '🗒️':'file-text', '🔑️':'key', '🎨':'settings', '🛡':'shield', '🛡️':'shield',
};
const _emojiKeysSorted = Object.keys(EMOJI_ICON_MAP).sort((a, b) => b.length - a.length);

function autoConvertEmoji(scope) {
  (scope || document).querySelectorAll('*').forEach(el => {
    if (el.dataset && el.dataset.icon) return;      // already handled by renderIcons above
    if (el.children.length > 0) return;              // only leaf elements (no nested tags)
    if (el.tagName === 'SVG' || el.closest?.('svg')) return;
    const text = el.textContent;
    if (!text) return;
    const trimmed = text.trim();
    for (const emoji of _emojiKeysSorted) {
      if (trimmed.startsWith(emoji)) {
        const rest = trimmed.slice(emoji.length).trim();
        el.innerHTML = icon(EMOJI_ICON_MAP[emoji], { size: 16 }) + (rest ? ' ' + rest : '');
        return;
      }
    }
  });
}

// Auto-render icons in any new content added anywhere in the app — modals,
// item forms, settings panels, etc. — without needing a manual renderIcons()
// call after every single innerHTML swap throughout the codebase.
const _iconObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    m.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      renderIcons(node);
    });
  }
});
_iconObserver.observe(document.body, { childList: true, subtree: true });

/* ── Password visibility toggle (global delegation) ──────────────────── */
document.addEventListener('click', e => {
  if (e.target.classList.contains('toggle-pw')) {
    const targetId = e.target.dataset.target;
    const input = document.getElementById(targetId);
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
      e.target.innerHTML = icon(input.type === 'password' ? 'eye' : 'eye-off', { size: 16 });
    }
  }
});

/* ── Titlebar controls ───────────────────────────────────────────────── */
document.getElementById('btn-minimize').onclick = () => kb.window.minimize();
document.getElementById('btn-maximize').onclick = () => kb.window.maximize();
document.getElementById('btn-close').onclick    = () => kb.window.close();

/* ── App State ────────────────────────────────────────────────────────── */
const AppState = {
  items: [],
  folders: [],
  currentFilter: 'all',
  currentFolder: null,
  selectedItem: null,
  searchQuery: '',
  sortBy: 'name',
  breachItems: new Set(),
};

/* ── Export globals FIRST so page modules can safely reference window.App ── */
window.App = { Router, Toast, Modal, CtxMenu, AppState, copyToClipboard, getFaviconUrl, typeEmoji, typeIcon, renderIcons, kb };

/* ── Sync status listener (auto-sync notifications) ──────────────────── */
kb.on('sync:status', ({ ok, ts, disconnected }) => {
  if (disconnected) {
    // Sync was revoked — clear any status indicator, no toast needed
    // (the disconnect button already showed one)
    return;
  }
  if (ok) {
    const time = ts ? new Date(ts).toLocaleTimeString() : '';
    Toast.show(`☁ Synced ${time}`, 'success', 2000);
  }
});

/* ── Lock from tray ──────────────────────────────────────────────────── */
kb.on('tray:lock', () => {
  kb.vault.lock().then(() => {
    Router.show('page-welcome');
    if (typeof WelcomePage !== 'undefined') WelcomePage.init();
  });
});


/* ── Real-time vault update from main process ────────────────────────── */
kb.on('vault:updated', (data) => {
  // Keep AppState in sync so any page that reads it gets fresh data
  if (data && window.App?.AppState) {
    window.App.AppState.items   = data.items   || [];
    window.App.AppState.folders = data.folders || [];
    window.App.AppState.trash   = data.trash   || [];
  }
  // If vault page is active, re-render it without a full page reload
  if (typeof VaultPage !== 'undefined' && VaultPage.refresh) {
    VaultPage.refresh();
  }
});


/* ── Password generated via the browser extension ──────────────── */
// Registered globally (not inside GeneratorPage.show()) so a password
// generated in the extension gets logged into history even if the person
// isn't currently looking at the Generator page in the app.
kb.on('ws:passwordGenerated', ({ password, url, time } = {}) => {
  if (!password || typeof GeneratorPage === 'undefined') return;
  GeneratorPage._addToHistory(password, url, time);
});




/* ── Boot ─────────────────────────────────────────────────────────────── */
async function boot() {
  // Render icons in the static HTML that was already present at page load
  // (the MutationObserver above only catches content added AFTER this point).
  renderIcons();

  // Hide all pages first
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  Router.show('page-welcome');
  await WelcomePage.init();
}

// ── Auto-lock engine ──────────────────────────────────────────────────────────
// Tracks user activity and locks the vault after the configured idle period.
const AutoLock = {
  _timer:   null,
  _minutes: 0,
  _handler: null,
  _EVENTS: ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'],

  start(minutes) {
    this.stop(); // always remove previous listeners before adding new ones
    this._minutes = minutes;
    if (!minutes) return; // 0 = never
    this._handler = () => this._reset();
    this._EVENTS.forEach(evt =>
      window.addEventListener(evt, this._handler, { passive: true })
    );
    this._reset();
  },

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
    if (this._handler) {
      this._EVENTS.forEach(evt =>
        window.removeEventListener(evt, this._handler)
      );
      this._handler = null;
    }
  },

  _reset() {
    clearTimeout(this._timer);
    if (!this._minutes) return;
    this._timer = setTimeout(() => this._lock(), this._minutes * 60 * 1000);
  },

  async _lock() {
    const { kb, Toast, Router } = window.App;
    const isUnlocked = await kb.vault.isUnlocked();
    if (!isUnlocked) return;
    await kb.vault.lock();
    Toast.show('🔒 Vault locked due to inactivity', 'info', 4000);
    Router.show('page-welcome');
    WelcomePage.init();
  },
};
window.App.AutoLock = AutoLock;

boot();
