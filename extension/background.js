// Edge/Firefox compatibility: ensure chrome namespace is available
const _chrome = (typeof chrome !== 'undefined') ? chrome : browser; // eslint-disable-line

// ─────────────────────────────────────────────────────────────────────────────
// background.js — VauID Extension Service Worker
//
// Connection strategy
// ───────────────────
// 1. On every SW wake-up, try the last-known port first.
// 2. If that fails, scan 49152-49162 sequentially.  Each probe is fast because
//    ECONNREFUSED resolves in < 10 ms on Windows when nothing is listening.
// 3. Once a port responds with 'hello', authenticate immediately.
//
// MV3 keep-alive
// ─────────────
// Service workers are suspended after ~30 s of inactivity.  We use:
//   • _chrome.alarms every 25 s  — wakes the SW and re-checks the socket
//   • popup sends a 'ping' message every 20 s while open
// ─────────────────────────────────────────────────────────────────────────────

// ── Config ────────────────────────────────────────────────────────────────────

const PORT_SCAN_START  = 49152;
const PORT_SCAN_END    = 49162;
const HELLO_TIMEOUT_MS = 4000;   // wait up to 4 s for hello on each port
const RECONNECT_DELAY  = 4000;   // pause before the next reconnect cycle
const KEEPALIVE_ALARM  = 'vauid-keepalive';
const DEFAULT_PROFILE  = 'Chrome';

// ── State (reset each SW wake-up) ─────────────────────────────────────────────

let _ws           = null;
let _wsState      = 'idle';   // 'idle' | 'connecting' | 'connected' | 'error'
let _connected    = false;
let _unlocked     = false;
let _vault        = { items: [], folders: [] };
let _profileId    = null;
let _token        = null;
let _port         = PORT_SCAN_START;
let _reconnectTimer = null;
let _requestMap   = new Map();
let _reqCounter   = 0;
let _connectAbort = false;
let _pendingPairMsg = null;  // queued auth:pair to send on next connection

// ── Storage ───────────────────────────────────────────────────────────────────

async function loadAuth() {
  const d = await _chrome.storage.local.get(['profileId', 'token', 'port']);
  _profileId = d.profileId || null;
  _token     = d.token     || null;
  _port      = d.port      || PORT_SCAN_START;
}

async function saveAuth({ profileId, token, port } = {}) {
  if (profileId !== undefined) _profileId = profileId;
  if (token     !== undefined) _token     = token;
  if (port      !== undefined) _port      = port;
  await _chrome.storage.local.set({ profileId: _profileId, token: _token, port: _port });
}

async function clearAuth() {
  _profileId = null;
  _token     = null;
  await _chrome.storage.local.remove(['profileId', 'token']);
}

// ── Single-port connection attempt ────────────────────────────────────────────
// Returns 'connected' | 'failed' | 'aborted'.
// On 'connected', _ws is set and auth has been sent.

function tryPort(port) {
  return new Promise((resolve) => {
    if (_connectAbort) return resolve('aborted');

    console.log('[VauID] Trying ws://127.0.0.1:' + port);

    let sock;
    try {
      sock = new WebSocket('ws://127.0.0.1:' + port);
    } catch (e) {
      console.warn('[VauID] WebSocket() threw:', e.message);
      return resolve('failed');
    }

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn('[VauID] Timeout waiting for hello on port', port);
      try { sock.close(); } catch (_) {}
      finish('failed');
    }, HELLO_TIMEOUT_MS);

    sock.onopen  = () => console.log('[VauID] TCP open on', port, '— waiting for hello');
    sock.onerror = (e) => { console.warn('[VauID] onerror on port', port, e.message || ''); finish('failed'); };
    sock.onclose = (e) => { console.warn('[VauID] onclose on port', port, e.code, e.reason || ''); finish('failed'); };

    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type !== 'hello') return;   // ignore anything before hello

      console.log('[VauID] hello received on port', port);

      // Promote this socket to the live connection
      _ws = sock;
      _attachSocketHandlers(sock);
      _authenticate();
      finish('connected');
    };
  });
}

// ── Port scan ─────────────────────────────────────────────────────────────────

async function connect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  clearTimeout(_reconnectTimer);
  _wsState      = 'connecting';
  _connectAbort = false;

  // Build scan order: last-known port first, then the full range
  const ports = [_port];
  for (let p = PORT_SCAN_START; p <= PORT_SCAN_END; p++) {
    if (p !== _port) ports.push(p);
  }

  for (const port of ports) {
    if (_connectAbort) break;
    const result = await tryPort(port);
    if (result === 'connected') {
      if (port !== _port) await saveAuth({ port });   // remember the working port
      return;   // _ws is live, auth sent
    }
    if (result === 'aborted') break;
    // 'failed' → try the next port
  }

  if (!_connectAbort) {
    console.warn('[VauID] Could not connect to VauID on any port (', PORT_SCAN_START, '-', PORT_SCAN_END, ')');
    _wsState = 'error';
    _notifyStatus();
    scheduleReconnect();
  } else {
    _wsState = 'idle';
  }
}

// ── Socket lifecycle ──────────────────────────────────────────────────────────

function _attachSocketHandlers(ws) {
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = (ev) => {
    console.log('[VauID] Connection closed', ev.code, ev.reason || '');
    _wsState   = 'idle';
    _connected = false;
    _stopPairingPing();
    _notifyStatus();
    updateBadge();
    scheduleReconnect();
  };

  ws.onerror = () => { _wsState = 'error'; };
}

function _authenticate() {
  if (_profileId && _token) {
    console.log('[VauID] Sending auth:resume for', _profileId.slice(0, 8) + '…');
    rawSend({ type: 'auth:resume', profileId: _profileId, token: _token });
  } else if (_pendingPairMsg) {
    // User already entered the code while the socket was down — send it now.
    console.log('[VauID] Sending queued auth:pair');
    rawSend(_pendingPairMsg);
    _pendingPairMsg = null;
  } else {
    console.log('[VauID] No credentials — waiting for user to pair');
    // Mark as connected so the popup shows the pairing screen.
    _wsState   = 'connected';
    _connected = true;
    _notifyStatus();
    updateBadge();
    // Start sending pings immediately to keep the server's 10s auth timeout
    // from firing while the user reads and types the pairing code.
    _startPairingPing();
  }
}

let _pairingPingInterval = null;

function _startPairingPing() {
  _stopPairingPing();
  _pairingPingInterval = setInterval(() => {
    if (!_profileId && !_token && _ws?.readyState === WebSocket.OPEN) {
      rawSend({ type: 'ping' });
    } else {
      _stopPairingPing(); // stop once paired or disconnected
    }
  }, 4000);
}

function _stopPairingPing() {
  if (_pairingPingInterval) {
    clearInterval(_pairingPingInterval);
    _pairingPingInterval = null;
  }
}

function scheduleReconnect() {
  clearTimeout(_reconnectTimer);
  // When unpaired, don't auto-reconnect — the server will just keep timing
  // us out in a loop. Instead, reconnect on-demand when the user clicks Pair.
  if (!_profileId && !_token) return;
  _reconnectTimer = setTimeout(async () => {
    await loadAuth();
    connect();
  }, RECONNECT_DELAY);
}

function rawSend(msg) {
  if (_ws?.readyState === WebSocket.OPEN) {
    try { _ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }
  return false;
}

function request(msg, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const requestId = String(++_reqCounter);
    const timer = setTimeout(() => {
      _requestMap.delete(requestId);
      reject(new Error('Timeout: ' + msg.type));
    }, timeoutMs);
    _requestMap.set(requestId, { resolve, reject, timer });
    if (!rawSend({ ...msg, requestId })) {
      clearTimeout(timer);
      _requestMap.delete(requestId);
      reject(new Error('Not connected'));
    }
  });
}

// ── Message handling ───────────────────────────────────────────────────────────

function handleMessage(msg) {
  if (msg.requestId && _requestMap.has(msg.requestId)) {
    const { resolve, timer } = _requestMap.get(msg.requestId);
    clearTimeout(timer);
    _requestMap.delete(msg.requestId);
    resolve(msg);
    return;
  }

  switch (msg.type) {

    case 'hello':
      // Received on an already-attached socket (reconnect without re-probe)
      _authenticate();
      break;

    case 'pong':
      break;  // keepalive reply — no action needed

    case 'auth:paired':
      saveAuth({ profileId: msg.profileId, token: msg.token });
      _stopPairingPing();
      _wsState   = 'connected';
      _connected = true;
      console.log('[VauID] Paired as', msg.profileId?.slice(0, 8) + '…');
      _notifyStatus();
      updateBadge();
      break;

    case 'auth:resumed':
      _wsState   = 'connected';
      _connected = true;
      console.log('[VauID] Session resumed');
      _notifyStatus();
      updateBadge();
      break;

    case 'auth:error':
      console.warn('[VauID] Auth error:', msg.code);
      if (msg.code === 'INVALID_TOKEN') clearAuth();
      _wsState   = 'error';
      _connected = false;
      _notifyStatus();
      updateBadge();
      break;

    case 'vault:lockState':
      _unlocked = !msg.locked;
      if (msg.locked) _vault = { items: [], folders: [] };
      _notifyStatus();
      updateBadge();
      break;

    case 'vault:updated':
      if (msg.data) _vault = msg.data;
      updateBadge();
      break;

    case 'error':
      console.warn('[VauID] Server error:', msg.code, msg.message);
      break;
  }
}

// ── Badge & status broadcast ───────────────────────────────────────────────────

function updateBadge() {
  if (!_connected) {
    _chrome.action.setBadgeText({ text: '!' });
    _chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else if (!_unlocked) {
    _chrome.action.setBadgeText({ text: 'OFF' });
    _chrome.action.setBadgeBackgroundColor({ color: '#eab308' });
  } else {
    _chrome.action.setBadgeText({ text: '' });
  }
}

function _currentStatus() {
  return {
    type:       'status',
    connected:  _connected,
    connecting: _wsState === 'connecting',
    wsState:    _wsState,
    unlocked:   _unlocked,
    port:       _port,
    paired:     !!(_profileId && _token),
  };
}

function _notifyStatus() {
  _chrome.runtime.sendMessage(_currentStatus()).catch(() => {});

  _chrome.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      // [M-4] Only notify http/https tabs — content script is not injected elsewhere.
      // Avoids leaking connection state to extension pages, devtools, and system tabs.
      if (tab.id && tab.url && /^https?:\/\//.test(tab.url)) {
        _chrome.tabs.sendMessage(tab.id, {
          type:      'vauid:status',
          connected: _connected,
          unlocked:  _unlocked,
        }).catch(() => {});
      }
    });
  });
}

// ── Keep-alive alarm ───────────────────────────────────────────────────────────

_chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 25 / 60 });

_chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (!_ws || _ws.readyState === WebSocket.CLOSED || _ws.readyState === WebSocket.CLOSING) {
    connect();
  } else if (_ws.readyState === WebSocket.OPEN) {
    try { _ws.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
  }
});

// ── Context menus ─────────────────────────────────────────────────────────────

function buildContextMenus() {
  _chrome.contextMenus.removeAll(() => {
    _chrome.contextMenus.create({ id: 'vauid-fill',     title: 'VauID: Fill login',        contexts: ['editable'] });
    _chrome.contextMenus.create({ id: 'vauid-generate', title: 'VauID: Generate password', contexts: ['editable'] });
    _chrome.contextMenus.create({ id: 'vauid-open',     title: 'VauID: Open vault',        contexts: ['page', 'frame'] });
  });
}

_chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'vauid-fill') {
    _chrome.tabs.sendMessage(tab.id, { type: 'vauid:openFill', url: tab.url }).catch(() => {});
  }
  if (info.menuItemId === 'vauid-generate') {
    try {
      const res = await request({ type: 'password:generate', options: { length: 20, symbols: true }, url: tab.url || '' });
      if (res.password) _chrome.tabs.sendMessage(tab.id, { type: 'vauid:fillPassword', password: res.password }).catch(() => {});
    } catch (e) { console.warn('[VauID] Generate failed:', e.message); }
  }
  if (info.menuItemId === 'vauid-open') {
    _chrome.action.openPopup().catch(() => {
      // Fallback for Edge which doesn't support action.openPopup()
      _chrome.tabs.create({ url: _chrome.runtime.getURL('popup/popup.html') });
    });
  }
});

// ── Message bus ───────────────────────────────────────────────────────────────

_chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case 'ping':
        sendResponse({ ok: true });
        break;

      case 'getStatus':
        // Trigger connect if idle (popup just opened and woke the SW)
        if (_wsState === 'idle') connect();
        sendResponse(_currentStatus());
        break;

      case 'getVault':
        sendResponse({ items: _vault.items, folders: _vault.folders });
        break;

      case 'pair': {
        // Store the pair message first, then decide how to send it.
        // IMPORTANT: only send once — the server's pairing code is one-time-use.
        _pendingPairMsg = { type: 'auth:pair', code: msg.code, profileName: msg.profileName || DEFAULT_PROFILE };
        if (!_ws || _ws.readyState !== WebSocket.OPEN) {
          // Socket is closed — connect() will call _authenticate() which sends it on hello
          connect();
        } else {
          // Socket already open — send immediately and clear so _authenticate() won't resend
          rawSend(_pendingPairMsg);
          _pendingPairMsg = null;
        }
        sendResponse({ success: true });
        break;
      }

      case 'setPort': {
        _connectAbort = true;
        await saveAuth({ port: msg.port });
        _connected = false;
        _wsState   = 'idle';
        if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
        setTimeout(connect, 300);
        sendResponse({ success: true });
        break;
      }

      case 'disconnect': {
        _connectAbort = true;
        await clearAuth();
        _connected = false;
        _wsState   = 'idle';
        if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
        sendResponse({ success: true });
        break;
      }

      case 'forceReconnect': {
        _connectAbort = true;
        _connected   = false;
        _wsState     = 'idle';
        if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
        setTimeout(connect, 300);
        sendResponse({ ok: true });
        break;
      }

      case 'search': {
        try {
          const res = await request({ type: 'vault:search', query: msg.query || '', url: msg.url || '' });
          sendResponse({ results: res.results || [] });
        } catch (e) { sendResponse({ results: [], error: e.message }); }
        break;
      }

      case 'getTotp': {
        try {
          const res = await request({ type: 'vault:getTotp', itemId: msg.itemId });
          sendResponse(res);
        } catch (e) { sendResponse({ error: e.message }); }
        break;
      }

      // Fetch the real password for exactly one item, on demand — mirrors the
      // app's own scoping (vault:getPassword never returns bulk passwords).
      case 'getPassword': {
        try {
          const res = await request({ type: 'vault:getPassword', itemId: msg.itemId });
          sendResponse({ password: res.password || '' });
        } catch (e) { sendResponse({ error: e.message }); }
        break;
      }

      case 'generatePassword': {
        try {
          const res = await request({ type: 'password:generate', options: msg.options || {}, url: msg.url || '' });
          sendResponse({ password: res.password });
        } catch (e) { sendResponse({ error: e.message }); }
        break;
      }

      // One-way: record a password the extension already generated locally
      // (the popup's instant offline generator) into the app's history.
      // Fire-and-forget — no response expected, and it's fine if this fails
      // silently when the app isn't currently connected.
      case 'recordGeneratedPassword': {
        rawSend({ type: 'password:recordGenerated', password: msg.password || '', url: msg.url || '' });
        sendResponse({ ok: true });
        break;
      }

      case 'credentialDetected': {
        try {
          await request({ type: 'vault:credentialDetected', siteName: msg.siteName, url: msg.url, username: msg.username });
        } catch (_) {}
        sendResponse({ ok: true });
        break;
      }

      case 'saveCredential': {
        try {
          const res = await request({
            type: 'vault:saveItem',
            item: {
              type:     'login',
              name:     msg.siteName,
              url:      msg.url,
              username: msg.username,
              password: msg.password,
            },
          }, 8000);
          sendResponse({ ok: res.type === 'vault:saveItemOk', error: res.message });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }

      case 'updateCredential': {
        try {
          const res = await request({
            type:    'vault:updateItem',
            id:      msg.id,
            updates: { username: msg.username, password: msg.password, updatedAt: new Date().toISOString() },
          }, 8000);
          sendResponse({ ok: res.type === 'vault:updateItemOk', error: res.message });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }

      default:
        sendResponse({ error: 'Unknown message: ' + msg.type });
    }
  })();
  return true;
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

_chrome.runtime.onInstalled.addListener(() => {
  buildContextMenus();
  // [S-4] Alarm already created at module-load time (line ~365); creating it again
  // here is harmless (Chrome deduplicates by name) but misleading — removed.
  updateBadge();
});

_chrome.runtime.onStartup.addListener(async () => {
  await loadAuth();
  connect();
  buildContextMenus();
  updateBadge();
});

// Runs every time the service worker wakes from suspension
(async () => {
  await loadAuth();
  connect();
  updateBadge();
})();
