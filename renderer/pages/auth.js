'use strict';
/* Welcome + Create + Unlock pages */

const PasswordToggle = {
  init() {
    document.querySelectorAll('.toggle-pw').forEach(btn => {
      btn.onclick = () => {
        const inp = document.getElementById(btn.dataset.target);
        if (inp) {
          inp.type = inp.type === 'password' ? 'text' : 'password';
          btn.textContent = inp.type === 'password' ? '👁' : '🙈';
        }
      };
    });
  }
};

/* ── Welcome Page ─────────────────────────────────────────────────────── */
const WelcomePage = {
  async init(opts = {}) {
    const { forceChooser = false } = opts;
    const { Router, kb, Toast } = window.App;
    Router.show('page-welcome');

    let recents = [];
    try { recents = await kb.vault.getRecentVaults(); } catch {}

    // Any known vault(s) and not explicitly forced to the chooser -> go
    // straight to Unlock. With 2+ vaults, UnlockPage renders a switcher rail
    // so you can hop between them without ever leaving the unlock screen.
    if (!forceChooser && recents.length >= 1) {
      await openExistingVault(recents[0], recents);
      return;
    }

    const subEl = document.querySelector('.welcome-sub');
    const newBtn = document.getElementById('btn-new-vault');
    const openBtn = document.getElementById('btn-open-vault');

    // If we got here via the "Create or open a different vault" link (not a
    // fresh install), give a way back to unlocking without creating/opening
    // anything — otherwise this screen would be a dead end.
    const backLink = document.getElementById('welcome-back-link');
    if (backLink) {
      if (forceChooser && recents.length > 0) {
        backLink.style.display = 'inline-flex';
        backLink.onclick = () => WelcomePage.init();
      } else {
        backLink.style.display = 'none';
      }
    }

    if (recents.length === 0) {
      if (subEl) subEl.textContent = 'Create your first secure vault to get started';
      if (newBtn) newBtn.innerHTML = '<span class="btn-icon">✦</span> Create My Vault';
      if (openBtn) openBtn.innerHTML = '<span class="btn-icon">📂</span> Open an Existing Vault File';
    } else {
      if (subEl) subEl.textContent = recents.length > 1 ? 'Welcome back — choose a vault to unlock' : 'Welcome back';
      if (newBtn) newBtn.innerHTML = '<span class="btn-icon">✦</span> New Vault';
      if (openBtn) openBtn.innerHTML = '<span class="btn-icon">📂</span> Open Existing';
    }

    const recentDiv = document.getElementById('recent-vaults');
    const recentList = document.getElementById('recent-list');
    const recentLabel = document.querySelector('.recent-label');
    recentList.innerHTML = '';

    if (recents.length > 0) {
      recentDiv.style.display = 'block';
      if (recentLabel) recentLabel.textContent = recents.length > 1 ? 'Your vaults' : 'Recent vault';
      recents.forEach((vpath, idx) => {
        const parts = vpath.replace(/\\/g, '/').split('/');
        const name = parts[parts.length - 2] || 'Vault';
        const isLastUsed = idx === 0 && recents.length > 1;
        const item = document.createElement('div');
        item.className = 'recent-item hover-lift';
        item.innerHTML = `
          <div class="recent-item-icon">${escHtml((name[0] || 'V').toUpperCase())}</div>
          <div class="recent-item-info">
            <div class="recent-item-name">${escHtml(name)}${isLastUsed ? ' <span class="last-used-pill">LAST USED</span>' : ''}</div>
            <div class="recent-item-path">${escHtml(vpath)}</div>
          </div>
          <button class="recent-item-remove" title="Remove from list" data-path="${escHtml(vpath)}">✕</button>
          <span style="color:var(--text-muted);font-size:16px">›</span>
        `;
        item.addEventListener('click', (e) => {
          if (e.target.closest('.recent-item-remove')) return;
          openExistingVault(vpath);
        });
        item.querySelector('.recent-item-remove').onclick = async (e) => {
          e.stopPropagation();
          await kb.vault.removeRecent(vpath);
          Toast.show('Removed from recent vaults', 'success');
          WelcomePage.init({ forceChooser: true });
        };
        recentList.appendChild(item);
      });
    } else {
      recentDiv.style.display = 'none';
    }

    const clearLink = document.getElementById('recent-clear-link');
    if (clearLink) {
      clearLink.style.display = recents.length > 0 ? '' : 'none';
      clearLink.onclick = async () => {
        await kb.vault.clearRecents();
        Toast.show('Cleared recent vaults', 'success');
        WelcomePage.init({ forceChooser: true });
      };
    }

    document.getElementById('btn-new-vault').onclick = () => {
      Router.show('page-create');
      CreatePage.init();
    };

    document.getElementById('btn-open-vault').onclick = async () => {
      const filePath = await kb.vault.openFile();
      if (filePath) openExistingVault(filePath);
    };
  }
};

async function openExistingVault(vaultPath, recents = []) {
  const { Router, Toast, kb } = window.App;
  const result = await kb.vault.open(vaultPath);
  if (result.success) {
    Router.show('page-unlock');
    UnlockPage.init(vaultPath, result.hint, recents);
  } else {
    Toast.show('Could not open vault: ' + result.error, 'error');
  }
}

/* ── Create Page ──────────────────────────────────────────────────────── */
const CreatePage = {
  _folder: null,
  init() {
    const { Router, Toast, kb } = window.App;
    this._folder = null;
    document.getElementById('create-vault-name').value = '';
    document.getElementById('create-folder').value = '';
    document.getElementById('create-password').value = '';
    document.getElementById('create-confirm').value = '';
    document.getElementById('create-hint').value = '';
    document.getElementById('create-error').textContent = '';
    document.getElementById('create-strength-bar').style.width = '0%';
    document.getElementById('create-strength-label').textContent = '';

    document.getElementById('back-from-create').onclick = () => WelcomePage.init({ forceChooser: true });

    document.getElementById('btn-pick-folder').onclick = async () => {
      const folder = await kb.vault.pickFolder();
      if (folder) {
        this._folder = folder;
        document.getElementById('create-folder').value = folder;
      }
    };

    document.getElementById('create-password').oninput = async (e) => {
      const s = await kb.password.strength(e.target.value);
      const bar = document.getElementById('create-strength-bar');
      bar.style.width = s.score + '%';
      bar.style.background = s.color;
      document.getElementById('create-strength-label').textContent = e.target.value ? s.label : '';
      document.getElementById('create-strength-label').style.color = s.color;
    };

    document.getElementById('btn-do-create').onclick = () => this.submit();

    document.getElementById('create-confirm').onkeydown = (e) => {
      if (e.key === 'Enter') this.submit();
    };
  },

  async submit() {
    const { Router, Toast, kb } = window.App;
    const vaultName = document.getElementById('create-vault-name').value.trim();
    const folder = this._folder;
    const password = document.getElementById('create-password').value;
    const confirm = document.getElementById('create-confirm').value;
    const hint = document.getElementById('create-hint').value;
    const errEl = document.getElementById('create-error');
    errEl.textContent = '';

    if (!vaultName) { errEl.textContent = 'Please enter a vault name.'; return; }
    if (!folder) { errEl.textContent = 'Please select a folder.'; return; }
    if (!password) { errEl.textContent = 'Please enter a master password.'; return; }
    if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
    if (password !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }

    const btn = document.getElementById('btn-do-create');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating…';

    const result = await kb.vault.create(folder, password, hint, vaultName);
    btn.disabled = false;
    btn.textContent = 'Create Vault';

    if (result.success) {
      // Store vault name in vault settings
      try {
        await kb.vault.save({ settings: { vaultName } });
      } catch {}
      Toast.show('Vault created successfully!', 'success');
      await VaultPage.load();
    } else {
      errEl.textContent = 'Error: ' + result.error;
    }
  }
};

/* ── Unlock Page ──────────────────────────────────────────────────────── */
const UnlockPage = {
  _pinValue: '',
  _hasPin: false,

  async init(vaultPath, hint, recents = []) {
    const { Router, Toast, kb } = window.App;
    this._pinValue = '';
    this._hasPin = false;

    // Path label
    const parts = (vaultPath || '').replace(/\\/g, '/').split('/');
    const vaultName = parts[parts.length - 2] || 'Vault';
    document.getElementById('unlock-title').textContent = 'Unlock ' + vaultName;
    document.getElementById('unlock-path-label').textContent = vaultPath;
    const avatarEl = document.getElementById('unlock-avatar');
    if (avatarEl) avatarEl.textContent = (vaultName[0] || 'V').toUpperCase();

    this._buildRail(vaultPath, recents);

    // Hint
    const hintEl = document.getElementById('unlock-hint');
    hintEl.textContent = hint ? `Hint: ${hint}` : '';

    document.getElementById('unlock-password').value = '';
    document.getElementById('unlock-error').textContent = '';
    document.getElementById('pin-error').textContent = '';
    const patErrEl = document.getElementById('pattern-error');
    if (patErrEl) patErrEl.textContent = '';

    document.getElementById('unlock-switch-link').onclick = () => WelcomePage.init({ forceChooser: true });

    // Determine which quick-unlock methods are configured for this vault
    let hasPin = false, hasPattern = false, hasKeyFile = false;
    try { hasPin = await kb.vault.hasPin(); } catch {}
    try { hasPattern = await kb.vault.hasPattern(); } catch {}
    try { hasKeyFile = await kb.vault.hasKeyFile(); } catch {}
    this._hasPin = hasPin;
    this._hasPattern = hasPattern;
    this._hasKeyFile = hasKeyFile;

    const pinSection = document.getElementById('pin-section');
    const patternSection = document.getElementById('pattern-section');
    const pwSection = document.getElementById('password-section');

    // Cross-links visibility
    document.getElementById('use-pin-instead').style.display               = hasPin      ? '' : 'none';
    document.getElementById('use-pattern-instead').style.display           = hasPattern  ? '' : 'none';
    document.getElementById('use-keyfile-btn').style.display               = hasKeyFile  ? '' : 'none';
    document.getElementById('use-pattern-instead-frompin').style.display   = hasPattern  ? '' : 'none';
    document.getElementById('use-pin-instead-frompattern').style.display   = hasPin      ? '' : 'none';

    const showPin = () => {
      pinSection.style.display = 'block';
      patternSection.style.display = 'none';
      pwSection.style.display  = 'none';
      this._initPinInput();
    };
    const showPattern = () => {
      pinSection.style.display = 'none';
      patternSection.style.display = 'block';
      pwSection.style.display  = 'none';
      this._initPatternInput();
    };
    const showPassword = () => {
      pinSection.style.display = 'none';
      patternSection.style.display = 'none';
      pwSection.style.display  = 'block';
      document.getElementById('unlock-password').focus();
    };
    this._showPassword = showPassword;

    // Default view: PIN, then pattern, then password
    if (hasPin) showPin();
    else if (hasPattern) showPattern();
    else showPassword();

    document.getElementById('use-password-instead').onclick = showPassword;
    document.getElementById('use-password-instead-frompattern').onclick = showPassword;
    document.getElementById('use-pin-instead').onclick = showPin;
    document.getElementById('use-pin-instead-frompattern').onclick = showPin;
    document.getElementById('use-pattern-instead').onclick = showPattern;
    document.getElementById('use-pattern-instead-frompin').onclick = showPattern;

    document.getElementById('use-keyfile-btn').onclick = () => this.tryKeyFileUnlock();

    document.getElementById('btn-do-unlock').onclick = () => this.submitPassword();
    document.getElementById('unlock-password').onkeydown = (e) => {
      if (e.key === 'Enter') this.submitPassword();
    };
    if (!hasPin && !hasPattern) document.getElementById('unlock-password').focus();
  },

  // Populates the vault-switcher rail (only shown with 2+ known vaults) and
  // wires it so switching vaults never leaves the unlock screen.
  _buildRail(activePath, recents) {
    const rail = document.getElementById('vault-rail');
    const list = document.getElementById('vault-rail-list');
    if (!rail || !list) return;

    if (!recents || recents.length < 2) {
      rail.style.display = 'none';
      return;
    }

    rail.style.display = 'flex';
    list.innerHTML = '';
    recents.forEach(vpath => {
      const parts = vpath.replace(/\\/g, '/').split('/');
      const name = parts[parts.length - 2] || 'Vault';
      const btn = document.createElement('button');
      btn.className = 'rail-avatar' + (vpath === activePath ? ' active' : '');
      btn.type = 'button';
      btn.title = name;
      btn.textContent = (name[0] || 'V').toUpperCase();
      if (vpath !== activePath) {
        btn.onclick = () => openExistingVault(vpath, recents);
      }
      list.appendChild(btn);
    });

    const addBtn = document.getElementById('vault-rail-add');
    if (addBtn) addBtn.onclick = () => WelcomePage.init({ forceChooser: true });
  },

  _updatePinDots() {
    const dots = document.querySelectorAll('#pin-display span');
    dots.forEach((d, i) => {
      if (i < this._pinValue.length) {
        d.classList.add('filled');
      } else {
        d.classList.remove('filled');
      }
    });
  },

  _initPinInput() {
    const inp = document.getElementById('pin-input');
    inp.value = '';
    this._pinValue = '';
    this._updatePinDots();
    // Make input focusable via clicking pin display
    document.getElementById('pin-display').onclick = () => inp.focus();
    inp.focus();

    inp.oninput = async (e) => {
      // Allow alphanumeric, max 6 chars
      const val = e.target.value.slice(0, 6);
      this._pinValue = val;
      inp.value = val;
      this._updatePinDots();
      // Auto-submit on exactly 4 or 6 characters
      if (val.length === 4 || val.length === 6) {
        await this.submitPin();
      }
    };
  },

  async submitPin() {
    const { Toast, kb } = window.App;
    const pin = this._pinValue;
    if (!pin) return;
    const errEl = document.getElementById('pin-error');
    errEl.textContent = '';

    const result = await kb.vault.unlockWithPin(pin);
    if (result.success) {
      Toast.show('Vault unlocked', 'success');
      await VaultPage.load();
    } else {
      const err = result.error || '';
      if (err === 'WRONG_PIN') {
        errEl.textContent = 'Incorrect PIN.';
      } else if (err.startsWith('PIN_LOCKED:')) {
        const secs = err.split(':')[1];
        errEl.textContent = `Too many attempts. Try again in ${secs}s.`;
      } else if (err === 'PIN_UPGRADE_REQUIRED') {
        errEl.textContent = 'PIN reset required for security upgrade. Use your master password, then re-set your PIN in Settings.';
        document.getElementById('pin-section').style.display = 'none';
        document.getElementById('password-section').style.display = 'block';
        document.getElementById('use-pin-instead').style.display = 'none';
      } else if (err === 'PIN_REVOKED') {
        errEl.textContent = 'PIN revoked after too many failures. Use your master password.';
        document.getElementById('pin-section').style.display = 'none';
        document.getElementById('password-section').style.display = 'block';
        document.getElementById('use-pin-instead').style.display = 'none';
      } else {
        errEl.textContent = err;
      }
      document.getElementById('pin-display').classList.add('shake');
      setTimeout(() => document.getElementById('pin-display').classList.remove('shake'), 500);
      this._pinValue = '';
      document.getElementById('pin-input').value = '';
      this._updatePinDots();
    }
  },

  // ── Pattern unlock ─────────────────────────────────────────────────────────

  _initPatternInput() {
    // Reuses the shared pattern-grid builder defined in settings-page.js so
    // the drawing UX and hit-testing logic aren't duplicated.
    this._patternGrid = SettingsPage._buildPatternGrid('unlock-pattern-grid-wrap', (patternStr) => {
      this.submitPattern(patternStr);
    });
  },

  async submitPattern(pattern) {
    const { Toast } = window.App;
    const kb = window.App.kb;
    const errEl = document.getElementById('pattern-error');
    errEl.textContent = '';

    const result = await kb.vault.unlockWithPattern(pattern);
    if (result.success) {
      Toast.show('Vault unlocked', 'success');
      await VaultPage.load();
    } else {
      const err = result.error || '';
      if (err === 'WRONG_PATTERN') {
        errEl.textContent = 'Incorrect pattern.';
      } else if (err.startsWith('PATTERN_LOCKED:')) {
        const secs = err.split(':')[1];
        errEl.textContent = `Too many attempts. Try again in ${secs}s.`;
      } else if (err === 'PATTERN_REVOKED') {
        errEl.textContent = 'Pattern revoked after too many failures. Use your master password.';
        this._showPassword();
      } else {
        errEl.textContent = err;
      }
      this._patternGrid?.reset();
    }
  },

  // ── Key file unlock ─────────────────────────────────────────────────────

  async tryKeyFileUnlock() {
    const { Toast, kb } = window.App;
    const filePath = await kb.vault.pickKeyFile();
    if (!filePath) return;

    const result = await kb.vault.unlockWithKeyFile(filePath);
    if (result.success) {
      Toast.show('Vault unlocked', 'success');
      await VaultPage.load();
    } else {
      const err = result.error || '';
      if (err === 'WRONG_KEYFILE') Toast.show('That file doesn\'t match the key file for this vault.', 'error');
      else if (err === 'NO_KEYFILE_SET') Toast.show('No key file is set up for this vault.', 'error');
      else Toast.show('Key file unlock failed: ' + err, 'error');
    }
  },

  async submitPassword() {
    const { Toast, kb } = window.App;
    const pwd = document.getElementById('unlock-password').value;
    const errEl = document.getElementById('unlock-error');
    errEl.textContent = '';

    if (!pwd) { errEl.textContent = 'Please enter your master password.'; return; }

    const btn = document.getElementById('btn-do-unlock');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Unlocking…';

    const result = await kb.vault.unlock(pwd);
    btn.disabled = false;
    btn.textContent = 'Unlock';

    if (result.success) {
      Toast.show('Vault unlocked', 'success');
      await VaultPage.load();
    } else {
      if (result.error === 'WRONG_PASSWORD') {
        errEl.textContent = 'Incorrect password. Please try again.';
      } else if (result.error && result.error.startsWith('ARGON2_UNAVAILABLE')) {
        errEl.textContent = 'This KeePass file uses Argon2 encryption. Run "npm install argon2" then restart, or change your database KDF to AES-KDF in KeePass → Database Settings → Security.';
      } else {
        errEl.textContent = result.error;
      }
      document.getElementById('unlock-password').select();
    }
  }
};
