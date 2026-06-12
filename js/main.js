const App = {
  worksheet: null,
  allColumns: [],   // all columns from last data load
  groupFields: [],  // columns to merge (saved in localStorage)
};

const STORAGE_KEY = 'advtable_group_fields';

document.addEventListener('DOMContentLoaded', () => {
  Table.init();
  Config.init(_onConfigSave);
  HeaderConfig.init(_onHeaderConfigSave);
  DisplayConfig.init(_onDisplayConfigSave);
  _bindToolbar();
  Utils.showLoading();

  tableau.extensions.initializeAsync().then(() => {
    App.worksheet = tableau.extensions.worksheetContent.worksheet;

    App.worksheet.addEventListener(tableau.TableauEventType.FilterChanged, _onDataChanged);
    App.worksheet.addEventListener(tableau.TableauEventType.MarkSelectionChanged, _onDataChanged);

    _applyModeRestrictions();

    // Find and register encoding changed event
    _registerEncodingListener();


    // Load saved settings
    try {
      const saved = localStorage.getItem(STORAGE_KEY + '_' + App.worksheet.name);
      if (saved) App.groupFields = JSON.parse(saved);
    } catch (e) {}
    HeaderConfig.load(App.worksheet.name);
    DisplayConfig.load(App.worksheet.name);

    _loadData();

  }).catch(err => {
    Utils.showError('Failed to initialize: ' + err.message);
  });
});

// Debounce — avoid multiple rapid reloads on filter/param changes
let _reloadTimer = null;
function _onDataChanged() {
  clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(_loadData, 300);
}

function _registerEncodingListener() {
  // Try known event type names for encoding changes
  const candidates = [
    'VizExtensionEncodingChanged',
    'vizExtensionEncodingChanged',
    'EncodingChanged',
    'encodingChanged',
  ];

  let registered = false;
  for (const name of candidates) {
    try {
      const eventType = tableau.TableauEventType[name] ?? name;
      App.worksheet.addEventListener(eventType, _onDataChanged);
      console.log('[AdvTable] Encoding listener registered:', name);
      registered = true;
      break;
    } catch (e) {
      // try next
    }
  }

  if (!registered) {
    console.warn('[AdvTable] No encoding event found, using column-count polling');
    _startColumnPolling();
  }
}

// Fallback: poll every 3s for column count changes (only if encoding events unavailable)
let _lastColumnCount = 0;
let _pollTimer = null;

function _startColumnPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    try {
      const dt = await App.worksheet.getSummaryDataAsync({ maxRows: 1, includeAllColumns: true });
      if (dt.columns.length !== _lastColumnCount) {
        _lastColumnCount = dt.columns.length;
        _onDataChanged();
      }
    } catch (e) { /* ignore */ }
  }, 3000);
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _onDisplayConfigSave() {
  DisplayConfig.save(App.worksheet?.name ?? 'default');
  Table.render(App._lastData, App._lastColumns, App.groupFields);
}

function _onHeaderConfigSave() {
  HeaderConfig.save(App.worksheet?.name ?? 'default');
  Table.render(App._lastData, App._lastColumns, App.groupFields);
}

function _onConfigSave(groupFields) {
  App.groupFields = groupFields;
  try {
    localStorage.setItem(STORAGE_KEY + '_' + App.worksheet.name, JSON.stringify(groupFields));
  } catch (e) {}
  Table.render(App._lastData, App._lastColumns, App.groupFields);
}

async function _loadData() {
  Utils.showLoading();
  try {
    const dataTable = await App.worksheet.getSummaryDataAsync({
      maxRows: 0,
      includeAllColumns: true,
    });

    const { columns, data } = Utils.parseTableauData(dataTable);
    App.allColumns   = columns;
    App._lastData    = data;
    App._lastColumns = columns;
    _lastColumnCount = columns.length;

    document.getElementById('search-input').value = '';
    Table.render(data, columns, App.groupFields);
    Utils.hideLoading();

  } catch (err) {
    Utils.showError('Error loading data: ' + err.message);
  }
}

function _bindToolbar() {
  document.getElementById('search-input').addEventListener('input', (e) => {
    Table.search(e.target.value);
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    Table.exportCSV();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    Config.open(App.allColumns, App.groupFields);
  });

  document.getElementById('btn-header-config').addEventListener('click', () => {
    HeaderConfig.open(App.allColumns, App.worksheet?.name ?? 'default');
  });

  document.getElementById('btn-display').addEventListener('click', () => {
    DisplayConfig.open(App.allColumns, App.worksheet?.name ?? 'default');
  });

  document.getElementById('btn-open-settings-error').style.display = 'none';
}

function _applyModeRestrictions() {
  try {
    const env  = tableau.extensions.environment;
    const mode = env?.mode ?? '';
    // In viewing mode hide all editing controls
    const isViewing = mode === 'viewing'
      || mode === tableau.ExtensionMode?.Viewing
      || mode === 'view';

    document.getElementById('btn-settings').style.display      = isViewing ? 'none' : '';
    document.getElementById('btn-header-config').style.display = isViewing ? 'none' : '';
    document.getElementById('btn-display').style.display       = isViewing ? 'none' : '';
  } catch (e) {
    // If API doesn't support environment, default to showing all buttons
  }
}
