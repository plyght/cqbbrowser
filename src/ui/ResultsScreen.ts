import { h, hints, navButton } from './dom';
import { finalTime, type RunResult } from './drills';
import type { Screen } from './FocusNav';
import { fmtDelta, fmtTime } from './nav';
import { medalBadge } from './PlayScreen';

export interface ResultsActions {
  retry(r: RunResult): void;
  footage(r: RunResult): void;
  next(r: RunResult): void;
  back(): void;
}

/** End-of-drill results: final time, hits, penalties, splits, medal, PB delta; Retry / Watch footage / Next. */
export class ResultsScreen implements Screen {
  readonly root = h('section', { class: 'screen results' });
  result: RunResult | null = null;

  constructor(private act: ResultsActions) {}

  show(r: RunResult) {
    this.result = r;
    const fin = finalTime(r);
    const pen = fin - r.time;
    const pb = r.previousBest;
    const isPb = pb === undefined || fin < pb;
    const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
    const maxSplit = Math.max(0.01, ...r.splits);
    const bestSplit = r.splits.length > 1 ? Math.min(...r.splits.slice(1)) : NaN;

    const summary = h(
      'div',
      { class: 'res-summary' },
      h('div', { class: 'eyebrow', text: `${r.facility ?? 'Drill'} · Results` }),
      h('h2', { text: r.drillName }),
      h(
        'div',
        { class: 'res-time' },
        h('span', { class: 'time', text: fmtTime(fin) }),
        medalBadge(r.medal, true),
      ),
      h(
        'div',
        { class: 'res-sub' },
        h('span', {}, 'RAW ', h('b', { class: 'num', text: fmtTime(r.time) })),
        h('span', {}, 'PEN ', h('b', { class: `num${pen > 0 ? ' bad' : ''}`, text: `+${pen.toFixed(2)}` })),
        h('span', {}, 'PAR ', h('b', { class: 'num', text: fmtTime(r.par) })),
      ),
      parGauge(fin, r.par),
      h(
        'div',
        { class: `res-pb ${isPb ? 'good' : 'bad'}` },
        pb === undefined
          ? 'FIRST CLEAN TIME · NEW PB'
          : isPb
            ? `NEW PB  ${fmtDelta(fin - pb)}`
            : `PB ${fmtTime(pb)}  ${fmtDelta(fin - pb)}`,
      ),
      h(
        'dl',
        { class: 'stats' },
        h('dt', { text: 'Hits' }),
        h('dd', { class: 'num', text: `${r.hits} / ${r.shots}` }),
        h('dt', { text: 'Accuracy' }),
        h('dd', { class: 'num', text: `${acc}%` }),
        h('dt', { text: 'Medal' }),
        h('dd', { text: r.medal ? r.medal.toUpperCase() : 'NONE' }),
      ),
    );

    const penalties = h(
      'div',
      { class: 'res-block' },
      h('h3', { text: 'Penalties' }),
      r.penalties.length
        ? h(
            'ul',
            { class: 'pen-list' },
            ...r.penalties.map((p) =>
              h(
                'li',
                {},
                h('span', { text: p.label }),
                h('b', { class: 'num bad', text: `+${p.seconds.toFixed(2)}` }),
              ),
            ),
          )
        : h('p', { class: 'dim', text: 'Clean run. No penalties.' }),
    );

    const splits = h(
      'div',
      { class: 'res-block splits' },
      h('h3', { text: 'Splits' }),
      h(
        'ol',
        { class: 'split-list' },
        ...r.splits.map((s, i) => {
          const bar = h('i');
          bar.style.width = `${((s / maxSplit) * 100).toFixed(1)}%`;
          return h(
            'li',
            { class: i > 0 && s === bestSplit ? 'best' : '' },
            h('span', { class: 'idx', text: i === 0 ? 'DRAW' : String(i).padStart(2, '0') }),
            h('span', { class: 'bar' }, bar),
            h('b', { class: 'num', text: s.toFixed(2) }),
          );
        }),
      ),
    );

    const actions = h(
      'div',
      { class: 'res-actions' },
      navButton('Retry', () => this.act.retry(r), { class: 'primary', 'data-role': 'retry' }),
      navButton('Watch footage', () => this.act.footage(r), {
        'data-role': 'footage',
        disabled: r.hasFootage === false,
      }),
      navButton('Next drill', () => this.act.next(r), { 'data-role': 'next' }),
      navButton('Drill list', () => this.act.back(), { class: 'ghost', 'data-role': 'list' }),
    );

    this.root.replaceChildren(
      h('div', { class: 'res-grid' }, summary, h('div', { class: 'res-side' }, splits, penalties)),
      h(
        'footer',
        { class: 'screen-foot' },
        actions,
        hints([
          { key: 'Enter', pad: 'A', label: 'Select' },
          { key: 'Backspace', pad: 'B', label: 'Drill list' },
        ]),
      ),
    );
  }

  initialFocus() {
    return this.root.querySelector<HTMLElement>('[data-role="retry"]');
  }

  back() {
    this.act.back();
  }

  start() {
    if (this.result) this.act.retry(this.result);
  }
}

/** Final time against the medal bands: gold ≤ par, silver ≤ 1.25×, bronze ≤ 1.6× (scale runs to 2× par). */
function parGauge(fin: number, par: number) {
  const span = par * 2;
  const pos = (t: number) => `${((Math.min(t, span) / span) * 100).toFixed(2)}%`;
  const band = (from: number, to: number, color: string) => {
    const i = h('i');
    i.style.width = `${(((to - from) / span) * 100).toFixed(2)}%`;
    i.style.background = color;
    return i;
  };
  const tick = (t: number, label: string) => {
    const e = h('span', { class: 'tick', text: label });
    e.style.left = pos(t);
    return e;
  };
  const you = h('span', { class: 'you' });
  you.style.left = pos(fin);
  return h(
    'div',
    { class: 'par-gauge' },
    h(
      'div',
      { class: 'rail' },
      band(0, par, 'rgba(201,162,74,.75)'),
      band(par, par * 1.25, 'rgba(169,171,164,.6)'),
      band(par * 1.25, par * 1.6, 'rgba(168,113,74,.6)'),
      band(par * 1.6, span, 'rgba(232,228,218,.1)'),
    ),
    tick(par, `G ${fmtTime(par)}`),
    tick(par * 1.25, `S ${fmtTime(par * 1.25)}`),
    tick(par * 1.6, `B ${fmtTime(par * 1.6)}`),
    you,
  );
}
