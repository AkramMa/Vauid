# VauID Browser Extension

A Chrome/Edge browser extension that connects to the VauID desktop app via a local WebSocket server for real-time autofill, vault search, TOTP display, and password generation.

## Architecture

```
Electron App (main process)
  └── WsServer (ws://127.0.0.1:49152)
        ├── Profile A — Chrome Default
        ├── Profile B — Chrome Work
        └── Profile C — Edge
```

- **Transport**: Local WebSocket (`ws://127.0.0.1:<port>`) — localhost-only, no network exposure
- **Auth**: Token-based sessions with pairing handshake
- **Pairing**: One-time 6-digit code displayed in the app, entered once per browser profile
- **Sessions**: Persisted in `~/.vauid/extension-sessions.json`

## Setup

### 1. Load the Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 2. Pair with the Desktop App

1. Open VauID → **Settings** → **🧩 Browser Extension**
2. Click **Generate Code** — a 6-digit pairing code appears (valid for 5 minutes)
3. Click the VauID extension icon in Chrome
4. Enter the 6-digit code and a profile name (e.g. "Chrome – Personal")
5. Click **Pair This Profile** — done!

Each browser profile pairs independently.

## Features

| Feature | Description |
|---|---|
| Autofill | Click the VauID icon → search → click to fill username + password |
| Inline suggestion | Dropdown appears when you focus a password field |
| Context menu | Right-click any editable field → VauID: Fill login |
| Copy password | One-click copy without autofilling |
| Copy username | Copy username separately |
| TOTP | Click 🔢 to copy the current TOTP code (with time remaining) |
| Password generator | Built-in generator with length + charset controls |
| Real-time sync | Vault updates broadcast instantly to all connected profiles |
| Credential detection | Detects new logins and notifies the desktop app |

## Security

- **Localhost only**: The WebSocket server binds to `127.0.0.1` and rejects all non-local connections
- **Token auth**: Each profile gets a cryptographically random 32-byte session token after initial pairing
- **One-time pairing code**: 6-digit code expires in 5 minutes and is consumed on first use
- **Vault locking**: When the vault is locked in the desktop app, all extension sessions are notified immediately
- **Session revocation**: Revoke any profile from desktop Settings → Browser Extension

## WebSocket Protocol

### Handshake

```
Server → Client: { "type": "hello", "version": 1 }

# First connection (pairing):
Client → Server: { "type": "auth:pair", "code": "123456", "profileName": "Chrome – Work" }
Server → Client: { "type": "auth:paired", "profileId": "abc...", "token": "xyz..." }

# Subsequent connections (token resume):
Client → Server: { "type": "auth:resume", "profileId": "abc...", "token": "xyz..." }
Server → Client: { "type": "auth:resumed", "profileName": "Chrome – Work" }
```

### Requests

All requests after auth include a `requestId` for response correlation.

| Type | Request | Response |
|---|---|---|
| `vault:search` | `{ query, url }` | `{ results: [...] }` |
| `vault:getTotp` | `{ itemId }` | `{ code, remaining }` |
| `password:generate` | `{ options }` | `{ password }` |
| `vault:credentialDetected` | `{ siteName, url, username }` | ack |

### Push events (server → client)

| Type | Payload |
|---|---|
| `vault:lockState` | `{ locked: bool }` |
| `vault:updated`  | `{ data: { items, folders } }` |

## Port Configuration

Default port: **49152**. Change it in:
- Desktop app: Settings → Browser Extension → Port
- Extension: Click extension icon → ⚙ Settings → Port

The app will automatically try the next port if 49152 is in use.

---

## Task Backlog

Legend: ✅ Done · ⬜ Pending · 🐛 Bug fix · ✨ Feature · 🎨 UX

### Icon

| Status | Type | Task |
|---|---|---|
| ✅ | ✨ | Replace Google S2 favicon with DuckDuckGo icons API |
| ✅ | ✨ | Add custom icon picker per vault item (emoji + image upload) |
| ✅ | ✨ | Store custom icon as `vd_icon` custom field in kdbx entry |

### Save Banner

| Status | Type | Task |
|---|---|---|
| ✅ | 🐛 | Delay pending credential banner until document is fully loaded after redirect |
| ✅ | 🐛 | Suppress save prompt when autofill was triggered by VauID itself |
| ✅ | 🐛 | Increase dedup timeout from 3s to 10s; reset on password field re-focus |
| ✅ | ✨ | Add "Never save for this site" option that persists domain to ignored list |
| ✅ | ✨ | Distinguish failed login attempt from password change before showing update prompt |
| ✅ | ✨ | Show "Unlock and save" button when vault locks while banner is visible |

### Form Detection

| Status | Type | Task |
|---|---|---|
| ✅ | ✨ | Detect sign-up forms (2+ password fields) and show password generator instead of autofill |
| ✅ | ✨ | Detect change-password forms and capture new password field, not current password |
| ✅ | 🎨 | Fix autofill dropdown position drift on page scroll (reposition on scroll event) |
| ✅ | ✨ | Add `all_frames: true` in manifest.json to support same-origin iframes |

### Extension UX

| Status | Type | Task |
|---|---|---|
| ⬜ | ✨ | Add keyboard shortcut (e.g. Ctrl+Shift+L) to trigger autofill without opening popup |
| ⬜ | ✨ | Show badge count on extension icon when current site has saved credentials |
| ⬜ | ✨ | Change extension icon color/state based on vault lock status |
| ⬜ | ✨ | Add "Recently Used" section at top of search results |

### Pairing Bugs (hotfix)

| Status | Type | Task |
|---|---|---|
| ✅ | 🐛 | Fix double send of `auth:pair` — socket-open path sent the code twice, server rejected the second (one-time-use code already consumed) |
| ✅ | 🐛 | Start pairing ping immediately on connection to prevent server's 10s auth timeout firing before user types the code |
| ✅ | 🐛 | Replace `pollUntilConnected` with `pollUntilPaired` in pair button handler — old poller exited early on transient errors before `auth:paired` arrived |
