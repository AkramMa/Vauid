// Edge/Firefox compatibility: ensure chrome namespace is available
const _chrome = (typeof chrome !== 'undefined') ? chrome : browser; // eslint-disable-line

// ─────────────────────────────────────────────────────────────────────────────
// content.js — VauID content script
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let _connected = false;
let _unlocked  = false;
let _autofillMenu  = null;
let _activeField   = null;
let _saveBanner    = null;
let _bannerTimeout = null;
let _filledByVauID = false;  // suppress save banner when we triggered the fill
let _lastPromptReset = null; // reset dedup — set by watchFormSubmit

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
}

function getLoginForm(field) {
  return field?.closest('form') || document.body;
}

function findUsernameField(form) {
  const sel = 'input[type="email"], input[type="text"][autocomplete*="user"], input[type="text"][name*="user"], input[type="text"][name*="email"], input[type="text"][id*="user"], input[type="text"][id*="email"]';
  const candidates = [...(form?.querySelectorAll(sel) || [])];
  return candidates.find(isVisible) || form?.querySelector('input[type="text"]') || null;
}

function findPasswordField(form) {
  const candidates = [...(form?.querySelectorAll('input[type="password"]') || [])];
  return candidates.find(isVisible);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Returns true if this form looks like a registration (sign-up) form
function isSignUpForm(form) {
  const pwFields = [...(form?.querySelectorAll('input[type="password"]') || [])].filter(isVisible);
  return pwFields.length >= 2;
}

// Returns true if this form looks like a change-password form
function isChangePasswordForm(form) {
  const pwFields = [...(form?.querySelectorAll('input[type="password"]') || [])].filter(isVisible);
  if (pwFields.length < 2) return false;
  const names = pwFields.map(f => (f.name + f.id + f.autocomplete).toLowerCase());
  return names.some(n => n.includes('current') || n.includes('old') || n.includes('existing'));
}

// For sign-up / change-password forms, return the "new" password field (last one, or one named new/confirm)
function getNewPasswordField(form) {
  const pwFields = [...(form?.querySelectorAll('input[type="password"]') || [])].filter(isVisible);
  const newField = pwFields.find(f => /(new|confirm|repeat)/i.test(f.name + f.id + f.autocomplete));
  return newField || pwFields[pwFields.length - 1] || null;
}

function hostname() {
  return location.hostname.replace(/^www\./, '');
}

// ── Fill logic ────────────────────────────────────────────────────────────────

function fillFields(username, password) {
  _filledByVauID = true;
  setTimeout(() => { _filledByVauID = false; }, 10000);
  const pwFields = [...document.querySelectorAll('input[type="password"]')].filter(isVisible);
  for (const pw of pwFields) {
    const form = getLoginForm(pw);
    const un   = findUsernameField(form);
    if (un && username) triggerFill(un, username);
    if (password)       triggerFill(pw, password);
  }
  hideAutofillMenu();
}

// Fire the full event set frameworks (React, Angular, Vue) need to detect fills
function triggerFill(el, value) {
  el.focus();
  setNativeValue(el, value);
  // input → change → blur covers React synthetic events, Angular, and plain JS
  ['input', 'change', 'keyup', 'blur'].forEach(type =>
    el.dispatchEvent(new Event(type, { bubbles: true }))
  );
}

function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
}

// ── Autofill suggestion menu ──────────────────────────────────────────────────

// ── Field icon (trigger button) ──────────────────────────────────────────────

let _fieldIcon = null;
let _fieldIconField = null;

function showFieldIcon(field) {
  // If already showing for this exact field, just reposition
  if (_fieldIcon && _fieldIconField === field) { _positionFieldIcon(field); return; }
  hideFieldIcon();
  _fieldIconField = field;

  const icon = document.createElement('button');
  icon.id = 'vauid-field-icon';
  icon.setAttribute('aria-label', 'Fill with VauID');
  icon.setAttribute('type', 'button');
  icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  Object.assign(icon.style, {
    position:        'fixed',
    zIndex:          '2147483646',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    width:           '22px',
    height:          '22px',
    borderRadius:    '5px',
    border:          '1px solid rgba(217,119,87,.4)',
    background:      'rgba(217,119,87,.1)',
    color:           '#D97757',
    cursor:          'pointer',
    padding:         '0',
    outline:         'none',
    backdropFilter:  'blur(4px)',
    transition:      'background .15s, border-color .15s',
    boxSizing:       'border-box',
  });

  icon.addEventListener('mouseenter', () => {
    icon.style.background   = 'rgba(217,119,87,.2)';
    icon.style.borderColor  = 'rgba(217,119,87,.75)';
  });
  icon.addEventListener('mouseleave', () => {
    icon.style.background   = 'rgba(217,119,87,.1)';
    icon.style.borderColor  = 'rgba(217,119,87,.4)';
  });

  icon.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (_autofillMenu) { hideAutofillMenu(); return; }
    const isEmail = ['email','tel'].includes((_fieldIconField?.type || '').toLowerCase());
    if (isEmail) await fetchSuggestionsForEmail(_fieldIconField);
    else         await fetchSuggestions(_fieldIconField);
  });

  document.body.appendChild(icon);
  _fieldIcon = icon;
  _positionFieldIcon(field);

  // Reposition on scroll / resize
  const _reposition = () => _positionFieldIcon(field);
  window.addEventListener('scroll',  _reposition, { passive: true });
  window.addEventListener('resize',  _reposition, { passive: true });
  icon._cleanup = () => {
    window.removeEventListener('scroll',  _reposition);
    window.removeEventListener('resize',  _reposition);
  };
}

function _positionFieldIcon(field) {
  if (!_fieldIcon) return;
  const r = field.getBoundingClientRect();
  // Place inside the right edge of the field, vertically centered
  const iconSize = 22;
  const margin   = 6;
  _fieldIcon.style.top   = (r.top  + (r.height - iconSize) / 2) + 'px';
  _fieldIcon.style.left  = (r.right - iconSize - margin)        + 'px';
}

function hideFieldIcon() {
  if (_fieldIcon) {
    _fieldIcon._cleanup?.();
    _fieldIcon.remove();
    _fieldIcon = null;
    _fieldIconField = null;
  }
}

// Avatar color palette — deterministic from item name
const _avatarGradients = [
  ['#4f46e5','#7c3aed'], ['#0ea5e9','#2563eb'], ['#10b981','#059669'],
  ['#f59e0b','#d97706'], ['#ec4899','#db2777'], ['#8b5cf6','#6d28d9'],
  ['#06b6d4','#0284c7'], ['#f43f5e','#e11d48'],
];

function _avatarGradient(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const [a, b] = _avatarGradients[hash % _avatarGradients.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function _avatarInitial(name) {
  return (name || '?').trim()[0].toUpperCase();
}

// Lock SVG used in header badge — matches the extension icon
const _lockSVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="11" width="18" height="11" rx="2.5" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="8.5" cy="16.5" r="1" fill="#fff"/>
  <circle cx="12" cy="16.5" r="1" fill="#fff"/>
  <circle cx="15.5" cy="16.5" r="1" fill="#fff"/>
</svg>`;

// Arrow SVG shown on item hover
const _arrowSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none">
  <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function showAutofillMenu(field, items, opts = {}) {
  hideAutofillMenu();
  if (!items.length || !isVisible(field)) return;

  const { emailStep = false } = opts;
  const rect = field.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'vauid-autofill-menu';

  const all = items;
  const host = (() => { try { return new URL(location.href).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const faviconBase = host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null;

  // Build avatar HTML per item — try favicon first, fall back to initials
  function avatarHtml(item) {
    const bg = _avatarGradient(item.name);
    const initial = _avatarInitial(item.name);
    if (faviconBase) {
      return `<div class="vauid-item-avatar" style="background:${bg}">
        <img src="${faviconBase}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${initial}'" />
      </div>`;
    }
    return `<div class="vauid-item-avatar" style="background:${bg}">${initial}</div>`;
  }

  const emailHintHtml = emailStep
    ? `<div class="vauid-email-hint"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" style="vertical-align:-1.5px;margin-right:2px"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M2 6l10 7 10-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Fills email — password auto-fills on next step</div>`
    : '';

  menu.innerHTML = `
    <div class="vauid-menu-header">
      <div class="vauid-logo">${_lockSVG}</div>
      <span class="vauid-menu-title">VauID</span>
      <span class="vauid-menu-count">${all.length}</span>
    </div>
    <div class="vauid-item-list">
      ${emailHintHtml}
      ${all.map((item, i) => `
        <div class="vauid-item" data-idx="${i}">
          ${avatarHtml(item)}
          <div class="vauid-item-body">
            <div class="vauid-item-name">${esc(item.name)}</div>
            <div class="vauid-item-user">${esc(item.username || '—')}</div>
          </div>
          <div class="vauid-item-arrow">${_arrowSVG}</div>
        </div>`).join('')}
    </div>
    <div class="vauid-menu-footer">
      <span class="vauid-footer-key">Esc</span>
      <span class="vauid-footer-text">to close</span>
    </div>
  `;

  Object.assign(menu.style, {
    position:   'fixed',
    top:        rect.bottom + 8 + 'px',
    left:       rect.left + 'px',
    minWidth:   Math.max(260, rect.width) + 'px',
    maxWidth:   '360px',
    zIndex:     '2147483647',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });

  document.body.appendChild(menu);
  _autofillMenu = menu;

  // Reposition on scroll so it tracks the input field
  function _repositionMenu() {
    if (!_autofillMenu || !document.body.contains(_autofillMenu)) return;
    const r = field.getBoundingClientRect();
    _autofillMenu.style.top  = (r.bottom + 8) + 'px';
    _autofillMenu.style.left = r.left + 'px';
  }
  window.addEventListener('scroll', _repositionMenu, { passive: true });

  menu.querySelectorAll('.vauid-item').forEach((el, i) => {
    el.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      const cred = all[i];
      // Search results only carry a `hasPassword` presence flag, not the real
      // secret (see [S-2] in ws-server.js) — fetch it now, at the moment the
      // user actually chooses this item to fill.
      let password = '';
      if (cred.hasPassword && cred.id) {
        try {
          const res = await _chrome.runtime.sendMessage({ type: 'getPassword', itemId: cred.id });
          password = res?.password || '';
        } catch (_) {}
      }
      if (emailStep) {
        setNativeValue(field, cred.username || '');
        field.dispatchEvent(new Event('input',  { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        _pendingPassword = password || null;
        if (_pendingPassword) watchForPasswordField();
        _filledByVauID = true;
        setTimeout(() => { _filledByVauID = false; }, 10000);
        hideAutofillMenu();
      } else {
        fillFields(cred.username || '', password || '');
      }
    });
  });
}

function hideAutofillMenu() {
  if (_autofillMenu) { _autofillMenu.remove(); _autofillMenu = null; }
}

// Hide icon when Escape pressed or navigation happens
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideFieldIcon();
}, true);

// ── Fetch autofill suggestions ────────────────────────────────────────────────

async function fetchSuggestions(field) {
  if (!_connected || !_unlocked) return;
  try {
    const form = getLoginForm(field);
    // Sign-up forms: nudge towards password generator instead of autofill
    if (isSignUpForm(form)) {
      showGeneratorNudge(field);
      return;
    }
    const res = await _chrome.runtime.sendMessage({ type: 'search', query: '', url: location.href });
    if (res?.results?.length) showAutofillMenu(field, res.results);
  } catch (_) {}
}

// Multi-step login (Gmail, Microsoft, Apple): show autofill on the email/username field.
// When the user picks a credential, fill the current field with the username,
// then store the password so we can fill it once the password step appears.
let _pendingPassword = null;

async function fetchSuggestionsForEmail(field) {
  if (!_connected || !_unlocked) return;
  try {
    const form = getLoginForm(field);
    if (isSignUpForm(form)) return; // don't trigger on sign-up
    const res = await _chrome.runtime.sendMessage({ type: 'search', query: '', url: location.href });
    if (!res?.results?.length) return;
    showAutofillMenu(field, res.results, { emailStep: true });
  } catch (_) {}
}

// Watch for the password field to appear (multi-step pages inject it dynamically)
function watchForPasswordField() {
  if (!_pendingPassword) return;
  const obs = new MutationObserver(() => {
    const pw = [...document.querySelectorAll('input[type="password"]')].find(isVisible);
    if (pw) {
      obs.disconnect();
      setNativeValue(pw, _pendingPassword);
      pw.dispatchEvent(new Event('input',  { bubbles: true }));
      pw.dispatchEvent(new Event('change', { bubbles: true }));
      _filledByVauID = true;
      setTimeout(() => { _filledByVauID = false; }, 10000);
      _pendingPassword = null;
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  // Stop watching after 30s regardless
  setTimeout(() => obs.disconnect(), 30000);
}

function showGeneratorNudge(field) {
  hideAutofillMenu();
  const rect = field.getBoundingClientRect();
  const nudge = document.createElement('div');
  nudge.id = 'vauid-autofill-menu';

  // Wand/sparkle SVG for generator
  const wandSVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" stroke="#E8916F" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75L19 14z" stroke="#E8916F" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;

  nudge.innerHTML = `
    <div class="vauid-menu-header">
      <div class="vauid-logo">${_lockSVG}</div>
      <span class="vauid-menu-title">VauID</span>
    </div>
    <div class="vauid-item-list">
      <div class="vauid-item" id="vauid-gen-nudge">
        <div class="vauid-item-avatar" style="background:linear-gradient(135deg,#D97757,#E8916F)">${wandSVG}</div>
        <div class="vauid-item-body">
          <div class="vauid-item-name">Generate strong password</div>
          <div class="vauid-item-user">Click to open generator</div>
        </div>
        <div class="vauid-item-arrow">${_arrowSVG}</div>
      </div>
    </div>
    <div class="vauid-menu-footer">
      <span class="vauid-footer-key">Esc</span>
      <span class="vauid-footer-text">to close</span>
    </div>`;

  Object.assign(nudge.style, {
    position:   'fixed',
    top:        rect.bottom + 8 + 'px',
    left:       rect.left + 'px',
    minWidth:   Math.max(260, rect.width) + 'px',
    maxWidth:   '360px',
    zIndex:     '2147483647',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });

  document.body.appendChild(nudge);
  _autofillMenu = nudge;
  nudge.querySelector('#vauid-gen-nudge')?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    _chrome.runtime.sendMessage({ type: 'openGeneratorTab' }).catch(() => {});
    hideAutofillMenu();
  });
}

// ── Save / update banner ──────────────────────────────────────────────────────

function hideSaveBanner() {
  clearTimeout(_bannerTimeout);
  if (_saveBanner) {
    _saveBanner.style.animation = 'vsb-slide-out 0.2s ease forwards';
    setTimeout(() => { _saveBanner?.remove(); _saveBanner = null; }, 200);
  }
}

function showSaveBanner(cred, { mode, existing }) {
  hideSaveBanner();

  const banner = document.createElement('div');
  banner.id = 'vauid-save-banner';

  const host = hostname();
  const faviconUrl = `https://icons.duckduckgo.com/ip3/${host}.ico`;

  const header = `
    <div class="vsb-header">
      <img class="vsb-favicon" src="${faviconUrl}" onerror="this.style.display='none'" />
      <span class="vsb-brand">VauID</span>
      <button class="vsb-close" id="vsb-dismiss" aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>`;

  if (mode === 'save') {
    banner.innerHTML = `
      ${header}
      <div class="vsb-content">
        <div class="vsb-title">Save login for <span class="vsb-host">${esc(host)}</span>?</div>
        <div class="vsb-user">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${esc(cred.username)}
        </div>
      </div>
      <div class="vsb-actions">
        <button class="vsb-btn vsb-primary" id="vsb-save">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke="currentColor" stroke-width="2"/><polyline points="17 21 17 13 7 13 7 21" stroke="currentColor" stroke-width="2"/><polyline points="7 3 7 8 15 8" stroke="currentColor" stroke-width="2"/></svg>
          Save
        </button>
        <button class="vsb-btn vsb-ghost" id="vsb-never">Never</button>
      </div>`;
  } else {
    const updateBtns = existing.map(item =>
      `<button class="vsb-btn vsb-secondary vsb-update" data-id="${esc(item.id)}" data-name="${esc(item.name)}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20.5 15a9 9 0 11-2.8-9.4L23 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Update "${esc(item.name)}"
      </button>`
    ).join('');

    banner.innerHTML = `
      ${header}
      <div class="vsb-content">
        <div class="vsb-title">Different password for <span class="vsb-host">${esc(host)}</span></div>
        <div class="vsb-user">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${esc(cred.username)}
        </div>
      </div>
      <div class="vsb-actions vsb-stack">
        <button class="vsb-btn vsb-primary" id="vsb-add-new">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Add as new
        </button>
        ${updateBtns}
      </div>`;
  }

  document.body.appendChild(banner);
  _saveBanner = banner;
  _bannerTimeout = setTimeout(hideSaveBanner, 25000);

  // Progress bar auto-dismiss
  const progress = document.createElement('div');
  progress.className = 'vsb-progress';
  banner.appendChild(progress);
  requestAnimationFrame(() => { progress.style.width = '0%'; });

  banner.querySelector('#vsb-dismiss')?.addEventListener('click', hideSaveBanner);

  banner.querySelector('#vsb-never')?.addEventListener('click', async () => {
    try {
      const { vauid_ignored } = await _chrome.storage.local.get('vauid_ignored');
      const list = vauid_ignored || [];
      const domain = hostname();
      if (!list.includes(domain)) list.push(domain);
      await _chrome.storage.local.set({ vauid_ignored: list });
    } catch (_) {}
    hideSaveBanner();
  });

  async function doSave(btn, label) {
    // Show inline spinner in the button
    const btnOrig = btn.innerHTML;
    btn.innerHTML = `<span class="vsb-spinner"></span> Saving…`;
    btn.disabled = true;
    banner.querySelectorAll('.vsb-btn').forEach(b => { if (b !== btn) b.disabled = true; });

    const res = await _chrome.runtime.sendMessage({
      type:     'saveCredential',
      siteName: cred.siteName,
      url:      cred.url,
      username: cred.username,
      password: cred.password,
    }).catch(() => ({ ok: false }));

    if (!res.ok) {
      if (res.error?.includes('LOCKED') || !res.error) {
        // Vault locked — offer unlock
        banner.innerHTML = `
          ${header.replace('vsb-dismiss','vsb-dismiss-locked')}
          <div class="vsb-content">
            <div class="vsb-title" style="color:#eab308"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-2px;margin-right:2px"><rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Vault is locked</div>
            <div class="vsb-user">Unlock to save this login</div>
          </div>
          <div class="vsb-actions">
            <button class="vsb-btn vsb-primary" id="vsb-unlock-save">Unlock & save</button>
          </div>`;
        try { sessionStorage.setItem('__vauid_unlock_pending', JSON.stringify(cred)); } catch(_) {}
        banner.querySelector('#vsb-unlock-save')?.addEventListener('click', () => {
          _chrome.runtime.sendMessage({ type: 'openPopup' }).catch(() => {});
          hideSaveBanner();
        });
        banner.querySelector('#vsb-dismiss-locked')?.addEventListener('click', hideSaveBanner);
      } else {
        showBannerFeedback(banner, 'Failed to save — try again', true);
      }
    } else {
      showBannerFeedback(banner, label, false);
    }
  }

  banner.querySelector('#vsb-save')?.addEventListener('click', (e) => doSave(e.currentTarget, 'Login saved!'));
  banner.querySelector('#vsb-add-new')?.addEventListener('click', (e) => doSave(e.currentTarget, 'New login saved!'));

  banner.querySelectorAll('.vsb-update').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, name } = btn.dataset;
      btn.innerHTML = `<span class="vsb-spinner"></span> Updating…`;
      btn.disabled = true;
      banner.querySelectorAll('.vsb-btn').forEach(b => { if (b !== btn) b.disabled = true; });
      const res = await _chrome.runtime.sendMessage({
        type:     'updateCredential',
        id,
        username: cred.username,
        password: cred.password,
      }).catch(() => ({ ok: false }));
      showBannerFeedback(banner, res.ok ? `"${name}" updated!` : 'Could not update — vault locked?', !res.ok);
    });
  });
}

function showBannerFeedback(banner, message, isError) {
  const icon = isError
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#ef4444" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="#ef4444"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#7FB069" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="#7FB069" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  banner.innerHTML = `
    <div class="vsb-feedback-wrap">
      ${icon}
      <span class="vsb-feedback-msg ${isError ? 'vsb-error' : ''}">${esc(message)}</span>
    </div>`;
  setTimeout(hideSaveBanner, isError ? 3500 : 2000);
}

// ── Credential detection on form submit ───────────────────────────────────────

function watchFormSubmit() {
  let _lastPrompt = { url: '', username: '', pw: '', ts: 0 };
  _lastPromptReset = () => { _lastPrompt = { url: '', username: '', pw: '', ts: 0 }; };

  // Core handler — called from both form submit and beforeunload paths.
  // Values are already captured synchronously before any async work.
  async function handleCredential(username, password, url) {
    if (!_connected || !_unlocked || !password) return;
    if (_filledByVauID) return;  // we triggered this fill — don't prompt to save
    // Check if user has chosen "never save" for this domain
    try {
      const { vauid_ignored } = await _chrome.storage.local.get('vauid_ignored');
      if ((vauid_ignored || []).includes(hostname())) return;
    } catch (_) {}
    const now = Date.now();
    if (_lastPrompt.url === url && _lastPrompt.username === username &&
        _lastPrompt.pw === password && now - _lastPrompt.ts < 10000) return;
    _lastPrompt = { url, username, pw: password, ts: now };

    const siteName = document.title || hostname();
    let existing = [];
    try {
      const res = await _chrome.runtime.sendMessage({ type: 'search', query: '', url });
      existing = (res?.results || []).filter(i => i.type === 'login');
    } catch (_) {}

    if (existing.length === 0) {
      showSaveBanner({ username, password, siteName, url }, { mode: 'save', existing: [] });
    } else {
      const sameUser = existing.find(i => i.username === username);
      if (!sameUser) {
        // Different username than any saved login for this site — this is a
        // new account, not an update to an unrelated existing one. Offer to
        // save it as new rather than prompting "update" against the wrong login.
        showSaveBanner({ username, password, siteName, url }, { mode: 'save', existing: [] });
      } else {
        // Search results only carry a `hasPassword` flag, not the real value
        // (see [S-2] in ws-server.js) — fetch this one item's password to do
        // a real comparison, otherwise this would always look "different"
        // and nag to update even when the password is unchanged.
        let savedPassword = null;
        if (sameUser.hasPassword) {
          try {
            const res = await _chrome.runtime.sendMessage({ type: 'getPassword', itemId: sameUser.id });
            savedPassword = res?.password ?? null;
          } catch (_) {}
        }
        // Only prompt when it's genuinely the same account with a changed
        // password — same username, different password.
        if (savedPassword !== null && savedPassword !== password) {
          showSaveBanner({ username, password, siteName, url }, { mode: 'update', existing: [sameUser] });
        }
      }
    }
  }

  // Returns true if the login this form just submitted was most likely a
  // failure. This intentionally does NOT rely on URL keyword-matching
  // (many login pages/SPAs never put "login"/"signin" in the URL, and some
  // fail without changing the URL at all, while others navigate between
  // steps even on failure) — instead it checks whether the actual password
  // field is still sitting there, visible, on the page. A successful login
  // almost always navigates away or removes/replaces the form; a failed one
  // almost always leaves it in place, often with an error indicator nearby.
  function _loginLikelyFailed(pwField) {
    const formStillVisible = document.body.contains(pwField) && isVisible(pwField);
    if (!formStillVisible) return false; // field is gone/hidden -> most likely navigated away on success

    // Field still present and visible after the wait, on a credential
    // submission, is itself a strong failure signal regardless of whether the
    // URL changed (some flows navigate between steps even on failure). Explicit
    // aria-invalid/role=alert indicators strengthen it further where present,
    // but aren't required.
    return true;
  }

  // Path 1: Standard form submit (most sites)
  document.addEventListener('submit', (e) => {
    const form    = e.target;
    const pwField = findPasswordField(form);
    const unField = findUsernameField(form);
    if (!pwField?.value) return;
    // Capture values synchronously before any navigation
    const username = unField?.value?.trim() || '';
    const password = pwField.value;
    const urlBefore = location.href;
    // Wait for the page to settle (navigation or inline error) before deciding
    setTimeout(() => {
      if (_loginLikelyFailed(pwField)) return;
      handleCredential(username, password, urlBefore);
    }, 1000);
  }, true);

  // Path 2: SPA / fetch-based logins — save credentials on beforeunload
  // so they survive page transitions. Stored in sessionStorage and checked
  // on the next page load.
  let _snoopedCred = null;
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el?.type !== 'password' || !el.value) return;
    const form = getLoginForm(el);
    // For change-password or sign-up forms, capture from the "new" password field
    const pwToCapture = (isSignUpForm(form) || isChangePasswordForm(form))
      ? getNewPasswordField(form)
      : el;
    if (!pwToCapture?.value) return;
    const un = findUsernameField(form);
    _snoopedCred = {
      username: un?.value?.trim() || '',
      password: pwToCapture.value,
      url:      location.href,
    };
  }, true);

  window.addEventListener('beforeunload', () => {
    if (!_snoopedCred?.password) return;
    try {
      sessionStorage.setItem('__vauid_pending', JSON.stringify(_snoopedCred));
    } catch (_) {}
  });

  // Check for a credential left by a previous page (full-page-reload logins,
  // SPA navigation, OR a manual refresh mid-attempt all land here via
  // beforeunload). Delay until the page is fully loaded so the check below
  // sees the final rendered state, not an in-flight one.
  try {
    const pending = sessionStorage.getItem('__vauid_pending');
    if (pending) {
      sessionStorage.removeItem('__vauid_pending');
      const c = JSON.parse(pending);
      if (c?.password) {
        const run = () => {
          // If the page we've landed on (the actual destination, OR the same
          // login page again after a failure, OR simply reloaded because the
          // user hit refresh) still shows a visible password field, we're most
          // likely still on a login page rather than a successful destination —
          // skip the prompt rather than risk saving credentials that were never
          // confirmed to work.
          const stillOnLoginPage = [...document.querySelectorAll('input[type="password"]')].some(isVisible);
          if (stillOnLoginPage) return;
          handleCredential(c.username, c.password, c.url);
        };
        if (document.readyState === 'complete') {
          setTimeout(run, 500);
        } else {
          window.addEventListener('load', () => setTimeout(run, 500), { once: true });
        }
      }
    }
  } catch (_) {}
}

// ── Event listeners ───────────────────────────────────────────────────────────

// ── Persistent field icon — appears above login fields, no click needed ──────

function isLoginInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const t = (el.type || 'text').toLowerCase();
  if (!['password', 'text', 'email', 'tel'].includes(t)) return false;

  // Exclude OTP / verification-code digit boxes. These are almost always
  // limited to a single character regardless of their `type` — and often use
  // type="tel" specifically to bring up a numeric keypad on mobile, which
  // would otherwise unconditionally match the tel branch below and get an
  // icon attached to every single digit box in a 6-8 field code entry.
  if (el.maxLength === 1) return false;
  const autocomplete = (el.autocomplete || '').toLowerCase();
  if (autocomplete.includes('one-time-code')) return false;
  const hay = [el.name, el.id, el.placeholder,
    el.getAttribute('aria-label'), autocomplete].join(' ').toLowerCase();
  if (/otp|verification.?code|one.?time|security.?code|auth.?code|2fa|mfa/.test(hay)) return false;

  if (t === 'password' || t === 'email' || t === 'tel') return true;
  return /user|email|login|mail|identifier|account/.test(hay);
}

// Scan page for login fields and attach persistent icons
function attachFieldIcons() {
  document.querySelectorAll('input').forEach(el => {
    if (!isLoginInput(el)) return;
    if (!isVisible(el)) return;
    if (el.dataset.vauidIconAttached) return;
    el.dataset.vauidIconAttached = '1';
    _createInlineIcon(el);
  });
}

function _createInlineIcon(field) {
  // Position the icon absolutely relative to the viewport (fixed),
  // repositioning on every frame the field stays visible
  const icon = document.createElement('button');
  icon.className = 'vauid-input-icon';
  icon.setAttribute('type', 'button');
  icon.setAttribute('aria-label', 'Fill with VauID');
  icon.setAttribute('tabindex', '0');
  // Circular badge icon matching the extension icon style from the reference
  icon.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="11" width="18" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
      <circle cx="8.5" cy="16.5" r="1" fill="currentColor"/>
      <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
      <circle cx="15.5" cy="16.5" r="1" fill="currentColor"/>
    </svg>`;

  // Click → open menu
  icon.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    _activeField = field;
    if (_autofillMenu) { hideAutofillMenu(); return; }
    const t = (field.type || 'text').toLowerCase();
    if (t === 'email' || t === 'tel') await fetchSuggestionsForEmail(field);
    else if (t === 'password')        await fetchSuggestions(field);
    else                              await fetchSuggestionsForEmail(field);
  });

  icon.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); icon.dispatchEvent(new MouseEvent('mousedown')); }
  });

  document.body.appendChild(icon);

  // Keep icon pinned above the top-right corner of field using rAF
  const iconSize = 28;
  let _raf;
  function _pin() {
    if (!document.body.contains(field) || !isVisible(field)) {
      icon.style.display = 'none';
      _raf = requestAnimationFrame(_pin);
      return;
    }
    const r = field.getBoundingClientRect();
    icon.style.display = 'flex';
    // getBoundingClientRect() is already viewport-relative, and the icon is
    // position:fixed (also viewport-relative) — do NOT add window.scrollY/X
    // here, that's only correct for position:absolute and was causing the
    // icon to drift further from the field the more the page was scrolled.
    icon.style.top    = (r.top  - iconSize / 2) + 'px';
    icon.style.left   = (r.right - iconSize - 6) + 'px';
    _raf = requestAnimationFrame(_pin);
  }
  _raf = requestAnimationFrame(_pin);

  // Clean up when field is removed
  const mo = new MutationObserver(() => {
    if (!document.body.contains(field)) {
      cancelAnimationFrame(_raf);
      icon.remove();
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// Focusin: still track active field + dedup reset
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'INPUT') return;
  _activeField = el;
  if ((el.type || '').toLowerCase() === 'password') _lastPromptReset?.();
});

document.addEventListener('focusout', (e) => {
  setTimeout(() => {
    const active = document.activeElement;
    const isOurUI = active?.closest('.vauid-input-icon, #vauid-autofill-menu');
    if (!isOurUI) hideAutofillMenu();
  }, 150);
});

// Watch for dynamically added inputs (SPAs, multi-step forms)
const _domObserver = new MutationObserver(() => attachFieldIcons());
_domObserver.observe(document.body, { childList: true, subtree: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideFieldIcon(); hideAutofillMenu(); hideSaveBanner(); }
});

// ── Message handling ──────────────────────────────────────────────────────────

_chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {

    case 'vauid:fill':
      fillFields(msg.username || '', msg.password || '');
      sendResponse({ ok: true });
      break;

    case 'vauid:fillPassword': {
      const pw = _activeField || document.querySelector('input[type="password"]');
      if (pw) {
        setNativeValue(pw, msg.password);
        pw.dispatchEvent(new Event('input',  { bubbles: true }));
        pw.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sendResponse({ ok: true });
      break;
    }

    case 'vauid:openFill': {
      const field = _activeField || document.querySelector('input[type="password"]');
      if (field) fetchSuggestions(field);
      sendResponse({ ok: true });
      break;
    }

    case 'vauid:status':
      _connected = msg.connected;
      _unlocked  = msg.unlocked;
      if (!_connected || !_unlocked) { hideAutofillMenu(); hideSaveBanner(); }
      sendResponse({ ok: true });
      break;
  }
  return true;
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const status = await _chrome.runtime.sendMessage({ type: 'getStatus' });
    _connected = status.connected;
    _unlocked  = status.unlocked;
  } catch (_) {}

  watchFormSubmit();
  // Attach persistent icons to any login fields already on the page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachFieldIcons);
  } else {
    attachFieldIcons();
  }
})();
