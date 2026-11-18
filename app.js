import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   Scene Builder — a touch-first Three.js block-out tool.
   Everything that matters is in one file so it can be edited
   on a phone. Saved scenes are plain JSON: see serialize().
   GSAP drives the camera path when its CDN build is present;
   the same motion is reproduced on the native clock when not.
   ============================================================ */

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d13);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(4.5, 3.4, 6);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.2;
controls.maxDistance = 40;
controls.update();

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight(0xdfe7ff, 0x151821, 0.85);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(6, 9, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
key.shadow.camera.left = -9;
key.shadow.camera.right = 9;
key.shadow.camera.top = 9;
key.shadow.camera.bottom = -9;
key.shadow.bias = -0.0005;
scene.add(key);

const fill = new THREE.DirectionalLight(0x86a6ff, 0.55);
fill.position.set(-7, 4, -6);
scene.add(fill);

/* ---------- ground ---------- */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x141822, roughness: 0.95, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(30, 30, 0x33405a, 0x1d2431);
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.65;
scene.add(grid);

/* ---------- materials ---------- */
const clayMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.9, metalness: 0.02 });
// BasicDepthPacking writes a plain grayscale ramp (near = white, far = black) into RGB.
// That is what depth-guided video tools expect. RGBADepthPacking packs depth across
// all four channels, which chroma subsampling destroys into coloured noise.
const depthMat = new THREE.MeshDepthMaterial();

const PALETTE = ['#ffb02e', '#7aa2ff', '#6ee7b7', '#ff9ecb', '#c4b5fd', '#f6d365'];

/* ---------- state ---------- */
const state = {
  objects: [],
  selected: null,
  mode: 'move',
  view: 'normal',
  keys: [],
  duration: 5,        // seconds for the whole camera path
  loop: false,        // replay the path, and close it into a seamless circuit
  recPass: 'clay',    // clay, depth or id — used by Render & record
  frame: 'screen',    // 'screen', '16:9' or '9:16' — the shape of the recorded clip
  fx: { glow: 'off', fog: 'off', bg: 'night' },
  nextId: 1,
  recording: false
};

const helper = new THREE.BoxHelper(new THREE.Object3D(), 0xffb02e);
helper.material.depthTest = false;
helper.visible = false;
scene.add(helper);

const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ---------- geometry helpers ---------- */
function rampGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.6, -0.5);
  shape.lineTo(0.6, -0.5);
  shape.lineTo(-0.6, 0.5);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
  geo.center();
  return geo;
}

/* A unique colour per object for the ID pass. Stepping the hue by the golden
   angle keeps every new object as far as possible from the ones before it, so
   two objects never land on similar numbers — which is what a model needs to
   tell them apart. The eye just sees a rainbow. */
function idColorFor(index) {
  const hue = (index * 137.508) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.85, 0.55);
}

function makeGeometry(type) {
  if (type === 'sphere') return new THREE.SphereGeometry(0.55, 32, 24);
  if (type === 'ramp') return rampGeometry();
  if (type === 'plane') return new THREE.BoxGeometry(3, 0.04, 3);
  return new THREE.BoxGeometry(1, 1, 1);
}

/* ---------- object creation ---------- */
function addObject(type, opts = {}) {
  const geometry = makeGeometry(type);
  const color = opts.color || PALETTE[(state.nextId - 1) % PALETTE.length];
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.42,
    metalness: 0.08
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const id = state.nextId++;
  const label = { cube: 'Cube', sphere: 'Sphere', ramp: 'Ramp', plane: 'Floor' }[type] || 'Shape';
  mesh.name = opts.name || `${label} ${id}`;

  if (opts.position) mesh.position.fromArray(opts.position);
  else {
    const n = state.objects.length;
    const restY = type === 'sphere' ? 0.55 : type === 'plane' ? 0.02 : 0.5;
    mesh.position.set(((n % 3) - 1) * 1.8, restY, Math.floor(n / 3) * -1.8);
  }
  if (opts.rotation) mesh.rotation.set(opts.rotation[0], opts.rotation[1], opts.rotation[2]);
  if (opts.scale) mesh.scale.fromArray(opts.scale);

  const record = {
    id,
    type,
    name: mesh.name,
    mesh,
    color,
    material,
    idMaterial: new THREE.MeshBasicMaterial({ color: idColorFor(id), toneMapped: false })
  };
  state.objects.push(record);
  scene.add(mesh);
  select(record);
  refreshChips();
  persist();
  return record;
}

function select(record) {
  state.selected = record || null;
  document.getElementById('quickBar').hidden = !record;
  if (record) {
    helper.setFromObject(record.mesh);
    helper.visible = state.view === 'normal';
    syncSliders();
  } else {
    helper.visible = false;
    syncSliders();
  }
}

/* ---------- chips ---------- */
const chipsEl = document.getElementById('objectChips');
function refreshChips() {
  if (!state.objects.length) {
    chipsEl.innerHTML = '<span class="chip">No shapes yet</span>';
    return;
  }
  chipsEl.innerHTML = state.objects.map((o) =>
    `<button class="chip ${state.selected && state.selected.id === o.id ? 'on' : ''}" data-select="${o.id}">${o.name}</button>`
  ).join('');
  chipsEl.querySelectorAll('[data-select]').forEach((el) => {
    el.addEventListener('click', () => {
      const rec = state.objects.find((o) => o.id === Number(el.dataset.select));
      if (rec) { select(rec); refreshChips(); }
    });
  });
}

/* ---------- transform ---------- */
const slidersEl = document.getElementById('sliders');
const xformHint = document.getElementById('xformHint');
const AXES = ['x', 'y', 'z'];
let sliderEls = {};

function modeConfig() {
  if (state.mode === 'rotate') return { min: -Math.PI, max: Math.PI, step: 0.01, unit: ' rad', deg: true };
  if (state.mode === 'scale') return { min: 0.1, max: 4, step: 0.01, unit: '×' };
  return { min: -10, max: 10, step: 0.01, unit: '' };
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  document.querySelectorAll('#quickBar button').forEach((b) => b.classList.toggle('on', b.dataset.qmode === mode));
  buildSliders();
}

function setDuration(seconds) {
  state.duration = Math.max(1, Number(seconds) || 5);
  document.querySelectorAll('#durSeg button').forEach((b) =>
    b.classList.toggle('on', Number(b.dataset.dur) === state.duration));
  updateKeyInfo();
  persist();
}

function setLoop(on) {
  state.loop = !!on;
  const btn = document.getElementById('btnLoop');
  btn.textContent = 'Loop: ' + (state.loop ? 'on' : 'off');
  btn.classList.toggle('blue', state.loop);
  if (state.loop && state.keys.length === 2) toast('Add a third camera key for a seamless loop');
  persist();
}

function setRecPass(pass, preview = false) {
  state.recPass = ['clay', 'depth', 'id'].includes(pass) ? pass : 'clay';
  document.querySelectorAll('#recModeSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.rec === state.recPass));
  if (preview) {
    state.view = state.recPass;
    applyView();
  }
  persist();
}

function setFrame(name) {
  state.frame = FRAMES[name] ? name : 'screen';
  document.querySelectorAll('#frameSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.frame === state.frame));
  layoutCanvas();
  persist();
}

function buildSliders() {
  const cfg = modeConfig();
  slidersEl.innerHTML = AXES.map((axis) => `
    <div class="axis">
      <div class="axis-head"><span>${axis.toUpperCase()}</span><b id="val-${axis}">0</b></div>
      <input type="range" id="sl-${axis}" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="0" aria-label="${axis} axis">
    </div>`).join('');

  sliderEls = {};
  AXES.forEach((axis) => {
    const input = document.getElementById('sl-' + axis);
    sliderEls[axis] = { input, value: document.getElementById('val-' + axis) };
    input.addEventListener('input', () => {
      const rec = state.selected;
      if (!rec) return;
      const v = parseFloat(input.value);
      if (state.mode === 'rotate') rec.mesh.rotation[axis] = v;
      else if (state.mode === 'scale') rec.mesh.scale[axis] = v;
      else rec.mesh.position[axis] = v;
      sliderEls[axis].value.textContent = formatValue(v);
      helper.setFromObject(rec.mesh);
      persist();
    });
  });
  syncSliders();
}

function formatValue(v) {
  if (state.mode === 'rotate') return (v * 180 / Math.PI).toFixed(0) + '°';
  if (state.mode === 'scale') return v.toFixed(2) + '×';
  return v.toFixed(2);
}

function syncSliders() {
  const rec = state.selected;
  xformHint.textContent = rec
    ? `${state.mode === 'move' ? 'Moving' : state.mode === 'rotate' ? 'Rotating' : 'Scaling'} ${rec.name}`
    : 'Nothing selected — add a shape first.';
  AXES.forEach((axis) => {
    const el = sliderEls[axis];
    if (!el) return;
    if (!rec) { el.input.value = 0; el.value.textContent = '—'; return; }
    const v = state.mode === 'rotate' ? rec.mesh.rotation[axis]
      : state.mode === 'scale' ? rec.mesh.scale[axis]
      : rec.mesh.position[axis];
    el.input.value = v;
    el.value.textContent = formatValue(v);
  });
}

/* ---------- camera keys ---------- */
const keyInfo = document.getElementById('keyInfo');
function updateKeyInfo() {
  keyInfo.textContent = state.keys.length
    ? `${state.keys.length} key${state.keys.length === 1 ? '' : 's'} — ${state.keys.length > 1 ? `${state.duration}s path, ready to play` : 'add one more'}`
    : 'No camera keys yet. Orbit to a view, then tap + Camera key.';
}

function addKey() {
  state.keys.push({
    p: camera.position.toArray().map(n => +n.toFixed(3)),
    t: controls.target.toArray().map(n => +n.toFixed(3))
  });
  updateKeyInfo();
  persist();
  toast(`Key ${state.keys.length} added`);
}

function samePoint(a, b) {
  return a.every((n, i) => Math.abs(n - b[i]) < 0.002);
}

/* A closed curve already joins the last key back to the first, so an explicit
   duplicate of the first key at the end would leave a zero-length segment. */
function withoutClosingKey(keys) {
  if (keys.length < 3) return keys;
  const first = keys[0], last = keys[keys.length - 1];
  return samePoint(first.p, last.p) && samePoint(first.t, last.t) ? keys.slice(0, -1) : keys;
}

/* The camera path as curves. With three or more keys and loop on, the curve
   closes so a pass ends exactly where it began. */
function pathCurves(asked = state.loop) {
  const closed = !!asked && state.keys.length > 2;
  const keys = closed ? withoutClosingKey(state.keys) : state.keys;
  return {
    closed,
    posCurve: new THREE.CatmullRomCurve3(keys.map(k => new THREE.Vector3(...k.p)), closed),
    tgtCurve: new THREE.CatmullRomCurve3(keys.map(k => new THREE.Vector3(...k.t)), closed)
  };
}

let pathAnimation = null;

/* Flies the camera along the keyframes in state.duration seconds.
   GSAP drives it when the CDN build loaded; the same motion is reproduced
   on the native clock if it did not, so the app never depends on a CDN to animate.
   With loop on, the path is a closed circuit travelled at constant speed, so the
   end of one pass is the start of the next — no jump, no stall at the join. */
function playPath(options = {}) {
  if (state.keys.length < 2) { toast('Add at least two camera keys'); return Promise.resolve(); }
  if (pathAnimation) return Promise.resolve();

  const repeat = options.loop !== undefined ? !!options.loop : state.loop;
  const asked = options.closed !== undefined ? !!options.closed : state.loop;
  const { closed, posCurve, tgtCurve } = pathCurves(asked);
  const seconds = Math.max(1, Number(options.seconds || state.duration) || 5);

  controls.enabled = false;
  const proxy = { u: 0 };
  let stopped = false;

  return new Promise((resolve) => {
    const apply = () => {
      camera.position.copy(posCurve.getPointAt(proxy.u));
      controls.target.copy(tgtCurve.getPointAt(proxy.u));
      controls.update();
    };
    const finish = () => {
      if (stopped) return;
      stopped = true;
      pathAnimation = null;
      controls.enabled = true;
      resolve();
    };

    if (window.gsap) {
      const tween = gsap.to(proxy, {
        u: 1,
        duration: seconds,
        // Constant speed when the path is closed: an ease would slow to a stop at
        // the join, which is the visible hitch you would see on every repeat.
        ease: closed ? 'none' : 'power1.inOut',
        repeat: repeat ? -1 : 0,
        onUpdate: apply,
        onComplete: finish
      });
      pathAnimation = {
        stop: () => { stopped = true; tween.kill(); pathAnimation = null; controls.enabled = true; resolve(); }
      };
    } else {
      let start = performance.now();
      const total = seconds * 1000;
      const step = () => {
        if (stopped) return;
        const elapsed = performance.now() - start;
        proxy.u = closed ? (elapsed % total) / total : Math.min(1, elapsed / total);
        apply();
        if (elapsed < total) { requestAnimationFrame(step); return; }
        if (repeat) { start = performance.now(); requestAnimationFrame(step); return; }
        finish();
      };
      requestAnimationFrame(step);
      pathAnimation = {
        stop: () => { stopped = true; pathAnimation = null; controls.enabled = true; resolve(); }
      };
    }
  });
}

function stopPath() {
  if (pathAnimation && typeof pathAnimation.stop === 'function') pathAnimation.stop();
  else { pathAnimation = null; controls.enabled = true; }
}

/* ---------- effects ----------
   Glow is a real post-process (EffectComposer + UnrealBloomPass), imported on first use so
   a missing CDN copy only costs the effect, not the whole app. Atmosphere and backdrop are
   plain scene settings. All three touch the Normal view only: the clay, depth and ID passes
   exist to hand clean values to video tools, so nothing bloomed or hazed goes near them. */
const BACKDROPS = { night: 0x0b0d13, steel: 0x232b3a, ember: 0x2b1a20 };
const FOG_RANGES = { light: [26, 64], thick: [9, 32] };
const GLOW_LOOKS = {
  soft: { strength: 0.5, radius: 0.6, threshold: 0.72 },
  strong: { strength: 1.2, radius: 0.9, threshold: 0.42 }
};

let composer = null;
let bloomPass = null;
let composerReady = false;
let composerLoading = null;

function ensureComposer() {
  if (composerReady) return Promise.resolve(true);
  if (composerLoading) return composerLoading;
  composerLoading = (async () => {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js')
      ]);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.72);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      composerReady = true;
      syncComposerSize();
      applyFx();
    } catch (err) {
      composer = null;
      bloomPass = null;
      composerReady = false;
      toast('Glow could not load — check the connection');
    } finally {
      composerLoading = null;
    }
    return composerReady;
  })();
  return composerLoading;
}

function syncComposerSize() {
  if (!composer) return;
  const size = renderer.getSize(new THREE.Vector2());
  composer.setSize(size.x, size.y);
  if (typeof composer.setPixelRatio === 'function') composer.setPixelRatio(renderer.getPixelRatio());
}

function applyFx() {
  const bg = new THREE.Color(BACKDROPS[state.fx.bg] || BACKDROPS.night);
  const range = state.view === 'normal' ? FOG_RANGES[state.fx.fog] : null;
  scene.fog = range ? new THREE.Fog(bg, range[0], range[1]) : null;
  if (state.view === 'normal') scene.background = bg;

  if (bloomPass) {
    const look = GLOW_LOOKS[state.fx.glow];
    bloomPass.enabled = !!look;
    if (look) {
      bloomPass.strength = look.strength;
      bloomPass.radius = look.radius;
      bloomPass.threshold = look.threshold;
    }
  }

  // fog is baked into each material's program, so every one of them has to rebuild
  [ground.material, clayMat, ...state.objects.map((o) => o.material)].forEach((m) => {
    if (m) m.needsUpdate = true;
  });
}

/* One render call for the live loop: the bloom path only when it is on and only in
   Normal, so every other view keeps the plain, exact render it had before. */
function renderScene() {
  if (composerReady && composer && state.view === 'normal' && state.fx.glow !== 'off') composer.render();
  else renderer.render(scene, camera);
}

function setGlow(level) {
  state.fx.glow = GLOW_LOOKS[level] ? level : 'off';
  document.querySelectorAll('#glowSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.glow === state.fx.glow));
  if (state.fx.glow !== 'off') ensureComposer();
  applyFx();
  persist();
}

function setFog(level) {
  state.fx.fog = FOG_RANGES[level] ? level : 'off';
  document.querySelectorAll('#fogSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.fog === state.fx.fog));
  applyFx();
  persist();
}

function setBg(name) {
  state.fx.bg = BACKDROPS[name] ? name : 'night';
  document.querySelectorAll('#bgSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.bg === state.fx.bg));
  applyFx();
  persist();
}

/* ---------- view modes ---------- */
function applyView() {
  scene.overrideMaterial = null;
  scene.background = new THREE.Color(BACKDROPS[state.fx.bg] || BACKDROPS.night);
  grid.visible = state.view === 'normal';
  ground.visible = true;
  ground.material.color.set(0x141822);
  helper.visible = state.view === 'normal' && !!state.selected;

  // put the authored materials back before choosing a pass
  state.objects.forEach((o) => { if (o.mesh.material !== o.material) o.mesh.material = o.material; });

  if (state.view === 'clay') {
    scene.overrideMaterial = clayMat;
    scene.background = new THREE.Color(0x151515);
    ground.material.color.set(0x1b1b1b);
  } else if (state.view === 'depth') {
    scene.overrideMaterial = depthMat;
    scene.background = new THREE.Color(0x000000);
  } else if (state.view === 'id') {
    // Flat, unlit, one unique colour per object: a segmentation pass.
    // The floor is hidden and the background is black so anything that is not an
    // object stays a single value — no shadows or lighting shades to confuse it.
    scene.background = new THREE.Color(0x000000);
    ground.visible = false;
    state.objects.forEach((o) => { o.mesh.material = o.idMaterial; });
  }
  document.querySelectorAll('#viewSeg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === state.view));
  applyFx();
}

/* ---------- recording ---------- */
const recBox = document.getElementById('recBox');
const recTime = document.getElementById('recTime');
let recorder = null;
let recChunks = [];
let recTimer = null;
let recStart = 0;

function pickMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function startRecording() {
  if (!window.MediaRecorder) { toast('This browser cannot record video'); return false; }
  if (state.recording) return true;

  const mime = pickMime();
  if (!mime) { toast('No supported video format here'); return false; }

  const stream = canvas.captureStream(30);
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  } catch (err) {
    recorder = new MediaRecorder(stream);
  }
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    const type = recorder.mimeType || mime || 'video/webm';
    const blob = new Blob(recChunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(blob, `scene-${stamp}.${ext}`);
    toast(`Saved ${ext.toUpperCase()} — check your downloads`);
    stopRecordingUI();
  };

  recorder.start(250);
  state.recording = true;
  recStart = performance.now();
  recBox.classList.add('on');
  document.getElementById('btnRecord').classList.add('primary');
  recTimer = setInterval(() => {
    const s = Math.floor((performance.now() - recStart) / 1000);
    recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  return true;
}

function stopRecordingUI() {
  state.recording = false;
  recBox.classList.remove('on');
  clearInterval(recTimer);
  recTimer = null;
  document.getElementById('btnRecord').classList.remove('primary');
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else stopRecordingUI();
}

/* One button: switch to the chosen pass, fly the camera path and save the video.
   The recording is started here, inside the click, because captureStream needs a user gesture.
   With loop on it records exactly one closed pass, which is the clip that tiles cleanly. */
async function renderAndRecord() {
  if (state.keys.length < 2) { toast('Add at least two camera keys first'); return; }
  state.view = state.recPass;
  applyView();
  if (!startRecording()) return;
  await new Promise((r) => setTimeout(r, 250)); // let the first frames settle in the new pass
  await playPath({ loop: false });
  setTimeout(stopRecording, 450);
}

/* ---------- mp4 export ----------
   MediaRecorder on Android Chrome only offers WebM, and AI video services want
   MP4. WebCodecs can encode H.264 directly, so when it is available every frame
   is rendered here at an exact 30fps and written into a real .mp4 container.
   Slower than recording, but the file is the format these services accept. */
const MP4_FPS = 30;
const MP4_CODECS = ['avc1.42001f', 'avc1.4d401f', 'avc1.64001f'];
let mp4Ready = false;
let mp4Busy = false;

async function pickMp4Config(width, height, fps) {
  if (typeof window.VideoEncoder !== 'function' || typeof window.VideoFrame !== 'function') return null;
  for (const codec of MP4_CODECS) {
    const config = {
      codec,
      width,
      height,
      bitrate: 8_000_000,
      framerate: fps,
      avc: { format: 'avc' }   // mp4-muxer needs the avcC description
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support && support.supported) return support.config || config;
    } catch (err) { /* try the next profile */ }
  }
  return null;
}

async function detectMp4Support() {
  const btn = document.getElementById('btnMp4');
  const hint = document.getElementById('mp4Hint');
  const config = await pickMp4Config(1280, 720, MP4_FPS);
  mp4Ready = !!config;
  btn.disabled = !mp4Ready;
  hint.textContent = mp4Ready
    ? 'Export MP4 renders every frame at a fixed 30fps and writes a real .mp4 at the recording frame size. Slower than recording, but it is the file these services accept.'
    : 'This browser cannot encode MP4. Record the clip, then convert it: CapCut imports WebM and exports MP4, and most free converter sites do the same.';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportMp4() {
  if (mp4Busy) return;
  if (state.keys.length < 2) { toast('Add at least two camera keys first'); return; }
  if (!FRAMES[state.frame]) { toast('Pick 16:9 or 9:16 in Recording frame first'); return; }
  if (state.recording) { toast('Stop the recorder first'); return; }

  const btn = document.getElementById('btnMp4');
  const width = canvas.width;
  const height = canvas.height;
  const config = await pickMp4Config(width, height, MP4_FPS);
  if (!config) { toast('This browser cannot encode MP4 — convert the WebM instead'); return; }

  let muxer;
  try {
    const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: MP4_FPS },
      fastStart: 'in-memory'
    });
  } catch (err) {
    toast('Could not load the MP4 writer — check the connection');
    return;
  }

  mp4Busy = true;
  btn.disabled = true;

  const restore = {
    position: camera.position.clone(),
    target: controls.target.clone(),
    view: state.view
  };
  state.view = state.recPass;
  applyView();

  const { closed, posCurve, tgtCurve } = pathCurves();
  const seconds = Math.max(1, state.duration);
  const frames = Math.max(2, Math.round(seconds * MP4_FPS));
  // power1.inOut is a quadratic ease; this is the same curve without GSAP.
  const ease = (t) => closed ? t : (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { failure = err; }
  });
  encoder.configure(config);

  try {
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      // A closed loop ends one frame short of a full turn, so the clip tiles.
      const u = ease(closed ? i / frames : i / (frames - 1));
      camera.position.copy(posCurve.getPointAt(u));
      camera.lookAt(tgtCurve.getPointAt(u));
      renderer.render(scene, camera);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / MP4_FPS),
        duration: Math.round(1_000_000 / MP4_FPS)
      });
      encoder.encode(videoFrame, { keyFrame: i % MP4_FPS === 0 });
      videoFrame.close();

      if (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 0));
      if (i % 15 === 0) toast(`Encoding ${Math.round((i / frames) * 100)}%`);
    }

    await encoder.flush();
    muxer.finalize();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `scene-${stamp}.mp4`);
    toast(`Saved MP4 — ${width}×${height}, ${seconds}s`);
  } catch (err) {
    toast('MP4 export failed — record the WebM and convert it');
  } finally {
    try { encoder.close(); } catch (err) { /* already closed */ }
    camera.position.copy(restore.position);
    controls.target.copy(restore.target);
    camera.lookAt(controls.target);
    controls.update();
    state.view = restore.view;
    applyView();
    mp4Busy = false;
    btn.disabled = !mp4Ready;
  }
}

/* ---------- saving ---------- */
const SCENE_SCHEMA = 1;

function serialize() {
  return {
    schema: SCENE_SCHEMA,
    view: state.view,
    duration: state.duration,
    loop: state.loop,
    frame: state.frame,
    fx: { glow: state.fx.glow, fog: state.fx.fog, bg: state.fx.bg },
    camera: {
      position: camera.position.toArray().map(n => +n.toFixed(3)),
      target: controls.target.toArray().map(n => +n.toFixed(3)),
      fov: camera.fov
    },
    objects: state.objects.map((o) => ({
      type: o.type,
      name: o.name,
      position: o.mesh.position.toArray().map(n => +n.toFixed(3)),
      rotation: [+o.mesh.rotation.x.toFixed(3), +o.mesh.rotation.y.toFixed(3), +o.mesh.rotation.z.toFixed(3)],
      scale: o.mesh.scale.toArray().map(n => +n.toFixed(3)),
      color: '#' + o.material.color.getHexString()
    })),
    keys: state.keys
  };
}

let persistTimer;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem('scene-builder:v1', JSON.stringify(serialize())); }
    catch (err) { /* storage full or private mode — nothing breaks */ }
  }, 350);
}

function loadScene(data) {
  if (!data || !Array.isArray(data.objects)) { toast('That file is not a scene'); return; }
  clearScene(false);
  data.objects.forEach((o) => addObject(o.type || 'cube', o));
  state.keys = Array.isArray(data.keys) ? data.keys : [];
  if (data.view) { state.view = data.view; applyView(); }
  if (data.duration) setDuration(Number(data.duration));
  if (typeof data.loop === 'boolean') setLoop(data.loop);
  if (data.frame) setFrame(data.frame);
  if (data.fx) {
    setBg(data.fx.bg);
    setFog(data.fx.fog);
    setGlow(data.fx.glow);
  }
  if (data.camera) {
    camera.position.fromArray(data.camera.position);
    controls.target.fromArray(data.camera.target);
    if (data.camera.fov) { camera.fov = data.camera.fov; camera.updateProjectionMatrix(); }
    controls.update();
  }
  select(null);
  refreshChips();
  updateKeyInfo();
  persist();
  toast(`Loaded ${data.objects.length} shape${data.objects.length === 1 ? '' : 's'}`);
}

function clearScene(ask = true) {
  if (ask && state.objects.length && !confirm('Clear every shape and camera key?')) return;
  state.objects.forEach((o) => {
    scene.remove(o.mesh);
    o.mesh.geometry.dispose();
    o.material.dispose();
    o.idMaterial.dispose();
  });
  state.objects = [];
  state.keys = [];
  state.nextId = 1;
  select(null);
  refreshChips();
  updateKeyInfo();
  persist();
}

function downloadScene() {
  const json = JSON.stringify(serialize(), null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'scene-state.json');
  toast('Scene JSON saved');
}

/* ---------- picking ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;

canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 600;
  downAt = null;
  if (moved > 10 || !quick) return; // that was an orbit, not a tap

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(state.objects.map(o => o.mesh), false);
  if (hits.length) {
    const rec = state.objects.find(o => o.mesh === hits[0].object);
    select(rec);
  } else {
    select(null);
  }
  refreshChips();
});

/* ---------- UI wiring ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach(p =>
      p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
  });
});

document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => addObject(btn.dataset.add));
});

document.getElementById('btnDuplicate').addEventListener('click', () => {
  const rec = state.selected;
  if (!rec) return toast('Select a shape first');
  const copy = addObject(rec.type, {
    position: [rec.mesh.position.x + 1, rec.mesh.position.y, rec.mesh.position.z + 1],
    rotation: [rec.mesh.rotation.x, rec.mesh.rotation.y, rec.mesh.rotation.z],
    scale: rec.mesh.scale.toArray(),
    color: rec.color
  });
  copy.mesh.name = rec.name + ' copy';
  copy.name = copy.mesh.name;
  refreshChips();
});

document.getElementById('btnDelete').addEventListener('click', () => {
  const rec = state.selected;
  if (!rec) return toast('Select a shape first');
  scene.remove(rec.mesh);
  rec.mesh.geometry.dispose();
  rec.material.dispose();
  rec.idMaterial.dispose();
  state.objects = state.objects.filter(o => o.id !== rec.id);
  select(null);
  refreshChips();
  persist();
});

document.getElementById('modeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (btn) setMode(btn.dataset.mode);
});

document.getElementById('quickBar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qmode]');
  if (btn) setMode(btn.dataset.qmode);
});

document.getElementById('durSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dur]');
  if (btn) setDuration(Number(btn.dataset.dur));
});

document.getElementById('btnLoop').addEventListener('click', () => setLoop(!state.loop));

document.getElementById('recModeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rec]');
  if (btn) setRecPass(btn.dataset.rec, true); // preview the pass as soon as it is picked
});

document.getElementById('frameSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-frame]');
  if (btn) setFrame(btn.dataset.frame);
});

document.getElementById('btnMp4').addEventListener('click', exportMp4);

document.getElementById('glowSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-glow]');
  if (btn) setGlow(btn.dataset.glow);
});

document.getElementById('fogSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-fog]');
  if (btn) setFog(btn.dataset.fog);
});

document.getElementById('bgSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bg]');
  if (btn) setBg(btn.dataset.bg);
});

document.getElementById('btnReset').addEventListener('click', () => {
  const rec = state.selected;
  if (!rec) return toast('Select a shape first');
  rec.mesh.rotation.set(0, 0, 0);
  rec.mesh.scale.set(1, 1, 1);
  rec.mesh.position.y = rec.type === 'sphere' ? 0.55 : rec.type === 'plane' ? 0.02 : 0.5;
  helper.setFromObject(rec.mesh);
  syncSliders();
  persist();
});

document.getElementById('viewSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  state.view = btn.dataset.view;
  applyView();
  persist();
});

document.getElementById('btnAddKey').addEventListener('click', addKey);
document.getElementById('btnPlayPath').addEventListener('click', () => playPath());
document.getElementById('btnClearKeys').addEventListener('click', () => {
  state.keys = [];
  updateKeyInfo();
  persist();
  toast('Camera keys cleared');
});
document.getElementById('btnRecord').addEventListener('click', () => {
  if (state.recording) stopRecording();
  else startRecording();
});
document.getElementById('btnRenderRecord').addEventListener('click', renderAndRecord);
document.getElementById('btnStopRec').addEventListener('click', stopRecording);

document.getElementById('btnSave').addEventListener('click', downloadScene);
document.getElementById('btnOpen').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('btnClear').addEventListener('click', () => clearScene());

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    loadScene(JSON.parse(text));
  } catch (err) {
    toast('Could not read that file');
  }
  e.target.value = '';
});

/* ---------- resize and recording frame ---------- */
function onResizeCamera(w, h) {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* Pixel sizes for the fixed frames. 720p is what these services want and what a
   phone can hold at 30fps; the scene is composed inside this exact rectangle. */
const FRAMES = { '16:9': [1280, 720], '9:16': [720, 1280] };

function layoutCanvas() {
  const target = FRAMES[state.frame];

  if (!target) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.right = '0';
    canvas.style.bottom = '0';
    canvas.style.transform = 'none';
    canvas.style.borderRadius = '0';
    canvas.style.boxShadow = 'none';
    onResizeCamera(window.innerWidth, window.innerHeight);
    syncComposerSize();
    return;
  }

  const [w, h] = target;
  const deck = document.querySelector('.deck');
  const deckH = deck ? deck.getBoundingClientRect().height : 0;
  const availH = Math.max(120, window.innerHeight - deckH);

  // Pixel ratio 1 so the canvas buffer is exactly w × h and the recorded clip is
  // exactly 1280×720 or 720×1280, whatever the phone's own screen is doing.
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);

  const scale = Math.min(window.innerWidth / w, availH / h);
  const cssW = Math.round(w * scale);
  const cssH = Math.round(h * scale);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.style.left = '50%';
  canvas.style.top = Math.round((availH - cssH) / 2) + 'px';
  canvas.style.right = 'auto';
  canvas.style.bottom = 'auto';
  canvas.style.transform = 'translateX(-50%)';
  canvas.style.borderRadius = '10px';
  canvas.style.boxShadow = '0 0 0 1px rgba(255,255,255,.18), 0 18px 40px -18px rgba(0,0,0,.9)';
  onResizeCamera(w, h);
  syncComposerSize();
}

function onResize() { layoutCanvas(); }
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

/* ---------- render loop ---------- */
function frame() {
  requestAnimationFrame(frame);
  controls.update();
  if (state.selected && state.view === 'normal') helper.setFromObject(state.selected.mesh);
  renderScene();
}

/* ---------- boot ---------- */
buildSliders();
setDuration(state.duration);
setLoop(state.loop);
setRecPass(state.recPass);
setFrame(state.frame);
detectMp4Support();
applyView();
applyFx();
updateKeyInfo();

try {
  const raw = localStorage.getItem('scene-builder:v1');
  if (raw) {
    const data = JSON.parse(raw);
    if (data && data.objects && data.objects.length) {
      loadScene(data);
      toast('Restored your last scene');
    }
  }
} catch (err) { /* start clean */ }

if (!state.objects.length) {
  addObject('cube', { position: [-1.2, 0.5, 0], color: '#ffb02e' });
  addObject('ramp', { position: [1.4, 0.5, 0.4], rotation: [0, -0.5, 0], color: '#7aa2ff' });
  select(null);
  refreshChips();
}

frame();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// exposed for agents driving the page from a console
window.sceneBuilder = {
  state, scene, camera, controls, addObject, serialize, loadScene, clearScene,
  addKey, playPath, stopPath, renderAndRecord, startRecording, stopRecording,
  applyView, setMode, setDuration, setLoop, setRecPass, setFrame, layoutCanvas,
  exportMp4, idColorFor, setGlow, setFog, setBg, applyFx, ensureComposer
};
