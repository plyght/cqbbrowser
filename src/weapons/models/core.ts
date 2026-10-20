import { Group, Object3D, Vector3, type Material } from 'three';
import type { Layout, ResolvedBuild } from '../attachments/build';
import { BORE_Y } from '../attachments/catalog';
import type { FinishPart } from '../attachments/types';
import { Collector, type P3 } from './geom';
import { weaponMaterials, type WeaponMaterials } from './materials';

/** Animated/addressable parts. Pivots sit where the part rotates/slides from. */
export type PartName =
  | 'mag'
  | 'bolt'
  | 'chargingHandle'
  | 'slide'
  | 'trigger'
  | 'magRelease'
  | 'boltCatch'
  | 'safety'
  | 'stock'
  | 'magnifier'
  | 'dustCover'
  | 'hammer';

export type SocketName =
  | 'muzzle'
  | 'optic'
  | 'offsetOptic'
  | 'underRail'
  | 'sideRail'
  | 'stock'
  | 'gripRight'
  | 'gripLeft'
  | 'magwell'
  | 'chargingHandle'
  | 'ejectionPort'
  | 'light';

export interface BuildOptions {
  /**
   * Give tiny controls (trigger, safety, mag release, bolt catch) their own meshes so they can move.
   * Off by default: they merge into the static mesh (fewer draw calls) and `parts` holds an empty pivot.
   */
  detailParts?: boolean;
}

const SMALL: PartName[] = ['trigger', 'safety', 'magRelease', 'boltCatch', 'dustCover'];

/** Shared state while one weapon is being built. */
export class Ctx {
  readonly M: WeaponMaterials = weaponMaterials();
  readonly s = new Collector();
  readonly B = BORE_Y;
  /** Receiver/handguard finish material. */
  readonly fin: Material;
  /** Outer radius of the handguard around the bore (for light/foregrip mounting). */
  hgRadius = 0.0215;
  /** Handguard style for accessory placement. */
  hgStyle = 'mlok';
  private partCols = new Map<PartName, { col: Collector; pivot: Vector3; parent?: PartName }>();
  readonly pivots = new Map<PartName, Vector3>();
  readonly sockets = new Map<SocketName, { pos: Vector3; rot?: P3; parent?: PartName }>();

  constructor(
    readonly r: ResolvedBuild,
    readonly l: Layout,
    readonly opts: BuildOptions = {},
  ) {
    const f = (r.parts.finish as FinishPart | undefined)?.finish ?? 'black';
    this.fin = this.M.finish[f];
  }

  /** Collector for an animated part; geometry is added in model coords, re-centred on `pivot`. */
  part(name: PartName, pivot: P3, parent?: PartName): Collector {
    if (SMALL.includes(name) && !this.opts.detailParts) {
      this.pivots.set(name, new Vector3(...pivot));
      return this.s;
    }
    let p = this.partCols.get(name);
    if (!p) {
      p = { col: new Collector(), pivot: new Vector3(...pivot), parent };
      this.partCols.set(name, p);
      this.pivots.set(name, p.pivot);
    }
    return p.col;
  }

  /** Register a pivot-only part (no geometry), e.g. an internal bolt. */
  pivot(name: PartName, pivot: P3) {
    if (!this.pivots.has(name)) this.pivots.set(name, new Vector3(...pivot));
  }

  socket(name: SocketName, pos: P3, rot?: P3, parent?: PartName) {
    this.sockets.set(name, { pos: new Vector3(...pos), rot, parent });
  }

  /** Build the final scene graph: one mesh per material for static geometry, one per material per part. */
  finish(root: Group): Map<PartName, Object3D> {
    for (const m of this.s.meshes()) root.add(m);
    const objs = new Map<PartName, Object3D>();
    for (const [name, pivot] of this.pivots) {
      const g = new Group();
      g.name = name;
      g.position.copy(pivot);
      objs.set(name, g);
    }
    for (const [name, p] of this.partCols) {
      const g = objs.get(name)!;
      for (const m of p.col.meshes(p.pivot)) g.add(m);
    }
    for (const [name, p] of this.partCols) {
      const g = objs.get(name)!;
      const parent = p.parent ? objs.get(p.parent) : undefined;
      if (parent) {
        g.position.sub(parent.position);
        parent.add(g);
      } else root.add(g);
    }
    for (const g of objs.values()) if (!g.parent) root.add(g);
    return objs;
  }
}
