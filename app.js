/**
 * @file app.js
 * @description Script principal pour Chroma Studio (premium).
 * @version 2.3.0 — stable + améliorations (aperçu canvas, worker ++, import tolérant, Alt+Export→copie, L/C, A11y)
 */

// ==========================================================================
// 0. CONFIGURATION & DOM REFERENCES
// ==========================================================================
const CONFIG = {
  PALETTE_MIN_SIZE: 4,
  PALETTE_MAX_SIZE: 32,
  HISTORY_MAX_SIZE: 30,
  LOCAL_STORAGE_KEY: 'chromaStudioProject_v2',
  DEBOUNCE_DELAY: 300,
  PREVIEW_MAX_W: 640, // rendu canvas plus propre
};

const DOM = {
  // Global
  html: document.documentElement,
  liveAnnouncer: document.getElementById('live-announcer'),
  snackbar: document.getElementById('snackbar'),
  themeToggle: document.getElementById('theme-toggle'),
  themeIconDark: document.getElementById('theme-icon-dark'),
  themeIconLight: document.getElementById('theme-icon-light'),

  // Left Sidebar
  imageDropZone: document.getElementById('image-drop-zone'),
  imagePlaceholder: document.getElementById('image-placeholder'),
  imagePreview: document.getElementById('image-preview'), // <canvas>
  clearImageBtn: document.getElementById('clear-image-btn'),
  imageInput: document.getElementById('image-input'),
  quantizationAlgo: document.getElementById('quantization-algo'),
  paletteSizeSlider: document.getElementById('palette-size-slider'),
  paletteSizeValue: document.getElementById('palette-size-value'),
  generateFromImageBtn: document.getElementById('generate-from-image-btn'),
  seedColorInput: document.getElementById('seed-color-input'),
  seedColorPicker: document.getElementById('seed-color-picker'),
  harmonyType: document.getElementById('harmony-type'),
  generateFromHarmonyBtn: document.getElementById('generate-from-harmony-btn'),
  rngSeedInput: document.getElementById('rng-seed-input'),
  randomizeSeedBtn: document.getElementById('randomize-seed-btn'),
  generateRandomBtn: document.getElementById('generate-random-btn'),

  // Main Content
  undoBtn: document.getElementById('undo-btn'),
  redoBtn: document.getElementById('redo-btn'),
  paletteContainer: document.getElementById('palette-container'),
  paletteEmptyState: document.getElementById('palette-empty-state'),

  // Right Sidebar Tabs
  tabButtons: {
    editor: document.getElementById('tab-btn-editor'),
    analyze: document.getElementById('tab-btn-analyze'),
    export: document.getElementById('tab-btn-export'),
  },
  tabPanels: {
    editor: document.getElementById('tab-panel-editor'),
    analyze: document.getElementById('tab-panel-analyze'),
    export: document.getElementById('tab-panel-export'),
  },

  // Color Editor
  colorEditorPanel: document.getElementById('color-editor-panel'),
  editorEmptyState: document.getElementById('editor-empty-state'),
  editorSwatchPreview: document.getElementById('editor-swatch-preview'),
  editorHex: document.getElementById('editor-hex'),
  editorRgb: { r: document.getElementById('editor-rgb-r'), g: document.getElementById('editor-rgb-g'), b: document.getElementById('editor-rgb-b') },
  editorHsl: { h: document.getElementById('editor-hsl-h'), s: document.getElementById('editor-hsl-s'), l: document.getElementById('editor-hsl-l') },
  generateTonalRampBtn: document.getElementById('generate-tonal-ramp-btn'),

  // Analysis
  contrastGridContainer: document.getElementById('contrast-grid-container'),
  visionSimulationSelect: document.getElementById('vision-simulation-select'),

  // Export & Import
  exportJsonBtn: document.getElementById('export-json-btn'),
  exportCssBtn: document.getElementById('export-css-btn'),
  exportSvgBtn: document.getElementById('export-svg-btn'),
  exportPngBtn: document.getElementById('export-png-btn'),
  exportTxtBtn: document.getElementById('export-txt-btn'),
  importFileInput: document.getElementById('import-file-input'),

  // Modal
  helpModal: document.getElementById('help-modal'),
  showHelpBtn: document.getElementById('show-help-btn'),
  closeHelpModalBtn: document.getElementById('close-help-modal-btn'),
};

// ==========================================================================
// 1. STATE MANAGEMENT
// ==========================================================================
/** @typedef {{id:string, rgb:[number,number,number], locked:boolean}} ColorObject */
/** @type {{palette: ColorObject[], selectedColorId: string|null, imageURL: string|null}} */
let state;

const history = { stack: [], index: -1 };

function getInitialState() {
  return { palette: [], selectedColorId: null, imageURL: null };
}

/** Safe clone */
const clone = (obj) => ('structuredClone' in window) ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));

/**
 * Updates the application state, saves it, and triggers a re-render.
 * (ajout : copie défensive pour fiabilité historique)
 */
function updateState(updater, options = { addToHistory: true }) {
  const base = clone(state);
  const newState = clone(updater(base));

  if (options.addToHistory) {
    if (history.index < history.stack.length - 1) history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(clone(newState));
    if (history.stack.length > CONFIG.HISTORY_MAX_SIZE) history.stack.shift();
    history.index = history.stack.length - 1;
  }

  state = newState;
  render();
  saveStateToLocalStorage();
}

function undo() {
  if (history.index > 0) {
    history.index--;
    const previousState = clone(history.stack[history.index]);
    state = previousState;
    render(); saveStateToLocalStorage(); announce('Action annulée');
  }
}

function redo() {
  if (history.index < history.stack.length - 1) {
    history.index++;
    const nextState = clone(history.stack[history.index]);
    state = nextState;
    render(); saveStateToLocalStorage(); announce('Action rétablie');
  }
}

function saveStateToLocalStorage() {
  try { localStorage.setItem(CONFIG.LOCAL_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem(CONFIG.LOCAL_STORAGE_KEY);
    if (!saved) return getInitialState();
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.palette)) return getInitialState();
    return Object.assign(getInitialState(), parsed);
  } catch { return getInitialState(); }
}

// ==========================================================================
// 2. RENDERING ENGINE
// ==========================================================================
function render() {
  renderPalette();
  renderColorEditor();
  renderAnalysis();
  updateHistoryButtons();
  updateImagePreview();
}

function renderPalette() {
  DOM.paletteContainer.innerHTML = '';
  const visionMode = DOM.visionSimulationSelect.value;

  if (state.palette.length === 0) {
    DOM.paletteEmptyState.classList.remove('hidden');
    return;
  }
  DOM.paletteEmptyState.classList.add('hidden');

  state.palette.forEach((color) => {
    const simulatedRgb = ColorUtils.simulateColorDeficiency(color.rgb, visionMode);
    const hex = ColorUtils.rgbToHex(simulatedRgb);
    const textColor = ColorUtils.getBestTextColor(simulatedRgb);

    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.classList.toggle('selected', color.id === state.selectedColorId);
    swatch.dataset.colorId = color.id;
    swatch.draggable = true;

    swatch.innerHTML = `
      <div class="color-swatch-display" style="background-color:${hex};color:${ColorUtils.rgbToHex(textColor)}" data-action="select">
        <span class="lock-indicator">${color.locked ? lockSvg() : ''}</span>
      </div>
      <div class="color-swatch-info" data-action="select">
        <div class="color-name">${ColorUtils.getClosestColorName(color.rgb)}</div>
        <div class="color-code" title="Cliquez pour copier">${ColorUtils.rgbToHex(color.rgb)}</div>
      </div>
      <div class="color-swatch-actions">
        <button class="icon-button" data-action="lock" aria-label="${color.locked ? 'Déverrouiller' : 'Verrouiller'} la couleur">
          ${lockToggleSvg(color.locked)}
        </button>
        <button class="icon-button" data-action="duplicate" aria-label="Dupliquer la couleur">${duplicateSvg()}</button>
        <button class="icon-button" data-action="delete" aria-label="Supprimer la couleur">${trashSvg()}</button>
      </div>
    `;
    DOM.paletteContainer.appendChild(swatch);
  });
}

function renderColorEditor() {
  const selectedColor = state.palette.find(c => c.id === state.selectedColorId);
  if (!selectedColor) {
    DOM.colorEditorPanel.classList.add('hidden');
    DOM.editorEmptyState.classList.remove('hidden');
    return;
  }
  DOM.colorEditorPanel.classList.remove('hidden');
  DOM.editorEmptyState.classList.add('hidden');

  isEditingInternally = true;
  const { rgb } = selectedColor;
  const hex = ColorUtils.rgbToHex(rgb);
  const hsl = ColorUtils.rgbToHsl(rgb).map(Math.round);

  DOM.editorSwatchPreview.style.backgroundColor = hex;
  DOM.editorHex.value = hex;
  [DOM.editorRgb.r.value, DOM.editorRgb.g.value, DOM.editorRgb.b.value] = rgb;
  [DOM.editorHsl.h.value, DOM.editorHsl.s.value, DOM.editorHsl.l.value] = hsl;

  setTimeout(() => (isEditingInternally = false), 50);
}

function renderAnalysis() {
  if (state.palette.length < 2) {
    DOM.contrastGridContainer.innerHTML = `<p class="empty-state">Ajoutez au moins deux couleurs pour l'analyse.</p>`;
    return;
  }
  const table = document.createElement('table');
  table.className = 'contrast-grid';
  let thead = '<thead><tr><th></th>';
  state.palette.forEach((_, i) => (thead += `<th>${i + 1}</th>`));
  thead += '</tr></thead>';
  table.innerHTML = thead;

  const tbody = document.createElement('tbody');
  state.palette.forEach((c1, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${i + 1}</th>`;
    state.palette.forEach((c2, j) => {
      const td = document.createElement('td');
      if (i === j) td.textContent = '—';
      else {
        const ratio = ColorUtils.getContrastRatio(c1.rgb, c2.rgb);
        let label, bg;
        if (ratio >= 7) { label = 'AAA'; bg = '#4ade80'; }
        else if (ratio >= 4.5) { label = 'AA'; bg = '#60a5fa'; }
        else if (ratio >= 3) { label = 'AA Large'; bg = '#facc15'; }
        else { label = 'Fail'; bg = '#f87171'; }
        td.title = `Contraste #${i + 1} vs #${j + 1}: ${ratio.toFixed(2)}`;
        td.innerHTML = `<span class="contrast-badge" style="background:${bg}">${label}</span>`;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  DOM.contrastGridContainer.innerHTML = '';
  DOM.contrastGridContainer.appendChild(table);
}

function updateHistoryButtons() {
  DOM.undoBtn.disabled = history.index <= 0;
  DOM.redoBtn.disabled = history.index >= history.stack.length - 1;
}

/** Aperçu image (canvas) */
function updateImagePreview() {
  const hasImage = !!state.imageURL;
  const canvas = DOM.imagePreview;
  const ph = DOM.imagePlaceholder;
  const clearBtn = DOM.clearImageBtn;
  const ctx = canvas.getContext('2d');

  if (!hasImage) {
    ph.style.display = 'flex';
    canvas.style.display = 'none';
    clearBtn.classList.add('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    DOM.generateFromImageBtn.disabled = true;
    return;
  }

  // Charger l’image et la dessiner dans le canvas à la bonne taille
  const img = new Image();
  img.onload = () => {
    const zone = DOM.imageDropZone.getBoundingClientRect();
    const maxW = Math.min(CONFIG.PREVIEW_MAX_W, Math.floor(zone.width));
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    ph.style.display = 'none';
    canvas.style.display = 'block';
    clearBtn.classList.remove('hidden');
    DOM.generateFromImageBtn.disabled = false;
  };
  img.src = state.imageURL;
}

// ==========================================================================
// 3. COLOR UTILITIES
// ==========================================================================
const ColorUtils = (() => {
  const self = {};

  // Conversions
  self.rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c|0)).toString(16).padStart(2, '0')).join('').toUpperCase();
  self.hexToRgb = (hex) => {
    if (typeof hex !== 'string') return null;
    let h = hex.trim(); if (h.startsWith('#')) h = h.slice(1);
    if (h.length === 3) h = [...h].map(x => x + x).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  self.parseCssColorToRgb = (input) => {
    if (!input) return null;
    const hex = self.hexToRgb(input);
    if (hex) return hex;
    // Canvas trick pour mots-clés CSS
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#000';
    c.fillStyle = String(input);
    const res = c.fillStyle;
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(res);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
  };

  self.rgbToHsl = ([r, g, b]) => {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h, s, l=(max+min)/2;
    if (max===min){h=s=0;}
    else {
      const d=max-min;
      s=l>0.5? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
      }
      h/=6;
    }
    return [h*360, s*100, l*100];
  };

  self.hslToRgb = ([h, s, l]) => {
    s/=100; l/=100;
    const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
    let r=0,g=0,b=0;
    if (0<=h && h<60){r=c; g=x;}
    else if (60<=h && h<120){r=x; g=c;}
    else if (120<=h && h<180){g=c; b=x;}
    else if (180<=h && h<240){g=x; b=c;}
    else if (240<=h && h<300){r=x; b=c;}
    else {r=c; b=x;}
    return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
  };

  // WCAG
  self.getLuminance = ([r,g,b]) => {
    const a=[r,g,b].map(v => {
      v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
    });
    return a[0]*0.2126 + a[1]*0.7152 + a[2]*0.0722;
  };
  self.getContrastRatio = (rgb1, rgb2) => {
    const L1=self.getLuminance(rgb1), L2=self.getLuminance(rgb2);
    const hi=Math.max(L1,L2), lo=Math.min(L1,L2);
    return (hi+0.05)/(lo+0.05);
  };
  self.getBestTextColor = (bgRgb) => self.getContrastRatio(bgRgb,[0,0,0]) > self.getContrastRatio(bgRgb,[255,255,255]) ? [0,0,0] : [255,255,255];

  // Harmonies
  self.getHarmony = (rgb, type, count) => {
    const [h,s,l] = self.rgbToHsl(rgb);
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    const wrap = (x)=> (x%360+360)%360;
    const arr = [];
    switch(type){
      case 'analogous': [-30,-15,0,15,30].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
      case 'monochromatic': [l*0.5,l*0.7,l, clamp(l*1.15,0,100), clamp(l*1.3,0,100)].forEach(L=>arr.push(self.hslToRgb([h,s, clamp(L,5,95)]))); break;
      case 'complementary': [0,180].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
      case 'split-complementary': [0,150,210].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
      case 'triadic': [0,120,240].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
      case 'tetradic': [0,90,180,270].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
    }
    return arr.slice(0, Math.max(CONFIG.PALETTE_MIN_SIZE, Math.min(count, CONFIG.PALETTE_MAX_SIZE)));
  };

  // Vision simulation
  const matrices = {
    protanopia:[0.567,0.433,0, 0.558,0.442,0, 0,0.242,0.758],
    deuteranopia:[0.625,0.375,0, 0.7,0.3,0, 0,0.3,0.7],
    tritanopia:[0.95,0.05,0, 0,0.433,0.567, 0,0.475,0.525],
  };
  self.simulateColorDeficiency = (rgb, type) => {
    if (type==='normal' || !matrices[type]) return rgb;
    const m = matrices[type], [r,g,b]=rgb;
    return [
      Math.round(r*m[0]+g*m[1]+b*m[2]),
      Math.round(r*m[3]+g*m[4]+b*m[5]),
      Math.round(r*m[6]+g*m[7]+b*m[8]),
    ];
  };

  // Naming basique (restreint)
  const named = { Red:[255,0,0], Green:[0,128,0], Blue:[0,0,255], Yellow:[255,255,0], Cyan:[0,255,255], Magenta:[255,0,255], White:[255,255,255], Black:[0,0,0], Gray:[128,128,128], Orange:[255,165,0], Purple:[128,0,128], Brown:[165,42,42], Pink:[255,192,203] };
  self.getClosestColorName = (rgb) => {
    let best='Couleur', dMin=Infinity;
    for (const k in named){
      const [r2,g2,b2]=named[k];
      const d = (rgb[0]-r2)**2 + (rgb[1]-g2)**2 + (rgb[2]-b2)**2;
      if (d<dMin){ dMin=d; best=k; }
    }
    return best;
  };

  // PRNG
  self.createPrng = (seedStr) => {
    let seed = 0; for (let i=0;i<seedStr.length;i++){ seed = (seed<<5)-seed + seedStr.charCodeAt(i); seed|=0; }
    return () => { seed = Math.sin(seed)*10000; return seed - Math.floor(seed); };
  };

  return self;
})();

// ==========================================================================
// 4. WEB WORKER & HEAVY TASKS (K-Means++ + fallback)
// ==========================================================================
const ColorWorker = (() => {
  let worker; let resolvers = {}; let nextId = 0;

  const workerCode = `
    function sq(a,b){const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2];return dx*dx+dy*dy+dz*dz;}
    function kMeansPlusPlus(pixels,k,maxIter=20){
      if (pixels.length===0) return [];
      const n=pixels.length; const centroids=[];
      centroids.push(pixels[Math.floor(Math.random()*n)]);
      while (centroids.length<k){
        const d=pixels.map(p=>Math.min(...centroids.map(c=>sq(p,c))));
        const sum=d.reduce((a,v)=>a+v,0)||1;
        let r=Math.random()*sum, idx=0; while(r>0 && idx<d.length){ r-=d[idx++]; }
        centroids.push(pixels[Math.min(idx, n-1)]);
      }
      let assign=new Array(n).fill(0);
      for (let it=0; it<maxIter; it++){
        let changed=false;
        for (let i=0;i<n;i++){
          let best=0, bestD=Infinity;
          for (let j=0;j<k;j++){ const dd=sq(pixels[i],centroids[j]); if (dd<bestD){ bestD=dd; best=j; } }
          if (assign[i]!==best){ assign[i]=best; changed=true; }
        }
        const sums=Array.from({length:k},()=>[0,0,0]); const cnt=new Array(k).fill(0);
        for (let i=0;i<n;i++){ const c=assign[i]; sums[c][0]+=pixels[i][0]; sums[c][1]+=pixels[i][1]; sums[c][2]+=pixels[i][2]; cnt[c]++; }
        for (let j=0;j<k;j++){ if (cnt[j]>0){ centroids[j]=[sums[j][0]/cnt[j], sums[j][1]/cnt[j], sums[j][2]/cnt[j]]; } }
        if (!changed) break;
      }
      return centroids.map(c=>c.map(Math.round));
    }
    function medianCut(pixels,k){ // fallback léger: proxy vers K-Means++ (rapide et stable ici)
      return kMeansPlusPlus(pixels,k,12);
    }
    self.onmessage = (e) => {
      const {id,type,payload}=e.data;
      try{
        if (type==='quantize'){
          const {pixels,options}=payload;
          const k = Math.max(2, Math.min(64, options.count||8));
          const algo = String(options.algo||'kmeans');
          const out = (algo==='kmeans') ? kMeansPlusPlus(pixels,k,20) : medianCut(pixels,k);
          self.postMessage({id,type:'success',payload:out});
        }
      }catch(err){
        self.postMessage({id,type:'error',payload: err && err.message ? err.message : String(err)});
      }
    };
  `;

  function init(){
    try{
      const blob = new Blob([workerCode],{type:'application/javascript'});
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = (e)=> {
        const {id,type,payload} = e.data;
        const r = resolvers[id];
        if (!r) return;
        if (type==='success') r.resolve(payload); else r.reject(new Error(payload));
        delete resolvers[id];
      };
    }catch(e){ console.error('Worker init failed', e); worker = null; }
  }

  function run(type, payload){
    if (!worker) return Promise.reject(new Error('Worker not available'));
    const id = nextId++;
    return new Promise((resolve,reject)=>{ resolvers[id]={resolve,reject}; worker.postMessage({id,type,payload}); });
  }

  return { init, run };
})();

// ==========================================================================
// 5. CORE LOGIC & EVENT HANDLERS
// ==========================================================================
let isEditingInternally = false;
let draggedElement = null;
let hoveredColorId = null;

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (state.imageURL) URL.revokeObjectURL(state.imageURL);
  const url = URL.createObjectURL(file);
  updateState(s => ({ ...s, imageURL: url }));
}

function generatePaletteFromImage() {
  if (!state.imageURL) return;
  // Lire depuis le canvas d’aperçu (déjà redimensionné proprement)
  const canvas = DOM.imagePreview;
  const ctx = canvas.getContext('2d');
  if (canvas.width === 0 || canvas.height === 0) return;

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = [];
  for (let i=0; i<data.length; i+=4){
    const a = data[i+3];
    // filtrer transparent et presque blanc
    if (a>128 && (data[i]<250 || data[i+1]<250 || data[i+2]<250)) {
      pixels.push([data[i], data[i+1], data[i+2]]);
    }
  }

  const options = { count: parseInt(DOM.paletteSizeSlider.value,10), algo: DOM.quantizationAlgo.value };
  ColorWorker.run('quantize', { pixels, options })
    .then(result => {
      updateState(s => ({ ...s, palette: result.map(rgb => ({ id: generateUID(), rgb, locked:false })) }));
      announce(`${result.length} couleurs extraites de l'image.`);
      toast('Palette extraite ✔');
    })
    .catch(err => { console.error(err); announce("Erreur lors du traitement de l'image."); toast("Erreur d'extraction", true); });
}

function generatePaletteFromHarmony() {
  const raw = DOM.seedColorInput.value || DOM.seedColorPicker.value || '#3498DB';
  const rgb = ColorUtils.parseCssColorToRgb(raw) || ColorUtils.hexToRgb(raw);
  if (!rgb) { toast('Couleur seed invalide', true); return; }

  const count = parseInt(DOM.paletteSizeSlider.value, 10);
  const harmonyType = DOM.harmonyType.value;
  const paletteRgb = ColorUtils.getHarmony(rgb, harmonyType, count);
  updateState(s => ({
    ...s,
    palette: s.palette
      .map(c => c.locked ? c : { ...c, rgb: paletteRgb.shift() || c.rgb })
      .concat(paletteRgb.map(r => ({ id: generateUID(), rgb: r, locked: false })))
      .slice(0, count)
  }));
  announce(`Palette harmonique "${harmonyType}" générée.`);
  toast('Harmonie générée ✔');
}

function generateRandomPalette() {
  const seed = DOM.rngSeedInput.value || Date.now().toString();
  const prng = ColorUtils.createPrng(seed);
  const count = parseInt(DOM.paletteSizeSlider.value, 10);
  const next = Array.from({length: count}, () => ({
    id: generateUID(),
    rgb: [Math.floor(prng()*256), Math.floor(prng()*256), Math.floor(prng()*256)],
    locked: false
  }));

  updateState(s => ({
    ...s,
    palette: s.palette
      .map((c) => c.locked ? c : (next.shift() || c))
      .concat(next)
      .slice(0, count)
  }));
  announce('Palette aléatoire générée.');
  toast('Palette aléatoire ✔');
}

function handleEditorInputChange(event) {
  if (isEditingInternally || !state.selectedColorId) return;
  const t = event.target;
  let newRgb = null;

  if (t.id === 'editor-hex') {
    newRgb = ColorUtils.hexToRgb(t.value) || ColorUtils.parseCssColorToRgb(t.value);
  } else if (t.id.startsWith('editor-rgb')) {
    const r = parseInt(DOM.editorRgb.r.value, 10);
    const g = parseInt(DOM.editorRgb.g.value, 10);
    const b = parseInt(DOM.editorRgb.b.value, 10);
    if (![r,g,b].some(Number.isNaN)) newRgb = [r,g,b];
  } else if (t.id.startsWith('editor-hsl')) {
    const h = Math.max(0, Math.min(360, parseInt(DOM.editorHsl.h.value,10) || 0));
    const s = Math.max(0, Math.min(100, parseInt(DOM.editorHsl.s.value,10) || 0));
    const l = Math.max(0, Math.min(100, parseInt(DOM.editorHsl.l.value,10) || 0));
    newRgb = ColorUtils.hslToRgb([h,s,l]);
  }

  if (newRgb) {
    updateState(s => ({
      ...s,
      palette: s.palette.map(c => c.id === s.selectedColorId ? { ...c, rgb: newRgb } : c)
    }));
  }
}
const debouncedEditorInputHandler = debounce(handleEditorInputChange, CONFIG.DEBOUNCE_DELAY);

// ==========================================================================
// 6. IMPORT / EXPORT
// ==========================================================================
const IO = {
  async export(format, event) {
    if (state.palette.length === 0) return;
    const hexPalette = state.palette.map(c => ColorUtils.rgbToHex(c.rgb));
    let content, mime, filename;

    const toClipboard = async (text) => {
      try { await navigator.clipboard.writeText(text); toast('Copié dans le presse-papiers ✔'); }
      catch { toast('Impossible de copier', true); }
    };

    switch (format) {
      case 'json': {
        const data = { name: "Chroma Studio Palette", colors: state.palette };
        content = JSON.stringify(data, null, 2);
        mime = 'application/json'; filename = 'palette.json';
        if (event?.altKey) return toClipboard(content);
        break;
      }
      case 'css': {
        content = `:root {\n${hexPalette.map((hex,i)=>`  --color-${i+1}: ${hex};`).join('\n')}\n}\n`;
        mime = 'text/css'; filename = 'palette.css';
        if (event?.altKey) return toClipboard(content);
        break;
      }
      case 'svg': {
        const w = 100, h = 500, W = hexPalette.length * w;
        const rects = hexPalette.map((hex,i)=>`<rect x="${i*w}" width="${w}" height="${h}" fill="${hex}"/>`).join('');
        content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${rects}</svg>`;
        mime = 'image/svg+xml'; filename = 'palette.svg';
        if (event?.altKey) return toClipboard(content);
        break;
      }
      case 'png': {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = hexPalette.length * 100; canvas.height = 500;
        hexPalette.forEach((hex,i)=>{ ctx.fillStyle = hex; ctx.fillRect(i*100,0,100,500); });
        return canvas.toBlob(blob => this.download(blob, 'palette.png'));
      }
      case 'txt': {
        content = `Chroma Studio Palette\n${new Date().toISOString()}\n\n` +
          state.palette.map((c,i)=>`Color ${i+1}: ${ColorUtils.rgbToHex(c.rgb)} | rgb(${c.rgb.join(', ')})`).join('\n');
        mime = 'text/plain'; filename = 'palette.txt';
        if (event?.altKey) return toClipboard(content);
        break;
      }
    }
    this.download(new Blob([content], {type:mime}), filename);
  },

  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href:url, download:filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  },

  import(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Tolérant : {colors:[{rgb,locked,id?..}]} ou ["#hex", ...]
        let colors = [];
        if (Array.isArray(data)) {
          colors = data.map(x => ColorUtils.hexToRgb(String(x))).filter(Boolean).map(rgb => ({id:generateUID(), rgb, locked:false}));
        } else if (Array.isArray(data.colors)) {
          if (typeof data.colors[0] === 'string') {
            colors = data.colors.map(x => ColorUtils.hexToRgb(String(x))).filter(Boolean).map(rgb => ({id:generateUID(), rgb, locked:false}));
          } else {
            // on garde ce qui ressemble déjà à ColorObject (mais re-id)
            colors = data.colors
              .map(c => Array.isArray(c.rgb) && c.rgb.length===3 ? ({id:generateUID(), rgb:c.rgb.map(n=>n|0), locked:!!c.locked}) : null)
              .filter(Boolean);
          }
        }
        if (colors.length === 0) throw new Error('No colors');
        updateState(s => ({ ...s, palette: colors, selectedColorId: null }));
        announce('Palette importée avec succès.');
        toast('Import réussi ✔');
      } catch {
        announce("Échec de l'importation du fichier JSON.");
        toast("JSON invalide", true);
      }
    };
    reader.readAsText(file);
  }
};

// ==========================================================================
// 7. UTILITIES & INITIALIZATION
// ==========================================================================
function debounce(fn, delay) {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,a), delay); };
}
function generateUID() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function announce(msg) {
  DOM.liveAnnouncer.textContent = msg;
  setTimeout(()=>{ DOM.liveAnnouncer.textContent=''; }, 800);
}
function toast(text, danger=false){
  if (!DOM.snackbar) return;
  DOM.snackbar.textContent = text;
  DOM.snackbar.classList.toggle('danger', !!danger);
  DOM.snackbar.classList.add('show');
  setTimeout(()=>DOM.snackbar.classList.remove('show'), 1800);
}

function bindEventListeners() {
  // Theme
  DOM.themeToggle.addEventListener('click', () => {
    const newTheme = DOM.html.dataset.theme === 'dark' ? 'light' : 'dark';
    DOM.html.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    DOM.themeIconDark.classList.toggle('hidden', newTheme === 'light');
    DOM.themeIconLight.classList.toggle('hidden', newTheme === 'dark');
  });

  // Image Input
  DOM.imageDropZone.addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); });
  DOM.imageDropZone.addEventListener('dragleave', e => e.currentTarget.classList.remove('drag-over'));
  DOM.imageDropZone.addEventListener('drop', e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); handleImageFile(e.dataTransfer.files[0]); });
  DOM.imageDropZone.addEventListener('click', () => DOM.imageInput.click());
  DOM.imageDropZone.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); DOM.imageInput.click(); } });
  DOM.imageInput.addEventListener('change', e => handleImageFile(e.target.files[0]));
  document.addEventListener('paste', e => { const f = e.clipboardData?.files?.[0]; if (f) handleImageFile(f); });
  DOM.clearImageBtn.addEventListener('click', () => updateState(s => ({ ...s, imageURL: null })));

  // Palette Generation
  DOM.generateFromImageBtn.addEventListener('click', generatePaletteFromImage);
  DOM.generateFromHarmonyBtn.addEventListener('click', generatePaletteFromHarmony);
  DOM.generateRandomBtn.addEventListener('click', generateRandomPalette);
  DOM.randomizeSeedBtn.addEventListener('click', () => { DOM.rngSeedInput.value = Date.now().toString(36); });
  DOM.paletteSizeSlider.addEventListener('input', e => { DOM.paletteSizeValue.textContent = e.target.value; });

  // Seed sync
  DOM.seedColorPicker.addEventListener('input', e => { DOM.seedColorInput.value = e.target.value; });
  DOM.seedColorInput.addEventListener('change', e => {
    const rgb = ColorUtils.parseCssColorToRgb(e.target.value) || ColorUtils.hexToRgb(e.target.value);
    if (rgb) DOM.seedColorPicker.value = ColorUtils.rgbToHex(rgb);
  });

  // Palette interactions (click)
  DOM.paletteContainer.addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    const id = swatch.dataset.colorId;
    const action = e.target.closest('[data-action]')?.dataset.action;

    switch(action) {
      case 'select': updateState(s => ({ ...s, selectedColorId: id })); break;
      case 'lock': updateState(s => ({ ...s, palette: s.palette.map(c => c.id===id ? ({...c, locked:!c.locked}) : c) })); toast('Lock togglé'); break;
      case 'duplicate': updateState(s => { const p=[...s.palette]; const i=p.findIndex(c=>c.id===id); if(i>-1) p.splice(i+1,0,{...p[i], id:generateUID(), locked:false}); return {...s, palette:p}; }); toast('Dupliquée'); break;
      case 'delete': updateState(s => ({ ...s, palette: s.palette.filter(c => c.id !== id), selectedColorId: s.selectedColorId===id? null:s.selectedColorId })); toast('Supprimée'); break;
    }

    if (e.target.closest('.color-code')) {
      navigator.clipboard.writeText(e.target.textContent);
      announce(`Couleur ${e.target.textContent} copiée.`);
      toast('HEX copié ✔');
    }
  });

  // Survol pour raccourcis L/C
  DOM.paletteContainer.addEventListener('mouseover', e => {
    const sw = e.target.closest('.color-swatch'); hoveredColorId = sw ? sw.dataset.colorId : null;
  });
  DOM.paletteContainer.addEventListener('mouseleave', () => hoveredColorId = null);

  // Drag & drop réordonnancement
  DOM.paletteContainer.addEventListener('dragstart', e => {
    draggedElement = e.target.closest('.color-swatch');
    if (draggedElement) { e.dataTransfer.effectAllowed='move'; setTimeout(()=>draggedElement.classList.add('dragging'),0); }
  });
  DOM.paletteContainer.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.color-swatch');
    if (target && target !== draggedElement) {
      const rect = target.getBoundingClientRect();
      const next = (e.clientY - rect.top) / rect.height > 0.5;
      DOM.paletteContainer.insertBefore(draggedElement, next ? target.nextSibling : target);
    }
  });
  DOM.paletteContainer.addEventListener('dragend', () => {
    if (!draggedElement) return;
    draggedElement.classList.remove('dragging'); draggedElement = null;
    const newOrderIds = [...DOM.paletteContainer.querySelectorAll('.color-swatch')].map(s => s.dataset.colorId);
    updateState(s => ({ ...s, palette: newOrderIds.map(id => s.palette.find(c => c.id === id)) }));
  });

  // Editor
  [DOM.editorHex, ...Object.values(DOM.editorRgb), ...Object.values(DOM.editorHsl)]
    .forEach(el => el.addEventListener('input', debouncedEditorInputHandler));

  DOM.generateTonalRampBtn.addEventListener('click', () => {
    if (!state.selectedColorId) return;
    const base = state.palette.find(c => c.id === state.selectedColorId);
    const count = parseInt(DOM.paletteSizeSlider.value, 10);
    const [h,s] = ColorUtils.rgbToHsl(base.rgb);
    const ramp = Array.from({length: count}, (_,i)=> {
      const L = 10 + (85/(count-1))*i;
      return { id: generateUID(), rgb: ColorUtils.hslToRgb([h, s, L]), locked:false };
    });
    updateState(s => ({ ...s, palette: ramp, selectedColorId: null }));
    toast('Rampe tonale générée ✔');
  });

  // Tabs
  Object.keys(DOM.tabButtons).forEach(key => {
    DOM.tabButtons[key].addEventListener('click', () => {
      Object.values(DOM.tabButtons).forEach(b => b.classList.remove('active'));
      Object.values(DOM.tabPanels).forEach(p => p.classList.add('hidden'));
      DOM.tabButtons[key].classList.add('active');
      DOM.tabPanels[key].classList.remove('hidden');
    });
  });

  // History
  DOM.undoBtn.addEventListener('click', undo);
  DOM.redoBtn.addEventListener('click', redo);

  // Analysis
  DOM.visionSimulationSelect.addEventListener('change', renderPalette);

  // Export (Alt+clic => copy)
  DOM.exportJsonBtn.addEventListener('click', (e)=>IO.export('json', e));
  DOM.exportCssBtn.addEventListener('click', (e)=>IO.export('css', e));
  DOM.exportSvgBtn.addEventListener('click', (e)=>IO.export('svg', e));
  DOM.exportPngBtn.addEventListener('click', (e)=>IO.export('png', e));
  DOM.exportTxtBtn.addEventListener('click', (e)=>IO.export('txt', e));
  DOM.importFileInput.addEventListener('change', IO.import);

  // Modal & Shortcuts
  DOM.showHelpBtn.addEventListener('click', () => DOM.helpModal.classList.remove('hidden'));
  DOM.closeHelpModalBtn.addEventListener('click', () => DOM.helpModal.classList.add('hidden'));
  DOM.helpModal.addEventListener('click', e => { if (e.target === DOM.helpModal) DOM.helpModal.classList.add('hidden'); });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') DOM.helpModal.classList.add('hidden');
    if (e.key === '?') { e.preventDefault(); DOM.helpModal.classList.toggle('hidden'); }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    }
    if (document.activeElement?.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); generateRandomPalette(); }
    if (e.key.toLowerCase() === 'l' && hoveredColorId){
      updateState(s => ({ ...s, palette: s.palette.map(c => c.id===hoveredColorId ? ({...c, locked:!c.locked}) : c) }));
      toast('Lock togglé');
    }
    if (e.key.toLowerCase() === 'c' && hoveredColorId){
      const c = state.palette.find(x=>x.id===hoveredColorId);
      if (c){ navigator.clipboard.writeText(ColorUtils.rgbToHex(c.rgb)); toast('HEX copié ✔'); }
    }
  });

  // Re-aperçu responsif
  window.addEventListener('resize', debounce(()=> updateImagePreview(), 150));
}

// ==========================================================================
// 8. ICONS (inline SVG)
//
// (On garde les fonctions pour ne rien retirer, juste utilitaires)
// ==========================================================================
function lockSvg(){
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}
function lockToggleSvg(locked){
  return locked
    ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`
    : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}
function duplicateSvg(){
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
function trashSvg(){
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
}

// ==========================================================================
// 9. BOOTSTRAP
// ==========================================================================
function init() {
  // Theme initial
  const savedTheme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  DOM.html.dataset.theme = savedTheme;
  DOM.themeIconDark.classList.toggle('hidden', savedTheme === 'light');
  DOM.themeIconLight.classList.toggle('hidden', savedTheme === 'dark');

  // Load state
  state = loadStateFromLocalStorage();
  history.stack = [clone(state)];
  history.index = 0;

  // Init modules
  ColorWorker.init();
  bindEventListeners();

  // First render
  render();
  console.log('Chroma Studio Premium prêt ✅');
}

document.addEventListener('DOMContentLoaded', init);
