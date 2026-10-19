import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Vector3,
  type Scene,
} from 'three';

/**
 * Weapon-mounted IR aiming laser + illuminator (PEQ-style). 850 nm: invisible to the eye and the CAM04 (it has
 * an IR-cut filter), bright through the NVG — so everything here only renders while the tube is powered.
 * Beam: a ~1.6 px additive screen-space ribbon from the emitter to the first hit, brighter near the source and where it
 * scatters off dust; dot: a small hot sprite at the hit (blooms in the tube). Flood: an unshadowed spot.
 */
export class IrDevice {
  readonly beam: Mesh;
  readonly dot: Mesh;
  readonly flood = new SpotLight(0xffffff, 0, 45, 0.5, 0.9, 2);
  private floodTarget = new Object3D();
  private beamMat: ShaderMaterial;
  private q = new Vector3();
  private tmp = new Vector3();

  /** Ribbon width in pixels for the current drawing-buffer height. */
  setViewportHeight(px: number) {
    this.beamMat.uniforms.uPx.value = (2 * 1.6) / Math.max(1, px);
  }

  constructor(scene: Scene) {
    // Screen-space ribbon: (t along the beam, side) per vertex; the vertex shader keeps it ~1.6 px wide.
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3),
    );
    g.setIndex([0, 2, 1, 1, 2, 3]);
    this.beamMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uA: { value: new Vector3() },
        uB: { value: new Vector3() },
        uPx: { value: 1.6 / 720 },
        uGain: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uA;
        uniform vec3 uB;
        uniform float uPx;
        varying float vD;
        varying float vS;
        void main() {
          vec4 a = projectionMatrix * viewMatrix * vec4(uA, 1.0);
          vec4 b = projectionMatrix * viewMatrix * vec4(uB, 1.0);
          // Clip the near end in front of the camera so the ribbon stays well defined.
          if (a.w < 0.05) a = mix(a, b, (0.05 - a.w) / max(b.w - a.w, 1e-4));
          vec4 c = mix(a, b, position.x);
          vec2 sa = a.xy / a.w, sb = b.xy / b.w;
          float asp = projectionMatrix[1][1] / projectionMatrix[0][0];
          vec2 dir = normalize((sb - sa) * vec2(asp, 1.0) + 1e-6);
          vec2 n = vec2(-dir.y, dir.x) / vec2(asp, 1.0);
          c.xy += n * position.y * uPx * c.w;
          vD = position.x * distance(uA, uB);
          vS = position.y;
          gl_Position = c;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uGain;
        varying float vD;
        varying float vS;
        void main() {
          // Forward scatter: hot at the emitter, a long faint tail; slight shimmer from dust.
          float a = 0.6 / (1.0 + vD * 0.6) + 0.14;
          a *= 0.85 + 0.15 * sin(vD * 23.0);
          a *= 1.0 - abs(vS);
          gl_FragColor = vec4(vec3(a * uGain), 1.0);
        }`,
    });
    this.beam = new Mesh(g, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 6;
    this.dot = new Mesh(
      new SphereGeometry(0.012, 8, 6),
      new MeshBasicMaterial({
        color: 0xffffff,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    (this.dot.material as MeshBasicMaterial).color.setScalar(9);
    this.flood.target = this.floodTarget;
    this.flood.castShadow = false;
    this.beam.visible = this.dot.visible = false;
    scene.add(this.beam, this.dot, this.flood, this.floodTarget);
  }

  /**
   * @param on IR switch on and the NVG powered (so it's visible at all)
   * @param flood include the illuminator
   * @param origin emitter position, dir aim direction, hit = first surface (null = sky)
   */
  update(on: boolean, flood: boolean, origin: Vector3, dir: Vector3, hit: Vector3 | null, power: number) {
    this.beam.visible = on;
    this.dot.visible = on && !!hit;
    this.flood.intensity = on && flood ? 4 * power : 0;
    if (!on) return;
    this.q.copy(dir).normalize();
    const u = this.beamMat.uniforms;
    (u.uA.value as Vector3).copy(origin);
    (u.uB.value as Vector3).copy(hit ?? this.tmp.copy(origin).addScaledVector(this.q, 80));
    u.uGain.value = power;
    if (hit) this.dot.position.copy(hit).addScaledVector(this.q, -0.01);
    // Illuminator head sits ahead of the muzzle so it doesn't light the gun itself.
    this.flood.position.copy(origin).addScaledVector(this.q, 0.12);
    this.floodTarget.position.copy(origin).addScaledVector(this.q, 8);
    this.floodTarget.updateMatrixWorld();
  }
}
