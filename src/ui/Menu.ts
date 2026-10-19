import type { DeviceKind } from '../input/actions';
import { glyphFor, type KeyAction, type PadType } from '../input/bindings';
import { trackpadSettings } from '../input/config';
import { settings } from '../settings/Settings';
import { brand, currentPadType, h, hints, navButton, setPadType } from './dom';
import { getDrills, type DrillInfo, type RunResult } from './drills';
import { FocusNav, type Screen } from './FocusNav';
import { LoadoutScreen } from './loadout/LoadoutScreen';
import { loadouts } from '../loadout';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';
import { orderBefore, registerSettings } from './settingsSchema';
import { SettingsScreen } from './SettingsScreen';

const VERSION = '0.0.1';

/** What the menus need from the input layer (src/input). Game passes the live objects. */
export interface MenuInput {
  trackpad: {
    readonly detected: boolean;
    readonly typingSuppressionSuspected: boolean;
    onDetected?: () => void;
  };
  gyro: { connect(): Promise<boolean>; readonly connected: boolean };
  gyroSupported: boolean;
  /** Device that produced gameplay input most recently (drives the pause-menu control glyphs). */
  activeDevice: () => DeviceKind;
  padType: () => PadType;
}

export const TYPING_TIP =
  'Your touchpad seems to ignore movement while keys are held (Windows palm rejection). ' +
  'Fix: Windows Settings → Bluetooth & devices → Touchpad → Taps → Touchpad sensitivity → "Most sensitive", ' +
  'so you can aim while you move.';

const prompts = settings.ns('ui.prompts', { trackpadAsked: false });

/** Gameplay controls shown on the pause screen, with live glyphs for the active device. */
const PAUSE_CONTROLS: [KeyAction, string][] = [
  ['fire', 'Fire'],
  ['aim', 'Aim'],
  ['reload', 'Reload · hold: ammo check'],
  ['leanLeft', 'Lean left'],
  ['leanRight', 'Lean right'],
  ['sprint', 'Sprint'],
  ['crouch', 'Crouch'],
  ['switchWeapon', 'Switch weapon'],
  ['restart', 'Restart (hold)'],
];

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
  readonly loadout: LoadoutScreen;
  readonly footage: Screen;
  readonly trackpadPrompt: Screen;
  private pauseTitle = h('div', { class: 'pause-drill' });
  private pauseTip = h('div', { class: 'notice hidden', text: TYPING_TIP });
  private pauseControls = h('dl', { class: 'controls-ref' });
  private input: MenuInput | null = null;
  private promptPending = false;

  constructor(parent: HTMLElement) {
    this.nav = new FocusNav(this.root);
    this.nav.onDevice = (d) => (document.body.dataset.input = d === 'gamepad' ? 'pad' : 'kbm');
    this.nav.onPadType = (t) => setPadType(t);
    document.body.dataset.input = 'kbm';
    this.main = this.buildMain();
    this.play = new PlayScreen(
      (d) => this.startDrill(d),
      () => this.pop(),
    );
    this.settings = new SettingsScreen(() => this.pop());
    this.pause = this.buildPause();
    this.trackpadPrompt = this.buildTrackpadPrompt();
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
    this.loadout = new LoadoutScreen({
      nav: this.nav,
      back: () => this.pop(),
      tryIt: () => this.startDrill(undefined),
    });
    // Play → loadout quick-pick (◂ ▸ cycles the active loadout, select opens the loadout screen).
    this.play.loadout = {
      name: () => loadouts().active().name,
      cycle: (dir) => {
        const list = loadouts().list();
        const i = list.findIndex((l) => l.id === loadouts().activeId);
        loadouts().setActive(list[(i + dir + list.length) % list.length].id);
      },
      open: () => {
        this.loadout.selectedId = loadouts().activeId;
        this.push(this.loadout);
      },
    };
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
      this.trackpadPrompt,
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

  /**
   * Hook up the input layer: one-time trackpad-preset prompt, gyro connect button, Windows typing-suppression tip,
   * device-correct glyphs.
   */
  attachInput(io: MenuInput) {
    this.input = io;
    setPadType(io.padType());
    io.trackpad.onDetected = () => this.queueTrackpadPrompt();
    if (io.trackpad.detected) this.queueTrackpadPrompt();
    registerSettings([
      {
        tab: 'controls',
        group: 'Gyro',
        ns: 'input.gyro',
        key: 'connect',
        label: 'Gyro controller',
        kind: 'action',
        button: 'Connect DualSense / DS4',
        hint: 'WebHID (Chromium). Pick the controller in the browser prompt; it reconnects automatically next time.',
        status: () => (io.gyro.connected ? 'Connected' : 'Not connected'),
        run: () => io.gyro.connect(),
        visible: () => io.gyroSupported,
        order: orderBefore('input.gyro', 'enabled'),
      },
      {
        tab: 'controls',
        group: 'Trackpad',
        ns: 'input.trackpad',
        key: 'typingTip',
        label: TYPING_TIP,
        kind: 'notice',
        visible: () => io.trackpad.typingSuppressionSuspected,
        order: orderBefore('input.trackpad', 'mode'),
      },
    ]);
  }

  /** Ask once (mode = auto only); during gameplay the question waits for the next time the menu opens. */
  private queueTrackpadPrompt() {
    if (prompts.get().trackpadAsked || trackpadSettings.get().mode !== 'auto') return;
    if (this.visible && this.top() !== this.trackpadPrompt) this.push(this.trackpadPrompt);
    else this.promptPending = true;
  }

  private flushPrompt() {
    if (!this.promptPending) return;
    this.promptPending = false;
    this.queueTrackpadPrompt();
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
    this.flushPrompt();
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
    this.flushPrompt();
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
    if (s === this.pause) this.refreshPause();
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
          { key: 'Enter', pad: [0], label: 'Select' },
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
        this.pauseTip,
        this.pauseControls,
        hints([
          { key: 'Esc', pad: [1], label: 'Resume' },
          { key: 'Enter', pad: [0], label: 'Select' },
        ]),
      ),
    );
    return {
      root,
      back: () => this.toGame(() => this.onResume()),
      initialFocus: () => root.querySelector<HTMLElement>('[data-act="resume"]'),
    };
  }

  private refreshPause() {
    const io = this.input;
    this.pauseTip.classList.toggle('hidden', !io?.trackpad.typingSuppressionSuspected);
    const dev = io?.activeDevice() ?? 'keyboardMouse';
    const pad = io?.padType() ?? currentPadType();
    this.pauseControls.replaceChildren(
      ...PAUSE_CONTROLS.flatMap(([a, label]) => {
        const g = glyphFor(a, dev, pad) || glyphFor(a, 'keyboardMouse', pad);
        return [
          h('dt', {}, h('kbd', { class: dev === 'gamepad' ? 'pad' : '', text: g })),
          h('dd', { text: label }),
        ];
      }),
    );
  }

  private buildTrackpadPrompt(): Screen {
    const answer = (mode: 'on' | 'off' | 'auto') => {
      prompts.set({ trackpadAsked: true });
      if (mode !== 'auto') trackpadSettings.set({ mode });
      this.pop();
    };
    const root = h(
      'section',
      { class: 'screen prompt', 'data-id': 'prompt' },
      h(
        'div',
        { class: 'pause-panel' },
        h('div', { class: 'eyebrow', text: 'Input' }),
        h('h2', { text: 'Trackpad detected' }),
        h('p', {
          class: 'prompt-body',
          text:
            "Looks like you're on a trackpad. Use the trackpad preset? It keeps your OS acceleration, adds a " +
            'precision curve, two-finger scroll for ready positions and pinch for aim mode.',
        }),
        navButton('Use trackpad preset', () => answer('on'), {
          class: 'primary',
          'data-act': 'tp-on',
          'data-wrap': true,
        }),
        navButton('Keep mouse settings', () => answer('off'), { 'data-act': 'tp-off', 'data-wrap': true }),
        h('p', {
          class: 'dim small',
          text: 'You can change this any time in Settings → Controls → Trackpad.',
        }),
      ),
    );
    return { root, back: () => answer('auto') };
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
        hints([{ key: 'Esc', pad: [1], label: 'Back' }]),
      ),
    );
    return { root, back: () => this.pop() };
  }
}
