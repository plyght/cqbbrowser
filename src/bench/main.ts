import {
  ACESFilmicToneMapping,
  AxesHelper,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  computeStats,
  defaultBuild,
  partsFor,
  PLATFORMS,
  PRESETS,
  resolveBuild,
  serializeBuild,
  validateBuild,
  withPart,
  type SlotId,
  type StockPart,
  type WeaponBuild,
  type WeaponId,
} from '../weapons/attachments';
import { buildModelFromBuild, setWeaponEnvMap, type WeaponModel } from '../weapons/models';

/**
 * Weapon bench (dev page, later the loadout bench): orbit a configured weapon, toggle every slot,
 * read the derived stats. URL: bench.html?preset=sb16_cqb&view=side&ui=0
 * Test hook: window.__bench { setBuild(build), setView(name), model, stats }.
 */
const q = new URLSearchParams(location.search);
const canvas = document.getElementById('bench') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
if (q.get('ui') === '0') panel.classList.add('hidden');
else document.body.classList.add('with-panel');

const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new Scene();
scene.background = new Color(0x1e2124);
const pmrem = new PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
setWeaponEnvMap(env);
scene.environment = env;
scene.add(new HemisphereLight(0xdfe6ee, 0x3a3632, 0.35));
const fill = new DirectionalLight(0xffffff, 0.9);
fill.position.set(2, 0.4, -0.3);
scene.add(fill);
const key = new DirectionalLight(0xfff4e6, 1.9);
key.position.set(1.2, 2.2, 1.4);
scene.add(key);
const rim = new DirectionalLight(0xbcd2ff, 1.6);
rim.position.set(-1.5, 0.8, -1.2);
scene.add(rim);
const key2 = new DirectionalLight(0xfff8f0, 1.5);
key2.position.set(-1.3, 2.0, 0.7);
scene.add(key2);
const floor = new Mesh(
  new CircleGeometry(1.4, 48),
  new MeshStandardMaterial({ color: 0x232527, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.28;
if (q.get('floor') === '1') scene.add(floor);

const camera = new PerspectiveCamera(30, 1, 0.01, 20);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

let build: WeaponBuild =
  q.get('preset') && PRESETS[q.get('preset')!]
    ? structuredClone(PRESETS[q.get('preset')!])
    : defaultBuild((q.get('w') as WeaponId) || 'sb16');
let model: WeaponModel | null = null;
let helpers: AxesHelper[] = [];
let showSockets = q.get('sockets') === '1';
let view = q.get('view') ?? 'threeq';
let pending = false;

function frame(name: string) {
  if (!model) return;
  view = name;
  const box = new Box3().setFromObject(model.root);
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const endOn = name === 'rear' || name === 'front';
  const L = endOn ? Math.max(size.x, size.y) * 1.9 : Math.max(size.z, size.y * 1.6, 0.18);
  const d = (L / 2 / Math.tan((camera.fov * Math.PI) / 360)) * (camera.aspect < 1.2 ? 1.5 : 1.05);
  const dirs: Record<string, Vector3> = {
    side: new Vector3(1, 0.02, 0),
    left: new Vector3(-1, 0.02, 0),
    threeq: new Vector3(0.85, 0.32, -0.42),
    rear: new Vector3(0.35, 0.25, 1),
    top: new Vector3(0.05, 1, 0.02),
    front: new Vector3(0.45, 0.2, -1),
  };
  const dir = (dirs[name] ?? dirs.threeq).clone().normalize();
  camera.position.copy(c).addScaledVector(dir, d);
  controls.target.copy(c);
  camera.near = d / 50;
  camera.far = d * 10;
  camera.updateProjectionMatrix();
  controls.update();
  floor.position.y = box.min.y - 0.01;
}

function rebuild(refocus = false) {
  const errors = validateBuild(build);
  if (!errors.length) {
    if (model) {
      scene.remove(model.root);
      model.dispose();
    }
    model = buildModelFromBuild(build);
    scene.add(model.root);
    for (const h of helpers) h.removeFromParent();
    helpers = [];
    if (showSockets)
      for (const o of [...Object.values(model.sockets), ...model.sightLines.map((s) => s.node)]) {
        const h = new AxesHelper(0.03);
        o?.add(h);
        helpers.push(h);
      }
    if (refocus) frame(view);
  }
  renderPanel(errors.map((e) => e.message));
  requestRender();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function renderPanel(errors: string[]) {
  panel.replaceChildren();
  const pd = PLATFORMS[build.weapon];
  panel.append(el('h1', { textContent: 'WEAPON BENCH' }));
  const wsel = el('select');
  for (const id of Object.keys(PLATFORMS))
    wsel.append(
      el('option', { value: id, textContent: PLATFORMS[id as WeaponId].name, selected: id === build.weapon }),
    );
  wsel.onchange = () => {
    build = defaultBuild(wsel.value as WeaponId);
    rebuild(true);
  };
  panel.append(el('label', {}, 'Weapon', wsel));
  const psel = el('select');
  psel.append(el('option', { value: '', textContent: '— preset —' }));
  for (const [id, p] of Object.entries(PRESETS))
    if (p.weapon === build.weapon) psel.append(el('option', { value: id, textContent: p.name ?? id }));
  psel.onchange = () => {
    if (!psel.value) return;
    build = structuredClone(PRESETS[psel.value]);
    rebuild(true);
  };
  panel.append(el('label', {}, 'Preset', psel));

  panel.append(el('h2', { textContent: 'Parts' }));
  const r = resolveBuild(build);
  for (const slot of pd.slots) {
    const sel = el('select');
    for (const p of partsFor(build.weapon, slot as SlotId)) {
      const ok = withPart(build, slot, p.id).errors.length === 0;
      sel.append(
        el('option', {
          value: p.id,
          textContent: p.name + (ok ? '' : ' ✕'),
          selected: r.parts[slot]?.id === p.id,
          className: ok ? '' : 'bad',
        }),
      );
    }
    sel.onchange = () => {
      build = { ...build, parts: { ...build.parts, [slot]: sel.value } };
      rebuild(slot === 'barrel' || slot === 'stock' || slot === 'handguard');
    };
    panel.append(el('label', {}, slot, sel));
  }
  const st = r.parts.stock as StockPart | undefined;
  if (st && st.positions > 1) {
    const rng = el('input', {
      type: 'range',
      min: '0',
      max: String(st.positions - 1),
      value: String(r.params.stockPosition),
    });
    rng.oninput = () => {
      build = { ...build, params: { ...build.params, stockPosition: +rng.value } };
      rebuild();
    };
    panel.append(el('label', {}, 'stock pos', rng));
  }
  if (st?.folds) {
    const cb = el('input', { type: 'checkbox', checked: r.params.stockFolded });
    cb.onchange = () => {
      build = { ...build, params: { ...build.params, stockFolded: cb.checked } };
      rebuild();
    };
    panel.append(el('label', {}, 'folded', cb));
  }
  for (const k of ['lightSide', 'offsetSide'] as const) {
    const s = el('select');
    for (const v of ['right', 'left'])
      s.append(el('option', { value: v, textContent: v, selected: r.params[k] === v }));
    s.onchange = () => {
      build = { ...build, params: { ...build.params, [k]: s.value } };
      rebuild();
    };
    panel.append(el('label', {}, k, s));
  }
  if (errors.length) panel.append(el('div', { className: 'errors', textContent: errors.join('\n') }));

  if (!errors.length && model) {
    const s = computeStats(r);
    panel.append(el('h2', { textContent: 'Stats' }));
    const t = el('table');
    const row = (k: string, v: string) =>
      t.append(el('tr', {}, el('td', { textContent: k }), el('td', { textContent: v })));
    row('mass (loaded)', `${s.mass.toFixed(2)} kg`);
    row('length', `${(s.length * 100).toFixed(1)} cm (min ${(s.lengthMin * 100).toFixed(1)})`);
    row('barrel', `${s.barrelInches.toFixed(1)}"`);
    row('velocity', `${s.velocity.toFixed(0)} m/s`);
    row('ADS time', `${(s.handling.adsTime * 1000).toFixed(0)} ms`);
    row('balance', `${(s.handling.balance * 100).toFixed(1)} cm fwd`);
    row('lag half-life', `${(s.handling.lagHalfLife * 1000).toFixed(0)} ms`);
    row('sway', `×${s.handling.swayMul.toFixed(2)}`);
    row(
      'recoil up/side/back',
      `×${s.recoilMul.up.toFixed(2)} / ${s.recoilMul.side.toFixed(2)} / ${s.recoilMul.back.toFixed(2)}`,
    );
    row('recovery', `×${s.handling.recoveryMul.toFixed(2)}`);
    row('flash / report', `${s.flash.toFixed(2)} / ${s.report.toFixed(2)}`);
    row('switch time', `${s.handling.switchTime.toFixed(2)} s`);
    row('aim modes', model.sightLines.map((x) => x.mode.id).join(' → ') || '—');
    row('draw calls', String(model.stats.drawCalls));
    row('triangles', model.stats.triangles.toLocaleString());
    panel.append(t);
  }

  panel.append(el('h2', { textContent: 'Loadout JSON' }));
  const ta = el('textarea', { value: serializeBuild(build) });
  panel.append(ta);
  const load = el('button', { textContent: 'Load JSON' });
  load.onclick = () => {
    try {
      build = JSON.parse(ta.value);
      rebuild(true);
    } catch (e) {
      alert(String(e));
    }
  };
  const views = el('div', { className: 'row' }, load);
  for (const v of ['side', 'threeq', 'left', 'top', 'rear', 'front']) {
    const b = el('button', { textContent: v });
    b.onclick = () => frame(v);
    views.append(b);
  }
  const sock = el('button', { textContent: showSockets ? 'hide sockets' : 'sockets' });
  sock.onclick = () => {
    showSockets = !showSockets;
    rebuild();
  };
  views.append(sock);
  panel.append(views);
}

function resize() {
  const w = canvas.clientWidth || innerWidth,
    h = canvas.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
rebuild(true);

// Render on demand (cheap under SwiftShader; damping keeps animating while it settles).
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (controls.update()) requestRender();
    renderer.render(scene, camera);
  });
}
controls.addEventListener('change', requestRender);
addEventListener('resize', requestRender);
requestRender();

const caption = q.get('caption');
if (caption) document.body.append(el('div', { id: 'caption', textContent: caption }));

(window as unknown as { __bench: unknown }).__bench = {
  setBuild(b: WeaponBuild, v?: string) {
    build = structuredClone(b);
    if (v) view = v;
    rebuild(true);
    renderer.render(scene, camera);
    return model ? { ...model.stats, errors: validateBuild(build).map((e) => e.message) } : null;
  },
  setBuildByPreset(id: string, v?: string) {
    return (
      window as unknown as { __bench: { setBuild(b: WeaponBuild, v?: string): unknown } }
    ).__bench.setBuild(PRESETS[id], v);
  },
  setView(v: string) {
    frame(v);
    renderer.render(scene, camera);
  },
  get model() {
    return model;
  },
  get stats() {
    return model?.stats;
  },
};
document.body.dataset.ready = '1';
