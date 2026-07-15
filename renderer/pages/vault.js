'use strict';
/* Main Vault Page — items list, detail panel, folders, sidebar */

const VaultPage = {
  _totpIntervals: {},

  async load() {
    const { Router, AppState, kb, Toast } = window.App;
    Router.show('page-vault');

    // Restore the standard vault main layout (in case Generator/Sync/Settings replaced it)
    this._restoreVaultMain();

    const data = await kb.vault.getData();
    if (!data) { Toast.show('Failed to load vault', 'error'); return; }

    AppState.items = data.items || [];
    AppState.folders = data.folders || [];
    AppState._vaultData = data; // store full data for attachment access
    AppState.currentFilter = 'all';
    AppState.currentFolder = null;
    AppState.selectedItem = null;
    AppState.searchQuery = '';

    // Update vault name in sidebar
    const vaultNameEl = document.querySelector('.vault-name');
    if (vaultNameEl) {
      const savedName = data.settings?.vaultName;
      if (savedName) {
        vaultNameEl.textContent = savedName;
      } else {
        // Fallback: derive name from vault folder path
        try {
          const folder = await kb.vault.getVaultFolder();
          if (folder) {
            const parts = folder.replace(/\\/g, '/').split('/').filter(Boolean);
            vaultNameEl.textContent = parts[parts.length - 1] || 'My Vault';
          } else {
            vaultNameEl.textContent = 'My Vault';
          }
        } catch {
          vaultNameEl.textContent = 'My Vault';
        }
      }
    }

    this._initSidebar();
    this._renderFolders();
    this._renderItems();
    this._initLock();
    this._initAddMenu();
    this._initSearch();
    this._initSort();
    this._updateCounts();

    // Write sync file for extension
    kb.sync.writeSyncFile().catch(() => {});

    // Start auto-lock timer based on vault settings
    const autoLockMins = data.settings?.autoLock ?? 5;
    if (window.App?.AutoLock) window.App.AutoLock.start(autoLockMins);
  },

  _restoreVaultMain() {
    const main = document.getElementById('vault-main');
    if (!main) return;
    main.innerHTML = `
      <!-- Items list panel -->
      <div id="items-panel">
        <div class="items-header">
          <h2 id="items-heading">All Items</h2>
          <div class="items-header-actions">
            <button class="btn btn-sm btn-outline" id="btn-sort">⇅ Sort</button>
            <div class="add-dropdown">
              <button class="btn btn-primary btn-sm" id="btn-add-item">+ Add Item</button>
              <div class="add-menu" id="add-menu">
                <button class="add-menu-item" data-type="login">🔑 Login</button>
                <button class="add-menu-item" data-type="website">🌐 Website/Hosting</button>
                <button class="add-menu-item" data-type="card">💳 Credit Card</button>
                <button class="add-menu-item" data-type="identity">🪪 Identity</button>
                <button class="add-menu-item" data-type="note">📝 Secure Note</button>
                <button class="add-menu-item" data-type="passkey">🗝 Passkey</button>
              </div>
            </div>
          </div>
        </div>
        <div id="items-list"></div>
        <div id="empty-state" class="empty-state" style="display:none">
          <div class="empty-icon">🔐</div>
          <h3>No items yet</h3>
          <p>Add your first item to get started</p>
        </div>
      </div>

      <!-- Item detail panel -->
      <div id="detail-panel" class="detail-panel">
        <div id="detail-placeholder" class="detail-placeholder">
          <div class="dp-icon">🔐</div>
          <p>Select an item to view details</p>
        </div>
        <div id="detail-content" style="display:none;padding:24px;max-width:600px"></div>
      </div>
    `;
  },

  _initLock() {
    const { kb, Router, Toast } = window.App;
    const btn = document.getElementById('btn-lock');
    if (btn) btn.onclick = async () => {
      await kb.vault.lock();
      Toast.show('Vault locked', 'info');
      Router.show('page-welcome');
      WelcomePage.init();
    };
  },

  _initSearch() {
    const { AppState } = window.App;
    const inp = document.getElementById('global-search');
    if (inp) inp.oninput = (e) => {
      AppState.searchQuery = e.target.value.toLowerCase();
      this._renderItems();
    };
  },

  _initSort() {
    const { AppState, CtxMenu } = window.App;
    const btn = document.getElementById('btn-sort');
    if (btn) btn.onclick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      CtxMenu.show(rect.left, rect.bottom + 6, [
        { label: 'Name A→Z',      icon: '🔤', action: () => { AppState.sortBy = 'name';    this._renderItems(); } },
        { label: 'Recently Used', icon: '🕐', action: () => { AppState.sortBy = 'updated'; this._renderItems(); } },
        { label: 'Date Created',  icon: '📅', action: () => { AppState.sortBy = 'created'; this._renderItems(); } },
        { label: 'Type',          icon: '📁', action: () => { AppState.sortBy = 'type';    this._renderItems(); } },
      ]);
    };
  },

  _initSidebar() {
    const { AppState } = window.App;

    // Category hide/show toggle
    const HIDDEN_KEY = 'kb_hidden_categories';
    const hiddenCats = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
    let editMode = false;

    const applyHidden = () => {
      document.querySelectorAll('.nav-item[data-category]').forEach(btn => {
        const cat = btn.dataset.category;
        if (hiddenCats.has(cat)) {
          btn.style.display = editMode ? 'flex' : 'none';
          btn.style.opacity = editMode ? '0.4' : '';
        } else {
          btn.style.display = 'flex';
          btn.style.opacity = '';
        }
        const hideBtn = btn.querySelector('.cat-hide-btn');
        if (hideBtn) hideBtn.style.display = editMode ? 'inline' : 'none';
      });
    };

    applyHidden();

    const toggleBtn = document.getElementById('btn-toggle-categories');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        editMode = !editMode;
        toggleBtn.textContent = editMode ? '✓' : '👁';
        toggleBtn.title = editMode ? 'Done' : 'Show/hide categories';
        applyHidden();
      };
    }

    document.querySelectorAll('.cat-hide-btn').forEach(hideBtn => {
      hideBtn.onclick = (e) => {
        e.stopPropagation();
        const navItem = hideBtn.closest('.nav-item[data-category]');
        if (!navItem) return;
        const cat = navItem.dataset.category;
        if (hiddenCats.has(cat)) {
          hiddenCats.delete(cat);
        } else {
          hiddenCats.add(cat);
        }
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenCats]));
        applyHidden();
      };
    });

    // Category filters
    document.querySelectorAll('.nav-item[data-filter]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.nav-item, .folder-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.currentFilter = btn.dataset.filter;
        AppState.currentFolder = null;
        AppState.searchQuery = '';
        AppState.selectedItem = null;
        const inp = document.getElementById('global-search');
        if (inp) inp.value = '';

        const labels = {
          all: 'All Items', login: 'Logins', card: 'Credit Cards',
          identity: 'Identities', note: 'Secure Notes', passkey: 'Passkeys',
          favorite: 'Favorites', breach: 'Breach Alerts', trash: 'Trash',
        };
        const h = document.getElementById('items-heading');
        if (h) h.textContent = labels[btn.dataset.filter] || 'Items';

        // Make sure vault main is shown (in case we're on a tool page)
        this._ensureVaultMainVisible();

        // Clear detail panel
        const placeholder = document.getElementById('detail-placeholder');
        const content = document.getElementById('detail-content');
        if (placeholder) placeholder.style.display = 'flex';
        if (content) content.style.display = 'none';

        if (btn.dataset.filter === 'trash') {
          this._renderTrash();
        } else {
          this._renderItems();
        }
      };
    });

    // Tool nav
    const navGen  = document.getElementById('nav-generator');
    const navSync = document.getElementById('nav-sync');
    const navSets = document.getElementById('nav-settings');
    const navRenewals = document.getElementById('nav-renewals');
    const addFld  = document.getElementById('btn-add-folder');

    if (navGen)  navGen.onclick  = () => GeneratorPage.show();
    if (navSync) navSync.onclick = () => SyncPage.show();
    if (navSets) navSets.onclick = () => SettingsPage.show();
    if (navRenewals) navRenewals.onclick = () => this._showRenewals();
    if (addFld)  addFld.onclick  = () => this._showAddFolderModal();
  },

  // Ensure we're on the vault page with main content visible
  _ensureVaultMainVisible() {
    const main = document.getElementById('vault-main');
    if (!main) return;
    // If main was replaced by a tool page, restore it
    if (!document.getElementById('items-panel')) {
      this._restoreVaultMain();
      this._initAddMenu();
      this._initSort();
    }
  },

  _initAddMenu() {
    const btn  = document.getElementById('btn-add-item');
    const menu = document.getElementById('add-menu');
    if (!btn || !menu) return;

    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', () => menu.classList.remove('open'));

    document.querySelectorAll('.add-menu-item').forEach(item => {
      item.onclick = () => {
        menu.classList.remove('open');
        ItemForm.showAdd(item.dataset.type);
      };
    });
  },

  _updateCounts() {
    const { AppState, kb } = window.App;
    const items = AppState.items;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('count-all',      items.length);
    set('count-login',    items.filter(i => i.type === 'login').length);
    set('count-card',     items.filter(i => i.type === 'card').length);
    set('count-identity', items.filter(i => i.type === 'identity').length);
    set('count-note',     items.filter(i => i.type === 'note').length);
    set('count-passkey',  items.filter(i => i.type === 'passkey').length);
    set('count-fav',      items.filter(i => i.favorite).length);
    set('count-breach',   AppState.breachItems.size);
    // Trash count (async)
    window.App.kb.trash.getAll().then(trash => {
      set('count-trash', trash.length);
    }).catch(() => {});
    // Renewals due within 14 days (async)
    kb.vault.getUpcomingRenewals(14).then(renewals => {
      const badge = document.getElementById('count-renewals');
      if (!badge) return;
      if (renewals.length > 0) {
        badge.textContent = renewals.length;
        badge.style.display = '';
        badge.classList.add('breach');
      } else {
        badge.style.display = 'none';
      }
    }).catch(() => {});
  },

  async _renderTrash() {
    const { kb, Toast, Modal } = window.App;
    const list  = document.getElementById('items-list');
    const empty = document.getElementById('empty-state');
    if (!list) return;

    const trashItems = await kb.trash.getAll();
    list.innerHTML = '';

    // Inject empty trash button into header area
    const heading = document.getElementById('items-heading');
    if (heading) {
      const existing = document.getElementById('btn-empty-trash');
      if (!existing && trashItems.length > 0) {
        const emptyBtn = document.createElement('button');
        emptyBtn.id = 'btn-empty-trash';
        emptyBtn.className = 'btn btn-sm btn-danger';
        emptyBtn.textContent = '🗑 Empty Trash';
        emptyBtn.style.marginLeft = '12px';
        emptyBtn.onclick = () => this._confirmEmptyTrash();
        heading.insertAdjacentElement('afterend', emptyBtn);
      } else if (existing && trashItems.length === 0) {
        existing.remove();
      }
    }

    if (trashItems.length === 0) {
      if (empty) { empty.style.display = 'flex'; empty.querySelector('h3').textContent = 'Trash is empty'; empty.querySelector('p').textContent = 'Deleted items will appear here'; }
      return;
    }
    if (empty) empty.style.display = 'none';

    const trashDays = 30; // default, shown in subtitle

    trashItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'item-card';
      const emoji = typeEmoji(item.type);
      const deletedDate = item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : '?';
      card.innerHTML = `
        <div class="item-favicon">${emoji}</div>
        <div class="item-info">
          <div class="item-name">${escHtml(item.name || 'Untitled')}</div>
          <div class="item-sub" style="color:var(--danger)">Deleted ${deletedDate}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn btn-sm btn-outline trash-restore-btn" data-id="${item.id}" title="Restore">↩ Restore</button>
          <button class="btn btn-sm btn-danger trash-del-btn" data-id="${item.id}" title="Delete forever">✕</button>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.trash-restore-btn').forEach(btn => {
      btn.onclick = async () => {
        const r = await kb.trash.restore(btn.dataset.id);
        if (r.success) {
          window.App.AppState.items = await kb.items.getAll();
          Toast.show('Item restored', 'success');
          this._updateCounts();
          this._renderTrash();
        }
      };
    });

    list.querySelectorAll('.trash-del-btn').forEach(btn => {
      btn.onclick = async () => {
        const r = await kb.trash.deleteForever(btn.dataset.id);
        if (r.success) {
          Toast.show('Permanently deleted', 'info');
          this._updateCounts();
          this._renderTrash();
        }
      };
    });
  },

  async _confirmEmptyTrash() {
    const { Modal, Toast, kb } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>Empty Trash?</h3>
        <button class="modal-close" id="et-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:20px">All items in the trash will be permanently deleted. This cannot be undone.</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" id="et-cancel">Cancel</button>
        <button class="btn btn-danger" id="et-confirm">Empty Trash</button>
      </div>
    `);
    document.getElementById('et-close').onclick = () => Modal.close();
    document.getElementById('et-cancel').onclick = () => Modal.close();
    document.getElementById('et-confirm').onclick = async () => {
      await kb.trash.empty();
      Toast.show('Trash emptied', 'info');
      this._updateCounts();
      this._renderTrash();
      Modal.close();
    };
  },

  _renderFolders() {
    const { AppState, CtxMenu } = window.App;
    const list = document.getElementById('folder-list');
    if (!list) return;
    list.innerHTML = '';

    // Build a parent -> children map so nested "client / category" folders
    // render as a real tree instead of a flat list.
    const byParent = new Map();
    AppState.folders.forEach(f => {
      const key = f.parentId || null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(f);
    });

    // Count items in a folder AND all its descendants, so a client folder's
    // badge reflects everything nested under it.
    const descendantIds = (folderId) => {
      const ids = [folderId];
      (byParent.get(folderId) || []).forEach(child => ids.push(...descendantIds(child.id)));
      return ids;
    };

    const COLLAPSE_KEY = 'kb_collapsed_folders';
    const collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));

    const renderLevel = (parentId, depth) => {
      const children = byParent.get(parentId) || [];
      children.forEach(folder => {
        const hasChildren = (byParent.get(folder.id) || []).length > 0;
        const isCollapsed = collapsed.has(folder.id);
        const allIds = new Set(descendantIds(folder.id));
        const count = AppState.items.filter(i => i.folderId && allIds.has(i.folderId)).length;

        const btn = document.createElement('button');
        btn.className = 'folder-nav-item';
        btn.dataset.folderId = folder.id;
        btn.style.paddingLeft = (14 + depth * 16) + 'px';
        btn.innerHTML = `
          ${hasChildren ? `<span class="folder-twisty" data-toggle="${folder.id}">${isCollapsed ? '›' : '⌄'}</span>` : '<span class="folder-twisty-spacer"></span>'}
          <span class="folder-dot" style="background:${folder.color || '#6366f1'}"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(folder.name)}</span>
          <span class="ni-count">${count}</span>
        `;

        btn.onclick = (e) => {
          if (e.target.closest('.folder-twisty')) return; // handled separately below
          document.querySelectorAll('.nav-item,.folder-nav-item').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const { AppState } = window.App;
          AppState.currentFilter = 'folder';
          AppState.currentFolder = folder.id;
          AppState.currentFolderDescendants = [...allIds]; // used by _filterItems
          AppState.selectedItem = null;
          const h = document.getElementById('items-heading');
          if (h) h.textContent = folder.name;
          this._ensureVaultMainVisible();

          const placeholder = document.getElementById('detail-placeholder');
          const content = document.getElementById('detail-content');
          if (placeholder) placeholder.style.display = 'flex';
          if (content) content.style.display = 'none';

          this._renderItems();
        };

        const twisty = btn.querySelector('.folder-twisty');
        if (twisty) {
          twisty.onclick = (e) => {
            e.stopPropagation();
            if (collapsed.has(folder.id)) collapsed.delete(folder.id);
            else collapsed.add(folder.id);
            localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
            this._renderFolders();
          };
        }

        btn.oncontextmenu = (e) => {
          e.preventDefault();
          const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#64748b'];
          CtxMenu.show(e.clientX, e.clientY, [
            { label: 'Add Subfolder', icon: '📂', action: () => this._showAddFolderModal(folder.id) },
            { label: 'Rename',        icon: '✏️',  action: () => this._renameFolder(folder) },
            { colors: COLORS, current: folder.color, label: 'Color', oncolor: (c) => this._colorFolder(folder, c) },
            { sep: true },
            { label: 'Export This Client…', icon: '⬇',  action: () => this._exportFolder(folder) },
            { sep: true },
            { label: 'Delete Folder', icon: '🗑',  danger: true, action: () => this._deleteFolder(folder) },
          ]);
        };

        btn.ondragover = (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          btn.classList.add('drag-over');
        };
        btn.ondragleave = () => btn.classList.remove('drag-over');
        btn.ondrop = async (e) => {
          e.preventDefault();
          btn.classList.remove('drag-over');
          const itemId = e.dataTransfer.getData('text/plain');
          if (!itemId) return;
          const { kb, AppState, Toast } = window.App;
          await kb.items.moveToFolder(itemId, folder.id);
          AppState.items = await kb.items.getAll();
          this._renderItems();
          this._renderFolders();
          this._updateCounts();
          Toast.show(`Moved to "${folder.name}"`, 'success');
        };

        list.appendChild(btn);
        if (hasChildren && !isCollapsed) renderLevel(folder.id, depth + 1);
      });
    };

    renderLevel(null, 0);
  },

  _filterItems() {
    const { AppState } = window.App;
    let items = [...AppState.items];

    if (AppState.searchQuery) {
      const q = AppState.searchQuery;
      items = items.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.username || '').toLowerCase().includes(q) ||
        (i.url || '').toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q)
      );

      // Prefix-first ranking: items whose NAME starts with the query surface
      // first, then items whose name matches elsewhere, then items that only
      // matched in username/url/notes. Typing "w" should surface an item
      // actually titled "Website" before some unrelated item that merely
      // mentions "www" in its URL — this overrides the Sort dropdown while
      // actively searching, since relevance matters more than sort order here.
      const rank = (item) => {
        const name = (item.name || '').toLowerCase();
        if (name.startsWith(q)) return 0;
        if (name.includes(q)) return 1;
        return 2;
      };
      items.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        return (a.name || '').localeCompare(b.name || '');
      });
      return items;
    }

    if (AppState.currentFilter === 'folder') {
      const scope = AppState.currentFolderDescendants || [AppState.currentFolder];
      items = items.filter(i => i.folderId && scope.includes(i.folderId));
    } else if (AppState.currentFilter === 'favorite') {
      items = items.filter(i => i.favorite);
    } else if (AppState.currentFilter === 'breach') {
      items = items.filter(i => AppState.breachItems.has(i.id));
    } else if (AppState.currentFilter !== 'all') {
      items = items.filter(i => i.type === AppState.currentFilter);
    }

    items.sort((a, b) => {
      if (AppState.sortBy === 'name')    return (a.name || '').localeCompare(b.name || '');
      if (AppState.sortBy === 'updated') return new Date(b.updatedAt) - new Date(a.updatedAt);
      if (AppState.sortBy === 'created') return new Date(b.createdAt) - new Date(a.createdAt);
      if (AppState.sortBy === 'type')    return (a.type || '').localeCompare(b.type || '');
      return 0;
    });

    return items;
  },

  async _renderTrash() {
    const { kb, Toast } = window.App;
    const list  = document.getElementById('items-list');
    const empty = document.getElementById('empty-state');
    if (!list) return;

    let trashItems = [];
    try { trashItems = await kb.trash.getAll(); } catch { trashItems = []; }

    list.innerHTML = '';
    if (empty) empty.style.display = 'none';

    if (trashItems.length === 0) {
      list.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--text-muted)">
          <div style="font-size:40px;margin-bottom:12px">🗑</div>
          <div>Trash is empty</div>
          <div style="font-size:12px;margin-top:6px">Deleted items appear here before permanent removal</div>
        </div>`;
      return;
    }

    // Empty all button
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);margin-bottom:4px';
    headerDiv.innerHTML = `
      <span style="font-size:12px;color:var(--text-muted)">${trashItems.length} item${trashItems.length !== 1 ? 's' : ''} in trash</span>
      <button class="btn btn-sm btn-danger" id="empty-trash-btn">Empty Trash</button>
    `;
    list.appendChild(headerDiv);
    document.getElementById('empty-trash-btn').onclick = async () => {
      if (!confirm('Permanently delete all items in trash?')) return;
      await kb.trash.empty();
      Toast.show('Trash emptied', 'info');
      this._renderTrash();
      this._updateCounts();
    };

    const settings = (await kb.vault.getData())?.settings || {};
    const trashDays = settings.trashDays ?? 30;

    trashItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'item-card';
      const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
      const daysLeft = deletedAt && trashDays > 0
        ? Math.max(0, trashDays - Math.floor((Date.now() - deletedAt.getTime()) / 86400000))
        : null;
      const emoji = typeEmoji(item.type);
      card.innerHTML = `
        <div class="item-favicon">${emoji}</div>
        <div class="item-info">
          <div class="item-name">${escHtml(item.name || 'Untitled')}</div>
          <div class="item-sub" style="color:var(--danger);font-size:11px">
            ${daysLeft !== null ? `Deletes in ${daysLeft}d` : 'Pending deletion'}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="btn btn-sm btn-outline trash-restore-btn" data-id="${item.id}" title="Restore">↩ Restore</button>
          <button class="btn btn-sm btn-danger trash-del-btn" data-id="${item.id}" title="Delete forever">✕</button>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.trash-restore-btn').forEach(btn => {
      btn.onclick = async () => {
        await kb.trash.restore(btn.dataset.id);
        const { AppState } = window.App;
        AppState.items = await kb.items.getAll();
        Toast.show('Item restored', 'success');
        this._renderTrash();
        this._renderItems();
        this._updateCounts();
      };
    });

    list.querySelectorAll('.trash-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Permanently delete this item? This cannot be undone.')) return;
        await kb.trash.deleteForever(btn.dataset.id);
        Toast.show('Item permanently deleted', 'info');
        this._renderTrash();
        this._updateCounts();
      };
    });
  },

  _renderItems() {
    const { AppState } = window.App;
    const list  = document.getElementById('items-list');
    const empty = document.getElementById('empty-state');
    if (!list) return;

    const items = this._filterItems();
    list.innerHTML = '';

    if (items.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = `item-card${AppState.selectedItem?.id === item.id ? ' selected' : ''}${AppState.breachItems.has(item.id) ? ' breached' : ''}`;
      card.dataset.itemId = item.id;

      const faviconUrl = (item.type === 'login' && item.url) ? getFaviconUrl(item.url) : null;
      const emoji = typeEmoji(item.type);

      let subtitle = '';
      if (item.type === 'login')    subtitle = item.username || item.url || '';
      if (item.type === 'card')     subtitle = item.cardNumber ? '•••• ' + item.cardNumber.slice(-4) : '';
      if (item.type === 'identity') subtitle = [item.firstName, item.lastName].filter(Boolean).join(' ');
      if (item.type === 'note')     subtitle = (item.notes || '').slice(0, 40);
      if (item.type === 'passkey')  subtitle = item.rpId || item.url || '';

      card.innerHTML = `
        <div class="item-favicon">
          ${faviconUrl ? `<img src="${faviconUrl}" data-fallback-emoji="true" alt="" />` : emoji}
        </div>
        <div class="item-info">
          <div class="item-name">${escHtml(item.name || 'Untitled')}</div>
          <div class="item-sub">${escHtml(subtitle)}</div>
        </div>
        <span class="item-fav${item.favorite ? ' active' : ''}">⭐</span>
      `;

      card.draggable = true;
      card.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      };
      card.ondragend = () => card.classList.remove('dragging');

      card.onclick = () => {
        document.querySelectorAll('.item-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        AppState.selectedItem = item;
        this._showDetail(item);
      };

      list.appendChild(card);
    });
  },

  _showDetail(item) {
    const { kb, copyToClipboard, Toast, AppState } = window.App;

    // Paste-screenshot: Ctrl/Cmd+V while an item is open attaches whatever
    // image is on the clipboard directly to it. Registered once (not per-item)
    // to avoid stacking listeners every time a new item is opened; reads
    // AppState.selectedItem fresh each time it fires instead.
    if (!VaultPage._pasteListenerBound) {
      VaultPage._pasteListenerBound = true;
      document.addEventListener('keydown', async (e) => {
        const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
        if (!isPaste) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable) return; // let normal text paste happen
        const { AppState, kb, Toast } = window.App;
        const current = AppState.selectedItem;
        const contentEl = document.getElementById('detail-content');
        if (!current || !contentEl || contentEl.style.display === 'none') return;
        let hasImg = false;
        try { hasImg = await kb.clipboard.hasImage(); } catch { }
        if (!hasImg) return;
        const r = await kb.attachments.pasteImage(current.id);
        if (r.success) {
          Toast.show('Screenshot attached', 'success');
          AppState.items = await kb.items.getAll();
          const updated = AppState.items.find(i => i.id === current.id) || current;
          VaultPage._showDetail(updated);
        } else {
          Toast.show('Could not paste image: ' + (r.error || 'unknown'), 'error');
        }
      });
    }

    const placeholder = document.getElementById('detail-placeholder');
    const content = document.getElementById('detail-content');
    if (!content) return;

    if (placeholder) placeholder.style.display = 'none';
    content.style.display = 'block';

    const faviconUrl = (item.type === 'login' && item.url) ? getFaviconUrl(item.url) : null;
    const emoji = typeEmoji(item.type);

    let fieldsHtml = '';
    if (item.type === 'login')    fieldsHtml = this._loginFields(item);
    if (item.type === 'card')     fieldsHtml = this._cardFields(item);
    if (item.type === 'identity') fieldsHtml = this._identityFields(item);
    if (item.type === 'note')     fieldsHtml = this._noteFields(item);
    if (item.type === 'passkey')  fieldsHtml = this._passkeyFields(item);
    if (item.type === 'website')  fieldsHtml = this._websiteFields(item);

    // Append custom fields if any
    if (item.customFields && item.customFields.length > 0) {
      fieldsHtml += item.customFields.map(cf => {
        if (!cf.label && !cf.value) return '';
        return field(
          escHtml(cf.label || 'Custom'),
          cf.hidden ? '••••••••' : escHtml(cf.value || '—'),
          { copy: cf.hidden ? null : null, masked: !!cf.hidden }
        );
      }).join('');
    }

    content.innerHTML = `
      <div class="detail-view detail-enter">
        <div class="detail-top">
          <div class="detail-icon">
            ${faviconUrl ? `<img src="${faviconUrl}" style="width:32px;height:32px;object-fit:contain" data-fallback-emoji="true" alt="" />` : emoji}
          </div>
          <div class="detail-title-wrap">
            <div class="detail-name">${escHtml(item.name || 'Untitled')}</div>
            <span class="detail-type-badge">${item.type}</span>
            <div class="detail-actions">
              <button class="btn btn-sm btn-outline" id="det-edit">✏️ Edit</button>
              <button class="btn btn-sm btn-ghost" id="det-fav">${item.favorite ? '⭐ Unfavorite' : '☆ Favorite'}</button>
              <button class="btn btn-sm btn-danger" id="det-del">🗑 Delete</button>
            </div>
          </div>
        </div>
        <div class="detail-fields">${fieldsHtml}</div>
        ${this._attachmentSection(item)}
      </div>
    `;

    // Wire favicon fallback safely (no inline onerror)
    content.querySelectorAll('img[data-fallback-emoji]').forEach(img => {
      img.onerror = () => { img.parentElement.textContent = typeEmoji(item.type); };
    });

    // Wire buttons
    document.getElementById('det-edit').onclick = () => ItemForm.showEdit(item);
    document.getElementById('det-fav').onclick = async () => {
      const updated = { favorite: !item.favorite };
      await kb.items.update(item.id, updated);
      item.favorite = !item.favorite;
      AppState.items = await kb.items.getAll();
      this._renderItems();
      this._showDetail(item);
    };
    document.getElementById('det-del').onclick = () => this._confirmDelete(item);

    // Wire copy buttons
    content.querySelectorAll('[data-copy]').forEach(btn => {
      btn.onclick = () => {
        const fieldKey = btn.dataset.copy;
        const val = item[fieldKey] || '';
        if (val) copyToClipboard(val, btn.dataset.label || fieldKey);
      };
    });

    // Wire URL open
    content.querySelectorAll('[data-open-url]').forEach(btn => {
      btn.onclick = () => kb.shell.openExternal(item.url);
    });
    content.querySelectorAll('[data-open-url-alt]').forEach(el => {
      el.onclick = (e) => { e.preventDefault(); kb.shell.openExternal(el.dataset.openUrlAlt); };
    });

    // Wire social account URLs and password copies
    content.querySelectorAll('[data-social-url]').forEach(el => {
      el.onclick = () => kb.shell.openExternal(el.dataset.socialUrl);
    });
    content.querySelectorAll('[data-social-copy-pw]').forEach(btn => {
      btn.onclick = () => copyToClipboard(btn.dataset.socialCopyPw, 'Password');
    });

    // Wire TOTP
    if (item.totp) {
      this._startTOTP(item);
      const totpCopyBtn = document.getElementById(`totp-copy-${item.id}`);
      if (totpCopyBtn) {
        totpCopyBtn.onclick = async () => {
          try {
            const { token } = await kb.twofa.generateTOTP(item.totp);
            copyToClipboard(token, 'TOTP code');
          } catch { Toast.show('Could not read TOTP code', 'error'); }
        };
      }
    }

    // Wire eye toggle for masked fields (data-eye-target approach - reliable post-innerHTML)
    content.querySelectorAll('.eye-toggle-btn').forEach(btn => {
      const targetId = btn.dataset.eyeTarget;
      if (!targetId) return;
      btn.onclick = (e) => {
        e.stopPropagation();
        const el = document.getElementById(targetId);
        if (!el) return;
        el.classList.toggle('field-masked');
        btn.textContent = el.classList.contains('field-masked') ? '👁' : '🙈';
      };
    });

    // Wire card preview interactivity (fixes eye icon bug from script tag approach)
    if (item.type === 'card') {
      const cardPreview = content.querySelector('[id^="card-preview-"]');
      if (cardPreview) {
        const cardNumId = cardPreview.id.replace('card-preview-', '');
        this._wireCardPreview(item, cardNumId);
      }
    }

    // Load and render attachments in preview panel
    this._loadAttachmentsInPreview(item);

    // Wire add attachment
    const addAttBtn = document.getElementById('det-add-att');
    if (addAttBtn) {
      addAttBtn.onclick = async () => {
        const fp = await kb.attachments.pickFile();
        if (!fp) return;
        const r = await kb.attachments.add(item.id, fp);
        if (r.success) {
          Toast.show('Attachment added', 'success');
          AppState.items = await kb.items.getAll();
          const updated = AppState.items.find(i => i.id === item.id) || item;
          this._showDetail(updated);
        } else {
          Toast.show('Failed to add attachment: ' + r.error, 'error');
        }
      };
    }
  },

  async _loadAttachmentsInPreview(item) {
    const { kb, Toast } = window.App;
    const attList = document.getElementById('att-list');
    if (!attList) return;

    try {
      const data = await kb.vault.getData();
      const atts = (data?.attachments || {})[item.id] || {};
      const entries = Object.values(atts);

      if (entries.length === 0) {
        attList.innerHTML = '<span style="color:var(--text-muted);font-size:13px">No attachments</span>';
        return;
      }

      attList.innerHTML = entries.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:13px">📎 ${escHtml(a.name)}</span>
          <span style="font-size:11px;color:var(--text-muted)">${(a.size/1024).toFixed(1)} KB</span>
          <button class="btn btn-sm btn-ghost att-export-btn" data-att-id="${a.id}" title="Export">↓</button>
        </div>
      `).join('');

      attList.querySelectorAll('.att-export-btn').forEach(btn => {
        btn.onclick = () => kb.attachments.export(item.id, btn.dataset.attId);
      });
    } catch (e) {
      attList.innerHTML = '<span style="color:var(--text-muted);font-size:13px">No attachments</span>';
    }
  },

  _loginFields(item) {
    return `
      ${field('Username', escHtml(item.username || '—'), { copy: 'username', label: 'Username' })}
      ${field('Password', item.password ? escHtml(item.password) : '—', { copy: 'password', label: 'Password', mono: true, masked: !!item.password })}
      ${item.url ? field('URL', `<a href="#" data-open-url style="color:var(--accent)">${escHtml(item.url)}</a>`, { copy: 'url', label: 'URL' }) : ''}
      ${item.totp ? totpField(item.id) : ''}
      ${item.notes ? field('Notes', `<span style="white-space:pre-wrap">${escHtml(item.notes)}</span>`, {}) : ''}
    `;
  },

  _cardFields(item) {
    const raw = item.cardNumber || '';
    const digits = raw.replace(/\D/g, '');
    const groups = digits.replace(/(.{4})/g, '$1 ').trim().split(' ');
    while (groups.length < 4) groups.push('••••');

    const expDisplay = `${item.expMonth || '--'}/${(item.expYear || '----').slice(-2)}`;
    const cardNumId = `cn-${Math.random().toString(36).slice(2,8)}`;

    const previewGroups = groups.map((g, i) =>
      i < 3
        ? `<span class="cn-group cn-blurred" data-plain="${escHtml(g)}">${escHtml(g)}</span>`
        : `<span class="cn-group">${escHtml(g)}</span>`
    ).join('<span class="cn-sep"> </span>');

    return `
      <div class="card-preview" id="card-preview-${cardNumId}">
        <div class="card-preview-top">
          <div class="card-brand">${escHtml(item.cardType || 'Card')}</div>
          <button class="card-reveal-btn" id="cp-reveal-${cardNumId}" title="Reveal/hide card number">👁</button>
        </div>
        <div class="card-number card-number-blurred" id="cp-num-${cardNumId}">${previewGroups}</div>
        <div class="card-bottom">
          <div>
            <div class="card-field-label">Card Holder</div>
            <div class="card-holder">${escHtml(item.cardHolder || '—')}</div>
          </div>
          <div>
            <div class="card-field-label">Expires</div>
            <div class="card-exp">${escHtml(expDisplay)}</div>
          </div>
        </div>
      </div>
      <p class="card-copy-note">💡 Click any field below to copy it to clipboard.</p>
      ${digits ? field('Card Number', digits ? '•••• •••• •••• ' + digits.slice(-4) : '—', { copy: 'cardNumber', label: 'Card number', mono: true, masked: !!digits }) : ''}
      ${item.cardHolder ? field('Cardholder', escHtml(item.cardHolder), { copy: 'cardHolder', label: 'Cardholder name' }) : ''}
      ${field('Expiry', escHtml(expDisplay), {})}
      ${item.cvv ? field('CVV', escHtml(item.cvv), { copy: 'cvv', label: 'CVV', masked: true }) : ''}
      ${item.pin ? field('PIN', escHtml(item.pin), { copy: 'pin', label: 'PIN', masked: true }) : ''}
      ${item.notes ? field('Notes', escHtml(item.notes), {}) : ''}
    `;
  },

  _wireCardPreview(item, cardNumId) {
    const revealBtn = document.getElementById(`cp-reveal-${cardNumId}`);
    const numContainer = document.getElementById(`cp-num-${cardNumId}`);
    if (revealBtn && numContainer) {
      let revealed = false;
      revealBtn.onclick = (e) => {
        e.stopPropagation();
        revealed = !revealed;
        numContainer.querySelectorAll('.cn-blurred').forEach(el => {
          el.style.filter = revealed ? 'none' : '';
          el.style.userSelect = revealed ? 'text' : 'none';
        });
        revealBtn.textContent = revealed ? '🙈' : '👁';
      };
    }
  },

  _identityFields(item) {
    const basicRows = [
      ['Full Name',  [item.firstName, item.lastName].filter(Boolean).join(' ')],
      ['Username',   item.username],
      ['Email',      item.email],
      ['Phone',      item.phone],
      ['WhatsApp',   item.whatsapp],
      ['Company',    item.company],
      ['Job Title',  item.jobTitle],
    ].filter(([, v]) => v);

    const addressParts = [item.address1, item.address2, item.city, item.state, item.zip, item.country].filter(Boolean);
    const govRows = [
      ['SSN / ID',   item.ssn ? '•••-••-' + (item.ssn.slice(-4) || '????') : ''],
      ['Passport',   item.passport],
      ['License',    item.license],
    ].filter(([, v]) => v);

    let html = basicRows.map(([l, v]) => field(l, escHtml(v || ''), {})).join('');

    if (addressParts.length) {
      html += field('Address', escHtml(addressParts.join(', ')), {});
    }
    html += govRows.map(([l, v]) => field(l, escHtml(v || ''), {})).join('');

    // Social accounts
    if (item.socialAccounts && item.socialAccounts.length > 0) {
      html += `<div class="detail-field" style="margin-top:4px">
        <div class="df-label">Social Accounts</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
          ${item.socialAccounts.map(s => `
            <div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface)">
              <div style="font-size:13px;font-weight:600;margin-bottom:4px">${escHtml(s.title || 'Account')}</div>
              ${s.username ? `<div style="font-size:12px;color:var(--text-muted)">👤 ${escHtml(s.username)}</div>` : ''}
              ${s.url ? `<div style="font-size:12px;color:var(--accent);cursor:pointer" data-social-url="${escHtml(s.url)}">🔗 ${escHtml(s.url)}</div>` : ''}
              ${s.password ? `<div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-top:4px">
                <span>🔑 ••••••••</span>
                <button class="btn btn-sm btn-ghost" style="padding:1px 6px;font-size:11px" data-social-copy-pw="${escHtml(s.password)}">Copy</button>
              </div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
    }

    if (item.notes) html += field('Notes', escHtml(item.notes), {});
    return html;
  },

  _noteFields(item) {
    return `
      <div class="detail-field">
        <div class="df-label">Secure Note</div>
        <div class="df-value" style="white-space:pre-wrap;user-select:text">${escHtml(item.notes || '')}</div>
      </div>
    `;
  },

  _passkeyFields(item) {
    return `
      ${field('Relying Party', escHtml(item.rpId || item.url || '—'), {})}
      ${field('Username', escHtml(item.username || '—'), {})}
      ${field('Credential ID', item.credentialId ? escHtml(item.credentialId.slice(0, 24) + '…') : '—', {})}
      ${item.notes ? field('Notes', escHtml(item.notes), {}) : ''}
    `;
  },

  _websiteFields(item) {
    const daysLeft = item.renewalDate ? Math.ceil((new Date(item.renewalDate).getTime() - Date.now()) / 86400000) : null;
    let html = '';
    if (item.url) html += field('Site URL', `<a href="#" data-open-url style="color:var(--accent)">${escHtml(item.url)}</a>`, { copy: 'url', label: 'URL', open: true });
    if (item.renewalDate) {
      const urgent = daysLeft !== null && daysLeft <= 14;
      html += `<div class="detail-field">
        <div class="df-label">Renewal / Expiry</div>
        <div class="df-value">
          <span>${escHtml(new Date(item.renewalDate).toLocaleDateString())}</span>
          ${daysLeft !== null ? `<span class="breach-badge" style="${urgent ? '' : 'background:var(--accent-dim);border-color:transparent;color:var(--accent)'}">${daysLeft < 0 ? 'Overdue' : daysLeft + 'd left'}</span>` : ''}
        </div>
      </div>`;
    }
    if (item.hostingProvider || item.hostingUsername || item.hostingPassword || item.hostingUrl) {
      html += `<div class="detail-field" style="margin-top:4px"><div class="df-label">Hosting Account</div></div>`;
      if (item.hostingProvider) html += field('Provider', escHtml(item.hostingProvider), {});
      if (item.hostingUrl) html += field('Control Panel', `<a href="#" data-open-url-alt="${escHtml(item.hostingUrl)}" style="color:var(--accent)">${escHtml(item.hostingUrl)}</a>`, {});
      if (item.hostingUsername) html += field('Username', escHtml(item.hostingUsername), { copy: 'hostingUsername', label: 'Hosting username' });
      if (item.hostingPassword) html += field('Password', escHtml(item.hostingPassword), { copy: 'hostingPassword', label: 'Hosting password', mono: true, masked: true });
    }
    if (item.domainRegistrar || item.registrarUsername || item.registrarPassword || item.nameservers) {
      html += `<div class="detail-field" style="margin-top:4px"><div class="df-label">Domain Registrar</div></div>`;
      if (item.domainRegistrar) html += field('Registrar', escHtml(item.domainRegistrar), {});
      if (item.nameservers) html += field('Nameservers', escHtml(item.nameservers), {});
      if (item.registrarUsername) html += field('Username', escHtml(item.registrarUsername), { copy: 'registrarUsername', label: 'Registrar username' });
      if (item.registrarPassword) html += field('Password', escHtml(item.registrarPassword), { copy: 'registrarPassword', label: 'Registrar password', mono: true, masked: true });
    }
    if (item.cmsUrl || item.cmsUsername || item.cmsPassword) {
      html += `<div class="detail-field" style="margin-top:4px"><div class="df-label">CMS Admin</div></div>`;
      if (item.cmsUrl) html += field('Admin URL', `<a href="#" data-open-url-alt="${escHtml(item.cmsUrl)}" style="color:var(--accent)">${escHtml(item.cmsUrl)}</a>`, {});
      if (item.cmsUsername) html += field('Username', escHtml(item.cmsUsername), { copy: 'cmsUsername', label: 'CMS username' });
      if (item.cmsPassword) html += field('Password', escHtml(item.cmsPassword), { copy: 'cmsPassword', label: 'CMS password', mono: true, masked: true });
    }
    if (item.ftpHost || item.ftpUsername || item.ftpPassword) {
      html += `<div class="detail-field" style="margin-top:4px"><div class="df-label">FTP / SSH</div></div>`;
      if (item.ftpHost) html += field('Host', escHtml(item.ftpHost) + (item.ftpPort ? ':' + escHtml(item.ftpPort) : ''), {});
      if (item.ftpUsername) html += field('Username', escHtml(item.ftpUsername), { copy: 'ftpUsername', label: 'FTP username' });
      if (item.ftpPassword) html += field('Password', escHtml(item.ftpPassword), { copy: 'ftpPassword', label: 'FTP password', mono: true, masked: true });
    }
    if (item.notes) html += field('Notes', `<span style="white-space:pre-wrap">${escHtml(item.notes)}</span>`, {});
    return html;
  },

  _attachmentSection(item) {
    return `
      <div class="detail-field" style="margin-top:16px">
        <div class="df-label">Attachments</div>
        <div id="att-list" class="attach-list" style="margin-top:6px"></div>
        <button class="btn btn-sm btn-ghost" id="det-add-att" style="margin-top:8px">+ Add File</button>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">📸 Tip: copy a screenshot then press Ctrl+V here to attach it directly</div>
      </div>
    `;
  },

  _startTOTP(item) {
    if (this._totpIntervals[item.id]) clearInterval(this._totpIntervals[item.id]);
    const update = async () => {
      try {
        const { token, remaining } = await window.App.kb.twofa.generateTOTP(item.totp);
        const codeEl = document.getElementById(`totp-code-${item.id}`);
        const ringEl = document.getElementById(`totp-ring-${item.id}`);
        if (codeEl) codeEl.textContent = token.slice(0, 3) + ' ' + token.slice(3);
        if (ringEl) {
          const frac = remaining / 30;
          const circumference = 75.4;
          ringEl.style.strokeDashoffset = circumference * (1 - frac);
          ringEl.style.stroke = remaining <= 5 ? 'var(--danger)' : 'var(--accent)';
        }
      } catch {}
    };
    update();
    this._totpIntervals[item.id] = setInterval(update, 1000);
  },

  _confirmDelete(item) {
    const { Modal, Toast, kb, AppState } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>Move "${escHtml(item.name)}" to Trash?</h3>
        <button class="modal-close" id="del-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:20px">
        The item will be moved to Trash where you can restore or permanently delete it.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" id="del-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-del-btn">Move to Trash</button>
      </div>
    `);

    document.getElementById('del-modal-close').onclick = () => Modal.close();
    document.getElementById('del-cancel').onclick = () => Modal.close();

    document.getElementById('confirm-del-btn').onclick = async () => {
      await kb.items.delete(item.id);
      AppState.items = await kb.items.getAll();
      AppState.selectedItem = null;
      const placeholder = document.getElementById('detail-placeholder');
      const content = document.getElementById('detail-content');
      if (placeholder) placeholder.style.display = 'flex';
      if (content) content.style.display = 'none';
      this._renderItems();
      this._updateCounts();
      Modal.close();
      Toast.show('Moved to Trash', 'info');
    };
  },

  async _showAddFolderModal(parentId = null) {
    const { Modal, Toast, kb, AppState } = window.App;
    const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#64748b'];
    let selectedColor = COLORS[0];
    const parentFolder = parentId ? AppState.folders.find(f => f.id === parentId) : null;

    Modal.show(`
      <div class="modal-header">
        <h3>${parentFolder ? `New Subfolder in "${escHtml(parentFolder.name)}"` : 'New Folder'}</h3>
        <button class="modal-close" id="folder-modal-close">✕</button>
      </div>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="folder-name-inp" placeholder="${parentFolder ? 'e.g. Hosting, Social Media, Billing' : 'e.g. Client Name'}" />
      </div>
      <div class="form-group">
        <label>Color</label>
        <div class="color-swatches" id="folder-color-swatches">
          ${COLORS.map(c => `<div class="color-swatch${c === selectedColor ? ' selected' : ''}" style="background:${c}" data-color="${c}"></div>`).join('')}
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost" id="folder-cancel">Cancel</button>
        <button class="btn btn-primary" id="folder-save-btn">Create</button>
      </div>
    `);

    document.getElementById('folder-modal-close').onclick = () => Modal.close();
    document.getElementById('folder-cancel').onclick = () => Modal.close();
    document.getElementById('folder-name-inp').focus();

    document.querySelectorAll('#folder-color-swatches .color-swatch').forEach(sw => {
      sw.onclick = () => {
        document.querySelectorAll('#folder-color-swatches .color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        selectedColor = sw.dataset.color;
      };
    });

    document.getElementById('folder-save-btn').onclick = async () => {
      const name = document.getElementById('folder-name-inp').value.trim();
      if (!name) return;
      const btn = document.getElementById('folder-save-btn');
      btn.disabled = true;
      let result;
      try {
        result = await kb.folders.add({ name, color: selectedColor, parentId });
      } catch (err) {
        result = { error: err.message };
      }
      btn.disabled = false;
      if (!result || result.error) {
        Toast.show('Failed to create folder: ' + (result?.error || 'Unknown error'), 'error');
        return;
      }
      // folders:add doesn't push a vault:updated broadcast — refresh state
      // ourselves, the same way rename/color/delete already do.
      AppState.folders = await kb.folders.getAll();
      this._renderFolders();
      Modal.close();
      Toast.show(`Folder "${name}" created`, 'success');
    };

    document.getElementById('folder-name-inp').onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('folder-save-btn').click();
    };
  },

  async _exportFolder(folder) {
    const { kb, Toast } = window.App;
    Toast.show(`Preparing export for "${folder.name}"…`, 'info');
    const r = await kb.vault.exportData('json', folder.id);
    if (r.success) Toast.show(`Exported "${folder.name}" to ${r.path}`, 'success');
    else if (r.error !== 'CANCELLED') Toast.show('Export failed: ' + r.error, 'error');
  },

  // ── Renewals dashboard ─────────────────────────────────────────────────────
  // Domains, hosting, SSL, subscriptions — anything with a renewalDate, across
  // every client folder, sorted by urgency.
  async _showRenewals(days = 60) {
    const { Router, kb } = window.App;
    Router.show('page-vault');

    document.querySelectorAll('.nav-item, .folder-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('nav-renewals')?.classList.add('active');

    const mainArea = document.getElementById('vault-main');
    if (!mainArea) return;

    let renewals = [];
    try { renewals = await kb.vault.getUpcomingRenewals(days); } catch { renewals = []; }

    mainArea.innerHTML = `
      <div style="flex:1;overflow-y:auto;padding:32px;max-width:720px;margin:0 auto" class="anim-fade">
        <div class="section-header" style="margin-bottom:24px">
          <h2 class="section-title">⏰ Upcoming Renewals</h2>
          <button class="btn btn-ghost btn-sm" id="ren-back-btn">← Back to Vault</button>
        </div>
        <div style="margin-bottom:16px;display:flex;gap:8px;align-items:center">
          <span style="font-size:12px;color:var(--text-muted)">Showing next</span>
          <select id="ren-days-sel" style="width:auto;padding:5px 10px">
            <option value="14"${days===14?' selected':''}>14 days</option>
            <option value="30"${days===30?' selected':''}>30 days</option>
            <option value="60"${days===60?' selected':''}>60 days</option>
            <option value="90"${days===90?' selected':''}>90 days</option>
            <option value="365"${days===365?' selected':''}>1 year</option>
          </select>
        </div>
        <div id="ren-list"></div>
      </div>
    `;

    document.getElementById('ren-back-btn').onclick = () => VaultPage.load();
    document.getElementById('ren-days-sel').onchange = (e) => this._showRenewals(parseInt(e.target.value));

    const list = document.getElementById('ren-list');
    if (renewals.length === 0) {
      list.innerHTML = `
        <div style="padding:48px 20px;text-align:center;color:var(--text-muted)">
          <div style="font-size:40px;margin-bottom:12px">✅</div>
          <div>Nothing renewing in the next ${days} days</div>
          <div style="font-size:12px;margin-top:6px">Set a renewal date on any item's Advanced tab to track it here</div>
        </div>`;
      return;
    }

    list.innerHTML = renewals.map(item => {
      const daysLeft = Math.ceil(item._dueInMs / 86_400_000);
      const overdue = daysLeft < 0;
      const urgent = !overdue && daysLeft <= 14;
      const badgeColor = overdue ? 'var(--danger)' : urgent ? 'var(--warning)' : 'var(--accent)';
      const badgeText = overdue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Today' : `${daysLeft}d left`;
      const emoji = typeEmoji(item.type);
      return `
        <div class="item-card ren-row" data-item-id="${item.id}" style="border:1px solid var(--border);margin-bottom:6px;cursor:pointer">
          <div class="item-favicon">${emoji}</div>
          <div class="item-info">
            <div class="item-name">${escHtml(item.name || 'Untitled')}</div>
            <div class="item-sub">${escHtml(new Date(item.renewalDate).toLocaleDateString())}</div>
          </div>
          <span class="breach-badge" style="background:transparent;border-color:${badgeColor};color:${badgeColor}">${badgeText}</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.ren-row').forEach(row => {
      row.onclick = () => {
        const { AppState } = window.App;
        const item = AppState.items.find(i => i.id === row.dataset.itemId);
        if (!item) return;
        this._ensureVaultMainVisible();
        AppState.selectedItem = item;
        this._showDetail(item);
      };
    });
  },

  async _renameFolder(folder) {
    const { Modal, Toast, kb, AppState } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>Rename Folder</h3>
        <button class="modal-close" id="rename-modal-close">✕</button>
      </div>
      <div class="form-group">
        <label>New Name</label>
        <input type="text" id="rename-inp" value="${escHtml(folder.name)}" />
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-ghost" id="rename-cancel">Cancel</button>
        <button class="btn btn-primary" id="rename-save-btn">Save</button>
      </div>
    `);

    document.getElementById('rename-modal-close').onclick = () => Modal.close();
    document.getElementById('rename-cancel').onclick = () => Modal.close();
    const inp = document.getElementById('rename-inp');
    inp.focus(); inp.select();

    document.getElementById('rename-save-btn').onclick = async () => {
      const name = inp.value.trim();
      if (!name) return;
      await kb.folders.update(folder.id, { name });
      folder.name = name;
      const idx = AppState.folders.findIndex(f => f.id === folder.id);
      if (idx !== -1) AppState.folders[idx].name = name;
      this._renderFolders();
      Modal.close();
      Toast.show('Folder renamed', 'success');
    };

    inp.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('rename-save-btn').click(); };
  },

  async _colorFolder(folder, color) {
    const { kb, AppState } = window.App;
    await kb.folders.update(folder.id, { color });
    folder.color = color;
    const idx = AppState.folders.findIndex(f => f.id === folder.id);
    if (idx !== -1) AppState.folders[idx].color = color;
    this._renderFolders();
  },

  async _deleteFolder(folder) {
    const { Modal, Toast, kb, AppState } = window.App;
    Modal.show(`
      <div class="modal-header">
        <h3>Delete "${escHtml(folder.name)}"?</h3>
        <button class="modal-close" id="delf-modal-close">✕</button>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:20px">Items in this folder will be moved to root. This cannot be undone.</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" id="delf-cancel">Cancel</button>
        <button class="btn btn-danger" id="del-folder-btn">Delete Folder</button>
      </div>
    `);

    document.getElementById('delf-modal-close').onclick = () => Modal.close();
    document.getElementById('delf-cancel').onclick = () => Modal.close();

    let clicked = false;
    document.getElementById('del-folder-btn').onclick = async () => {
      if (!clicked) {
        clicked = true;
        const btn = document.getElementById('del-folder-btn');
        btn.textContent = 'Click again to confirm';
        return;
      }
      await kb.folders.delete(folder.id);
      AppState.folders = AppState.folders.filter(f => f.id !== folder.id);
      AppState.items = await kb.items.getAll();
      this._renderFolders();
      this._renderItems();
      this._updateCounts();
      Modal.close();
      Toast.show('Folder deleted', 'info');
    };
  },

  // ── Real-time refresh (called by vault:updated event from main process) ──
  // Triggered whenever the vault changes: extension credential save, sync pull,
  // or any other out-of-band modification. Re-renders lists in place without
  // navigating away or losing scroll position.
  refresh() {
    const { AppState } = window.App;
    if (!AppState?.items) return;
    // Update sidebar counts and re-render both panels
    this._renderFolders();
    this._renderItems();
    this._updateCounts();
  },

  isLoaded() {
    return !!document.getElementById('items-panel');
  },
};

/* ── Field helpers ─────────────────────────────────────────────────────── */
function field(label, value, opts = {}) {
  const { copy, mono, masked, open } = opts;
  const eyeId = masked ? `eye-${Math.random().toString(36).slice(2, 8)}` : null;
  return `
    <div class="detail-field">
      <div class="df-label">${label}</div>
      <div class="df-value${mono ? ' password' : ''}">
        <span style="flex:1;user-select:text"${eyeId ? ` id="dfv-${eyeId}" class="field-masked"` : ''}>${value}</span>
        <div class="df-actions">
          ${masked ? `<button class="icon-btn eye-toggle-btn" data-eye-target="dfv-${eyeId}" title="Show/Hide">👁</button>` : ''}
          ${copy ? `<button class="icon-btn" data-copy="${copy}" data-label="${label}" title="Copy">📋</button>` : ''}
          ${open ? `<button class="icon-btn" data-open-url title="Open">↗</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function totpField(itemId) {
  return `
    <div class="detail-field">
      <div class="df-label">TOTP Code</div>
      <div class="df-value">
        <div class="totp-display" style="flex:1">
          <span class="totp-code" id="totp-code-${itemId}">------</span>
          <svg class="totp-timer" viewBox="0 0 28 28" style="transform:rotate(-90deg)">
            <circle cx="14" cy="14" r="12" fill="none" stroke="var(--border)" stroke-width="3"/>
            <circle id="totp-ring-${itemId}" class="totp-ring" cx="14" cy="14" r="12" stroke-dashoffset="0"/>
          </svg>
        </div>
        <button class="icon-btn" title="Copy TOTP" id="totp-copy-${itemId}">📋</button>
      </div>
    </div>
  `;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
