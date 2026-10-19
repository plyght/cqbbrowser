import { padButtonLabel, type PadType } from '../input/bindings';

/** Tiny DOM helpers for the menus (no framework). */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** A focusable menu button. */
export function navButton(
  label: string | Node,
  onClick: () => void,
  attrs: Record<string, string | boolean> = {},
) {
  const b = h('button', { type: 'button', 'data-nav': true, ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

// Controller glyphs follow the connected pad family (Xbox / PlayStation / Switch), via src/input/bindings.ts.
let padType: PadType = 'xbox';
const padText = (btns: number[]) => btns.map((i) => padButtonLabel(i, padType)).join('/');

/** A pad button glyph that relabels itself when the pad family changes. */
export function padGlyph(btn: number | number[], cls = '') {
  const btns = [btn].flat();
  return h('span', { class: cls, 'data-pad-btn': btns.join(','), text: padText(btns) });
}

/** Relabel every pad glyph in the document (call when a different controller family is used). */
export function setPadType(t: PadType) {
  if (t === padType) return;
  padType = t;
  for (const el of document.querySelectorAll<HTMLElement>('[data-pad-btn]'))
    el.textContent = padText(el.dataset.padBtn!.split(',').map(Number));
}
export const currentPadType = () => padType;

/**
 * Per-device input hints; CSS shows the row matching `body[data-input]`. `pad` is standard-mapping button indices
 * (labelled per pad family) or a literal glyph like '✚'.
 */
export function hints(pairs: { key: string; pad: number[] | string; label: string }[]) {
  const row = (dev: 'kbm' | 'pad') =>
    h(
      'div',
      { class: `hints-row ${dev}` },
      ...pairs.map((p) =>
        h(
          'span',
          { class: 'hint' },
          dev === 'pad'
            ? typeof p.pad === 'string'
              ? h('kbd', { class: 'pad' }, p.pad)
              : h('kbd', { class: 'pad' }, padGlyph(p.pad))
            : h('kbd', {}, p.key),
          p.label,
        ),
      ),
    );
  return h('div', { class: 'hints' }, row('kbm'), row('pad'));
}

export const BASE = import.meta.env?.BASE_URL ?? './';
export const brand = (file: string) => `${BASE}brand/${file}`;
