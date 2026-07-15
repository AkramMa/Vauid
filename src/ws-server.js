'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// ws-server.js — Local WebSocket server for browser extension integration
//
// Security model:
//   • Listens on localhost only (127.0.0.1) — not accessible from the network
//   • First connection from a new profile requires a pairing code shown in-app
//   • After pairing, each browser profile gets a persistent session token
//   • All messages are JSON; the token must accompany every request
//   • Vault data is never sent unless the vault is unlocked
// ─────────────────────────────────────────────────────────────────────────────

const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PORT   = 49152;          // default listen port (ephemeral range)
const PAIRING_TTL_MS = 5 * 60 * 1000; // pairing code expires in 5 minutes
const TOKEN_BYTES    = 32;             // session token size in bytes
const APP_DATA       = path.join(os.homedir(), '.vauid');
const SESSIONS_FILE  = path.join(APP_DATA, 'extension-sessions.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function now() { return Date.now(); }

// ── WsServer class ────────────────────────────────────────────────────────────

class WsServer {
  constructor() {
    this._wss          = null;
    this._port         = DEFAULT_PORT;
    this._running      = false;
    this._vaultManager = null;
    this._mainWindow   = null;

    // Pairing state: { code, expiresAt }
    this._pairing = null;

    // Active WS sessions map: socketId → { ws, profileId, token, profileName, connectedAt }
    this._clients = new Map();

    // Persisted sessions: profileId → { tokenHash, profileName, pairedAt, lastSeen }
    this._sessions = this._loadSessions();

    // Event callback to push UI updates to the renderer
    this._onSessionChange = null;

    if (!fs.existsSync(APP_DATA)) fs.mkdirSync(APP_DATA, { recursive: true });
    // [C-4] Load (or generate) the per-install key used to HMAC session tokens before storing them.
    this._wsKey = this._getOrCreateWsKey();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setVaultManager(vm)         { this._vaultManager = vm; }
  setMainWindow(win)          { this._mainWindow   = win; }
  setOnSessionChange(fn)      { this._onSessionChange = fn; }

  getPort()    { return this._port; }
  isRunning()  { return this._running; }

  getSessions() {
    return Object.entries(this._sessions).map(([profileId, s]) => ({
      profileId,
      profileName: s.profileName,
      pairedAt:    s.pairedAt,
      lastSeen:    s.lastSeen,
      connected:   this._isConnected(profileId),
    }));
  }

  getActivePairingCode() {
    if (!this._pairing || now() > this._pairing.expiresAt) return null;
    return {
      code:      this._pairing.code,
      expiresAt: this._pairing.expiresAt,
      remaining: Math.max(0, Math.round((this._pairing.expiresAt - now()) / 1000)),
    };
  }

  // Start the WebSocket server on the given port (defaults to saved/default port)
  start(port) {
    if (this._running) return { success: true, port: this._port };

    this._port = port || this._port;

    return new Promise((resolve) => {
      try {
        this._wss = new WebSocketServer({ host: '127.0.0.1', port: this._port });

        // [H-4] Chrome's Private Network Access (PNA, Chrome 101+) requires this header
        // on the WS 101 upgrade response, otherwise extension service workers are silently
        // blocked from connecting to localhost. The wildcard origin is a deliberate trade-off:
        // the pairing-code handshake is the security boundary, and the server already
        // rejects all non-127.0.0.1 TCP connections (see _onConnection below).
        this._wss.on('headers', (headers) => {
          headers.push('Access-Control-Allow-Origin: *');
          headers.push('Access-Control-Allow-Private-Network: true');
          headers.push('Access-Control-Allow-Headers: *');
        });

        this._wss.on('listening', () => {
          this._running = true;
          console.log(`[WsServer] Listening on ws://127.0.0.1:${this._port}`);
          resolve({ success: true, port: this._port });
        });

        this._wss.on('error', (err) => {
          console.error('[WsServer] Server error:', err.message);
          this._running = false;
          if (err.code === 'EADDRINUSE') {
            this._port += 1;
            this._wss.close();
            resolve(this.start(this._port));
          } else {
            resolve({ success: false, error: err.message });
          }
        });

        this._wss.on('connection', (ws, req) => this._onConnection(ws, req));

        this._wss.on('close', () => {
          console.log('[WsServer] Underlying server closed');
          this._running = false;
        });

      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this._running || !this._wss) {
        this._running = false;
        return resolve({ success: true });
      }
      // Close all client connections first
      this._clients.forEach(({ ws }) => {
        try { ws.close(1001, 'Server shutting down'); } catch (_) {}
      });
      this._clients.clear();
      // wss.close() callback fires only after the port is fully released
      this._wss.close((err) => {
        this._running = false;
        if (err) console.warn('[WsServer] stop() close error:', err.message);
        else     console.log('[WsServer] Server fully stopped, port released');
        resolve({ success: true });
      });
    });
  }

  // Generate (or refresh) a pairing code and display it in the app
  generatePairingCode() {
    const code = this._randomCode();
    this._pairing = {
      code,
      expiresAt: now() + PAIRING_TTL_MS,
      attempts: 0, // [S-3] failed-guess counter for this code
    };

    // Send to renderer so it can show it in the UI
    this._sendToRenderer('ws:pairingCode', {
      code,
      expiresAt: this._pairing.expiresAt,
    });

    // Auto-expire
    setTimeout(() => {
      if (this._pairing?.code === code) {
        this._pairing = null;
        this._sendToRenderer('ws:pairingCode', null);
      }
    }, PAIRING_TTL_MS);

    return { code, expiresAt: this._pairing.expiresAt };
  }

  // Revoke a paired session (disconnect + remove token)
  revokeSession(profileId) {
    // Disconnect if currently connected
    for (const [socketId, client] of this._clients) {
      if (client.profileId === profileId) {
        try { client.ws.close(1008, 'Session revoked'); } catch (_) {}
        this._clients.delete(socketId);
      }
    }
    delete this._sessions[profileId];
    this._saveSessions();
    this._notifySessionChange();
    return { success: true };
  }

  // Push vault-updated event to all connected extensions
  broadcastVaultUpdate(data) {
    if (!this._running) return;
    const sanitized = this._sanitizeVaultData(data);
    this._broadcast({ type: 'vault:updated', data: sanitized });
  }

  // Push lock state to all connected extensions
  broadcastLockState(locked) {
    if (!this._running) return;
    this._broadcast({ type: 'vault:lockState', locked });
  }

  // ── Connection handling ────────────────────────────────────────────────────

  _onConnection(ws, req) {
    const socketId = randomHex(8);
    const ip = req.socket.remoteAddress;

    // Reject connections from non-localhost
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      ws.close(1008, 'Non-local connection rejected');
      return;
    }

    ws.on('message', (raw) => this._onMessage(ws, socketId, raw));
    ws.on('close',   ()    => this._onClose(socketId));
    ws.on('error',   (err) => console.error(`[WsServer] Client error (${socketId}):`, err.message));

    // Send hello — client must authenticate within 10 seconds
    this._send(ws, { type: 'hello', version: 1 });

    const timeout = setTimeout(() => {
      if (!this._clients.has(socketId)) {
        ws.close(4001, 'Authentication timeout');
      }
    }, 10_000);

    // Store temp entry until auth succeeds
    ws._authTimeout = timeout;
    ws._socketId   = socketId;
  }

  _onClose(socketId) {
    const client = this._clients.get(socketId);
    if (client) {
      if (this._sessions[client.profileId]) {
        this._sessions[client.profileId].lastSeen = new Date().toISOString();
        this._saveSessions();
      }
      this._clients.delete(socketId);
      this._notifySessionChange();
      console.log(`[WsServer] Disconnected: ${client.profileName || socketId}`);
    }
  }

  async _onMessage(ws, socketId, rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      this._send(ws, { type: 'error', code: 'INVALID_JSON' });
      return;
    }

    const { type } = msg;

    // ── Ping / keepalive (allowed before auth) ──
    if (type === 'ping') {
      this._send(ws, { type: 'pong' });
      // Reset the auth timeout so an unpaired client stays connected
      // while the user reads and types the pairing code.
      if (ws._authTimeout) {
        clearTimeout(ws._authTimeout);
        ws._authTimeout = setTimeout(() => {
          if (!this._clients.has(ws._socketId)) {
            ws.close(4001, 'Authentication timeout');
          }
        }, 10_000);
      }
      return;
    }

    // ── Auth: pair (first time) ──
    if (type === 'auth:pair') {
      await this._handlePair(ws, socketId, msg);
      return;
    }

    // ── Auth: resume (known token) ──
    if (type === 'auth:resume') {
      await this._handleResume(ws, socketId, msg);
      return;
    }

    // ── All other messages require an authenticated session ──
    const client = this._clients.get(socketId);
    if (!client) {
      this._send(ws, { type: 'error', code: 'NOT_AUTHENTICATED' });
      return;
    }

    await this._handleRequest(client, msg);
  }

  // ── Auth: pairing handshake ────────────────────────────────────────────────

  async _handlePair(ws, socketId, msg) {
    clearTimeout(ws._authTimeout);
    const { code, profileName = 'Unknown Profile' } = msg;

    if (!this._pairing || now() > this._pairing.expiresAt) {
      this._send(ws, { type: 'auth:error', code: 'NO_PAIRING_CODE', message: 'No active pairing code. Please generate one in the app.' });
      return;
    }

    // [S-3] Cap wrong-code attempts per pairing code. A 6-digit code has
    // 900,000 possibilities; without a limit, a local process could brute-force
    // it within the 5-minute TTL over a fast localhost WebSocket loop.
    const MAX_PAIR_ATTEMPTS = 8;
    if (code !== this._pairing.code) {
      this._pairing.attempts = (this._pairing.attempts || 0) + 1;
      if (this._pairing.attempts >= MAX_PAIR_ATTEMPTS) {
        this._pairing = null;
        this._sendToRenderer('ws:pairingCode', null);
        this._send(ws, { type: 'auth:error', code: 'TOO_MANY_ATTEMPTS', message: 'Too many incorrect attempts. Please generate a new pairing code.' });
        return;
      }
      this._send(ws, { type: 'auth:error', code: 'WRONG_CODE', message: 'Invalid pairing code.' });
      return;
    }

    // Success — create a new session
    const profileId   = randomHex(16);
    const sessionToken = randomHex(TOKEN_BYTES);

    this._sessions[profileId] = {
      tokenHash:   this._hmacToken(sessionToken), // [C-4] store HMAC — never plaintext token on disk
      profileName: profileName.slice(0, 64),
      pairedAt:    new Date().toISOString(),
      lastSeen:    new Date().toISOString(),
    };
    this._saveSessions();

    this._pairing = null; // one-time use
    this._sendToRenderer('ws:pairingCode', null);

    this._clients.set(socketId, {
      ws, profileId,
      token: sessionToken,
      profileName: this._sessions[profileId].profileName,
      connectedAt: new Date().toISOString(),
    });

    this._send(ws, {
      type:        'auth:paired',
      profileId,
      token:       sessionToken,
      profileName: this._sessions[profileId].profileName,
    });

    this._notifySessionChange();
    console.log(`[WsServer] Paired new profile: "${profileName}" (${profileId})`);

    // Send current vault state
    this._sendVaultState(this._clients.get(socketId));
  }

  async _handleResume(ws, socketId, msg) {
    clearTimeout(ws._authTimeout);
    const { profileId, token } = msg;

    const session = this._sessions[profileId];
    // [C-4] Compare HMAC of incoming token against stored hash, using a
    // constant-time comparison so response timing can't leak how many
    // leading hex characters matched.
    if (!session || !session.tokenHash || !this._safeCompare(session.tokenHash, this._hmacToken(token))) {
      this._send(ws, { type: 'auth:error', code: 'INVALID_TOKEN', message: 'Invalid or expired session token. Please re-pair.' });
      return;
    }

    this._sessions[profileId].lastSeen = new Date().toISOString();
    this._saveSessions();

    this._clients.set(socketId, {
      ws, profileId,
      token,
      profileName: session.profileName,
      connectedAt: new Date().toISOString(),
    });

    this._send(ws, {
      type:        'auth:resumed',
      profileName: session.profileName,
    });

    this._notifySessionChange();
    console.log(`[WsServer] Resumed session: "${session.profileName}"`);

    this._sendVaultState(this._clients.get(socketId));
  }

  // ── Request dispatch ───────────────────────────────────────────────────────

  async _handleRequest(client, msg) {
    const { type, requestId } = msg;
    const reply = (data) => this._send(client.ws, { ...data, requestId });

    if (!this._vaultManager) {
      reply({ type: 'error', code: 'SERVER_ERROR', message: 'Vault not initialized' });
      return;
    }

    switch (type) {

      // ── Vault state ──
      case 'vault:isUnlocked': {
        reply({ type: 'vault:isUnlocked', unlocked: this._vaultManager.isUnlocked() });
        break;
      }

      // ── Search items (metadata only — no passwords; see vault:getPassword) ──
      case 'vault:search': {
        if (!this._vaultManager.isUnlocked()) {
          reply({ type: 'error', code: 'VAULT_LOCKED' });
          break;
        }
        const { query = '', url = '' } = msg;
        const data  = this._vaultManager.getData();
        const items = this._sanitizeItems(data?.items || []); // includePassword defaults to false
        const q     = query.toLowerCase();
        let results;

        if (url && !q) {
          // URL-based autofill match
          results = this._matchByUrl(items, url);
        } else if (q) {
          results = items.filter(i =>
            i.name?.toLowerCase().includes(q) ||
            i.username?.toLowerCase().includes(q) ||
            i.url?.toLowerCase().includes(q)
          );
        } else {
          results = items.slice(0, 20); // return first 20 if no query
        }

        reply({ type: 'vault:searchResults', results: results.slice(0, 50) });
        break;
      }

      // ── Fetch the real password for exactly one item, on explicit request ──
      // [S-2] This is the only path that ever returns a raw password to the
      // extension. It's deliberately scoped to a single itemId so a compromised
      // extension can't harvest the whole vault via a single message — each
      // credential requires its own request, one at a time.
      case 'vault:getPassword': {
        if (!this._vaultManager.isUnlocked()) {
          reply({ type: 'error', code: 'VAULT_LOCKED' });
          break;
        }
        const { itemId } = msg;
        if (!itemId) {
          reply({ type: 'error', code: 'INVALID_REQUEST', message: 'itemId is required' });
          break;
        }
        const data = this._vaultManager.getData();
        const item = data?.items?.find(i => i.id === itemId);
        if (!item) {
          reply({ type: 'error', code: 'ITEM_NOT_FOUND' });
          break;
        }
        reply({ type: 'vault:password', itemId, password: item.password || '' });
        break;
      }

      // ── Get TOTP code for an item ──
      case 'vault:getTotp': {
        if (!this._vaultManager.isUnlocked()) {
          reply({ type: 'error', code: 'VAULT_LOCKED' });
          break;
        }
        const { itemId } = msg;
        const data  = this._vaultManager.getData();
        const item  = data?.items?.find(i => i.id === itemId);
        if (!item?.totp) {
          reply({ type: 'error', code: 'NO_TOTP' });
          break;
        }
        // Generate TOTP on main process side via TwoFAManager (injected separately)
        if (this._twoFAManager) {
          const totp = this._twoFAManager.generateTOTP(item.totp);
          reply({ type: 'vault:totpCode', itemId, code: totp.token, remaining: totp.remaining });
        } else {
          reply({ type: 'error', code: 'TOTP_UNAVAILABLE' });
        }
        break;
      }

      // ── Detect new/changed credential ──
      case 'vault:credentialDetected': {
        const { siteName, url: siteUrl, username } = msg;
        this._sendToRenderer('ws:credentialDetected', {
          siteName, url: siteUrl, username,
          profileName: client.profileName,
          profileId:   client.profileId,
        });
        reply({ type: 'vault:credentialDetectedAck' });
        break;
      }

      // ── Save new credential from extension ──
      case 'vault:saveItem': {
        if (!this._vaultManager?.isUnlocked()) {
          reply({ type: 'error', code: 'LOCKED' });
          break;
        }
        try {
          const item = await this._vaultManager.addItem(msg.item);
          // Push updated vault to all connected clients
          for (const [, c] of this._clients) this._sendVaultState(c);
          reply({ type: 'vault:saveItemOk', item });
        } catch (e) {
          reply({ type: 'error', code: 'SAVE_FAILED', message: e.message });
        }
        break;
      }

      // ── Update existing credential from extension ──
      case 'vault:updateItem': {
        if (!this._vaultManager?.isUnlocked()) {
          reply({ type: 'error', code: 'LOCKED' });
          break;
        }
        try {
          const item = await this._vaultManager.updateItem(msg.id, msg.updates);
          for (const [, c] of this._clients) this._sendVaultState(c);
          reply({ type: 'vault:updateItemOk', item });
        } catch (e) {
          reply({ type: 'error', code: 'UPDATE_FAILED', message: e.message });
        }
        break;
      }

      // ── Password generation ──
      case 'password:generate': {
        if (!this._cryptoEngine) {
          reply({ type: 'error', code: 'ENGINE_UNAVAILABLE' });
          break;
        }
        const { options = {}, url = '' } = msg;
        const password = this._cryptoEngine.generatePassword(options);
        reply({ type: 'password:generated', password });
        this._recordGeneratedPassword(password, url);
        break;
      }

      // ── Record a password generated locally by the extension (e.g. the popup's
      // instant offline generator) into the app's generation history. One-way
      // notification — the extension already has the password, it's just
      // informing the app of the event; no reply is required.
      case 'password:recordGenerated': {
        const { password = '', url = '' } = msg;
        if (password) this._recordGeneratedPassword(password, url);
        break;
      }

      // ── Ping (post-auth keepalive) ──
      case 'ping':
        reply({ type: 'pong' });
        break;

      default:
        reply({ type: 'error', code: 'UNKNOWN_TYPE', message: `Unknown message type: ${type}` });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _sendVaultState(client) {
    if (!client) return;
    const locked = !this._vaultManager?.isUnlocked();
    this._send(client.ws, { type: 'vault:lockState', locked });
    if (!locked) {
      const data     = this._vaultManager.getData();
      const sanitized = this._sanitizeVaultData(data);
      this._send(client.ws, { type: 'vault:updated', data: sanitized });
    }
  }

  _sanitizeVaultData(data) {
    if (!data) return null;
    return {
      items:   this._sanitizeItems(data.items || []),
      folders: (data.folders || []).map(f => ({ id: f.id, name: f.name, color: f.color })),
    };
  }

  _sanitizeItems(items, { includePassword = false } = {}) {
    // [S-2] Passwords are withheld by default. The extension only ever needs
    // metadata to show a match; the actual secret is fetched one-at-a-time via
    // 'vault:getPassword' at the moment the user chooses to fill a specific item.
    // This bounds what a compromised/malicious extension session can exfiltrate
    // in one shot — it can no longer harvest dozens of real passwords via a single
    // blank search or vault-state push.
    return items.map(i => ({
      id:         i.id,
      type:       i.type,
      name:       i.name,
      url:        i.url,
      username:   i.username,
      password:   includePassword ? i.password : undefined,
      hasPassword: !!i.password, // presence only — lets UI show/hide the copy/fill buttons without the secret
      totp:       i.totp ? true : false, // only indicate presence
      notes:      undefined,    // not needed in extension
      folderId:   i.folderId,
      favorite:   i.favorite,
      updatedAt:  i.updatedAt,
    }));
  }

  _matchByUrl(items, targetUrl) {
    let targetHost = '';
    try { targetHost = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return []; }

    return items
      .filter(i => {
        if (!i.url) return false;
        try {
          const itemHost = new URL(i.url).hostname.replace(/^www\./, '');
          return itemHost === targetHost || targetHost.endsWith('.' + itemHost) || itemHost.endsWith('.' + targetHost);
        } catch { return false; }
      })
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  }

  // Notify the renderer that the extension generated a password, so the app's
  // Generator page can log it into its history with a timestamp and source.
  // `url` is the page the extension was on when it generated the password;
  // if it's not a real http(s) page (extension popup with no specific site
  // context, a browser-internal page, etc.) the renderer falls back to "Local".
  _recordGeneratedPassword(password, url) {
    this._sendToRenderer('ws:passwordGenerated', {
      password,
      url: url || '',
      time: Date.now(),
    });
  }

  _isConnected(profileId) {
    for (const client of this._clients.values()) {
      if (client.profileId === profileId) return true;
    }
    return false;
  }

  _send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(data)); } catch (_) {}
    }
  }

  _broadcast(data) {
    for (const { ws } of this._clients.values()) {
      this._send(ws, data);
    }
  }

  _sendToRenderer(channel, payload) {
    if (this._mainWindow) {
      try { this._mainWindow.webContents.send(channel, payload); } catch (_) {}
    }
  }

  _notifySessionChange() {
    this._sendToRenderer('ws:sessions', this.getSessions());
    if (this._onSessionChange) this._onSessionChange(this.getSessions());
  }

  _randomCode() {
    // 6-digit numeric code like TOTP
    return String(crypto.randomInt(100000, 999999));
  }

  // ── Session persistence ────────────────────────────────────────────────────

  _loadSessions() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        // [C-4] Drop legacy sessions that still store a plaintext token (old format).
        // Affected profiles will be prompted to re-pair once.
        const migrated = {};
        for (const [id, s] of Object.entries(sessions)) {
          if (s.tokenHash && !s.token) migrated[id] = s;
        }
        return migrated;
      }
    } catch (_) {}
    return {};
  }

  _saveSessions() {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this._sessions, null, 2)); } catch (_) {}
  }

  // Allow injecting TwoFAManager and CryptoEngine from main.js
  setTwoFAManager(m)    { this._twoFAManager = m; }
  setCryptoEngine(e)    { this._cryptoEngine = e; }

  // [C-4] Load or generate the per-install HMAC signing key for session tokens
  _getOrCreateWsKey() {
    const keyFile = path.join(APP_DATA, 'ws-signing-key.json');
    try {
      if (fs.existsSync(keyFile)) {
        const data = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        if (data.key) return data.key;
      }
    } catch (_) {}
    const key = randomHex(32);
    try { fs.writeFileSync(keyFile, JSON.stringify({ key })); } catch (_) {}
    return key;
  }

  // [C-4] HMAC-SHA256 of token using the per-install signing key
  _hmacToken(token) {
    return crypto.createHmac('sha256', this._wsKey).update(token).digest('hex');
  }

  // Constant-time string comparison (both inputs are fixed-length hex digests
  // here, so the length check itself leaks nothing useful).
  _safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }
}

module.exports = WsServer;
