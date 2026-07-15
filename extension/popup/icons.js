'use strict';
/* icons.js — local, offline SVG icon set for the VauID popup (no CDN, no
   emoji font dependency). Auto-renders any [data-icon] element on load. */

const ICON_PATHS = {
  shield:      '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  lock:        '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
  settings:    '<path d="M4 7h10M18 7h2M4 17h2M8 17h12M14 4v6M11 14v6"/><circle cx="14" cy="7" r="2"/><circle cx="11" cy="17" r="2"/>',
  search:      '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>',
  zap:         '<polygon points="13,2 4,14 11,14 10,22 20,9 13,9"/>',
  copy:        '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  'plug-off':  '<circle cx="12" cy="12" r="9"/><line x1="6" y1="6" x2="18" y2="18"/>',
};

function icon(name, opts = {}) {
  const body = ICON_PATHS[name];
  if (!body) return '';
  const size = opts.size || 16;
  const sw = opts.strokeWidth || 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex-shrink:0">${body}</svg>`;
}

function renderIcons(scope) {
  (scope || document).querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.iconSize, 10) || 16;
    const existingText = el.textContent.trim();
    el.innerHTML = icon(name, { size }) + (existingText ? ' ' + existingText : '');
  });
  autoConvertEmoji(scope);
}

// Retrofit pass: recognizes common emoji used across the popup (dynamically
// rendered results, toasts, action buttons) on leaf elements and swaps them
// for local icons, preserving any trailing label text — covers content
// rendered by popup.js without needing to edit every render call site.
const EMOJI_ICON_MAP = {
  '🔐':'shield', '🔒':'lock', '🔑':'key', '⚙':'settings', '🔌':'plug-off',
  '🔍':'search', '⚡':'zap', '📋':'copy', '⚠️':'plug-off', '⚠':'plug-off',
  '✓':'check', '👤':'user', '🔢':'hash', '⬇':'download', '💳':'card', '🪪':'user', '📝':'note',
};
const ICON_PATHS_EXTRA = {
  check: '<polyline points="4,12 9,17 20,6"/>',
  user:  '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7"/>',
  hash:  '<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="9" y1="4" x2="7" y2="20"/><line x1="17" y1="4" x2="15" y2="20"/>',
  download: '<path d="M12 3v12"/><polyline points="7,11 12,16 17,11"/><path d="M5 19h14"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.8 12.2 20 3M17 6l2 2M14 9l2 2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  note: '<path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/>',
};
Object.assign(ICON_PATHS, ICON_PATHS_EXTRA);
const _emojiKeysSorted = Object.keys(EMOJI_ICON_MAP).sort((a, b) => b.length - a.length);

function autoConvertEmoji(scope) {
  (scope || document).querySelectorAll('*').forEach(el => {
    if (el.dataset && el.dataset.icon) return;
    if (el.children.length > 0) return;
    if (el.tagName === 'SVG' || el.closest?.('svg')) return;
    const text = el.textContent;
    if (!text) return;
    const trimmed = text.trim();
    for (const emoji of _emojiKeysSorted) {
      if (trimmed.startsWith(emoji)) {
        const rest = trimmed.slice(emoji.length).trim();
        el.innerHTML = icon(EMOJI_ICON_MAP[emoji], { size: 14 }) + (rest ? ' ' + rest : '');
        return;
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => { if (node.nodeType === 1) renderIcons(node); });
    }
  }).observe(document.body, { childList: true, subtree: true });
});
