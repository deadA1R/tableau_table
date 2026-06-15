const DisplayConfig = (() => {
  const STORAGE_KEY = 'advtable_display_v1';
  let _worksheetName = 'default';
  let _columns = [];
  let _onSave = null;

  let _config = _default();
  let _rowCount = 0;

  function _default() {
    return {
      fontFamily: 'inherit',
      fontSize: 13,
      fontWeight: 'normal',
      showSeparators: true,
      fitToWidth: false,
      rowHeight: 32,
      frozenColumns: 0,
      sortRules: [],
      subtotals: {
        enabled: false,
        operations: {},
        labelText: 'Итого',
        bgColor: '#e8f0fe',
        textColor: '#1a237e',
        showGrandTotal: false,
        grandTotalLabel: 'Grand Total',
      },
      manualMergeGroups: [],
      columns: {},
    };
  }

  function _colDefault() {
    return {
      hidden: false,
      align: 'center',
      numberFormat: { decimals: '', thousandsSep: false, prefix: '', suffix: '' },
      aliases: {},
      rules: [],
    };
  }

  function _genId() {
    return 'm' + Math.random().toString(36).slice(2, 9);
  }

  // ── Public ─────────────────────────────────────────────────────────────

  function init(onSave) {
    _onSave = onSave;
    document.getElementById('btn-save-display').onclick  = _save;
    document.getElementById('btn-cancel-display').onclick = close;
    document.getElementById('display-modal').querySelector('.modal-backdrop').onclick = close;
  }

  function load(wsName) {
    _worksheetName = wsName;
    try {
      const raw = localStorage.getItem(STORAGE_KEY + '_' + wsName);
      if (!raw) { _config = _default(); return; }
      const saved = JSON.parse(raw);
      const def   = _default();
      _config = Object.assign(def, saved);
      _config.subtotals         = Object.assign(def.subtotals, saved.subtotals || {});
      _config.columns           = saved.columns || {};
      _config.manualMergeGroups = saved.manualMergeGroups || [];
      _config.sortRules         = saved.sortRules || [];
    } catch (e) { _config = _default(); }
  }

  function save(wsName) {
    try {
      localStorage.setItem(STORAGE_KEY + '_' + (wsName || _worksheetName), JSON.stringify(_config));
    } catch (e) {}
  }

  function open(columns, wsName, rowCount) {
    _columns = columns;
    _rowCount = rowCount || 0;
    load(wsName);
    if (!_config.sortRules) _config.sortRules = [];
    if (!_config.subtotals) _config.subtotals = _default().subtotals;
    if (!_config.manualMergeGroups) _config.manualMergeGroups = [];
    _renderGlobal();
    _renderSort();
    _renderSubtotals();
    _renderManualMerges();
    _renderColumns();
    document.getElementById('display-modal').classList.remove('hidden');
  }

  function close() {
    document.getElementById('display-modal').classList.add('hidden');
  }

  function getConfig() { return _config; }

  // Apply a valueFormatter: number format → aliases
  function makeValueFormatter(field) {
    return (params) => {
      const cfg = _config.columns[field];
      const raw = params.value ?? '';

      // Aliases checked first on raw value
      if (cfg?.aliases) {
        const key = raw === null || raw === undefined ? 'null' : String(raw);
        const alias = cfg.aliases[key] ?? cfg.aliases['*'];
        if (alias !== undefined) return alias;
      }

      // Number formatting
      const nf = cfg?.numberFormat;
      if (nf && (nf.decimals !== '' && nf.decimals != null || nf.prefix || nf.suffix || nf.thousandsSep)) {
        const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(num)) {
          const dec = (nf.decimals !== '' && nf.decimals != null) ? parseInt(nf.decimals) : null;
          let s = dec !== null ? num.toFixed(dec) : String(raw);
          if (nf.thousandsSep && dec !== null) {
            const [intPart, fracPart] = s.split('.');
            s = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fracPart !== undefined ? '.' + fracPart : '');
          }
          return (nf.prefix || '') + s + (nf.suffix || '');
        }
      }

      return raw;
    };
  }

  // Apply a cellStyle: alignment from config + conditional formatting
  function makeCellStyle(field) {
    return (params) => {
      const cfg = _config.columns[field];
      const base = { textAlign: cfg?.align || 'center' };
      if (!cfg?.rules?.length) return base;
      for (const rule of cfg.rules) {
        if (_matchRule(params.value, rule)) {
          return { ...base, backgroundColor: rule.bg || null, color: rule.color || null };
        }
      }
      return base;
    };
  }

  function _matchRule(value, rule) {
    const v = value === null || value === undefined ? '' : String(value);
    const r = String(rule.value ?? '');
    switch (rule.type) {
      case 'equals':      return v === r;
      case 'not_equals':  return v !== r;
      case 'contains':    return v.toLowerCase().includes(r.toLowerCase());
      case 'starts_with': return v.toLowerCase().startsWith(r.toLowerCase());
      case 'ends_with':   return v.toLowerCase().endsWith(r.toLowerCase());
      case 'is_null':     return value === null || value === undefined || v === '';
      case 'not_null':    return value !== null && value !== undefined && v !== '';
      case 'gt':          return parseFloat(v) > parseFloat(r);
      case 'lt':          return parseFloat(v) < parseFloat(r);
      case 'gte':         return parseFloat(v) >= parseFloat(r);
      case 'lte':         return parseFloat(v) <= parseFloat(r);
      default:            return false;
    }
  }

  // ── Global settings render ─────────────────────────────────────────────

  function _renderGlobal() {
    document.getElementById('disp-font-family').value    = _config.fontFamily || 'inherit';
    document.getElementById('disp-font-size').value      = _config.fontSize || 13;
    document.getElementById('disp-font-weight').checked  = _config.fontWeight === 'bold';
    document.getElementById('disp-separators').checked   = _config.showSeparators !== false;
    document.getElementById('disp-fit-width').checked    = !!_config.fitToWidth;
    document.getElementById('disp-row-height').value     = String(_config.rowHeight || 32);
    document.getElementById('disp-freeze-cols').value    = _config.frozenColumns || 0;

    document.getElementById('btn-add-sort').onclick = () => {
      if (!_config.sortRules) _config.sortRules = [];
      const firstField = _columns[0]?.field ?? '';
      _config.sortRules.push({ field: firstField, direction: 'asc' });
      _renderSort();
    };

    document.getElementById('disp-font-family').onchange  = (e) => { _config.fontFamily = e.target.value; };
    document.getElementById('disp-font-size').oninput     = (e) => { _config.fontSize = parseInt(e.target.value) || 13; };
    document.getElementById('disp-font-weight').onchange  = (e) => { _config.fontWeight = e.target.checked ? 'bold' : 'normal'; };
    document.getElementById('disp-separators').onchange   = (e) => { _config.showSeparators = e.target.checked; };
    document.getElementById('disp-fit-width').onchange    = (e) => { _config.fitToWidth = e.target.checked; };
    document.getElementById('disp-row-height').onchange   = (e) => { _config.rowHeight = parseInt(e.target.value) || 32; };
    document.getElementById('disp-freeze-cols').oninput   = (e) => { _config.frozenColumns = Math.max(0, parseInt(e.target.value) || 0); };
  }

  // ── Sort render ────────────────────────────────────────────────────────

  function _renderSort() {
    const container = document.getElementById('disp-sort-list');
    if (!container) return;
    container.innerHTML = '';
    (_config.sortRules || []).forEach((rule, i) => {
      container.appendChild(_buildSortRow(rule, i));
    });
  }

  function _buildSortRow(rule, idx) {
    const row = document.createElement('div');
    row.className = 'sort-row';

    const priority = document.createElement('span');
    priority.className = 'sort-priority';
    priority.textContent = idx + 1;

    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'sort-field-select';
    _columns.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col.field;
      opt.textContent = col.field;
      opt.selected = col.field === rule.field;
      fieldSelect.appendChild(opt);
    });
    fieldSelect.onchange = (e) => { rule.field = e.target.value; };

    const dirSelect = document.createElement('select');
    dirSelect.className = 'sort-dir-select';
    [['asc', '↑ Ascending'], ['desc', '↓ Descending']].forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      opt.selected = rule.direction === val;
      dirSelect.appendChild(opt);
    });
    dirSelect.onchange = (e) => { rule.direction = e.target.value; };

    const upBtn = document.createElement('button');
    upBtn.className = 'tree-btn';
    upBtn.textContent = '↑';
    upBtn.onclick = () => {
      if (idx > 0) { [_config.sortRules[idx-1], _config.sortRules[idx]] = [_config.sortRules[idx], _config.sortRules[idx-1]]; _renderSort(); }
    };

    const downBtn = document.createElement('button');
    downBtn.className = 'tree-btn';
    downBtn.textContent = '↓';
    downBtn.onclick = () => {
      if (idx < _config.sortRules.length-1) { [_config.sortRules[idx], _config.sortRules[idx+1]] = [_config.sortRules[idx+1], _config.sortRules[idx]]; _renderSort(); }
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'tree-btn tree-btn-del';
    delBtn.textContent = '✕';
    delBtn.onclick = () => { _config.sortRules.splice(idx, 1); _renderSort(); };

    row.append(priority, fieldSelect, dirSelect, upBtn, downBtn, delBtn);
    return row;
  }

  // ── Subtotals render ───────────────────────────────────────────────────

  function _renderSubtotals() {
    const st = _config.subtotals;
    const toggle = document.getElementById('disp-subtotals-enabled');
    const body   = document.getElementById('disp-subtotals-body');
    if (!toggle || !body) return;

    toggle.checked = !!st.enabled;
    body.classList.toggle('hidden', !st.enabled);
    toggle.onchange = (e) => {
      st.enabled = e.target.checked;
      body.classList.toggle('hidden', !st.enabled);
    };

    // Label text
    const labelInput = document.getElementById('disp-subtotals-label');
    if (labelInput) {
      labelInput.value = st.labelText || 'Итого';
      labelInput.oninput = (e) => { st.labelText = e.target.value; };
    }

    // Colors
    const bgEl = document.getElementById('disp-subtotals-bg');
    if (bgEl) { bgEl.value = st.bgColor || '#e8f0fe'; bgEl.oninput = (e) => { st.bgColor = e.target.value; }; }

    const txtEl = document.getElementById('disp-subtotals-txt');
    if (txtEl) { txtEl.value = st.textColor || '#1a237e'; txtEl.oninput = (e) => { st.textColor = e.target.value; }; }

    // Grand total
    const gtEnabled = document.getElementById('disp-grand-total-enabled');
    const gtLabel   = document.getElementById('disp-grand-total-label');
    if (gtEnabled) { gtEnabled.checked = !!st.showGrandTotal; gtEnabled.onchange = (e) => { st.showGrandTotal = e.target.checked; }; }
    if (gtLabel)   { gtLabel.value = st.grandTotalLabel || 'Grand Total'; gtLabel.oninput = (e) => { st.grandTotalLabel = e.target.value; }; }

    // Per-column operations for numeric columns
    const colsEl = document.getElementById('disp-subtotals-cols');
    if (!colsEl) return;
    colsEl.innerHTML = '';

    _columns.forEach(col => {
      const row = document.createElement('div');
      row.className = 'subtotal-col-row';

      const lbl = document.createElement('span');
      lbl.className = 'subtotal-col-name';
      lbl.textContent = col.field;

      const sel = document.createElement('select');
      sel.className = 'subtotal-op-select';
      [['', '— none —'], ['sum', 'Σ Sum'], ['count', '# Count'], ['avg', 'Ø Avg'], ['min', '↓ Min'], ['max', '↑ Max']]
        .forEach(([val, lbl]) => {
          const opt = document.createElement('option');
          opt.value = val; opt.textContent = lbl;
          opt.selected = (st.operations[col.field] ?? '') === val;
          sel.appendChild(opt);
        });
      sel.onchange = (e) => {
        if (e.target.value) st.operations[col.field] = e.target.value;
        else delete st.operations[col.field];
      };

      row.append(lbl, sel);
      colsEl.appendChild(row);
    });
  }

  // ── Manual row merge groups ────────────────────────────────────────────

  function _renderManualMerges() {
    const list = document.getElementById('disp-manual-list');
    const info = document.getElementById('disp-manual-info');
    if (!list) return;

    if (info) info.textContent = _rowCount > 0 ? `${_rowCount} rows in current data (0-based indices)` : '';

    document.getElementById('btn-add-manual-group').onclick = () => {
      _config.manualMergeGroups.push({ id: _genId(), rowStart: 0, rowEnd: 1, columns: [] });
      _renderManualMerges();
    };

    list.innerHTML = '';
    (_config.manualMergeGroups || []).forEach((group, i) => {
      list.appendChild(_buildManualGroupRow(group, i));
    });
  }

  function _buildManualGroupRow(group, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'manual-group-row';

    const delBtn = document.createElement('button');
    delBtn.className = 'tree-btn tree-btn-del';
    delBtn.textContent = '✕';
    delBtn.onclick = () => {
      _config.manualMergeGroups.splice(idx, 1);
      _renderManualMerges();
    };

    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'manual-group-range';

    const lbl = document.createElement('span');
    lbl.className = 'manual-group-label';
    lbl.textContent = 'Rows';

    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.className = 'manual-group-num';
    startInput.min = 0;
    startInput.max = Math.max(0, _rowCount - 1);
    startInput.value = group.rowStart;
    startInput.oninput = (e) => { group.rowStart = Math.max(0, parseInt(e.target.value) || 0); };

    const dash = document.createElement('span');
    dash.className = 'manual-group-dash';
    dash.textContent = '–';

    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.className = 'manual-group-num';
    endInput.min = 0;
    endInput.max = Math.max(0, _rowCount - 1);
    endInput.value = group.rowEnd;
    endInput.oninput = (e) => { group.rowEnd = Math.max(0, parseInt(e.target.value) || 0); };

    rangeWrap.append(lbl, startInput, dash, endInput);

    if (!group.colAgg) group.colAgg = {};

    const colsWrap = document.createElement('div');
    colsWrap.className = 'manual-cols-grid';

    const AGG_OPTS = [
      ['first', '— first'],
      ['avg',   'Ø avg'],
      ['sum',   'Σ sum'],
      ['min',   '↓ min'],
      ['max',   '↑ max'],
      ['last',  '↙ last'],
    ];

    _columns.forEach(col => {
      const item = document.createElement('div');
      item.className = 'manual-col-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = col.field;
      cb.checked = (group.columns || []).includes(col.field);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = col.headerName || col.field;
      nameSpan.style.flex = '1';

      const aggSel = document.createElement('select');
      aggSel.className = 'manual-agg-sel';
      AGG_OPTS.forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        o.selected = (group.colAgg[col.field] || 'first') === v;
        aggSel.appendChild(o);
      });
      aggSel.style.display = cb.checked ? '' : 'none';
      aggSel.onchange = (e) => { group.colAgg[col.field] = e.target.value; };

      cb.onchange = () => {
        if (cb.checked) {
          if (!group.columns.includes(col.field)) group.columns.push(col.field);
        } else {
          group.columns = group.columns.filter(f => f !== col.field);
          delete group.colAgg[col.field];
        }
        aggSel.style.display = cb.checked ? '' : 'none';
      };

      item.append(cb, nameSpan, aggSel);
      colsWrap.appendChild(item);
    });

    wrap.append(delBtn, rangeWrap, colsWrap);
    return wrap;
  }

  // ── Columns render ─────────────────────────────────────────────────────

  function _renderColumns() {
    const container = document.getElementById('disp-columns-list');
    container.innerHTML = '';
    _columns.forEach(col => {
      if (!_config.columns[col.field]) _config.columns[col.field] = _colDefault();
      else {
        const c = _config.columns[col.field];
        if (!c.numberFormat) c.numberFormat = _colDefault().numberFormat;
        if (c.align === undefined) c.align = 'center';
      }
      container.appendChild(_buildColSection(col));
    });
  }

  function _buildColSection(col) {
    const cfg = _config.columns[col.field];
    const section = document.createElement('div');
    section.className = 'disp-col-section';

    // ── Header row ──
    const header = document.createElement('div');
    header.className = 'disp-col-header';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '▶';

    const title = document.createElement('span');
    title.className = 'disp-col-title';
    title.textContent = col.field;
    title.style.flex = '1';

    // Visibility toggle in header
    const visLabel = document.createElement('label');
    visLabel.className = 'col-vis-label';
    visLabel.title = 'Show / hide column';
    const visCb = document.createElement('input');
    visCb.type = 'checkbox';
    visCb.checked = !cfg.hidden;
    visCb.onchange = (e) => {
      cfg.hidden = !e.target.checked;
      section.classList.toggle('col-hidden-preview', cfg.hidden);
    };
    visLabel.append(visCb, document.createTextNode(' Show'));
    section.classList.toggle('col-hidden-preview', !!cfg.hidden);

    const body = document.createElement('div');
    body.className = 'disp-col-body hidden';

    toggle.onclick = () => {
      body.classList.toggle('hidden');
      toggle.textContent = body.classList.contains('hidden') ? '▶' : '▼';
    };
    header.onclick = (e) => {
      if (e.target === visCb || e.target === visLabel || visLabel.contains(e.target)) return;
      toggle.click();
    };

    header.append(toggle, title, visLabel);

    // ── Style row (alignment) ──
    const styleWrap = document.createElement('div');
    styleWrap.className = 'col-style-row';

    const alignLabel = document.createElement('span');
    alignLabel.className = 'disp-sub-label';
    alignLabel.style.cssText = 'margin-bottom:0;align-self:center';
    alignLabel.textContent = 'Align';

    const alignSel = document.createElement('select');
    alignSel.className = 'col-align-select';
    [['left','← Left'],['center','↔ Center'],['right','→ Right']].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t; o.selected = (cfg.align || 'center') === v;
      alignSel.appendChild(o);
    });
    alignSel.onchange = (e) => { cfg.align = e.target.value; };

    styleWrap.append(alignLabel, alignSel);

    // ── Number format ──
    const nfWrap = document.createElement('div');
    nfWrap.className = 'col-nf-row';

    const nfLabel = document.createElement('span');
    nfLabel.className = 'disp-sub-label';
    nfLabel.style.cssText = 'margin-bottom:0;align-self:center;white-space:nowrap';
    nfLabel.textContent = 'Number format';

    const nf = cfg.numberFormat;

    const decInput = document.createElement('input');
    decInput.type = 'number'; decInput.min = 0; decInput.max = 6;
    decInput.className = 'col-nf-input'; decInput.placeholder = 'dec';
    decInput.title = 'Decimal places (leave empty for default)';
    decInput.value = nf.decimals ?? '';
    decInput.oninput = (e) => { nf.decimals = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)); };

    const sepLabel = document.createElement('label');
    sepLabel.className = 'col-nf-check-label'; sepLabel.title = 'Thousands separator';
    const sepCb = document.createElement('input');
    sepCb.type = 'checkbox'; sepCb.checked = !!nf.thousandsSep;
    sepCb.onchange = (e) => { nf.thousandsSep = e.target.checked; };
    sepLabel.append(sepCb, document.createTextNode(' 1 000'));

    const prefixInput = document.createElement('input');
    prefixInput.type = 'text'; prefixInput.className = 'col-nf-input col-nf-affix';
    prefixInput.placeholder = 'prefix'; prefixInput.title = 'Prefix (e.g. $, €)';
    prefixInput.value = nf.prefix || '';
    prefixInput.oninput = (e) => { nf.prefix = e.target.value; };

    const suffixInput = document.createElement('input');
    suffixInput.type = 'text'; suffixInput.className = 'col-nf-input col-nf-affix';
    suffixInput.placeholder = 'suffix'; suffixInput.title = 'Suffix (e.g. %, руб)';
    suffixInput.value = nf.suffix || '';
    suffixInput.oninput = (e) => { nf.suffix = e.target.value; };

    nfWrap.append(nfLabel, decInput, sepLabel, prefixInput, suffixInput);

    // ── Aliases + rules ──
    body.append(styleWrap, nfWrap, _buildAliasSection(col.field), _buildRulesSection(col.field));
    section.append(header, body);
    return section;
  }

  // ── Aliases ────────────────────────────────────────────────────────────

  function _buildAliasSection(field) {
    const wrap = document.createElement('div');
    wrap.className = 'disp-sub-section';

    const label = document.createElement('div');
    label.className = 'disp-sub-label';
    label.textContent = 'Value aliases';
    wrap.appendChild(label);

    const listEl = document.createElement('div');
    listEl.className = 'alias-list';
    wrap.appendChild(listEl);

    const addBtn = document.createElement('button');
    addBtn.className = 'tree-btn';
    addBtn.textContent = '+ Add alias';
    addBtn.onclick = () => {
      if (!_config.columns[field].aliases) _config.columns[field].aliases = {};
      _config.columns[field].aliases[''] = '';
      _renderAliasList(listEl, field);
    };
    wrap.appendChild(addBtn);

    _renderAliasList(listEl, field);
    return wrap;
  }

  function _renderAliasList(listEl, field) {
    listEl.innerHTML = '';
    const aliases = _config.columns[field].aliases || {};
    Object.entries(aliases).forEach(([from, to]) => {
      const row = document.createElement('div');
      row.className = 'alias-row';

      const fromInput = document.createElement('input');
      fromInput.type = 'text';
      fromInput.className = 'alias-input';
      fromInput.value = from;
      fromInput.placeholder = 'value (null = empty)';

      const arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.style.cssText = 'color:#aaa;flex-shrink:0';

      const toInput = document.createElement('input');
      toInput.type = 'text';
      toInput.className = 'alias-input';
      toInput.value = to;
      toInput.placeholder = 'display as';

      const delBtn = document.createElement('button');
      delBtn.className = 'tree-btn tree-btn-del';
      delBtn.textContent = '✕';

      // Update on change (key change = delete old + add new)
      fromInput.onblur = () => {
        delete _config.columns[field].aliases[from];
        _config.columns[field].aliases[fromInput.value] = toInput.value;
        from = fromInput.value;
      };
      toInput.oninput = () => {
        _config.columns[field].aliases[fromInput.value] = toInput.value;
      };
      delBtn.onclick = () => {
        delete _config.columns[field].aliases[from];
        _renderAliasList(listEl, field);
      };

      row.append(fromInput, arrow, toInput, delBtn);
      listEl.appendChild(row);
    });
  }

  // ── Conditional rules ──────────────────────────────────────────────────

  const RULE_TYPES = [
    ['equals',      '= equals'],
    ['not_equals',  '≠ not equals'],
    ['contains',    '∈ contains'],
    ['starts_with', 'starts with'],
    ['ends_with',   'ends with'],
    ['gt',          '> greater'],
    ['lt',          '< less'],
    ['gte',         '≥ ≥'],
    ['lte',         '≤ ≤'],
    ['is_null',     'is empty'],
    ['not_null',    'is not empty'],
  ];

  function _buildRulesSection(field) {
    const wrap = document.createElement('div');
    wrap.className = 'disp-sub-section';

    const label = document.createElement('div');
    label.className = 'disp-sub-label';
    label.textContent = 'Conditional formatting';
    wrap.appendChild(label);

    const listEl = document.createElement('div');
    listEl.className = 'rules-list';
    wrap.appendChild(listEl);

    const addBtn = document.createElement('button');
    addBtn.className = 'tree-btn';
    addBtn.textContent = '+ Add rule';
    addBtn.onclick = () => {
      if (!_config.columns[field].rules) _config.columns[field].rules = [];
      _config.columns[field].rules.push({ type: 'equals', value: '', bg: '#fffde7', color: '' });
      _renderRulesList(listEl, field);
    };
    wrap.appendChild(addBtn);

    _renderRulesList(listEl, field);
    return wrap;
  }

  function _renderRulesList(listEl, field) {
    listEl.innerHTML = '';
    const rules = _config.columns[field].rules || [];
    rules.forEach((rule, i) => {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const typeSelect = document.createElement('select');
      typeSelect.className = 'rule-type-select';
      RULE_TYPES.forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        opt.selected = rule.type === val;
        typeSelect.appendChild(opt);
      });
      typeSelect.onchange = (e) => {
        rule.type = e.target.value;
        const noVal = ['is_null','not_null'].includes(rule.type);
        valInput.style.display = noVal ? 'none' : '';
      };

      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.className = 'rule-value-input';
      valInput.value = rule.value ?? '';
      valInput.placeholder = 'value';
      valInput.style.display = ['is_null','not_null'].includes(rule.type) ? 'none' : '';
      valInput.oninput = (e) => { rule.value = e.target.value; };

      const bgPicker  = _colorPickerEl(rule.bg || '#fffde7', (v) => { rule.bg = v; }, 'Bg');
      const txtPicker = _colorPickerEl(rule.color || '#000000', (v) => { rule.color = v; }, 'Txt');

      const delBtn = document.createElement('button');
      delBtn.className = 'tree-btn tree-btn-del';
      delBtn.textContent = '✕';
      delBtn.onclick = () => {
        rules.splice(i, 1);
        _renderRulesList(listEl, field);
      };

      row.append(typeSelect, valInput, bgPicker, txtPicker, delBtn);
      listEl.appendChild(row);
    });
  }

  function _colorPickerEl(value, onChange, label) {
    const wrap = document.createElement('span');
    wrap.className = 'color-picker-wrap';

    const lbl = document.createElement('span');
    lbl.className = 'color-picker-label';
    lbl.textContent = label;

    const inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'color-picker-input';
    inp.value = value || '#ffffff';
    inp.oninput = (e) => onChange(e.target.value);

    wrap.append(lbl, inp);
    return wrap;
  }

  // ── Save ───────────────────────────────────────────────────────────────

  function _save() {
    close();
    save(_worksheetName);
    if (_onSave) _onSave();
  }

  return { init, open, close, load, save, getConfig, makeValueFormatter, makeCellStyle };
})();
