const Table = (() => {
  let gridApi = null;
  let currentData    = [];  // processed data (sorted + subtotals + merges applied)
  let currentRawData = [];  // pre-merge snapshot, used for clean re-sort
  let currentColumns = [];
  let currentGroupCols = [];
  let isSearchActive = false;

  // Pre-calculate rowspan for each cell.
  // Stores span value directly on each row object as _span_<field>.
  // 0 = hidden (merged into above), N = span N rows.
  function calcSpans(data, groupCols) {
    // Clear previous span data
    data.forEach(row => {
      groupCols.forEach(col => delete row['_span_' + col]);
    });

    groupCols.forEach((colField, colIdx) => {
      const parentCols = groupCols.slice(0, colIdx + 1);
      let i = 0;
      while (i < data.length) {
        if (data[i]._isSubtotal) { data[i]['_span_' + colField] = 1; i++; continue; }
        let span = 1;
        while (
          i + span < data.length &&
          !data[i + span]._isSubtotal &&
          parentCols.every(gc => data[i + span][gc] === data[i][gc])
        ) {
          data[i + span]['_span_' + colField] = 0;
          span++;
        }
        data[i]['_span_' + colField] = span;
        i += span;
      }
    });
  }

  // Insert subtotal rows after each group + optional grand total at bottom
  function _injectSubtotals(data, groupCols) {
    if (typeof DisplayConfig === 'undefined') return data;
    const st = DisplayConfig.getConfig().subtotals;
    if (!st?.enabled || !groupCols.length) return data;

    const ops = st.operations || {};
    const hasOps = Object.keys(ops).length > 0;
    if (!hasOps && !st.showGrandTotal) return data;

    const groupCol = groupCols[0];

    function _agg(rows) {
      const out = {};
      for (const [field, op] of Object.entries(ops)) {
        const vals = rows.map(r => parseFloat(String(r[field] ?? '').replace(/[^0-9.\-]/g, ''))).filter(v => !isNaN(v));
        if (!vals.length) { out[field] = ''; continue; }
        switch (op) {
          case 'sum':   out[field] = String(vals.reduce((a, b) => a + b, 0)); break;
          case 'count': out[field] = String(vals.length); break;
          case 'avg':   out[field] = String((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)); break;
          case 'min':   out[field] = String(Math.min(...vals)); break;
          case 'max':   out[field] = String(Math.max(...vals)); break;
        }
      }
      return out;
    }

    const result = [];
    let i = 0;
    while (i < data.length) {
      const groupVal = data[i][groupCol];
      const groupRows = [];
      while (i < data.length && data[i][groupCol] === groupVal) { groupRows.push(data[i]); i++; }
      result.push(...groupRows);
      if (hasOps) {
        const st_row = Object.assign({ _isSubtotal: true, _rowId: 'st_' + i }, _agg(groupRows));
        st_row[groupCol] = st.labelText || 'Итого';
        result.push(st_row);
      }
    }

    if (st.showGrandTotal) {
      const allRaw = result.filter(r => !r._isSubtotal);
      const gt = Object.assign({ _isSubtotal: true, _isGrandTotal: true, _rowId: 'grand_total' }, _agg(allRaw));
      gt[groupCol] = st.grandTotalLabel || 'Grand Total';
      result.push(gt);
    }

    return result;
  }

  function markGroupBoundaries(data, groupCols) {
    if (!groupCols.length) {
      data.forEach(row => { row._groupStart = false; row._subGroupStart = false; row._groupIndex = 0; });
      return;
    }
    const topCol = groupCols[0];
    let groupIndex = 0;
    data.forEach((row, i) => {
      if (row._isSubtotal) {
        row._groupStart = false; row._subGroupStart = false; row._groupIndex = groupIndex;
        return;
      }
      const prev = i > 0 ? data[i - 1] : null;
      const prevReal = prev && !prev._isSubtotal ? prev : null;

      const topChanged  = i === 0 || (prevReal && prevReal[topCol] !== row[topCol]);
      // Any group column changed (sub-group boundary)
      const anyChanged  = i === 0 || (prevReal && groupCols.some(col => prevReal[col] !== row[col]));

      if (topChanged && i > 0) groupIndex++;
      row._groupStart    = topChanged;
      row._subGroupStart = !topChanged && anyChanged;
      row._groupIndex    = groupIndex;
    });
  }

  function buildColDefs(columns, groupCols, manualMergeCols) {
    const dc           = typeof DisplayConfig !== 'undefined' ? DisplayConfig.getConfig() : null;
    const fitToWidth   = dc?.fitToWidth ?? false;
    const frozenCount  = dc?.frozenColumns ?? 0;

    const defs = columns
      .filter(col => !col.field.startsWith('_span_'))
      .map(col => {
        const isGroup  = groupCols.includes(col.field);
        const isManual = manualMergeCols && manualMergeCols.has(col.field);
        const isMerged = (isGroup || isManual) && !isSearchActive;
        const colCfg   = dc?.columns?.[col.field];

        const def = {
          field: col.field,
          headerName: col.headerName,
          sortable: true,
          resizable: true,
          filter: true,
          minWidth: 80,
        };

        if (fitToWidth) def.flex = 1;
        else            def.width = 180;

        if (colCfg?.hidden) def.hide = true;
        if (dc)             def.valueFormatter = DisplayConfig.makeValueFormatter(col.field);

        if (isMerged) {
          def.rowSpan = (params) => {
            const span = params.data?.['_span_' + col.field];
            return span === 0 ? 1 : (span ?? 1);
          };
          def.cellClassRules = {
            'cell-span': (params) => (params.data?.['_span_' + col.field] ?? 1) > 1,
          };
          def.cellStyle = (params) => {
            const span = params.data?.['_span_' + col.field];
            if (span === 0) return { opacity: 0, pointerEvents: 'none', borderBottom: 'none' };
            return dc ? DisplayConfig.makeCellStyle(col.field)(params) : { textAlign: 'center' };
          };
        } else {
          def.cellStyle = dc
            ? DisplayConfig.makeCellStyle(col.field)
            : { textAlign: 'center' };
        }

        return def;
      });

    // Apply left freeze to first N visible columns
    if (frozenCount > 0) {
      let pinned = 0;
      for (const def of defs) {
        if (!def.hide && pinned < frozenCount) { def.pinned = 'left'; pinned++; }
      }
    }

    return defs;
  }

  function _applyManualMerges(data, groups) {
    if (!groups?.length) return;
    groups.forEach(group => {
      const start  = group.rowStart;
      const end    = Math.min(group.rowEnd, data.length - 1);
      if (start < 0 || start >= data.length || end <= start) return;
      const span   = end - start + 1;
      const colAgg = group.colAgg || {};

      (group.columns || []).forEach(col => {
        const agg = colAgg[col] || 'first';
        if (agg !== 'first') {
          const vals = [];
          for (let i = start; i <= end; i++) {
            const v = parseFloat(String(data[i][col] ?? '').replace(/[^0-9.\-]/g, ''));
            if (!isNaN(v)) vals.push(v);
          }
          if (vals.length) {
            let result;
            switch (agg) {
              case 'sum':  result = vals.reduce((a, b) => a + b, 0); break;
              case 'avg':  result = vals.reduce((a, b) => a + b, 0) / vals.length; break;
              case 'min':  result = Math.min(...vals); break;
              case 'max':  result = Math.max(...vals); break;
              case 'last': result = vals[vals.length - 1]; break;
              default:     result = vals[0];
            }
            data[start][col] = String(+result.toFixed(6));
          }
        }
        data[start]['_span_' + col] = span;
        for (let i = start + 1; i <= end; i++) {
          data[i]['_span_' + col] = 0;
        }
      });
    });
  }

  function _getManualMergeColSet() {
    if (typeof DisplayConfig === 'undefined') return new Set();
    const groups = DisplayConfig.getConfig().manualMergeGroups || [];
    const cols = new Set();
    groups.forEach(g => (g.columns || []).forEach(c => cols.add(c)));
    return cols;
  }

  function init() {
    const container = document.getElementById('grid-container');

    const options = {
      columnDefs: [],
      rowData: [],
      suppressRowTransform: true,
      suppressMovableColumns: false,
      defaultColDef: {
        sortable: true,
        resizable: true,
        width: 180,
        minWidth: 80,
        cellStyle: { textAlign: 'center' },
        headerClass: 'ag-header-center',
      },
      animateRows: false,
      pagination: false,
      rowHeight: 32,
      headerHeight: 36,

      // ── Performance for 100k rows ──
      rowBuffer: 30,                      // render 30 rows outside viewport
      suppressColumnVirtualisation: false,
      suppressRowVirtualisation: false,
      getRowId: (params) => params.data._rowId,  // stable row identity

      onBodyScroll: _updateStickyGroupRow,
      onFilterChanged: _updateRowCount,
      onSortChanged: () => {
        const colState = gridApi.getColumnState().filter(c => c.sort);
        if (typeof DisplayConfig !== 'undefined') {
          colState.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
          DisplayConfig.getConfig().sortRules = colState.map(c => ({
            field: c.colId, direction: c.sort,
          }));
        }
        // Clone rows from snapshot so _applyManualMerges doesn't corrupt currentRawData
        const rawData = currentRawData.map(r => Object.assign({}, r));
        _sortData(rawData);
        currentData = _injectSubtotals(rawData, currentGroupCols);
        calcSpans(currentData, currentGroupCols);
        const manualGroups = typeof DisplayConfig !== 'undefined' ? DisplayConfig.getConfig().manualMergeGroups : null;
        _applyManualMerges(currentData, manualGroups);
        markGroupBoundaries(currentData, currentGroupCols);
        gridApi.setGridOption('rowData', currentData);
        _updateRowCount();
      },
    };

    gridApi = agGrid.createGrid(container, options);
  }

  function render(data, columns, groupCols) {
    // Stamp stable _rowId on source rows (idempotent — safe to mutate App._lastData with this).
    data.forEach((row, i) => { row._rowId = i; });

    // currentRawData is the authoritative pre-merge source for re-sorts.
    // Only _rowId is ever written to these rows — never aggregate values.
    currentRawData = data;

    // workData is a shallow clone so _applyManualMerges mutates clones, not source rows.
    let workData = data.map(r => Object.assign({}, r));

    currentColumns = columns;
    currentGroupCols = groupCols;
    isSearchActive = false;
    gridApi.setGridOption('quickFilterText', '');

    // Heavy processing — sort → subtotals → spans → manual merges → boundaries
    _sortData(workData);
    currentData = _injectSubtotals(workData, currentGroupCols);
    calcSpans(currentData, currentGroupCols);
    const manualGroups = typeof DisplayConfig !== 'undefined' ? DisplayConfig.getConfig().manualMergeGroups : null;
    _applyManualMerges(currentData, manualGroups);
    markGroupBoundaries(currentData, currentGroupCols);

    // Build column defs
    const manualMergeCols = _getManualMergeColSet();
    let colDefs = buildColDefs(currentColumns, currentGroupCols, manualMergeCols);
    if (typeof HeaderConfig !== 'undefined') colDefs = HeaderConfig.applyToColDefs(colDefs);

    // Apply display settings (font, separators)
    if (typeof DisplayConfig !== 'undefined') {
      const dc  = DisplayConfig.getConfig();
      const grid = document.getElementById('grid-container');
      grid.style.fontFamily = dc.fontFamily || 'inherit';
      grid.style.fontSize   = (dc.fontSize || 13) + 'px';
      grid.style.fontWeight = dc.fontWeight || 'normal';
      grid.classList.toggle('col-separators', dc.showSeparators !== false);
    }

    gridApi.setGridOption('groupHeaderHeight', 36);

    if (typeof DisplayConfig !== 'undefined') {
      const dc = DisplayConfig.getConfig();
      const rh = dc.rowHeight || 32;
      gridApi.setGridOption('rowHeight', rh);
      gridApi.resetRowHeights();

      const container = document.getElementById('grid-container');
      const subtotalBg  = dc.subtotals?.bgColor  ?? '#e8f0fe';
      const subtotalTxt = dc.subtotals?.textColor ?? '#1a237e';
      container.style.setProperty('--subtotal-bg',  subtotalBg);
      container.style.setProperty('--subtotal-txt', subtotalTxt);
    }

    gridApi.setGridOption('rowClassRules', {
      'group-boundary':     (p) => p.data?._groupStart === true,
      'sub-group-boundary': (p) => p.data?._subGroupStart === true,
      'group-even':         (p) => !p.data?._isSubtotal && p.data?._groupIndex % 2 === 0,
      'group-odd':          (p) => !p.data?._isSubtotal && p.data?._groupIndex % 2 === 1,
      'subtotal-row':       (p) => !!p.data?._isSubtotal && !p.data?._isGrandTotal,
      'grand-total-row':    (p) => !!p.data?._isGrandTotal,
      'sticky-group-row':   (p) => !!p.data?._isStickyHeader,
    });
    gridApi.setGridOption('columnDefs', colDefs);
    gridApi.setGridOption('rowData', currentData);
    gridApi.setGridOption('pinnedTopRowData', []);

    _updateRowCount();
  }

  // Sort data IN-PLACE — optimized for 100k rows (no localeCompare)
  function _sortData(data) {
    if (typeof DisplayConfig === 'undefined') return;
    const rules = DisplayConfig.getConfig().sortRules;
    if (!rules?.length) return;

    // Pre-parse numeric columns to avoid repeated parseFloat in comparator
    const isNumeric = rules.map(r => {
      const sample = data.slice(0, 200).map(row => row[r.field]).filter(v => v !== null && v !== undefined && v !== '');
      return sample.length > 0 && sample.every(v => !isNaN(parseFloat(v)));
    });

    data.sort((a, b) => {
      for (let ri = 0; ri < rules.length; ri++) {
        const rule = rules[ri];
        const av = a[rule.field] ?? '';
        const bv = b[rule.field] ?? '';
        let cmp;

        if (isNumeric[ri]) {
          cmp = parseFloat(av) - parseFloat(bv);
        } else {
          // Fast string compare — avoid localeCompare overhead
          const as = String(av).toUpperCase();
          const bs = String(bv).toUpperCase();
          cmp = as < bs ? -1 : as > bs ? 1 : 0;
        }

        if (cmp !== 0) return rule.direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });

    // Update AG Grid sort indicators (visual only, no re-sort triggered)
    const state = rules.map((r, i) => ({ colId: r.field, sort: r.direction, sortIndex: i }));
    gridApi?.applyColumnState({ state, defaultState: { sort: null } });
  }

  function _updateStickyGroupRow() {
    if (!currentGroupCols.length || isSearchActive) {
      gridApi.setGridOption('pinnedTopRowData', []);
      return;
    }
    const firstIdx = gridApi.getFirstDisplayedRowIndex();
    if (firstIdx <= 0) { gridApi.setGridOption('pinnedTopRowData', []); return; }

    const rowNode = gridApi.getDisplayedRowAtIndex(firstIdx);
    if (!rowNode?.data || rowNode.data._isSubtotal) { gridApi.setGridOption('pinnedTopRowData', []); return; }

    // Show sticky row only when we're inside a spanned group (not at the boundary row itself)
    const insideSpan = currentGroupCols.some(col => rowNode.data['_span_' + col] === 0);
    if (!insideSpan) { gridApi.setGridOption('pinnedTopRowData', []); return; }

    const stickyRow = { _isStickyHeader: true };
    currentGroupCols.forEach(col => { stickyRow[col] = rowNode.data[col]; });
    gridApi.setGridOption('pinnedTopRowData', [stickyRow]);
  }

  function search(text) {
    const wasActive = isSearchActive;
    isSearchActive = text.trim().length > 0;

    // Rebuild column defs if search state changed (to toggle rowSpan)
    if (wasActive !== isSearchActive) {
      const manualMergeCols = _getManualMergeColSet();
      let colDefs = buildColDefs(currentColumns, currentGroupCols, manualMergeCols);
      if (typeof HeaderConfig !== 'undefined') colDefs = HeaderConfig.applyToColDefs(colDefs);
      gridApi.setGridOption('columnDefs', colDefs);
    }

    gridApi.setGridOption('quickFilterText', text);
    _updateRowCount();
  }

  function exportCSV() {
    const visibleRows = [];
    gridApi.forEachNodeAfterFilter(node => {
      if (node.data && !node.data._isSubtotal) visibleRows.push(node.data);
    });
    Utils.exportCSV(visibleRows, currentColumns);
  }

  function copyToClipboard() {
    const visibleCols = gridApi.getAllDisplayedColumns()
      .map(c => c.getColId())
      .filter(id => !id.startsWith('_span_') && !id.startsWith('ag-'));

    const headerRow = visibleCols
      .map(id => { const col = currentColumns.find(c => c.field === id); return col?.headerName || id; })
      .join('\t');

    const rows = [];
    gridApi.forEachNodeAfterFilter(node => { if (node.data) rows.push(node.data); });

    const dataRows = rows.map(row => visibleCols.map(id => {
      const val = row[id] ?? '';
      return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
    }).join('\t'));

    const tsv = [headerRow, ...dataRows].join('\n');

    const _flash = () => {
      const btn = document.getElementById('btn-copy-clipboard');
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    };

    // Try modern API first, fall back to execCommand for iframe/HTTP contexts
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(_flash).catch(() => _execCopy(tsv, _flash));
    } else {
      _execCopy(tsv, _flash);
    }
  }

  function _execCopy(text, onSuccess) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand('copy');
      if (ok && onSuccess) onSuccess();
    } catch(e) {}
    document.body.removeChild(ta);
  }

  function destroy() {
    if (gridApi) {
      gridApi.destroy();
      gridApi = null;
    }
  }

  function _updateRowCount() {
    let count = 0;
    gridApi?.forEachNodeAfterFilter(() => count++);
    const el = document.getElementById('row-count');
    if (el) el.textContent = count > 0 ? `${count} rows` : '';
  }

  return { init, render, search, exportCSV, copyToClipboard, destroy };
})();
