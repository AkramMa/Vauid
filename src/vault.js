'use strict';

// vault.js — VaultManager backed by KeePassXC .kdbx files (kdbxweb)
//
// Reads ANY .kdbx file (KeePassXC, KeePass 2.x, KeeWeb, etc.)
// Writes kdbx4 + Argon2id — same default as KeePassXC 2.7+
//
// KeePassXC field mapping:
//   Title, UserName, Password, URL, Notes  → standard KeePass fields
//   TOTP  → 'otp' field  (otpauth:// URI — KeePassXC native format)
//   Tags  → entry.tags   (string array)
//   Folders → KeePass groups (no extra metadata needed)
//   Custom fields → any non-standard field key on the entry
//   Attachments   → entry.binaries (await db.createBinary())
//   Type / app meta → 'vd_type', 'vd_json' custom fields (invisible to KeePassXC)

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

if (!global.crypto) global.crypto = crypto.webcrypto;

const { Kdbx, KdbxCredentials, ProtectedValue, CryptoEngine } = require('kdbxweb');

// Wire argon2 — required for KeePassXC databases (Argon2id default)
try {
  const argon2 = require('argon2');
  CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
    const variant = type === 2 ? argon2.argon2id
      : type === 1 ? argon2.argon2i
        : argon2.argon2d;
    const hash = await argon2.hash(Buffer.from(password), {
      salt: Buffer.from(salt),
      memoryCost: Math.max(8, memory),          // already in KiB — do NOT divide
      timeCost: Math.max(1, iterations),
      parallelism: Math.max(1, parallelism),     // use the actual parallelism arg
      hashLength: length,
      type: variant,
      raw: true,
    });
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
  });
} catch (_) {
  // argon2 not installed — kdbx3/AES-KDF files still open
  // kdbx4/Argon2 files (KeePassXC default) will throw ARGON2_UNAVAILABLE
}


// ── Constants ─────────────────────────────────────────────────────────────────
const VAULT_EXT = '.vauid';
const LEGACY_EXT = '.kdbx'; // still openable/importable — same binary format, different extension
const META_FILE = 'vauid.meta.json';
const PIN_FILE = 'vauid.pin.json';
const PATTERN_FILE = 'vauid.pattern.json';
const KEYFILE_FILE = 'vauid.keyfile.json';
const APP_DATA = path.join(os.homedir(), '.vauid');
const RECENT_FILE = path.join(APP_DATA, 'recent.json');

// Standard KeePass fields — everything else is a custom field
const STD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', 'otp']);
// Our private metadata prefix (invisible to KeePassXC but survives round-trips)
const VD = 'vd_';

// ── Helpers ───────────────────────────────────────────────────────────────────
function pv(str) { return ProtectedValue.fromString(str || ''); }
function uuidHex(uuid) { return Buffer.from(uuid.id).toString('hex'); }
function toAB(buf) { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }

function readField(entry, name) {
  const v = entry.fields.get(name);
  if (v == null) return '';
  return typeof v.getText === 'function' ? v.getText() : String(v);
}

// KdbxCustomDataMap values are {value, lastModified} objects, not plain
// strings (see kdbxweb's kdbx-custom-data.ts) — these helpers centralize the
// correct shape so every call site (group colors/dates, db-level settings)
// actually round-trips through save+reload instead of silently failing to
// serialize (a plain string has no `.value`, so KdbxCustomData.write() skips
// it entirely) or crashing outright (a freshly created KdbxGroup's own
// customData starts as `undefined` until first written).
function cdGet(map, key) {
  const item = map?.get?.(key);
  return item ? item.value : undefined;
}
function cdSet(map, key, value) {
  map.set(key, { value, lastModified: new Date() });
}

// ── VaultManager ──────────────────────────────────────────────────────────────
class VaultManager {
  constructor() {
    this._vaultPath = null;
    this._db = null;
    this._credentials = null;
    this._currentPassword = null;
    this._unlocked = false;
    this._onAfterSave = null;
    if (!fs.existsSync(APP_DATA)) fs.mkdirSync(APP_DATA, { recursive: true });
  }

  setAfterSaveHook(fn) { this._onAfterSave = fn; }

  // ── Create ────────────────────────────────────────────────────────────────
  async create(folderPath, password, hint = '', vaultName = '') {
    // Use the name the user actually typed in the form; fall back to the
    // selected folder's own name only if none was provided.
    const rawName = (vaultName && vaultName.trim()) || path.basename(folderPath);
    // Strip characters that aren't safe in filenames
    const name = rawName.replace(/[\\/:*?"<>|]/g, '').trim() || path.basename(folderPath);
    const vaultPath = path.join(folderPath, `${name}${VAULT_EXT}`);
    const creds = new KdbxCredentials(pv(password));
    const db = Kdbx.create(creds, name);

    // kdbx4 + Argon2id — same as KeePassXC defaults
    db.upgrade();

    // Store app settings in db customData (invisible to KeePassXC)
    cdSet(db.meta.customData, 'vd_settings',
      JSON.stringify({ autoLock: 5, theme: 'dark', language: 'en', trashDays: 30 }));

    const buf = Buffer.from(await db.save());
    fs.writeFileSync(vaultPath, buf);
    fs.writeFileSync(
      path.join(folderPath, META_FILE),
      JSON.stringify({ hint, createdAt: new Date().toISOString(), version: 4 }, null, 2)
    );
    this._vaultPath = vaultPath; this._db = db; this._credentials = creds;
    this._currentPassword = Buffer.from(password, 'utf8'); // [C-3] store as Buffer so it can be zeroed on lock()
    this._unlocked = true;
    this._saveRecent(vaultPath);
    return { success: true, vaultPath };
  }

  // ── Open ──────────────────────────────────────────────────────────────────
  open(vaultPath) {
    if (!fs.existsSync(vaultPath)) throw new Error('FILE_NOT_FOUND');
    if (!vaultPath.endsWith(VAULT_EXT) && !vaultPath.endsWith(LEGACY_EXT)) throw new Error('INVALID_FILE');
    this._vaultPath = vaultPath; this._unlocked = false; this._db = null;
    this._saveRecent(vaultPath);
    const metaPath = path.join(path.dirname(vaultPath), META_FILE);
    let hint = '';
    if (fs.existsSync(metaPath)) {
      try { hint = JSON.parse(fs.readFileSync(metaPath, 'utf8')).hint || ''; } catch { }
    }
    return { success: true, hint };
  }

  // ── Unlock ────────────────────────────────────────────────────────────────
  async unlock(password) {
    if (!this._vaultPath) throw new Error('NO_VAULT');
    const fileBuf = fs.readFileSync(this._vaultPath);
    const creds = new KdbxCredentials(pv(password));
    let db;
    try {
      db = await Kdbx.load(toAB(fileBuf), creds);
    } catch (err) {
      const code = err.code || '';
      const msg = err.message || '';
      if (code === 'InvalidKey' || msg.includes('InvalidKey')) throw new Error('WRONG_PASSWORD');
      if (code === 'NotImplemented' || msg.includes('argon2 not impl')) throw new Error('ARGON2_UNAVAILABLE');
      throw err;
    }
    this._db = db;
    this._credentials = creds;
    this._currentPassword = Buffer.from(password, 'utf8'); // [C-3] store as Buffer so it can be zeroed on lock()
    this._unlocked = true;
    setImmediate(() => this._purgeTrash()); // [M-1] defer so unlock() returns immediately
    return { success: true };
  }

  // ── Unlock with PIN ───────────────────────────────────────────────────────
  async unlockWithPin(pin) {
    if (!this._vaultPath) throw new Error('NO_VAULT');
    const pinPath = path.join(path.dirname(this._vaultPath), PIN_FILE);
    if (!fs.existsSync(pinPath)) throw new Error('NO_PIN_SET');
    const pinData = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
    const failures = pinData.failures || 0, lockedAt = pinData.lockedAt || 0;
    const LOCK_MS = 30_000, MAX = 5, REVOKE = 10;
    if (failures >= REVOKE) { try { fs.unlinkSync(pinPath); } catch { } throw new Error('PIN_REVOKED'); }
    if (lockedAt && Date.now() - lockedAt < LOCK_MS)
      throw new Error(`PIN_LOCKED:${Math.ceil((LOCK_MS - (Date.now() - lockedAt)) / 1000)}`);
    if (!pinData.v || pinData.v < 2) { try { fs.unlinkSync(pinPath); } catch { } throw new Error('PIN_UPGRADE_REQUIRED'); }
    const inputHash = this._hashPin(pin, pinData.salt);
    // Constant-time comparison — both are fixed-length hex digests, so the
    // length check itself leaks nothing useful.
    const hashesMatch = inputHash.length === pinData.hash.length &&
      crypto.timingSafeEqual(Buffer.from(inputHash, 'utf8'), Buffer.from(pinData.hash, 'utf8'));
    if (!hashesMatch) {
      const nf = failures + 1;
      fs.writeFileSync(pinPath, JSON.stringify({ ...pinData, failures: nf, lockedAt: nf % MAX === 0 ? Date.now() : 0 }));
      if (nf >= REVOKE) throw new Error('PIN_REVOKED');
      if (nf % MAX === 0) throw new Error('PIN_LOCKED:30');
      throw new Error('WRONG_PIN');
    }
    const { failures: _f, lockedAt: _l, ...clean } = pinData;
    fs.writeFileSync(pinPath, JSON.stringify(clean));
    return this.unlock(this._decryptPinMaster(pinData.encMaster, pin));
  }

  // ── Set PIN ───────────────────────────────────────────────────────────────
  setPin(pin) {
    if (!this._unlocked) throw new Error('LOCKED');
    const salt = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(
      path.join(path.dirname(this._vaultPath), PIN_FILE),
      JSON.stringify({
        v: 2, hash: this._hashPin(pin, salt), salt,
        encMaster: this._encryptPinMaster(this._currentPassword, pin)
      })
    );
    return { success: true };
  }

  hasPinFile() {
    return !!(this._vaultPath && fs.existsSync(path.join(path.dirname(this._vaultPath), PIN_FILE)));
  }

  // ── Pattern unlock ────────────────────────────────────────────────────────
  // A pattern (e.g. dots joined as "0-4-8-6-2") is just an arbitrary string,
  // so it reuses the exact same PBKDF2 + AES-GCM helpers as PIN. It's stored
  // in its own file so it can never collide with or overwrite a separately
  // configured numeric PIN.
  setPattern(pattern) {
    if (!this._unlocked) throw new Error('LOCKED');
    if (!pattern || pattern.length < 7) throw new Error('PATTERN_TOO_SHORT'); // e.g. min 4 dots "0-1-2-3"
    const salt = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(
      path.join(path.dirname(this._vaultPath), PATTERN_FILE),
      JSON.stringify({
        v: 2, hash: this._hashPin(pattern, salt), salt,
        encMaster: this._encryptPinMaster(this._currentPassword, pattern)
      })
    );
    return { success: true };
  }

  hasPatternFile() {
    return !!(this._vaultPath && fs.existsSync(path.join(path.dirname(this._vaultPath), PATTERN_FILE)));
  }

  removePattern() {
    if (this._vaultPath) {
      const p = path.join(path.dirname(this._vaultPath), PATTERN_FILE);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    return { success: true };
  }

  async unlockWithPattern(pattern) {
    if (!this._vaultPath) throw new Error('NO_VAULT');
    const patPath = path.join(path.dirname(this._vaultPath), PATTERN_FILE);
    if (!fs.existsSync(patPath)) throw new Error('NO_PATTERN_SET');
    const patData = JSON.parse(fs.readFileSync(patPath, 'utf8'));
    const failures = patData.failures || 0, lockedAt = patData.lockedAt || 0;
    const LOCK_MS = 30_000, MAX = 5, REVOKE = 10;
    if (failures >= REVOKE) { try { fs.unlinkSync(patPath); } catch { } throw new Error('PATTERN_REVOKED'); }
    if (lockedAt && Date.now() - lockedAt < LOCK_MS)
      throw new Error(`PATTERN_LOCKED:${Math.ceil((LOCK_MS - (Date.now() - lockedAt)) / 1000)}`);
    const inputHash = this._hashPin(pattern, patData.salt);
    const hashesMatch = inputHash.length === patData.hash.length &&
      crypto.timingSafeEqual(Buffer.from(inputHash, 'utf8'), Buffer.from(patData.hash, 'utf8'));
    if (!hashesMatch) {
      const nf = failures + 1;
      fs.writeFileSync(patPath, JSON.stringify({ ...patData, failures: nf, lockedAt: nf % MAX === 0 ? Date.now() : 0 }));
      if (nf >= REVOKE) throw new Error('PATTERN_REVOKED');
      if (nf % MAX === 0) throw new Error('PATTERN_LOCKED:30');
      throw new Error('WRONG_PATTERN');
    }
    const { failures: _f, lockedAt: _l, ...clean } = patData;
    fs.writeFileSync(patPath, JSON.stringify(clean));
    return this.unlock(this._decryptPinMaster(patData.encMaster, pattern));
  }

  // ── Key file unlock ───────────────────────────────────────────────────────
  // Unlike a PIN or pattern, a key file's bytes are (or can be) high-entropy —
  // a randomly generated one is effectively unguessable, so no attempt lockout
  // is needed here: presenting the wrong file just fails a hash check. The raw
  // file bytes never leave disk; only a verification hash and an encrypted
  // copy of the master password (keyed off the file's bytes via PBKDF2) are stored.
  async generateKeyFile(destPath) {
    if (!this._unlocked) throw new Error('LOCKED');
    // Real KeePass-format key file (kdbxweb's own generator) — also openable
    // by KeePassXC/KeePass if the person ever wants to use it there too.
    const bytes = await KdbxCredentials.createRandomKeyFile(2);
    fs.writeFileSync(destPath, Buffer.from(bytes));
    this.setKeyFile(destPath);
    return { success: true, path: destPath };
  }

  setKeyFile(keyFilePath) {
    if (!this._unlocked) throw new Error('LOCKED');
    const fileBuf = fs.readFileSync(keyFilePath);
    const salt = crypto.randomBytes(32);
    const derivedKey = crypto.pbkdf2Sync(fileBuf, salt, 600000, 32, 'sha512');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const enc = Buffer.concat([c.update(this._currentPassword), c.final()]);
    const payload = {
      v: 1,
      verifyHash: crypto.createHash('sha256').update(fileBuf).digest('hex'),
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: c.getAuthTag().toString('hex'),
      encMaster: enc.toString('hex'),
    };
    fs.writeFileSync(path.join(path.dirname(this._vaultPath), KEYFILE_FILE), JSON.stringify(payload));
    derivedKey.fill(0);
    return { success: true };
  }

  hasKeyFile() {
    return !!(this._vaultPath && fs.existsSync(path.join(path.dirname(this._vaultPath), KEYFILE_FILE)));
  }

  removeKeyFile() {
    if (this._vaultPath) {
      const p = path.join(path.dirname(this._vaultPath), KEYFILE_FILE);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    return { success: true };
  }

  async unlockWithKeyFile(keyFilePath) {
    if (!this._vaultPath) throw new Error('NO_VAULT');
    const kfPath = path.join(path.dirname(this._vaultPath), KEYFILE_FILE);
    if (!fs.existsSync(kfPath)) throw new Error('NO_KEYFILE_SET');
    const payload = JSON.parse(fs.readFileSync(kfPath, 'utf8'));
    let fileBuf;
    try { fileBuf = fs.readFileSync(keyFilePath); } catch { throw new Error('KEYFILE_NOT_FOUND'); }

    const gotHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
    const hashOk = gotHash.length === payload.verifyHash.length &&
      crypto.timingSafeEqual(Buffer.from(gotHash, 'utf8'), Buffer.from(payload.verifyHash, 'utf8'));
    if (!hashOk) throw new Error('WRONG_KEYFILE');

    const salt = Buffer.from(payload.salt, 'hex');
    const derivedKey = crypto.pbkdf2Sync(fileBuf, salt, 600000, 32, 'sha512');
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const enc = Buffer.from(payload.encMaster, 'hex');
    let master;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
      d.setAuthTag(tag);
      master = Buffer.concat([d.update(enc), d.final()]);
    } catch {
      derivedKey.fill(0);
      throw new Error('WRONG_KEYFILE');
    }
    derivedKey.fill(0);
    const pw = master.toString('utf8');
    master.fill(0);
    return this.unlock(pw);
  }

  lock() {
    this._db = null; this._credentials = null;
    this._unlocked = false;
    // [C-3] Zero out the master password buffer before releasing it
    if (this._currentPassword) { this._currentPassword.fill(0); }
    this._currentPassword = null;
    return { success: true };
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async save(overrideData) {
    if (!this._unlocked || !this._vaultPath) throw new Error('LOCKED');
    if (overrideData?.settings)
      cdSet(this._db.meta.customData, 'vd_settings', JSON.stringify(overrideData.settings));
    const buf = Buffer.from(await this._db.save());
    const tmp = this._vaultPath + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this._vaultPath);
    if (this._onAfterSave) try { this._onAfterSave(this._vaultPath); } catch { }
    return { success: true };
  }

  getData() {
    if (!this._unlocked) throw new Error('LOCKED');
    return this._snapshot();
  }

  isUnlocked() { return this._unlocked; }
  getVaultPath() { return this._vaultPath; }
  getVaultFolder() { return this._vaultPath ? path.dirname(this._vaultPath) : null; }

  // ── Items CRUD ────────────────────────────────────────────────────────────
  async addItem(item) {
    if (!this._unlocked) throw new Error('LOCKED');
    // Place in the correct group (folder) or root
    const group = item.folderId ? (this._findGroup(item.folderId) || this._rootGroup()) : this._rootGroup();
    const entry = this._db.createEntry(group);
    const id = uuidHex(entry.uuid);
    const newItem = {
      ...item, id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folderId: item.folderId || null,
      favorite: item.favorite || false,
    };
    this._writeEntry(entry, newItem);
    await this.save();
    return newItem;
  }

  async updateItem(id, updates) {
    if (!this._unlocked) throw new Error('LOCKED');
    const entry = this._findEntry(id);
    if (!entry) throw new Error('ITEM_NOT_FOUND');
    const current = this._readEntry(entry);
    const updated = { ...current, ...updates, updatedAt: new Date().toISOString() };
    this._writeEntry(entry, updated);
    // Handle folder move
    if (updates.folderId !== undefined && updates.folderId !== current.folderId) {
      const targetGroup = updates.folderId ? (this._findGroup(updates.folderId) || this._rootGroup()) : this._rootGroup();
      this._db.move(entry, targetGroup);
    }
    await this.save();
    return updated;
  }

  async deleteItem(id) {
    if (!this._unlocked) throw new Error('LOCKED');
    const entry = this._findEntry(id);
    if (entry) {
      const recycleBin = this._getOrCreateRecycleBin();
      entry.fields.set(`${VD}deletedAt`, new Date().toISOString());
      this._db.move(entry, recycleBin);
    }
    await this.save();
    return { success: true };
  }

  async deleteFromTrash(id) {
    if (!this._unlocked) throw new Error('LOCKED');
    const bin = this._getRecycleBin();
    if (bin) {
      const e = this._findInGroup(bin, id);
      if (e) this._db.remove(e);
    }
    await this.save();
    return { success: true };
  }

  async restoreFromTrash(id) {
    if (!this._unlocked) throw new Error('LOCKED');
    const bin = this._getRecycleBin();
    if (!bin) throw new Error('NOT_IN_TRASH');
    const e = this._findInGroup(bin, id);
    if (!e) throw new Error('NOT_IN_TRASH');
    e.fields.delete(`${VD}deletedAt`);
    this._db.move(e, this._rootGroup());
    await this.save();
    return { success: true };
  }

  async emptyTrash() {
    if (!this._unlocked) throw new Error('LOCKED');
    const bin = this._getRecycleBin();
    if (bin) [...bin.entries].forEach(e => this._db.remove(e));
    await this.save();
    return { success: true };
  }

  async _purgeTrash() {
    const days = this._settings().trashDays ?? 30;
    if (!days) return;
    const cutoff = Date.now() - days * 86_400_000;
    const bin = this._getRecycleBin();
    if (!bin) return;
    let removed = false;
    [...bin.entries].forEach(e => {
      const d = readField(e, `${VD}deletedAt`);
      if (d && new Date(d).getTime() < cutoff) { this._db.remove(e); removed = true; }
    });
    if (removed) await this.save();
  }

  // ── Folders — backed by KeePass groups ───────────────────────────────────
  async addFolder(folder) {
    if (!this._unlocked) throw new Error('LOCKED');
    const parentGroup = folder.parentId ? (this._findGroup(folder.parentId) || this._rootGroup()) : this._rootGroup();
    const g = this._db.createGroup(parentGroup, folder.name || 'New Folder');
    // A freshly created KdbxGroup's customData starts as `undefined` (only
    // populated automatically when reading an existing group from a file) —
    // must initialize it before calling .set() or this throws.
    if (!g.customData) g.customData = new Map();
    const id = uuidHex(g.uuid);
    // Store colour + parent in group customData so it round-trips
    cdSet(g.customData, 'vd_color', folder.color || '#6366f1');
    cdSet(g.customData, 'vd_createdAt', new Date().toISOString());
    const nf = { ...folder, id, createdAt: new Date().toISOString(), color: folder.color || '#6366f1', parentId: folder.parentId || null };
    await this.save();
    return nf;
  }

  async updateFolder(id, updates) {
    if (!this._unlocked) throw new Error('LOCKED');
    const g = this._findGroup(id);
    if (!g) throw new Error('FOLDER_NOT_FOUND');
    if (!g.customData) g.customData = new Map();
    if (updates.name) g.name = updates.name;
    if (updates.color) cdSet(g.customData, 'vd_color', updates.color);
    if (updates.parentId !== undefined) {
      const targetGroup = updates.parentId ? (this._findGroup(updates.parentId) || this._rootGroup()) : this._rootGroup();
      // Refuse to move a folder into itself or one of its own descendants —
      // that would create an unreachable cycle.
      if (!this._isAncestorOf(g, targetGroup)) {
        this._db.move(g, targetGroup);
      }
    }
    await this.save();
    return { id, name: g.name, color: cdGet(g.customData, 'vd_color') || '#6366f1' };
  }

  // True if `maybeDescendant` is `group` itself or nested anywhere inside it.
  _isAncestorOf(group, maybeDescendant) {
    if (group === maybeDescendant) return true;
    for (const c of group.groups) {
      if (this._isAncestorOf(c, maybeDescendant)) return true;
    }
    return false;
  }

  async deleteFolder(id) {
    if (!this._unlocked) throw new Error('LOCKED');
    const g = this._findGroup(id);
    if (g) {
      // [M-2] Walk all entries recursively so nested sub-groups aren't silently lost
      const moveAll = (group) => {
        [...group.entries].forEach(e => {
          e.fields.delete(`${VD}folderId`);
          this._db.move(e, this._rootGroup());
        });
        [...group.groups].forEach(child => moveAll(child));
      };
      moveAll(g);
      this._db.remove(g);
    }
    await this.save();
    return { success: true };
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  async addAttachment(itemId, filePath) {
    if (!this._unlocked) throw new Error('LOCKED');
    const entry = this._findEntry(itemId);
    if (!entry) throw new Error('ITEM_NOT_FOUND');
    const buf = fs.readFileSync(filePath);
    const name = path.basename(filePath);
    const aId = crypto.randomUUID();
    // MUST await db.createBinary — it returns a Promise
    const bin = await this._db.createBinary(buf);
    entry.binaries.set(`${aId}::${name}`, bin);
    // Track metadata in a private field
    const meta = this._attachMeta(entry);
    meta[aId] = { id: aId, name, size: buf.length, type: path.extname(filePath), addedAt: new Date().toISOString() };
    entry.fields.set(`${VD}attachMeta`, JSON.stringify(meta));
    await this.save();
    return { success: true, attachId: aId };
  }

  exportAttachment(itemId, attachId, destPath) {
    if (!this._unlocked) throw new Error('LOCKED');
    const entry = this._findEntry(itemId);
    if (!entry) throw new Error('ITEM_NOT_FOUND');
    for (const [key, ref] of entry.binaries) {
      if (key.startsWith(attachId + '::')) {
        const val = ref?.value;
        const data = val instanceof ArrayBuffer ? Buffer.from(val)
          : val?.getBinary ? Buffer.from(val.getBinary())
            : Buffer.from(val);
        fs.writeFileSync(destPath, data);
        return { success: true };
      }
    }
    throw new Error('ATTACHMENT_NOT_FOUND');
  }

  async removeAttachment(itemId, attachId) {
    if (!this._unlocked) throw new Error('LOCKED');
    const entry = this._findEntry(itemId);
    if (!entry) throw new Error('ITEM_NOT_FOUND');
    // Remove the binary from the kdbx entry
    for (const key of entry.binaries.keys()) {
      if (key.startsWith(attachId + '::')) {
        entry.binaries.delete(key);
        break;
      }
    }
    // Remove from attachment metadata
    const meta = this._attachMeta(entry);
    delete meta[attachId];
    if (Object.keys(meta).length > 0) {
      entry.fields.set(`${VD}attachMeta`, JSON.stringify(meta));
    } else {
      entry.fields.delete(`${VD}attachMeta`);
    }
    await this.save();
    return { success: true };
  }

  // ── Password change ───────────────────────────────────────────────────────
  async changePassword(oldPw, newPw) {
    if (!this._unlocked) throw new Error('LOCKED');
    // [C-3] Compare against string representation of the buffered password
    if (oldPw !== this._currentPassword?.toString('utf8')) {
      try { await Kdbx.load(toAB(fs.readFileSync(this._vaultPath)), new KdbxCredentials(pv(oldPw))); }
      catch { throw new Error('WRONG_PASSWORD'); }
    }
    this._credentials = new KdbxCredentials(pv(newPw));
    if (this._currentPassword) this._currentPassword.fill(0); // [C-3] zero old password
    this._currentPassword = Buffer.from(newPw, 'utf8');
    this._db.credentials = this._credentials;
    await this.save();
    const p = path.join(path.dirname(this._vaultPath), PIN_FILE);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    const pat = path.join(path.dirname(this._vaultPath), PATTERN_FILE);
    if (fs.existsSync(pat)) fs.unlinkSync(pat);
    const kf = path.join(path.dirname(this._vaultPath), KEYFILE_FILE);
    if (fs.existsSync(kf)) fs.unlinkSync(kf);
    return { success: true };
  }

  // ── Export / Import ───────────────────────────────────────────────────────
  exportData(format = 'json', folderId = null) {
    if (!this._unlocked) throw new Error('LOCKED');
    const { items, folders } = this._snapshot();
    let scoped = items;
    if (folderId) {
      const idsInScope = new Set([folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of folders) {
          if (f.parentId && idsInScope.has(f.parentId) && !idsInScope.has(f.id)) {
            idsInScope.add(f.id);
            grew = true;
          }
        }
      }
      scoped = items.filter(i => i.folderId && idsInScope.has(i.folderId));
    }
    if (format === 'json') return JSON.stringify(scoped, null, 2);
    const rows = [['Name', 'URL', 'Username', 'Password', 'Notes']];
    scoped.filter(i => i.type === 'login').forEach(l =>
      rows.push([l.name, l.url || '', l.username || '', l.password || '', l.notes || ''])
    );
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  getUpcomingRenewals(days = 30) {
    if (!this._unlocked) throw new Error('LOCKED');
    const { items } = this._snapshot();
    const now = Date.now();
    const horizon = now + days * 86_400_000;
    return items
      .filter(i => i.renewalDate && !i.deletedAt)
      .map(i => ({ ...i, _dueInMs: new Date(i.renewalDate).getTime() - now }))
      .filter(i => !Number.isNaN(i._dueInMs) && new Date(i.renewalDate).getTime() <= horizon)
      .sort((a, b) => a._dueInMs - b._dueInMs);
  }

  async importData(rawJson) {
    if (!this._unlocked) throw new Error('LOCKED');
    let items;
    try { items = JSON.parse(rawJson); }
    catch { throw new Error('INVALID_FORMAT'); }
    if (!Array.isArray(items)) throw new Error('INVALID_FORMAT');
    for (const item of items) {
      const e = this._db.createEntry(this._rootGroup());
      const id = uuidHex(e.uuid);
      // [H-2] Whitelist allowed fields — prevents a crafted import from injecting
      // private vd_* metadata or corrupting vault structure.
      const safe = {
        id,
        type:         String(item.type         || 'login'),
        name:         String(item.name         || ''),
        username:     String(item.username      || ''),
        password:     String(item.password      || ''),
        url:          String(item.url           || ''),
        notes:        String(item.notes         || ''),
        totp:         String(item.totp          || ''),
        tags:         Array.isArray(item.tags) ? item.tags.map(String) : [],
        customFields: Array.isArray(item.customFields) ? item.customFields : [],
        favorite:     Boolean(item.favorite),
        folderId:     null,
        createdAt:    item.createdAt || new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
        importedAt:   new Date().toISOString(),
      };
      this._writeEntry(e, safe);
    }
    await this.save();
    return { success: true, count: items.length };
  }

  // Minimal, dependency-free CSV parser. Handles quoted fields (with embedded
  // commas, quotes via "", and newlines), \r\n and \n line endings.
  static _parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Imports a CSV export from VauID itself, Chrome/Edge, Firefox, Bitwarden,
  // or basically anything with recognizable column headers — columns are
  // matched case-insensitively against a list of common aliases per field,
  // rather than requiring one exact vendor format.
  async importCSV(rawCsv) {
    if (!this._unlocked) throw new Error('LOCKED');
    const rows = VaultManager._parseCSV(rawCsv);
    if (rows.length < 2) throw new Error('EMPTY_CSV');

    const header = rows[0].map(h => String(h || '').trim().toLowerCase());
    const findCol = (...names) => header.findIndex(h => names.includes(h));
    const col = {
      name:     findCol('name', 'title'),
      url:      findCol('url', 'website', 'login_uri', 'uri', 'web site'),
      username: findCol('username', 'user', 'login', 'login_username', 'email'),
      password: findCol('password', 'pass', 'login_password'),
      notes:    findCol('notes', 'note', 'extra', 'comments'),
      totp:     findCol('totp', 'login_totp', 'otpauth', 'otp'),
    };
    if (col.name === -1 && col.username === -1 && col.password === -1) {
      throw new Error('UNRECOGNIZED_CSV_FORMAT');
    }

    let count = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => !c)) continue; // skip blank rows
      const get = (idx) => (idx >= 0 && row[idx] != null) ? String(row[idx]) : '';
      const name = get(col.name) || get(col.url) || get(col.username) || 'Imported item';
      const e = this._db.createEntry(this._rootGroup());
      const id = uuidHex(e.uuid);
      this._writeEntry(e, {
        id, type: 'login', name,
        username: get(col.username), password: get(col.password),
        url: get(col.url), notes: get(col.notes), totp: get(col.totp),
        tags: [], customFields: [], favorite: false, folderId: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        importedAt: new Date().toISOString(),
      });
      count++;
    }
    await this.save();
    return { success: true, count };
  }

  // Imports entries from a SEPARATE .kdbx/.vauid file (e.g. an old vault) into
  // the CURRENTLY OPEN one — opened with its own password, which is almost
  // always different from the current vault's. Folder structure is recreated;
  // the source file's own Recycle Bin is skipped.
  async importKdbx(filePath, password) {
    if (!this._unlocked) throw new Error('LOCKED');
    let fileBuf;
    try { fileBuf = fs.readFileSync(filePath); } catch { throw new Error('FILE_NOT_FOUND'); }

    const creds = new KdbxCredentials(pv(password));
    let srcDb;
    try {
      srcDb = await Kdbx.load(toAB(fileBuf), creds);
    } catch (err) {
      const code = err.code || '', msg = err.message || '';
      if (code === 'InvalidKey' || msg.includes('InvalidKey')) throw new Error('WRONG_PASSWORD');
      if (code === 'NotImplemented' || msg.includes('argon2 not impl')) throw new Error('ARGON2_UNAVAILABLE');
      throw err;
    }

    const srcBinHex = srcDb.meta.recycleBinUuid
      ? Buffer.from(srcDb.meta.recycleBinUuid.id).toString('hex')
      : null;

    let count = 0;
    const importGroup = (srcGroup, destFolderId) => {
      for (const e of srcGroup.entries) {
        const otpRaw = readField(e, 'otp');
        let totp = '';
        if (otpRaw && otpRaw.startsWith('otpauth://')) {
          try { totp = new URL(otpRaw).searchParams.get('secret') || ''; } catch { }
        } else if (otpRaw) totp = otpRaw;

        const destGroup = destFolderId ? (this._findGroup(destFolderId) || this._rootGroup()) : this._rootGroup();
        const newEntry = this._db.createEntry(destGroup);
        const id = uuidHex(newEntry.uuid);
        this._writeEntry(newEntry, {
          id, type: 'login',
          name: readField(e, 'Title'),
          username: readField(e, 'UserName'),
          password: readField(e, 'Password'),
          url: readField(e, 'URL'),
          notes: readField(e, 'Notes'),
          totp,
          tags: Array.isArray(e.tags) ? e.tags : [],
          customFields: [], favorite: false, folderId: destFolderId,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          importedAt: new Date().toISOString(),
        });
        count++;
      }
      for (const childGroup of srcGroup.groups) {
        if (srcBinHex && uuidHex(childGroup.uuid) === srcBinHex) continue; // skip source's Recycle Bin
        const parentGroup = destFolderId ? (this._findGroup(destFolderId) || this._rootGroup()) : this._rootGroup();
        const newGroup = this._db.createGroup(parentGroup, childGroup.name || 'Imported');
        importGroup(childGroup, uuidHex(newGroup.uuid));
      }
    };
    importGroup(srcDb.getDefaultGroup(), null);

    await this.save();
    return { success: true, count };
  }

  async reload() {
    if (!this._unlocked || !this._vaultPath || !this._currentPassword) return;
    try {
      // [C-3] Convert Buffer to string for ProtectedValue.fromString()
      const db = await Kdbx.load(toAB(fs.readFileSync(this._vaultPath)), new KdbxCredentials(pv(this._currentPassword.toString('utf8'))));
      this._db = db;
    } catch { }
  }

  // ── Recent vaults ─────────────────────────────────────────────────────────
  _saveRecent(p) {
    let r = this._loadRecents();
    r = [p, ...r.filter(x => x !== p)].slice(0, 5);
    fs.writeFileSync(RECENT_FILE, JSON.stringify(r));
  }
  _loadRecents() { try { return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8')); } catch { return []; } }
  getRecentVaults() { return this._loadRecents().filter(p => fs.existsSync(p)); }

  // Removes one vault from the recent list only — the vault file itself is
  // untouched, this just forgets it for the switcher/chooser UI.
  removeRecent(vaultPath) {
    const r = this._loadRecents().filter(p => p !== vaultPath);
    fs.writeFileSync(RECENT_FILE, JSON.stringify(r));
    return { success: true };
  }

  clearRecents() {
    fs.writeFileSync(RECENT_FILE, JSON.stringify([]));
    return { success: true };
  }
  getHint() {
    const m = this._vaultPath ? path.join(path.dirname(this._vaultPath), META_FILE) : null;
    try { return m && fs.existsSync(m) ? JSON.parse(fs.readFileSync(m, 'utf8')).hint || '' : ''; } catch { return ''; }
  }

  // ── Private: group/entry navigation ──────────────────────────────────────

  // The root group is the database's default group (the named one at the top)
  _rootGroup() { return this._db.getDefaultGroup(); }

  // KeePassXC's Recycle Bin is a special group referenced in db.meta.recycleBinUuid
  _getRecycleBin() {
    const uuid = this._db.meta.recycleBinUuid;
    if (!uuid) return null;
    return this._walkGroups(this._rootGroup(), g =>
      Buffer.from(g.uuid.id).toString('hex') === Buffer.from(uuid.id).toString('hex')
    );
  }

  _getOrCreateRecycleBin() {
    const existing = this._getRecycleBin();
    if (existing) return existing;
    const bin = this._db.createGroup(this._rootGroup(), 'Recycle Bin');
    this._db.meta.recycleBinUuid = bin.uuid;
    this._db.meta.recycleBinEnabled = true;
    return bin;
  }

  _findGroup(id) {
    return this._walkGroups(this._rootGroup(), g => uuidHex(g.uuid) === id);
  }
  _walkGroups(g, pred) {
    if (pred(g)) return g;
    for (const c of g.groups) { const f = this._walkGroups(c, pred); if (f) return f; }
    return null;
  }

  _findEntry(id) {
    return this._walkEntries(this._rootGroup(), e => uuidHex(e.uuid) === id);
  }
  _findInGroup(g, id) { return this._walkEntries(g, e => uuidHex(e.uuid) === id); }
  _walkEntries(g, pred) {
    for (const e of g.entries) if (pred(e)) return e;
    for (const c of g.groups) { const f = this._walkEntries(c, pred); if (f) return f; }
    return null;
  }

  // ── Entry ↔ item mapping ──────────────────────────────────────────────────

  _writeEntry(entry, item) {
    // Standard KeePass fields
    entry.fields.set('Title', item.name || '');
    entry.fields.set('UserName', item.username || '');
    entry.fields.set('Password', pv(item.password || ''));
    entry.fields.set('URL', item.url || '');
    entry.fields.set('Notes', item.notes || '');

    // TOTP — stored as otpauth:// URI in 'otp' field (KeePassXC native format)
    if (item.totp) {
      // If it's already an otpauth URI keep it, otherwise wrap the secret
      const uri = item.totp.startsWith('otpauth://')
        ? item.totp
        : `otpauth://totp/${encodeURIComponent(item.name || 'Account')}?secret=${item.totp}&period=30&digits=6`;
      entry.fields.set('otp', pv(uri));
    } else {
      entry.fields.delete('otp');
    }

    // Tags (KeePassXC native)
    entry.tags = Array.isArray(item.tags) ? item.tags : [];

    // Custom fields from the customFields array (card, identity, SSH, etc.)
    // Accepts either `.name` (KeePass-native field key) or `.label` (what the
    // app's own form UI actually sends) so both shapes round-trip correctly.
    const existingCustom = new Set();
    if (Array.isArray(item.customFields)) {
      for (const cf of item.customFields) {
        const fieldName = cf.name || cf.label;
        if (!fieldName) continue;
        existingCustom.add(fieldName);
        const isProtected = cf.protected !== undefined ? cf.protected : !!cf.hidden;
        const val = isProtected ? pv(cf.value || '') : (cf.value || '');
        entry.fields.set(fieldName, val);
      }
    }
    // Remove custom fields that were deleted
    for (const k of entry.fields.keys()) {
      if (!STD_FIELDS.has(k) && !k.startsWith(VD) && !existingCustom.has(k)) {
        entry.fields.delete(k);
      }
    }

    // Private app metadata (type, folderId, favorite, extra data)
    entry.fields.set(`${VD}type`, item.type || 'login');
    entry.fields.set(`${VD}folderId`, item.folderId || '');
    entry.fields.set(`${VD}favorite`, String(item.favorite || false));
    entry.fields.set(`${VD}createdAt`, item.createdAt || new Date().toISOString());
    entry.fields.set(`${VD}updatedAt`, item.updatedAt || new Date().toISOString());
    if (item.deletedAt) entry.fields.set(`${VD}deletedAt`, item.deletedAt);

    // Extra structured data (card numbers, identity fields, etc.)
    // [S-6] vd_json intentionally double-stores some fields (id, type, folderId, etc.)
    // that are also in dedicated vd_* fields. This redundancy preserves round-trip
    // fidelity if a third-party client strips unknown custom fields.
    const blob = { ...item };
    ['password', 'totp', 'name', 'username', 'url', 'notes', 'tags', 'customFields'].forEach(k => delete blob[k]);
    entry.fields.set(`${VD}json`, JSON.stringify(blob));
  }

  _readEntry(entry) {
    let extra = {};
    try { extra = JSON.parse(readField(entry, `${VD}json`) || '{}'); } catch { }

    // Read all non-standard, non-private fields as customFields. Both `.name`
    // and `.label` are populated (the form UI reads `.label`/`.hidden`; other
    // code and raw KeePassXC-authored fields expect `.name`/`.protected`).
    const customFields = [];
    for (const [k, v] of entry.fields) {
      if (STD_FIELDS.has(k) || k.startsWith(VD)) continue;
      const isProtected = v && typeof v.getText === 'function';
      customFields.push({
        name: k,
        label: k,
        value: isProtected ? v.getText() : String(v || ''),
        protected: isProtected,
        hidden: isProtected,
      });
    }

    // Parse TOTP — return the secret if it's an otpauth URI, else as-is
    const otpRaw = readField(entry, 'otp');
    let totp = otpRaw;
    if (otpRaw && otpRaw.startsWith('otpauth://')) {
      try {
        const url = new URL(otpRaw);
        const secret = url.searchParams.get('secret');
        if (secret) totp = secret; // expose the raw secret for TOTP generation
      } catch { }
      // Also expose the full URI for display/editing
      extra.totpUri = otpRaw;
    }

    return {
      ...extra,
      id: uuidHex(entry.uuid),
      name: readField(entry, 'Title'),
      username: readField(entry, 'UserName'),
      password: readField(entry, 'Password'),
      url: readField(entry, 'URL'),
      notes: readField(entry, 'Notes'),
      totp: totp || extra.totp || '',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      customFields,
      type: readField(entry, `${VD}type`) || extra.type || 'login',
      folderId: readField(entry, `${VD}folderId`) || null,
      createdAt: readField(entry, `${VD}createdAt`) || extra.createdAt,
      updatedAt: readField(entry, `${VD}updatedAt`) || extra.updatedAt,
      favorite: readField(entry, `${VD}favorite`) === 'true',
      deletedAt: readField(entry, `${VD}deletedAt`) || undefined,
    };
  }

  _attachMeta(entry) {
    try { return JSON.parse(readField(entry, `${VD}attachMeta`) || '{}'); } catch { return {}; }
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  _snapshot() {
    const root = this._rootGroup();
    const binUuid = this._db.meta.recycleBinUuid;
    const binHex = binUuid ? Buffer.from(binUuid.id).toString('hex') : null;

    // Collect folders (all sub-groups except Recycle Bin), recursively, with parentId
    const grpGet = (g, key) => cdGet(g.customData, key) || '';
    const folders = [];
    const walkFolders = (group, parentId) => {
      for (const g of group.groups) {
        if (uuidHex(g.uuid) === binHex) continue;
        const fid = uuidHex(g.uuid);
        folders.push({
          id: fid,
          name: g.name,
          color: grpGet(g, 'vd_color') || '#6366f1',
          createdAt: grpGet(g, 'vd_createdAt') || '',
          parentId: parentId,
        });
        walkFolders(g, fid);
      }
    };
    walkFolders(root, null);

    // Collect all entries, separating trash
    const items = [], trash = [];
    const attachments = {};

    const walkAll = (group, isTrash) => {
      const isThisTrash = binHex && uuidHex(group.uuid) === binHex;
      for (const e of group.entries) {
        const item = this._readEntry(e);
        const meta = this._attachMeta(e);
        if (Object.keys(meta).length) attachments[item.id] = meta;
        if (isTrash || isThisTrash) trash.push(item);
        else items.push(item);
      }
      for (const child of group.groups) {
        walkAll(child, isTrash || isThisTrash);
      }
    };
    walkAll(root, false);

    return {
      version: 4, createdAt: '', updatedAt: new Date().toISOString(),
      items, trash, folders, attachments, settings: this._settings(),
    };
  }

  _settings() {
    try { return JSON.parse(cdGet(this._db.meta.customData, 'vd_settings') || '{}'); }
    catch { return { autoLock: 5, theme: 'dark', language: 'en', trashDays: 30 }; }
  }

  // ── PIN crypto ────────────────────────────────────────────────────────────
  _hashPin(pin, salt) {
    return crypto.pbkdf2Sync(pin, salt, 600000, 32, 'sha512').toString('hex');
  }
  _encryptPinMaster(master, pin) {
    const salt = crypto.randomBytes(32), iv = crypto.randomBytes(12);
    // 600k iterations — consistent with vault key derivation and PIN hash
    const key = crypto.pbkdf2Sync(pin, salt, 600000, 32, 'sha512');
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    // master is a Buffer (C-3); cipher.update() accepts Buffer directly — encoding arg omitted
    const enc = Buffer.concat([c.update(master), c.final()]);
    return Buffer.concat([salt, iv, c.getAuthTag(), enc]).toString('base64');
  }
  _decryptPinMaster(b64, pin) {
    const buf = Buffer.from(b64, 'base64');
    const salt = buf.slice(0, 32), iv = buf.slice(32, 44);
    const tag = buf.slice(44, 60), enc = buf.slice(60);
    // 600k iterations — consistent with vault key derivation and PIN hash
    const key = crypto.pbkdf2Sync(pin, salt, 600000, 32, 'sha512');
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  }
}

module.exports = VaultManager;
