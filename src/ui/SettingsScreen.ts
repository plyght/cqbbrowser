import { h, hints, navButton } from './dom';
import type { Screen } from './FocusNav';
import { stepValue } from './nav';
import {
  groupDefs,
  nsFor,
  readSetting,
  settingsFor,
  TABS,
  writeSetting,
  type SettingDef,
  type SettingsTab,
  type SliderDef,
} from './settingsSchema';

/** Settings: tabs Controls / Gameplay / Video / Audio / Accessibility, generic controls from the schema registry. */
export class SettingsScreen implements Screen {
  readonly root = h('section', { class: 'screen settings' });
  tabId: SettingsTab = 'controls';
  private tabBar = h('nav', { class: 'tabs' });
  private body = h('div', { class: 'settings-body' });
  private hint = h('div', { class: 'settings-hint' });

  constructor(private onBack: () => void) {
    const head = h(
      'header',
      { class: 'screen-head' },
      h('div', { class: 'eyebrow', text: 'UMBRA CO. · CAM04' }),
      h('h2', { text: 'Settings' }),
    );
    const foot = h(
      'footer',
      { class: 'screen-foot' },
      navButton('Reset tab', () => this.resetTab(), { class: 'ghost', 'data-role': 'reset' }),
      navButton('Back', () => this.back(), { class: 'ghost' }),
      hints([
        { key: '↑↓', pad: '✚', label: 'Move' },
        { key: '←→', pad: '◀▶', label: 'Adjust' },
        { key: 'Q/E', pad: 'LB/RB', label: 'Tab' },
        { key: 'Esc', pad: 'B', label: 'Back' },
      ]),
    );
    this.root.append(head, this.tabBar, this.body, this.hint, foot);
    this.render();
  }

  back() {
    this.onBack();
  }

  tab(dir: -1 | 1) {
    const i = TABS.findIndex((t) => t.id === this.tabId);
    this.setTab(TABS[(i + dir + TABS.length) % TABS.length].id, true);
  }

  setTab(id: SettingsTab, focusFirstRow = false) {
    this.tabId = id;
    this.render();
    const target = focusFirstRow
      ? (this.body.querySelector<HTMLElement>('[data-nav]') ?? null)
      : this.tabBar.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    target?.focus({ preventScroll: true });
    this.body.scrollTop = 0;
  }

  initialFocus() {
    return this.tabBar.querySelector<HTMLElement>(`[data-tab="${this.tabId}"]`);
  }

  enter() {
    this.render();
  }

  private resetTab() {
    const seen = new Set<string>();
    for (const d of settingsFor(this.tabId)) {
      if (seen.has(d.ns)) continue;
      seen.add(d.ns);
      const patch: Record<string, unknown> = {};
      for (const e of settingsFor(this.tabId)) if (e.ns === d.ns) patch[e.key] = e.default;
      nsFor(d.ns).set(patch);
    }
    this.render();
    this.root.querySelector<HTMLElement>('[data-role="reset"]')?.focus({ preventScroll: true });
  }

  private render() {
    this.tabBar.replaceChildren(
      h('span', { class: 'tab-glyph pad-only', text: 'LB' }),
      ...TABS.map((t) => {
        const b = navButton(t.label, () => this.setTab(t.id), {
          class: `tab${t.id === this.tabId ? ' on' : ''}`,
          'data-tab': t.id,
        });
        return b;
      }),
      h('span', { class: 'tab-glyph pad-only', text: 'RB' }),
    );
    // Two columns, groups kept whole and balanced by row count (CSS columns would overflow sideways when scrolling).
    const cols = [h('div', { class: 'col' }), h('div', { class: 'col' })];
    const load = [0, 0];
    for (const g of groupDefs(settingsFor(this.tabId))) {
      const c = load[0] <= load[1] ? 0 : 1;
      load[c] += g.defs.length + 1;
      cols[c].append(
        h(
          'div',
          { class: 'group' },
          g.group ? h('h3', { text: g.group }) : null,
          ...g.defs.map((d) => this.row(d)),
        ),
      );
    }
    this.body.replaceChildren(...cols);
    this.hint.textContent = '';
  }

  private row(d: SettingDef): HTMLElement {
    const value = h('span', { class: 'value' });
    const row = h(
      'button',
      { type: 'button', class: `row ${d.kind}`, 'data-nav': true, 'data-key': `${d.ns}.${d.key}` },
      h('span', { class: 'label', text: d.label }),
      value,
    );
    row.addEventListener('focus', () => (this.hint.textContent = d.hint ?? ''));
    const refresh = () => value.replaceChildren(...this.valueView(d));
    if (d.kind === 'toggle') {
      row.addEventListener('click', () => {
        writeSetting(d, !readSetting(d));
        refresh();
      });
    } else if (d.kind === 'select') {
      row.dataset.axis = 'x';
      const cycle = (dir: number) => {
        const i = d.options.findIndex((o) => o.value === readSetting(d));
        writeSetting(d, d.options[(i + dir + d.options.length) % d.options.length].value);
        refresh();
      };
      row.addEventListener('nav-adjust', (e) => cycle((e as CustomEvent<number>).detail));
      row.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        cycle(t.dataset.dir === '-1' ? -1 : 1);
      });
    } else {
      row.dataset.axis = 'x';
      const s = d as SliderDef;
      const nudge = (dir: number) => {
        writeSetting(s, stepValue(readSetting(s) as number, dir * s.step, s.min, s.max, s.step));
        refresh();
      };
      row.addEventListener('nav-adjust', (e) => nudge((e as CustomEvent<number>).detail));
      // Mouse / trackpad: click or drag on the track sets the value directly.
      const fromPointer = (e: PointerEvent) => {
        const track = row.querySelector<HTMLElement>('.track');
        if (!track) return;
        const r = track.getBoundingClientRect();
        const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        writeSetting(s, stepValue(s.min + t * (s.max - s.min), 0, s.min, s.max, s.step));
        refresh();
      };
      row.addEventListener('pointerdown', (e) => {
        if (!(e.target as HTMLElement).closest('.track')) return;
        row.setPointerCapture(e.pointerId);
        fromPointer(e);
        const move = (ev: PointerEvent) => fromPointer(ev);
        const up = () => {
          row.removeEventListener('pointermove', move);
          row.removeEventListener('pointerup', up);
        };
        row.addEventListener('pointermove', move);
        row.addEventListener('pointerup', up);
      });
    }
    refresh();
    return row;
  }

  private valueView(d: SettingDef): Node[] {
    const v = readSetting(d);
    if (d.kind === 'toggle') {
      return [
        h('span', { class: `switch${v ? ' on' : ''}` }, h('i')),
        h('span', { class: 'vtext', text: v ? 'On' : 'Off' }),
      ];
    }
    if (d.kind === 'select') {
      const opt = d.options.find((o) => o.value === v) ?? d.options[0];
      return [
        h('span', { class: 'arrow', 'data-dir': '-1', text: '◀' }),
        h('span', { class: 'vtext sel', text: opt.label }),
        h('span', { class: 'arrow', 'data-dir': '1', text: '▶' }),
      ];
    }
    const n = v as number;
    const t = (n - d.min) / (d.max - d.min);
    const fill = h('span', { class: 'fill' });
    fill.style.width = `${(t * 100).toFixed(1)}%`;
    const knob = h('span', { class: 'knob' });
    knob.style.left = `${(t * 100).toFixed(1)}%`;
    return [
      h('span', { class: 'track' }, fill, knob),
      h('span', { class: 'vtext num', text: d.format?.(n) ?? String(n) }),
    ];
  }
}
