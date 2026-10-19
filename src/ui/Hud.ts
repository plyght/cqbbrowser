import { settings } from '../settings/Settings';
import type { WeaponController } from '../weapons/WeaponController';

/**
 * Minimal HUD: CAM04 burn-in overlay (UMBRA CO. mark, unit, timestamp) + ammo-check readout on hold
 * (Ready or Not–style). Follows `gameplay.realism` (Arcade: counter + dot, Standard: on hold, Hardcore: none)
 * and `video.overlay`.
 */
export class Hud {
  readonly root = document.createElement('div');
  private cam = document.createElement('div');
  private camR = document.createElement('div');
  private ts = document.createElement('span');
  private ammo = document.createElement('div');
  private dot = document.createElement('div');
  mode: 'arcade' | 'standard' | 'hardcore' = 'standard';
  overlay = true;
  private lastSecond = -1;

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';
    this.cam.className = 'overlay-cam';
    this.cam.innerHTML =
      '<span class="cam-mark" aria-hidden="true"></span>' +
      '<span class="cam-lines"><span class="cam-l1"><span class="rec">● REC</span> CAM04 · UMBRA CO.</span>' +
      '<span class="cam-l2">UNIT 0412 · RANGE 01</span></span>';
    this.cam.querySelector('.cam-l2')!.after(this.ts);
    this.ts.className = 'cam-ts';
    this.camR.className = 'overlay-cam right';
    this.camR.innerHTML = 'SN 7F3A-0412<br>▮▮▮▯ 74%';
    this.ammo.className = 'ammo';
    this.dot.className = 'dot';
    this.root.append(this.cam, this.camR, this.ammo, this.dot);
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

  update(w: WeaponController) {
    this.cam.classList.toggle('off', !this.overlay);
    this.camR.classList.toggle('off', !this.overlay);
    if (this.overlay) {
      const now = new Date();
      const sec = Math.floor(now.getTime() / 1000);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.ts.textContent = now.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
      }
    }
    const show = this.mode === 'arcade' || (this.mode === 'standard' && w.checking);
    this.ammo.classList.toggle('show', show);
    this.dot.classList.toggle('show', this.mode === 'arcade');
    if (show) {
      const e = w.equipped;
      const m = e.mags;
      const inGun = m.inGun?.rounds ?? 0;
      const bars = (n: number, cap: number, len = 10) => {
        const f = Math.round((n / cap) * len);
        return '▮'.repeat(f) + '▯'.repeat(len - f);
      };
      const spares = m.spares();
      const spareStr = spares
        .map((s) => (s.rounds === s.capacity ? '███' : s.rounds > s.capacity / 2 ? '██▌' : '█▏ '))
        .join(' ');
      const full = spares.filter((s) => s.rounds === s.capacity).length;
      this.ammo.textContent =
        `${e.def.name.split(' ')[0].padEnd(7)} ${bars(inGun, m.capacity)}  ${String(inGun).padStart(2)} / ${m.capacity}${m.chambered ? '  +1' : ''}  ${e.mode.toUpperCase()}\n` +
        `MAGS    ${spareStr || '—'}   (${full} full · ${spares.length - full} partial)`;
    }
  }
}
