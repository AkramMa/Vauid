'use strict';
/* icons.js — local, offline SVG icon set (no CDN, no emoji font dependency).
   Simple 24x24 stroke-based line icons in the Feather/Lucide style:
   fill="none", stroke="currentColor" (inherits CSS color), round caps/joins.

   Usage: icon('lock', { size: 18, className: 'my-class' }) -> inline <svg> string
*/

const ICON_PATHS = {
  lock:        '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
  unlock:      '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M7 10V7a5 5 0 0 1 9-3"/>',
  key:         '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.8 12.2 20 3M17 6l2 2M14 9l2 2"/>',
  folder:      '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  'credit-card':'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  user:        '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7"/>',
  'file-text':  '<path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/>',
  fingerprint: '<path d="M12 3a8 8 0 0 1 8 8c0 3-1 5-1 7"/><path d="M12 3a8 8 0 0 0-8 8c0 2 .3 3.6.9 5"/><path d="M12 7a5 5 0 0 1 5 5c0 3.5-1 6-1 8"/><path d="M12 7a5 5 0 0 0-5 5c0 2.5.5 4 .8 5.5"/><path d="M12 11a2 2 0 0 1 2 2c0 3-1.5 5.5-2.5 7.5"/>',
  globe:       '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  settings:    '<path d="M4 7h10M18 7h2M4 17h2M8 17h12M14 4v6M11 14v6"/><circle cx="14" cy="7" r="2"/><circle cx="11" cy="17" r="2"/>',
  wand:        '<path d="M4 20 15 9"/><path d="M17 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M5 8l.6 1.4L7 10l-1.4.6L5 12l-.6-1.4L3 10l1.4-.6z"/>',
  refresh:     '<path d="M4 12a8 8 0 0 1 14-5.3L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-14 5.3L4 16"/><path d="M4 20v-4h4"/>',
  shield:      '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  trash:       '<line x1="4" y1="7" x2="20" y2="7"/><path d="M6 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2"/><path d="M7 7v13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  star:        '<polygon points="12,3 14.8,9 21,9.5 16.3,13.7 17.8,20 12,16.5 6.2,20 7.7,13.7 3,9.5 9.2,9"/>',
  plus:        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search:      '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>',
  eye:         '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':   '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.4 4.3M6.5 6.7C4 8.4 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>',
  copy:        '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  'external-link':'<path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  'alert-triangle':'<path d="M12 3 22 20H2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/>',
  clock:       '<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>',
  'chevron-down':'<polyline points="5,8 12,15 19,8"/>',
  'chevron-up':'<polyline points="5,15 12,8 19,15"/>',
  'chevron-right':'<polyline points="8,5 15,12 8,19"/>',
  x:           '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  edit:        '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><line x1="14" y1="7" x2="17" y2="10"/>',
  download:    '<path d="M12 3v12"/><polyline points="7,11 12,16 17,11"/><path d="M5 19h14"/>',
  upload:      '<path d="M12 21V9"/><polyline points="7,13 12,8 17,13"/><path d="M5 19h14"/>',
  paperclip:   '<path d="M17 7.5 8.5 16a3.5 3.5 0 0 1-5-5L12 2.5a2.3 2.3 0 0 1 3.3 3.2L7 14a1 1 0 0 1-1.5-1.3L13 5"/>',
  camera:      '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="4"/>',
  users:       '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 8.5a3 3 0 1 1 0-5.9"/><path d="M17.5 14.2c2.5.6 4 2.7 4 5.8"/>',
  info:        '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/>',
  check:       '<polyline points="4,12 9,17 20,6"/>',
  keypad:      '<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="9" y1="8" x2="9" y2="8"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="15" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="9" y2="12"/><line x1="12" y1="12" x2="12" y2="12"/><line x1="15" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="9" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/><line x1="15" y1="16" x2="15" y2="16"/>',
  bell:        '<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
};

/**
 * icon(name, opts) -> inline <svg> markup string.
 * opts: { size, className, strokeWidth, style }
 */
function icon(name, opts = {}) {
  const body = ICON_PATHS[name];
  if (!body) return '';
  const size = opts.size || 18;
  const sw = opts.strokeWidth || 2;
  const cls = opts.className ? ` class="${opts.className}"` : '';
  const style = opts.style ? ` style="${opts.style}"` : '';
  return `<svg${cls}${style} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

if (typeof window !== 'undefined') window.icon = icon;
