import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Input } from '../input/Input';
import type { Physics } from '../physics/Physics';
import type { Bus } from './bus';

/** Shared services handed to every system. Keep this small. */
export interface Context {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  physics: Physics;
  input: Input;
  bus: Bus;
  /** Seconds since boot (render clock). */
  time: number;
  /** Fixed sim tick counter. */
  tick: number;
}

export interface System {
  /** Fixed 60 Hz simulation step. */
  fixedUpdate?(dt: number): void;
  /** Per render frame, after input poll. `alpha` = interpolation between last two fixed steps. */
  update?(dt: number, alpha: number): void;
}
