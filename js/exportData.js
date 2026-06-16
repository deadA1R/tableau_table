const ExportData = (() => {
  let _columns = [];        // App.allColumns
  let _wsName  = 'default';

  const LIST_THRESHOLD = 200;   // max distinct values for a column to allow a dropdown
  let _colMeta = {};            // field -> { numeric, tooMany, distinctCount, eligible, values }

  // ── Public ─────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('btn-do-export').onclick     = _run;
    document.getElementById('btn-cancel-export').onclick  = close;
    document.getElementById('export-modal').querySelector('.modal-backdrop').onclick = close;

    document.getElementById('export-select-all').onclick  = () => _setAll(true);
    document.getElementById('export-select-none').onclick = () => _setAll(false);

    document.querySelectorAll('input[name="export-format"]').forEach(r => {
      r.onchange = _syncFormatOpts;
    });
  }

  function open(columns, wsName) {
    _columns = columns;
    _wsName  = wsName || 'default';
    _renderColumns();
    _syncFormatOpts();
    document.getElementById('export-modal').classList.remove('hidden');
  }

  function close() {
    document.getElementById('export-modal').classList.add('hidden');
  }

  function _format() {
    const r = document.querySelector('input[name="export-format"]:checked');
    return r ? r.value : 'xlsx';
  }

  function _syncFormatOpts() {
    const isXlsx = _format() === 'xlsx';
    document.getElementById('export-xlsx-opts').style.display = isXlsx ? '' : 'none';
  }

  // ── Column checklist ─────────────────────────────────────────────────────

  function _renderColumns() {
    const dc = typeof DisplayConfig !== 'undefined' ? DisplayConfig.getConfig() : null;
    const model = (typeof Table !== 'undefined' && Table.getExportModel) ? Table.getExportModel() : { data: [] };
    _colMeta = _computeColMeta(model.data || []);

    const list = document.getElementById('export-columns-list');
    list.innerHTML = '';
    _columns.forEach(col => {
      if (col.field.startsWith('_')) return;
      const meta   = _colMeta[col.field] || {};
      const hidden = dc?.columns?.[col.field]?.hidden;

      const row = document.createElement('div');
      row.className = 'export-col-item';

      // include checkbox + name
      const incLabel = document.createElement('label');
      incLabel.className = 'export-col-inc';
      const inc = document.createElement('input');
      inc.type = 'checkbox';
      inc.className = 'export-inc-cb';
      inc.value = col.field;
      inc.checked = !hidden;        // default: currently-visible columns
      const name = document.createElement('span');
      name.textContent = _displayName(col.field, col.headerName);
      incLabel.append(inc, name);

      // cardinality / type hint
      const info = document.createElement('span');
      info.className = 'export-col-meta';
      if (meta.numeric)                info.textContent = 'число';
      else if (meta.tooMany)           info.textContent = '> ' + LIST_THRESHOLD + ' знач.';
      else if (meta.distinctCount > 0) info.textContent = meta.distinctCount + ' знач.';
      else                             info.textContent = '—';

      row.append(incLabel, info);

      // dropdown toggle — only categorical, low-cardinality columns
      if (meta.eligible) {
        const listLabel = document.createElement('label');
        listLabel.className = 'export-list-toggle';
        listLabel.title = 'Выпадающий список из значений этой колонки (строго из списка, на всю колонку)';
        const lcb = document.createElement('input');
        lcb.type = 'checkbox';
        lcb.className = 'export-list-cb';
        lcb.value = col.field;
        lcb.disabled = !inc.checked;
        listLabel.append(lcb, document.createTextNode(' Список'));
        inc.onchange = () => { lcb.disabled = !inc.checked; if (!inc.checked) lcb.checked = false; };
        row.append(listLabel);
      }

      list.appendChild(row);
    });
  }

  function _setAll(state) {
    document.querySelectorAll('#export-columns-list .export-inc-cb').forEach(cb => {
      cb.checked = state;
      cb.dispatchEvent(new Event('change'));
    });
  }

  function _selectedFields() {
    return [...document.querySelectorAll('#export-columns-list .export-inc-cb:checked')].map(cb => cb.value);
  }

  function _dropdownFields() {
    return [...document.querySelectorAll('#export-columns-list .export-list-cb:checked')].map(cb => cb.value);
  }

  // Per-column type + distinct-value analysis (categorical detection for dropdowns).
  function _computeColMeta(data) {
    const meta = {};
    const fields = [];
    _columns.forEach(c => {
      if (c.field.startsWith('_')) return;
      meta[c.field] = { set: new Set(), tooMany: false, seen: 0, num: 0 };
      fields.push(c.field);
    });

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (row._isSubtotal) continue;
      for (let k = 0; k < fields.length; k++) {
        const f = fields[k], m = meta[f];
        const v = row[f];
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (!s || s === '-' || /^null$/i.test(s)) continue;   // treat as blank
        if (m.seen < 400) { m.seen++; if (_isNum(s)) m.num++; }
        if (!m.tooMany) {
          m.set.add(s);
          if (m.set.size > LIST_THRESHOLD) { m.tooMany = true; m.set = null; }  // free memory
        }
      }
    }

    const out = {};
    fields.forEach(f => {
      const m = meta[f];
      const numeric = m.seen > 0 && m.num === m.seen;
      const distinctCount = m.tooMany ? Infinity : (m.set ? m.set.size : 0);
      const eligible = !numeric && !m.tooMany && distinctCount > 0;
      out[f] = {
        numeric, tooMany: m.tooMany, distinctCount, eligible,
        values: eligible ? [...m.set].sort((a, b) => a.localeCompare(b, 'ru')) : [],
      };
    });
    return out;
  }

  // ── Run ────────────────────────────────────────────────────────────────

  function _run() {
    const fields = _selectedFields();
    if (!fields.length) { alert('Select at least one column to export.'); return; }
    const fmt = _format();
    close();

    if (fmt === 'csv') { _exportCSV(fields); return; }

    Utils.showLoading();
    // Let the loading overlay paint before the heavy synchronous build.
    setTimeout(() => {
      _exportExcel(fields)
        .catch(err => alert('Export failed: ' + (err?.message || err)))
        .finally(() => Utils.hideLoading());
    }, 50);
  }

  // ── CSV ──────────────────────────────────────────────────────────────────

  function _exportCSV(fields) {
    const model = Table.getExportModel();
    const cols  = fields.map(f => ({ field: f, headerName: _displayName(f, _colMap()[f]?.headerName) }));
    const rows  = model.data.filter(r => !r._isSubtotal);
    Utils.exportCSV(rows, cols, _fileName('csv'));
  }

  // ── Excel ────────────────────────────────────────────────────────────────

  async function _exportExcel(fields) {
    const model    = Table.getExportModel();
    const dc        = typeof DisplayConfig !== 'undefined' ? DisplayConfig.getConfig() : { columns: {} };
    const hdr       = typeof HeaderConfig  !== 'undefined' ? HeaderConfig.getConfig()  : null;
    const styledHdr = document.getElementById('export-styled-header').checked && !!hdr;
    const doMerge   = document.getElementById('export-merge-cells').checked;

    const selected  = new Set(fields);
    const colMap    = _colMap();

    // Leaf column order — respects header grouping, falls back to source order.
    const leaves = styledHdr
      ? _computeLeafOrder(selected, hdr.tree || [])
      : fields.slice();

    // Header layout (groups + per-leaf vertical span)
    const layout = styledHdr
      ? _buildHeaderModel(leaves, hdr.tree || [], selected)
      : { groups: [], leafParentDepth: leaves.map(() => -1), headerRows: 1 };

    // Numeric detection per leaf
    const numericCol = {};
    const numFmtCode = {};
    leaves.forEach(f => {
      numericCol[f] = _detectNumeric(model.data, f);
      numFmtCode[f] = numericCol[f] ? _buildNumFmt(f, dc) : null;
    });

    // Columns that carry vertical-merge info
    const mergeFields = new Set([...(model.groupCols || []), ...(model.mergeCols || [])]);

    // ── Build workbook ──
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Advanced Table Extension';
    const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: layout.headerRows }] });

    const gBg  = _argb(hdr?.globalHeaderBg   || '#f5f7fa');
    const gTxt = _argb(hdr?.globalHeaderColor || '#333333');
    const headerRows = layout.headerRows;
    const leafRow0   = headerRows - 1;          // 0-indexed bottom header row

    const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };

    // Header — leaf names
    leaves.forEach((field, ci) => {
      const topRow0 = layout.leafParentDepth[ci] + 1;   // 0-indexed
      const exTop   = topRow0 + 1;
      const exBot   = leafRow0 + 1;
      const exCol   = ci + 1;

      const cell = ws.getCell(exTop, exCol);
      cell.value = _displayName(field, colMap[field]?.headerName);
      const fbg = styledHdr ? (hdr.fieldColors?.[field]?.bg) : null;
      _styleHeaderCell(cell, _argb(fbg) || gBg, gTxt, border);
      if (exBot > exTop) ws.mergeCells(exTop, exCol, exBot, exCol);

      // Column-level format & alignment (applies to data cells cheaply)
      const wsCol = ws.getColumn(exCol);
      if (numFmtCode[field]) wsCol.numFmt = numFmtCode[field];
      const align = dc.columns?.[field]?.align || (numericCol[field] ? 'right' : 'center');
      wsCol.alignment = { horizontal: align, vertical: 'middle' };
      wsCol.width = _colWidth(field, colMap[field]?.headerName);
    });

    // Header — group cells
    layout.groups.forEach(g => {
      const exRow = g.depth + 1;
      const c1 = g.start + 1, c2 = g.end + 1;
      const cell = ws.getCell(exRow, c1);
      cell.value = g.name || '';
      _styleHeaderCell(cell, _argb(g.bg) || gBg, _argb(g.color) || gTxt, border);
      if (c2 > c1) ws.mergeCells(exRow, c1, exRow, c2);
    });

    // ── Data ──
    const data = model.data;
    const stBg  = _argb(dc.subtotals?.bgColor  || '#e8f0fe');
    const stTxt = _argb(dc.subtotals?.textColor || '#1a237e');
    const fmtFns = {};
    leaves.forEach(f => { if (DisplayConfig?.makeValueFormatter) fmtFns[f] = DisplayConfig.makeValueFormatter(f); });

    for (let r = 0; r < data.length; r++) {
      const row   = data[r];
      const exRow = headerRows + 1 + r;
      const isTotal = !!row._isSubtotal;

      for (let ci = 0; ci < leaves.length; ci++) {
        const field = leaves[ci];
        const exCol = ci + 1;

        // Vertical merge handling
        if (doMerge && mergeFields.has(field)) {
          const span = row['_span_' + field];
          if (span === 0) continue;                    // covered by a merge above
          const cell = ws.getCell(exRow, exCol);
          _writeValue(cell, field, row[field], numericCol[field], fmtFns[field]);
          if (span > 1) ws.mergeCells(exRow, exCol, exRow + span - 1, exCol);
          if (isTotal) _styleTotalCell(cell, stBg, stTxt, row._isGrandTotal);
        } else {
          const cell = ws.getCell(exRow, exCol);
          _writeValue(cell, field, row[field], numericCol[field], fmtFns[field]);
          if (isTotal) _styleTotalCell(cell, stBg, stTxt, row._isGrandTotal);
        }
      }
    }

    // ── Dropdown (data-validation) columns ──
    // Whole-column list validation so newly added rows also get the dropdown.
    // Option values live on a hidden "Lists" sheet; entries are restricted to the list.
    const dropdownFields = _dropdownFields().filter(f => leaves.includes(f) && _colMeta[f]?.values?.length);
    if (dropdownFields.length) {
      const listSheet = wb.addWorksheet('Lists');
      listSheet.state = 'veryHidden';
      const firstDataRow = headerRows + 1;

      dropdownFields.forEach((field, di) => {
        const vals = _colMeta[field].values;
        const listCol = di + 1;
        const listColLetter = _colLetter(listCol);
        for (let i = 0; i < vals.length; i++) listSheet.getCell(i + 1, listCol).value = vals[i];
        const ref = `Lists!$${listColLetter}$1:$${listColLetter}$${vals.length}`;

        const targetLetter = _colLetter(leaves.indexOf(field) + 1);
        const sqref = `${targetLetter}${firstDataRow}:${targetLetter}1048576`;
        ws.dataValidations.add(sqref, {
          type: 'list', allowBlank: true, formulae: [ref],
          showErrorMessage: true, errorStyle: 'stop',
          errorTitle: 'Недопустимое значение',
          error: 'Выберите значение из списка.',
        });
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    _download(buf, _fileName('xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  // ── Cell helpers ───────────────────────────────────────────────────────

  function _writeValue(cell, field, raw, isNumeric, fmtFn) {
    if (isNumeric && _isNum(raw)) {
      cell.value = _toNum(raw);
      return;
    }
    const disp = fmtFn ? fmtFn({ value: raw }) : raw;
    cell.value = (disp === null || disp === undefined) ? '' : String(disp);
  }

  function _styleHeaderCell(cell, bgArgb, txtArgb, border) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.font = { bold: true, color: { argb: txtArgb }, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border;
  }

  function _styleTotalCell(cell, bgArgb, txtArgb, isGrand) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.font = { bold: true, color: { argb: txtArgb }, italic: !isGrand };
  }

  // ── Header layout computation ────────────────────────────────────────────

  // Replicates HeaderConfig.applyToColDefs ordering: standalone fields keep
  // source order; a grouped field expands its root group (once) at first hit.
  function _computeLeafOrder(selected, tree) {
    const consumed = new Set();
    const out = [];

    const rootOf = (field) => tree.find(n => n.type === 'group' && _fieldInNode(n, field));
    const dfsLeaves = (node, acc) => {
      if (node.type === 'field') { if (selected.has(node.field)) acc.push(node.field); }
      else if (node.children) node.children.forEach(c => dfsLeaves(c, acc));
    };

    _columns.forEach(col => {
      const f = col.field;
      if (f.startsWith('_') || !selected.has(f)) return;
      const rg = rootOf(f);
      if (!rg) { out.push(f); return; }
      if (consumed.has(rg.id)) return;
      consumed.add(rg.id);
      dfsLeaves(rg, out);
    });

    // Any selected fields not represented (e.g. group existed but order odd) — append
    selected.forEach(f => { if (!out.includes(f) && !f.startsWith('_')) out.push(f); });
    return out;
  }

  function _buildHeaderModel(leaves, tree, selected) {
    const idx = new Map(leaves.map((f, i) => [f, i]));
    const groups = [];
    const leafParentDepth = new Array(leaves.length).fill(-1);
    let maxDepth = 0;

    function walk(node, depth) {
      if (node.type === 'field') {
        const i = idx.get(node.field);
        if (i != null) leafParentDepth[i] = depth - 1;
        return;
      }
      // group
      const acc = [];
      (function dfs(n) {
        if (n.type === 'field') { if (selected.has(n.field)) acc.push(n.field); }
        else if (n.children) n.children.forEach(dfs);
      })(node);
      const idxs = acc.map(f => idx.get(f)).filter(i => i != null);
      if (idxs.length) {
        groups.push({
          name: node.name, bg: node.bg, color: node.textColor,
          depth, start: Math.min(...idxs), end: Math.max(...idxs),
        });
        if (depth > maxDepth) maxDepth = depth;
      }
      if (node.children) node.children.forEach(c => walk(c, depth + 1));
    }

    tree.forEach(n => walk(n, 0));
    // No groups → single flat header row. Otherwise group rows 0..maxDepth + leaf row.
    const headerRows = groups.length ? maxDepth + 2 : 1;
    return { groups, leafParentDepth, headerRows };
  }

  function _fieldInNode(node, field) {
    if (node.type === 'field') return node.field === field;
    if (node.children) return node.children.some(c => _fieldInNode(c, field));
    return false;
  }

  // ── Numeric helpers ────────────────────────────────────────────────────

  const _NUM_RE = /^-?[\d\s ,]*\.?\d+$/;
  function _isNum(v) {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    if (!s) return false;
    return _NUM_RE.test(s);
  }
  function _toNum(v) {
    return parseFloat(String(v).replace(/[\s ,]/g, ''));
  }

  function _detectNumeric(data, field) {
    let seen = 0, numeric = 0;
    const limit = Math.min(data.length, 400);
    for (let i = 0; i < data.length && seen < limit; i++) {
      const v = data[i][field];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s || s === '-' || /^null$/i.test(s)) continue;   // treat as blank
      seen++;
      if (_isNum(s)) numeric++;
    }
    return seen > 0 && numeric === seen;
  }

  function _buildNumFmt(field, dc) {
    const nf = dc.columns?.[field]?.numberFormat;
    if (nf && ((nf.decimals !== '' && nf.decimals != null) || nf.thousandsSep || nf.prefix || nf.suffix)) {
      const dec = (nf.decimals !== '' && nf.decimals != null) ? parseInt(nf.decimals) : null;
      const intPart = nf.thousandsSep ? '#,##0' : '0';
      const decPart = dec != null ? (dec > 0 ? '.' + '0'.repeat(dec) : '') : '.##########';
      const pre = nf.prefix ? '"' + nf.prefix.replace(/"/g, '') + '"' : '';
      const suf = nf.suffix ? '"' + nf.suffix.replace(/"/g, '') + '"' : '';
      return pre + intPart + decPart + suf;
    }
    return '#,##0.##########';   // default — thousands sep, decimals only when present
  }

  // ── Misc helpers ─────────────────────────────────────────────────────────

  function _colMap() {
    const m = {};
    _columns.forEach(c => { m[c.field] = c; });
    return m;
  }

  function _displayName(field, headerName) {
    const rename = (typeof HeaderConfig !== 'undefined') ? HeaderConfig.getConfig()?.renames?.[field] : null;
    return rename || headerName || field;
  }

  function _colWidth(field, headerName) {
    const name = _displayName(field, headerName);
    return Math.min(42, Math.max(12, name.length + 3));
  }

  function _colLetter(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function _argb(hex) {
    if (!hex) return null;
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return null;
    return 'FF' + h.toUpperCase();
  }

  function _fileName(ext) {
    const stamp = new Date().toISOString().slice(0, 10);
    const base  = (_wsName || 'table').replace(/[^a-zA-Z0-9а-яА-Я _-]/g, '').trim() || 'table';
    return `${base}_${stamp}.${ext}`;
  }

  function _download(buffer, filename, mime) {
    const blob = new Blob([buffer], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { init, open, close };
})();
