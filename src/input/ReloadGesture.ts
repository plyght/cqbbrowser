/**
 * Single reload button → tap (tactical), double-tap (speed/dump), hold (ammo check).
 * Tactical starts on first release; a second press inside the window upgrades it to a dump.
 */
export type ReloadIntent = 'tactical' | 'speedUpgrade' | 'checkStart' | 'checkEnd';

export class ReloadGesture {
  holdThreshold = 0.22;
  doubleWindow = 0.3;
  private downTime = -1;
  private sinceRelease = Infinity;
  private checking = false;

  update(down: boolean, dt: number): ReloadIntent[] {
    const out: ReloadIntent[] = [];
    this.sinceRelease += dt;
    if (down) {
      if (this.downTime < 0) {
        this.downTime = 0;
        if (this.sinceRelease <= this.doubleWindow) {
          out.push('speedUpgrade');
          this.sinceRelease = Infinity;
          this.downTime = -2; // consumed; ignore until release
        }
      } else if (this.downTime >= 0) {
        this.downTime += dt;
        if (!this.checking && this.downTime >= this.holdThreshold) {
          this.checking = true;
          out.push('checkStart');
        }
      }
    } else if (this.downTime !== -1) {
      if (this.checking) {
        out.push('checkEnd');
        this.checking = false;
      } else if (this.downTime >= 0) {
        out.push('tactical');
        this.sinceRelease = 0;
      }
      this.downTime = -1;
    }
    return out;
  }
}
