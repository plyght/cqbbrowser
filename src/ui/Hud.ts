import type { WeaponController } from '../weapons/WeaponController';

/** Minimal HUD: CAM04 burn-in overlay + ammo check readout on hold (Ready or Not–style). */
export class Hud {
  readonly root = document.createElement('div');
  private cam = document.createElement('div');
  private camR = document.createElement('div');
  private ammo = document.createElement('div');
  private dot = document.createElement('div');
  mode: 'arcade' | 'standard' | 'hardcore' = 'standard';
  overlay = true;

  constructor(parent: HTMLElement) {
    this.cam.className = 'overlay-cam';
    this.camR.className = 'overlay-cam right';
    this.ammo.className = 'ammo';
    this.dot.className = 'dot';
    this.root.append(this.cam, this.camR, this.ammo, this.dot);
    parent.append(this.root);
  }

  update(w: WeaponController) {
    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').slice(0, 19);
    this.cam.innerHTML = this.overlay
      ? `<span class="rec">● REC</span> CAM04 · UMBRA CO. · UNIT 0412<br>${ts}`
      : '';
    this.camR.innerHTML = this.overlay ? `SN 7F3A-0412<br>▮▮▮▯ 74%` : '';
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
