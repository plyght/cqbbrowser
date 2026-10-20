import { expect, test } from 'bun:test';
import { Physics, RAPIER } from './Physics';

/**
 * Regression: the world ground used to be one 1 km cuboid, and the character controller lost contact with
 * it (f32 precision): walking off the range pad the player sank ~1.7 cm per step and got stuck in the dirt.
 */
test('character controller walks on the tiled ground without sinking', async () => {
  const physics = new Physics();
  await physics.init();
  physics.ground(0, 500, { surface: 'dirt' });
  physics.world.step();
  const w = physics.world;
  // Same capsule + controller setup as Player.
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(6, 0.9, 4));
  const col = w.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3), body);
  const kcc = w.createCharacterController(0.02);
  kcc.enableAutostep(0.35, 0.2, true);
  kcc.enableSnapToGround(0.3);
  kcc.setSlideEnabled(true);
  const dt = 1 / 60;
  let minBottom = Infinity;
  for (let i = 0; i < 300; i++) {
    kcc.computeColliderMovement(col, { x: 0.3 * dt, y: -dt, z: -2.2 * dt });
    const m = kcc.computedMovement();
    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    w.step();
    minBottom = Math.min(minBottom, body.translation().y - 0.85);
  }
  const t = body.translation();
  expect(minBottom).toBeGreaterThan(-0.005);
  // Crossed tile seams (z = 0, x = 0 lines every 100 m from -500) and kept walking.
  expect(4 - t.z).toBeGreaterThan(10);
});
