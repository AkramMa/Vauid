'use strict';
/* Item Form modal — Add / Edit all item types */

const ItemForm = {
  _mode: 'add',
  _type: 'login',
  _item: null,
  _activeTab: 'entry',
  _socialAccounts: [],

  showAdd(type = 'login') {
    this._mode = 'add'; this._type = type; this._item = null; this._activeTab = 'entry'; this._show();
  },

  showEdit(item) {
    this._mode = 'edit'; this._type = item.type; this._item = item; this._activeTab = 'entry'; this._show();
  },

  _show() {
    const { Modal } = window.App;
    const title = this._mode === 'add' ? `Add ${this._typeLabel()}` : `Edit ${escHtml(this._item?.name || '')}`;
    this._customFields = (this._item?.customFields || []).map(f => ({ ...f }));
    this._socialAccounts = (this._item?.socialAccounts || []).map(s => ({ ...s }));

    Modal.show(`
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" id="item-form-close">✕</button>
      </div>
      <div id="item-form-body">${this._formFields()}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
        <button class="btn btn-ghost" id="item-form-cancel">Cancel</button>
        <button class="btn btn-primary" id="item-form-save">${this._mode === 'add' ? 'Add Item' : 'Save Changes'}</button>
      </div>
    `, { wide: true });

    document.getElementById('item-form-close').onclick  = () => Modal.close();
    document.getElementById('item-form-cancel').onclick = () => Modal.close();
    document.getElementById('item-form-save').onclick   = () => this._save();

    this._bindTabEvents();
    this._bindEvents();
    this._bindCustomFieldEvents();
    this._bindSocialEvents();
    this._bindAttachmentEvents();
  },

  /* Tab helpers */
  _tabBar(tabs) {
    return `<div class="if-tab-bar">${tabs.map(([id,label,icon]) =>
      `<button class="if-tab-btn${id===this._activeTab?' active':''}" data-tab="${id}">${icon} ${label}</button>`
    ).join('')}</div>`;
  },
  _pane(id, content) {
    return `<div class="if-tab-pane" data-pane="${id}" style="display:${id===this._activeTab?'block':'none'}">${content}</div>`;
  },
  _bindTabEvents() {
    document.querySelectorAll('.if-tab-btn').forEach(btn => {
      btn.onclick = () => {
        this._activeTab = btn.dataset.tab;
        document.querySelectorAll('.if-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.if-tab-pane').forEach(p => {
          p.style.display = p.dataset.pane === this._activeTab ? 'block' : 'none';
        });
      };
    });
  },

  _formFields() {
    const i = this._item || {};
    switch (this._type) {
      case 'login':    return this._loginForm(i);
      case 'card':     return this._cardForm(i);
      case 'identity': return this._identityForm(i);
      case 'note':     return this._noteForm(i);
      case 'passkey':  return this._passkeyForm(i);
      case 'website':  return this._websiteForm(i);
      default: return '';
    }
  },

  _typeLabel() {
    return {login:'Login',card:'Credit Card',identity:'Identity',note:'Secure Note',passkey:'Passkey',website:'Website/Hosting'}[this._type]||'Item';
  },

  _folderOptions() {
    const { AppState } = window.App;
    const folders = AppState.folders || [];
    const selected = this._item?.folderId || '';
    return `<option value="">— No Folder —</option>` +
      folders.map(f => `<option value="${f.id}"${f.id===selected?' selected':''}>${escHtml(f.name)}</option>`).join('');
  },

  _propertiesPane(item, showPasswordAge) {
    const fmt = d => d ? new Date(d).toLocaleString() : '—';
    let pwAge = '';
    if (showPasswordAge && item?.passwordChangedAt) {
      const days = Math.floor((Date.now() - new Date(item.passwordChangedAt)) / 86400000);
      pwAge = `<div class="form-group"><label>Password Age</label><div class="if-prop-val">${days} day${days!==1?'s':''}</div></div>`;
    }
    return `
      <div class="form-group"><label>Created</label><div class="if-prop-val">${fmt(item?.createdAt)}</div></div>
      <div class="form-group"><label>Last Modified</label><div class="if-prop-val">${fmt(item?.updatedAt)}</div></div>
      ${pwAge}`;
  },

  /* LOGIN FORM — 3 tabs */
  _loginForm(i) {
    return `
      ${this._tabBar([['entry','Entry','🔑'],['advanced','Advanced','⚙️'],['properties','Properties','📋']])}
      ${this._pane('entry', `
        <div class="form-group">
          <label>Title <span style="color:var(--danger)">*</span></label>
          <input type="text" id="if-name" value="${escHtml(i.name||'')}" placeholder="e.g. Gmail, GitHub…" autocomplete="off" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Username / Email</label>
            <input type="text" id="if-username" value="${escHtml(i.username||'')}" placeholder="username@example.com" autocomplete="off" />
          </div>
          <div class="form-group">
            <label>URL</label>
            <input type="url" id="if-url" value="${escHtml(i.url||'')}" placeholder="https://…" />
          </div>
        </div>
        <div class="form-group">
          <label>Password</label>
          <div style="display:flex;gap:8px">
            <div class="password-input-wrap" style="flex:1">
              <input type="password" id="if-password" value="${escHtml(i.password||'')}" placeholder="Your password" autocomplete="new-password" />
              <button class="toggle-pw" data-target="if-password">👁</button>
            </div>
            <button class="btn btn-sm btn-outline" id="if-gen-btn" title="Generate">⚙ Generate</button>
          </div>
          <div class="strength-bar-wrap" style="margin-top:4px"><div class="strength-bar" id="if-strength-bar"></div></div>
          <span class="strength-label" id="if-strength-label"></span>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Folder</label>
            <select id="if-folder">${this._folderOptions()}</select>
          </div>
          <div class="form-group">
            <label>Favourite</label>
            <label class="toggle" style="margin-top:8px">
              <input type="checkbox" id="if-fav" ${i.favorite?'checked':''} />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      `)}
      ${this._pane('advanced', `
        <div class="form-group">
          <label>TOTP Secret <span class="optional">(for 2FA)</span></label>
          <input type="text" id="if-totp" value="${escHtml(i.totp||'')}" placeholder="Base32 secret or otpauth:// URL" style="font-family:var(--font-mono)" autocomplete="off" />
        </div>
        <div class="form-group">
          <label>Renewal / Expiry Date <span class="optional">(domain, subscription…)</span></label>
          <input type="date" id="if-renewalDate" value="${escHtml(i.renewalDate||'')}" style="max-width:200px" />
        </div>
        <div class="identity-section" style="margin-top:16px">
          <div class="identity-section-title" style="display:flex;align-items:center;justify-content:space-between">
            Additional Attributes
            <button class="btn btn-sm btn-ghost" id="if-add-custom-field">+ Add Field</button>
          </div>
          <div id="if-custom-fields-list">${this._renderCustomFields()}</div>
        </div>
        <div class="identity-section" style="margin-top:16px">
          <div class="identity-section-title">Attachments</div>
          <div id="if-att-list" style="margin-bottom:8px">${this._renderAttachmentList()}</div>
          <button class="btn btn-sm btn-ghost" id="if-add-att-btn">📎 Add Attachment</button>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>Notes</label>
          <textarea id="if-notes" placeholder="Additional notes…">${escHtml(i.notes||'')}</textarea>
        </div>
      `)}
      ${this._pane('properties', this._propertiesPane(i, true))}
    `;
  },

  /* IDENTITY FORM — 6 tabs */
  _identityForm(i) {
    return `
      ${this._tabBar([['entry','Entry','🪪'],['social','Social','🌐'],['location','Location','📍'],['govids','Gov. IDs','🛂'],['advanced','Advanced','⚙️'],['properties','Properties','📋']])}
      ${this._pane('entry', `
        <div class="form-group">
          <label>Identity Name <span style="color:var(--danger)">*</span></label>
          <input type="text" id="if-name" value="${escHtml(i.name||'')}" placeholder="e.g. Personal Identity" />
        </div>
        <div class="form-row">
          <div class="form-group"><label>First Name</label><input type="text" id="if-firstName" value="${escHtml(i.firstName||'')}" /></div>
          <div class="form-group"><label>Last Name</label><input type="text" id="if-lastName" value="${escHtml(i.lastName||'')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Username</label><input type="text" id="if-username" value="${escHtml(i.username||'')}" placeholder="@handle" /></div>
          <div class="form-group"><label>Email</label><input type="email" id="if-email" value="${escHtml(i.email||'')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Phone</label><input type="tel" id="if-phone" value="${escHtml(i.phone||'')}" /></div>
          <div class="form-group"><label>WhatsApp</label><input type="tel" id="if-whatsapp" value="${escHtml(i.whatsapp||'')}" placeholder="WhatsApp number" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Company Name</label><input type="text" id="if-company" value="${escHtml(i.company||'')}" /></div>
          <div class="form-group"><label>Job Title</label><input type="text" id="if-jobTitle" value="${escHtml(i.jobTitle||'')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Folder</label><select id="if-folder">${this._folderOptions()}</select></div>
        </div>
      `)}
      ${this._pane('social', `
        <div id="if-social-list">${this._renderSocialAccounts()}</div>
        <button class="btn btn-sm btn-ghost" id="if-add-social" style="margin-top:12px">+ Add Account</button>
      `)}
      ${this._pane('location', `
        <div class="form-group"><label>Address Line 1</label><input type="text" id="if-address1" value="${escHtml(i.address1||'')}" /></div>
        <div class="form-group"><label>Address Line 2</label><input type="text" id="if-address2" value="${escHtml(i.address2||'')}" /></div>
        <div class="form-row">
          <div class="form-group"><label>City</label><input type="text" id="if-city" value="${escHtml(i.city||'')}" /></div>
          <div class="form-group"><label>State / Province</label><input type="text" id="if-state" value="${escHtml(i.state||'')}" /></div>
          <div class="form-group"><label>ZIP / Postal</label><input type="text" id="if-zip" value="${escHtml(i.zip||'')}" /></div>
        </div>
        <div class="form-group"><label>Country</label><input type="text" id="if-country" value="${escHtml(i.country||'')}" /></div>
      `)}
      ${this._pane('govids', `
        <div class="form-row">
          <div class="form-group">
            <label>SSN / National ID <span class="optional">(encrypted)</span></label>
            <div class="password-input-wrap">
              <input type="password" id="if-ssn" value="${escHtml(i.ssn||'')}" autocomplete="off" />
              <button class="toggle-pw" data-target="if-ssn">👁</button>
            </div>
          </div>
          <div class="form-group"><label>Passport #</label><input type="text" id="if-passport" value="${escHtml(i.passport||'')}" /></div>
        </div>
        <div class="form-group"><label>Driver's License</label><input type="text" id="if-license" value="${escHtml(i.license||'')}" /></div>
        <div class="form-group"><label>Notes</label><textarea id="if-notes">${escHtml(i.notes||'')}</textarea></div>
      `)}
      ${this._pane('advanced', `
        <div class="identity-section">
          <div class="identity-section-title" style="display:flex;align-items:center;justify-content:space-between">
            Additional Attributes
            <button class="btn btn-sm btn-ghost" id="if-add-custom-field">+ Add Field</button>
          </div>
          <div id="if-custom-fields-list">${this._renderCustomFields()}</div>
        </div>
        <div class="identity-section" style="margin-top:16px">
          <div class="identity-section-title">Attachments</div>
          <div id="if-att-list" style="margin-bottom:8px">${this._renderAttachmentList()}</div>
          <button class="btn btn-sm btn-ghost" id="if-add-att-btn">📎 Add Attachment</button>
        </div>
      `)}
      ${this._pane('properties', this._propertiesPane(i, false))}
    `;
  },

  /* CARD FORM — flat, no custom fields */
  _cardForm(i) {
    return `
      <div class="form-group">
        <label>Card Name <span style="color:var(--danger)">*</span></label>
        <input type="text" id="if-name" value="${escHtml(i.name||'')}" placeholder="e.g. Visa Personal" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Card Type</label>
          <select id="if-cardType">
            ${['Visa','Mastercard','Amex','Discover','Other'].map(t=>`<option${i.cardType===t?' selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Cardholder Name</label>
          <input type="text" id="if-cardHolder" value="${escHtml(i.cardHolder||'')}" placeholder="John Doe" />
        </div>
      </div>
      <div class="form-group">
        <label>Card Number</label>
        <input type="text" id="if-cardNumber" value="${escHtml(i.cardNumber||'')}"
          placeholder="1234 5678 9012 3456" maxlength="19" style="font-family:var(--font-mono)" autocomplete="off" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Expiry Date</label>
          <div class="expiry-input-wrap">
            <input type="text" id="if-expMonth" value="${escHtml(i.expMonth||'')}" placeholder="MM" maxlength="2" inputmode="numeric" autocomplete="cc-exp-month" style="width:52px;text-align:center;font-family:var(--font-mono)" />
            <span class="expiry-sep">/</span>
            <input type="text" id="if-expYear" value="${escHtml(i.expYear?String(i.expYear).slice(-2):'')}" placeholder="YY" maxlength="2" inputmode="numeric" autocomplete="cc-exp-year" style="width:52px;text-align:center;font-family:var(--font-mono)" />
          </div>
        </div>
        <div class="form-group">
          <label>CVV</label>
          <input type="password" id="if-cvv" value="${escHtml(i.cvv||'')}" placeholder="•••" maxlength="4" autocomplete="off" />
        </div>
        <div class="form-group">
          <label>PIN <span class="optional">(optional)</span></label>
          <input type="password" id="if-pin" value="${escHtml(i.pin||'')}" placeholder="••••" maxlength="8" autocomplete="off" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Folder</label><select id="if-folder">${this._folderOptions()}</select></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea id="if-notes">${escHtml(i.notes||'')}</textarea></div>
    `;
  },

  /* NOTE FORM */
  _noteForm(i) {
    return `
      <div class="form-group">
        <label>Title <span style="color:var(--danger)">*</span></label>
        <input type="text" id="if-name" value="${escHtml(i.name||'')}" placeholder="Note title" />
      </div>
      <div class="form-group">
        <label>Note Content</label>
        <textarea id="if-notes" style="min-height:200px" placeholder="Your secure note…">${escHtml(i.notes||'')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Folder</label><select id="if-folder">${this._folderOptions()}</select></div>
      </div>
    `;
  },

  /* PASSKEY FORM */
  _passkeyForm(i) {
    return `
      <div class="form-group">
        <label>Name <span style="color:var(--danger)">*</span></label>
        <input type="text" id="if-name" value="${escHtml(i.name||'')}" placeholder="e.g. GitHub Passkey" />
      </div>
      <div class="form-row">
        <div class="form-group"><label>Relying Party (Domain)</label><input type="text" id="if-rpId" value="${escHtml(i.rpId||'')}" placeholder="github.com" /></div>
        <div class="form-group"><label>Username</label><input type="text" id="if-username" value="${escHtml(i.username||'')}" /></div>
      </div>
      <div class="form-group">
        <label>Credential ID <span class="optional">(base64)</span></label>
        <input type="text" id="if-credentialId" value="${escHtml(i.credentialId||'')}" style="font-family:var(--font-mono)" />
      </div>
      <div class="form-group"><label>Notes</label><textarea id="if-notes">${escHtml(i.notes||'')}</textarea></div>
    `;
  },

  /* WEBSITE / HOSTING FORM — built for a freelancer's "everything about this
     client's site" needs: hosting, domain, DNS, CMS admin, FTP, all in one
     place instead of 3-4 separate generic logins. */
  _websiteForm(i) {
    return `
      ${this._tabBar([['entry','Site Info','🌐'],['access','Hosting & DNS','🌐'],['cms','CMS / FTP','🛠️'],['advanced','Advanced','⚙️'],['properties','Properties','📋']])}
      ${this._pane('entry', `
        <div class="form-group">
          <label>Client / Site Name <span style="color:var(--danger)">*</span></label>
          <input type="text" id="if-name" value="${escHtml(i.name||'')}" placeholder="e.g. Acme Corp — acme.com" autocomplete="off" />
        </div>
        <div class="form-group">
          <label>Site URL</label>
          <input type="url" id="if-url" value="${escHtml(i.url||'')}" placeholder="https://acme.com" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Folder</label>
            <select id="if-folder">${this._folderOptions()}</select>
          </div>
          <div class="form-group">
            <label>Renewal / Expiry Date <span class="optional">(domain, hosting, SSL…)</span></label>
            <input type="date" id="if-renewalDate" value="${escHtml(i.renewalDate||'')}" />
          </div>
        </div>
      `)}
      ${this._pane('access', `
        <div class="identity-section">
          <div class="identity-section-title">Hosting Account</div>
          <div class="form-row">
            <div class="form-group"><label>Hosting Provider</label><input type="text" id="if-hostingProvider" value="${escHtml(i.hostingProvider||'')}" placeholder="e.g. Hostinger, SiteGround…" /></div>
            <div class="form-group"><label>Control Panel URL</label><input type="url" id="if-hostingUrl" value="${escHtml(i.hostingUrl||'')}" placeholder="https://…/cpanel" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Username</label><input type="text" id="if-hostingUsername" value="${escHtml(i.hostingUsername||'')}" autocomplete="off" /></div>
            <div class="form-group">
              <label>Password</label>
              <div class="password-input-wrap">
                <input type="password" id="if-hostingPassword" value="${escHtml(i.hostingPassword||'')}" autocomplete="new-password" />
                <button class="toggle-pw" data-target="if-hostingPassword">👁</button>
              </div>
            </div>
          </div>
        </div>
        <div class="identity-section" style="margin-top:16px">
          <div class="identity-section-title">Domain Registrar</div>
          <div class="form-row">
            <div class="form-group"><label>Registrar</label><input type="text" id="if-domainRegistrar" value="${escHtml(i.domainRegistrar||'')}" placeholder="e.g. Namecheap, GoDaddy…" /></div>
            <div class="form-group"><label>Nameservers / DNS</label><input type="text" id="if-nameservers" value="${escHtml(i.nameservers||'')}" placeholder="ns1.example.com, ns2.example.com" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Username</label><input type="text" id="if-registrarUsername" value="${escHtml(i.registrarUsername||'')}" autocomplete="off" /></div>
            <div class="form-group">
              <label>Password</label>
              <div class="password-input-wrap">
                <input type="password" id="if-registrarPassword" value="${escHtml(i.registrarPassword||'')}" autocomplete="new-password" />
                <button class="toggle-pw" data-target="if-registrarPassword">👁</button>
              </div>
            </div>
          </div>
        </div>
      `)}
      ${this._pane('cms', `
        <div class="identity-section">
          <div class="identity-section-title">CMS Admin Panel</div>
          <div class="form-group"><label>Admin URL</label><input type="url" id="if-cmsUrl" value="${escHtml(i.cmsUrl||'')}" placeholder="https://acme.com/wp-admin" /></div>
          <div class="form-row">
            <div class="form-group"><label>Username</label><input type="text" id="if-cmsUsername" value="${escHtml(i.cmsUsername||'')}" autocomplete="off" /></div>
            <div class="form-group">
              <label>Password</label>
              <div class="password-input-wrap">
                <input type="password" id="if-cmsPassword" value="${escHtml(i.cmsPassword||'')}" autocomplete="new-password" />
                <button class="toggle-pw" data-target="if-cmsPassword">👁</button>
              </div>
            </div>
          </div>
        </div>
        <div class="identity-section" style="margin-top:16px">
          <div class="identity-section-title">FTP / SSH</div>
          <div class="form-row">
            <div class="form-group"><label>Host</label><input type="text" id="if-ftpHost" value="${escHtml(i.ftpHost||'')}" placeholder="ftp.acme.com" /></div>
            <div class="form-group"><label>Port</label><input type="text" id="if-ftpPort" value="${escHtml(i.ftpPort||'')}" placeholder="21 / 22" style="max-width:100px" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Username</label><input type="text" id="if-ftpUsername" value="${escHtml(i.ftpUsername||'')}" autocomplete="off" /></div>
            <div class="form-group">
              <label>Password</label>
              <div class="password-input-wrap">
                <input type="password" id="if-ftpPassword" value="${escHtml(i.ftpPassword||'')}" autocomplete="new-password" />
                <button class="toggle-pw" data-target="if-ftpPassword">👁</button>
              </div>
            </div>
          </div>
        </div>
      `)}
      ${this._pane('advanced', `
        <div class="identity-section">
          <div class="identity-section-title" style="display:flex;align-items:center;justify-content:space-between">
            Additional Attributes
            <button class="btn btn-sm btn-ghost" id="if-add-custom-field">+ Add Field</button>
          </div>
          <div id="if-custom-fields-list">${this._renderCustomFields()}</div>
        </div>
        <div class="identity-section" style="margin-top:16px">
          <div class="identity-section-title">Attachments <span class="optional">(bill/invoice screenshots, etc.)</span></div>
          <div id="if-att-list" style="margin-bottom:8px">${this._renderAttachmentList()}</div>
          <button class="btn btn-sm btn-ghost" id="if-add-att-btn">📎 Add Attachment</button>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>Notes</label>
          <textarea id="if-notes" placeholder="Additional notes…">${escHtml(i.notes||'')}</textarea>
        </div>
      `)}
      ${this._pane('properties', this._propertiesPane(i, false))}
    `;
  },

  /* SOCIAL ACCOUNTS */
  _renderSocialAccounts() {
    const accs = this._socialAccounts;
    if (accs.length === 0) return '<p style="color:var(--text-muted);font-size:13px;margin:4px 0">No social accounts yet. Click "+ Add Account" to add one.</p>';
    return accs.map((s, idx) => `
      <div class="social-account-row" data-idx="${idx}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:13px;font-weight:600;color:var(--text-secondary)">${escHtml(s.title||`Account #${idx+1}`)}</span>
          <button class="btn btn-sm btn-ghost social-remove-btn" style="color:var(--danger)" data-idx="${idx}">✕ Remove</button>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Platform / Title</label><input type="text" class="sa-title" value="${escHtml(s.title||'')}" placeholder="e.g. Twitter, LinkedIn…" /></div>
          <div class="form-group"><label>Username / Email</label><input type="text" class="sa-username" value="${escHtml(s.username||'')}" placeholder="@handle or email" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>URL</label><input type="url" class="sa-url" value="${escHtml(s.url||'')}" placeholder="https://…" /></div>
          <div class="form-group">
            <label>Password</label>
            <div class="password-input-wrap">
              <input type="password" class="sa-password" value="${escHtml(s.password||'')}" placeholder="Password" autocomplete="new-password" />
              <button class="toggle-pw-social" type="button" title="Show/hide">👁</button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  },

  _bindSocialEvents() {
    const addBtn = document.getElementById('if-add-social');
    if (!addBtn) return;
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    newBtn.addEventListener('click', () => {
      this._syncSocialsFromDom();
      this._socialAccounts.push({ title:'', username:'', url:'', password:'' });
      document.getElementById('if-social-list').innerHTML = this._renderSocialAccounts();
      this._rebindSocialRows();
    });
    this._rebindSocialRows();
  },

  _syncSocialsFromDom() {
    const list = document.getElementById('if-social-list');
    if (!list) return;
    list.querySelectorAll('.social-account-row').forEach((row, idx) => {
      if (this._socialAccounts[idx]) {
        this._socialAccounts[idx].title    = row.querySelector('.sa-title')?.value    || '';
        this._socialAccounts[idx].username = row.querySelector('.sa-username')?.value || '';
        this._socialAccounts[idx].url      = row.querySelector('.sa-url')?.value      || '';
        this._socialAccounts[idx].password = row.querySelector('.sa-password')?.value || '';
      }
    });
  },

  _rebindSocialRows() {
    const list = document.getElementById('if-social-list');
    if (!list) return;
    list.querySelectorAll('.social-remove-btn').forEach(btn => {
      btn.onclick = () => {
        this._syncSocialsFromDom();
        this._socialAccounts.splice(parseInt(btn.dataset.idx), 1);
        list.innerHTML = this._renderSocialAccounts();
        this._rebindSocialRows();
      };
    });
    list.querySelectorAll('.social-account-row').forEach((row, idx) => {
      ['sa-title','sa-username','sa-url','sa-password'].forEach(cls => {
        row.querySelector(`.${cls}`)?.addEventListener('input', e => {
          if (this._socialAccounts[idx]) this._socialAccounts[idx][cls.replace('sa-','')] = e.target.value;
        });
      });
      const eyeBtn = row.querySelector('.toggle-pw-social');
      const pwInp  = row.querySelector('.sa-password');
      if (eyeBtn && pwInp) {
        eyeBtn.onclick = () => { pwInp.type = pwInp.type==='password'?'text':'password'; eyeBtn.textContent = pwInp.type==='password'?'👁':'🙈'; };
      }
    });
  },

  /* CUSTOM FIELDS */
  _renderCustomFields() {
    const fields = this._customFields || [];
    if (fields.length === 0) return '<p style="color:var(--text-muted);font-size:13px;margin:4px 0">No custom fields yet.</p>';
    return fields.map((f, idx) => `
      <div class="form-row custom-field-row" data-idx="${idx}" style="align-items:center;gap:8px">
        <div class="form-group" style="flex:1;min-width:100px">
          <input type="text" class="cf-label-inp" value="${escHtml(f.label||'')}" placeholder="Field name" />
        </div>
        <div class="form-group" style="flex:0 0 auto">
          <select class="cf-type-sel" style="height:36px;padding:4px 8px;font-size:13px">
            <option value="text"${(!f.type||f.type==='text')?' selected':''}>Text</option>
            <option value="password"${f.type==='password'?' selected':''}>Password</option>
            <option value="email"${f.type==='email'?' selected':''}>Email</option>
            <option value="url"${f.type==='url'?' selected':''}>URL</option>
            <option value="number"${f.type==='number'?' selected':''}>Number</option>
          </select>
        </div>
        <div class="form-group" style="flex:2;min-width:120px">
          <input type="${(f.type==='password'||f.hidden)?'password':(f.type||'text')}" class="cf-value-inp" value="${escHtml(f.value||'')}" placeholder="Value" autocomplete="off" />
        </div>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);white-space:nowrap">
          <input type="checkbox" class="cf-hidden-chk" ${f.hidden?'checked':''} /> Hidden
        </label>
        <button class="btn btn-sm btn-ghost cf-remove-btn" style="color:var(--danger);flex-shrink:0" title="Remove">✕</button>
      </div>
    `).join('');
  },

  _bindCustomFieldEvents() {
    const addBtn = document.getElementById('if-add-custom-field');
    if (addBtn) {
      const newBtn = addBtn.cloneNode(true);
      addBtn.parentNode.replaceChild(newBtn, addBtn);
      newBtn.addEventListener('click', () => {
        this._customFields.push({ label:'', value:'', type:'text', hidden:false });
        document.getElementById('if-custom-fields-list').innerHTML = this._renderCustomFields();
        this._rebindCustomFieldRows();
      });
    }
    this._rebindCustomFieldRows();
  },

  _syncCustomFieldsFromDom() {
    const list = document.getElementById('if-custom-fields-list');
    if (!list) return;
    list.querySelectorAll('.custom-field-row').forEach((row, idx) => {
      if (this._customFields[idx]) {
        this._customFields[idx].label = row.querySelector('.cf-label-inp')?.value || '';
        this._customFields[idx].value = row.querySelector('.cf-value-inp')?.value || '';
        this._customFields[idx].type  = row.querySelector('.cf-type-sel')?.value  || 'text';
      }
    });
  },

  _rebindCustomFieldRows() {
    const list = document.getElementById('if-custom-fields-list');
    if (!list) return;
    list.querySelectorAll('.cf-remove-btn').forEach((btn, idx) => {
      btn.onclick = () => { this._syncCustomFieldsFromDom(); this._customFields.splice(idx,1); list.innerHTML=this._renderCustomFields(); this._rebindCustomFieldRows(); };
    });
    list.querySelectorAll('.cf-type-sel').forEach((sel, idx) => {
      sel.onchange = e => {
        if (this._customFields[idx]) { this._customFields[idx].type = e.target.value; }
        const vi = list.querySelectorAll('.cf-value-inp')[idx];
        if (vi) vi.type = (e.target.value==='password'||(this._customFields[idx]?.hidden)) ? 'password' : e.target.value;
      };
    });
    list.querySelectorAll('.cf-hidden-chk').forEach((chk, idx) => {
      chk.onchange = e => {
        if (this._customFields[idx]) this._customFields[idx].hidden = e.target.checked;
        const vi = list.querySelectorAll('.cf-value-inp')[idx];
        const ts = list.querySelectorAll('.cf-type-sel')[idx];
        if (vi) vi.type = (e.target.checked||ts?.value==='password') ? 'password' : (ts?.value||'text');
      };
    });
    list.querySelectorAll('.cf-label-inp').forEach((inp,idx) => { inp.oninput=e=>{if(this._customFields[idx])this._customFields[idx].label=e.target.value;}; });
    list.querySelectorAll('.cf-value-inp').forEach((inp,idx) => { inp.oninput=e=>{if(this._customFields[idx])this._customFields[idx].value=e.target.value;}; });
  },

  /* ATTACHMENTS */
  _renderAttachmentList() {
    if (!this._item) return '<p style="color:var(--text-muted);font-size:13px;margin:4px 0">Save the item first to add attachments.</p>';
    const { AppState } = window.App;
    const data = AppState._vaultData || {};
    const atts = (data.attachments||{})[this._item.id] || {};
    const entries = Object.values(atts);
    if (entries.length===0) return '<p style="color:var(--text-muted);font-size:13px;margin:4px 0">No attachments yet.</p>';
    return entries.map(a => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;font-size:13px">📎 ${escHtml(a.name)}</span>
        <span style="font-size:11px;color:var(--text-muted)">${(a.size/1024).toFixed(1)} KB</span>
        <button class="btn btn-sm btn-ghost if-att-export-btn" data-att-id="${a.id}" title="Export">↓</button>
        <button class="btn btn-sm btn-ghost if-att-remove-btn" style="color:var(--danger)" data-att-id="${a.id}" title="Remove">✕</button>
      </div>`).join('');
  },

  _bindAttachmentEvents() {
    const { kb, Toast } = window.App;
    const addBtn = document.getElementById('if-add-att-btn');
    if (addBtn) {
      addBtn.onclick = async () => {
        if (!this._item) {
          Toast.show('Save this item first, then add attachments from Edit', 'info');
          return;
        }
        const fp = await kb.attachments.pickFile();
        if (!fp) return;
        const r = await kb.attachments.add(this._item.id, fp);
        if (r.success) {
          Toast.show('Attachment added','success');
          const data = await kb.vault.getData();
          window.App.AppState._vaultData = data;
          const attList = document.getElementById('if-att-list');
          if (attList) { attList.innerHTML=this._renderAttachmentList(); this._bindAttachmentEvents(); }
        } else { Toast.show('Failed: '+r.error,'error'); }
      };
    }
    document.querySelectorAll('.if-att-export-btn').forEach(btn => { btn.onclick=()=>kb.attachments.export(this._item.id, btn.dataset.attId); });
    document.querySelectorAll('.if-att-remove-btn').forEach(btn => {
      btn.onclick = async () => {
        await kb.attachments.remove(this._item.id, btn.dataset.attId);
        const data = await kb.vault.getData();
        window.App.AppState._vaultData = data;
        const attList = document.getElementById('if-att-list');
        if (attList) { attList.innerHTML=this._renderAttachmentList(); this._bindAttachmentEvents(); }
        Toast.show('Attachment removed','info');
      };
    });
  },

  /* BIND EVENTS */
  _bindEvents() {
    const { kb } = window.App;
    const pwInp = document.getElementById('if-password');
    if (pwInp) {
      pwInp.oninput = async e => {
        const s = await kb.password.strength(e.target.value);
        const bar = document.getElementById('if-strength-bar');
        const lbl = document.getElementById('if-strength-label');
        if (bar) { bar.style.width=s.score+'%'; bar.style.background=s.color; }
        if (lbl) { lbl.textContent=e.target.value?s.label:''; lbl.style.color=s.color; }
      };
      if (this._item?.password) pwInp.dispatchEvent(new Event('input'));
    }
    const genBtn = document.getElementById('if-gen-btn');
    if (genBtn) {
      genBtn.onclick = () => GeneratorPage.quickGenerate(pwd => {
        const inp = document.getElementById('if-password');
        if (inp) { inp.value=pwd; inp.dispatchEvent(new Event('input')); }
      });
    }
    const cardNum = document.getElementById('if-cardNumber');
    if (cardNum) {
      cardNum.oninput = e => { let v=e.target.value.replace(/\D/g,'').slice(0,16); e.target.value=v.replace(/(\d{4})/g,'$1 ').trim(); };
    }
    const expMonth = document.getElementById('if-expMonth');
    const expYear  = document.getElementById('if-expYear');
    if (expMonth) {
      expMonth.oninput = e => { let v=e.target.value.replace(/\D/g,'').slice(0,2); if(v.length===1&&parseInt(v)>1)v='0'+v; e.target.value=v; if(v.length===2)expYear?.focus(); };
      expMonth.onblur  = e => { if(e.target.value.length===1)e.target.value='0'+e.target.value; };
    }
    if (expYear) {
      expYear.oninput   = e => { e.target.value=e.target.value.replace(/\D/g,'').slice(0,2); };
      expYear.onkeydown = e => { if(e.key==='Backspace'&&e.target.value==='')expMonth?.focus(); };
    }
    document.getElementById('if-name')?.addEventListener('keydown', e => { if(e.key==='Enter'&&e.ctrlKey)this._save(); });
  },

  /* SAVE */
  async _save() {
    const { kb, AppState, Toast, Modal } = window.App;
    const name = document.getElementById('if-name')?.value?.trim();
    if (!name) { Toast.show('Name is required','error'); return; }

    const btn = document.getElementById('item-form-save');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const val     = id => document.getElementById(id)?.value || '';
    const checked = id => document.getElementById(id)?.checked || false;

    let item = { type:this._type, name, folderId:val('if-folder')||null, notes:val('if-notes'), favorite:checked('if-fav') };

    if (this._type==='login') {
      Object.assign(item, { username:val('if-username'), password:val('if-password'), url:val('if-url'), totp:val('if-totp'), renewalDate: val('if-renewalDate') });
      item.customFields = (this._customFields||[]).filter(f=>f.label||f.value);
    } else if (this._type==='card') {
      Object.assign(item, {
        cardType:val('if-cardType'), cardHolder:val('if-cardHolder'),
        cardNumber:val('if-cardNumber').replace(/\s/g,''),
        expMonth:val('if-expMonth').padStart(2,'0'),
        expYear:val('if-expYear')?'20'+val('if-expYear').slice(-2):'',
        cvv:val('if-cvv'), pin:val('if-pin'),
      });
    } else if (this._type==='identity') {
      this._syncSocialsFromDom();
      Object.assign(item, {
        firstName:val('if-firstName'), lastName:val('if-lastName'),
        username:val('if-username'),   email:val('if-email'),
        phone:val('if-phone'),         whatsapp:val('if-whatsapp'),
        company:val('if-company'),     jobTitle:val('if-jobTitle'),
        address1:val('if-address1'),   address2:val('if-address2'),
        city:val('if-city'),           state:val('if-state'),
        zip:val('if-zip'),             country:val('if-country'),
        ssn:val('if-ssn'),             passport:val('if-passport'),
        license:val('if-license'),
        socialAccounts: this._socialAccounts.filter(s=>s.title||s.username||s.url),
      });
      item.customFields = (this._customFields||[]).filter(f=>f.label||f.value);
    } else if (this._type==='passkey') {
      Object.assign(item, { rpId:val('if-rpId'), username:val('if-username'), credentialId:val('if-credentialId') });
    } else if (this._type==='website') {
      Object.assign(item, {
        url: val('if-url'), renewalDate: val('if-renewalDate'),
        hostingProvider: val('if-hostingProvider'), hostingUrl: val('if-hostingUrl'),
        hostingUsername: val('if-hostingUsername'), hostingPassword: val('if-hostingPassword'),
        domainRegistrar: val('if-domainRegistrar'), nameservers: val('if-nameservers'),
        registrarUsername: val('if-registrarUsername'), registrarPassword: val('if-registrarPassword'),
        cmsUrl: val('if-cmsUrl'), cmsUsername: val('if-cmsUsername'), cmsPassword: val('if-cmsPassword'),
        ftpHost: val('if-ftpHost'), ftpPort: val('if-ftpPort'),
        ftpUsername: val('if-ftpUsername'), ftpPassword: val('if-ftpPassword'),
      });
      item.customFields = (this._customFields||[]).filter(f=>f.label||f.value);
    }

    let result;
    if (this._mode==='add') { result = await kb.items.add(item); }
    else                    { result = await kb.items.update(this._item.id, item); }

    btn.disabled = false;
    btn.textContent = this._mode==='add' ? 'Add Item' : 'Save Changes';

    if (result && (result.id||result.success!==false)) {
      AppState.items = await kb.items.getAll();
      VaultPage._renderItems();
      VaultPage._updateCounts();
      Modal.close();
      Toast.show(this._mode==='add'?'Item added':'Item saved','success');
      if (result.id) {
        const newItem = AppState.items.find(i=>i.id===result.id)||AppState.items.find(i=>i.id===this._item?.id);
        if (newItem) { window.App.AppState.selectedItem=newItem; VaultPage._showDetail(newItem); }
      }
    } else { Toast.show('Error: '+(result?.error||'Unknown'),'error'); }
  },
};

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
