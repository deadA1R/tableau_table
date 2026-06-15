const Config = (() => {
  let _onSave = null;
  let _worksheets = [];
  let _currentWsName = '';

  const modal    = () => document.getElementById('config-modal');
  const colsList = () => document.getElementById('grouping-columns-list');

  function init(onSave) {
    _onSave = onSave;
    document.getElementById('btn-save-config').onclick = _save;
    document.getElementById('btn-cancel-config').onclick = close;
    modal().querySelector('.modal-backdrop').onclick = close;
  }

  function open(worksheets, currentWsName, columns, currentGroupFields, isVizMode) {
    _worksheets    = worksheets || [];
    _currentWsName = currentWsName || '';

    const pickerRow = document.getElementById('worksheet-select')?.closest('.form-group');
    if (pickerRow) pickerRow.style.display = isVizMode ? 'none' : '';

    _renderWorksheetPicker();
    _render(columns, currentGroupFields);
    modal().classList.remove('hidden');
  }

  function close() {
    modal().classList.add('hidden');
  }

  function _renderWorksheetPicker() {
    const sel = document.getElementById('worksheet-select');
    if (!sel) return;
    sel.innerHTML = '';
    _worksheets.forEach(ws => {
      const opt = document.createElement('option');
      opt.value = ws.name;
      opt.textContent = ws.name;
      opt.selected = ws.name === _currentWsName;
      sel.appendChild(opt);
    });
  }

  function _render(columns, selectedFields) {
    const container = colsList();
    container.innerHTML = '';

    const ordered = [
      ...selectedFields.filter(f => columns.find(c => c.field === f)),
      ...columns.filter(c => !selectedFields.includes(c.field)).map(c => c.field),
    ];

    ordered.forEach(field => {
      const col = columns.find(c => c.field === field);
      if (!col) return;
      container.appendChild(_buildItem(field, col.headerName, selectedFields.includes(field)));
    });

    _updateBadges();
  }

  function _buildItem(field, label, isChecked) {
    const item = document.createElement('div');
    item.className = 'col-item';
    item.dataset.field = field;

    const upBtn = document.createElement('button');
    upBtn.className = 'col-move-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Move up';
    upBtn.onclick = () => _move(item, -1);

    const downBtn = document.createElement('button');
    downBtn.className = 'col-move-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Move down';
    downBtn.onclick = () => _move(item, 1);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'cb_' + field;
    cb.checked = isChecked;
    cb.addEventListener('change', _updateBadges);

    const badge = document.createElement('span');
    badge.className = 'col-order';

    const lbl = document.createElement('label');
    lbl.htmlFor = 'cb_' + field;
    lbl.textContent = label;
    lbl.style.cssText = 'cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    item.append(upBtn, downBtn, cb, badge, lbl);
    return item;
  }

  function _move(item, dir) {
    const container = colsList();
    const items = [...container.querySelectorAll('.col-item')];
    const idx = items.indexOf(item);
    const target = items[idx + dir];
    if (!target) return;
    if (dir === -1) container.insertBefore(item, target);
    else container.insertBefore(target, item);
    _updateBadges();
  }

  function _updateBadges() {
    let n = 1;
    colsList().querySelectorAll('.col-item').forEach(item => {
      const cb    = item.querySelector('input[type=checkbox]');
      const badge = item.querySelector('.col-order');
      badge.textContent = cb.checked ? n++ : '';
    });
  }

  function _getChecked() {
    return [...colsList().querySelectorAll('.col-item')]
      .filter(item => item.querySelector('input[type=checkbox]').checked)
      .map(item => item.dataset.field);
  }

  function _save() {
    const sel = document.getElementById('worksheet-select');
    const wsName = sel ? sel.value : _currentWsName;
    close();
    if (_onSave) _onSave(wsName, _getChecked());
  }

  return { init, open, close };
})();
