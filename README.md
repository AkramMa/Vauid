# Keybek (VauID) — Password Manager

A secure, cross-platform Electron password manager backed by the KeePass `.kdbx`
format (Argon2id + AES-256-GCM), with a companion browser extension for autofill.

---

## Quick Start

```bash
npm install
npm run dev
```

---

## Architecture

```
main.js               Electron main process — bootstraps everything
  ├── src/vault.js    VaultManager — kdbxweb read/write/CRUD
  ├── src/crypto.js   CryptoEngine — key derivation, encryption, password gen
  ├── src/ipc-handlers.js  All ipcMain.handle registrations
  ├── src/ws-server.js     Local WebSocket server (extension bridge)
  ├── src/breach.js   HIBP k-anonymity breach checker
  ├── src/sync.js     Cloud-folder sync (Google Drive / OneDrive / Dropbox)
  ├── src/twofa.js    TOTP secret generation + QR code
  └── preload.js      contextBridge — narrow renderer API

renderer/             Renderer process (UI)
  ├── index.html
  ├── app.js
  └── pages/          auth, vault, generator, settings, sync, item-form

extension/            Browser extension (Chrome / Edge)
  ├── background.js   MV3 service worker — WS client
  ├── popup/          Extension popup UI
  └── content/        Content script — autofill injection
```

---

<!-- ============================================================
     v1.3 — SECURITY & BUG FIX RELEASE
     All items below were identified in the internal code review
     conducted on 2026-05-05.
     ============================================================ -->

## v1.3 Fix List

Legend: ✅ Fixed · ⬜ Pending · 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Minor

### 🔴 Critical

| Status | ID | File | Description |
|--------|----|------|-------------|
| ✅ | C-1 | `src/breach.js` | Add 2 MB response-size cap on HIBP HTTP body to prevent OOM from a malicious proxy |
| ✅ | C-2 | `src/sync.js` | Validate `destFolder` is an absolute path before `fs.copyFileSync` to prevent path-traversal |
| ✅ | C-3 | `src/vault.js` | Zero-out `_currentPassword` from memory on `lock()` to prevent plaintext exposure in crash dumps |
| ✅ | C-4 | `src/ws-server.js` | Hash session tokens before persisting to `extension-sessions.json` so a stolen file cannot be replayed |

### 🟠 High

| Status | ID | File | Description |
|--------|----|------|-------------|
| ✅ | H-1 | `src/crypto.js` | Align `derivePinKey` to 600k PBKDF2 iterations (was 100k — inconsistent with all other key-derivation) |
| ✅ | H-2 | `src/vault.js` | Whitelist allowed fields in `importData` so a crafted import cannot inject private metadata |
| ✅ | H-3 | `main.js` | Enable `sandbox: true` in BrowserWindow webPreferences |
| ✅ | H-4 | `src/ws-server.js` | Document the deliberate `Access-Control-Allow-Origin: *` trade-off with a clear comment |

### 🟡 Medium

| Status | ID | File | Description |
|--------|----|------|-------------|
| ✅ | M-1 | `src/vault.js` | Defer `_purgeTrash` with `setImmediate` so it does not block the unlock response |
| ✅ | M-2 | `src/vault.js` | Fix `deleteFolder` to recursively move entries from nested sub-groups before removing the group |
| ✅ | M-3 | `src/sync.js` | Verify pulled `.kdbx` is a valid KDBX binary (magic-byte check) before overwriting local file |
| ✅ | M-4 | `extension/background.js` | Restrict `_notifyStatus` tab broadcast to tabs that have a content script injected |

### 🟢 Minor

| Status | ID | File | Description |
|--------|----|------|-------------|
| ✅ | S-1 | `src/crypto.js` | Fix passphrase word-list comment: states "1296 words" but list has ~530 |
| ✅ | S-2 | `src/ipc-handlers.js` | Remove redundant `async`/`await` wrapper on `attachments:remove` (method is already async) |
| ✅ | S-3 | `preload.js` | Remove dead `destPath` third parameter from `attachments:export` preload wrapper |
| ✅ | S-4 | `extension/background.js` | Remove duplicate `alarms.create` call in `onInstalled` (alarm already created at module load) |
| ✅ | S-5 | `src/twofa.js` | Replace unmaintained `speakeasy` with a native RFC 6238 TOTP implementation using Node's built-in `crypto` — zero new dependencies |
| ✅ | S-6 | `src/vault.js` | Add comment explaining intentional double-storage in `vd_json` blob for round-trip fidelity |

---

## Security Model

- **At rest**: AES-256-GCM with Argon2id key derivation (kdbx4, same as KeePassXC 2.7+)
- **PIN**: PBKDF2-SHA512 / 600k iterations; 5-failure lockout, 10-failure revoke
- **TOTP**: Native RFC 6238 / RFC 4226 implementation using Node's built-in `crypto` — no external TOTP library
- **Extension bridge**: localhost-only WebSocket; one-time pairing code; HMAC-SHA256 hashed session tokens
- **Clipboard**: Auto-cleared after 30 seconds
- **URL handler**: Allowlist-only (`http:`/`https:`) — blocks `javascript:` / `file:`

---

## Extension Setup

See [`extension/README.md`](extension/README.md) for pairing instructions and the WebSocket protocol reference.
