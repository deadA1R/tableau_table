const ComputedColumns = (() => {
  const STORAGE_KEY = 'advtable_computed_v1';
  let _worksheetName = 'default';
  let _onSave = null;
  let _allColumns = [];
  let _config = [];

  function _genId() { return 'cc' + Math.random().toString(36).slice(2, 9); }

  function init(onSave) { _onSave = onSave; }

  function load(wsName) {
    _worksheetName = wsName;
    try {
      const raw = localStorage.getItem(STORAGE_KEY + '_' + wsName);
      _config = raw ? JSON.parse(raw) : [];
    } catch(e) { _config = []; }
  }

  function save(wsName) {
    try {
      localStorage.setItem(STORAGE_KEY + '_' + (wsName || _worksheetName), JSON.stringify(_config));
    } catch(e) {}
  }

  function getConfig() { return _config; }

  // Apply computed columns to data in place
  function applyToData(data, columns) {
    if (!_config.length) return;
    _config.forEach(cc => {
      // Upsert into columns list
      const idx = columns.findIndex(c => c.field === cc.id);
      if (idx === -1) columns.push({ field: cc.id, headerName: cc.name });
      else columns[idx].headerName = cc.name;

      data.forEach(row => {
        row[cc.id] = _compute(row, cc);
      });
    });
  }

  function _parseNum(val) {
    return parseFloat(String(val ?? '').replace(/[^0-9.\-]/g, ''));
  }

  function _compute(row, cc) {
    try {
      const src  = cc.sourceColumns || [];
      const nums = src.map(f => _parseNum(row[f]));

      switch (cc.type) {
        case 'sum':   { const v = nums.filter(n => !isNaN(n)); return v.length ? String(v.reduce((a,b) => a+b, 0)) : ''; }
        case 'avg':   { const v = nums.filter(n => !isNaN(n)); return v.length ? String(+(v.reduce((a,b) => a+b, 0) / v.length).toFixed(6)) : ''; }
        case 'min':   { const v = nums.filter(n => !isNaN(n)); return v.length ? String(Math.min(...v)) : ''; }
        case 'max':   { const v = nums.filter(n => !isNaN(n)); return v.length ? String(Math.max(...v)) : ''; }
        case 'diff':  return (!isNaN(nums[0]) && !isNaN(nums[1])) ? String(nums[0] - nums[1]) : '';
        case 'ratio': return (!isNaN(nums[0]) && !isNaN(nums[1]) && nums[1] !== 0) ? String(+(nums[0] / nums[1]).toFixed(6)) : '';
        case 'pct':   return (!isNaN(nums[0]) && !isNaN(nums[1]) && nums[1] !== 0) ? String(+(nums[0] / nums[1] * 100).toFixed(2)) : '';
        case 'custom': {
          // eslint-disable-next-line no-new-func
          const result = new Function('row', '"use strict"; return (' + cc.expression + ')')(row);
          return (result === null || result === undefined) ? '' : String(result);
        }
      }
    } catch(e) { return '#ERR'; }
    return '';
  }

  // ── Modal ───────────────────────────────────────────────────────────────────

  function open(columns, wsName) {
    _allColumns = columns.filter(c => !c.field.startsWith('cc')); // exclude other computed cols
    load(wsName);

    let modal = document.getElementById('cc-modal');
    if (!modal) { modal = _buildModal(); document.getElementById('app').appendChild(modal); }
    _renderBody();
    modal.classList.remove('hidden');
  }

  function _close() { document.getElementById('cc-modal')?.classList.add('hidden'); }

  function _buildModal() {
    const modal = document.createElement('div');
    modal.id = 'cc-modal';
    modal.className = 'modal hidden';

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.onclick = _close;

    const content = document.createElement('div');
    content.className = 'modal-content wide';

    const h2 = document.createElement('h2');
    h2.textContent = 'Computed Columns';

    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:12px;color:#888;margin:-10px 0 14px';
    hint.textContent = 'Create virtual columns derived from existing data. Computed columns update automatically when data refreshes.';

    const body = document.createElement('div');
    body.id = 'cc-body';
    body.style.cssText = 'flex:1;overflow-y:auto;min-height:80px';

    const addBtn = document.createElement('button');
    addBtn.className = 'tree-btn tree-btn-add';
    addBtn.style.cssText = 'margin-top:10px;width:100%;font-size:12px';
    addBtn.textContent = '+ Add computed column';
    addBtn.onclick = () => {
      _config.push({ id: _genId(), name: 'New Column', type: 'sum', sourceColumns: [], expression: '' });
      _renderBody();
    };

    const btns = document.createElement('div');
    btns.className = 'modal-buttons';

    const apply = document.createElement('button');
    apply.className = 'btn-primary';
    apply.textContent = 'Apply';
    apply.onclick = _save;

    const cancel = document.createElement('button');
    cancel.className = 'btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.onclick = _close;

    btns.append(apply, cancel);
    content.append(h2, hint, body, addBtn, btns);
    modal.append(bd, content);
    return modal;
  }

  const OP_TYPES = [
    ['sum',    'Σ  Sum of selected columns'],
    ['avg',    'Ø  Average of selected columns'],
    ['min',    '↓  Min of selected columns'],
    ['max',    '↑  Max of selected columns'],
    ['diff',   'A − B  Difference (2 columns)'],
    ['ratio',  'A ÷ B  Ratio (2 columns)'],
    ['pct',    'A ÷ B × 100  Percent (2 columns)'],
    ['custom', '{ }  Custom JS expression'],
  ];

  function _renderBody() {
    const body = document.getElementById('cc-body');
    if (!body) return;
    body.innerHTML = '';
    if (!_config.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:#aaa;font-size:12px;padding:16px 0;text-align:center';
      empty.textContent = 'No computed columns yet. Click "+ Add" below.';
      body.appendChild(empty);
      return;
    }
    _config.forEach((cc, idx) => body.appendChild(_buildRow(cc, idx)));
  }

  function _buildRow(cc, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'cc-row';

    // ── Top: name + type + delete ──
    const top = document.createElement('div');
    top.className = 'cc-top';

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'cc-name-inp';
    nameInp.placeholder = 'Column name';
    nameInp.value = cc.name;
    nameInp.oninput = (e) => { cc.name = e.target.value; };

    const typeSel = document.createElement('select');
    typeSel.className = 'cc-type-sel';
    OP_TYPES.forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t; o.selected = cc.type === v;
      typeSel.appendChild(o);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'tree-btn tree-btn-del';
    delBtn.textContent = '✕';
    delBtn.onclick = () => { _config.splice(idx, 1); _renderBody(); };

    top.append(nameInp, typeSel, delBtn);

    // ── Source ──
    const src = document.createElement('div');
    src.className = 'cc-src';

    const renderSrc = () => {
      src.innerHTML = '';
      cc.type = typeSel.value;

      if (cc.type === 'custom') {
        const lbl = document.createElement('div');
        lbl.className = 'cc-src-label';
        lbl.innerHTML = 'JS expression &mdash; access any column via <code>row["ColumnName"]</code>:';

        const ta = document.createElement('textarea');
        ta.className = 'cc-expr-ta';
        ta.placeholder = 'row["Использовано"] / row["Лимит"] * 100';
        ta.value = cc.expression || '';
        ta.oninput = (e) => { cc.expression = e.target.value; };

        src.append(lbl, ta);
      } else {
        const is2 = ['diff','ratio','pct'].includes(cc.type);
        const lbl = document.createElement('div');
        lbl.className = 'cc-src-label';
        lbl.textContent = is2 ? 'Select exactly 2 columns (A then B):' : 'Select columns:';

        const grid = document.createElement('div');
        grid.className = 'cc-cols-grid';

        _allColumns.forEach(col => {
          const label = document.createElement('label');
          label.className = 'cc-col-item';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = (cc.sourceColumns || []).includes(col.field);
          cb.onchange = () => {
            if (cb.checked) {
              if (is2 && cc.sourceColumns.length >= 2) { cb.checked = false; return; }
              if (!cc.sourceColumns.includes(col.field)) cc.sourceColumns.push(col.field);
            } else {
              cc.sourceColumns = cc.sourceColumns.filter(f => f !== col.field);
            }
            // Show order badges for 2-col ops
            if (is2) _updateOrderBadges(grid);
          };

          const badge = document.createElement('span');
          badge.className = 'cc-order-badge';
          const pos = (cc.sourceColumns || []).indexOf(col.field);
          badge.textContent = pos >= 0 ? String(pos + 1) : '';

          label.append(cb, badge, document.createTextNode(' ' + (col.headerName || col.field)));
          label.dataset.field = col.field;
          grid.appendChild(label);
        });

        if (is2) _updateOrderBadges(grid);
        src.append(lbl, grid);
      }
    };

    typeSel.onchange = renderSrc;
    renderSrc();

    wrap.append(top, src);
    return wrap;
  }

  function _updateOrderBadges(grid) {
    const checked = [...grid.querySelectorAll('input[type=checkbox]:checked')];
    grid.querySelectorAll('.cc-col-item').forEach(item => {
      const cb  = item.querySelector('input[type=checkbox]');
      const bdg = item.querySelector('.cc-order-badge');
      const pos = checked.indexOf(cb);
      bdg.textContent = pos >= 0 ? String(pos + 1) : '';
    });
  }

  function _save() {
    _close();
    save(_worksheetName);
    if (_onSave) _onSave();
  }

  return { init, load, save, getConfig, applyToData, open };
})();
