'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// settings-page.js — App Settings page
// ─────────────────────────────────────────────────────────────────────────────

const SettingsPage = {
  async show() {
    const { Router, kb } = window.App;
    Router.show('page-vault');
    document.querySelectorAll('.nav-item, .folder-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('nav-settings')?.classList.add('active');
    const mainArea = document.getElementById('vault-main');
    if (!mainArea) return;
    let data = {}, settings = {};
    try { data = (await kb.vault.getData()) || {}; settings = data.settings || {}; } catch {}
    let appVersion = '1.2.0';
    try { appVersion = await kb.app.getVersion(); } catch {}
    const AUTOLOCK_OPTS = [1, 2, 5, 10, 15, 30, 60];
    const hibpKeySet      = !!settings.hibpApiKey;
    const hibpPlaceholder = hibpKeySet ? 'Key saved — paste to replace' : 'Paste API key here';
    const hibpConfigured  = hibpKeySet ? '<div style="font-size:11px;color:var(--success)">✓ API key configured</div>' : '';

    mainArea.innerHTML = `
      <div style="display:flex;height:100%;min-height:0;overflow:hidden" class="anim-fade">
        <div style="width:190px;flex-shrink:0;border-right:1px solid var(--border);padding:20px 10px;display:flex;flex-direction:column;gap:2px;background:var(--surface)">
          <div style="font-size:10px;font-weight:600;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;padding:4px 10px 10px">Settings</div>
          ${[['security','🔒','Security'],['appearance','🎨','Appearance'],['vault','🗄','Vault'],['audit','🛡','Security Audit'],['extension','🧩','Extension'],['about','ℹ️','About']].map(([id,icon,label]) => `
            <button id="stab-${id}" data-stab="${id}" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;border:none;cursor:pointer;width:100%;text-align:left;font-size:13px;transition:all 0.15s;background:${id==='security'?'var(--surface-3)':'transparent'};color:${id==='security'?'var(--text-primary)':'var(--text-secondary)'};font-weight:${id==='security'?'500':'400'}">
              <span style="font-size:15px">${icon}</span><span>${label}</span>
            </button>
          `).join('')}
          <div style="flex:1"></div>
          <button class="btn btn-ghost btn-sm" id="settings-back-btn" style="margin:8px 4px 0">← Back</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:28px 36px;min-width:0">

          <div id="spane-security" class="spane">
            <h3 style="margin:0 0 20px;font-size:16px;font-weight:600">🔒 Security</h3>
            <div class="settings-group">
              <div class="settings-row">
                <div><div class="settings-label">Auto-lock after</div><div class="settings-sub">Lock vault when idle</div></div>
                <select id="set-autolock">
                  ${AUTOLOCK_OPTS.map(m => `<option value="${m}"${settings.autoLock == m ? ' selected' : ''}>${m < 60 ? m + 'm' : '1h'}</option>`).join('')}
                  <option value="0"${settings.autoLock == 0 ? ' selected' : ''}>Never</option>
                </select>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Start with Windows</div><div class="settings-sub">Launch VauID automatically at login</div></div>
                <label class="toggle-switch" id="startup-toggle-wrap">
                  <input type="checkbox" id="set-startup-toggle" />
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </label>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">PIN Code</div><div class="settings-sub">Quick unlock with a PIN</div></div>
                <button class="btn btn-sm btn-outline" id="set-pin-btn">Set PIN</button>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Pattern Unlock</div><div class="settings-sub">Quick unlock by drawing a pattern</div></div>
                <button class="btn btn-sm btn-outline" id="set-pattern-btn">Set Pattern</button>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Key File</div><div class="settings-sub">Quick unlock with a key file</div></div>
                <button class="btn btn-sm btn-outline" id="set-keyfile-btn">Set Key File</button>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Change Master Password</div><div class="settings-sub">Update your encryption key</div></div>
                <button class="btn btn-sm btn-outline" id="set-pw-btn">Change</button>
              </div>
            </div>
          </div>

          <div id="spane-appearance" class="spane" style="display:none">
            <h3 style="margin:0 0 20px;font-size:16px;font-weight:600">🎨 Appearance</h3>
            <div class="settings-group">
              <div class="settings-row" style="align-items:flex-start">
                <div><div class="settings-label">Theme</div><div class="settings-sub">Choose a color theme for the app</div></div>
              </div>
              <div id="theme-swatches" style="display:flex;gap:14px;padding:6px 0 4px;flex-wrap:wrap">
                <button class="theme-swatch-btn" data-theme-choice="midnight" style="cursor:pointer;border:2px solid var(--border-light);border-radius:12px;padding:10px;width:140px;background:var(--bg-elevated);text-align:left">
                  <div style="display:flex;border-radius:8px;overflow:hidden;height:56px;margin-bottom:8px;border:1px solid rgba(0,0,0,0.15)">
                    <div style="flex:1;background:#262624"></div>
                    <div style="flex:1;background:#2D2D2A;display:flex;align-items:center;justify-content:center"><span style="width:14px;height:14px;border-radius:50%;background:#D97757"></span></div>
                  </div>
                  <div style="font-size:12px;font-weight:600">Midnight</div>
                  <div style="font-size:11px;color:var(--text-muted)">Dark &middot; Terracotta accent</div>
                </button>
                <button class="theme-swatch-btn" data-theme-choice="claude" style="cursor:pointer;border:2px solid var(--border-light);border-radius:12px;padding:10px;width:140px;background:var(--bg-elevated);text-align:left">
                  <div style="display:flex;border-radius:8px;overflow:hidden;height:56px;margin-bottom:8px;border:1px solid rgba(0,0,0,0.15)">
                    <div style="flex:1;background:#F5F4EE"></div>
                    <div style="flex:1;background:#FFFFFF;display:flex;align-items:center;justify-content:center"><span style="width:14px;height:14px;border-radius:50%;background:#D97757"></span></div>
                  </div>
                  <div style="font-size:12px;font-weight:600">Claude</div>
                  <div style="font-size:11px;color:var(--text-muted)">Light &middot; Terracotta accent</div>
                </button>
              </div>
            </div>
          </div>

          <div id="spane-vault" class="spane" style="display:none">
            <h3 style="margin:0 0 20px;font-size:16px;font-weight:600">🗄 Vault</h3>
            <div class="settings-group">
              <div class="settings-row">
                <div><div class="settings-label">Export Data</div><div class="settings-sub">Download items as JSON or CSV</div></div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-ghost" id="set-export-json">JSON</button>
                  <button class="btn btn-sm btn-ghost" id="set-export-csv">CSV</button>
                </div>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Import Data</div><div class="settings-sub">From JSON, CSV, or another .vauid/.kdbx vault</div></div>
                <button class="btn btn-sm btn-outline" id="set-import-btn">Import</button>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Vault Stats</div><div class="settings-sub">${(data.items||[]).length} items · ${(data.folders||[]).length} folders</div></div>
              </div>
            </div>
          </div>

          <div id="spane-audit" class="spane" style="display:none">
            <h3 style="margin:0 0 20px;font-size:16px;font-weight:600">🛡 Security Audit</h3>
            <div class="settings-group">
              <div class="settings-row">
                <div><div class="settings-label">Check All Passwords</div><div class="settings-sub">Uses HaveIBeenPwned (k-anonymity)</div></div>
                <button class="btn btn-sm btn-primary" id="set-breach-all-btn">Check Now</button>
              </div>
              <div class="settings-row" style="align-items:flex-start;flex-direction:column;gap:8px">
                <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
                  <div>
                    <div class="settings-label">HaveIBeenPwned API Key</div>
                    <div class="settings-sub">Required for email breach checks &middot; <span id="hibp-get-key" style="color:var(--accent);cursor:pointer">Get a free key &rarr;</span></div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center">
                    <div class="password-input-wrap" style="margin:0">
                      <input type="password" id="hibp-api-key-input" style="width:160px" placeholder="${hibpPlaceholder}" autocomplete="off" />
                      <button class="toggle-pw" data-target="hibp-api-key-input">👁</button>
                    </div>
                    <button class="btn btn-sm btn-ghost" id="hibp-save-btn">Save</button>
                  </div>
                </div>
                ${hibpConfigured}
              </div>
            </div>
          </div>

          <div id="spane-extension" class="spane" style="display:none">
            <h3 style="margin:0 0 20px;font-size:16px;font-weight:600">🧩 Browser Extension</h3>
            <div class="settings-group" id="ext-settings-group">
              <div class="settings-row">
                <div><div class="settings-label">WebSocket Server</div><div class="settings-sub" id="ext-ws-status">Checking…</div></div>
                <span id="ext-ws-badge" style="font-size:11px;padding:2px 8px;border-radius:999px;background:var(--surface-3);color:var(--text-muted)">—</span>
              </div>
              <div class="settings-row">
                <div><div class="settings-label">Port</div><div class="settings-sub">Local WebSocket port</div></div>
                <div style="display:flex;gap:6px;align-items:center">
                  <input type="number" id="ext-port-input" min="1024" max="65535" style="width:90px;text-align:right" />
                  <button class="btn btn-sm btn-ghost" id="ext-port-apply">Apply</button>
                </div>
              </div>
              <div class="settings-row" id="ext-pair-row">
                <div><div class="settings-label">Pair New Browser Profile</div><div class="settings-sub">Show a one-time pairing code</div></div>
                <button class="btn btn-sm btn-primary" id="ext-pair-btn">Generate Code</button>
              </div>
              <div id="ext-pairing-display" style="display:none;padding:12px 0">
                <div style="text-align:center;padding:16px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border)">
                  <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em">Pairing Code</div>
                  <div id="ext-pair-code" style="font-family:var(--font-mono);font-size:36px;font-weight:700;letter-spacing:0.25em;color:var(--accent)">------</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Expires in <span id="ext-pair-timer">300</span>s · Enter this code in the extension</div>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-label">Connected Profiles</div>
                <span id="ext-profile-count" style="font-size:12px;color:var(--text-muted)">0</span>
              </div>
              <div id="ext-profiles-list" style="padding-bottom:4px"></div>
            </div>
          </div>

          <div id="spane-about" class="spane" style="display:none">
            <h3 style="margin:0 0 20px;font-size:16px;font-weight:600">ℹ️ About</h3>
            <div class="settings-group">
              <div class="settings-row"><div class="settings-label">VauID Password Manager</div><span style="color:var(--text-muted);font-size:12px">v${appVersion}</span></div>
              <div class="settings-row"><div class="settings-label">Encryption</div><span style="color:var(--success);font-size:12px">AES-256-GCM · Argon2id · PBKDF2-600k</span></div>
              <div class="settings-row"><div class="settings-label">TOTP</div><span style="color:var(--success);font-size:12px">Native RFC 6238 · zero dependencies</span></div>
              <div class="settings-row"><div class="settings-label">Session Tokens</div><span style="color:var(--success);font-size:12px">HMAC-SHA256 · never stored plaintext</span></div>
              <div class="settings-row"><div class="settings-label">Open Source</div><button class="btn btn-sm btn-ghost" id="set-github-btn">View on GitHub ↗</button></div>
            </div>
          </div>

        </div>
      </div>
    `;

    document.querySelectorAll('[data-stab]').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.stab;
        document.querySelectorAll('[data-stab]').forEach(b => {
          const on = b.dataset.stab === tab;
          b.style.background = on ? 'var(--surface-3)' : 'transparent';
          b.style.color      = on ? 'var(--text-primary)' : 'var(--text-secondary)';
          b.style.fontWeight = on ? '500' : '400';
        });
        document.querySelectorAll('.spane').forEach(p => {
          p.style.display = p.id === 'spane-' + tab ? 'block' : 'none';
        });
      };
    });

    this._bindEvents(settings);
  },


  // ── Private: event wiring ─────────────────────────────────────────────────────

  _bindEvents(settings) {
    const { kb, Toast } = window.App;

    document.getElementById('settings-back-btn').onclick = () => VaultPage.load();

    // Theme switcher
    this._initThemeSwitcher();

    document.getElementById('set-pin-btn').onclick = () => this._showPinModal();
    document.getElementById('set-pw-btn').onclick  = () => this._showChangePasswordModal();

    document.getElementById('set-pattern-btn').onclick = () => this._showPatternModal();
    document.getElementById('set-keyfile-btn').onclick  = () => this._showKeyFileModal();
    this._refreshQuickUnlockButtons();

    document.getElementById('set-export-json').onclick = () => this._exportWithPassword('json');
    document.getElementById('set-export-csv').onclick  = () => this._exportWithPassword('csv');

    document.getElementById('set-import-btn').onclick = () => this._showImportModal();

    document.getElementById('set-autolock').onchange = async (e) => {
      const minutes = parseInt(e.target.value);
      await kb.vault.save({ settings: { ...settings, autoLock: minutes } });
      settings.autoLock = minutes;
      Toast.show('Auto-lock updated', 'success');
    };

    // Start with Windows toggle
    (async () => {
      const toggle = document.getElementById('set-startup-toggle');
      if (!toggle) return;
      try {
        const s = await kb.app.getStartup();
        toggle.checked = !!s?.enabled;
      } catch { toggle.checked = false; }
      toggle.addEventListener('change', async () => {
        const r = await kb.app.setStartup(toggle.checked);
        if (r?.success) {
          Toast.show(toggle.checked ? 'VauID will launch at Windows login' : 'Startup disabled', 'success');
        } else {
          Toast.show('Could not update startup setting', 'error');
          toggle.checked = !toggle.checked; // revert
        }
      });
    })();

    document.getElementById('set-breach-all-btn').onclick = () => this._checkAllBreaches();

    // HIBP API key
    document.getElementById('hibp-get-key')?.addEventListener('click', () => {
      kb.shell.openExternal('https://haveibeenpwned.com/API/Key');
    });
    document.getElementById('hibp-save-btn')?.addEventListener('click', async () => {
      const key = document.getElementById('hibp-api-key-input')?.value?.trim();
      if (key === undefined) return;
      await kb.vault.save({ settings: { ...settings, hibpApiKey: key } });
      settings.hibpApiKey = key;
      Toast.show(key ? 'HIBP API key saved' : 'HIBP API key removed', 'success');
    });

    document.getElementById('set-github-btn').onclick = () => {
      kb.shell.openExternal('https://github.com/vauid/vauid');
    };

    // Extension section
    this._initExtensionSection();
  },

  // ── Theme switcher ───────────────────────────────────────────────────────────

  _initThemeSwitcher() {
    const THEME_KEY = 'kb_theme';
    const current = localStorage.getItem(THEME_KEY) || 'midnight';

    const applySelected = (theme) => {
      document.querySelectorAll('.theme-swatch-btn').forEach(btn => {
        const on = btn.dataset.themeChoice === theme;
        btn.style.borderColor = on ? 'var(--accent)' : 'var(--border-light)';
        btn.style.boxShadow = on ? '0 0 0 3px var(--accent-glow)' : 'none';
      });
    };
    applySelected(current);

    document.querySelectorAll('.theme-swatch-btn').forEach(btn => {
      btn.onclick = () => {
        const theme = btn.dataset.themeChoice;
        localStorage.setItem(THEME_KEY, theme);
        if (theme === 'midnight') {
          document.documentElement.removeAttribute('data-theme');
        } else {
          document.documentElement.setAttribute('data-theme', theme);
        }
        applySelected(theme);
        window.App.Toast.show(`Theme set to ${btn.querySelector('div div').textContent}`, 'success');
      };
    });
  },

  // ── Extension / WebSocket section ──────────────────────────────────────────

  _extPairInterval: null,

  async _initExtensionSection() {
    const { kb, Toast } = window.App;

    // Fetch and render current status
    const _refresh = async () => {
      if (!document.getElementById('ext-ws-status')) return; // page navigated away
      const status = await kb.ws.getStatus().catch(() => null);
      if (!status) return;

      const badge  = document.getElementById('ext-ws-badge');
      const subEl  = document.getElementById('ext-ws-status');
      const portEl = document.getElementById('ext-port-input');
      if (portEl && !portEl.value) portEl.value = status.port || 49152;

      if (badge) {
        badge.textContent  = status.running ? 'Running' : 'Stopped';
        badge.style.background = status.running ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
        badge.style.color      = status.running ? '#22c55e'               : '#ef4444';
      }
      if (subEl) subEl.textContent = status.running ? `ws://127.0.0.1:${status.port}` : 'Not running';

      this._renderProfiles(status.sessions || []);

      // Restore live pairing code if still active
      if (status.pairing) {
        this._showPairingCode(status.pairing.code, status.pairing.remaining);
      }
    };

    await _refresh();

    // Port apply
    document.getElementById('ext-port-apply')?.addEventListener('click', async () => {
      const port = parseInt(document.getElementById('ext-port-input')?.value || '49152');
      if (port < 1024 || port > 65535) { Toast.show('Invalid port number', 'error'); return; }
      const r = await kb.ws.restart(port);
      if (r.success) { Toast.show(`Server restarted on port ${r.port}`, 'success'); await _refresh(); }
      else           { Toast.show('Failed to restart: ' + (r.error || ''), 'error'); }
    });

    // Pairing code generation
    document.getElementById('ext-pair-btn')?.addEventListener('click', async () => {
      const r = await kb.ws.generatePairingCode();
      if (r.success) {
        const remaining = Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000));
        this._showPairingCode(r.code, remaining);
      } else {
        Toast.show('Could not generate code: ' + (r.error || ''), 'error');
      }
    });

    // Listen for live updates from main process
    kb.on('ws:sessions',    (sessions) => this._renderProfiles(sessions || []));
    kb.on('ws:pairingCode', (info) => {
      if (info) this._showPairingCode(info.code, Math.max(0, Math.round((info.expiresAt - Date.now()) / 1000)));
      else      this._hidePairingCode();
    });
    kb.on('ws:credentialDetected', (info) => {
      Toast.show(`💡 "${info.siteName}" — new credential detected from ${info.profileName}`, 'info');
    });
  },

  _showPairingCode(code, remainingSecs) {
    const display = document.getElementById('ext-pairing-display');
    const codeEl  = document.getElementById('ext-pair-code');
    const timerEl = document.getElementById('ext-pair-timer');
    if (!display || !codeEl) return;

    codeEl.textContent = code;
    display.style.display = 'block';

    clearInterval(this._extPairInterval);
    let rem = remainingSecs;
    if (timerEl) timerEl.textContent = rem;

    this._extPairInterval = setInterval(() => {
      rem--;
      if (timerEl) timerEl.textContent = Math.max(0, rem);
      if (rem <= 0) { this._hidePairingCode(); clearInterval(this._extPairInterval); }
    }, 1000);
  },

  _hidePairingCode() {
    const display = document.getElementById('ext-pairing-display');
    if (display) display.style.display = 'none';
    clearInterval(this._extPairInterval);
  },

  _renderProfiles(sessions) {
    const list  = document.getElementById('ext-profiles-list');
    const count = document.getElementById('ext-profile-count');
    if (!list) return;
    if (count) count.textContent = sessions.length;
    if (!sessions.length) {
      list.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:12px;text-align:center">No profiles connected</div>';
      return;
    }
    list.innerHTML = sessions.map(s => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:4px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:7px;height:7px;border-radius:50%;background:${s.connected ? '#22c55e' : '#6b7280'};flex-shrink:0"></span>
          <div>
            <div style="font-size:13px;color:var(--text-primary)">${this._esc(s.profileName)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${s.connected ? 'Connected' : 'Last seen ' + this._relativeTime(s.lastSeen)}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-revoke="${this._esc(s.profileId)}">Revoke</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.onclick = async () => {
        const profileId = btn.dataset.revoke;
        const { kb, Toast } = window.App;
        const r = await kb.ws.revokeSession(profileId);
        if (r.success) Toast.show('Session revoked', 'success');
      };
    });
  },

  _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },

  _relativeTime(iso) {
    if (!iso) return 'never';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)   return Math.round(diff) + 's ago';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    return Math.round(diff / 3600) + 'h ago';
  },



  // ── Modals ────────────────────────────────────────────────────────────────────

  _exportWithPassword(format) {
    const { Modal, Toast, kb } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>🔒 Confirm Export</h3>
        <button class="modal-close" id="exp-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
        Enter your master password to export vault data as ${format.toUpperCase()}.
      </p>
      <div class="form-group">
        <label>Master Password <span style="color:var(--danger)">*</span></label>
        <div class="password-input-wrap">
          <input type="password" id="exp-master-pw" placeholder="Your master password" autocomplete="current-password" />
          <button class="toggle-pw" data-target="exp-master-pw">👁</button>
        </div>
      </div>
      <div class="error-msg" id="exp-modal-err"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost"   id="exp-cancel">Cancel</button>
        <button class="btn btn-primary" id="exp-confirm">Export</button>
      </div>
    `);

    document.getElementById('exp-modal-close').onclick = () => Modal.close();
    document.getElementById('exp-cancel').onclick      = () => Modal.close();
    PasswordToggle.init();
    document.getElementById('exp-master-pw').focus();

    document.getElementById('exp-confirm').onclick = async () => {
      const pw  = document.getElementById('exp-master-pw').value;
      const err = document.getElementById('exp-modal-err');
      err.textContent = '';
      if (!pw) { err.textContent = 'Master password is required.'; return; }

      const btn = document.getElementById('exp-confirm');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';

      const verify = await kb.vault.unlock(pw);
      if (!verify.success) {
        btn.disabled = false;
        btn.textContent = 'Export';
        err.textContent = 'Incorrect master password.';
        return;
      }

      Modal.close();
      const r = await kb.vault.exportData(format);
      if (r.success) Toast.show('Exported to ' + r.path, 'success');
      else if (r.error !== 'CANCELLED') Toast.show('Export failed: ' + (r.error || ''), 'error');
    };

    document.getElementById('exp-master-pw').onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('exp-confirm').click();
    };
  },

  // ── Import modal ───────────────────────────────────────────────────────────

  _showImportModal() {
    const { Modal, Toast, kb, AppState } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>📥 Import Data</h3>
        <button class="modal-close" id="imp-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
        Import logins from a JSON export, a CSV file (VauID, Chrome, Firefox, Bitwarden, or similar),
        or another .vauid/.kdbx vault file.
      </p>
      <button class="btn btn-primary btn-full" id="imp-pick-btn">Choose File…</button>
      <div id="imp-file-info" style="display:none;margin-top:14px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;word-break:break-all" id="imp-file-path"></div>
        <div class="form-group" id="imp-kdbx-pw-group" style="display:none">
          <label>Password for that vault <span style="color:var(--danger)">*</span></label>
          <div class="password-input-wrap">
            <input type="password" id="imp-kdbx-pw" placeholder="Master password of the file being imported" autocomplete="off" />
            <button class="toggle-pw" data-target="imp-kdbx-pw">👁</button>
          </div>
        </div>
        <div class="error-msg" id="imp-modal-err"></div>
        <button class="btn btn-primary btn-full" id="imp-confirm-btn">Import</button>
      </div>
    `);

    document.getElementById('imp-modal-close').onclick = () => Modal.close();

    let pickedPath = null;

    document.getElementById('imp-pick-btn').onclick = async () => {
      const filePath = await kb.vault.pickImportFile();
      if (!filePath) return;
      pickedPath = filePath;

      const ext = (filePath.split('.').pop() || '').toLowerCase();
      const isKdbx = ext === 'kdbx' || ext === 'vauid';

      document.getElementById('imp-file-info').style.display = 'block';
      document.getElementById('imp-file-path').textContent = filePath;
      document.getElementById('imp-kdbx-pw-group').style.display = isKdbx ? 'block' : 'none';
      document.getElementById('imp-modal-err').textContent = '';
      if (isKdbx) document.getElementById('imp-kdbx-pw').focus();
    };

    document.getElementById('imp-confirm-btn').onclick = async () => {
      if (!pickedPath) return;
      const err = document.getElementById('imp-modal-err');
      const btn = document.getElementById('imp-confirm-btn');
      err.textContent = '';

      const ext = (pickedPath.split('.').pop() || '').toLowerCase();
      let result;

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Importing…';

      try {
        if (ext === 'json') {
          result = await kb.vault.importData(pickedPath);
        } else if (ext === 'csv') {
          result = await kb.vault.importCSV(pickedPath);
        } else if (ext === 'kdbx' || ext === 'vauid') {
          const pw = document.getElementById('imp-kdbx-pw').value;
          if (!pw) {
            err.textContent = 'Enter the password for that vault file.';
            btn.disabled = false; btn.textContent = 'Import';
            return;
          }
          result = await kb.vault.importKdbx(pickedPath, pw);
        } else {
          err.textContent = 'Unsupported file type.';
          btn.disabled = false; btn.textContent = 'Import';
          return;
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Import';
      }

      if (result.success) {
        Modal.close();
        Toast.show(`Imported ${result.count ?? ''} item${result.count === 1 ? '' : 's'} successfully`, 'success');
        AppState.items   = await kb.items.getAll();
        AppState.folders = await kb.folders.getAll();
        if (typeof VaultPage !== 'undefined' && VaultPage.refresh) VaultPage.refresh();
      } else {
        const messages = {
          WRONG_PASSWORD: 'Incorrect password for that vault file.',
          ARGON2_UNAVAILABLE: "That vault uses Argon2 encryption, which isn't available right now.",
          FILE_NOT_FOUND: 'Could not read that file.',
          INVALID_FORMAT: "That doesn't look like a valid JSON export.",
          EMPTY_CSV: 'That CSV file has no rows to import.',
          UNRECOGNIZED_CSV_FORMAT: "Couldn't recognize any name/username/password columns in that CSV.",
        };
        err.textContent = messages[result.error] || ('Import failed: ' + (result.error || 'Unknown error'));
      }
    };
  },

  _showPinModal() {
    const { Modal, Toast, kb } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>🔢 Set PIN</h3>
        <button class="modal-close" id="pin-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
        Enter your master password to set a PIN. PIN must be exactly 4 or 6 characters.
      </p>
      <div class="form-group">
        <label>Master Password <span style="color:var(--danger)">*</span></label>
        <div class="password-input-wrap">
          <input type="password" id="set-pin-master" placeholder="Your master password" autocomplete="current-password" />
          <button class="toggle-pw" data-target="set-pin-master">👁</button>
        </div>
      </div>
      <div class="form-group">
        <label>New PIN</label>
        <input type="text" id="set-pin-inp" maxlength="6" placeholder="4 or 6 characters"
          autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"
          style="font-family:var(--font-mono);font-size:20px;text-align:center;letter-spacing:0.2em" />
      </div>
      <div class="form-group">
        <label>Confirm PIN</label>
        <input type="text" id="set-pin-confirm" maxlength="6" placeholder="Repeat PIN"
          autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"
          style="font-family:var(--font-mono);font-size:20px;text-align:center;letter-spacing:0.2em" />
      </div>
      <div class="error-msg" id="pin-modal-err"></div>
      <button class="btn btn-primary btn-full" id="set-pin-save-btn">Save PIN</button>
    `);

    document.getElementById('pin-modal-close').onclick = () => Modal.close();
    PasswordToggle.init();

    document.getElementById('set-pin-save-btn').onclick = async () => {
      const master  = document.getElementById('set-pin-master').value;
      const pin     = document.getElementById('set-pin-inp').value;
      const confirm = document.getElementById('set-pin-confirm').value;
      const err     = document.getElementById('pin-modal-err');
      err.textContent = '';

      if (!master)                               { err.textContent = 'Master password is required.';          return; }
      if (pin.length !== 4 && pin.length !== 6)  { err.textContent = 'PIN must be exactly 4 or 6 characters.'; return; }
      if (pin !== confirm)                        { err.textContent = 'PINs do not match.';                    return; }

      const verifyResult = await kb.vault.unlock(master);
      if (!verifyResult.success) { err.textContent = 'Incorrect master password.'; return; }

      const r = await kb.vault.setPin(pin);
      if (r.success) { Modal.close(); Toast.show('PIN saved', 'success'); }
      else           { err.textContent = r.error; }
    };

    document.getElementById('set-pin-master').focus();
  },

  async _refreshQuickUnlockButtons() {
    const { kb } = window.App;
    try {
      const hasPin = await kb.vault.hasPin();
      const btn = document.getElementById('set-pin-btn');
      if (btn) btn.textContent = hasPin ? 'Change PIN' : 'Set PIN';
    } catch {}
    try {
      const hasPattern = await kb.vault.hasPattern();
      const btn = document.getElementById('set-pattern-btn');
      if (btn) btn.textContent = hasPattern ? 'Change Pattern' : 'Set Pattern';
    } catch {}
    try {
      const hasKeyFile = await kb.vault.hasKeyFile();
      const btn = document.getElementById('set-keyfile-btn');
      if (btn) btn.textContent = hasKeyFile ? 'Manage Key File' : 'Set Key File';
    } catch {}
  },

  // ── Pattern unlock modal ─────────────────────────────────────────────────

  _showPatternModal() {
    const { Modal, Toast, kb } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>▦ Set Pattern</h3>
        <button class="modal-close" id="pat-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
        Enter your master password, then draw a pattern connecting at least 4 dots.
      </p>
      <div class="form-group">
        <label>Master Password <span style="color:var(--danger)">*</span></label>
        <div class="password-input-wrap">
          <input type="password" id="set-pat-master" placeholder="Your master password" autocomplete="current-password" />
          <button class="toggle-pw" data-target="set-pat-master">👁</button>
        </div>
      </div>
      <div style="text-align:center;margin:6px 0 4px;font-size:12px;color:var(--text-muted)" id="pat-step-label">Draw your pattern</div>
      <div id="pat-grid-wrap" style="display:flex;justify-content:center;padding:8px 0"></div>
      <div class="error-msg" id="pat-modal-err" style="text-align:center"></div>
      <button class="btn btn-primary btn-full" id="pat-save-btn" disabled>Draw pattern to continue</button>
    `);

    document.getElementById('pat-modal-close').onclick = () => Modal.close();
    PasswordToggle.init();
    document.getElementById('set-pat-master').focus();

    let firstPattern = null;

    const grid = this._buildPatternGrid('pat-grid-wrap', (patternStr) => {
      const err = document.getElementById('pat-modal-err');
      const stepLabel = document.getElementById('pat-step-label');
      const saveBtn = document.getElementById('pat-save-btn');
      err.textContent = '';

      if (patternStr.split('-').length < 4) {
        err.textContent = 'Connect at least 4 dots.';
        grid.reset();
        return;
      }

      if (!firstPattern) {
        firstPattern = patternStr;
        stepLabel.textContent = 'Draw the same pattern again to confirm';
        saveBtn.textContent = 'Draw pattern again to confirm';
        grid.reset();
        return;
      }

      if (patternStr !== firstPattern) {
        err.textContent = "Patterns didn't match — try again.";
        firstPattern = null;
        stepLabel.textContent = 'Draw your pattern';
        saveBtn.textContent = 'Draw pattern to continue';
        grid.reset();
        return;
      }

      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Pattern';
      saveBtn.dataset.pattern = patternStr;
    });

    document.getElementById('pat-save-btn').onclick = async () => {
      const master  = document.getElementById('set-pat-master').value;
      const err     = document.getElementById('pat-modal-err');
      const pattern = document.getElementById('pat-save-btn').dataset.pattern;
      err.textContent = '';

      if (!master)   { err.textContent = 'Master password is required.'; return; }
      if (!pattern)  { err.textContent = 'Draw and confirm a pattern first.'; return; }

      const verifyResult = await kb.vault.unlock(master);
      if (!verifyResult.success) { err.textContent = 'Incorrect master password.'; return; }

      const r = await kb.vault.setPattern(pattern);
      if (r.success) { Modal.close(); Toast.show('Pattern saved', 'success'); this._refreshQuickUnlockButtons(); }
      else           { err.textContent = r.error; }
    };
  },

  // Builds a 3x3 pattern-lock grid inside the given container id.
  // Calls onComplete(patternString) once the user releases the pointer
  // after connecting at least 2 dots. Returns { reset() } to clear state.
  _buildPatternGrid(containerId, onComplete) {
    const SIZE = 168, DOTS = 3, PAD = 26;
    const step = (SIZE - PAD * 2) / (DOTS - 1);
    const positions = [];
    for (let row = 0; row < DOTS; row++) {
      for (let col = 0; col < DOTS; col++) {
        positions.push({ x: PAD + col * step, y: PAD + row * step });
      }
    }

    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div id="${containerId}-svgwrap" style="position:relative;width:${SIZE}px;height:${SIZE}px;user-select:none;touch-action:none">
        <svg width="${SIZE}" height="${SIZE}" style="position:absolute;inset:0;pointer-events:none">
          <polyline id="${containerId}-line" points="" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />
        </svg>
        ${positions.map((p, i) => `
          <div class="pat-dot" data-idx="${i}" style="position:absolute;left:${p.x - 9}px;top:${p.y - 9}px;width:18px;height:18px;border-radius:50%;border:2px solid var(--border-light);background:var(--bg-elevated);transition:background 0.1s,border-color 0.1s"></div>
        `).join('')}
      </div>
    `;

    const wrap = document.getElementById(`${containerId}-svgwrap`);
    const line = document.getElementById(`${containerId}-line`);
    const dots = [...container.querySelectorAll('.pat-dot')];
    let selected = [];
    let dragging = false;

    const setDotState = (idx, on) => {
      const el = dots[idx];
      el.style.background = on ? 'var(--accent)' : 'var(--bg-elevated)';
      el.style.borderColor = on ? 'var(--accent)' : 'var(--border-light)';
    };

    const reset = () => {
      selected.forEach(idx => setDotState(idx, false));
      selected = [];
      line.setAttribute('points', '');
    };

    const updateLine = (extraPoint) => {
      const pts = selected.map(idx => `${positions[idx].x},${positions[idx].y}`);
      if (extraPoint) pts.push(`${extraPoint.x},${extraPoint.y}`);
      line.setAttribute('points', pts.join(' '));
    };

    const hitTest = (clientX, clientY) => {
      const rect = wrap.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      for (let i = 0; i < positions.length; i++) {
        const dx = x - positions[i].x, dy = y - positions[i].y;
        if (Math.sqrt(dx * dx + dy * dy) <= 13 && !selected.includes(i)) return i;
      }
      return -1;
    };

    const onDown = (clientX, clientY) => {
      reset();
      dragging = true;
      const idx = hitTest(clientX, clientY);
      if (idx >= 0) { selected.push(idx); setDotState(idx, true); updateLine(); }
    };
    const onMove = (clientX, clientY) => {
      if (!dragging) return;
      const idx = hitTest(clientX, clientY);
      if (idx >= 0) { selected.push(idx); setDotState(idx, true); }
      const rect = wrap.getBoundingClientRect();
      updateLine({ x: clientX - rect.left, y: clientY - rect.top });
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      updateLine();
      if (selected.length >= 2) onComplete(selected.join('-'));
      else reset();
    };

    // Route drag through ONE shared window-level listener pair (installed once,
    // ever) rather than adding new mousemove/mouseup listeners on every grid
    // rebuild — this screen can be rebuilt many times in a session (switching
    // unlock methods, failed attempts, re-opening the settings modal, etc.)
    // and unbounded listener growth would leak memory and CPU over time.
    window.__patternGridActive = { onMove, onUp };
    if (!window.__patternGridGlobalBound) {
      window.__patternGridGlobalBound = true;
      window.addEventListener('mousemove', (e) => window.__patternGridActive?.onMove(e.clientX, e.clientY));
      window.addEventListener('mouseup',   ()  => window.__patternGridActive?.onUp());
    }

    wrap.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
    wrap.addEventListener('touchstart', (e) => { const t = e.touches[0]; onDown(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    wrap.addEventListener('touchmove',  (e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    wrap.addEventListener('touchend',   onUp);

    return { reset };
  },

  // ── Key file modal ───────────────────────────────────────────────────────────

  async _showKeyFileModal() {
    const { Modal, Toast, kb } = window.App;
    const hasKeyFile = await kb.vault.hasKeyFile().catch(() => false);

    Modal.show(`
      <div class="modal-header">
        <h3>🔑 Key File</h3>
        <button class="modal-close" id="kf-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
        A key file is a small file that unlocks your vault instead of typing a PIN —
        keep it somewhere safe (a USB drive, a private cloud folder). Losing it just means
        falling back to your master password; it's never your only way in.
      </p>
      ${hasKeyFile ? `<div style="font-size:12px;color:var(--success);margin-bottom:14px">✓ A key file is currently active for this vault</div>` : ''}
      <div class="form-group">
        <label>Master Password <span style="color:var(--danger)">*</span></label>
        <div class="password-input-wrap">
          <input type="password" id="kf-master" placeholder="Your master password" autocomplete="current-password" />
          <button class="toggle-pw" data-target="kf-master">👁</button>
        </div>
      </div>
      <div class="error-msg" id="kf-modal-err"></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-full" id="kf-generate-btn">Generate New Key File…</button>
        <button class="btn btn-ghost btn-full" id="kf-existing-btn">Use an Existing File…</button>
        ${hasKeyFile ? `<button class="btn btn-ghost btn-full" id="kf-remove-btn" style="color:var(--danger)">Remove Key File</button>` : ''}
      </div>
    `);

    document.getElementById('kf-modal-close').onclick = () => Modal.close();
    PasswordToggle.init();
    document.getElementById('kf-master').focus();

    const verifyMaster = async () => {
      const master = document.getElementById('kf-master').value;
      const err = document.getElementById('kf-modal-err');
      err.textContent = '';
      if (!master) { err.textContent = 'Master password is required.'; return false; }
      const verifyResult = await kb.vault.unlock(master);
      if (!verifyResult.success) { err.textContent = 'Incorrect master password.'; return false; }
      return true;
    };

    document.getElementById('kf-generate-btn').onclick = async () => {
      if (!(await verifyMaster())) return;
      const btn = document.getElementById('kf-generate-btn');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
      const r = await kb.vault.generateKeyFile();
      btn.disabled = false; btn.textContent = 'Generate New Key File…';
      if (r.success) { Modal.close(); Toast.show('Key file created at ' + r.path, 'success'); this._refreshQuickUnlockButtons(); }
      else if (r.error !== 'CANCELLED') { document.getElementById('kf-modal-err').textContent = r.error || 'Failed to create key file.'; }
    };

    document.getElementById('kf-existing-btn').onclick = async () => {
      if (!(await verifyMaster())) return;
      const filePath = await kb.vault.pickKeyFile();
      if (!filePath) return;
      const r = await kb.vault.setKeyFile(filePath);
      if (r.success) { Modal.close(); Toast.show('Key file registered', 'success'); this._refreshQuickUnlockButtons(); }
      else           { document.getElementById('kf-modal-err').textContent = r.error || 'Failed to register key file.'; }
    };

    document.getElementById('kf-remove-btn')?.addEventListener('click', async () => {
      const r = await kb.vault.removeKeyFile();
      if (r.success) { Modal.close(); Toast.show('Key file removed', 'success'); this._refreshQuickUnlockButtons(); }
    });
  },

  _showChangePasswordModal() {
    const { Modal, Toast, kb } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>🔑 Change Master Password</h3>
        <button class="modal-close" id="chpw-modal-close">✕</button>
      </div>
      <div class="form-group">
        <label>Current Password</label>
        <div class="password-input-wrap">
          <input type="password" id="chpw-old" placeholder="Current master password" />
          <button class="toggle-pw" data-target="chpw-old">👁</button>
        </div>
      </div>
      <div class="form-group">
        <label>New Password</label>
        <div class="password-input-wrap">
          <input type="password" id="chpw-new" placeholder="New master password" />
          <button class="toggle-pw" data-target="chpw-new">👁</button>
        </div>
        <div class="strength-bar-wrap"><div class="strength-bar" id="chpw-bar"></div></div>
        <span class="strength-label" id="chpw-label"></span>
      </div>
      <div class="form-group">
        <label>Confirm New Password</label>
        <input type="password" id="chpw-confirm" placeholder="Repeat new password" />
      </div>
      <div class="error-msg" id="chpw-err"></div>
      <button class="btn btn-primary btn-full" id="chpw-save">Update Password</button>
    `);

    document.getElementById('chpw-modal-close').onclick = () => Modal.close();

    document.getElementById('chpw-new').oninput = async (e) => {
      const s   = await kb.password.strength(e.target.value);
      const bar = document.getElementById('chpw-bar');
      const lbl = document.getElementById('chpw-label');
      if (bar) { bar.style.width = s.score + '%'; bar.style.background = s.color; }
      if (lbl) { lbl.textContent = e.target.value ? s.label : ''; lbl.style.color = s.color; }
    };

    document.getElementById('chpw-save').onclick = async () => {
      const oldPw   = document.getElementById('chpw-old').value;
      const newPw   = document.getElementById('chpw-new').value;
      const confirm = document.getElementById('chpw-confirm').value;
      const err     = document.getElementById('chpw-err');

      if (!oldPw || !newPw)  { err.textContent = 'All fields are required.';              return; }
      if (newPw.length < 8)  { err.textContent = 'New password must be 8+ characters.';  return; }
      if (newPw !== confirm)  { err.textContent = 'Passwords do not match.';              return; }

      const btn = document.getElementById('chpw-save');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      const r = await kb.vault.changePassword(oldPw, newPw);
      btn.disabled = false;
      btn.textContent = 'Update Password';

      if (r.success) { Modal.close(); Toast.show('Password changed!', 'success'); }
      else { err.textContent = r.error === 'WRONG_PASSWORD' ? 'Current password is incorrect.' : r.error; }
    };

    document.getElementById('chpw-old').focus();
  },

  // ── Breach scanner ────────────────────────────────────────────────────────────

  async _checkAllBreaches() {
    const { kb, AppState, Toast } = window.App;
    const logins = AppState.items.filter(i => i.type === 'login' && i.password);
    if (!logins.length) { Toast.show('No login passwords to check', 'info'); return; }

    const btn = document.getElementById('set-breach-all-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…'; }

    Toast.show(`Checking ${logins.length} passwords…`, 'info');
    let breached = 0;

    for (const item of logins) {
      try {
        const result = await kb.password.checkBreach(item.password);
        if (result.breached)          { AppState.breachItems.add(item.id);    breached++; }
        else if (result.breached === false) { AppState.breachItems.delete(item.id); }
      } catch {}
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Check Now'; }
    VaultPage._updateCounts();
    Toast.show(
      `Done! ${breached} breached password${breached !== 1 ? 's' : ''} found.`,
      breached > 0 ? 'error' : 'success'
    );
  },
};
