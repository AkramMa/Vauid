// Edge/Firefox compatibility: ensure chrome namespace is available
const _chrome = (typeof chrome !== 'undefined') ? chrome : browser; // eslint-disable-line

// ─────────────────────────────────────────────────────────────────────────────
// popup.js — VauID extension popup controller
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let _status   = { connected: false, connecting: false, unlocked: false, paired: false, port: 49152 };
let _items    = [];
let _folders  = [];
let _genOpts  = { uppercase: true, lowercase: true, numbers: true, symbols: true };
let _genLen   = 20;
let _activeTab = 'tab-search';
let _currentTabUrl = '';
let _pingInterval  = null;   // keep SW alive while popup is open

// ── Toast ──────────────────────────────────────────────────────────────────────

function toast(msg, ms = 2000) {
  const el = document.getElementById('toast');
  if (!el) return;
  // Convert a leading emoji (e.g. "✓ Password copied") to a local icon so
  // toasts stay consistent with the rest of the popup's icon set.
  let rendered = msg;
  for (const emoji of Object.keys(EMOJI_ICON_MAP).sort((a,b)=>b.length-a.length)) {
    if (msg.startsWith(emoji)) {
      rendered = icon(EMOJI_ICON_MAP[emoji], { size: 13 }) + ' ' + msg.slice(emoji.length).trim();
      break;
    }
  }
  el.innerHTML = rendered;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── View switching ─────────────────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function applyStatus(s) {
  _status = { ..._status, ...s };

  const dot = document.getElementById('status-dot');
  if (dot) {
    dot.className = 'status-dot ' + (
      s.connecting                         ? 'connecting' :
      !s.connected                         ? 'disconnected' :
      !s.unlocked                          ? 'locked' :
                                             'connected'
    );
    dot.title = s.connecting  ? 'Connecting…' :
                !s.connected  ? 'Disconnected' :
                !s.unlocked   ? 'Vault locked'  : 'Connected & unlocked';
  }

  const sstatus = document.getElementById('settings-status-text');
  if (sstatus) {
    sstatus.innerHTML = s.connecting ? 'Connecting…'
      : !s.connected ? 'Disconnected'
      : s.unlocked   ? 'Unlocked ' + icon('check',{size:12}) : 'Locked ' + icon('lock',{size:12});
  }

  const pl = document.getElementById('settings-paired-label');
  if (pl) pl.textContent = s.paired ? 'Paired' : 'Not paired';

  const portEl = document.getElementById('settings-port');
  if (portEl && !portEl.value) portEl.value = s.port || 49152;
}

function updateView() {
  // Still connecting — show connecting screen instead of "not connected"
  if (_status.connecting && !_status.connected) {
    showView('view-connecting');
    return;
  }
  if (!_status.connected) { showView('view-disconnected'); return; }
  if (!_status.paired)    { showView('view-pair');         return; }
  if (!_status.unlocked)  { showView('view-locked');       return; }
  showView('view-vault');
  // Pre-generate a password so the generator tab is ready immediately
  if (!document.getElementById('gen-output')?.textContent?.match(/^[A-Za-z0-9!@#]/)) {
    triggerGenerate();
  }
  searchVault('');
}

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadVault() {
  try {
    const res = await bg('getVault');
    _items   = res.items   || [];
    _folders = res.folders || [];
  } catch (_) {}
}

// ── Search ────────────────────────────────────────────────────────────────────

async function searchVault(query) {
  const list = document.getElementById('results-list');
  if (!list) return;

  list.innerHTML = '<div class="empty-state"><div class="spin"></div></div>';

  try {
    const res = await bg('search', { query, url: query ? '' : _currentTabUrl });
    renderResults(res.results || [], list, query);
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>${e.message}</div></div>`;
  }
}

function renderResults(items, list, query) {
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div>${query ? 'No matches found' : 'No saved logins for this site'}</div></div>`;
    return;
  }

  const logins = items.filter(i => i.type === 'login');
  const others = items.filter(i => i.type !== 'login');

  let html = '';
  if (logins.length) {
    html += `<div class="result-section-label">Logins (${logins.length})</div>`;
    html += logins.map(item => renderItem(item)).join('');
  }
  if (others.length) {
    html += `<div class="result-section-label">Other (${others.length})</div>`;
    html += others.map(item => renderItem(item)).join('');
  }
  list.innerHTML = html;

  list.querySelectorAll('[data-fill]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); fillItem(btn.dataset.fill); };
  });
  list.querySelectorAll('[data-copy-pw]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); copyPassword(btn.dataset.copyPw); };
  });
  list.querySelectorAll('[data-copy-user]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); copyUsername(btn.dataset.copyUser); };
  });
  list.querySelectorAll('[data-totp]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); showTotp(btn.dataset.totp, btn); };
  });
  list.querySelectorAll('.result-item[data-item-id]').forEach(row => {
    row.onclick = () => fillItem(row.dataset.itemId);
  });
}

function renderItem(item) {
  const faviconUrl = item.url ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.url)}&sz=32` : '';
  const typeIconName = item.type === 'card' ? 'card' : item.type === 'identity' ? 'user' : item.type === 'note' ? 'note' : 'key';
  const fallbackIcon = icon(typeIconName, { size: 16 });
  const iconHtml = faviconUrl
    ? `<img src="${faviconUrl}" onerror="this.outerHTML='${fallbackIcon.replace(/"/g, '&quot;')}'" />`
    : fallbackIcon;

  return `
    <div class="result-item" data-item-id="${esc(item.id)}">
      <div class="item-favicon">${iconHtml}</div>
      <div class="item-info">
        <div class="item-name">${esc(item.name)}</div>
        <div class="item-user">${esc(item.username || item.url || item.type)}</div>
      </div>
      <div class="item-actions">
        ${item.username || item.hasPassword ? `<button class="act-btn" data-fill="${esc(item.id)}" title="Autofill">${icon('download',{size:13})}</button>` : ''}
        ${item.hasPassword ? `<button class="act-btn" data-copy-pw="${esc(item.id)}" title="Copy password">${icon('key',{size:13})}</button>` : ''}
        ${item.username ? `<button class="act-btn" data-copy-user="${esc(item.id)}" title="Copy username">${icon('user',{size:13})}</button>` : ''}
        ${item.totp     ? `<button class="act-btn" data-totp="${esc(item.id)}" title="Copy TOTP">${icon('hash',{size:13})}</button>` : ''}
      </div>
    </div>`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Fill / copy actions ────────────────────────────────────────────────────────

function findItem(id) { return _items.find(i => i.id === id); }

async function fillItem(id) {
  const item = findItem(id);
  if (!item) return;
  let password = '';
  if (item.hasPassword) {
    try {
      const res = await bg('getPassword', { itemId: id });
      password = res?.password || '';
    } catch (_) {}
  }
  _chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    _chrome.tabs.sendMessage(tabs[0].id, {
      type:     'vauid:fill',
      username: item.username || '',
      password,
    }).catch(() => toast('Content script not ready'));
    window.close();
  });
}

async function copyPassword(id) {
  const item = findItem(id);
  if (!item?.hasPassword) return;
  try {
    const res = await bg('getPassword', { itemId: id });
    if (!res?.password) { toast('Could not retrieve password'); return; }
    await navigator.clipboard.writeText(res.password);
    toast('✓ Password copied');
  } catch (_) {
    toast('Copy failed');
  }
}

function copyUsername(id) {
  const item = findItem(id);
  if (!item?.username) return;
  navigator.clipboard.writeText(item.username)
    .then(() => toast('✓ Username copied'))
    .catch(() => toast('Copy failed'));
}

async function showTotp(id) {
  try {
    const res = await bg('getTotp', { itemId: id });
    if (res.code) {
      navigator.clipboard.writeText(res.code)
        .then(() => toast(`✓ TOTP copied (${res.remaining}s remaining)`))
        .catch(() => toast('Copy failed'));
    } else {
      toast(res.error || 'No TOTP code');
    }
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

// ── Password generator ─────────────────────────────────────────────────────────

function charSet() {
  let chars = '';
  if (_genOpts.uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (_genOpts.lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (_genOpts.numbers)   chars += '0123456789';
  if (_genOpts.symbols)   chars += '!@#$%^&*()_+-=[]{}|;,.<>?';
  return chars || 'abcdefghijklmnopqrstuvwxyz';
}

function generateLocal() {
  const chars = charSet();
  const arr   = new Uint8Array(_genLen);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

function triggerGenerate(notify = false) {
  const pw = generateLocal();
  const el = document.getElementById('gen-output');
  if (el) el.textContent = pw;
  // Only log to the app's history on a deliberate user action (regenerate /
  // copy), not on the silent auto-preview that runs on popup open or tab
  // switch — otherwise the history would fill up with passwords nobody
  // actually used.
  if (notify) {
    bg('recordGeneratedPassword', { password: pw, url: _currentTabUrl }).catch(() => {});
  }
  return pw;
}

// ── Background messaging ───────────────────────────────────────────────────────

function bg(type, extra = {}) {
  return new Promise((resolve, reject) => {
    _chrome.runtime.sendMessage({ type, ...extra }, (res) => {
      if (_chrome.runtime.lastError) reject(new Error(_chrome.runtime.lastError.message));
      else                          resolve(res);
    });
  });
}

// ── Poll for status while connecting ─────────────────────────────────────────

async function pollUntilConnected(maxMs = 8000, intervalMs = 500) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    const s = await bg('getStatus').catch(() => null);
    if (!s) return null;
    applyStatus(s);
    // Return as soon as we have a definitive state: connected (success)
    // or wsState error with no connection attempt in progress (hard fail).
    if (s.connected) return s;
    if (!s.connecting && !s.connected && s.wsState === 'error') return s;
  }
  return await bg('getStatus').catch(() => null);
}

// Dedicated poller for the pairing flow — keeps waiting through transient
// errors and reconnects; only exits on paired=true or hard timeout.
async function pollUntilPaired(maxMs = 12000, intervalMs = 400) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    const s = await bg('getStatus').catch(() => null);
    if (!s) continue;
    applyStatus(s);
    if (s.paired) return s;   // success — stop immediately
    // Keep looping through 'error' / reconnecting states
  }
  return await bg('getStatus').catch(() => null);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Get current tab URL for site-matching
  try {
    const [tab] = await _chrome.tabs.query({ active: true, currentWindow: true });
    _currentTabUrl = tab?.url || '';
  } catch (_) {}

  // ── SW keep-alive: ping every 20 s while popup is open ────────────────────
  _pingInterval = setInterval(() => bg('ping').catch(() => {}), 20_000);
  window.addEventListener('unload', () => clearInterval(_pingInterval));

  // First status check — may return 'connecting' if SW just woke up
  let status = await bg('getStatus').catch(() => ({ connected: false, connecting: false, paired: false, unlocked: false, port: 49152 }));
  applyStatus(status);

  // If still connecting, show connecting view and wait/poll
  if (status.connecting && !status.connected) {
    updateView(); // shows view-connecting
    status = await pollUntilConnected() || status;
    applyStatus(status);
  }

  if (status.unlocked) await loadVault();
  updateView();

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _activeTab = tab.dataset.tab;
      document.getElementById('panel-search').style.display   = _activeTab === 'tab-search'   ? 'flex' : 'none';
      document.getElementById('panel-generate').style.display = _activeTab === 'tab-generate' ? 'flex' : 'none';
      if (_activeTab === 'tab-generate') triggerGenerate();
    };
  });

  // ── Search ────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => searchVault(searchInput.value));
    searchInput.focus();
  }

  // ── 6 individual digit boxes — wired to hidden #pair-code-input ────────────
  (function wirePairDigits() {
    const boxes = [...document.querySelectorAll('.pair-digit')];
    const hidden = document.getElementById('pair-code-input');
    const btn    = document.getElementById('btn-pair');
    if (!boxes.length || !hidden) return;

    function syncHidden() {
      hidden.value = boxes.map(b => b.value).join('');
      const filled = boxes.every(b => b.value.match(/\d/));
      if (btn) btn.disabled = !filled;
      boxes.forEach(b => b.classList.toggle('filled', !!b.value.match(/\d/)));
      // Advance steps UI
      const count = boxes.filter(b => b.value.match(/\d/)).length;
      document.getElementById('pstep-1')?.classList.toggle('done', count > 0);
      document.getElementById('pstep-2')?.classList.toggle('active', count > 0 && count < 6);
      document.getElementById('pstep-2')?.classList.toggle('done', count === 6);
    }

    boxes.forEach((box, i) => {
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) {
          e.preventDefault();
          boxes[i - 1].value = '';
          boxes[i - 1].focus();
          syncHidden();
        }
        if (e.key === 'ArrowLeft'  && i > 0) boxes[i - 1].focus();
        if (e.key === 'ArrowRight' && i < boxes.length - 1) boxes[i + 1].focus();
        if (e.key === 'Enter') btn?.click();
      });

      box.addEventListener('input', () => {
        // Keep only last digit typed
        const digit = box.value.replace(/\D/g, '').slice(-1);
        box.value = digit;
        syncHidden();
        if (digit && i < boxes.length - 1) boxes[i + 1].focus();
      });

      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        pasted.split('').forEach((ch, j) => { if (boxes[j]) boxes[j].value = ch; });
        syncHidden();
        const next = Math.min(pasted.length, boxes.length - 1);
        boxes[next].focus();
      });
    });

    // Auto-focus first box when pair view shown
    const observer = new MutationObserver(() => {
      const view = document.getElementById('view-pair');
      if (view?.classList.contains('active')) boxes[0]?.focus();
    });
    observer.observe(document.getElementById('view-pair') || document.body,
      { attributes: true, attributeFilter: ['class'] });

    syncHidden();
  })();

  // ── Disconnected view: retry ──────────────────────────────────────────────
  document.getElementById('btn-retry')?.addEventListener('click', async () => {
    await bg('forceReconnect').catch(() => {});
    applyStatus({ connecting: true, connected: false });
    updateView();
    const s = await pollUntilConnected(6000) || await bg('getStatus').catch(() => null);
    if (s) { applyStatus(s); if (s.unlocked) await loadVault(); updateView(); }
  });

  // ── Connecting view: cancel ───────────────────────────────────────────────
  document.getElementById('btn-cancel-connect')?.addEventListener('click', () => {
    applyStatus({ connecting: false, connected: false });
    updateView();
  });

  // ── Pairing ───────────────────────────────────────────────────────────────
  document.getElementById('btn-pair')?.addEventListener('click', async () => {
    // Strip spaces, dashes, and any non-digit chars — handles copied codes like "123 456" or "123-456"
    const raw   = document.getElementById('pair-code-input')?.value || '';
    const code  = raw.replace(/\D/g, '');
    const name  = document.getElementById('pair-name-input')?.value?.trim() || 'Chrome';
    const errEl = document.getElementById('pair-error');
    if (errEl) errEl.textContent = '';

    if (code.length !== 6) {
      if (errEl) errEl.textContent = `Enter the 6-digit code from VauID. (got ${code.length} digits)`;
      return;
    }

    // Background will connect if needed and send auth:pair immediately on hello.
    toast('Pairing…');
    await bg('pair', { code, profileName: name });

    // Wait for auth:paired confirmation — use dedicated poller that survives
    // transient errors and reconnects during the pairing handshake.
    const polled = await pollUntilPaired(12000);
    if (polled?.paired) {
      // Mark step 3 as done before transitioning
      document.getElementById('pstep-2')?.classList.add('done');
      document.getElementById('pstep-3')?.classList.add('active', 'done');
      await new Promise(r => setTimeout(r, 400));
      applyStatus(polled);
      if (polled.unlocked) await loadVault();
      updateView();
    } else {
      if (errEl) errEl.textContent = 'Pairing failed — check the code and try again.';
      updateView();
    }
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    showView('view-settings');
    const p = document.getElementById('settings-port');
    if (p) p.value = _status.port || 49152;
  });

  document.getElementById('btn-back-from-settings')?.addEventListener('click', () => updateView());

  document.getElementById('btn-set-port')?.addEventListener('click', async () => {
    const portVal = parseInt(document.getElementById('settings-port')?.value || '49152');
    if (portVal < 1024 || portVal > 65535) { toast('Invalid port'); return; }
    await bg('setPort', { port: portVal });
    toast('Port updated. Reconnecting…');
    applyStatus({ connecting: true, connected: false });
    updateView();
    const s = await pollUntilConnected(6000) || await bg('getStatus').catch(() => null);
    if (s) { applyStatus(s); if (s.unlocked) await loadVault(); updateView(); }
  });

  document.getElementById('btn-disconnect')?.addEventListener('click', async () => {
    await bg('disconnect');
    toast('Disconnected');
    applyStatus({ connected: false, connecting: false, paired: false, unlocked: false });
    updateView();
  });

  // ── Generator ─────────────────────────────────────────────────────────────
  const lenSlider = document.getElementById('gen-length');
  const lenLabel  = document.getElementById('gen-len-val');
  if (lenSlider) {
    lenSlider.value = _genLen;
    lenSlider.addEventListener('input', () => {
      _genLen = parseInt(lenSlider.value);
      if (lenLabel) lenLabel.textContent = _genLen;
    });
  }

  document.querySelectorAll('.toggle-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _genOpts[chip.dataset.opt] = !_genOpts[chip.dataset.opt];
      chip.classList.toggle('on', _genOpts[chip.dataset.opt]);
    });
  });

  document.getElementById('btn-regen')?.addEventListener('click', () => triggerGenerate(true));
  document.getElementById('btn-gen-copy')?.addEventListener('click', () => {
    const pw = document.getElementById('gen-output')?.textContent || '';
    if (!pw || pw.startsWith('Click')) return;
    navigator.clipboard.writeText(pw).then(() => toast('✓ Password copied'));
    bg('recordGeneratedPassword', { password: pw, url: _currentTabUrl }).catch(() => {});
  });

  // ── Live status updates pushed from background ────────────────────────────
  _chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'status') {
      applyStatus(msg);
      updateView();
      if (msg.unlocked) loadVault().then(() => { if (_activeTab === 'tab-search') searchVault(''); });
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
