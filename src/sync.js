'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

class SyncManager {
  constructor() {
    this._provider = null;
    this._config = {};
    this._status = 'idle';
    this._configPath = path.join(os.homedir(), '.vauid', 'sync.json');
    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(this._configPath)) {
        const cfg = JSON.parse(fs.readFileSync(this._configPath, 'utf8'));
        this._provider = cfg.provider || null;
        this._config = cfg.config || {};
      }
    } catch {}
  }

  _saveConfig() {
    fs.writeFileSync(this._configPath, JSON.stringify({
      provider: this._provider,
      config: this._config,
    }, null, 2));
  }

  configure(provider, config) {
    this._provider = provider;
    this._config = config;
    this._saveConfig();
    return { success: true, provider };
  }

  disconnect() {
    this._provider = null;
    this._config = {};
    if (fs.existsSync(this._configPath)) fs.unlinkSync(this._configPath);
    return { success: true };
  }

  getStatus() {
    return {
      provider: this._provider,
      status: this._status,
      lastSync: this._config.lastSync || null,
      configured: !!this._provider,
    };
  }

  /**
   * Push the vault file to cloud storage.
   * For now: copies vault to a configured cloud-synced folder (Google Drive, OneDrive, Dropbox).
   * The cloud apps then handle actual upload.
   */
  async push(vaultPath) {
    if (!this._provider || !this._config.folder) {
      return { success: false, error: 'NOT_CONFIGURED' };
    }

    this._status = 'syncing';
    try {
      const destFolder = this._config.folder;
      // [C-2] Validate the configured folder is an absolute path to guard against
      // path-traversal if the config file is tampered with.
      if (!path.isAbsolute(destFolder)) {
        return { success: false, error: 'INVALID_FOLDER: path must be absolute' };
      }
      if (!fs.existsSync(destFolder)) {
        return { success: false, error: 'FOLDER_NOT_FOUND' };
      }
      const destPath = path.join(destFolder, path.basename(vaultPath));
      fs.copyFileSync(vaultPath, destPath);
      this._config.lastSync = new Date().toISOString();
      this._saveConfig();
      this._status = 'synced';
      return { success: true, path: destPath, lastSync: this._config.lastSync };
    } catch (err) {
      this._status = 'error';
      return { success: false, error: err.message };
    }
  }

  /**
   * Pull vault from cloud folder to local vault location
   */
  async pull(vaultPath) {
    if (!this._provider || !this._config.folder) {
      return { success: false, error: 'NOT_CONFIGURED' };
    }

    this._status = 'syncing';
    try {
      const srcPath = path.join(this._config.folder, path.basename(vaultPath));
      if (!fs.existsSync(srcPath)) {
        return { success: false, error: 'SOURCE_NOT_FOUND' };
      }

      // [M-3] Verify the pulled file starts with the KDBX magic bytes before
      // overwriting the local copy — guards against a truncated/corrupted remote file.
      const KDBX_MAGIC = Buffer.from([0x03, 0xd9, 0xa2, 0x9a]);
      const pulledBuf = fs.readFileSync(srcPath);
      if (pulledBuf.length < 4 || !pulledBuf.slice(0, 4).equals(KDBX_MAGIC)) {
        return { success: false, error: 'INVALID_KDBX: remote file is not a valid KeePass database' };
      }

      // Back up local first
      const backup = vaultPath + '.bak';
      fs.copyFileSync(vaultPath, backup);

      fs.writeFileSync(vaultPath, pulledBuf);
      this._config.lastSync = new Date().toISOString();
      this._saveConfig();
      this._status = 'synced';
      return { success: true, lastSync: this._config.lastSync };
    } catch (err) {
      this._status = 'error';
      return { success: false, error: err.message };
    }
  }

  /**
   * Get common cloud folder paths for auto-detection
   */
  static getCloudFolders() {
    const home = os.homedir();
    const candidates = {
      googledrive: [
        path.join(home, 'Google Drive'),
        path.join(home, 'GoogleDrive'),
        'G:\\My Drive',
        path.join(home, 'My Drive'),
      ],
      onedrive: [
        path.join(home, 'OneDrive'),
        path.join(home, 'OneDrive - Personal'),
      ],
      dropbox: [
        path.join(home, 'Dropbox'),
      ],
    };

    const found = {};
    for (const [provider, paths] of Object.entries(candidates)) {
      found[provider] = paths.filter(p => fs.existsSync(p));
    }
    return found;
  }
}

module.exports = SyncManager;
