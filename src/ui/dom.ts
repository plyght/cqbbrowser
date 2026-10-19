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

/** Per-device input hints; CSS shows the row matching `body[data-input]`. */
export function hints(pairs: { key: string; pad: string; label: string }[]) {
  const row = (dev: 'kbm' | 'pad') =>
    h(
      'div',
      { class: `hints-row ${dev}` },
      ...pairs.map((p) =>
        h(
          'span',
          { class: 'hint' },
          h('kbd', { class: dev === 'pad' ? 'pad' : '' }, dev === 'pad' ? p.pad : p.key),
          p.label,
        ),
      ),
    );
  return h('div', { class: 'hints' }, row('kbm'), row('pad'));
}

export const BASE = import.meta.env?.BASE_URL ?? './';
export const brand = (file: string) => `${BASE}brand/${file}`;
