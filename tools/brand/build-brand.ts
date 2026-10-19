/**
 * UMBRA CO. brand generator. Writes the shoulder patch, the monochrome mark, the favicon and the SHORTBARREL
 * wordmark to `public/brand/` as self-contained SVGs (text is converted to outlines, so no fonts load at runtime).
 *
 *   bun tools/brand/build-brand.ts
 *
 * The motif is original: a hooded skull ("the shade") in front of an eclipse ring, on an arched-top shield with a
 * separate "UMBRA" tab and the motto SEMPER IN UMBRA ("always in the shadow"). The look follows old-school subdued
 * unit patches: OD twill, black / dark-olive / coyote thread, fill-stitch texture, merrowed (overlocked) edges.
 * Fonts (OFL): Oswald Bold, Cinzel Black. See assets/ATTRIBUTION.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse, type Font, type Glyph } from 'opentype.js';

const OUT = 'public/brand';
const FONTS = 'public/assets/fonts';

function loadFont(file: string): Font {
  const b = readFileSync(`${FONTS}/${file}`);
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}
const oswald = loadFont('oswald-latin-700-normal.woff');
const cinzel = loadFont('cinzel-latin-900-normal.woff');

// ---------------------------------------------------------------------------------------------------------------
// Text → outlines

interface Run {
  glyphs: { g: Glyph; x: number; w: number }[];
  width: number;
}

function run(font: Font, text: string, size: number, tracking = 0): Run {
  const s = size / font.unitsPerEm;
  const glyphs: Run['glyphs'] = [];
  let x = 0;
  let prev: Glyph | undefined;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, g) * s;
    const w = (g.advanceWidth ?? 0) * s;
    glyphs.push({ g, x, w });
    x += w + tracking;
    prev = g;
  }
  return { glyphs, width: x - tracking };
}

/** Straight text, centred on cx (or left-aligned at cx when `align` is 'start'). */
function lineText(
  font: Font,
  text: string,
  cx: number,
  baseline: number,
  size: number,
  tracking = 0,
  align = 'middle',
) {
  const r = run(font, text, size, tracking);
  const x0 = align === 'start' ? cx : cx - r.width / 2;
  return r.glyphs.map(({ g, x }) => g.getPath(x0 + x, baseline, size).toPathData(2)).join('');
}

/** Text on a circle. `top`: reads along the upper arc (baseline outside), else along the lower arc (smile). */
function arcText(
  font: Font,
  text: string,
  cx: number,
  cy: number,
  r: number,
  size: number,
  tracking: number,
  top: boolean,
) {
  const t = run(font, text, size, tracking);
  return t.glyphs
    .map(({ g, x, w }) => {
      const phi = (x + w / 2 - t.width / 2) / r;
      const px = cx + r * Math.sin(phi);
      const py = top ? cy - r * Math.cos(phi) : cy + r * Math.cos(phi);
      const deg = ((top ? phi : -phi) * 180) / Math.PI;
      const d = g.getPath(-w / 2, 0, size).toPathData(2);
      return `<path transform="translate(${px.toFixed(2)} ${py.toFixed(2)}) rotate(${deg.toFixed(2)})" d="${d}"/>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Symmetric path builder: describe the left half from a point on the axis (x = AX) to another point on the axis.

type P = [number, number];
type Seg = { c1: P; c2: P; p: P } | { p: P };
const AX = 160;
const mx = ([x, y]: P): P => [2 * AX - x, y];
const f = (p: P) => `${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`;

function sym(start: P, segs: Seg[]): string {
  let d = `M${f(start)}`;
  for (const s of segs) d += 'c1' in s ? `C${f(s.c1)} ${f(s.c2)} ${f(s.p)}` : `L${f(s.p)}`;
  // Walk back up the mirrored right half.
  const pts: P[] = [start, ...segs.map((s) => s.p)];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const to = mx(pts[i]);
    d += 'c1' in s ? `C${f(mx(s.c2))} ${f(mx(s.c1))} ${f(to)}` : `L${f(to)}`;
  }
  return d + 'Z';
}
const C = (c1: P, c2: P, p: P): Seg => ({ c1, c2, p });
const L = (p: P): Seg => ({ p });

/** Mirror a left-side closed path (absolute M/C/L/Z only) to the right side of the axis. */
function mirrorPath(d: string) {
  return d.replace(
    /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
    (_m, x, y) => `${+(2 * AX - +x).toFixed(2)} ${y}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry (viewBox 0 0 320 400)

const TAB_C: P = [160, 320];
const TAB_R1 = 292;
const TAB_R0 = 248;
const TAB_HALF = (27 * Math.PI) / 180;
const SHIELD_R = 232;

function tabPath() {
  const [cx, cy] = TAB_C;
  const s = Math.sin(TAB_HALF);
  const c = Math.cos(TAB_HALF);
  const o0: P = [cx - TAB_R1 * s, cy - TAB_R1 * c];
  const o1: P = [cx + TAB_R1 * s, cy - TAB_R1 * c];
  const i1: P = [cx + TAB_R0 * s, cy - TAB_R0 * c];
  const i0: P = [cx - TAB_R0 * s, cy - TAB_R0 * c];
  return `M${f(o0)}A${TAB_R1} ${TAB_R1} 0 0 1 ${f(o1)}L${f(i1)}A${TAB_R0} ${TAB_R0} 0 0 0 ${f(i0)}Z`;
}

function shieldPath() {
  const dy = Math.sqrt(SHIELD_R ** 2 - 120 ** 2);
  const y = TAB_C[1] - dy;
  return `M40 ${y.toFixed(2)}A${SHIELD_R} ${SHIELD_R} 0 0 1 280 ${y.toFixed(2)}L280 262C280 322 214 360 160 388C106 360 40 322 40 262Z`;
}

// The shade: hood, face opening, skull.
const HOOD = sym(
  [160, 122],
  [
    C([130, 122], [104, 142], [96, 178]),
    C([90, 208], [94, 238], [82, 268]),
    C([76, 284], [66, 296], [56, 304]),
    L([56, 330]),
    L([160, 330]),
  ],
);
const OPENING = sym(
  [160, 142],
  [
    C([139, 143], [123, 157], [119, 180]),
    C([115, 204], [117, 234], [125, 260]),
    C([133, 284], [147, 297], [160, 299]),
  ],
);
const SKULL = sym(
  [160, 158],
  [
    C([140, 158], [122, 165], [118, 181]),
    C([115, 193], [113, 205], [116, 214]),
    C([123, 221], [131, 227], [136, 235]),
    L([137, 243]),
    C([134, 251], [132, 262], [136, 270]),
    C([142, 280], [152, 284], [160, 284]),
  ],
);
/** The hood brim's shadow across the brow: only the brow ridge and the sockets read under it. */
const SHADE = sym([160, 150], [L([112, 150]), L([112, 186]), C([126, 178], [146, 177], [160, 180])]);
const EYE_L =
  'M121 187C132 186 144 189 154 195C158 199 157 206 153 212C147 219 135 220 127 214C120 208 119 197 121 187Z';
const NOSE = sym([160, 219], [C([157, 225], [153, 231], [151, 237]), C([154, 241], [158, 240], [160, 236])]);
const MOUTH_GAP = sym(
  [160, 252],
  [C([150, 252], [143, 251], [137, 249]), C([139, 255], [150, 256], [160, 256])],
);
const TEETH =
  [141.5, 147.5, 153.8, 160, 166.2, 172.5, 178.5].map((x) => `M${x} 242V266`).join('') + 'M138 254H182';
const CHEEK_L = 'M117 214C124 216 130 222 135 231';
const HOOD_FOLDS_L =
  'M112 160C104 186 104 214 100 244M108 252C102 270 94 284 84 294M134 132C122 140 114 150 110 162';
const SCROLL = 'M30 300Q160 324 290 300L290 332Q160 356 30 332Z';

// ---------------------------------------------------------------------------------------------------------------
// Thread palette

const PAL = {
  od: '#545539',
  odDark: '#3a3b2a',
  black: '#1b1c17',
  coyote: '#a28a5f',
  coyoteHi: '#c1aa7c',
  merrow: '#202119',
};

/** Fill-stitch pattern: rows of staggered stitches at an angle, like machine embroidery fill. */
function stitch(id: string, base: string, hi: string, angle: number, len = 7) {
  const h = 2.2;
  return `<pattern id="${id}" width="${len * 2}" height="${h * 2}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">
  <rect width="${len * 2}" height="${h * 2}" fill="${base}"/>
  <path d="M0 ${h * 0.5}H${len * 2}M0 ${h * 1.5}H${len * 2}" stroke="${hi}" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="${len - 1.2} 1.2" opacity=".55"/>
  <path d="M${len / 2} ${h * 1.5}H${len * 2.5}" stroke="${base}" stroke-width="1.1" stroke-dasharray="${len - 1.2} 1.2" opacity=".6"/>
  <path d="M0 0H${len * 2}M0 ${h}H${len * 2}M0 ${h * 2}H${len * 2}" stroke="#000" stroke-width=".45" opacity=".45"/>
</pattern>`;
}

const DEFS = `<defs>
<pattern id="twill" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
  <rect width="3" height="3" fill="${PAL.od}"/><rect width="3" height="1.1" fill="#000" opacity=".22"/>
  <rect y="2" width="3" height=".5" fill="#fff" opacity=".05"/>
</pattern>
${stitch('st-coyote-a', PAL.coyote, PAL.coyoteHi, -24)}
${stitch('st-coyote-b', PAL.coyote, PAL.coyoteHi, 8, 9)}
${stitch('st-coyote-c', PAL.coyote, PAL.coyoteHi, 62, 5)}
${stitch('st-olive', PAL.odDark, '#55573f', 68, 8)}
${stitch('st-black', PAL.black, '#3b3c33', -50, 6)}
${stitch('st-black-tab', PAL.black, '#45463b', 90, 4)}
<pattern id="merrow" width="1.6" height="12" patternUnits="userSpaceOnUse">
  <rect width="1.6" height="12" fill="${PAL.merrow}"/><rect width=".8" height="12" fill="#5b5c4a"/>
</pattern>
<filter id="thread" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="fz"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="b"/>
  <feDiffuseLighting in="b" surfaceScale="2.6" diffuseConstant="1" lighting-color="#fff" result="diff">
    <feDistantLight azimuth="235" elevation="52"/></feDiffuseLighting>
  <feSpecularLighting in="b" surfaceScale="2.6" specularConstant=".55" specularExponent="16" lighting-color="#fff" result="spec">
    <feDistantLight azimuth="235" elevation="40"/></feSpecularLighting>
  <feComposite in="fz" in2="diff" operator="arithmetic" k1="1.32" result="lit"/>
  <feComposite in="spec" in2="fz" operator="in" result="specIn"/>
  <feComposite in="lit" in2="specIn" operator="arithmetic" k2="1" k3=".22"/>
  <feComposite in2="fz" operator="in" result="out"/>
  <feDropShadow dx=".6" dy=".9" stdDeviation=".5" flood-color="#000" flood-opacity=".55"/>
</filter>
<filter id="roll" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="9" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="fz"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="2.6" result="b"/>
  <feDiffuseLighting in="b" surfaceScale="5" diffuseConstant="1.05" lighting-color="#fff" result="diff">
    <feDistantLight azimuth="235" elevation="48"/></feDiffuseLighting>
  <feSpecularLighting in="b" surfaceScale="5" specularConstant=".5" specularExponent="12" lighting-color="#fff" result="spec">
    <feDistantLight azimuth="235" elevation="38"/></feSpecularLighting>
  <feComposite in="fz" in2="diff" operator="arithmetic" k1="1.45" result="lit"/>
  <feComposite in="spec" in2="fz" operator="in" result="specIn"/>
  <feComposite in="lit" in2="specIn" operator="arithmetic" k2="1" k3=".25"/>
  <feComposite in2="fz" operator="in"/>
</filter>
<filter id="cloth" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="2" result="lo"/>
  <feColorMatrix in="lo" type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  .9 0 0 0 -.15" result="lo2"/>
  <feComposite in="lo2" in2="SourceAlpha" operator="in" result="mott"/>
  <feBlend in="SourceGraphic" in2="mott" mode="multiply" result="m"/>
  <feComposite in="m" in2="SourceAlpha" operator="in" result="patch"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="3.5"/>
  <feOffset dx="2" dy="4" result="sh"/>
  <feFlood flood-color="#000" flood-opacity=".6"/>
  <feComposite in2="sh" operator="in" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="patch"/></feMerge>
</filter>
<clipPath id="shield-clip"><path d="${shieldPath()}"/></clipPath>
<clipPath id="skull-clip"><path d="${SKULL}"/></clipPath>
<clipPath id="tab-clip"><path d="${tabPath()}"/></clipPath>
</defs>`;

function merrow(d: string) {
  // Overlocked edge: a dark core, then a tight perpendicular wrap (dash pattern) rolled with lighting.
  return `<g filter="url(#roll)">
  <path d="${d}" fill="none" stroke="${PAL.merrow}" stroke-width="13" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="#575848" stroke-width="11" stroke-dasharray=".8 1" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="#000" stroke-width="1" opacity=".55" transform="translate(0 0)"/>
</g>`;
}

function star(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function patchSvg() {
  const tabMid = (TAB_R0 + TAB_R1) / 2;
  const tabText = arcText(oswald, 'UMBRA', TAB_C[0], TAB_C[1], tabMid - 11, 31, 9, true);
  const motto = arcText(cinzel, 'SEMPER IN UMBRA', 160, -46, 380, 14.5, 1.6, false);
  const eyeR = mirrorPath(EYE_L);
  const cheekR = mirrorPath(CHEEK_L);
  const foldsR = mirrorPath(HOOD_FOLDS_L);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400" width="320" height="400">
<title>UMBRA CO. shoulder patch</title>
${DEFS}
<g filter="url(#cloth)">
  <g id="tab">
    <path d="${tabPath()}" fill="url(#twill)"/>
    <g clip-path="url(#tab-clip)" filter="url(#thread)" fill="url(#st-black-tab)">${tabText}</g>
    ${merrow(tabPath())}
  </g>
  <g id="shield">
    <path d="${shieldPath()}" fill="url(#twill)"/>
    <g clip-path="url(#shield-clip)">
      <g filter="url(#thread)">
        <circle cx="160" cy="196" r="88" fill="none" stroke="url(#st-coyote-c)" stroke-width="8"/>
        <circle cx="160" cy="196" r="78" fill="none" stroke="${PAL.black}" stroke-width="2.4"/>
      </g>
      <g filter="url(#thread)">
        <path d="${HOOD}" fill="url(#st-olive)" stroke="${PAL.black}" stroke-width="3.2" stroke-linejoin="round"/>
        <path d="${HOOD_FOLDS_L}${foldsR}" fill="none" stroke="${PAL.black}" stroke-width="2.2" stroke-linecap="round"/>
      </g>
      <g filter="url(#thread)"><path d="${OPENING}" fill="url(#st-black)"/></g>
      <g filter="url(#thread)">
        <path d="${SKULL}" fill="url(#st-coyote-a)" stroke="${PAL.black}" stroke-width="2.2" stroke-linejoin="round"/>
      </g>
      <g filter="url(#thread)" clip-path="url(#skull-clip)"><path d="${SHADE}" fill="url(#st-black)"/></g>
      <g filter="url(#thread)" fill="url(#st-black)" stroke="${PAL.black}" stroke-width="1.6" stroke-linejoin="round">
        <path d="${EYE_L}${eyeR}"/>
        <path d="${NOSE}"/>
        <path d="${MOUTH_GAP}"/>
        <path d="${TEETH}${CHEEK_L}${cheekR}" fill="none" stroke-width="2" stroke-linecap="round"/>
      </g>
      <g filter="url(#thread)">
        <path d="${SCROLL}" fill="url(#st-coyote-b)" stroke="${PAL.black}" stroke-width="2.4"/>
        <g fill="${PAL.black}">${motto}</g>
      </g>
      <g filter="url(#thread)"><path d="${star(160, 358, 9)}" fill="url(#st-coyote-c)" stroke="${PAL.black}" stroke-width="1.4" stroke-linejoin="round"/></g>
    </g>
    ${merrow(shieldPath())}
  </g>
</g>
</svg>
`;
}

/** Monochrome mark (white on transparent; colour it via CSS mask or opacity). Cropped to the shade + ring. */
function markSvg(fill = '#fff', title = 'UMBRA CO. mark') {
  const eyeR = mirrorPath(EYE_L);
  const cheekR = mirrorPath(CHEEK_L);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="64 100 192 216" width="192" height="216">
<title>${title}</title>
<defs>
<clipPath id="sk"><path d="${OPENING}"/></clipPath>
<clipPath id="mk-clip"><rect x="0" y="0" width="320" height="306"/></clipPath>
<mask id="mk" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="400">
  <g clip-path="url(#mk-clip)">
    <circle cx="160" cy="196" r="88" fill="none" stroke="#fff" stroke-width="9"/>
    <path d="${HOOD}" fill="#000" stroke="#000" stroke-width="10"/>
    <path d="${HOOD}" fill="#fff"/>
    <path d="${OPENING}" fill="#000" stroke="#000" stroke-width="2"/>
    <path d="${SKULL}" fill="#fff"/>
    <path d="${SHADE}" fill="#000" clip-path="url(#sk)"/>
    <path d="${EYE_L}${eyeR}${NOSE}${MOUTH_GAP}" fill="#000"/>
    <path d="${TEETH}${CHEEK_L}${cheekR}" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>
  </g>
</mask>
</defs>
<rect x="0" y="0" width="320" height="400" fill="${fill}" mask="url(#mk)"/>
</svg>
`;
}

function faviconSvg() {
  const eyeR = mirrorPath(EYE_L);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<title>SHORTBARREL</title>
<defs>
<mask id="fm" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="400">
  <rect width="320" height="304" fill="#000"/>
  <g clip-path="url(#fc)">
    <path d="${HOOD}" fill="#fff"/>
    <path d="${OPENING}" fill="#000"/>
    <path d="${SKULL}" fill="#fff"/>
    <path d="${SHADE}" fill="#000" clip-path="url(#sk)"/>
    <path d="${EYE_L}${eyeR}${NOSE}" fill="#000"/>
  </g>
</mask>
<clipPath id="sk"><path d="${OPENING}"/></clipPath>
<clipPath id="fc"><rect width="320" height="304"/></clipPath>
</defs>
<rect width="64" height="64" rx="12" fill="${PAL.odDark}"/>
<rect x="2" y="2" width="60" height="60" rx="10" fill="none" stroke="${PAL.coyote}" stroke-width="2" opacity=".55"/>
<g transform="translate(32 33) scale(.27) translate(-160 -214)">
  <circle cx="160" cy="196" r="88" fill="none" stroke="${PAL.coyote}" stroke-width="10"/>
  <rect width="320" height="400" fill="${PAL.coyoteHi}" mask="url(#fm)"/>
</g>
</svg>
`;
}

function wordmarkSvg(mono: boolean) {
  const size = 64;
  const tracking = 7;
  const a = run(oswald, 'SHORT', size, tracking).width;
  const b = run(oswald, 'BARREL', size, tracking).width;
  const gap = 10;
  const w = Math.ceil(a + gap + b);
  const fg = '#e8e4da';
  const ac = mono ? fg : PAL.coyoteHi;
  const short = lineText(oswald, 'SHORT', 0, 78, size, tracking, 'start');
  const barrel = lineText(oswald, 'BARREL', a + gap, 78, size, tracking, 'start');
  // A short "barrel" rule under SHORT and a long one under BARREL: the name, drawn.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 0 ${w + 4} 100" width="${w + 4}" height="100">
<title>SHORTBARREL</title>
<path d="${short}" fill="${fg}"/>
<path d="${barrel}" fill="${ac}"/>
<rect x="0" y="88" width="${(a * 0.42).toFixed(1)}" height="5" fill="${fg}"/>
<rect x="${(a * 0.42 + 6).toFixed(1)}" y="88" width="${(w - a * 0.42 - 6).toFixed(1)}" height="5" fill="${ac}" opacity="${mono ? 0.5 : 0.85}"/>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/umbra-patch.svg`, patchSvg());
writeFileSync(`${OUT}/umbra-mark.svg`, markSvg());
writeFileSync(`${OUT}/favicon.svg`, faviconSvg());
writeFileSync(`${OUT}/shortbarrel-wordmark.svg`, wordmarkSvg(false));
writeFileSync(`${OUT}/shortbarrel-wordmark-mono.svg`, wordmarkSvg(true));
console.log(
  'brand: wrote',
  ['umbra-patch', 'umbra-mark', 'favicon', 'shortbarrel-wordmark(-mono)'].join(', '),
);
