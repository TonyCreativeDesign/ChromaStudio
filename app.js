// app.js
/**
* @file app.js
* @description Script principal pour Chroma Studio (premium).
* @version 2.6.0 — color naming fix (CIELAB + ΔE00) + parsing robustness + minor stability fixes
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
PREVIEW_MAX_W: 640,
IFRAME_POST_MESSAGE_TYPE: 'chromaStudio:height',
};

const DOM = {
// Global
html: document.documentElement,
liveAnnouncer: document.getElementById('live-announcer'),
snackbar: document.getElementById('snackbar'),
themeToggle: document.getElementById('theme-toggle'),
themeIconDark: document.getElementById('theme-icon-dark'),
themeIconLight: document.getElementById('theme-icon-light'),

// Drawers
openSourcesBtn: document.getElementById('open-sources-btn'),
openToolsBtn: document.getElementById('open-tools-btn'),
drawerOverlay: document.getElementById('drawer-overlay'),
sidebarSources: document.getElementById('sidebar-sources'),
sidebarTools: document.getElementById('sidebar-tools'),

// Left Sidebar
imageDropZone: document.getElementById('image-drop-zone'),
imagePlaceholder: document.getElementById('image-placeholder'),
imagePreview: document.getElementById('image-preview'),
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
editorRgb: {
r: document.getElementById('editor-rgb-r'),
g: document.getElementById('editor-rgb-g'),
b: document.getElementById('editor-rgb-b')
},
editorHsl: {
h: document.getElementById('editor-hsl-h'),
s: document.getElementById('editor-hsl-s'),
l: document.getElementById('editor-hsl-l')
},
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

const clone = (obj) => ('structuredClone' in window) ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));

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
IframeAutoSize.report();
}

function undo() {
if (history.index > 0) {
history.index--;
state = clone(history.stack[history.index]);
render(); saveStateToLocalStorage(); announce('Action annulée');
IframeAutoSize.report();
}
}

function redo() {
if (history.index < history.stack.length - 1) {
history.index++;
state = clone(history.stack[history.index]);
render(); saveStateToLocalStorage(); announce('Action rétablie');
IframeAutoSize.report();
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
scheduleScrollDebug('render');
}

function renderPalette() {
/* IMPORTANT: ne pas nuker le contenu complet, sinon on supprime le empty-state du DOM.
   On retire uniquement les swatches existants. */
DOM.paletteContainer.querySelectorAll('.color-swatch').forEach(el => el.remove());

// Garantit que l'empty-state existe toujours dans le container
if (DOM.paletteEmptyState && !DOM.paletteContainer.contains(DOM.paletteEmptyState)) {
DOM.paletteContainer.appendChild(DOM.paletteEmptyState);
}

const visionMode = DOM.visionSimulationSelect.value;

if (state.palette.length === 0) {
DOM.paletteEmptyState.classList.remove('hidden');
scheduleScrollDebug('palette:empty');
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

scheduleScrollDebug(`palette:render(${state.palette.length})`);
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

const img = new Image();
img.onload = () => {
const zone = DOM.imageDropZone.getBoundingClientRect();
const maxW = Math.min(CONFIG.PREVIEW_MAX_W, Math.floor(zone.width || CONFIG.PREVIEW_MAX_W));
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

// Reuse a single 2D context for parsing colors (avoid per-call canvas creation).
const _colorCtx = (() => {
const c = document.createElement('canvas');
c.width = c.height = 1;
return c.getContext('2d');
})();

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const clamp255 = (v) => clamp(v, 0, 255);

const rgbKey = (rgb) => `${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0}`;

self.rgbToHex = ([r, g, b]) =>
'#' + [r, g, b]
.map(c => clamp255(c | 0).toString(16).padStart(2, '0'))
.join('')
.toUpperCase();

self.hexToRgb = (hex) => {
if (typeof hex !== 'string') return null;
let h = hex.trim();
if (h.startsWith('#')) h = h.slice(1);

// Support #RGB/#RGBA/#RRGGBB/#RRGGBBAA (alpha ignored)
if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
if (h.length === 8) h = h.slice(0, 6);

if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
const v = parseInt(h, 16);
return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

self.parseCssColorToRgb = (input) => {
if (!input) return null;

// Hex fast-path
const hex = self.hexToRgb(input);
if (hex) return hex;

const str = String(input).trim();
if (!str) return null;

// Avoid the "invalid => previous fillStyle" trap using CSS.supports when available.
if (window.CSS?.supports && !CSS.supports('color', str)) return null;

// Sentinel to detect invalid values even without CSS.supports
const sentinel = 'rgb(1, 2, 3)';
_colorCtx.fillStyle = sentinel;
_colorCtx.fillStyle = str;
const res = _colorCtx.fillStyle;

// If invalid and CSS.supports is absent, fillStyle stays at sentinel
if (!window.CSS?.supports && res === sentinel) return null;

// Normalize output: res can be "#rrggbb" or "rgb(a)"
const hexParsed = self.hexToRgb(res);
if (hexParsed) return hexParsed;

const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/i.exec(res);
if (!m) return null;

// alpha ignored (UI expects opaque naming)
return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
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

self.getBestTextColor = (bgRgb) =>
self.getContrastRatio(bgRgb,[0,0,0]) > self.getContrastRatio(bgRgb,[255,255,255]) ? [0,0,0] : [255,255,255];

self.getHarmony = (rgb, type, count) => {
const [h,s,l] = self.rgbToHsl(rgb);
const clampLocal=(v,min,max)=>Math.max(min,Math.min(max,v));
const wrap = (x)=> (x%360+360)%360;
const arr = [];
switch(type){
case 'analogous': [-30,-15,0,15,30].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
case 'monochromatic': [l*0.5,l*0.7,l, clampLocal(l*1.15,0,100), clampLocal(l*1.3,0,100)]
.forEach(L=>arr.push(self.hslToRgb([h,s, clampLocal(L,5,95)]))); break;
case 'complementary': [0,180].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
case 'split-complementary': [0,150,210].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
case 'triadic': [0,120,240].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
case 'tetradic': [0,90,180,270].forEach(d=>arr.push(self.hslToRgb([wrap(h+d),s,l]))); break;
}
return arr.slice(0, Math.max(CONFIG.PALETTE_MIN_SIZE, Math.min(count, CONFIG.PALETTE_MAX_SIZE)));
};

// --- Daltonism simulation (clamped) ---
const matrices = {
protanopia:[0.567,0.433,0, 0.558,0.442,0, 0,0.242,0.758],
deuteranopia:[0.625,0.375,0, 0.7,0.3,0, 0,0.3,0.7],
tritanopia:[0.95,0.05,0, 0,0.433,0.567, 0,0.475,0.525],
};
self.simulateColorDeficiency = (rgb, type) => {
if (type==='normal' || !matrices[type]) return rgb;
const m = matrices[type], [r,g,b]=rgb;
const rr = r*m[0]+g*m[1]+b*m[2];
const gg = r*m[3]+g*m[4]+b*m[5];
const bb = r*m[6]+g*m[7]+b*m[8];
return [Math.round(clamp255(rr)), Math.round(clamp255(gg)), Math.round(clamp255(bb))];
};

// --- CIELAB + ΔE00 naming ---
// sRGB -> linear
function srgbToLinear(u){
u /= 255;
return (u <= 0.04045) ? (u / 12.92) : Math.pow((u + 0.055) / 1.055, 2.4);
}

// linear RGB -> XYZ (D65)
function rgbToXyz([r,g,b]){
const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
// sRGB D65
const X = R*0.4124564 + G*0.3575761 + B*0.1804375;
const Y = R*0.2126729 + G*0.7151522 + B*0.0721750;
const Z = R*0.0193339 + G*0.1191920 + B*0.9503041;
return [X, Y, Z];
}

// XYZ -> Lab (D65 reference white)
function xyzToLab([x,y,z]){
// D65 reference white
const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
let fx = x / Xn;
let fy = y / Yn;
let fz = z / Zn;

const eps = 216/24389; // 0.008856
const kappa = 24389/27; // 903.3

const f = (t) => t > eps ? Math.cbrt(t) : (kappa*t + 16)/116;

const Fx = f(fx), Fy = f(fy), Fz = f(fz);

const L = 116*Fy - 16;
const a = 500*(Fx - Fy);
const b = 200*(Fy - Fz);
return [L, a, b];
}

function rgbToLab(rgb){
const r = clamp255(rgb[0] | 0);
const g = clamp255(rgb[1] | 0);
const b = clamp255(rgb[2] | 0);
return xyzToLab(rgbToXyz([r,g,b]));
}

// CIEDE2000 (ΔE00)
function deltaE00(lab1, lab2){
// Implementation based on the standard CIEDE2000 formula.
const [L1,a1,b1] = lab1;
const [L2,a2,b2] = lab2;

const avgLp = (L1 + L2) / 2;

const C1 = Math.sqrt(a1*a1 + b1*b1);
const C2 = Math.sqrt(a2*a2 + b2*b2);
const avgC = (C1 + C2) / 2;

const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));

const a1p = (1 + G) * a1;
const a2p = (1 + G) * a2;

const C1p = Math.sqrt(a1p*a1p + b1*b1);
const C2p = Math.sqrt(a2p*a2p + b2*b2);

const avgCp = (C1p + C2p) / 2;

const h1p = Math.atan2(b1, a1p);
const h2p = Math.atan2(b2, a2p);

const toDeg = (rad) => (rad * 180 / Math.PI + 360) % 360;
const h1pd = toDeg(h1p);
const h2pd = toDeg(h2p);

let deltahp;
if (C1p*C2p === 0) deltahp = 0;
else if (Math.abs(h2pd - h1pd) <= 180) deltahp = h2pd - h1pd;
else if (h2pd <= h1pd) deltahp = (h2pd - h1pd) + 360;
else deltahp = (h2pd - h1pd) - 360;

const deltaLp = L2 - L1;
const deltaCp = C2p - C1p;

const deltaHp = 2 * Math.sqrt(C1p*C2p) * Math.sin((deltahp * Math.PI / 180) / 2);

let avgHp;
if (C1p*C2p === 0) avgHp = h1pd + h2pd;
else if (Math.abs(h1pd - h2pd) <= 180) avgHp = (h1pd + h2pd) / 2;
else if ((h1pd + h2pd) < 360) avgHp = (h1pd + h2pd + 360) / 2;
else avgHp = (h1pd + h2pd - 360) / 2;

const T =
1
- 0.17 * Math.cos((avgHp - 30) * Math.PI/180)
+ 0.24 * Math.cos((2*avgHp) * Math.PI/180)
+ 0.32 * Math.cos((3*avgHp + 6) * Math.PI/180)
- 0.20 * Math.cos((4*avgHp - 63) * Math.PI/180);

const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
const Rc = 2 * Math.sqrt(Math.pow(avgCp,7) / (Math.pow(avgCp,7) + Math.pow(25,7)));
const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
const Sc = 1 + 0.045 * avgCp;
const Sh = 1 + 0.015 * avgCp * T;
const Rt = -Math.sin(2 * deltaTheta * Math.PI/180) * Rc;

const kL = 1, kC = 1, kH = 1;

const dE = Math.sqrt(
Math.pow(deltaLp/(kL*Sl), 2) +
Math.pow(deltaCp/(kC*Sc), 2) +
Math.pow(deltaHp/(kH*Sh), 2) +
Rt * (deltaCp/(kC*Sc)) * (deltaHp/(kH*Sh))
);

return dE;
}

const NAME_CACHE = new Map();

const REF = [
{ name: 'Red', rgb: [255, 0, 0] },
{ name: 'Orange', rgb: [255, 165, 0] },
{ name: 'Yellow', rgb: [255, 255, 0] },
{ name: 'Green', rgb: [ 0, 255, 0] },
{ name: 'Cyan', rgb: [ 0, 255, 255] },
{ name: 'Blue', rgb: [ 0, 0, 255] },
{ name: 'Violet', rgb: [127, 0, 255] },
{ name: 'Magenta', rgb: [255, 0, 255] },
{ name: 'Pink', rgb: [255, 105, 180] },
{ name: 'Brown', rgb: [139, 69, 19] },
{ name: 'White', rgb: [255, 255, 255] },
{ name: 'Gray', rgb: [128, 128, 128] },
{ name: 'Black', rgb: [ 0, 0, 0] },
].map(x => ({...x, lab: rgbToLab(x.rgb)}));

function labHueDeg([,a,b]){
return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
}

self.getClosestColorName = (rgb) => {
if (!Array.isArray(rgb) || rgb.length !== 3) return 'Color';
const rr = clamp255(rgb[0] | 0), gg = clamp255(rgb[1] | 0), bb = clamp255(rgb[2] | 0);
const key = rgbKey([rr,gg,bb]);
const cached = NAME_CACHE.get(key);
if (cached) return cached;

const lab = rgbToLab([rr,gg,bb]);
const L = lab[0], a = lab[1], b = lab[2];
const C = Math.sqrt(a*a + b*b);

// Neutral handling (low chroma): ensures gray-ish colors are not mislabeled as hue colors.
if (C < 10) {
const name = (L >= 95) ? 'White' : (L <= 12) ? 'Black' : 'Gray';
NAME_CACHE.set(key, name);
return name;
}

// Heuristics for brown/pink (avoid common perceptual traps vs orange/red)
const hue = labHueDeg(lab);

// Brown: dark-ish orange/yellow with moderate chroma
if (L < 55 && C > 10 && C < 55 && hue >= 20 && hue <= 95) {
NAME_CACHE.set(key, 'Brown');
return 'Brown';
}

// Pink: light-ish red/magenta with moderate chroma
if (L > 70 && C > 12 && ((hue >= 330 || hue <= 20))) {
NAME_CACHE.set(key, 'Pink');
return 'Pink';
}

// Nearest by ΔE00 among references (excluding neutrals generally, but keeping them is harmless)
let best = 'Color';
let bestD = Infinity;
for (const ref of REF) {
// Skip neutrals here because we already handled neutral threshold
if (ref.name === 'White' || ref.name === 'Gray' || ref.name === 'Black') continue;
const d = deltaE00(lab, ref.lab);
if (d < bestD) { bestD = d; best = ref.name; }
}

NAME_CACHE.set(key, best);
return best;
};

// --- Deterministic PRNG (stable across engines) ---
function xmur3(str) {
let h = 1779033703 ^ str.length;
for (let i = 0; i < str.length; i++) {
h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
h = (h << 13) | (h >>> 19);
}
return function() {
h = Math.imul(h ^ (h >>> 16), 2246822507);
h = Math.imul(h ^ (h >>> 13), 3266489909);
h ^= h >>> 16;
return h >>> 0;
};
}
function mulberry32(a) {
return function() {
let t = a += 0x6D2B79F5;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
self.createPrng = (seedStr) => {
const seed = xmur3(String(seedStr || 'seed'))();
return mulberry32(seed);
};

// --- Optional self-test for naming ---
self.runNamingSelfTest = () => {
const tests = [
{ hex: '#FFFF00', expected: 'Yellow' },
{ hex: '#00FF00', expected: 'Green' },
{ hex: '#FF0000', expected: 'Red' },
{ hex: '#0000FF', expected: 'Blue' },
{ hex: '#808080', expected: 'Gray' },
{ hex: '#000000', expected: 'Black' },
{ hex: '#FFFFFF', expected: 'White' },
{ hex: '#00FFFF', expected: 'Cyan' },
{ hex: '#FF00FF', expected: 'Magenta' },
{ hex: '#FFA500', expected: 'Orange' },
];

const rows = tests.map(t => {
const rgb = self.hexToRgb(t.hex);
const got = rgb ? self.getClosestColorName(rgb) : 'Invalid';
return { hex: t.hex, expected: t.expected, got, pass: got === t.expected };
});

console.groupCollapsed('Chroma Studio — Color Naming Self-Test');
console.table(rows);
const fails = rows.filter(r => !r.pass);
if (fails.length) console.warn('Naming test failures:', fails);
else console.log('All naming tests passed.');
console.groupEnd();
};

return self;
})();

// ==========================================================================
// 4. WEB WORKER & HEAVY TASKS
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
function medianCut(pixels,k){ return kMeansPlusPlus(pixels,k,12); }
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
}catch(e){
console.warn('Worker init failed, fallback to main thread.', e);
worker = null;
}
}

function run(type, payload){
if (!worker) return Promise.reject(new Error('Worker not available'));
const id = nextId++;
return new Promise((resolve,reject)=>{ resolvers[id]={resolve,reject}; worker.postMessage({id,type,payload}); });
}

return { init, run };
})();

function quantizeInMainThread(pixels, options){
function sq(a,b){const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2];return dx*dx+dy*dy+dz*dz;}
function kMeansPlusPlus(p,k,maxIter=18){
if (p.length===0) return [];
const n=p.length, c=[p[Math.floor(Math.random()*n)]];
while(c.length<k){
const d=p.map(px=>Math.min(...c.map(cc=>sq(px,cc))));
const sum=d.reduce((a,v)=>a+v,0)||1; let r=Math.random()*sum, i=0;
while(r>0 && i<d.length){ r-=d[i++]; } c.push(p[Math.min(i,n-1)]);
}
let assign=new Array(n).fill(0);
for (let it=0; it<maxIter; it++){
let changed=false;
for (let i=0;i<n;i++){
let best=0, bestD=Infinity;
for (let j=0;j<k;j++){ const dd=sq(p[i],c[j]); if (dd<bestD){ bestD=dd; best=j; } }
if (assign[i]!==best){ assign[i]=best; changed=true; }
}
const sums=Array.from({length:k},()=>[0,0,0]); const cnt=new Array(k).fill(0);
for (let i=0;i<n;i++){ const g=assign[i]; const px=p[i]; sums[g][0]+=px[0]; sums[g][1]+=px[1]; sums[g][2]+=px[2]; cnt[g]++; }
for (let j=0;j<k;j++){ if (cnt[j]>0){ c[j]=[sums[j][0]/cnt[j], sums[j][1]/cnt[j], sums[j][2]/cnt[j]]; } }
if (!changed) break;
}
return c.map(x=>x.map(Math.round));
}
const k = Math.max(2, Math.min(64, options.count||8));
return (options.algo==='median-cut') ? kMeansPlusPlus(pixels,k,12) : kMeansPlusPlus(pixels,k,18);
}

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
const canvas = DOM.imagePreview;
const ctx = canvas.getContext('2d');
if (canvas.width === 0 || canvas.height === 0) return;

DOM.paletteContainer.setAttribute('aria-busy','true');

const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
const pixels = [];
for (let i=0; i<data.length; i+=4){
const a = data[i+3];
if (a>128 && (data[i]<250 || data[i+1]<250 || data[i+2]<250)) {
pixels.push([data[i], data[i+1], data[i+2]]);
}
}
const options = { count: parseInt(DOM.paletteSizeSlider.value,10), algo: DOM.quantizationAlgo.value };

ColorWorker.run('quantize', { pixels, options })
.then(result => applyExtracted(result))
.catch(() => {
const result = quantizeInMainThread(pixels, options);
applyExtracted(result);
});

function applyExtracted(result){
updateState(s => ({ ...s, palette: result.map(rgb => ({ id: generateUID(), rgb, locked:false })), selectedColorId:null }));
announce(`${result.length} couleurs extraites de l'image.`);
toast('Palette extraite ✔');
DOM.paletteContainer.removeAttribute('aria-busy');
}
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
if (![r,g,b].some(Number.isNaN)) newRgb = [clamp255(r), clamp255(g), clamp255(b)];
} else if (t.id.startsWith('editor-hsl')) {
const h = clamp(parseInt(DOM.editorHsl.h.value,10) || 0, 0, 360);
const s = clamp(parseInt(DOM.editorHsl.s.value,10) || 0, 0, 100);
const l = clamp(parseInt(DOM.editorHsl.l.value,10) || 0, 0, 100);
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
try {
if (navigator.clipboard?.writeText) {
await navigator.clipboard.writeText(text);
} else {
// Fallback (older browsers / insecure contexts)
const ta = document.createElement('textarea');
ta.value = text;
ta.setAttribute('readonly', '');
ta.style.position = 'fixed';
ta.style.left = '-9999px';
document.body.appendChild(ta);
ta.select();
document.execCommand('copy');
ta.remove();
}
toast('Copié dans le presse-papiers ✔');
} catch {
toast('Impossible de copier', true);
}
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
// Avoid non-breaking spaces in output
content = `:root {\n${hexPalette.map((hex,i)=>` --color-${i+1}: ${hex};`).join('\n')}\n}\n`;
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
let colors = [];

if (Array.isArray(data)) {
colors = data.map(x => ColorUtils.hexToRgb(String(x))).filter(Boolean)
.map(rgb => ({id:generateUID(), rgb, locked:false}));
} else if (Array.isArray(data.colors)) {
if (typeof data.colors[0] === 'string') {
colors = data.colors.map(x => ColorUtils.hexToRgb(String(x))).filter(Boolean)
.map(rgb => ({id:generateUID(), rgb, locked:false}));
} else {
colors = data.colors
.map(c => Array.isArray(c.rgb) && c.rgb.length===3
? ({id:generateUID(), rgb:c.rgb.map(n=>clamp255(n|0)), locked:!!c.locked})
: null)
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
// 7. DRAWERS (RESPONSIVE PANELS)
// ==========================================================================
const Drawer = (() => {
const mqLeft = window.matchMedia('(max-width: 768px)');
const mqRight = window.matchMedia('(max-width: 1200px)');
let openKey = null;
let lastFocus = null;

const focusableSelector = [
'button:not([disabled])',
'a[href]',
'input:not([disabled])',
'select:not([disabled])',
'textarea:not([disabled])',
'[tabindex]:not([tabindex="-1"])'
].join(',');

function isLeftDrawerMode(){ return mqLeft.matches; }
function isRightDrawerMode(){ return mqRight.matches; }

function setInert(el, inert) {
try {
if (inert) el.setAttribute('inert', '');
else el.removeAttribute('inert');
} catch {}
}

function open(key){
if (key === 'sources' && !isLeftDrawerMode()) return;
if (key === 'tools' && !isRightDrawerMode()) return;

close(); // une seule drawer à la fois

openKey = key;
lastFocus = document.activeElement;

DOM.drawerOverlay.classList.remove('hidden');
DOM.drawerOverlay.setAttribute('aria-hidden', 'false');

if (key === 'sources') {
DOM.sidebarSources.classList.add('is-open');
DOM.openSourcesBtn.setAttribute('aria-expanded', 'true');
DOM.sidebarSources.setAttribute('aria-hidden', 'false');
setInert(DOM.sidebarSources, false);
setTimeout(()=>updateImagePreview(), 50);
}
if (key === 'tools') {
DOM.sidebarTools.classList.add('is-open');
DOM.openToolsBtn.setAttribute('aria-expanded', 'true');
DOM.sidebarTools.setAttribute('aria-hidden', 'false');
setInert(DOM.sidebarTools, false);
}

const target = key === 'sources' ? DOM.sidebarSources : DOM.sidebarTools;
const first = target.querySelector(focusableSelector);
if (first) first.focus({preventScroll:true});

IframeAutoSize.report();
}

function close(){
if (!openKey) return;

DOM.drawerOverlay.classList.add('hidden');
DOM.drawerOverlay.setAttribute('aria-hidden', 'true');

DOM.sidebarSources.classList.remove('is-open');
DOM.sidebarTools.classList.remove('is-open');

DOM.openSourcesBtn.setAttribute('aria-expanded', 'false');
DOM.openToolsBtn.setAttribute('aria-expanded', 'false');

if (isLeftDrawerMode()) {
DOM.sidebarSources.setAttribute('aria-hidden', 'true');
setInert(DOM.sidebarSources, true);
} else {
DOM.sidebarSources.removeAttribute('aria-hidden');
setInert(DOM.sidebarSources, false);
}

if (isRightDrawerMode()) {
DOM.sidebarTools.setAttribute('aria-hidden', 'true');
setInert(DOM.sidebarTools, true);
} else {
DOM.sidebarTools.removeAttribute('aria-hidden');
setInert(DOM.sidebarTools, false);
}

openKey = null;

if (lastFocus && typeof lastFocus.focus === 'function') {
lastFocus.focus({preventScroll:true});
}
lastFocus = null;

IframeAutoSize.report();
}

function toggle(key){
if (openKey === key) close();
else open(key);
}

function syncModes(){
if (isLeftDrawerMode()) {
if (!openKey || openKey !== 'sources') {
DOM.sidebarSources.classList.remove('is-open');
DOM.sidebarSources.setAttribute('aria-hidden', 'true');
setInert(DOM.sidebarSources, true);
}
DOM.openSourcesBtn.disabled = false;
} else {
DOM.sidebarSources.classList.remove('is-open');
DOM.sidebarSources.removeAttribute('aria-hidden');
setInert(DOM.sidebarSources, false);
DOM.openSourcesBtn.setAttribute('aria-expanded', 'false');
}

if (isRightDrawerMode()) {
if (!openKey || openKey !== 'tools') {
DOM.sidebarTools.classList.remove('is-open');
DOM.sidebarTools.setAttribute('aria-hidden', 'true');
setInert(DOM.sidebarTools, true);
}
DOM.openToolsBtn.disabled = false;
} else {
DOM.sidebarTools.classList.remove('is-open');
DOM.sidebarTools.removeAttribute('aria-hidden');
setInert(DOM.sidebarTools, false);
DOM.openToolsBtn.setAttribute('aria-expanded', 'false');
}

if ((!isLeftDrawerMode() && openKey === 'sources') || (!isRightDrawerMode() && openKey === 'tools')) {
close();
}

IframeAutoSize.report();
}

mqLeft.addEventListener?.('change', syncModes);
mqRight.addEventListener?.('change', syncModes);

return { open, close, toggle, syncModes, isOpen: ()=>!!openKey };
})();

// ==========================================================================
// 8. IFRAME AUTO-SIZE (postMessage -> parent)
// ==========================================================================
const IframeAutoSize = (() => {
let last = 0;
let raf = 0;

function computeHeight(){
const de = document.documentElement;
const b = document.body;
return Math.max(
de.scrollHeight, b.scrollHeight,
de.offsetHeight, b.offsetHeight,
de.clientHeight
);
}

function send(h){
if (Math.abs(h - last) < 2) return;
last = h;
if (window.parent && window.parent !== window) {
window.parent.postMessage({ type: CONFIG.IFRAME_POST_MESSAGE_TYPE, height: h }, '*');
}
}

function report(){
if (raf) cancelAnimationFrame(raf);
raf = requestAnimationFrame(()=> {
raf = 0;
send(computeHeight());
});
}

function init(){
report();
window.addEventListener('resize', debounce(report, 120), {passive:true});
window.addEventListener('orientationchange', debounce(report, 120), {passive:true});

if ('ResizeObserver' in window) {
const ro = new ResizeObserver(() => report());
ro.observe(document.documentElement);
ro.observe(document.body);
}
}

return { init, report };
})();

// ==========================================================================
// 9. UTILITIES & INITIALIZATION
// ==========================================================================
function debounce(fn, delay) {
let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,a), delay); };
}
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function clamp255(v){ return clamp(v, 0, 255); }
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

/* ==========================================================================
9.1 SCROLL DIAGNOSTIC (preuve DOM + scrollHeight/clientHeight)
========================================================================== */
let __scrollDebugRaf = 0;
let __lastScrollDebug = { swatches: -1, clientHeight: -1, scrollHeight: -1 };

function debugScroll(reason='manual') {
const el = DOM.paletteContainer;
if (!el) return null;

const swatches = el.querySelectorAll('.color-swatch').length;
const clientHeight = el.clientHeight;
const scrollHeight = el.scrollHeight;
const canScroll = scrollHeight > clientHeight + 1;

const overflowY = getComputedStyle(el).overflowY;
const changed =
swatches !== __lastScrollDebug.swatches ||
Math.abs(clientHeight - __lastScrollDebug.clientHeight) > 1 ||
Math.abs(scrollHeight - __lastScrollDebug.scrollHeight) > 1 ||
reason === 'manual';

if (changed) {
console.groupCollapsed(`Chroma Studio — Scroll Debug (${reason})`);
console.log('swatches in DOM:', swatches, '| state.palette.length:', state?.palette?.length ?? 'n/a');
console.log('scroll element (expected): #palette-container', el);
console.log('overflowY:', overflowY);
console.log('clientHeight:', clientHeight, '| scrollHeight:', scrollHeight, '| canScroll:', canScroll);
console.log(canScroll ? 'OK: scrollHeight > clientHeight (scroll possible)' : 'NOTE: scrollHeight <= clientHeight (no overflow)');
console.groupEnd();
}

__lastScrollDebug = { swatches, clientHeight, scrollHeight };
return { swatches, clientHeight, scrollHeight, canScroll, overflowY };
}

function scheduleScrollDebug(reason='render') {
if (__scrollDebugRaf) cancelAnimationFrame(__scrollDebugRaf);
__scrollDebugRaf = requestAnimationFrame(() => {
__scrollDebugRaf = 0;
debugScroll(reason);
});
}

// Expose pour validation manuelle console: debugScroll()
window.debugScroll = debugScroll;

/* Tabs A11y helpers */
function setAriaTabState(activeKey){
const keys = Object.keys(DOM.tabButtons);
keys.forEach(k => {
const btn = DOM.tabButtons[k];
const panel = DOM.tabPanels[k];
const isActive = k===activeKey;
btn.classList.toggle('active', isActive);
btn.setAttribute('aria-selected', String(isActive));
btn.tabIndex = isActive ? 0 : -1;
panel.classList.toggle('hidden', !isActive);
panel.setAttribute('aria-hidden', String(!isActive));
});
}

async function safeClipboardWrite(text){
try{
if (navigator.clipboard?.writeText) {
await navigator.clipboard.writeText(text);
return true;
}
}catch{}
try{
const ta = document.createElement('textarea');
ta.value = text;
ta.setAttribute('readonly','');
ta.style.position = 'fixed';
ta.style.left = '-9999px';
document.body.appendChild(ta);
ta.select();
document.execCommand('copy');
ta.remove();
return true;
}catch{
return false;
}
}

function bindEventListeners() {
// Theme
DOM.themeToggle.addEventListener('click', () => {
const newTheme = DOM.html.dataset.theme === 'dark' ? 'light' : 'dark';
DOM.html.dataset.theme = newTheme;
localStorage.setItem('theme', newTheme);
DOM.themeIconDark.classList.toggle('hidden', newTheme === 'light');
DOM.themeIconLight.classList.toggle('hidden', newTheme === 'dark');
IframeAutoSize.report();
scheduleScrollDebug('theme-toggle');
});

// Drawer buttons
DOM.openSourcesBtn.addEventListener('click', () => Drawer.toggle('sources'));
DOM.openToolsBtn.addEventListener('click', () => Drawer.toggle('tools'));
DOM.drawerOverlay.addEventListener('click', () => Drawer.close());

// Image Input
DOM.imageDropZone.addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); });
DOM.imageDropZone.addEventListener('dragleave', e => e.currentTarget.classList.remove('drag-over'));
DOM.imageDropZone.addEventListener('drop', e => {
e.preventDefault();
e.currentTarget.classList.remove('drag-over');
handleImageFile(e.dataTransfer.files[0]);
});
DOM.imageDropZone.addEventListener('click', () => DOM.imageInput.click());
DOM.imageDropZone.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); DOM.imageInput.click(); } });
DOM.imageInput.addEventListener('change', e => handleImageFile(e.target.files[0]));
document.addEventListener('paste', e => {
const f = e.clipboardData?.files?.[0];
if (f) handleImageFile(f);
});

DOM.clearImageBtn.addEventListener('click', () => {
const old = state.imageURL;
updateState(s => ({ ...s, imageURL: null }), { addToHistory:false });
if (old) URL.revokeObjectURL(old);
});

// Palette Generation
DOM.generateFromImageBtn.addEventListener('click', generatePaletteFromImage);
DOM.generateFromHarmonyBtn.addEventListener('click', generatePaletteFromHarmony);
DOM.generateRandomBtn.addEventListener('click', generateRandomPalette);
DOM.randomizeSeedBtn.addEventListener('click', () => { DOM.rngSeedInput.value = Date.now().toString(36); });

DOM.paletteSizeSlider.addEventListener('input', e => {
DOM.paletteSizeValue.textContent = e.target.value;
scheduleScrollDebug('palette-size-slider');
});

// Seed sync
DOM.seedColorPicker.addEventListener('input', e => { DOM.seedColorInput.value = e.target.value; });
DOM.seedColorInput.addEventListener('change', e => {
const rgb = ColorUtils.parseCssColorToRgb(e.target.value) || ColorUtils.hexToRgb(e.target.value);
if (rgb) DOM.seedColorPicker.value = ColorUtils.rgbToHex(rgb);
});

// Keyboard scroll support (palette container)
DOM.paletteContainer.addEventListener('keydown', (e) => {
const el = DOM.paletteContainer;
if (!el) return;

const step = 56; // px
const page = Math.max(1, Math.floor(el.clientHeight * 0.9));

switch (e.key) {
case 'ArrowDown':
e.preventDefault(); el.scrollBy({ top: step, behavior: 'auto' }); break;
case 'ArrowUp':
e.preventDefault(); el.scrollBy({ top: -step, behavior: 'auto' }); break;
case 'PageDown':
e.preventDefault(); el.scrollBy({ top: page, behavior: 'auto' }); break;
case 'PageUp':
e.preventDefault(); el.scrollBy({ top: -page, behavior: 'auto' }); break;
case 'Home':
e.preventDefault(); el.scrollTo({ top: 0, behavior: 'auto' }); break;
case 'End':
e.preventDefault(); el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }); break;
}
});

// Palette interactions (click)
DOM.paletteContainer.addEventListener('click', async (e) => {
const swatch = e.target.closest('.color-swatch');
if (!swatch) return;
const id = swatch.dataset.colorId;
const action = e.target.closest('[data-action]')?.dataset.action;

switch(action) {
case 'select':
updateState(s => ({ ...s, selectedColorId: id }));
break;

case 'lock':
updateState(s => ({ ...s, palette: s.palette.map(c => c.id===id ? ({...c, locked:!c.locked}) : c) }));
toast('Lock togglé');
break;

case 'duplicate':
updateState(s => {
const p=[...s.palette];
const i=p.findIndex(c=>c.id===id);
if(i>-1) p.splice(i+1,0,{...p[i], id:generateUID(), locked:false});
return {...s, palette:p};
});
toast('Dupliquée');
break;

case 'delete':
updateState(s => ({
...s,
palette: s.palette.filter(c => c.id !== id),
selectedColorId: s.selectedColorId===id ? null : s.selectedColorId
}));
toast('Supprimée');
break;
}

if (e.target.closest('.color-code')) {
const ok = await safeClipboardWrite(e.target.textContent);
announce(`Couleur ${e.target.textContent} copiée.`);
toast(ok ? 'HEX copié ✔' : 'Copie impossible', !ok);
}
});

// Survol pour raccourcis L/C
DOM.paletteContainer.addEventListener('mouseover', e => {
const sw = e.target.closest('.color-swatch');
hoveredColorId = sw ? sw.dataset.colorId : null;
});
DOM.paletteContainer.addEventListener('mouseleave', () => hoveredColorId = null);

// Drag & drop réordonnancement
DOM.paletteContainer.addEventListener('dragstart', e => {
draggedElement = e.target.closest('.color-swatch');
if (draggedElement) {
e.dataTransfer.effectAllowed='move';
setTimeout(()=>draggedElement.classList.add('dragging'),0);
}
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
draggedElement.classList.remove('dragging');
draggedElement = null;

const newOrderIds = [...DOM.paletteContainer.querySelectorAll('.color-swatch')].map(s => s.dataset.colorId);
updateState(s => {
const mapped = newOrderIds.map(id => s.palette.find(c => c.id === id)).filter(Boolean);
return { ...s, palette: mapped };
});
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

// Tabs (click + A11y)
Object.keys(DOM.tabButtons).forEach(key => {
DOM.tabButtons[key].addEventListener('click', () => setAriaTabState(key));
DOM.tabButtons[key].addEventListener('keydown', (e) => {
const order = ['editor','analyze','export'];
const idx = order.indexOf(key);
if (e.key === 'ArrowRight') { e.preventDefault(); const next = order[(idx+1)%order.length]; DOM.tabButtons[next].focus(); setAriaTabState(next); }
if (e.key === 'ArrowLeft') { e.preventDefault(); const prev = order[(idx-1+order.length)%order.length]; DOM.tabButtons[prev].focus(); setAriaTabState(prev); }
});
});

// History
DOM.undoBtn.addEventListener('click', undo);
DOM.redoBtn.addEventListener('click', redo);

// Analysis (vision filter)
DOM.visionSimulationSelect.addEventListener('change', () => { renderPalette(); IframeAutoSize.report(); scheduleScrollDebug('vision-change'); });

// Export (Alt+clic => copy)
DOM.exportJsonBtn.addEventListener('click', (e)=>IO.export('json', e));
DOM.exportCssBtn.addEventListener('click', (e)=>IO.export('css', e));
DOM.exportSvgBtn.addEventListener('click', (e)=>IO.export('svg', e));
DOM.exportPngBtn.addEventListener('click', (e)=>IO.export('png', e));
DOM.exportTxtBtn.addEventListener('click', (e)=>IO.export('txt', e));
DOM.importFileInput.addEventListener('change', IO.import);

// Modal
DOM.showHelpBtn.addEventListener('click', () => DOM.helpModal.classList.remove('hidden'));
DOM.closeHelpModalBtn.addEventListener('click', () => DOM.helpModal.classList.add('hidden'));
DOM.helpModal.addEventListener('click', e => { if (e.target === DOM.helpModal) DOM.helpModal.classList.add('hidden'); });

// Shortcuts
window.addEventListener('keydown', async (e) => {
// 1) drawers
if (e.key === 'Escape' && Drawer.isOpen()) {
e.preventDefault();
Drawer.close();
return;
}

// 2) modale help
if (e.key === 'Escape') DOM.helpModal.classList.add('hidden');
if (e.key === '?') { e.preventDefault(); DOM.helpModal.classList.toggle('hidden'); }

// Undo/Redo
if (e.ctrlKey || e.metaKey) {
if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
}

// Pas de shortcuts quand on tape
const tag = document.activeElement?.tagName;
if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

if (e.key === ' ') { e.preventDefault(); generateRandomPalette(); }

if (e.key.toLowerCase() === 'l' && hoveredColorId){
updateState(s => ({ ...s, palette: s.palette.map(c => c.id===hoveredColorId ? ({...c, locked:!c.locked}) : c) }));
toast('Lock togglé');
}

if (e.key.toLowerCase() === 'c' && hoveredColorId){
const c = state.palette.find(x=>x.id===hoveredColorId);
if (c){
const ok = await safeClipboardWrite(ColorUtils.rgbToHex(c.rgb));
toast(ok ? 'HEX copié ✔' : 'Copie impossible', !ok);
}
}
});

// Re-aperçu responsif
window.addEventListener('resize', debounce(()=> { updateImagePreview(); scheduleScrollDebug('resize'); }, 150));
}

// ==========================================================================
// 10. ICONS (inline SVG)
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
// 11. BOOTSTRAP
// ==========================================================================
function init() {
const savedTheme = localStorage.getItem('theme')
|| (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

DOM.html.dataset.theme = savedTheme;
DOM.themeIconDark.classList.toggle('hidden', savedTheme === 'light');
DOM.themeIconLight.classList.toggle('hidden', savedTheme === 'dark');

state = loadStateFromLocalStorage();
history.stack = [clone(state)];
history.index = 0;

ColorWorker.init();
bindEventListeners();

setAriaTabState('editor');

if (DOM.paletteSizeSlider && DOM.paletteSizeValue) {
DOM.paletteSizeValue.textContent = DOM.paletteSizeSlider.value;
}

// Sync drawers mode + autosize
Drawer.syncModes();
IframeAutoSize.init();

render();

// Optional naming self-test (console)
ColorUtils.runNamingSelfTest();

// Proof snapshot at startup
scheduleScrollDebug('init');

console.log('Chroma Studio Premium prêt ✅');
}

document.addEventListener('DOMContentLoaded', init);
