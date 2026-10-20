import { h, hints, navButton } from './dom';
import { finalTime, fmtScore, type MedalBands, type RunResult } from './drills';
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
    const hf = r.method === 'hitFactor';
    const fin = finalTime(r);
    const pen = fin - r.time;
    // The score in the drill's own unit: final time (lower is better) or hit factor (higher is better).
    const scoreV = hf ? (r.hitFactor ?? 0) : fin;
    const pb = r.previousBest;
    const isPb = pb === undefined || (hf ? scoreV > pb : scoreV < pb);
    const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
    const maxSplit = Math.max(0.01, ...r.splits);
    const bestSplit = r.splits.length > 1 ? Math.min(...r.splits.slice(1)) : NaN;
    const bands = r.bands ?? { gold: r.par, silver: r.par * 1.25, bronze: r.par * 1.6 };

    const summary = h(
      'div',
      { class: 'res-summary' },
      h('div', { class: 'eyebrow', text: `${r.facility ?? 'Drill'} · Results` }),
      h('h2', { text: r.drillName }),
      h(
        'div',
        { class: 'res-time' },
        h('span', { class: 'time', text: hf ? scoreV.toFixed(2) : fmtTime(fin) }),
        medalBadge(r.medal, true),
      ),
      hf
        ? h(
            'div',
            { class: 'res-sub' },
            h('span', {}, 'HIT FACTOR · TIME ', h('b', { class: 'num', text: fmtTime(r.time) })),
            h('span', {}, 'PTS ', h('b', { class: 'num', text: `${r.points ?? 0}/${r.maxPoints ?? 0}` })),
            h('span', {}, 'PAR ', h('b', { class: 'num', text: fmtScore(r.par, r.method) })),
          )
        : h(
            'div',
            { class: 'res-sub' },
            h('span', {}, 'RAW ', h('b', { class: 'num', text: fmtTime(r.time) })),
            h(
              'span',
              {},
              'PEN ',
              h('b', { class: `num${pen > 0 ? ' bad' : ''}`, text: `+${pen.toFixed(2)}` }),
            ),
            h('span', {}, 'PAR ', h('b', { class: 'num', text: fmtTime(r.par) })),
          ),
      parGauge(scoreV, bands, hf),
      h(
        'div',
        { class: `res-pb ${isPb ? 'good' : 'bad'}` },
        pb === undefined
          ? 'FIRST RUN · NEW PB'
          : isPb
            ? `NEW PB  ${fmtDelta(scoreV - pb)}`
            : `PB ${fmtScore(pb, r.method)}  ${fmtDelta(scoreV - pb)}`,
      ),
      h(
        'dl',
        { class: 'stats' },
        h('dt', { text: 'Hits' }),
        h('dd', { class: 'num', text: `${r.hits} / ${r.shots}` }),
        h('dt', { text: 'Accuracy' }),
        h('dd', { class: 'num', text: `${acc}%` }),
        h('dt', { text: 'Medal' }),
        h('dd', { text: (r.medalName ?? r.medal ?? 'none').toUpperCase() }),
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
                h('b', { class: 'num bad', text: p.text ?? `+${p.seconds.toFixed(2)}` }),
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
          { key: 'Enter', pad: [0], label: 'Select' },
          { key: 'Backspace', pad: [1], label: 'Drill list' },
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

/**
 * Score against the drill's real medal bands. Time drills: gold <= G, silver <= S, bronze <= B (scale to 1.3x B).
 * Hit-factor drills run the other way: bronze >= B ... gold >= G (scale to 1.3x G).
 */
function parGauge(score: number, b: MedalBands, hitFactor: boolean) {
  const span = (hitFactor ? b.gold : b.bronze) * 1.3 || 1;
  const pos = (t: number) => `${((clamp(t, 0, span) / span) * 100).toFixed(2)}%`;
  const band = (from: number, to: number, color: string) => {
    const i = h('i');
    i.style.width = `${((Math.max(0, to - from) / span) * 100).toFixed(2)}%`;
    i.style.background = color;
    return i;
  };
  const tick = (t: number, label: string) => {
    const e = h('span', { class: 'tick', text: label });
    e.style.left = pos(t);
    return e;
  };
  const you = h('span', { class: 'you' });
  you.style.left = pos(score);
  const G = 'rgba(201,162,74,.75)',
    S = 'rgba(169,171,164,.6)',
    B = 'rgba(168,113,74,.6)',
    N = 'rgba(232,228,218,.1)';
  const fmt = (v: number) => (hitFactor ? v.toFixed(2) : fmtTime(v));
  return h(
    'div',
    { class: 'par-gauge' },
    h(
      'div',
      { class: 'rail' },
      ...(hitFactor
        ? [
            band(0, b.bronze, N),
            band(b.bronze, b.silver, B),
            band(b.silver, b.gold, S),
            band(b.gold, span, G),
          ]
        : [
            band(0, b.gold, G),
            band(b.gold, b.silver, S),
            band(b.silver, b.bronze, B),
            band(b.bronze, span, N),
          ]),
    ),
    tick(b.gold, `G ${fmt(b.gold)}`),
    tick(b.silver, `S ${fmt(b.silver)}`),
    tick(b.bronze, `B ${fmt(b.bronze)}`),
    you,
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
