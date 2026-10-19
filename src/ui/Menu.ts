import { settings } from '../settings/Settings';
import { brand, h, hints, navButton } from './dom';
import { getDrills, type DrillInfo, type RunResult } from './drills';
import { FocusNav, type Screen } from './FocusNav';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';

const VERSION = '0.0.1';

/**
 * Plain, fast menus (no tablet): main menu, Play (facility → drill → GO), Settings, pause, results.
 * The live range keeps rendering behind the overlay. Controller (Gamepad API), keyboard and mouse all navigate.
 *
 * Game wiring: `onPlay` / `onResume` re-enter gameplay; `show(true)` opens the pause menu once a run has started
 * (main menu before that); drills call `showResults(result)` at the end of a run.
 */
export class Menu {
  readonly root = h('div', { class: 'menu' });
  readonly nav: FocusNav;
  /** Free practice / generic "enter gameplay". */
  onPlay: () => void = () => {};
  /** Start a specific drill (drills engine replaces this). Defaults to free practice. */
  onStartDrill: (d: DrillInfo) => void = () => this.onPlay();
  onResume: () => void = () => this.onPlay();
  onRestart: () => void = () => this.onPlay();
  onQuit: () => void = () => {};
  onRetry: (r: RunResult) => void = (r) => this.startDrill(getDrills().find((d) => d.id === r.drillId));
  onFootage: (r: RunResult) => void = () => this.push(this.footage);
  onNext: (r: RunResult) => void = (r) => {
    const list = getDrills();
    const i = list.findIndex((d) => d.id === r.drillId);
    this.startDrill(list[(i + 1) % list.length]);
  };
  /** True once gameplay has been entered; `show(true)` then means "pause". */
  inRun = false;
  current: DrillInfo | null = null;

  private stack: Screen[] = [];
  readonly main: Screen;
  readonly play: PlayScreen;
  readonly settings: SettingsScreen;
  readonly pause: Screen;
  readonly results: ResultsScreen;
  readonly loadout: Screen;
  readonly footage: Screen;
  private pauseTitle = h('div', { class: 'pause-drill' });

  constructor(parent: HTMLElement) {
    this.nav = new FocusNav(this.root);
    this.nav.onDevice = (d) => (document.body.dataset.input = d === 'gamepad' ? 'pad' : 'kbm');
    document.body.dataset.input = 'kbm';
    this.main = this.buildMain();
    this.play = new PlayScreen(
      (d) => this.startDrill(d),
      () => this.pop(),
    );
    this.settings = new SettingsScreen(() => this.pop());
    this.pause = this.buildPause();
    this.results = new ResultsScreen({
      retry: (r) => this.onRetry(r),
      footage: (r) => this.onFootage(r),
      next: (r) => this.onNext(r),
      back: () => {
        this.inRun = false;
        this.reset(this.main);
        this.push(this.play);
      },
    });
    this.loadout = this.placeholder(
      'Loadout',
      'Weapon bench',
      'Rotate the gun, swap parts, see stat deltas, try it on the square range. Arrives with M4.',
    );
    this.footage = this.placeholder(
      'Footage',
      'CAM04 archive',
      'Saved runs: watch, re-render chest or helmet, export WebM. Arrives with M4.',
    );
    this.play.root.dataset.id = 'play';
    this.settings.root.dataset.id = 'settings';
    this.results.root.dataset.id = 'results';
    for (const s of [
      this.main,
      this.play,
      this.settings,
      this.pause,
      this.results,
      this.loadout,
      this.footage,
    ]) {
      s.root.classList.add('hidden');
      this.root.append(s.root);
    }
    const a11y = settings.ns('a11y', { uiScale: 1 });
    const applyScale = () => this.root.style.setProperty('--ui-scale', String(a11y.get().uiScale ?? 1));
    a11y.onChange(applyScale);
    applyScale();
    parent.append(this.root);
    this.reset(this.main);
    this.nav.setActive(true);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  /** Show/hide the menu overlay. Showing during a run opens the pause menu. */
  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    this.nav.setActive(v);
    if (!v) {
      this.inRun = true;
      return;
    }
    if (this.inRun) this.showPause();
    else if (this.top() === this.pause || this.top() === this.results || !this.stack.length)
      this.reset(this.main);
    else this.nav.setScreen(this.top()!);
  }

  showMain() {
    this.inRun = false;
    this.reveal();
    this.reset(this.main);
  }

  showPause() {
    this.reveal();
    this.pauseTitle.textContent = this.current
      ? `${this.current.facility} · ${this.current.name}`
      : 'Square Range · Free practice';
    this.reset(this.pause);
  }

  showSettings() {
    this.reveal();
    this.push(this.settings);
  }

  /** End-of-run results (the caller pauses gameplay). */
  showResults(r: RunResult) {
    this.reveal();
    this.results.show(r);
    this.reset(this.results);
  }

  private reveal() {
    this.root.classList.remove('hidden');
    this.nav.setActive(true);
  }

  private top() {
    return this.stack[this.stack.length - 1];
  }

  push(s: Screen) {
    this.top()?.root.classList.add('hidden');
    this.stack.push(s);
    this.activate(s);
  }

  pop() {
    if (this.stack.length <= 1) return;
    this.stack.pop()!.root.classList.add('hidden');
    this.activate(this.top()!);
  }

  private reset(s: Screen) {
    for (const x of this.stack) x.root.classList.add('hidden');
    this.stack = [s];
    this.activate(s);
  }

  private activate(s: Screen) {
    s.enter?.();
    s.root.classList.remove('hidden');
    this.root.dataset.screen = s.root.dataset.id ?? '';
    this.nav.setScreen(s);
  }

  /** Leave the menu for gameplay once the confirming key/button is released. */
  private toGame(fn: () => void) {
    this.nav.afterRelease(() => {
      this.inRun = true;
      fn();
    });
  }

  startDrill(d: DrillInfo | undefined) {
    this.current = d ?? null;
    this.toGame(() => (d ? this.onStartDrill(d) : this.onPlay()));
  }

  private buildMain(): Screen {
    const items: [string, string, () => void][] = [
      ['play', 'Play', () => this.push(this.play)],
      ['loadout', 'Loadout', () => this.push(this.loadout)],
      ['footage', 'Footage', () => this.push(this.footage)],
      ['settings', 'Settings', () => this.push(this.settings)],
    ];
    const root = h(
      'section',
      { class: 'screen main', 'data-id': 'main' },
      h(
        'div',
        { class: 'main-col' },
        h(
          'div',
          { class: 'brand' },
          h('img', {
            class: 'patch',
            src: brand('umbra-patch.svg'),
            alt: 'UMBRA CO. shoulder patch',
            draggable: 'false',
          }),
          h(
            'div',
            { class: 'brand-text' },
            h('img', {
              class: 'wordmark',
              src: brand('shortbarrel-wordmark.svg'),
              alt: 'SHORTBARREL',
              draggable: 'false',
            }),
            h('div', { class: 'eyebrow', text: 'UMBRA CO. · TRAINING CENTER' }),
          ),
        ),
        h(
          'nav',
          { class: 'main-nav' },
          ...items.map(([id, label, fn], i) =>
            navButton(
              h('span', {}, h('span', { class: 'idx', text: String(i + 1).padStart(2, '0') }), label),
              fn,
              { class: 'main-item', 'data-act': id, 'data-wrap': true },
            ),
          ),
        ),
        hints([
          { key: '↑↓', pad: '✚', label: 'Move' },
          { key: 'Enter', pad: 'A', label: 'Select' },
        ]),
      ),
      h(
        'div',
        { class: 'main-meta' },
        h('div', { class: 'rec' }, h('span', { class: 'rec-dot' }), 'CAM04 · UNIT 0412'),
        h('div', { text: `SHORTBARREL v${VERSION} · mouse · trackpad · controller` }),
      ),
    );
    return { root, initialFocus: () => root.querySelector<HTMLElement>('[data-act="play"]') };
  }

  private buildPause(): Screen {
    const root = h(
      'section',
      { class: 'screen pause', 'data-id': 'pause' },
      h(
        'div',
        { class: 'pause-panel' },
        h(
          'div',
          { class: 'pause-head' },
          h('span', { class: 'mark' }),
          h('div', {}, h('h2', { text: 'Paused' }), this.pauseTitle),
        ),
        navButton('Resume', () => this.toGame(() => this.onResume()), {
          class: 'primary',
          'data-act': 'resume',
          'data-wrap': true,
        }),
        navButton('Restart drill', () => this.toGame(() => this.onRestart()), {
          'data-act': 'restart',
          'data-wrap': true,
        }),
        navButton('Settings', () => this.push(this.settings), { 'data-act': 'settings', 'data-wrap': true }),
        navButton(
          'Quit to menu',
          () => {
            this.inRun = false;
            this.current = null;
            this.onQuit();
            this.reset(this.main);
          },
          { class: 'ghost', 'data-act': 'quit', 'data-wrap': true },
        ),
        hints([
          { key: 'Esc', pad: 'B', label: 'Resume' },
          { key: 'Enter', pad: 'A', label: 'Select' },
        ]),
      ),
    );
    return {
      root,
      back: () => this.toGame(() => this.onResume()),
      initialFocus: () => root.querySelector<HTMLElement>('[data-act="resume"]'),
    };
  }

  private placeholder(eyebrow: string, title: string, body: string): Screen {
    const root = h(
      'section',
      { class: 'screen placeholder', 'data-id': eyebrow.toLowerCase() },
      h(
        'header',
        { class: 'screen-head' },
        h('div', { class: 'eyebrow', text: eyebrow }),
        h('h2', { text: title }),
      ),
      h('p', { class: 'dim', text: body }),
      h(
        'footer',
        { class: 'screen-foot' },
        navButton('Back', () => this.pop(), { class: 'ghost' }),
        hints([{ key: 'Esc', pad: 'B', label: 'Back' }]),
      ),
    );
    return { root, back: () => this.pop() };
  }
}
