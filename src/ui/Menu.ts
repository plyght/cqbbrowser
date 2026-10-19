/** Plain, fast main menu (no tablet). Controller-navigable via focus. */
export class Menu {
  readonly root = document.createElement('div');
  onPlay: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="panel">
        <h1>SHORTBARREL</h1>
        <div class="sub">UMBRA CO. TRAINING FACILITY · CAM04</div>
        <button data-act="play" autofocus>▶ SQUARE RANGE — FREE PRACTICE</button>
        <button data-act="settings" disabled>SETTINGS (SOON)</button>
        <div class="hint">
          WASD move · mouse look · LMB fire · RMB aim · Q/E lean · Shift sprint · C crouch<br>
          R: tap reload · double-tap dump mag · hold ammo check · 1/2 switch · N fire mode · Backspace reset<br>
          Controller & trackpad supported.
        </div>
      </div>`;
    this.root.querySelector('[data-act=play]')!.addEventListener('click', () => this.onPlay());
    parent.append(this.root);
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (v) (this.root.querySelector('button') as HTMLButtonElement).focus();
  }
}
