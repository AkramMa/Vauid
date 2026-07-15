'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// preload.js — Secure bridge between main process and renderer
//
// Exposes a narrow, typed API via contextBridge so the renderer never touches
// Node.js or Electron internals directly.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

// Helper: wrap an IPC channel into a one-liner invoke call
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

// Channels the renderer is allowed to listen on (allowlist)
const ALLOWED_EVENTS = [
  'tray:lock', 'vault:status', 'vault:updated', 'sync:status',
  'ws:pairingCode', 'ws:sessions', 'ws:credentialDetected', 'ws:passwordGenerated',
];

contextBridge.exposeInMainWorld('vauid', {

  // ── Window controls ─────────────────────────────────────────────────────────
  window: {
    minimize:    () => invoke('window:minimize'),
    maximize:    () => invoke('window:maximize'),
    close:       () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
  },

  // ── Vault management ────────────────────────────────────────────────────────
  vault: {
    create:         (folderPath, password, hint, vaultName) => invoke('vault:create', folderPath, password, hint, vaultName),
    open:           (filePath)                   => invoke('vault:open',   filePath),
    unlock:         (password)                   => invoke('vault:unlock', password),
    unlockWithPin:  (pin)                        => invoke('vault:unlockWithPin', pin),
    lock:           ()                           => invoke('vault:lock'),
    save:           (data)                       => invoke('vault:save',   data),
    getData:        ()                           => invoke('vault:getData'),
    setPin:         (pin)                        => invoke('vault:setPin', pin),
    changePassword: (oldPw, newPw)               => invoke('vault:changePassword', oldPw, newPw),
    getHint:        ()                           => invoke('vault:getHint'),
    hasPin:         ()                           => invoke('vault:hasPin'),
    isUnlocked:     ()                           => invoke('vault:isUnlocked'),
    pickFolder:     ()                           => invoke('vault:pickFolder'),
    openFile:       ()                           => invoke('vault:openFile'),
    getRecentVaults: ()                          => invoke('vault:getRecentVaults'),
    removeRecent:    (vaultPath)                 => invoke('vault:removeRecent', vaultPath),
    clearRecents:    ()                          => invoke('vault:clearRecents'),
    getVaultFolder:  ()                          => invoke('vault:getVaultFolder'),
    exportData:     (format, folderId)          => invoke('vault:exportData', format, folderId),
    importData:     (filePath)                   => invoke('vault:importData', filePath),
    pickImportFile: ()                           => invoke('vault:pickImportFile'),
    importCSV:      (filePath)                   => invoke('vault:importCSV', filePath),
    importKdbx:     (filePath, password)         => invoke('vault:importKdbx', filePath, password),
    getUpcomingRenewals: (days)                  => invoke('vault:getUpcomingRenewals', days),

    // Pattern unlock
    setPattern:        (pattern) => invoke('vault:setPattern', pattern),
    hasPattern:        ()        => invoke('vault:hasPattern'),
    removePattern:     ()        => invoke('vault:removePattern'),
    unlockWithPattern: (pattern) => invoke('vault:unlockWithPattern', pattern),

    // Key file unlock
    hasKeyFile:        ()          => invoke('vault:hasKeyFile'),
    removeKeyFile:     ()          => invoke('vault:removeKeyFile'),
    setKeyFile:        (filePath)  => invoke('vault:setKeyFile', filePath),
    generateKeyFile:   ()          => invoke('vault:generateKeyFile'),
    pickKeyFile:       ()          => invoke('vault:pickKeyFile'),
    unlockWithKeyFile: (filePath)  => invoke('vault:unlockWithKeyFile', filePath),
  },

  // ── Trash ───────────────────────────────────────────────────────────────────
  trash: {
    getAll:        ()    => invoke('trash:getAll'),
    restore:       (id)  => invoke('trash:restore',       id),
    deleteForever: (id)  => invoke('trash:deleteForever', id),
    empty:         ()    => invoke('trash:empty'),
  },

  // ── Items CRUD ──────────────────────────────────────────────────────────────
  items: {
    add:          (item)              => invoke('items:add',          item),
    update:       (id, updates)       => invoke('items:update',       id, updates),
    delete:       (id)                => invoke('items:delete',       id),
    getAll:       ()                  => invoke('items:getAll'),
    moveToFolder: (id, folderId)      => invoke('items:moveToFolder', id, folderId),
  },

  // ── Folders ─────────────────────────────────────────────────────────────────
  folders: {
    add:    (folder)          => invoke('folders:add',    folder),
    update: (id, updates)     => invoke('folders:update', id, updates),
    delete: (id)              => invoke('folders:delete', id),
    getAll: ()                => invoke('folders:getAll'),
  },

  // ── Password tools ───────────────────────────────────────────────────────────
  password: {
    generate:         (options) => invoke('password:generate',         options),
    strength:         (pwd)     => invoke('password:strength',         pwd),
    checkBreach:      (pwd)          => invoke('password:checkBreach',      pwd),
    checkEmailBreach: (email, apiKey) => invoke('password:checkEmailBreach', email, apiKey || ''),
  },

  // ── Two-factor authentication ────────────────────────────────────────────────
  twofa: {
    generateSecret: (label, issuer) => invoke('twofa:generateSecret', label, issuer),
    verifyToken:    (secret, token) => invoke('twofa:verifyToken',    secret, token),
    generateQR:     (otpauth)       => invoke('twofa:generateQR',     otpauth),
    generateTOTP:   (secret)        => invoke('twofa:generateTOTP',   secret),
  },

  // ── Cloud sync ──────────────────────────────────────────────────────────────
  sync: {
    configure:  (provider, config) => invoke('sync:configure', provider, config),
    push:       ()                  => invoke('sync:push'),
    pull:       ()                  => invoke('sync:pull'),
    getStatus:  ()                  => invoke('sync:getStatus'),
    disconnect: ()                  => invoke('sync:disconnect'),
  },

  // ── File attachments ─────────────────────────────────────────────────────────
  attachments: {
    add:      (itemId, filePath)           => invoke('attachments:add',      itemId, filePath),
    remove:   (itemId, attachId)           => invoke('attachments:remove',   itemId, attachId),
    export:   (itemId, attachId) => invoke('attachments:export', itemId, attachId), // [S-3] destPath removed — save dialog handled on main-process side
    pickFile: ()                           => invoke('attachments:pickFile'),
    pasteImage: (itemId)                   => invoke('attachments:pasteImage', itemId),
  },

  // ── Clipboard ───────────────────────────────────────────────────────────────
  clipboard: {
    write: (text) => invoke('clipboard:write', text),
    clear: ()     => invoke('clipboard:clear'),
    hasImage: () => invoke('clipboard:hasImage'),
  },

  // ── Shell / OS ──────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url) => invoke('shell:openExternal', url),
    openPath:     (p)   => invoke('shell:openPath',     p),
    getHome:      ()    => invoke('shell:getHome'),
  },

  // ── App (startup, version) ────────────────────────────────────────────────────
  app: {
    getStartup: ()         => invoke('app:getStartup'),
    setStartup: (enable)   => invoke('app:setStartup', enable),
    getVersion: ()         => invoke('app:getVersion'),
  },

  // ── Extension WebSocket bridge ───────────────────────────────────────────────
  ws: {
    getStatus:           ()          => invoke('ws:getStatus'),
    generatePairingCode: ()          => invoke('ws:generatePairingCode'),
    revokeSession:       (profileId) => invoke('ws:revokeSession', profileId),
    restart:             (port)      => invoke('ws:restart', port),
  },

  // ── Event bus (main → renderer) ─────────────────────────────────────────────
  // Only channels in ALLOWED_EVENTS can be subscribed to.
  on(channel, callback) {
    if (ALLOWED_EVENTS.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => callback(...args));
    }
  },
  off(channel, callback) {
    ipcRenderer.removeListener(channel, callback);
  },
});
