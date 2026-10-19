import { bus } from '../core/bus';
import { Box3, Object3D, Vector3, type PerspectiveCamera } from 'three';
import type { DeviceKind } from '../input/actions';
import { glyphFor, type KeyAction, type PadType } from '../input/bindings';
import { settings } from '../settings/Settings';
import type { WeaponController } from '../weapons/WeaponController';
import { pips, postureKey, postureLabel, weaponLabel, type Posture } from './hudText';
import { lensFrom, unbarrel, type LensUniforms } from './lens';

/** What the HUD reads from the running game (Game.bind wires it). */
export interface HudView {
  camera: PerspectiveCamera;
  /** The CAM04 post effect's uniforms (distortion, intensity) so overlays follow the warp. */
  lens: LensUniforms;
  posture: () => Posture | null;
  device: () => DeviceKind;
  padType: () => PadType;
}

export interface WorldPrompt {
  /** World point or object (its bounding-box centre) the prompt floats at, e.g. a door handle. */
  anchor: Object3D | Vector3;
  action: KeyAction;
  verb: string;
}

const TOAST_S = 1.6;

/**
 * Minimal, world-embedded HUD (no boxes, no panels):
 * - CAM04 burn-in (REC, unit, timestamp): diegetic camera OSD text, top-left.
 * - Ammo check: round count + spare-mag pips floating beside the actual magazine, projected each frame and
 *   corrected for the CAM04 barrel distortion; fades in ~120 ms, smoothed so it doesn't jitter with sway.
 * - Contextual corner toasts: weapon + fire mode (bottom-right), posture (bottom-left), only on change.
 * - World-space interaction prompts (glyph + verb) at the object.
 * Realism (`gameplay.realism`): Arcade keeps a tiny count near the mag + 2 px dot, Standard shows on hold,
 * Hardcore shows nothing but the burn-in.
 */
export class Hud {
  readonly root = document.createElement('div');
  private cam = document.createElement('div');
  private camR = document.createElement('div');
  private ts = document.createElement('span');
  private mag = document.createElement('div');
  private magCount = document.createElement('span');
  private magPlus = document.createElement('span');
  private magPips = document.createElement('span');
  private dot = document.createElement('div');
  private toastW = document.createElement('div');
  private toastP = document.createElement('div');
  /** Gear toast (NVG / IR / flashbang count), stacked above the weapon toast. */
  private toastG = document.createElement('div');
  private toastGUntil = 0;
  private promptEl = document.createElement('div');
  mode: 'arcade' | 'standard' | 'hardcore' = 'standard';
  overlay = true;
  prompt: WorldPrompt | null = null;
  private view: HudView | null = null;
  private lastSecond = -1;
  private last = performance.now();
  private magPos = { x: 0, y: 0, on: false };
  private promptPos = { x: 0, y: 0, on: false };
  private lastWeapon = '';
  private lastPosture = '';
  private toastWUntil = 0;
  private toastPUntil = 0;
  private now = 0;
  private box = new Box3();
  private v = new Vector3();
  private v2 = new Vector3();
  private hit = document.createElement('div');
  private pipsKey = '';

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';
    this.cam.className = 'osd osd-l';
    this.cam.innerHTML =
      '<span class="cam-mark" aria-hidden="true"></span>' +
      '<span class="cam-lines"><span><span class="rec">●</span> REC  CAM04 · UMBRA CO.</span>' +
      '<span class="cam-l2">UNIT 0412 · RANGE 01</span></span>';
    this.cam.querySelector('.cam-lines')!.append(this.ts);
    this.camR.className = 'osd osd-r';
    this.camR.innerHTML = 'SN 7F3A-0412<br>▮▮▮▯ 74%';
    this.mag.className = 'mag-tag';
    this.magCount.className = 'n';
    this.magPlus.className = 'plus';
    this.magPips.className = 'pips';
    const line = document.createElement('span');
    line.className = 'count';
    line.append(this.magCount, this.magPlus);
    this.mag.append(line, this.magPips);
    this.dot.className = 'dot';
    this.toastW.className = 'toast toast-r';
    this.toastP.className = 'toast toast-l';
    this.toastG.className = 'toast toast-r';
    this.toastG.style.bottom = '40px';
    this.promptEl.className = 'world-prompt';
    this.hit.className = 'hitmark';
    this.hit.innerHTML = '<i></i><i></i><i></i><i></i>';
    this.root.append(
      this.cam,
      this.camR,
      this.mag,
      this.dot,
      this.hit,
      this.toastW,
      this.toastP,
      this.toastG,
      this.promptEl,
    );
    // Hit confirmation: a brief, small four-tick marker at screen centre (off in Hardcore / via settings).
    const hm = settings.ns('gameplay.feedback', { hitMarker: true });
    bus.on('targetHit', (e) => {
      if (this.mode === 'hardcore' || !hm.get().hitMarker) return;
      this.hit.classList.toggle('bad', !!e.noShoot);
      this.hit.classList.remove('show');
      void this.hit.offsetWidth; // restart the CSS animation
      this.hit.classList.add('show');
    });
    parent.append(this.root);

    const gp = settings.ns('gameplay', { realism: 'standard' });
    const video = settings.ns('video', { overlay: true });
    const sync = () => {
      const r = gp.get().realism;
      this.mode = r === 'arcade' || r === 'hardcore' ? r : 'standard';
      this.overlay = video.get().overlay !== false;
    };
    gp.onChange(sync);
    video.onChange(sync);
    sync();
  }

  bind(view: HudView) {
    this.view = view;
  }

  /** Show/hide a world-space interaction prompt (Standard/Arcade). */
  setPrompt(p: WorldPrompt | null) {
    this.prompt = p;
  }

  /**
   * Project a world point to CSS pixels on the final (barrel-warped) frame. Returns false when behind the camera
   * or off-screen.
   */
  toScreen(world: Vector3, out: { x: number; y: number }): boolean {
    const view = this.view;
    if (!view) return false;
    const p = this.v.copy(world).project(view.camera);
    if (p.z > 1 || p.z < -1) return false;
    const w = innerWidth;
    const h = innerHeight;
    const lens = lensFrom(view.lens, w / h);
    const [u, v] = unbarrel(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, lens);
    out.x = u * w;
    out.y = (1 - v) * h;
    return u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05;
  }

  /** Keep a tag fully on screen (it sits to the right of its anchor). */
  private clampToView(p: { x: number; y: number }) {
    p.x = Math.min(innerWidth - 90, Math.max(24, p.x));
    p.y = Math.min(innerHeight - 40, Math.max(40, p.y));
  }

  private anchorPoint(a: Object3D | Vector3, out: Vector3): Vector3 {
    if (a instanceof Vector3) return out.copy(a);
    a.updateWorldMatrix(true, true);
    this.box.setFromObject(a);
    return this.box.isEmpty() ? a.getWorldPosition(out) : this.box.getCenter(out);
  }

  /** Critically-damped follow so the tag rides the mag without jittering with sway. */
  private follow(
    pos: { x: number; y: number; on: boolean },
    el: HTMLElement,
    target: { x: number; y: number } | null,
    dt: number,
  ) {
    if (!target) {
      pos.on = false;
      return;
    }
    if (!pos.on) {
      pos.x = target.x;
      pos.y = target.y;
    } else {
      const a = 1 - Math.exp(-dt / 0.045);
      pos.x += (target.x - pos.x) * a;
      pos.y += (target.y - pos.y) * a;
    }
    pos.on = true;
    el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
  }

  update(w: WeaponController) {
    const t = performance.now();
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.now += dt;
    const hard = this.mode === 'hardcore';

    // CAM04 burn-in.
    this.cam.classList.toggle('off', !this.overlay);
    this.camR.classList.toggle('off', !this.overlay);
    if (this.overlay) {
      const now = new Date();
      const sec = Math.floor(now.getTime() / 1000);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.ts.textContent = now.toISOString().replace('T', ' ').slice(0, 19);
      }
    }

    // Ammo at the magazine.
    const e = w.equipped;
    const m = e.mags;
    const showMag = !hard && (this.mode === 'arcade' || w.checking);
    this.mag.classList.toggle('arcade', this.mode === 'arcade' && !w.checking);
    // During a mag check the readout floats at the magazine itself (it leaves the well).
    const magObj =
      (w.checking ? e.mag?.obj : undefined) ??
      e.model.root.getObjectByName('magwell') ??
      e.model.root.getObjectByName('mag');
    let target: { x: number; y: number } | null = null;
    if (showMag && (!magObj || magObj.visible)) {
      const s = { x: 0, y: 0 };
      // The mag itself, else (mag still below/behind the chest cam) the weapon just ahead of the grip, so the
      // readout rides the gun and lands on the mag as soon as the check animation tilts it into frame.
      if (magObj && this.toScreen(this.anchorPoint(magObj, new Vector3()), s)) target = s;
      else if (this.toScreen(e.model.root.localToWorld(this.v2.set(0, -0.04, -0.3)), s)) target = s;
    }
    if (target) this.clampToView(target);
    this.follow(this.magPos, this.mag, target, dt);
    this.mag.classList.toggle('show', !!target);
    if (target) {
      this.magCount.textContent = String(m.inGun?.rounds ?? 0);
      this.magPlus.textContent = m.chambered ? '+1' : '';
      const p = pips(m.spares());
      const key = p.join(',');
      if (key !== this.pipsKey) {
        this.pipsKey = key;
        this.magPips.replaceChildren(
          ...p.map((k) => {
            const i = document.createElement('i');
            i.className = k;
            return i;
          }),
        );
      }
    }
    this.dot.classList.toggle('show', this.mode === 'arcade');

    // Contextual corner toasts.
    const wl = weaponLabel(e.def.name, e.mode);
    if (wl !== this.lastWeapon) {
      if (this.lastWeapon) this.toastWUntil = this.now + TOAST_S;
      this.lastWeapon = wl;
      this.toastW.textContent = wl;
    }
    const posture = this.view?.posture();
    if (posture) {
      const k = postureKey(posture);
      if (k !== this.lastPosture) {
        if (this.lastPosture) this.toastPUntil = this.now + TOAST_S;
        this.lastPosture = k;
        this.toastP.textContent = postureLabel(posture);
      }
    }
    this.toastW.classList.toggle('show', !hard && this.now < this.toastWUntil);
    this.toastP.classList.toggle('show', !hard && this.now < this.toastPUntil);
    this.toastG.classList.toggle('show', !hard && this.now < this.toastGUntil);

    // World-space prompt.
    let pt: { x: number; y: number } | null = null;
    if (this.prompt && !hard && this.view) {
      const s = { x: 0, y: 0 };
      if (this.toScreen(this.anchorPoint(this.prompt.anchor, new Vector3()), s)) pt = s;
      const g = glyphFor(this.prompt.action, this.view.device(), this.view.padType());
      const txt = `${g}|${this.prompt.verb}`;
      if (this.promptEl.dataset.txt !== txt) {
        this.promptEl.dataset.txt = txt;
        this.promptEl.innerHTML = '';
        const k = document.createElement('b');
        k.textContent = g;
        this.promptEl.append(k, document.createTextNode(this.prompt.verb));
      }
    }
    if (pt) this.clampToView(pt);
    this.follow(this.promptPos, this.promptEl, pt, dt);
    this.promptEl.classList.toggle('show', !!pt);
  }

  /** Gear status toast (NVG ▼, IR, flashbangs left). */
  toast(text: string) {
    this.toastG.textContent = text;
    this.toastGUntil = this.now + TOAST_S;
  }

  /** Force a corner toast now (e.g. drills announcing something). */
  flash(which: 'weapon' | 'posture') {
    if (which === 'weapon') this.toastWUntil = this.now + TOAST_S;
    else this.toastPUntil = this.now + TOAST_S;
  }
}
