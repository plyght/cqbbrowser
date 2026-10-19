import './loadout.css';
import { Turntable } from '../../bench/Turntable';
import {
  ammoOptions,
  bar,
  buildStats,
  CARRIERS,
  deltaSign,
  fitGear,
  fmtDelta,
  kitStats,
  loadouts,
  MAX_FLASHBANGS,
  randomBuild,
  slotOptions,
  STATS,
  stockOf,
  weaponsFor,
  type CarrierId,
  type Loadout,
  type LoadoutSlot,
  type LoadoutStore,
  type StatValues,
} from '../../loadout';
import { cartridge } from '../../weapons/ammo';
import {
  applyBuild,
  defaultBuild,
  PART_BY_ID,
  PLATFORMS,
  PRESETS,
  resolveBuild,
  type LightPart,
  type SlotId,
  type WeaponBuild,
} from '../../weapons/attachments';
import { BASE_WEAPONS } from '../../weapons/defs';
import { h, hints, navButton, padGlyph } from '../dom';
import type { FocusNav, Screen } from '../FocusNav';

type Tab = LoadoutSlot | 'gear';
const TABS: [Tab, string][] = [
  ['primary', 'Primary'],
  ['sidearm', 'Sidearm'],
  ['gear', 'Gear'],
];

export const SLOT_LABEL: Record<SlotId, string> = {
  finish: 'Finish',
  barrel: 'Barrel',
  barrelProfile: 'Profile',
  muzzle: 'Muzzle',
  handguard: 'Handguard',
  mount: 'Optic mount',
  slide: 'Slide',
  stock: 'Stock',
  grip: 'Grip',
  foregrip: 'Foregrip',
  optic: 'Optic',
  magnifier: 'Magnifier',
  offsetOptic: 'Offset dot',
  buis: 'BUIS',
  light: 'Light',
  laser: 'Laser',
  magazine: 'Magazine',
  sling: 'Sling',
};

/** One option in a slot's list. */
interface Opt {
  key: string;
  name: string;
  sub?: string;
  ok: boolean;
  reason?: string;
  current: boolean;
  /** Build to preview (stats + model) while focused. */
  preview?: WeaponBuild | null;
  apply(): void;
}

/** One row in the right-hand column. */
interface Row {
  key: string;
  label: string;
  value: string;
  /** list: opens options; step: ◂ ▸ adjusts; toggle: flips. */
  kind: 'list' | 'step' | 'toggle';
  options?: () => Opt[];
  step?: (dir: -1 | 1) => void;
  note?: string;
  group?: string;
}

export interface LoadoutScreenDeps {
  nav: FocusNav;
  back(): void;
  /** Equip and drop into free practice. */
  tryIt(): void;
  store?: LoadoutStore;
}

const cleanReason = (name: string, r: string) => {
  const s = r.startsWith(name + ': ') ? r.slice(name.length + 2) : r;
  return s[0].toUpperCase() + s.slice(1);
};
const kg = (v: number) => `${v.toFixed(2)} kg`;
const partName = (id: string | undefined) => (id ? (PART_BY_ID[id]?.name ?? id) : '—');

/**
 * Loadout screen (PRD §11): saved loadouts (left), live 3D turntable + stats with deltas (centre), slot list
 * with dependency reasons (right). Edits save immediately; Equip makes the selected loadout the one every
 * drill and free practice spawns with. Controller: ✚ move · A select · B back · LB/RB tab · Y randomize ·
 * Start equip.
 */
export class LoadoutScreen implements Screen {
  readonly root = h('section', { class: 'screen loadout', 'data-id': 'loadout' });
  readonly store: LoadoutStore;
  readonly turntable: Turntable;
  selectedId: string;
  tabId: Tab = 'primary';
  /** Row whose options are open (null = slot list). */
  openRow: string | null = null;
  private title = h('h2');
  private badge = h('span', { class: 'lo-badge' });
  private tabBar = h('nav', { class: 'tabs lo-tabs' });
  private list = h('div', { class: 'lo-list' });
  private actions = h('div', { class: 'lo-actions' });
  private canvas = h('canvas', { class: 'lo-canvas' });
  private stageCap = h('div', { class: 'lo-cap' });
  private stats = h('div', { class: 'lo-stats' });
  private side = h('div', { class: 'lo-side' });
  private sideHead = h('div', { class: 'lo-side-head' });
  private equipBtn: HTMLButtonElement;
  private confirmDelete = 0;
  private renaming = false;
  private previewTimer = 0;
  private padRaf = 0;
  private prevY = false;

  constructor(private deps: LoadoutScreenDeps) {
    this.store = deps.store ?? loadouts();
    this.selectedId = this.store.activeId;
    this.turntable = new Turntable(this.canvas);
    this.equipBtn = navButton('Equip', () => this.equip(), { class: 'ghost primary', 'data-key': 'equip' });
    this.root.append(
      h(
        'header',
        { class: 'screen-head lo-head' },
        h(
          'div',
          {},
          h('div', { class: 'eyebrow', text: 'Loadout' }),
          h('div', { class: 'lo-title' }, this.title, this.badge),
        ),
        this.tabBar,
      ),
      h(
        'div',
        { class: 'lo-cols' },
        h(
          'div',
          { class: 'lo-left' },
          h('div', { class: 'lo-colhead', text: 'Saved' }),
          this.list,
          this.actions,
        ),
        h(
          'div',
          { class: 'lo-centre' },
          h('div', { class: 'lo-stage' }, this.canvas, this.stageCap),
          this.stats,
        ),
        h('div', { class: 'lo-right' }, this.sideHead, this.side),
      ),
      h(
        'footer',
        { class: 'screen-foot' },
        navButton('Back', () => this.back(), { class: 'ghost', 'data-key': 'back' }),
        navButton('Try in range', () => this.tryIt(), { class: 'ghost', 'data-key': 'try' }),
        this.equipBtn,
        hints([
          { key: 'Enter', pad: [0], label: 'Select' },
          { key: 'Q/E', pad: [4, 5], label: 'Weapon' },
          { key: 'R', pad: [3], label: 'Randomize' },
          { key: 'F', pad: [9], label: 'Equip' },
          { key: 'Esc', pad: [1], label: 'Back' },
        ]),
      ),
    );
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.visible || this.renaming || e.repeat) return;
      if (e.code === 'KeyR') this.randomize();
      else if (e.code === 'KeyF') this.equip();
    });
    this.store.onChange(() => {
      if (!this.store.get(this.selectedId)) this.selectedId = this.store.activeId;
    });
  }

  get visible() {
    return this.root.isConnected && this.root.offsetParent !== null;
  }

  get loadout(): Loadout {
    return this.store.get(this.selectedId) ?? this.store.active();
  }

  // ------------------------------------------------------------------ Screen

  enter() {
    if (!this.store.get(this.selectedId)) this.selectedId = this.store.activeId;
    this.openRow = null;
    this.render();
    // Start after the menu un-hides the root (same frame).
    requestAnimationFrame(() => this.turntable.start());
    cancelAnimationFrame(this.padRaf);
    this.prevY = true;
    this.padRaf = requestAnimationFrame(this.pollPad);
  }

  initialFocus() {
    return this.side.querySelector<HTMLElement>('[data-nav]');
  }

  back() {
    if (this.renaming) return;
    if (this.openRow) {
      const row = this.openRow;
      this.closeOptions();
      this.focusKey(`row:${row}`);
      return;
    }
    this.turntable.stop();
    this.deps.back();
  }

  tab(dir: -1 | 1) {
    const i = TABS.findIndex(([t]) => t === this.tabId);
    this.setTab(TABS[(i + dir + TABS.length) % TABS.length][0]);
  }

  start() {
    this.equip();
  }

  // ------------------------------------------------------------------ actions

  setTab(t: Tab) {
    this.tabId = t;
    this.openRow = null;
    this.render();
    this.initialFocus()?.focus({ preventScroll: true });
  }

  select(id: string) {
    if (!this.store.get(id)) return;
    this.selectedId = id;
    this.openRow = null;
    this.render();
  }

  equip() {
    this.store.setActive(this.selectedId);
    this.render();
    this.equipBtn.classList.add('flash');
    setTimeout(() => this.equipBtn.classList.remove('flash'), 500);
  }

  tryIt() {
    this.store.setActive(this.selectedId);
    this.turntable.stop();
    this.deps.tryIt();
  }

  /** Random valid build for the current weapon tab (Y / R). */
  randomize(seed?: number) {
    const t = this.tabId === 'gear' ? 'primary' : this.tabId;
    const cur = this.loadout[t];
    const w = cur?.weapon ?? weaponsFor(t)[0];
    this.edit((l) => (l[t] = randomBuild(w, seed)));
  }

  openOptions(rowKey: string) {
    this.openRow = rowKey;
    this.render();
    const cur =
      this.side.querySelector<HTMLElement>('[data-current]') ?? this.side.querySelector('[data-opt]');
    (cur as HTMLElement | null)?.focus({ preventScroll: true });
    (cur as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }

  closeOptions() {
    this.openRow = null;
    clearTimeout(this.previewTimer);
    this.render();
  }

  /** Mutate a copy of the selected loadout and save it. */
  private edit(fn: (l: Loadout) => void) {
    const l = structuredClone(this.loadout);
    fn(l);
    l.gear = fitGear(l.gear);
    this.store.update(l.id, l);
    this.render();
  }

  private editBuild(slot: LoadoutSlot, fn: (b: WeaponBuild) => WeaponBuild | void) {
    this.edit((l) => {
      const b = l[slot];
      if (!b) return;
      l[slot] = fn(b) ?? b;
    });
  }

  // ------------------------------------------------------------------ rows

  private weaponRows(slot: LoadoutSlot): Row[] {
    const l = this.loadout;
    const b = l[slot];
    const other = slot === 'primary' ? l.sidearm : l.primary;
    const rows: Row[] = [
      {
        key: 'weapon',
        label: 'Weapon',
        value: b ? `${PLATFORMS[b.weapon].name} · ${PLATFORMS[b.weapon].caliber}` : 'None',
        kind: 'list',
        group: 'Platform',
        options: () => [
          ...weaponsFor(slot).map((w) => ({
            key: w,
            name: PLATFORMS[w].name,
            sub: BASE_WEAPONS[w].name.replace(/^[^(]*\(?/, '').replace(/\)$/, '') || PLATFORMS[w].caliber,
            ok: true,
            current: b?.weapon === w,
            preview: b?.weapon === w ? b : defaultBuild(w),
            apply: () => this.edit((x) => (x[slot] = b?.weapon === w ? b : defaultBuild(w))),
          })),
          {
            key: 'none',
            name: 'None',
            sub: slot === 'primary' ? 'Pistol only' : 'No sidearm',
            ok: !!other,
            reason: other ? undefined : 'a loadout needs at least one weapon',
            current: !b,
            preview: null,
            apply: () => this.edit((x) => (x[slot] = null)),
          },
        ],
      },
    ];
    if (!b) return rows;
    rows.push({
      key: 'preset',
      label: 'Preset',
      value: b.name ?? 'Custom',
      kind: 'list',
      options: () => [
        {
          key: 'factory',
          name: 'Factory default',
          sub: applyBuild(BASE_WEAPONS[b.weapon], defaultBuild(b.weapon)).name,
          ok: true,
          current: false,
          preview: defaultBuild(b.weapon),
          apply: () => this.edit((x) => (x[slot] = defaultBuild(b.weapon))),
        },
        ...Object.entries(PRESETS)
          .filter(([, p]) => p.weapon === b.weapon)
          .map(([id, p]) => ({
            key: id,
            name: p.name ?? id,
            ok: true,
            current: b.name === p.name,
            preview: p,
            apply: () => this.edit((x) => (x[slot] = structuredClone(p))),
          })),
      ],
    });
    const r = resolveBuild(b);
    for (const s of PLATFORMS[b.weapon].slots) {
      rows.push({
        key: s,
        label: SLOT_LABEL[s],
        value: partName(r.parts[s]?.id),
        kind: 'list',
        group: 'Parts',
        options: () =>
          slotOptions(b, s).map((o) => ({
            key: o.part.id,
            name: o.part.name,
            sub: [
              o.part.blurb,
              o.result.changes.length
                ? 'also: ' +
                  o.result.changes.map((c) => `${SLOT_LABEL[c.slot]} → ${partName(c.to)}`).join(', ')
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
            ok: o.result.ok,
            reason: o.result.reason,
            current: o.current,
            preview: o.result.ok ? o.result.build : undefined,
            apply: () => this.editBuild(slot, () => ({ ...o.result.build, name: undefined })),
          })),
      });
    }
    // Build params.
    const st = stockOf(b);
    if (st && st.positions > 1 && !r.params.stockFolded)
      rows.push({
        key: 'stockPos',
        label: 'Stock position',
        value: `${r.params.stockPosition + 1} / ${st.positions}`,
        kind: 'step',
        group: 'Setup',
        step: (d) =>
          this.editBuild(slot, (x) => ({
            ...x,
            params: {
              ...x.params,
              stockPosition: Math.max(0, Math.min(st.positions - 1, r.params.stockPosition + d)),
            },
          })),
      });
    if (st?.folds)
      rows.push({
        key: 'folded',
        label: 'Stock',
        value: r.params.stockFolded ? 'Folded' : 'Extended',
        kind: 'toggle',
        group: 'Setup',
        step: () =>
          this.editBuild(slot, (x) => ({
            ...x,
            params: { ...x.params, stockFolded: !r.params.stockFolded },
          })),
      });
    const light = r.parts.light as LightPart | undefined;
    if (light && light.style !== 'none' && r.platform.platform !== 'glock')
      rows.push({
        key: 'lightSide',
        label: 'Light side',
        value: r.params.lightSide === 'left' ? 'Left' : 'Right',
        kind: 'toggle',
        group: 'Setup',
        step: () => this.flipSide(slot, 'lightSide'),
      });
    if (r.parts.offsetOptic && r.parts.offsetOptic.id !== 'off_none')
      rows.push({
        key: 'offsetSide',
        label: 'Offset side',
        value: r.params.offsetSide === 'left' ? 'Left' : 'Right',
        kind: 'toggle',
        group: 'Setup',
        step: () => this.flipSide(slot, 'offsetSide'),
      });
    rows.push({
      key: 'ammo',
      label: 'Ammo',
      value: cartridge(r.params.ammo).name,
      kind: 'list',
      group: 'Setup',
      options: () =>
        ammoOptions(b).map((a) => {
          const nb = { ...b, params: { ...b.params, ammo: a.id } };
          return {
            key: a.id,
            name: a.name,
            sub: `${a.velocity.toFixed(0)} m/s from this barrel${a.subsonic ? ' · subsonic' : ''}`,
            ok: true,
            current: a.current,
            preview: nb,
            apply: () => this.editBuild(slot, () => nb),
          };
        }),
    });
    return rows;
  }

  private flipSide(slot: LoadoutSlot, k: 'lightSide' | 'offsetSide') {
    const b = this.loadout[slot];
    if (!b) return;
    const cur = resolveBuild(b).params[k];
    const nb: WeaponBuild = { ...b, params: { ...b.params, [k]: cur === 'left' ? 'right' : 'left' } };
    // Light left + laser can't share a side: the option simply doesn't flip if it would be invalid.
    if (buildStats(nb)) this.editBuild(slot, () => nb);
  }

  private gearRows(): Row[] {
    const g = this.loadout.gear;
    const c = CARRIERS[g.carrier];
    const step = (k: 'rifleMags' | 'pistolMags' | 'flashbangs', max: number) => (d: -1 | 1) =>
      this.edit((l) => (l.gear[k] = Math.max(0, Math.min(max, l.gear[k] + d))));
    return [
      {
        key: 'carrier',
        label: 'Carrier',
        value: c.name,
        kind: 'list',
        group: 'Carrier',
        options: () =>
          (Object.keys(CARRIERS) as CarrierId[]).map((id) => ({
            key: id,
            name: CARRIERS[id].name,
            sub: `${CARRIERS[id].rifleSlots} rifle · ${CARRIERS[id].pistolSlots} pistol · ${kg(CARRIERS[id].mass)} · ${CARRIERS[id].blurb}`,
            ok: true,
            current: id === g.carrier,
            apply: () => this.edit((l) => (l.gear = fitGear({ ...l.gear, carrier: id }))),
          })),
      },
      {
        key: 'rifleMags',
        label: 'Rifle mags',
        value: `${g.rifleMags} / ${c.rifleSlots}`,
        kind: 'step',
        group: 'Pouches',
        note: this.loadout.primary ? undefined : 'no primary',
        step: step('rifleMags', c.rifleSlots),
      },
      {
        key: 'pistolMags',
        label: 'Pistol mags',
        value: `${g.pistolMags} / ${c.pistolSlots}`,
        kind: 'step',
        group: 'Pouches',
        note: this.loadout.sidearm ? undefined : 'no sidearm',
        step: step('pistolMags', c.pistolSlots),
      },
      {
        key: 'dumpPouch',
        label: 'Dump pouch',
        value: g.dumpPouch ? 'On belt' : 'None',
        kind: 'toggle',
        group: 'Pouches',
        step: () => this.edit((l) => (l.gear.dumpPouch = !l.gear.dumpPouch)),
      },
      {
        key: 'flashbangs',
        label: 'Flashbangs',
        value: `${g.flashbangs} / ${MAX_FLASHBANGS}`,
        kind: 'step',
        group: 'Gadgets',
        note: 'soon',
        step: step('flashbangs', MAX_FLASHBANGS),
      },
      {
        key: 'nvg',
        label: 'Night vision',
        value: g.nvg ? 'Mounted' : 'None',
        kind: 'toggle',
        group: 'Gadgets',
        note: 'soon',
        step: () => this.edit((l) => (l.gear.nvg = !l.gear.nvg)),
      },
    ];
  }

  private rows(): Row[] {
    return this.tabId === 'gear' ? this.gearRows() : this.weaponRows(this.tabId);
  }

  // ------------------------------------------------------------------ render

  private focusKey(key: string) {
    const el = this.root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  }

  render() {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.key;
    const l = this.loadout;
    const active = this.store.activeId === l.id;
    this.title.textContent = l.name;
    this.badge.textContent = active ? 'Equipped' : '';
    this.badge.classList.toggle('hidden', !active);
    this.equipBtn.textContent = active ? 'Equipped ✓' : 'Equip';
    this.equipBtn.classList.toggle('done', active);
    this.renderTabs();
    this.renderList();
    this.renderSide();
    this.renderStage(null);
    if (focused && this.root.contains(document.activeElement) === false) this.focusKey(focused);
  }

  private renderTabs() {
    const l = this.loadout;
    const sub = (t: Tab) =>
      t === 'gear' ? CARRIERS[l.gear.carrier].name : l[t] ? PLATFORMS[l[t]!.weapon].name : 'None';
    this.tabBar.replaceChildren(
      padGlyph(4, 'tab-glyph pad-only'),
      ...TABS.map(([t, label]) =>
        navButton(
          h('span', { class: 'lo-tab' }, h('span', { text: label }), h('small', { text: sub(t) })),
          () => this.setTab(t),
          { class: `tab${t === this.tabId ? ' on' : ''}`, 'data-key': `tab:${t}` },
        ),
      ),
      padGlyph(5, 'tab-glyph pad-only'),
    );
  }

  private renderList() {
    const items = this.store.list().map((x) => {
      const weapons = [x.primary, x.sidearm]
        .filter((b): b is WeaponBuild => !!b)
        .map((b) => PLATFORMS[b.weapon].name)
        .join(' + ');
      const name = h('span', { class: 'lo-name', text: x.name });
      const btn = navButton(
        h(
          'span',
          { class: 'lo-item-in' },
          h('span', { class: 'lo-dot', text: this.store.activeId === x.id ? '●' : '' }),
          h('span', { class: 'lo-item-txt' }, name, h('small', { text: weapons })),
        ),
        () => this.select(x.id),
        {
          class: `lo-item${x.id === this.selectedId ? ' on' : ''}`,
          'data-key': `lo:${x.id}`,
          'data-wrap': true,
        },
      );
      return btn;
    });
    this.list.replaceChildren(...items);
    const confirm = this.confirmDelete > performance.now();
    this.actions.replaceChildren(
      navButton('New', () => this.create(), { class: 'ghost sm', 'data-key': 'act:new' }),
      navButton('Duplicate', () => this.duplicate(), { class: 'ghost sm', 'data-key': 'act:dup' }),
      navButton('Rename', () => this.rename(), { class: 'ghost sm', 'data-key': 'act:rename' }),
      navButton(confirm ? 'Confirm' : 'Delete', () => this.remove(), {
        class: `ghost sm${confirm ? ' danger' : ''}`,
        'data-key': 'act:delete',
      }),
    );
  }

  private create() {
    const n = this.store.create();
    this.select(n.id);
    this.focusKey(`lo:${n.id}`);
  }

  private duplicate() {
    const n = this.store.duplicate(this.selectedId);
    if (!n) return;
    this.select(n.id);
    this.focusKey(`lo:${n.id}`);
  }

  private remove() {
    if (this.confirmDelete <= performance.now()) {
      this.confirmDelete = performance.now() + 3000;
      this.renderList();
      this.focusKey('act:delete');
      setTimeout(() => this.visible && this.renderList(), 3100);
      return;
    }
    this.confirmDelete = 0;
    this.selectedId = this.store.remove(this.selectedId);
    this.render();
    this.focusKey(`lo:${this.selectedId}`);
  }

  /** Inline rename: menu navigation pauses while the text field has focus. */
  rename() {
    const btn = this.list.querySelector<HTMLElement>(`[data-key="lo:${CSS.escape(this.selectedId)}"]`);
    // The field replaces the whole button (an input inside a button would click it on Space).
    if (!btn) return;
    const input = h('input', {
      class: 'lo-rename',
      value: this.loadout.name,
      maxlength: 28,
      spellcheck: 'false',
    });
    btn.replaceWith(h('div', { class: 'lo-item lo-item-edit' }, input));
    this.renaming = true;
    this.deps.nav.setActive(false);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = false;
      if (commit) this.store.rename(this.selectedId, input.value);
      this.deps.nav.setActive(true);
      this.render();
      this.focusKey('act:rename');
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') finish(true);
      else if (e.code === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  private renderSide() {
    const rows = this.rows();
    const open = this.openRow ? rows.find((r) => r.key === this.openRow) : undefined;
    if (this.openRow && !open) this.openRow = null;
    if (open?.options) {
      this.sideHead.replaceChildren(
        navButton(h('span', {}, h('span', { class: 'lo-back', text: '‹' }), open.label), () => this.back(), {
          class: 'lo-crumb',
          'data-key': 'crumb',
        }),
      );
      const opts = open.options();
      this.side.replaceChildren(
        ...opts.map((o) => {
          const b = navButton(
            h(
              'span',
              { class: 'lo-opt-in' },
              h(
                'span',
                { class: 'lo-opt-name' },
                o.name,
                o.current ? h('span', { class: 'lo-cur', text: 'fitted' }) : null,
              ),
              o.sub ? h('small', { class: 'lo-opt-sub', text: o.sub }) : null,
              !o.ok && o.reason
                ? h('small', { class: 'lo-reason', text: cleanReason(o.name, o.reason) })
                : null,
            ),
            () => {
              if (!o.ok) return;
              const key = open.key;
              if (!o.current) o.apply();
              this.closeOptions();
              this.focusKey(`row:${key}`);
            },
            {
              class: `lo-opt${o.ok ? '' : ' bad'}${o.current ? ' cur' : ''}`,
              'data-key': `opt:${o.key}`,
              'data-opt': o.key,
              'data-wrap': true,
              ...(o.ok ? {} : { 'aria-disabled': 'true' }),
              ...(o.current ? { 'data-current': true } : {}),
            },
          );
          b.addEventListener('focus', () => this.preview(o));
          return b;
        }),
      );
      return;
    }
    this.sideHead.replaceChildren(
      h('div', { class: 'lo-colhead', text: this.tabId === 'gear' ? 'Gear' : 'Build' }),
    );
    const out: Node[] = [];
    let group = '';
    for (const r of rows) {
      if (r.group && r.group !== group) {
        group = r.group;
        out.push(h('div', { class: 'lo-group', text: group }));
      }
      const val = h(
        'span',
        { class: 'lo-val' },
        r.kind === 'step' ? h('span', { class: 'lo-arrow', text: '◂' }) : null,
        h('span', { text: r.value }),
        r.kind === 'step' ? h('span', { class: 'lo-arrow', text: '▸' }) : null,
        r.kind === 'list' ? h('span', { class: 'lo-arrow', text: '›' }) : null,
      );
      const b = navButton(
        h(
          'span',
          { class: 'lo-row-in' },
          h('span', { class: 'lo-lab' }, r.label, r.note ? h('em', { text: r.note }) : null),
          val,
        ),
        () => {
          if (r.kind === 'list') this.openOptions(r.key);
          else r.step?.(1);
          if (r.kind !== 'list') this.focusKey(`row:${r.key}`);
        },
        {
          class: `lo-row k-${r.kind}`,
          'data-key': `row:${r.key}`,
          'data-wrap': true,
          ...(r.kind === 'step' ? { 'data-axis': 'x' } : {}),
        },
      );
      if (r.kind === 'step')
        b.addEventListener('nav-adjust', (e) => {
          r.step?.((e as CustomEvent<number>).detail as -1 | 1);
          this.focusKey(`row:${r.key}`);
        });
      b.addEventListener('focus', () => this.preview(null));
      out.push(b);
    }
    this.side.replaceChildren(...out);
  }

  /** Focused option: stats deltas now, model after a short pause (cheap browsing). */
  private preview(o: Opt | null) {
    clearTimeout(this.previewTimer);
    const t = this.tabId;
    if (!o || t === 'gear' || o.preview === undefined) {
      this.renderStage(null);
      return;
    }
    this.renderStats(o.preview);
    this.previewTimer = window.setTimeout(() => this.renderStage(o.preview ?? null, true), 160);
  }

  private stageBuild(): WeaponBuild | null {
    const l = this.loadout;
    if (this.tabId === 'sidearm') return l.sidearm;
    if (this.tabId === 'primary') return l.primary;
    return l.primary ?? l.sidearm;
  }

  /** Turntable + caption + stats. `preview` (if given) is shown instead of the current build. */
  private renderStage(preview: WeaponBuild | null, isPreview = false) {
    const cur = this.stageBuild();
    const shown = isPreview ? preview : cur;
    this.turntable.setBuild(shown);
    if (!isPreview) this.renderStats(undefined);
    if (!shown) {
      this.stageCap.replaceChildren(h('div', { class: 'lo-empty', text: 'No weapon in this slot' }));
      return;
    }
    const def = applyBuild(BASE_WEAPONS[shown.weapon], shown);
    const s = buildStats(shown);
    const r = resolveBuild(shown);
    this.stageCap.replaceChildren(
      h('div', { class: 'lo-wname', text: def.name }),
      h(
        'div',
        { class: 'lo-wsub' },
        `${cartridge(r.params.ammo).name} · ${def.magCapacity} rds`,
        s ? ` · ${s.length.toFixed(0)} cm` : '',
        isPreview ? h('span', { class: 'lo-prev', text: 'preview' }) : null,
      ),
    );
  }

  /** Stat bars. `preview` undefined = current only; a build = deltas vs current; null = weapon removed. */
  private renderStats(preview: WeaponBuild | null | undefined) {
    if (this.tabId === 'gear') return this.renderKit();
    const cur = this.stageBuild();
    const a = cur ? buildStats(cur) : null;
    const b: StatValues | null | undefined =
      preview === undefined ? undefined : preview ? buildStats(preview) : null;
    if (!a && !b) {
      this.stats.replaceChildren();
      return;
    }
    this.stats.replaceChildren(
      ...STATS.map((d) => {
        const v0 = a?.[d.id];
        const v1 = b === undefined ? v0 : b?.[d.id];
        const shown = v1 ?? v0 ?? 0;
        const sign = v0 !== undefined && v1 !== undefined ? deltaSign(d, v0, v1) : 0;
        const f0 = v0 !== undefined ? bar(d, v0) : 0;
        const f1 = v1 !== undefined ? bar(d, v1) : 0;
        const lo = Math.min(f0, f1),
          hi = Math.max(f0, f1);
        return h(
          'div',
          { class: `lo-stat${sign > 0 ? ' up' : sign < 0 ? ' down' : ''}`, 'data-stat': d.id },
          h('span', { class: 'lo-stat-l', text: d.label }),
          h(
            'span',
            { class: 'lo-bar' },
            h('i', { class: 'base', style: `width:${(lo * 100).toFixed(1)}%` }),
            sign !== 0
              ? h('i', {
                  class: 'delta',
                  style: `left:${(lo * 100).toFixed(1)}%;width:${((hi - lo) * 100).toFixed(1)}%`,
                })
              : null,
          ),
          h('span', { class: 'lo-stat-v num' }, `${d.fmt(shown)}`, h('small', { text: ` ${d.unit}` })),
          h('span', {
            class: 'lo-stat-d num',
            text: v0 !== undefined && v1 !== undefined && sign !== 0 ? fmtDelta(d, v0, v1) : '',
          }),
        );
      }),
    );
  }

  private renderKit() {
    const l = this.loadout;
    const k = kitStats(l);
    const c = CARRIERS[l.gear.carrier];
    const row = (label: string, value: string) =>
      h(
        'div',
        { class: 'lo-kit' },
        h('span', { class: 'lo-stat-l', text: label }),
        h('span', { class: 'num', text: value }),
      );
    this.stats.replaceChildren(
      row('Kit mass', kg(k.mass)),
      row('Carrier', `${c.name} · ${kg(c.mass)}`),
      row('Rifle rounds', l.primary ? String(k.rifleRounds) : '—'),
      row('Pistol rounds', l.sidearm ? String(k.pistolRounds) : '—'),
      row('Mobility', k.mass < 11 ? 'Light' : k.mass < 16.5 ? 'Standard' : 'Heavy'),
    );
  }

  /** Y on the pad (FocusNav only handles A/B/LB/RB/Start). */
  private pollPad = () => {
    if (!this.visible) return;
    this.padRaf = requestAnimationFrame(this.pollPad);
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
    const y = pads.some((p) => p.buttons[3]?.pressed);
    if (y && !this.prevY && !this.renaming) this.randomize();
    this.prevY = y;
  };
}
