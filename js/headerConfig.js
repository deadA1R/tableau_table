const HeaderConfig = (() => {
  const STORAGE_KEY = 'advtable_header_config_v2';
  let _columns = [];
  let _worksheetName = 'default';
  let _onSave = null;

  let _config = _defaultConfig();

  function _defaultConfig() {
    return {
      renames: {},
      globalHeaderBg: '#f5f7fa',
      globalHeaderColor: '#333333',
      tree: [],   // array of group/field nodes
    };
  }

  // Node shapes:
  //   { type:'group', id, name, bg, textColor, children:[] }
  //   { type:'field', field }

  function _genId() {
    return 'g' + Math.random().toString(36).slice(2, 9);
  }

  function _addPaletteBtn(inp, onChange) {
    if (!inp || inp.nextElementSibling?.classList.contains('pal-inline-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pal-inline-btn';
    btn.title = 'Pick from palette';
    btn.textContent = '▤';
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      Palettes.showPicker(btn, (c) => { inp.value = c; onChange(c); });
    };
    inp.after(btn);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  function init(onSave) {
    _onSave = onSave;
    document.getElementById('btn-save-header').onclick = _save;
    document.getElementById('btn-cancel-header').onclick = close;
    document.getElementById('header-modal').querySelector('.modal-backdrop').onclick = close;
    document.getElementById('btn-add-root-group').onclick = () => {
      _config.tree.push({ type: 'group', id: _genId(), name: 'New Group', bg: '', textColor: '', children: [] });
      _renderTree();
    };
    const bgInp = document.getElementById('hdr-global-bg');
    bgInp.oninput = (e) => { _config.globalHeaderBg = e.target.value; _injectStyles(); };
    _addPaletteBtn(bgInp, (c) => { _config.globalHeaderBg = c; _injectStyles(); });

    const colorInp = document.getElementById('hdr-global-color');
    colorInp.oninput = (e) => { _config.globalHeaderColor = e.target.value; _injectStyles(); };
    _addPaletteBtn(colorInp, (c) => { _config.globalHeaderColor = c; _injectStyles(); });
  }

  function load(wsName) {
    _worksheetName = wsName;
    try {
      const raw = localStorage.getItem(STORAGE_KEY + '_' + wsName);
      _config = raw ? JSON.parse(raw) : _defaultConfig();
    } catch (e) {
      _config = _defaultConfig();
    }
  }

  function save(wsName) {
    try {
      localStorage.setItem(STORAGE_KEY + '_' + (wsName || _worksheetName), JSON.stringify(_config));
    } catch (e) {}
  }

  function open(columns, wsName) {
    _columns = columns;
    load(wsName);
    document.getElementById('hdr-global-bg').value    = _config.globalHeaderBg || '#f5f7fa';
    document.getElementById('hdr-global-color').value = _config.globalHeaderColor || '#333333';
    _renderTree();
    _renderUnassigned();
    document.getElementById('header-modal').classList.remove('hidden');
  }

  function close() {
    document.getElementById('header-modal').classList.add('hidden');
  }

  // ── Tree rendering ─────────────────────────────────────────────────────

  function _allFieldsInTree(nodes) {
    const fields = new Set();
    function walk(arr) {
      arr.forEach(n => {
        if (n.type === 'field') fields.add(n.field);
        else if (n.children) walk(n.children);
      });
    }
    walk(nodes);
    return fields;
  }

  function _renderTree() {
    const container = document.getElementById('hdr-tree');
    container.innerHTML = '';
    _config.tree.forEach((node, i) => {
      container.appendChild(_buildNodeEl(node, _config.tree, i, 0));
    });
    _renderUnassigned();
    _injectStyles();
  }

  function _renderUnassigned() {
    const assigned = _allFieldsInTree(_config.tree);
    const unassigned = _columns.filter(c => !assigned.has(c.field));
    const container = document.getElementById('hdr-unassigned');
    container.innerHTML = '';
    if (!unassigned.length) {
      container.innerHTML = '<span style="color:#999;font-size:12px">All fields are assigned to groups</span>';
      return;
    }
    unassigned.forEach(col => {
      const chip = document.createElement('span');
      chip.className = 'unassigned-chip';
      chip.textContent = _config.renames[col.field] || col.field;
      chip.title = col.field;
      container.appendChild(chip);
    });
  }

  function _buildNodeEl(node, parentArr, idx, depth) {
    if (node.type === 'field') return _buildFieldEl(node, parentArr, idx, depth);
    return _buildGroupEl(node, parentArr, idx, depth);
  }

  function _buildGroupEl(node, parentArr, idx, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-group';
    wrap.style.marginLeft = depth * 16 + 'px';

    // Header row
    const row = document.createElement('div');
    row.className = 'tree-group-row';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '▼';
    let collapsed = false;
    toggle.onclick = () => {
      collapsed = !collapsed;
      toggle.textContent = collapsed ? '▶' : '▼';
      childrenWrap.style.display = collapsed ? 'none' : '';
    };

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tree-group-name';
    nameInput.value = node.name || '';
    nameInput.placeholder = 'Group name…';
    nameInput.oninput = (e) => { node.name = e.target.value; _injectStyles(); };

    const bgPicker = _colorPicker(node.bg || _config.globalHeaderBg, (v) => { node.bg = v; _injectStyles(); }, 'Bg');
    const txtPicker = _colorPicker(node.textColor || _config.globalHeaderColor, (v) => { node.textColor = v; _injectStyles(); }, 'Txt');

    const addGroupBtn = document.createElement('button');
    addGroupBtn.className = 'tree-btn';
    addGroupBtn.textContent = '+ Group';
    addGroupBtn.title = 'Add sub-group';
    addGroupBtn.onclick = () => {
      node.children.push({ type: 'group', id: _genId(), name: 'New Group', bg: '', textColor: '', children: [] });
      _renderTree();
    };

    const addFieldsBtn = document.createElement('button');
    addFieldsBtn.className = 'tree-btn';
    addFieldsBtn.textContent = '+ Fields';
    addFieldsBtn.title = 'Add fields to this group';
    addFieldsBtn.onclick = () => _showFieldPicker(node, wrap);

    const upBtn   = _moveBtn('↑', () => { if (idx > 0) { _swap(parentArr, idx, idx-1); _renderTree(); } });
    const downBtn = _moveBtn('↓', () => { if (idx < parentArr.length-1) { _swap(parentArr, idx, idx+1); _renderTree(); } });

    const delBtn = document.createElement('button');
    delBtn.className = 'tree-btn tree-btn-del';
    delBtn.textContent = '✕';
    delBtn.onclick = () => { parentArr.splice(idx, 1); _renderTree(); };

    row.append(toggle, nameInput, bgPicker, txtPicker, addGroupBtn, addFieldsBtn, upBtn, downBtn, delBtn);

    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'tree-children';
    node.children.forEach((child, ci) => {
      childrenWrap.appendChild(_buildNodeEl(child, node.children, ci, depth + 1));
    });

    wrap.append(row, childrenWrap);
    return wrap;
  }

  function _buildFieldEl(node, parentArr, idx, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-field';
    wrap.style.marginLeft = depth * 16 + 'px';

    const col = _columns.find(c => c.field === node.field);
    const origName = col?.field ?? node.field;

    const icon = document.createElement('span');
    icon.className = 'tree-field-icon';
    icon.textContent = '▪';

    const origLabel = document.createElement('span');
    origLabel.className = 'tree-field-orig';
    origLabel.textContent = origName;

    const arrow = document.createElement('span');
    arrow.style.cssText = 'color:#ccc;margin:0 4px';
    arrow.textContent = '→';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tree-field-rename';
    nameInput.value = _config.renames[node.field] ?? '';
    nameInput.placeholder = origName;
    nameInput.oninput = (e) => {
      if (e.target.value.trim()) _config.renames[node.field] = e.target.value.trim();
      else delete _config.renames[node.field];
    };

    const bgPicker = _colorPicker(
      _config.fieldColors?.[node.field]?.bg ?? '',
      (v) => { if (!_config.fieldColors) _config.fieldColors = {}; if (!_config.fieldColors[node.field]) _config.fieldColors[node.field] = {}; _config.fieldColors[node.field].bg = v; _injectStyles(); },
      'Bg'
    );

    const upBtn   = _moveBtn('↑', () => { if (idx > 0) { _swap(parentArr, idx, idx-1); _renderTree(); } });
    const downBtn = _moveBtn('↓', () => { if (idx < parentArr.length-1) { _swap(parentArr, idx, idx+1); _renderTree(); } });

    const delBtn = document.createElement('button');
    delBtn.className = 'tree-btn tree-btn-del';
    delBtn.textContent = '✕';
    delBtn.onclick = () => { parentArr.splice(idx, 1); _renderTree(); };

    wrap.append(icon, origLabel, arrow, nameInput, bgPicker, upBtn, downBtn, delBtn);
    return wrap;
  }

  function _colorPicker(value, onChange, label) {
    return Palettes.colorInput(value || '#f5f7fa', onChange, label);
  }

  function _moveBtn(label, onclick) {
    const btn = document.createElement('button');
    btn.className = 'tree-btn';
    btn.textContent = label;
    btn.onclick = onclick;
    return btn;
  }

  function _swap(arr, i, j) {
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  // ── Field picker popup ─────────────────────────────────────────────────

  function _showFieldPicker(targetNode, anchorEl) {
    document.getElementById('field-picker-popup')?.remove();

    const assigned = _allFieldsInTree(_config.tree);
    const available = _columns.filter(c => !assigned.has(c.field));

    if (!available.length) {
      alert('All fields are already assigned to groups.');
      return;
    }

    const popup = document.createElement('div');
    popup.id = 'field-picker-popup';
    popup.className = 'field-picker-popup';

    const title = document.createElement('div');
    title.className = 'field-picker-title';
    title.textContent = 'Add fields to group:';
    popup.appendChild(title);

    const list = document.createElement('div');
    list.className = 'field-picker-list';

    available.forEach(col => {
      const item = document.createElement('label');
      item.className = 'field-picker-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';

      const name = _config.renames[col.field] || col.field;
      item.append(cb, document.createTextNode(' ' + name));
      list.appendChild(item);

      cb._field = col.field;
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.style.cssText = 'margin-top:8px;width:100%;font-size:12px;padding:5px';
    addBtn.textContent = 'Add selected';
    addBtn.onclick = () => {
      list.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
        targetNode.children.push({ type: 'field', field: cb._field });
      });
      popup.remove();
      _renderTree();
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.style.cssText = 'margin-top:4px;width:100%;font-size:12px;padding:4px';
    closeBtn.textContent = 'Cancel';
    closeBtn.onclick = () => popup.remove();

    popup.append(list, addBtn, closeBtn);

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    const modalRect = document.getElementById('header-modal').querySelector('.modal-content').getBoundingClientRect();
    popup.style.top  = (rect.bottom - modalRect.top + 4) + 'px';
    popup.style.left = (rect.left   - modalRect.left) + 'px';

    document.getElementById('header-modal').querySelector('.modal-content').appendChild(popup);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 0);
  }

  // ── CSS injection ──────────────────────────────────────────────────────

  function _injectStyles() {
    let styleEl = document.getElementById('adv-header-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'adv-header-styles';
      document.head.appendChild(styleEl);
    }

    let css = `
      .ag-header-cell, .ag-header-group-cell {
        background-color: ${_config.globalHeaderBg || '#f5f7fa'} !important;
        color: ${_config.globalHeaderColor || '#333'} !important;
      }
    `;

    function walkForCss(nodes) {
      nodes.forEach(node => {
        if (node.type === 'group') {
          if (node.bg || node.textColor) {
            css += `
              .ag-header-group-cell.hdr-${node.id} {
                ${node.bg        ? `background-color: ${node.bg} !important;`  : ''}
                ${node.textColor ? `color: ${node.textColor} !important;`      : ''}
              }
            `;
          }
          if (node.children) walkForCss(node.children);
        } else if (node.type === 'field') {
          const fc = _config.fieldColors?.[node.field];
          if (fc?.bg) {
            css += `
              .ag-header-cell.hdr-field-${node.field.replace(/[^a-zA-Z0-9]/g, '_')} {
                background-color: ${fc.bg} !important;
              }
            `;
          }
        }
      });
    }

    walkForCss(_config.tree);
    styleEl.textContent = css;
  }

  // ── Build AG Grid column defs ──────────────────────────────────────────

  function applyToColDefs(rawColDefs) {
    _injectStyles();
    if (!rawColDefs.length) return rawColDefs;

    const byField = Object.fromEntries(rawColDefs.map(d => [d.field, d]));
    const assignedFields = _allFieldsInTree(_config.tree);

    function buildNode(node) {
      if (node.type === 'field') {
        const base = byField[node.field];
        if (!base) return null;
        const rename = _config.renames[node.field];
        const fieldClass = 'hdr-field-' + node.field.replace(/[^a-zA-Z0-9]/g, '_');
        return { ...base, headerName: rename || base.headerName, headerClass: fieldClass };
      }

      if (node.type === 'group') {
        const children = node.children.map(buildNode).filter(Boolean);
        if (!children.length) return null;
        return {
          headerName: node.name || 'Group',
          headerClass: 'hdr-' + node.id,
          marryChildren: true,
          children,
        };
      }
      return null;
    }

    const result = [];
    const insertedGroupIds = new Set();

    // Walk original rawColDefs order to preserve field order
    rawColDefs.forEach(def => {
      if (!assignedFields.has(def.field)) {
        // Not in any group — add as-is with rename
        const rename = _config.renames[def.field];
        result.push(rename ? { ...def, headerName: rename } : def);
        return;
      }

      // Find which root-level group this field belongs to (may be nested)
      const rootGroupIdx = _config.tree.findIndex(n => n.type === 'group' && _fieldInNode(n, def.field));
      if (rootGroupIdx === -1) {
        result.push(def);
        return;
      }

      const rootGroup = _config.tree[rootGroupIdx];
      if (!insertedGroupIds.has(rootGroup.id)) {
        insertedGroupIds.add(rootGroup.id);
        const built = buildNode(rootGroup);
        if (built) result.push(built);
      }
    });

    return result;
  }

  function _fieldInNode(node, field) {
    if (node.type === 'field') return node.field === field;
    if (node.children) return node.children.some(c => _fieldInNode(c, field));
    return false;
  }

  function getConfig() { return _config; }

  // ── Save ───────────────────────────────────────────────────────────────

  function _save() {
    close();
    save(_worksheetName);
    if (_onSave) _onSave();
  }

  return { init, open, close, load, save, applyToColDefs, getConfig };
})();
