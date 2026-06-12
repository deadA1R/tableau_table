const Table = (() => {
  let gridApi = null;
  let currentData = [];
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

  // Mark group boundaries and assign alternating group index
  // Insert subtotal rows after each group boundary
  function _injectSubtotals(data, groupCols) {
    if (typeof DisplayConfig === 'undefined') return data;
    const st = DisplayConfig.getConfig().subtotals;
    if (!st?.enabled || !groupCols.length) return data;

    const ops = st.operations || {};
    const hasOps = Object.keys(ops).length > 0;
    if (!hasOps) return data;

    // Determine which group column to subtotal after (use first group col)
    const groupCol = groupCols[0];

    const result = [];
    let i = 0;
    while (i < data.length) {
      const groupVal = data[i][groupCol];
      const groupRows = [];
      while (i < data.length && data[i][groupCol] === groupVal) {
        groupRows.push(data[i]);
        i++;
      }
      result.push(...groupRows);

      // Build subtotal row
      const subtotalRow = { _isSubtotal: true, _rowId: 'st_' + i };
      // Label in first group column
      subtotalRow[groupCol] = st.labelText || 'Итого';
      // Compute aggregations
      for (const [field, op] of Object.entries(ops)) {
        const vals = groupRows.map(r => parseFloat(r[field])).filter(v => !isNaN(v));
        if (!vals.length) { subtotalRow[field] = ''; continue; }
        switch (op) {
          case 'sum':   subtotalRow[field] = String(vals.reduce((a, b) => a + b, 0)); break;
          case 'count': subtotalRow[field] = String(vals.length); break;
          case 'avg':   subtotalRow[field] = String((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)); break;
          case 'min':   subtotalRow[field] = String(Math.min(...vals)); break;
          case 'max':   subtotalRow[field] = String(Math.max(...vals)); break;
        }
      }
      result.push(subtotalRow);
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

  function buildColDefs(columns, groupCols) {
    const dc = typeof DisplayConfig !== 'undefined' ? DisplayConfig.getConfig() : null;
    const fitToWidth = dc?.fitToWidth ?? false;

    return columns
      .filter(col => !col.field.startsWith('_span_'))
      .map(col => {
        const isGroup = groupCols.includes(col.field);
        const def = {
          field: col.field,
          headerName: col.headerName,
          sortable: true,
          resizable: true,
          filter: true,
          minWidth: 80,
        };

        if (fitToWidth) {
          def.flex = 1;
        } else {
          def.width = 180;
        }

        // Value aliases
        if (dc) {
          def.valueFormatter = DisplayConfig.makeValueFormatter(col.field);
        }

        if (isGroup && !isSearchActive) {
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
            // Apply conditional formatting on visible grouped cells
            if (dc) return DisplayConfig.makeCellStyle(col.field)(params);
            return { textAlign: 'center' };
          };
        } else {
          // Conditional formatting for regular cells
          def.cellStyle = dc
            ? DisplayConfig.makeCellStyle(col.field)
            : { textAlign: 'center' };
        }

        return def;
      });
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
        if (!colState.length) return;
        if (typeof DisplayConfig !== 'undefined') {
          colState.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
          DisplayConfig.getConfig().sortRules = colState.map(c => ({
            field: c.colId, direction: c.sort,
          }));
        }
        // Strip injected subtotal rows before re-sorting
        const rawData = currentData.filter(r => !r._isSubtotal);
        _sortData(rawData);
        currentData = _injectSubtotals(rawData, currentGroupCols);
        calcSpans(currentData, currentGroupCols);
        markGroupBoundaries(currentData, currentGroupCols);
        gridApi.setGridOption('rowData', currentData);
        _updateRowCount();
      },
    };

    gridApi = agGrid.createGrid(container, options);
  }

  function render(data, columns, groupCols) {
    currentData = data;
    currentColumns = columns;
    currentGroupCols = groupCols;
    isSearchActive = false;

    // Stamp stable row IDs once (needed for getRowId)
    data.forEach((row, i) => { row._rowId = i; });

    // Heavy processing — sort → subtotals → spans → boundaries
    _sortData(currentData);
    currentData = _injectSubtotals(currentData, currentGroupCols);
    calcSpans(currentData, currentGroupCols);
    markGroupBoundaries(currentData, currentGroupCols);

    // Build column defs
    let colDefs = buildColDefs(currentColumns, currentGroupCols);
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
    const subtotalBg  = DisplayConfig?.getConfig?.()?.subtotals?.bgColor  ?? '#e8f0fe';
    const subtotalTxt = DisplayConfig?.getConfig?.()?.subtotals?.textColor ?? '#1a237e';
    const container = document.getElementById('grid-container');
    container.style.setProperty('--subtotal-bg',  subtotalBg);
    container.style.setProperty('--subtotal-txt', subtotalTxt);

    gridApi.setGridOption('rowClassRules', {
      'group-boundary':     (p) => p.data?._groupStart === true,
      'sub-group-boundary': (p) => p.data?._subGroupStart === true,
      'group-even':     (p) => !p.data?._isSubtotal && p.data?._groupIndex % 2 === 0,
      'group-odd':      (p) => !p.data?._isSubtotal && p.data?._groupIndex % 2 === 1,
      'subtotal-row':   (p) => !!p.data?._isSubtotal,
      'sticky-group-row': (p) => !!p.data?._isStickyHeader,
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
      const colDefs = buildColDefs(currentColumns, currentGroupCols);
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

  function destroy() {
    if (gridApi) {
      gridApi.destroy();
      gridApi = null;
    }
  }

  function _refresh() {
    calcSpans(currentData, currentGroupCols);
    gridApi.setGridOption('rowData', [...currentData]);
  }

  function _updateRowCount() {
    let count = 0;
    gridApi?.forEachNodeAfterFilter(() => count++);
    const el = document.getElementById('row-count');
    if (el) el.textContent = count > 0 ? `${count} rows` : '';
  }

  return { init, render, search, exportCSV, destroy };
})();
