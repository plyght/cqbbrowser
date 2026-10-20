import { h, hints, navButton, padGlyph } from './dom';
import { facilities, fmtScore, getDrills, type DrillInfo, type Medal } from './drills';
import type { Screen } from './FocusNav';

export function medalBadge(m: Medal | undefined, big = false) {
  return h('span', {
    class: `medal ${m ?? 'none'}${big ? ' lg' : ''}`,
    title: m ? `${m} medal` : 'no medal',
    text: m ? m[0].toUpperCase() : '–',
  });
}

/** Play: facility tabs → drill list (best / medal / par) → GO. Two clicks from the main menu to the shot timer. */
export class PlayScreen implements Screen {
  readonly root = h('section', { class: 'screen play' });
  facility = '';
  selected: DrillInfo | null = null;
  private tabBar = h('nav', { class: 'tabs' });
  private list = h('div', { class: 'drill-list' });
  private detail = h('aside', { class: 'drill-detail' });
  /** Loadout quick-pick shown above GO (wired by Menu). */
  loadout?: { name(): string; cycle(dir: -1 | 1): void; open(): void };

  constructor(
    private onGo: (d: DrillInfo) => void,
    private onBack: () => void,
  ) {
    this.root.append(
      h(
        'header',
        { class: 'screen-head' },
        h('div', { class: 'eyebrow', text: 'UMBRA CO. TRAINING CENTER' }),
        h('h2', { text: 'Select drill' }),
      ),
      this.tabBar,
      h('div', { class: 'play-cols' }, this.list, this.detail),
      h(
        'footer',
        { class: 'screen-foot' },
        navButton('Back', () => this.back(), { class: 'ghost' }),
        hints([
          { key: 'Enter', pad: [0], label: 'GO' },
          { key: 'Q/E', pad: [4, 5], label: 'Facility' },
          { key: 'Esc', pad: [1], label: 'Back' },
        ]),
      ),
    );
  }

  enter() {
    const facs = facilities(getDrills());
    if (!facs.includes(this.facility)) this.facility = facs[0] ?? '';
    this.render();
  }

  initialFocus() {
    const id = this.selected?.facility === this.facility ? this.selected.id : undefined;
    return (
      (id && this.list.querySelector<HTMLElement>(`[data-drill="${id}"]`)) ||
      this.list.querySelector<HTMLElement>('[data-drill]')
    );
  }

  back() {
    this.onBack();
  }

  start() {
    if (this.selected) this.onGo(this.selected);
  }

  tab(dir: -1 | 1) {
    const facs = facilities(getDrills());
    const i = facs.indexOf(this.facility);
    this.facility = facs[(i + dir + facs.length) % facs.length];
    this.render();
    this.initialFocus()?.focus({ preventScroll: true });
  }

  private render() {
    const drills = getDrills();
    this.tabBar.replaceChildren(
      padGlyph(4, 'tab-glyph pad-only'),
      ...facilities(drills).map((f) =>
        navButton(
          f,
          () => {
            this.facility = f;
            this.render();
          },
          { class: `tab${f === this.facility ? ' on' : ''}`, 'data-facility': f },
        ),
      ),
      padGlyph(5, 'tab-glyph pad-only'),
    );
    const mine = drills.filter((d) => d.facility === this.facility);
    this.list.replaceChildren(
      h(
        'div',
        { class: 'drill-row head' },
        h('span', { text: 'Drill' }),
        h('span', { text: 'Par' }),
        h('span', { text: 'Best' }),
        h('span', { text: '' }),
      ),
      ...mine.map((d, i) => {
        const b = navButton(
          h(
            'span',
            { class: 'drill-row' },
            h(
              'span',
              { class: 'name' },
              h('span', { class: 'idx', text: String(i + 1).padStart(2, '0') }),
              d.name,
            ),
            h('span', { class: 'num', text: fmtScore(d.par, d.method) }),
            h('span', { class: 'num', text: fmtScore(d.best, d.method) }),
            medalBadge(d.medal),
          ),
          () => this.onGo(d),
          { class: 'drill', 'data-drill': d.id, 'data-wrap': true },
        );
        b.addEventListener('focus', () => this.select(d));
        return b;
      }),
    );
    this.select(mine.find((d) => d.id === this.selected?.id) ?? mine[0] ?? null);
  }

  private select(d: DrillInfo | null) {
    this.selected = d;
    if (!d) {
      this.detail.replaceChildren(h('p', { class: 'dim', text: 'No drills here yet.' }));
      return;
    }
    const hf = d.method === 'hitFactor';
    // vs par in the drill's unit: under par is good for time, over par is good for hit factor.
    const delta = d.best !== undefined && d.par > 0 ? d.best - d.par : undefined;
    const good = delta !== undefined && (hf ? delta >= 0 : delta <= 0);
    this.detail.replaceChildren(
      h('div', { class: 'eyebrow', text: d.facility }),
      h('h3', { text: d.name }),
      h('p', { class: 'brief', text: d.brief ?? '' }),
      h(
        'dl',
        { class: 'stats' },
        h('dt', { text: 'Par' }),
        h('dd', { text: fmtScore(d.par, d.method) }),
        h('dt', { text: 'Best' }),
        h('dd', { text: d.best !== undefined ? fmtScore(d.best, d.method) : 'No time' }),
        h('dt', { text: 'vs par' }),
        h('dd', {
          class: delta === undefined ? '' : good ? 'good' : 'bad',
          text: delta === undefined ? '—' : (delta < 0 ? '−' : '+') + Math.abs(delta).toFixed(2),
        }),
        h('dt', { text: 'Medal' }),
        h('dd', {}, medalBadge(d.medal), ' ', (d.medalName ?? d.medal ?? 'none').toUpperCase()),
      ),
      ...(this.loadout ? [this.loadoutPick()!] : []),
      navButton(h('span', {}, 'GO ', h('span', { class: 'go-arrow', text: '▸' })), () => this.start(), {
        class: 'go',
        'data-role': 'go',
      }),
    );
  }

  private loadoutPick() {
    const lo = this.loadout;
    if (!lo) return null;
    const name = h('span', { class: 'lo-pick-name', text: lo.name() });
    const b = navButton(
      h(
        'span',
        { class: 'lo-pick-in' },
        h('span', { class: 'lo-pick-l', text: 'Loadout' }),
        h(
          'span',
          { class: 'lo-pick-v' },
          h('span', { class: 'lo-arrow', text: '◂' }),
          name,
          h('span', { class: 'lo-arrow', text: '▸' }),
        ),
      ),
      () => lo.open(),
      { class: 'lo-pick', 'data-axis': 'x', 'data-role': 'loadout' },
    );
    b.addEventListener('nav-adjust', (e) => {
      lo.cycle((e as CustomEvent<number>).detail as -1 | 1);
      name.textContent = lo.name();
    });
    return b;
  }
}
