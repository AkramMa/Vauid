'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// main.js — Electron main process
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, shell, clipboard } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');

// Internal modules
const VaultManager  = require('./src/vault');
const CryptoEngine  = require('./src/crypto');
const SyncManager   = require('./src/sync');
const BreachChecker = require('./src/breach');
const TwoFAManager  = require('./src/twofa');
const IpcHandlers   = require('./src/ipc-handlers');
const WsServer      = require('./src/ws-server');

// ── Crash detection ───────────────────────────────────────────────────────────
// Surface any silent crash that might kill the WS server after startup
process.on('uncaughtException',  (err) => console.error('[CRASH] uncaughtException:', err));
process.on('unhandledRejection', (r)   => console.error('[CRASH] unhandledRejection:', r));


// ── Constants ─────────────────────────────────────────────────────────────────

const APP_NAME = 'VauID';
const ASSETS   = (...parts) => path.join(__dirname, 'assets', ...parts);

// ── Singletons ────────────────────────────────────────────────────────────────

let mainWindow   = null;
let tray         = null;
let vaultManager = null;
let syncManager  = null;
let wsServer     = null;

// ── Single-instance guard ─────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:    1280,
    height:   800,
    minWidth: 960,
    minHeight: 650,
    frame:    false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d0f14',
    icon: ASSETS('icon.png'),
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,   // [H-3] renderer is fully sandboxed; preload contextBridge provides all needed APIs
      webSecurity:      true,
      allowRunningInsecureContent: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimal right-click context menu (cut / copy / paste)
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { label: 'Cut',        role: 'cut',       enabled: params.selectionText.length > 0 },
        { label: 'Copy',       role: 'copy',      enabled: params.selectionText.length > 0 },
        { label: 'Paste',      role: 'paste' },
        { type:  'separator' },
        { label: 'Select All', role: 'selectAll' }
      );
    } else if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy' });
    }
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  // Hide instead of quit when the user closes the window
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  Menu.setApplicationMenu(null);
}

// ── System tray ───────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = fs.existsSync(ASSETS('tray-icon.ico'))
    ? ASSETS('tray-icon.ico')
    : fs.existsSync(ASSETS('tray-icon.png'))
      ? ASSETS('tray-icon.png')
      : ASSETS('icon.png');

  tray = new Tray(iconPath);
  tray.setToolTip(`${APP_NAME} Password Manager`);

  const rebuild = (locked = true) => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`,  click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      { label: locked ? 'Vault Locked 🔒' : 'Vault Unlocked 🔓', enabled: false },
      { type: 'separator' },
      { label: 'Lock Vault', click: () => mainWindow.webContents.send('tray:lock') },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => { app.isQuitting = true; app.quit(); } },
    ]));
  };

  rebuild(true);
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
  ipcMain.on('vault:status', (_e, locked) => rebuild(locked));
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  createTray();

  vaultManager = new VaultManager();
  syncManager  = new SyncManager();
  wsServer     = new WsServer();

  wsServer.setVaultManager(vaultManager);
  wsServer.setMainWindow(mainWindow);
  wsServer.setTwoFAManager(TwoFAManager);
  wsServer.setCryptoEngine(CryptoEngine);

  // Broadcast vault changes to connected extension sessions & renderer
  vaultManager.setAfterSaveHook((vaultPath) => {
    if (syncManager.getStatus().configured) {
      syncManager.push(vaultPath)
        .then(r => { if (r.success) mainWindow?.webContents?.send('sync:status', { ok: true, ts: r.lastSync }); })
        .catch(() => {});
    }
    const data = vaultManager.isUnlocked() ? vaultManager.getData() : null;
    mainWindow?.webContents?.send('vault:updated', data);
    if (data) wsServer.broadcastVaultUpdate(data);
  });

  // Start WS server
  const wsResult = await wsServer.start();
  if (wsResult.success) {
    console.log(`[Main] WsServer started on port ${wsResult.port}`);
  } else {
    console.error('[Main] WsServer failed to start:', wsResult.error);
  }

  IpcHandlers.register({
    ipcMain, mainWindow, vaultManager, syncManager, wsServer,
    dialog, shell, clipboard, app, fs, path, os, crypto,
    CryptoEngine, BreachChecker, TwoFAManager,
  });
});

app.on('activate',         () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit',      () => { app.isQuitting = true; wsServer?.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
