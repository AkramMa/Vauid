'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// sync-page.js — Cloud Sync settings page
// ─────────────────────────────────────────────────────────────────────────────

const SyncPage = {
  async show() {
    const { Router, kb, Toast } = window.App;
    Router.show('page-vault');

    document.querySelectorAll('.nav-item, .folder-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('nav-sync')?.classList.add('active');

    const mainArea = document.getElementById('vault-main');
    if (!mainArea) return;

    let status = {};
    try { status = await kb.sync.getStatus(); } catch {}

    const PROVIDERS = [
      { id: 'googledrive', name: 'Google Drive',  icon: '📂', paths: status.cloudFolders?.googledrive || [] },
      { id: 'onedrive',    name: 'OneDrive',       icon: '☁️', paths: status.cloudFolders?.onedrive    || [] },
      { id: 'dropbox',     name: 'Dropbox',        icon: '📦', paths: status.cloudFolders?.dropbox      || [] },
      { id: 'custom',      name: 'Custom Folder',  icon: '📁', paths: status.vaultFolder ? [status.vaultFolder] : [] },
    ];

    mainArea.innerHTML = `
      <div style="flex:1;overflow-y:auto;padding:32px;max-width:700px;margin:0 auto" class="anim-fade">
        <div class="section-header" style="margin-bottom:24px">
          <h2 class="section-title">☁️ Cloud Sync</h2>
          <button class="btn btn-ghost btn-sm" id="sync-back-btn">← Back</button>
        </div>

        ${status.configured ? `
          <div class="card" style="margin-bottom:20px;border-color:var(--success)">
            <div style="display:flex;align-items:center;gap:14px">
              <span style="font-size:32px">✅</span>
              <div>
                <div style="font-weight:600">Syncing with ${status.provider}</div>
                <div style="color:var(--text-muted);font-size:12px">Last sync: ${status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'}</div>
              </div>
              <div style="margin-left:auto;display:flex;gap:8px">
                <button class="btn btn-sm btn-primary" id="sync-push-btn">⬆ Push Now</button>
                <button class="btn btn-sm btn-ghost"   id="sync-pull-btn">⬇ Pull</button>
                <button class="btn btn-sm btn-danger"  id="sync-disconnect-btn">Disconnect</button>
              </div>
            </div>
          </div>
        ` : ''}

        <div class="card">
          <div class="card-title">Select Cloud Provider</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
            ${PROVIDERS.map(p => `
              <div class="sync-provider-card${status.provider === p.id ? ' selected' : ''}" data-provider="${p.id}">
                <div class="sync-provider-icon">${p.icon}</div>
                <div class="sync-provider-name">${p.name}</div>
                ${p.paths.length > 0 ? `<div style="font-size:10px;color:var(--success);margin-top:4px">✓ Detected</div>` : ''}
              </div>
            `).join('')}
          </div>

          <div id="sync-folder-section" style="display:none">
            <div class="form-group">
              <label>Sync Folder</label>
              <div id="sync-detected-paths" style="margin-bottom:8px"></div>
              <div class="input-with-btn">
                <input type="text" id="sync-folder-inp" placeholder="Path to sync folder…" />
                <button class="btn btn-sm btn-outline" id="sync-browse-btn">Browse</button>
              </div>
            </div>
            <button class="btn btn-primary btn-full" id="sync-save-btn">Enable Sync</button>
          </div>
        </div>
      </div>
    `;

    this._bindEvents(status, PROVIDERS);
  },

  // ── Private ───────────────────────────────────────────────────────────────────

  _bindEvents(status, providers) {
    const { kb, Toast } = window.App;
    let selectedProvider = status.provider || '';

    document.getElementById('sync-back-btn').onclick = () => VaultPage.load();

    // Pre-open folder section if already configured
    if (selectedProvider || status.vaultFolder) {
      const sec = document.getElementById('sync-folder-section');
      if (sec) sec.style.display = 'block';
      const inp = document.getElementById('sync-folder-inp');
      if (inp && !inp.value) inp.value = status.vaultFolder || '';
    }

    // Provider cards
    document.querySelectorAll('.sync-provider-card').forEach(card => {
      card.onclick = () => {
        document.querySelectorAll('.sync-provider-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedProvider = card.dataset.provider;
        document.getElementById('sync-folder-section').style.display = 'block';

        const p = providers.find(pr => pr.id === selectedProvider);
        const detPaths = document.getElementById('sync-detected-paths');
        if (p && p.paths.length > 0) {
          detPaths.innerHTML = p.paths.map(pp => `
            <button class="btn btn-sm btn-ghost" style="margin-bottom:4px;width:100%;text-align:left;font-family:var(--font-mono);font-size:11px" data-path="${pp.replace(/"/g,'&quot;')}">
              📂 ${pp}${pp === status.vaultFolder ? ' <span style="color:var(--success)">(current vault)</span>' : ''}
            </button>
          `).join('');
          detPaths.querySelectorAll('button').forEach(b => {
            b.onclick = () => { document.getElementById('sync-folder-inp').value = b.dataset.path; };
          });
          if (!document.getElementById('sync-folder-inp').value) {
            document.getElementById('sync-folder-inp').value = p.paths[0];
          }
        } else {
          detPaths.innerHTML = '';
        }
      };
    });

    document.getElementById('sync-browse-btn')?.addEventListener('click', async () => {
      const folder = await kb.vault.pickFolder();
      if (folder) document.getElementById('sync-folder-inp').value = folder;
    });

    document.getElementById('sync-save-btn')?.addEventListener('click', async () => {
      const folder = document.getElementById('sync-folder-inp').value.trim();
      if (!folder) { Toast.show('Please select a folder', 'error'); return; }
      await kb.sync.configure(selectedProvider, { folder });
      Toast.show('Sync configured!', 'success');
      this.show();
    });

    document.getElementById('sync-push-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('sync-push-btn');
      btn.innerHTML = '<span class="spinner"></span>';
      const r = await kb.sync.push();
      btn.textContent = '⬆ Push Now';
      Toast.show(r.success ? 'Vault synced!' : 'Sync failed: ' + r.error, r.success ? 'success' : 'error');
    });

    document.getElementById('sync-pull-btn')?.addEventListener('click', async () => {
      const r = await kb.sync.pull();
      Toast.show(r.success ? '☁ Pulled from cloud!' : 'Pull failed: ' + r.error, r.success ? 'success' : 'error');
    });

    document.getElementById('sync-disconnect-btn')?.addEventListener('click', async () => {
      await kb.sync.disconnect();
      Toast.show('Sync disconnected', 'info');
      this.show();
    });
  },
};
