'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// generator.js — Password Generator page
// ─────────────────────────────────────────────────────────────────────────────

const GeneratorPage = {
  _opts: {
    length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true,
    ambiguous: false, words: false, wordCount: 4, capitalizeFirst: false, replaceOWithZero: false,
  },
  _lastPwd: '',
  _history: [],

  show() {
    const { Router } = window.App;
    Router.show('page-vault');

    document.querySelectorAll('.nav-item, .folder-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('nav-generator')?.classList.add('active');

    const mainArea = document.getElementById('vault-main');
    if (!mainArea) return;
    const opts = this._opts;

    mainArea.innerHTML = `
      <div style="flex:1;overflow-y:auto;padding:32px;max-width:640px;margin:0 auto" class="anim-fade">
        <div class="section-header" style="margin-bottom:24px">
          <h2 class="section-title">🔐 Password Generator</h2>
          <button class="btn btn-ghost btn-sm" id="gen-back-btn">← Back to Vault</button>
        </div>

        <div class="gen-display">
          <div class="gen-password" id="gen-output">Click Generate</div>
          <button class="icon-btn" id="gen-copy"    title="Copy"         style="font-size:20px">📋</button>
          <button class="icon-btn" id="gen-refresh" title="Generate new" style="font-size:20px">🔄</button>
        </div>

        <div class="strength-bar-wrap" style="margin-bottom:6px">
          <div class="strength-bar" id="gen-strength-bar"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:20px">
          <span class="strength-label" id="gen-strength-label"></span>
          <span class="strength-label" id="gen-breach-status"></span>
        </div>

        <div class="card" style="margin-bottom:20px">
          <div class="card-title">⚙️ Options</div>

          <div class="seg-ctrl" id="gen-mode-ctrl" style="margin-bottom:16px">
            <button class="seg-btn active" data-mode="password">Password</button>
            <button class="seg-btn"        data-mode="passphrase">Passphrase</button>
          </div>

          <div id="gen-password-opts">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
              <label style="font-size:14px;color:var(--text-primary)">Length: <strong id="gen-length-val">${opts.length}</strong></label>
              <input type="range" id="gen-length" min="8" max="64" value="${opts.length}" style="width:60%" />
            </div>
            <div class="gen-options">
              ${this._optToggle('uppercase', 'Uppercase A–Z')}
              ${this._optToggle('lowercase', 'Lowercase a–z')}
              ${this._optToggle('numbers',   'Numbers 0–9')}
              ${this._optToggle('symbols',   'Symbols !@#…')}
              ${this._optToggle('ambiguous', 'Include Ambiguous')}
            </div>
          </div>

          <div id="gen-passphrase-opts" style="display:none">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
              <label style="font-size:14px;color:var(--text-primary)">Words: <strong id="gen-words-val">4</strong></label>
              <input type="range" id="gen-wordcount" min="2" max="8" value="4" style="width:60%" />
            </div>
            <div class="gen-options">
              ${this._optToggle('capitalizeFirst',  'Capitalize First Letter')}
              ${this._optToggle('replaceOWithZero', 'Replace o → 0')}
            </div>
          </div>
        </div>

        <div style="display:flex;gap:10px">
          <button class="btn btn-primary btn-full" id="gen-btn">⚡ Generate</button>
          <button class="btn btn-outline"          id="gen-history-btn">📜 History</button>
        </div>

        <div id="gen-history" class="card" style="margin-top:20px;display:none">
          <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
            Generated Passwords
            <button class="btn btn-sm btn-ghost" id="gen-clear-history" style="color:var(--danger);font-size:12px">Clear</button>
          </div>
          <div id="gen-history-list"></div>
        </div>
      </div>
    `;

    this._history = this._loadHistory();
    this._bindEvents();
    this._generate();
  },

  // ── Private helpers ──────────────────────────────────────────────────────────

  _optToggle(key, label) {
    return `
      <div class="gen-option">
        <span class="gen-option-label">${label}</span>
        <label class="toggle">
          <input type="checkbox" id="gen-opt-${key}" ${this._opts[key] ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  },

  _bindEvents() {
    const { copyToClipboard } = window.App;
    let mode = 'password';

    document.getElementById('gen-back-btn').onclick = () => VaultPage.load();

    document.getElementById('gen-btn').onclick     = () => this._generate();
    document.getElementById('gen-refresh').onclick = () => this._generate();
    document.getElementById('gen-copy').onclick    = () => {
      if (!this._lastPwd) return;
      copyToClipboard(this._lastPwd, 'Password');
      this._addToHistory(this._lastPwd);
    };

    document.getElementById('gen-length').oninput = (e) => {
      this._opts.length = parseInt(e.target.value);
      document.getElementById('gen-length-val').textContent = this._opts.length;
      this._generate();
    };

    ['uppercase','lowercase','numbers','symbols','ambiguous'].forEach(key => {
      const el = document.getElementById(`gen-opt-${key}`);
      if (el) el.onchange = (e) => { this._opts[key] = e.target.checked; this._generate(); };
    });

    document.querySelectorAll('#gen-mode-ctrl .seg-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#gen-mode-ctrl .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        mode = btn.dataset.mode;
        document.getElementById('gen-password-opts').style.display   = mode === 'password'   ? 'block' : 'none';
        document.getElementById('gen-passphrase-opts').style.display = mode === 'passphrase' ? 'block' : 'none';
        this._opts.words = (mode === 'passphrase');
        this._generate();
      };
    });

    document.getElementById('gen-wordcount')?.addEventListener('input', (e) => {
      this._opts.wordCount = parseInt(e.target.value);
      document.getElementById('gen-words-val').textContent = this._opts.wordCount;
      this._generate();
    });

    ['capitalizeFirst','replaceOWithZero'].forEach(key => {
      const el = document.getElementById(`gen-opt-${key}`);
      if (el) el.onchange = (e) => { this._opts[key] = e.target.checked; this._generate(); };
    });

    document.getElementById('gen-history-btn').onclick = () => {
      const hist   = document.getElementById('gen-history');
      const isOpen = hist.style.display !== 'none';
      hist.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) this._renderHistory();
    };
  },

  async _generate() {
    const { kb, Toast } = window.App;
    let pwd;
    try {
      pwd = await kb.password.generate(this._opts);
      if (typeof pwd !== 'string' || !pwd) throw new Error('Empty result');
    } catch (err) {
      Toast?.show('Could not generate a password. Please try different options.', 'error');
      const out = document.getElementById('gen-output');
      if (out) out.textContent = 'Generation failed';
      return;
    }

    if (this._opts.words) {
      if (this._opts.capitalizeFirst)  pwd = pwd.replace(/(^|[-_ ])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
      if (this._opts.replaceOWithZero) pwd = pwd.replace(/o/gi, '0');
    }

    this._lastPwd = pwd;
    const out = document.getElementById('gen-output');
    if (out) out.textContent = pwd;

    const s   = await kb.password.strength(pwd);
    const bar = document.getElementById('gen-strength-bar');
    const lbl = document.getElementById('gen-strength-label');
    if (bar) { bar.style.width = s.score + '%'; bar.style.background = s.color; }
    if (lbl) { lbl.textContent = s.label; lbl.style.color = s.color; }
  },

  _loadHistory() {
    let raw = [];
    try { raw = JSON.parse(localStorage.getItem('kb_gen_history') || '[]'); } catch { raw = []; }
    // Migrate legacy format (plain array of password strings) to the new
    // object format with time + source.
    return raw.map(entry =>
      typeof entry === 'string'
        ? { password: entry, time: null, source: 'Local' }
        : entry
    );
  },

  // source: a real URL string (extension-generated, tied to the page you were
  // on) or omitted/falsy for anything generated inside the desktop app itself,
  // which has no associated webpage.
  _addToHistory(pwd, source, time) {
    const entry = {
      password: pwd,
      time: time || Date.now(),
      source: this._sourceLabel(source),
    };
    this._history = [entry, ...this._history.filter(e => e.password !== pwd)].slice(0, 50);
    localStorage.setItem('kb_gen_history', JSON.stringify(this._history));
    const hist = document.getElementById('gen-history');
    if (hist && hist.style.display !== 'none') this._renderHistory();
  },

  // Normalizes a source into either a real http(s) URL or the "Local" label.
  _sourceLabel(source) {
    if (source && /^https?:\/\//i.test(source)) return source;
    return 'Local';
  },

  _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
  },

  _renderHistory() {
    const { copyToClipboard } = window.App;
    const list = document.getElementById('gen-history-list');
    if (!list) return;

    list.innerHTML = this._history.slice(0, 20).map(entry => {
      const isUrl = /^https?:\/\//i.test(entry.source || '');
      let hostLabel = entry.source || 'Local';
      if (isUrl) { try { hostLabel = new URL(entry.source).hostname.replace(/^www\./, ''); } catch {} }
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-mono);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.password}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;display:flex;gap:6px;align-items:center">
              <span>${this._formatTime(entry.time)}</span>
              <span>·</span>
              <span style="color:${isUrl ? 'var(--accent)' : 'var(--text-muted)'}">${isUrl ? '🌐' : '💻'} ${hostLabel}</span>
            </div>
          </div>
          <button class="icon-btn hist-copy-btn" data-pwd="${entry.password.replace(/"/g,'&quot;')}" title="Copy">📋</button>
        </div>
      `;
    }).join('') || '<p style="color:var(--text-muted);font-size:13px;margin:8px 0">No generated passwords yet</p>';

    list.querySelectorAll('.hist-copy-btn').forEach(btn => {
      btn.onclick = () => copyToClipboard(btn.dataset.pwd, 'Password');
    });

    const clearBtn = document.getElementById('gen-clear-history');
    if (clearBtn) clearBtn.onclick = () => {
      this._history = [];
      localStorage.removeItem('kb_gen_history');
      this._renderHistory();
    };
  },

  /** Quick generate for use by item-form inline generator. */
  async quickGenerate(callback) {
    const { kb } = window.App;
    const pwd = await kb.password.generate({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });
    callback(pwd);
  },
};
