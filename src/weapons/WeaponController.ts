import { Euler, Group, Quaternion, Vector3 } from 'three';
import type { Context, System } from '../core/Context';
import { Spring, clamp, damp, noise1, rng, wrapAngle } from '../core/math';
import { ReloadGesture } from '../input/ReloadGesture';
import type { Player } from '../player/Player';
import { WEAPONS, type FireMode, type WeaponDef } from './defs';
import { Magazines } from './Magazines';
import { buildModel, type WeaponModel } from './models';

export type ReloadState =
  | { kind: 'idle' }
  | {
      kind: 'reload';
      variant: 'tactical' | 'speed';
      t: number;
      duration: number;
      empty: boolean;
      swapped: boolean;
      stressed: boolean;
      beats: string[];
      beatIndex: number;
    }
  | { kind: 'check'; t: number };

interface Equipped {
  def: WeaponDef;
  mags: Magazines;
  model: WeaponModel;
  mode: FireMode;
}

/**
 * Owns the held weapon: pose (view leads, weapon follows), firing, recoil, reloads.
 * Weapon aim direction chases the torso aim point through springs — the core "body first, then gun" feel.
 */
export class WeaponController implements System {
  readonly view = new Group();
  equipped: Equipped;
  loadout: Equipped[];
  reload: ReloadState = { kind: 'idle' };
  gesture = new ReloadGesture();
  /** 0..1.5 master on weapon lag/inertia (settings "Weapon inertia"). */
  inertia = 1;
  /** Shown by the HUD while true. */
  checking = false;
  private cooldown = 0;
  private triggerHeld = false;
  private aimYaw = new Spring(9, 0.82);
  private aimPitch = new Spring(9, 0.82);
  private swayX = new Spring(5, 0.6);
  private swayY = new Spring(5, 0.6);
  private recoilPitch = new Spring(7, 0.75);
  private recoilYaw = new Spring(6, 0.7);
  private recoilRoll = new Spring(6, 0.6);
  private recoilBack = new Spring(14, 0.6);
  private ads = 0;
  private lowReady = 0;
  private tuck = 0;
  private fatigue = 0;
  private shotsInString = 0;
  private sinceShot = 10;
  private rand = rng(1337);
  private prevTorsoYaw = 0;
  private aimTarget = new Vector3();
  private tmpE = new Euler(0, 0, 0, 'YXZ');
  private tmpQ = new Quaternion();

  constructor(
    private ctx: Context,
    private player: Player,
    ids = ['sb16', 'p17'],
  ) {
    this.loadout = ids.map((id) => this.make(WEAPONS[id]));
    this.equipped = this.loadout[0];
    this.view.add(this.equipped.model.root);
    ctx.scene.add(this.view);
    this.aimYaw.reset(player.yaw);
    this.aimPitch.reset(player.pitch);
    this.prevTorsoYaw = player.yaw;
  }

  private make(def: WeaponDef): Equipped {
    return {
      def,
      mags: new Magazines(def.magCapacity, def.spareMags),
      model: buildModel(def.model),
      mode: def.modes[0],
    };
  }

  equip(i: number) {
    const next = this.loadout[i];
    if (!next || next === this.equipped) return;
    this.view.remove(this.equipped.model.root);
    this.equipped = next;
    this.view.add(next.model.root);
    this.reload = { kind: 'idle' };
  }

  /** Spring frequency from mass/length: heavier & longer = more lag. */
  private lagFreq(): number {
    const d = this.equipped.def;
    const base = 15 - d.mass * 1.6 - d.length * 4;
    const adsBoost = 1 + this.ads * 0.35;
    return clamp(base * adsBoost, 4, 18) / Math.max(0.15, this.inertia);
  }

  update(dt: number) {
    const f = this.ctx.input.frame;
    const p = this.player;
    const d = this.equipped.def;

    // Reload button gestures.
    for (const intent of this.gesture.update(f.down.has('reload'), dt)) this.onReloadIntent(intent);
    if (f.pressed.has('switchWeapon')) this.equip(this.loadout.indexOf(this.equipped) === 0 ? 1 : 0);
    if (f.pressed.has('fireMode')) {
      const modes = d.modes;
      this.equipped.mode = modes[(modes.indexOf(this.equipped.mode) + 1) % modes.length];
    }

    // ADS / ready blends.
    const busy = this.reload.kind === 'reload';
    const adsTarget = p.aiming && !busy ? 1 : 0;
    this.ads += (adsTarget - this.ads) * damp(0.06 + d.mass * 0.012, dt);
    const lowTarget = p.sprinting || p.ready === 'low' ? 1 : 0;
    this.lowReady += (lowTarget - this.lowReady) * damp(0.09, dt);

    // Aim point: where the camera centre ray lands (weapon converges on it).
    const cam = this.ctx.camera;
    const camDir = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.ctx.physics.raycast(cam.position, camDir, 60, p.rigidBody);
    this.aimTarget.copy(cam.position).addScaledVector(camDir, hit ? Math.max(hit.distance, 2) : 25);

    // Muzzle tuck: probe forward from the shoulder.
    const shoulder = this.shoulderPos();
    const fwd = new Vector3(0, 0, -1).applyQuaternion(p.torso.quaternion);
    const probe = this.ctx.physics.raycast(shoulder, fwd, d.length + 0.15, p.rigidBody);
    const tuckTarget = probe ? clamp(1 - (probe.distance - 0.1) / d.length, 0, 1) : 0;
    this.tuck += (tuckTarget - this.tuck) * damp(0.05, dt);

    // Desired weapon direction toward aim point.
    const to = this.aimTarget.clone().sub(shoulder);
    const wantYaw = Math.atan2(-to.x, -to.z);
    const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    const freq = this.lagFreq();
    this.aimYaw.freq = this.aimPitch.freq = freq;
    // Keep yaw spring continuous across the ±PI seam.
    this.aimYaw.value = wantYaw - wrapAngle(wantYaw - this.aimYaw.value);
    this.aimYaw.step(wantYaw, dt);
    this.aimPitch.step(wantPitch, dt);

    // Positional inertia sway: opposite turn rate & strafe.
    const yawRate = wrapAngle(p.yaw - this.prevTorsoYaw) / Math.max(dt, 1e-4);
    this.prevTorsoYaw = p.yaw;
    const sway = (1 - this.ads * 0.6) * this.inertia;
    this.swayX.step(clamp(yawRate * 0.004, -0.05, 0.05) * sway, dt);
    this.swayY.step(clamp((-f.look.pitch / Math.max(dt, 1e-4)) * 0.003, -0.04, 0.04) * sway, dt);

    // Recoil springs relax toward 0 (returns toward original point of aim).
    this.recoilPitch.step(0, dt);
    this.recoilYaw.step(0, dt);
    this.recoilRoll.step(0, dt);
    this.recoilBack.step(0, dt);

    // Breathing + stress hand shake + fatigue.
    const t = this.ctx.time;
    const shake = (0.0015 + p.stress * 0.006 + this.fatigue * 0.004) * (1 - this.ads * 0.5);
    const breathY = Math.sin(t * 1.5) * 0.004 * (1 - this.ads * 0.7);
    const nX = noise1(t * 6.1, 1) * shake;
    const nY = noise1(t * 5.3, 2) * shake;
    this.fatigue = clamp(this.fatigue - dt * 0.12, 0, 1);
    this.sinceShot += dt;
    if (this.sinceShot > 0.6) this.shotsInString = 0;

    this.pose(shoulder, nX, nY + breathY, dt);
    this.updateReload(dt);
    this.updateFire(dt, f.down.has('fire'));
  }

  private shoulderPos(): Vector3 {
    const p = this.player;
    // Right shoulder, above chest cam; ADS brings it to centreline / cheek weld.
    const local = new Vector3(0.17 - this.ads * 0.15, 0.12 + this.ads * 0.06, -0.05);
    return local.applyMatrix4(p.torso.matrixWorld);
  }

  private pose(shoulder: Vector3, nX: number, nY: number, _dt: number) {
    const d = this.equipped.def;
    const r = this.reload;
    let reloadTilt = 0,
      reloadDrop = 0;
    if (r.kind === 'reload') {
      const k = Math.sin(Math.PI * clamp(r.t / r.duration, 0, 1));
      reloadTilt = k * 0.55;
      reloadDrop = k * 0.09;
    } else if (r.kind === 'check') {
      const k = clamp(r.t / 0.25, 0, 1);
      reloadTilt = k * 0.7;
      reloadDrop = k * 0.06;
    }
    const low = this.lowReady * 0.45 + this.tuck * 0.5 + (this.player.ready === 'compressed' ? 0.15 : 0);
    this.tmpE.set(
      this.aimPitch.value + this.recoilPitch.value + nY - low + this.swayY.value,
      this.aimYaw.value + this.recoilYaw.value + nX + this.swayX.value,
      this.recoilRoll.value - reloadTilt - this.player.lean * 0.25,
    );
    this.tmpQ.setFromEuler(this.tmpE);
    this.view.quaternion.copy(this.tmpQ);
    // Stock at shoulder; pull back on recoil and tuck.
    const back = this.recoilBack.value * 0.04 + this.tuck * 0.18 * d.length;
    const offset = new Vector3(0, -d.sightHeight * 0.5 - reloadDrop, back + 0.05).applyQuaternion(this.tmpQ);
    this.view.position.copy(shoulder).add(offset);
    this.view.updateMatrixWorld();
  }

  muzzleWorld(): { origin: Vector3; dir: Vector3 } {
    const m = this.equipped.model;
    const origin = new Vector3(0, 0.03, m.muzzleZ).applyMatrix4(this.view.matrixWorld);
    const dir = new Vector3(0, 0, -1).applyQuaternion(this.view.quaternion).normalize();
    return { origin, dir };
  }

  private updateFire(dt: number, down: boolean) {
    this.cooldown -= dt;
    const e = this.equipped;
    const canFire = this.reload.kind === 'idle' && this.lowReady < 0.5 && this.tuck < 0.6;
    const pressed = down && !this.triggerHeld;
    this.triggerHeld = down;
    if (!down || !canFire || this.cooldown > 0) return;
    if (e.mode === 'semi' && !pressed) return;
    if (!e.mags.fire()) {
      if (pressed) this.ctx.bus.emit('dryFire', { weaponId: e.def.id });
      return;
    }
    this.cooldown = 60 / e.def.rpm;
    this.shoot();
  }

  private shoot() {
    const e = this.equipped;
    const d = e.def;
    const { origin, dir } = this.muzzleWorld();
    this.ctx.bus.emit('shot', {
      weaponId: d.id,
      origin,
      dir,
      suppressed: !!d.suppressed,
      caliber: d.caliber,
    });
    // Recoil: string-dependent climb with random wander; stability from mass.
    this.shotsInString++;
    this.sinceShot = 0;
    this.fatigue = clamp(this.fatigue + 0.015, 0, 1);
    const stab = 1 / (0.6 + d.mass * 0.25);
    const r = d.recoil;
    const ramp = 1 + Math.min(this.shotsInString, 8) * 0.06;
    this.recoilPitch.impulse(r.up * 0.9 * stab * ramp * (1 - this.ads * 0.25));
    this.recoilYaw.impulse((this.rand() - 0.5) * r.side * 0.9 * stab);
    this.recoilRoll.impulse((this.rand() - 0.4) * r.roll * 1.2 * stab);
    this.recoilBack.impulse(r.back * 3);
    this.player.kick(-r.up * 0.12 * stab, (this.rand() - 0.5) * 0.05, (this.rand() - 0.5) * 0.08);
    this.ctx.input.haptics.rumble(0.35 * r.back, 0.6, 70);
  }

  private onReloadIntent(intent: string) {
    const e = this.equipped;
    if (intent === 'checkStart' && this.reload.kind === 'idle') {
      this.reload = { kind: 'check', t: 0 };
      this.checking = true;
      this.ctx.bus.emit('weaponBeat', { weaponId: e.def.id, beat: 'magCheck', stressed: false });
    } else if (intent === 'checkEnd') {
      if (this.reload.kind === 'check') this.reload = { kind: 'idle' };
      this.checking = false;
    } else if (intent === 'tactical') {
      this.startReload('tactical');
    } else if (intent === 'speedUpgrade') {
      const r = this.reload;
      // Branch into a dump if still before the mag is stowed.
      if (r.kind === 'reload' && !r.swapped) {
        r.variant = 'speed';
        r.duration = Math.min(r.duration, this.reloadDuration('speed', r.empty, r.stressed));
      } else if (r.kind === 'idle') this.startReload('speed');
    }
  }

  private reloadDuration(variant: 'tactical' | 'speed', empty: boolean, stressed: boolean) {
    const rt = this.equipped.def.reloadTimes;
    const base = variant === 'tactical' ? rt.tactical : rt.speed;
    const jitter = 0.92 + this.rand() * 0.16;
    return (base + (empty ? rt.emptyExtra : 0)) * (stressed ? 0.86 : 1) * jitter;
  }

  private startReload(variant: 'tactical' | 'speed') {
    const e = this.equipped;
    if (this.reload.kind === 'reload' || !e.mags.hasSpare()) return;
    if (e.mags.inGun && e.mags.inGun.rounds >= e.mags.capacity) return;
    const empty = e.mags.empty;
    const stressed = this.player.stress > 0.45;
    const beats = ['magRelease', 'magOut', 'magIn', 'magSeat', ...(empty ? ['boltRelease'] : [])];
    this.reload = {
      kind: 'reload',
      variant: empty ? 'speed' : variant,
      t: 0,
      duration: this.reloadDuration(empty ? 'speed' : variant, empty, stressed),
      empty,
      swapped: false,
      stressed,
      beats,
      beatIndex: 0,
    };
  }

  private updateReload(dt: number) {
    const r = this.reload;
    if (r.kind === 'check') {
      r.t += dt;
      return;
    }
    if (r.kind !== 'reload') return;
    r.t += dt;
    const e = this.equipped;
    const frac = r.t / r.duration;
    const beatAt = [0.05, 0.22, 0.6, 0.75, 0.9];
    while (r.beatIndex < r.beats.length && frac >= beatAt[r.beatIndex]) {
      const beat = r.beats[r.beatIndex++];
      this.ctx.bus.emit('weaponBeat', { weaponId: e.def.id, beat, stressed: r.stressed });
      if (beat === 'magOut') {
        r.swapped = true;
        const dropped = e.mags.swap(r.variant === 'tactical');
        if (dropped) {
          const p = this.player.position.clone();
          this.ctx.bus.emit('magDrop', { point: p, surface: this.player.surfaceUnderfoot, polymer: true });
        }
      }
      if (beat === 'boltRelease') e.mags.chamber();
    }
    // Animate mag part out/in.
    const mag = e.model.root.getObjectByName('mag');
    if (mag) {
      const out = frac > 0.2 && frac < 0.65 ? 1 : 0;
      mag.position.y += (-out * 0.25 - mag.position.y) * damp(0.04, dt);
      mag.visible = !(frac > 0.3 && frac < 0.5);
    }
    if (r.t >= r.duration) {
      if (e.mags.empty) e.mags.chamber();
      if (mag) {
        mag.position.y = 0;
        mag.visible = true;
      }
      this.reload = { kind: 'idle' };
    }
  }
}
