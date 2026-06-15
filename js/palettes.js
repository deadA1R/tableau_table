const Palettes = (() => {
  const STORAGE_KEY = 'advtable_palettes_global';

  const BUILT_IN = [
    { id: 'bi_traffic',  name: 'Traffic Light', locked: true, colors: ['#e53935','#fb8c00','#43a047','#ffffff'] },
    { id: 'bi_blues',    name: 'Blues',          locked: true, colors: ['#e3f2fd','#90caf9','#1565c0','#0d47a1'] },
    { id: 'bi_greens',   name: 'Greens',         locked: true, colors: ['#e8f5e9','#a5d6a7','#388e3c','#1b5e20'] },
    { id: 'bi_reds',     name: 'Reds',           locked: true, colors: ['#ffebee','#ef9a9a','#e53935','#b71c1c'] },
    { id: 'bi_warm',     name: 'Warm',           locked: true, colors: ['#fff8e1','#ffe082','#fb8c00','#e65100'] },
    { id: 'bi_neutral',  name: 'Neutral',        locked: true, colors: ['#fafafa','#e0e0e0','#757575','#212121'] },
    { id: 'bi_corp',     name: 'Corporate',      locked: true, colors: ['#e8eaf6','#7986cb','#3949ab','#1a237e'] },
    { id: 'bi_pastel',   name: 'Pastel',         locked: true, colors: ['#f8bbd0','#ce93d8','#90caf9','#a5d6a7','#ffe082'] },
  ];

  let _userPalettes = [];

  function _genId() { return 'p' + Math.random().toString(36).slice(2, 9); }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      _userPalettes = raw ? JSON.parse(raw) : [];
    } catch(e) { _userPalettes = []; }
  }

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_userPalettes)); } catch(e) {}
  }

  function getAll() { return [...BUILT_IN, ..._userPalettes]; }

  function addPalette(name, colors) {
    const id = _genId();
    _userPalettes.push({ id, name, colors: colors || ['#cccccc'] });
    _save();
    return id;
  }

  function updatePalette(id, name, colors) {
    const p = _userPalettes.find(p => p.id === id);
    if (p) { p.name = name; p.colors = colors; _save(); }
  }

  function deletePalette(id) {
    _userPalettes = _userPalettes.filter(p => p.id !== id);
    _save();
  }

  // ── Quick picker popup ──────────────────────────────────────────────────────

  function showPicker(anchorEl, onSelect) {
    document.getElementById('pal-picker-popup')?.remove();
    load();

    const popup = document.createElement('div');
    popup.id = 'pal-picker-popup';
    popup.className = 'pal-picker-popup';

    getAll().forEach(pal => {
      const row = document.createElement('div');
      row.className = 'pal-picker-row';

      const name = document.createElement('span');
      name.className = 'pal-picker-name';
      name.textContent = pal.name;
      row.appendChild(name);

      const swatches = document.createElement('div');
      swatches.className = 'pal-picker-swatches';
      pal.colors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = 'pal-swatch';
        btn.style.background = color;
        btn.title = color;
        btn.onclick = (e) => { e.stopPropagation(); onSelect(color); popup.remove(); };
        swatches.appendChild(btn);
      });

      row.appendChild(swatches);
      popup.appendChild(row);
    });

    document.body.appendChild(popup);
    const r = anchorEl.getBoundingClientRect();
    popup.style.top  = (r.bottom + 4) + 'px';
    popup.style.left = Math.min(r.left, window.innerWidth - 240) + 'px';

    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', h); }
      });
    }, 0);
  }

  // ── Color picker helper with palette button ─────────────────────────────────

  function colorInput(value, onChange, label) {
    const wrap = document.createElement('span');
    wrap.className = 'color-picker-wrap';

    if (label) {
      const lbl = document.createElement('span');
      lbl.className = 'color-picker-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
    }

    const inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'color-picker-input';
    inp.value = value || '#ffffff';
    inp.oninput = (e) => onChange(e.target.value);

    const palBtn = document.createElement('button');
    palBtn.className = 'pal-inline-btn';
    palBtn.title = 'Pick from palette';
    palBtn.textContent = '▤';
    palBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      showPicker(palBtn, (c) => { inp.value = c; onChange(c); });
    };

    wrap.append(inp, palBtn);
    return wrap;
  }

  // ── Palette Manager Modal ───────────────────────────────────────────────────

  function openManager() {
    load();
    let modal = document.getElementById('pal-manager-modal');
    if (!modal) { modal = _buildManagerModal(); document.getElementById('app').appendChild(modal); }
    _renderManager();
    modal.classList.remove('hidden');
  }

  function _buildManagerModal() {
    const modal = document.createElement('div');
    modal.id = 'pal-manager-modal';
    modal.className = 'modal hidden';

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.onclick = () => modal.classList.add('hidden');

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.width = '500px';

    const h2 = document.createElement('h2');
    h2.textContent = 'Color Palettes';

    const body = document.createElement('div');
    body.id = 'pal-manager-body';
    body.style.cssText = 'max-height:420px;overflow-y:auto';

    const footer = document.createElement('div');
    footer.className = 'modal-buttons';
    footer.style.flexDirection = 'column';
    footer.style.gap = '6px';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.textContent = '+ New palette';
    addBtn.style.width = '100%';
    addBtn.onclick = () => {
      addPalette('New palette', ['#1f77b4','#ff7f0e','#2ca02c','#d62728']);
      _renderManager();
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.textContent = 'Close';
    closeBtn.style.width = '100%';
    closeBtn.onclick = () => modal.classList.add('hidden');

    footer.append(addBtn, closeBtn);
    content.append(h2, body, footer);
    modal.append(bd, content);
    return modal;
  }

  function _renderManager() {
    const body = document.getElementById('pal-manager-body');
    if (!body) return;
    body.innerHTML = '';

    getAll().forEach(pal => {
      const row = document.createElement('div');
      row.className = 'pal-mgr-row';

      const nameInp = document.createElement('input');
      nameInp.type = 'text';
      nameInp.className = 'pal-mgr-name';
      nameInp.value = pal.name;
      nameInp.disabled = !!pal.locked;
      if (!pal.locked) nameInp.oninput = (e) => updatePalette(pal.id, e.target.value, pal.colors);

      const swatchRow = document.createElement('div');
      swatchRow.className = 'pal-swatch-edit-row';

      pal.colors.forEach((color, ci) => {
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = color;
        inp.disabled = !!pal.locked;
        inp.className = 'pal-color-edit-inp';
        inp.title = color;
        if (!pal.locked) inp.oninput = (e) => { pal.colors[ci] = e.target.value; updatePalette(pal.id, pal.name, pal.colors); };
        swatchRow.appendChild(inp);
      });

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:4px;align-items:center';

      if (!pal.locked) {
        const addC = document.createElement('button');
        addC.className = 'tree-btn';
        addC.textContent = '+';
        addC.title = 'Add color';
        addC.onclick = () => { pal.colors.push('#cccccc'); updatePalette(pal.id, pal.name, pal.colors); _renderManager(); };

        const del = document.createElement('button');
        del.className = 'tree-btn tree-btn-del';
        del.textContent = '✕';
        del.onclick = () => { deletePalette(pal.id); _renderManager(); };

        actions.append(addC, del);
      } else {
        const tag = document.createElement('span');
        tag.className = 'pal-locked-tag';
        tag.textContent = 'built-in';
        actions.appendChild(tag);
      }

      row.append(nameInp, swatchRow, actions);
      body.appendChild(row);
    });
  }

  load();
  return { load, getAll, addPalette, updatePalette, deletePalette, showPicker, colorInput, openManager };
})();
