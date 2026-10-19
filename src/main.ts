import { Game } from './core/Game';
import { LOADOUT_PRESETS } from './loadout';

const game = new Game();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

game.start(canvas, ui).then(() => {
  // Debug/test hook (used by Playwright screenshots and e2e).
  (window as unknown as { __sb: Game }).__sb = game;
  (window as unknown as { __loadoutPresets: unknown }).__loadoutPresets = LOADOUT_PRESETS;
  document.body.dataset.ready = '1';
});
