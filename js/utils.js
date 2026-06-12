const Utils = {

  // Parse Tableau DataTable into plain { columns, data }
  parseTableauData(dataTable) {
    const columns = dataTable.columns.map(col => ({
      field: col.fieldName,
      headerName: col.fieldName,
      dataType: col.dataType,
    }));

    // Hot path — optimized for 100k rows
    const fieldNames = columns.map(c => c.field);
    const colCount   = fieldNames.length;

    const data = new Array(dataTable.data.length);
    for (let r = 0; r < dataTable.data.length; r++) {
      const row = dataTable.data[r];
      const obj = {};
      for (let c = 0; c < colCount; c++) {
        const cell = row[c];
        obj[fieldNames[c]] = (cell.formattedValue != null) ? cell.formattedValue : (cell.value != null ? String(cell.value) : '');
      }
      data[r] = obj;
    }

    return { columns, data };
  },

  // Export current visible rows to CSV with BOM for Excel
  exportCSV(data, columns, filename = 'tableau_export.csv') {
    if (!data || !data.length) return;

    const headers = columns.map(c => Utils._csvCell(c.headerName)).join(',');
    const rows = data.map(row =>
      columns.map(c => Utils._csvCell(row[c.field] ?? '')).join(',')
    );

    const csv = '﻿' + [headers, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  _csvCell(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  },

  showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('error-message').classList.add('hidden');
  },

  hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  },

  showError(message) {
    Utils.hideLoading();
    document.getElementById('error-text').textContent = message;
    document.getElementById('error-message').classList.remove('hidden');
  },

  hideError() {
    document.getElementById('error-message').classList.add('hidden');
  },
};
