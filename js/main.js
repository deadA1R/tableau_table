const App = {
  worksheet: null,
  worksheets: [],
  allColumns: [],
  groupFields: [],
};

const STORAGE_KEY      = 'advtable_group_fields';
const STORAGE_WS_KEY   = 'advtable_worksheet';

document.addEventListener('DOMContentLoaded', () => {
  Table.init();
  Config.init(_onConfigSave);
  HeaderConfig.init(_onHeaderConfigSave);
  DisplayConfig.init(_onDisplayConfigSave);
  ComputedColumns.init(_onComputedColsSave);
  Palettes.load();
  _bindToolbar();
  Utils.showLoading();

  tableau.extensions.initializeAsync().then(() => {
    if (tableau.extensions.worksheetContent) {
      // ── Viz extension mode ──────────────────────────────────────────────
      // Embedded directly in a worksheet — single worksheet, no picker.
      App.isVizMode = true;
      App.worksheet  = tableau.extensions.worksheetContent.worksheet;
      App.worksheets = [App.worksheet];
    } else {
      // ── Dashboard extension mode ────────────────────────────────────────
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      App.worksheets  = dashboard.worksheets;

      if (!App.worksheets.length) {
        Utils.showError('No worksheets found. Add at least one worksheet to the dashboard.');
        return;
      }

      const savedWsName = localStorage.getItem(STORAGE_WS_KEY);
      App.worksheet = App.worksheets.find(ws => ws.name === savedWsName) || App.worksheets[0];
    }

    _applyModeRestrictions();
    _registerListeners();
    _loadSavedSettings();
    _loadData();

  }).catch(err => {
    Utils.showError('Failed to initialize: ' + err.message);
  });
});

function _loadSavedSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY + '_' + App.worksheet.name);
    if (saved) App.groupFields = JSON.parse(saved);
    else App.groupFields = [];
  } catch (e) { App.groupFields = []; }
  HeaderConfig.load(App.worksheet.name);
  DisplayConfig.load(App.worksheet.name);
  ComputedColumns.load(App.worksheet.name);
}

function _onComputedColsSave() {
  ComputedColumns.save(App.worksheet?.name ?? 'default');
  _loadData();
}

// ── Event listeners ────────────────────────────────────────────────────────

let _currentListeners = [];

function _registerListeners() {
  // Unregister previous listeners when switching worksheets
  _currentListeners.forEach(u => { try { u(); } catch(e) {} });
  _currentListeners = [];

  const unsubFilter = App.worksheet.addEventListener(
    tableau.TableauEventType.FilterChanged, _onDataChanged
  );
  const unsubMark = App.worksheet.addEventListener(
    tableau.TableauEventType.MarkSelectionChanged, _onDataChanged
  );
  _currentListeners.push(unsubFilter, unsubMark);
}

let _reloadTimer = null;
function _onDataChanged() {
  clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(_loadData, 300);
}

// ── Config callbacks ───────────────────────────────────────────────────────

function _onDisplayConfigSave() {
  DisplayConfig.save(App.worksheet?.name ?? 'default');
  Table.render(App._lastData, App._lastColumns, App.groupFields);
}

function _onHeaderConfigSave() {
  HeaderConfig.save(App.worksheet?.name ?? 'default');
  Table.render(App._lastData, App._lastColumns, App.groupFields);
}

function _onConfigSave(worksheetName, groupFields) {
  const wsChanged = worksheetName !== App.worksheet.name;

  if (wsChanged) {
    const ws = App.worksheets.find(w => w.name === worksheetName);
    if (ws) {
      App.worksheet = ws;
      localStorage.setItem(STORAGE_WS_KEY, ws.name);
      _registerListeners();
      _loadSavedSettings();
    }
  }

  App.groupFields = groupFields;
  try {
    localStorage.setItem(STORAGE_KEY + '_' + App.worksheet.name, JSON.stringify(groupFields));
  } catch (e) {}

  if (wsChanged) {
    _loadData();
  } else {
    Table.render(App._lastData, App._lastColumns, App.groupFields);
  }
}

// ── Data loading ───────────────────────────────────────────────────────────

async function _loadData() {
  Utils.showLoading();
  try {
    const dataTable = await App.worksheet.getSummaryDataAsync({
      maxRows: 0,
      includeAllColumns: true,
    });

    const { columns, data } = Utils.parseTableauData(dataTable);
    ComputedColumns.applyToData(data, columns);
    App.allColumns   = columns;
    App._lastData    = data;
    App._lastColumns = columns;

    document.getElementById('search-input').value = '';
    Table.render(data, columns, App.groupFields);
    Utils.hideLoading();

  } catch (err) {
    Utils.showError('Error loading data: ' + err.message);
  }
}

// ── Toolbar ────────────────────────────────────────────────────────────────

function _bindToolbar() {
  document.getElementById('search-input').addEventListener('input', (e) => {
    Table.search(e.target.value);
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    Table.exportCSV();
  });

  document.getElementById('btn-copy-clipboard').addEventListener('click', () => {
    Table.copyToClipboard();
  });

  document.getElementById('btn-computed-cols').addEventListener('click', () => {
    ComputedColumns.open(App.allColumns, App.worksheet?.name ?? 'default');
  });

  document.getElementById('btn-palettes').addEventListener('click', () => {
    Palettes.openManager();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    Config.open(App.worksheets, App.worksheet?.name, App.allColumns, App.groupFields, App.isVizMode);
  });

  document.getElementById('btn-header-config').addEventListener('click', () => {
    HeaderConfig.open(App.allColumns, App.worksheet?.name ?? 'default');
  });

  document.getElementById('btn-display').addEventListener('click', () => {
    DisplayConfig.open(App.allColumns, App.worksheet?.name ?? 'default', App._lastData?.length ?? 0);
  });

  document.getElementById('btn-open-settings-error').style.display = 'none';
}

function _applyModeRestrictions() {
  try {
    const mode = tableau.extensions.environment?.mode ?? '';
    const isViewing = mode === 'viewing'
      || mode === tableau.ExtensionMode?.Viewing
      || mode === 'view';

    document.getElementById('btn-settings').style.display      = isViewing ? 'none' : '';
    document.getElementById('btn-header-config').style.display = isViewing ? 'none' : '';
    document.getElementById('btn-display').style.display       = isViewing ? 'none' : '';
  } catch (e) {}
}
