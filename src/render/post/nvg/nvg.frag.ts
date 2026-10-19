/**
 * Gear post pass (one full-res fragment, runs only while NVGs are down or a flash is decaying): image
 * intensifier view (photocathode response, ABC gain, blooming halos, scintillation, persistence lag, fibre
 * honeycomb, phosphor, monocular/dual tube masks, flip/power-on swirl) and the flashbang sensor white-out with
 * a burned-in ghost of the bang frame. Output stays scene-linear HDR so CAM04 develops it like any image.
 */
export const nvgFrag = /* glsl */ `
uniform sampler2D tState;   // 1×1: r = tube gain (EV)
uniform sampler2D tHist;    // 1/4 res: r = persistence luminance, g = flash ghost
uniform vec4 uNvg;          // on (0/1), user gain (linear), phosphor (0 green … 1 white), dual (0/1)
uniform vec4 uTube;         // centre x, y (half-height units), radius, swirl (rad)
uniform vec4 uFx;           // seed, power 0..1, noise mul, halo mul
uniform vec4 uFlash;        // white-out 0..1, ghost 0..1, -, -

float nHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Photocathode response: Gen3 GaAs is red/near-IR heavy (foliage and skin read bright, blue sky dark).
float nResp(vec3 c) { return dot(c, vec3(0.52, 0.36, 0.12)); }

vec2 nToP(vec2 uv) { return (uv * 2.0 - 1.0) * vec2(aspect, 1.0); }
vec2 nToUv(vec2 p) { return p / vec2(aspect, 1.0) * 0.5 + 0.5; }

// Hexagonal fibre-optic bundle pattern: ~0 at fibre centres, 1 at boundaries.
float nHex(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return smoothstep(0.25, 0.5, length(g));
}

const vec2 nDisc[12] = vec2[12](
  vec2(1.0, 0.0), vec2(0.5, 0.866), vec2(-0.5, 0.866), vec2(-1.0, 0.0), vec2(-0.5, -0.866), vec2(0.5, -0.866),
  vec2(0.45, 0.26), vec2(0.0, 0.52), vec2(-0.45, 0.26), vec2(-0.45, -0.26), vec2(0.0, -0.52), vec2(0.45, -0.26)
);

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  if (uNvg.x > 0.5) {
    vec2 p = nToP(uv);
    float r = uTube.z;
    // Tube(s): monocular over the right eye, or a dual-tube binocular overlap.
    vec2 c0 = uTube.xy;
    vec2 cA = uNvg.w > 0.5 ? c0 - vec2(0.52, 0.0) : c0;
    vec2 cB = uNvg.w > 0.5 ? c0 + vec2(0.52, 0.0) : c0;
    float dA = length(p - cA), dB = length(p - cB);
    vec2 cc = dA < dB ? cA : cB;
    float d = min(dA, dB);
    float m = 1.0 - smoothstep(r - 0.035, r, d);
    vec3 naked = uNvg.w > 0.5 ? col * 0.015 : col * 0.3;
    if (m > 0.0) {
      // Power-on swirl: the image twists into place as the tube spins up.
      vec2 q = p - cc;
      float ang = uTube.w * (1.0 - clamp(length(q) / r, 0.0, 1.0));
      float cs = cos(ang), sn = sin(ang);
      vec2 qs = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
      vec2 suv = nToUv(cc + qs);
      vec3 s = abs(ang) > 1e-3 ? texture2D(inputBuffer, suv).rgb : col;
      float ev = texture2D(tState, vec2(0.5)).r;
      float g = exp2(ev) * uNvg.y;
      float lum = nResp(s);
      // Phosphor persistence: bright things smear as you turn.
      lum = max(lum, texture2D(tHist, suv).r * 0.6);
      float sig = lum * g;
      // Blooming halos: bright point sources grow a soft disc (the tube's halo, not a lens flare).
      float halo = 0.0;
      vec2 hr = vec2(0.045 / aspect, 0.045);
      for (int i = 0; i < 12; i++) {
        float t = nResp(texture2D(inputBuffer, suv + nDisc[i] * hr).rgb) * g;
        halo += max(t - 1.4, 0.0);
      }
      sig += halo * (1.0 / 12.0) * 0.8 * uFx.w;
      // Scintillation: photon-starved sparkle that grows with gain; refreshed every frame.
      float nz = clamp((ev - 2.0) / 7.5, 0.0, 1.0) * uFx.z;
      vec2 cell = floor(uv * resolution);
      float h1 = nHash(cell + uFx.x * 13.17);
      float h2 = nHash(cell * 1.71 + uFx.x * 7.31 + 3.1);
      sig += (h1 - 0.5) * (0.04 + 0.4 * nz) * (0.15 + sqrt(max(sig, 0.0)));
      if (h2 > 1.0 - (0.0003 + 0.003 * nz)) sig += 1.4;
      // Tube output saturates (it can't get brighter than the phosphor screen).
      float o = 1.0 - exp(-1.3 * max(sig, 0.0));
      // Tube contrast: blacks stay down, highlights roll off.
      o = pow(o, 1.35) * 1.2;
      // Fibre honeycomb + a few fixed blemishes (dark spots that stay put in the tube).
      vec2 tq = q / r;
      o *= 1.0 - 0.05 * nHex(tq * 160.0);
      float bl = nHash(floor((tq + 2.0) * 22.0));
      o *= bl > 0.993 ? 0.55 : 1.0;
      // Intensifier rolls off toward the rim.
      float rr = clamp(d / r, 0.0, 1.0);
      o *= 1.0 - 0.38 * rr * rr * rr;
      vec3 phos = mix(vec3(0.27, 1.0, 0.36), vec3(0.78, 0.86, 1.0), uNvg.z);
      vec3 tube = phos * o * 0.85 * uFx.y;
      // Housing/eyecup: a soft black ring between the tube and the naked eye.
      float ring = smoothstep(r - 0.035, r + 0.02, d) * (1.0 - smoothstep(r + 0.02, r + 0.16, d));
      col = mix(naked * (1.0 - 0.85 * ring), tube, m);
    } else {
      float ring = 1.0 - smoothstep(r + 0.02, r + 0.16, d);
      col = naked * (1.0 - 0.85 * ring);
    }
  }
  // Flashbang: burned-in ghost of the bang frame + sensor white-out.
  vec2 hst = texture2D(tHist, uv).rg;
  col += hst.g * uFlash.y * 3.0;
  col = mix(col, vec3(14.0, 13.6, 12.8), uFlash.x * sqrt(uFlash.x));
  outputColor = vec4(col, inputColor.a);
}
`;

/** 1×1 ABC state: meters the photocathode response over the tube's field and steps the gain (abc.ts). */
export const stateFrag = (abc: string) => /* glsl */ `
precision highp float;
uniform sampler2D tPrev;
uniform sampler2D tInput;
uniform vec4 uAbc;   // target, maxEv, minEv, userEv
uniform vec2 uTau;   // down, up
uniform vec4 uTime;  // dt, reset (0/1), reset EV, seed
varying vec2 vUv;
${abc}
void main() {
  float sum = 0.0, peak = -30.0;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 o = vec2(float(i) + fract(uTime.w * 0.37 + float(j) * 0.618), float(j) + fract(uTime.w * 0.71 + float(i) * 0.382)) / 8.0;
      vec2 uv = 0.2 + 0.6 * o;
      vec3 c = texture2D(tInput, uv).rgb;
      float L = log2(max(dot(c, vec3(0.52, 0.36, 0.12)), 1e-6));
      sum += L;
      peak = max(peak, L);
    }
  }
  // Bright-source protection weights the hottest spot in.
  float meter = mix(sum / 64.0, peak, 0.22);
  vec4 prev = texture2D(tPrev, vec2(0.5));
  float ev = (uTime.y > 0.5 || prev.a < 0.5) ? uTime.z : prev.r;
  ev = abcStep(ev, meter, uTime.x);
  gl_FragColor = vec4(ev, meter, 0.0, 1.0);
}
`;

/** 1/4-res history: r = phosphor persistence, g = flash ghost (captured at the bang, decays slowly). */
export const histFrag = /* glsl */ `
precision highp float;
uniform sampler2D tPrev;
uniform sampler2D tInput;
uniform vec4 uHist;  // persistence decay, ghost decay, ghost capture (0..1), reset
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float L = dot(c, vec3(0.52, 0.36, 0.12));
  vec4 prev = uHist.w > 0.5 ? vec4(0.0) : texture2D(tPrev, vUv);
  float pers = max(L, prev.r * uHist.x);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float ghost = max(prev.g * uHist.y, uHist.z * lum / (lum + 0.6));
  gl_FragColor = vec4(min(pers, 64.0), ghost, 0.0, 1.0);
}
`;

export const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
