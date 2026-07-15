'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// ipc-handlers.js — All IPC channel registrations for the main process
//
// Call register() once from main.js after the window is ready.
// Each logical group of handlers is separated by a clear section comment.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const SyncManager = require('./sync');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a synchronous vault operation so it always returns {success, error}. */
function safe(fn) {
  try   { return fn(); }
  catch (err) { return { success: false, error: err.message }; }
}

/** Same as safe() but for async operations. */
async function safeAsync(fn) {
  try   { return await fn(); }
  catch (err) { return { success: false, error: err.message }; }
}

// ── register() ───────────────────────────────────────────────────────────────

function register({
  ipcMain, mainWindow, vaultManager, syncManager, wsServer,
  dialog, shell, clipboard, app, fs: _fs, path: _path, os: _os, crypto,
  CryptoEngine, BreachChecker, TwoFAManager,
}) {

  // Convenience: send a message to the renderer, ignoring errors when the
  // window is not yet ready (e.g. during startup).
  const send = (channel, payload) => {
    try { mainWindow.webContents.send(channel, payload); } catch (_) {}
  };

  // ── Window controls ────────────────────────────────────────────────────────
  ipcMain.handle('window:minimize',    () => mainWindow.minimize());
  ipcMain.handle('window:close',       () => mainWindow.hide());
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());
  ipcMain.handle('window:maximize',    () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });

  // ── Vault ──────────────────────────────────────────────────────────────────

  ipcMain.handle('vault:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder for new vault',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('vault:openFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Open Vault',
      filters: [
        { name: 'VauID / KeePass Database', extensions: ['vauid', 'kdbx'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('vault:create', async (_e, folderPath, password, hint, vaultName) => {
    return safeAsync(async () => {
      const result = await vaultManager.create(folderPath, password, hint, vaultName);
      send('vault:status', false);
      return result;
    });
  });

  ipcMain.handle('vault:open',   (_e, vaultPath) => safe(() => vaultManager.open(vaultPath)));

  ipcMain.handle('vault:unlock', async (_e, password) => {
    return safeAsync(async () => {
      const result = await vaultManager.unlock(password);
      send('vault:status', false);
      wsServer?.broadcastLockState(false);
      return result;
    });
  });

  ipcMain.handle('vault:unlockWithPin', async (_e, pin) => {
    return safeAsync(async () => {
      const result = await vaultManager.unlockWithPin(pin);
      send('vault:status', false);
      wsServer?.broadcastLockState(false);
      return result;
    });
  });

  ipcMain.handle('vault:lock', () => {
    return safeAsync(async () => {
      const result = vaultManager.lock();
      send('vault:status', true);
      wsServer?.broadcastLockState(true);
      return result;
    });
  });

  ipcMain.handle('vault:save',            (_e, data) => safeAsync(async () => await vaultManager.save(data)));
  ipcMain.handle('vault:getData',         ()         => safe(() => vaultManager.getData()));
  ipcMain.handle('vault:isUnlocked',      ()         => vaultManager.isUnlocked());
  ipcMain.handle('vault:setPin',          (_e, pin)  => safe(() => vaultManager.setPin(pin)));
  ipcMain.handle('vault:getHint',         ()         => vaultManager.getHint());
  ipcMain.handle('vault:hasPin',          ()         => vaultManager.hasPinFile());
  ipcMain.handle('vault:getRecentVaults', ()         => vaultManager.getRecentVaults());
  ipcMain.handle('vault:removeRecent',    (_e, p)    => safe(() => vaultManager.removeRecent(p)));
  ipcMain.handle('vault:clearRecents',    ()         => safe(() => vaultManager.clearRecents()));
  ipcMain.handle('vault:getVaultFolder',  ()         => vaultManager.getVaultFolder());

  // ── Pattern unlock ──
  ipcMain.handle('vault:setPattern',         (_e, pattern) => safe(() => vaultManager.setPattern(pattern)));
  ipcMain.handle('vault:hasPattern',         ()            => vaultManager.hasPatternFile());
  ipcMain.handle('vault:removePattern',      ()            => safe(() => vaultManager.removePattern()));
  ipcMain.handle('vault:unlockWithPattern', async (_e, pattern) => {
    return safeAsync(async () => {
      const result = await vaultManager.unlockWithPattern(pattern);
      send('vault:status', false);
      wsServer?.broadcastLockState(false);
      return result;
    });
  });

  // ── Key file unlock ──
  ipcMain.handle('vault:hasKeyFile',    ()               => vaultManager.hasKeyFile());
  ipcMain.handle('vault:removeKeyFile', ()               => safe(() => vaultManager.removeKeyFile()));
  ipcMain.handle('vault:setKeyFile',    (_e, filePath)   => safe(() => vaultManager.setKeyFile(filePath)));

  ipcMain.handle('vault:generateKeyFile', async () => {
    return safeAsync(async () => {
      const r = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Key File',
        defaultPath: 'vauid-keyfile.keyx',
        filters: [{ name: 'Key File', extensions: ['keyx', 'key'] }],
      });
      if (r.canceled) return { success: false, error: 'CANCELLED' };
      return await vaultManager.generateKeyFile(r.filePath);
    });
  });

  ipcMain.handle('vault:pickKeyFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select Key File',
      filters: [{ name: 'Key File', extensions: ['keyx', 'key', '*'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('vault:unlockWithKeyFile', async (_e, filePath) => {
    return safeAsync(async () => {
      const result = await vaultManager.unlockWithKeyFile(filePath);
      send('vault:status', false);
      wsServer?.broadcastLockState(false);
      return result;
    });
  });

  ipcMain.handle('vault:changePassword', (_e, oldPw, newPw) =>
    safeAsync(async () => await vaultManager.changePassword(oldPw, newPw))
  );

  ipcMain.handle('vault:exportData', async (_e, format, folderId) => {
    return safeAsync(async () => {
      const data = vaultManager.exportData(format, folderId || null);
      const ext  = format === 'csv' ? 'csv' : 'json';
      const r = await dialog.showSaveDialog(mainWindow, {
        title: folderId ? 'Export This Client' : 'Export Vault Data',
        defaultPath: `vauid-export-${Date.now()}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (r.canceled) return { success: false, error: 'CANCELLED' };
      fs.writeFileSync(r.filePath, data);
      return { success: true, path: r.filePath };
    });
  });

  ipcMain.handle('vault:getUpcomingRenewals', (_e, days) => safe(() => vaultManager.getUpcomingRenewals(days)));

  ipcMain.handle('vault:importData', (_e, filePath) =>
    safeAsync(async () => await vaultManager.importData(fs.readFileSync(filePath, 'utf8')))
  );

  // ── Import: multi-format file picker + CSV + real KDBX-to-KDBX import ──
  ipcMain.handle('vault:pickImportFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Import From File',
      filters: [
        { name: 'All Supported', extensions: ['json', 'csv', 'vauid', 'kdbx'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'VauID / KeePass Database', extensions: ['vauid', 'kdbx'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('vault:importCSV', (_e, filePath) =>
    safeAsync(async () => await vaultManager.importCSV(fs.readFileSync(filePath, 'utf8')))
  );

  ipcMain.handle('vault:importKdbx', (_e, filePath, password) =>
    safeAsync(async () => await vaultManager.importKdbx(filePath, password))
  );

  // ── Items CRUD ─────────────────────────────────────────────────────────────
  ipcMain.handle('items:add',          (_e, item)          => safeAsync(async () => await vaultManager.addItem(item)));
  ipcMain.handle('items:update',       (_e, id, updates)   => safeAsync(async () => await vaultManager.updateItem(id, updates)));
  ipcMain.handle('items:delete',       (_e, id)            => safeAsync(async () => await vaultManager.deleteItem(id)));
  ipcMain.handle('items:getAll',       ()                  => safe(() => vaultManager.getData()?.items || []));
  ipcMain.handle('items:moveToFolder', (_e, id, folderId)  => safeAsync(async () => await vaultManager.updateItem(id, { folderId })));

  // ── Trash ──────────────────────────────────────────────────────────────────
  ipcMain.handle('trash:getAll',        ()       => safe(() => vaultManager.getData()?.trash || []));
  ipcMain.handle('trash:restore',       (_e, id) => safeAsync(async () => await vaultManager.restoreFromTrash(id)));
  ipcMain.handle('trash:deleteForever', (_e, id) => safeAsync(async () => await vaultManager.deleteFromTrash(id)));
  ipcMain.handle('trash:empty',         ()       => safeAsync(async () => await vaultManager.emptyTrash()));

  // ── Folders ────────────────────────────────────────────────────────────────
  ipcMain.handle('folders:add',    (_e, folder)        => safeAsync(async () => await vaultManager.addFolder(folder)));
  ipcMain.handle('folders:update', (_e, id, updates)   => safeAsync(async () => await vaultManager.updateFolder(id, updates)));
  ipcMain.handle('folders:delete', (_e, id)            => safeAsync(async () => await vaultManager.deleteFolder(id)));
  ipcMain.handle('folders:getAll', ()                  => safe(() => vaultManager.getData()?.folders || []));

  // ── Password tools ─────────────────────────────────────────────────────────
  ipcMain.handle('password:generate', (_e, options) => {
    try { return CryptoEngine.generatePassword(options); }
    catch (err) { return ''; } // renderer already guards against a falsy/empty result
  });
  ipcMain.handle('password:strength',         (_e, pwd)     => CryptoEngine.passwordStrength(pwd));
  ipcMain.handle('password:checkBreach',      async (_e, pwd)   =>
    safeAsync(() => BreachChecker.checkPassword(pwd))
  );
  ipcMain.handle('password:checkEmailBreach', async (_e, email, apiKey) =>
    safeAsync(() => BreachChecker.checkEmail(email, apiKey || ''))
  );

  // ── Two-factor authentication ──────────────────────────────────────────────
  ipcMain.handle('twofa:generateSecret', (_e, label, issuer) => TwoFAManager.generateSecret(label, issuer));
  ipcMain.handle('twofa:verifyToken',    (_e, secret, token) => TwoFAManager.verifyToken(secret, token));
  ipcMain.handle('twofa:generateQR',     (_e, otpauth)       => TwoFAManager.generateQR(otpauth));
  ipcMain.handle('twofa:generateTOTP',   (_e, secret)        => TwoFAManager.generateTOTP(secret));

  // ── Cloud sync ─────────────────────────────────────────────────────────────
  ipcMain.handle('sync:configure', (_e, provider, config) => syncManager.configure(provider, config));

  ipcMain.handle('sync:push', async () => {
    const vaultPath = vaultManager.getVaultPath();
    if (!vaultPath) return { success: false, error: 'NO_VAULT' };
    return syncManager.push(vaultPath);
  });

  ipcMain.handle('sync:pull', async () => {
    const vaultPath = vaultManager.getVaultPath();
    if (!vaultPath) return { success: false, error: 'NO_VAULT' };
    const result = await syncManager.pull(vaultPath);
    if (result.success) {
      // Reload decrypted data in memory and push fresh state to renderer
      await safeAsync(async () => {
        await vaultManager.reload();
        send('vault:updated', vaultManager.getData());
      });
    }
    return result;
  });

  ipcMain.handle('sync:getStatus', () => {
    const status = syncManager.getStatus();
    return {
      ...status,
      cloudFolders: SyncManager.getCloudFolders(),
      vaultFolder:  vaultManager.getVaultFolder(),
    };
  });

  ipcMain.handle('sync:disconnect', () => {
    const result = syncManager.disconnect();
    send('sync:status', { ok: false, disconnected: true });
    return result;
  });

  // ── File attachments ───────────────────────────────────────────────────────

  ipcMain.handle('attachments:pickFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select File Attachment',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('attachments:add', (_e, itemId, filePath) =>
    safeAsync(async () => await vaultManager.addAttachment(itemId, filePath))
  );

  ipcMain.handle('attachments:remove', (_e, itemId, attachId) =>
    safeAsync(() => vaultManager.removeAttachment(itemId, attachId)) // [S-2] removeAttachment is already async
  );

  ipcMain.handle('attachments:export', async (_e, itemId, attachId) => {
    return safeAsync(async () => {
      const att = vaultManager.getData()?.attachments?.[itemId]?.[attachId];
      if (!att) return { success: false, error: 'NOT_FOUND' };
      const r = await dialog.showSaveDialog(mainWindow, {
        defaultPath: att.name,
        title: 'Export Attachment',
      });
      if (r.canceled) return { success: false, error: 'CANCELLED' };
      return vaultManager.exportAttachment(itemId, attachId, r.filePath);
    });
  });

  // Paste-screenshot: attach whatever image is currently on the clipboard
  // (e.g. right after a Snipping Tool / Win+Shift+S capture) directly to an
  // item, without a save-file round trip first.
  ipcMain.handle('clipboard:hasImage', () => {
    try { return !clipboard.readImage().isEmpty(); } catch { return false; }
  });

  ipcMain.handle('attachments:pasteImage', (_e, itemId) => {
    return safeAsync(async () => {
      const img = clipboard.readImage();
      if (img.isEmpty()) return { success: false, error: 'NO_IMAGE_ON_CLIPBOARD' };
      const buf = img.toPNG();
      const tmpPath = path.join(os.tmpdir(), `vauid-paste-${Date.now()}.png`);
      fs.writeFileSync(tmpPath, buf);
      try {
        return await vaultManager.addAttachment(itemId, tmpPath);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch { }
      }
    });
  });

  // ── Clipboard ──────────────────────────────────────────────────────────────
  // Auto-clears after 30 seconds as a security measure.
  ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(text);
    setTimeout(() => { if (clipboard.readText() === text) clipboard.writeText(''); }, 30_000);
    return { success: true };
  });
  ipcMain.handle('clipboard:clear', () => { clipboard.writeText(''); return { success: true }; });

  // ── Shell / OS ─────────────────────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', (_e, url) => {
    // Allowlist only http/https — reject file:, javascript:, and other schemes
    try {
      const parsed = new URL(String(url || '').trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      if (/[\r\n\t]/.test(url)) return; // guard against header-injection tricks
      shell.openExternal(parsed.href);
    } catch (_) { /* invalid URL — silently ignore */ }
  });
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:getHome',  ()      => os.homedir());

  // ── App system (startup, version) ─────────────────────────────────────────

  ipcMain.handle('app:getStartup', () => {
    try {
      const s = app.getLoginItemSettings();
      return { enabled: s.openAtLogin };
    } catch { return { enabled: false }; }
  });

  ipcMain.handle('app:setStartup', (_e, enable) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enable });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  // ── WebSocket Server ───────────────────────────────────────────────────────

  ipcMain.handle('ws:getStatus', () => ({
    running:  wsServer?.isRunning() || false,
    port:     wsServer?.getPort()   || 0,
    sessions: wsServer?.getSessions() || [],
    pairing:  wsServer?.getActivePairingCode() || null,
  }));

  ipcMain.handle('ws:generatePairingCode', () => {
    if (!wsServer?.isRunning()) return { success: false, error: 'SERVER_NOT_RUNNING' };
    const result = wsServer.generatePairingCode();
    return { success: true, ...result };
  });

  ipcMain.handle('ws:revokeSession', (_e, profileId) => {
    if (!wsServer) return { success: false, error: 'NO_SERVER' };
    return wsServer.revokeSession(profileId);
  });

  ipcMain.handle('ws:restart', async (_e, port) => {
    if (!wsServer) return { success: false, error: 'NO_SERVER' };
    await wsServer.stop();   // wait for port to fully release
    return wsServer.start(port);
  });
}

module.exports = { register };
