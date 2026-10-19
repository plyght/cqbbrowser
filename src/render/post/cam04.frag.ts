/**
 * CAM04 merged post shader: one full-resolution fragment does the whole "camera":
 * lens (Brown–Conrady + image circle + radial CA + edge softness), rolling shutter, shutter motion blur,
 * near-lens defocus, halation/bloom, lens dirt, auto-exposure, white balance, sensor tone curve with
 * highlight clip, sensor noise, ISP over-sharpening, and an H.264-ish encoder (8×8 block quantisation,
 * 4:2:0 chroma, starvation, GOP breathing). Expensive neighbourhood work reads the shared half-res mip
 * pyramid instead of the full-res buffer.
 *
 * Defines: MB_TAPS (0 = no motion blur), NEAR_BLUR, LENS_DIRT.
 */
export const cam04Frag = /* glsl */ `
uniform sampler2D tMip0;     // 1/2 res (blur pyramid level 0)
uniform sampler2D tMip1;     // 1/4 res
uniform sampler2D tMip2;     // 1/8 res (≈ one texel per codec macroblock)
uniform sampler2D tBloom;    // upsampled multi-scale blur (halation)
uniform sampler2D tExposure; // 1×1 AE state
uniform sampler2D tDirt;
uniform vec4 uLens;     // k1, k2, crop scale, image-circle radius (half-height units)
uniform vec4 uLens2;    // circle feather, CA, edge softness, vignette
uniform vec2 uTanHalf;  // tan(half fov) x, y of the render camera
uniform mat3 uBlurRot;  // current view → view at shutter open
uniform vec4 uBlur;     // strength, shutter EV reference, max shutter stretch, unused
uniform vec2 uRoll;     // rolling-shutter shift per unit row (half-height units)
uniform vec4 uNear;     // start dist (m), full-blur dist (m), strength, bleed radius (uv)
uniform vec4 uPost;     // bloom, dirt, sharpen, saturation
uniform vec4 uNoise;    // luma grain, chroma grain, seed, noise-gain EV reference
uniform vec4 uCodec;    // quant step, detail keep, chroma smear, block chroma mix
uniform vec3 uWB;
uniform vec4 uExpo;     // EV bias, boot EV, fade (1 = visible), flash
uniform float uGamma;   // display gamma exponent (1 / settings gamma)
uniform vec4 uGrade;    // contrast, warm highlights, shadow lift, ring glow

float cHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Output uv → half-height units → distorted source uv.
vec2 cToP(vec2 uv) { return (uv * 2.0 - 1.0) * vec2(aspect, 1.0); }
vec2 cSrc(vec2 p, float k) {
  float r2 = dot(p, p);
  float f = (1.0 + uLens.x * r2 + uLens.y * r2 * r2) * uLens.z * k;
  return (p * f) / vec2(aspect, 1.0) * 0.5 + 0.5;
}

vec3 cAces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Scene-linear → display-linear through the CAM04 "sensor + ISP" response.
vec3 cDevelop(vec3 hdr, float expo) {
  vec3 c = hdr * expo * uWB;
  float l = cLuma(c);
  c = mix(vec3(l), c, uPost.w);
  c = cAces(c * uGrade.x) ;
  // Warm/peach roll-off as channels clip; slight shadow lift (compressed blacks, not crushed).
  float dl = cLuma(c);
  c = mix(c, c * vec3(1.05, 0.99, 0.9) + vec3(0.02, 0.0, -0.01), smoothstep(0.55, 1.0, dl) * uGrade.y);
  c = c + uGrade.z * (1.0 - c) * (1.0 - smoothstep(0.0, 0.25, dl));
  return clamp(c, 0.0, 1.0);
}

vec3 cToYCC(vec3 c) {
  float y = cLuma(c);
  return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
}
vec3 cFromYCC(vec3 y) {
  float r = y.x + 1.403 * y.z;
  float b = y.x + 1.773 * y.y;
  float g = (y.x - 0.299 * r - 0.114 * b) / 0.587;
  return vec3(r, g, b);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 ae = texture2D(tExposure, vec2(0.5));
  float ev = ae.r + uExpo.x + uExpo.y;
  float expo = exp2(ev);

  vec2 p = cToP(uv);
  float rOut = length(p);
  // Rolling shutter: rows read out later see a rotated scene.
  p += uRoll * p.y;
  float r = length(p);

  // Lens: per-channel magnification gives lateral CA growing with r².
  float ca = uLens2.y * r * r;
  vec2 uvG = cSrc(p, 1.0);
  vec2 uvR = cSrc(p, 1.0 + ca);
  vec2 uvB = cSrc(p, 1.0 - ca);
  vec3 col = vec3(texture2D(inputBuffer, uvR).r, texture2D(inputBuffer, uvG).g, texture2D(inputBuffer, uvB).b);
  vec3 wide = texture2D(tMip0, uvG).rgb;
  float soft = 0.0; // how much of the pixel is blurred (reduces sharpening)

#if MB_TAPS > 0
  // Shutter motion blur from camera rotation; longer shutter when the AE is wide open (dark scenes).
  {
    vec2 ndc = uvG * 2.0 - 1.0;
    vec3 v = vec3(ndc * uTanHalf, -1.0);
    vec3 v2 = uBlurRot * v;
    vec2 ndc2 = (v2.xy / max(-v2.z, 1e-3)) / uTanHalf;
    float stretch = clamp(exp2((ae.r - uBlur.y) * 0.5), 1.0, uBlur.z);
    vec2 duv = (ndc2 - ndc) * 0.5 * uBlur.x * stretch;
    float px = length(duv * resolution);
    // Cap the smear length (keeps taps from separating into ghost copies).
    duv *= min(1.0, 90.0 / max(px, 1e-3));
    px = min(px, 90.0);
    if (px > 1.5) {
      vec3 acc = vec3(0.0);
      float jit = cHash(uv * resolution + uNoise.z) - 0.5;
      for (int i = 0; i < MB_TAPS; i++) {
        float t = (float(i) + 0.5 + jit) / float(MB_TAPS) - 0.5;
        acc += texture2D(tMip0, uvG + duv * t).rgb;
      }
      float m = smoothstep(1.5, 7.0, px);
      col = mix(col, acc / float(MB_TAPS), m);
      wide = mix(wide, acc / float(MB_TAPS), m);
      soft = max(soft, m);
    }
  }
#endif

#ifdef NEAR_BLUR
  // Objects inside ~0.5 m of the lens (gun, hands, optic) sit far inside the focus range → defocused.
  {
    float coc = smoothstep(uNear.x, uNear.y, -getViewZ(readDepth(uvG)));
    vec2 o = vec2(uNear.w, uNear.w * aspect);
    float n1 = smoothstep(uNear.x, uNear.y, -getViewZ(readDepth(uvG + vec2(o.x, 0.0))));
    float n2 = smoothstep(uNear.x, uNear.y, -getViewZ(readDepth(uvG - vec2(o.x, 0.0))));
    float n3 = smoothstep(uNear.x, uNear.y, -getViewZ(readDepth(uvG + vec2(0.0, o.y))));
    float n4 = smoothstep(uNear.x, uNear.y, -getViewZ(readDepth(uvG - vec2(0.0, o.y))));
    coc = max(coc, max(max(n1, n2), max(n3, n4)) * 0.75) * uNear.z;
    if (coc > 0.01) {
      vec2 d = vec2(uNear.w * 0.7) * vec2(1.0, aspect) * coc;
      vec3 b = texture2D(tMip1, uvG).rgb * 0.2;
      b += texture2D(tMip1, uvG + vec2(d.x, 0.0)).rgb * 0.2;
      b += texture2D(tMip1, uvG - vec2(d.x, 0.0)).rgb * 0.2;
      b += texture2D(tMip1, uvG + vec2(0.0, d.y)).rgb * 0.2;
      b += texture2D(tMip1, uvG - vec2(0.0, d.y)).rgb * 0.2;
      float m = smoothstep(0.0, 0.8, coc);
      col = mix(col, b, m);
      wide = mix(wide, b, m);
      soft = max(soft, m);
    }
  }
#endif

  // Edge softness: cheap lens falls apart toward the image circle.
  float edge = smoothstep(0.55, 1.0, rOut / uLens.w) * uLens2.z;
  if (edge > 0.001) {
    vec3 e = texture2D(tMip1, uvG).rgb;
    col = mix(col, e, edge);
    wide = mix(wide, e, edge);
    soft = max(soft, edge);
  }

  // Halation / bloom (threshold-free → exposure-invariant), boosted briefly by muzzle flash.
  vec3 glow = texture2D(tBloom, uvG).rgb;
  float bloomK = uPost.x * (1.0 + uExpo.w * 2.0);
  col += glow * bloomK;
  wide += glow * bloomK;
#ifdef LENS_DIRT
  vec3 dirt = texture2D(tDirt, uv).rgb;
  // Dirt scatters light from bright sources; mostly visible against highlights.
  vec3 lit = max(glow * expo - 0.35, 0.0);
  col += dirt * lit * uPost.y / expo;
#endif

  // Develop (sensor response, AE, WB, tone).
  vec3 d = cDevelop(col, expo);
  vec3 dw = cDevelop(wide, expo);

  // ISP over-sharpening (wide-radius unsharp mask) → bright/dark halos on edges.
  d = clamp(d + (d - dw) * uPost.z * (1.0 - soft * 0.7), 0.0, 1.0);

  // Sensor noise: luminance-dependent, amplified by analogue gain in dark scenes; chroma blotches in shadows.
  vec2 fc = floor(uv * resolution);
  float gain = exp2(clamp(ae.r - uNoise.w, 0.0, 6.0) * 0.5);
  float yv = cLuma(d);
  float n = (cHash(fc + uNoise.z) + cHash(fc * 1.37 + uNoise.z + 17.0) - 1.0);
  float shot = sqrt(max(yv, 0.002)) * (1.0 - yv * 0.6);
  vec2 cfc = floor(fc / 2.0);
  vec2 cn = vec2(cHash(cfc + uNoise.z * 1.3 + 41.0), cHash(cfc + uNoise.z * 0.7 + 83.0)) - 0.5;
  float shadow = (1.0 - smoothstep(0.0, 0.45, yv));

  // Encoder.
  vec3 ycc = cToYCC(d);
  ycc.x += n * uNoise.x * gain * shot;
  ycc.yz += cn * uNoise.y * gain * shadow;
  vec2 bc = (floor(uv * resolution / 8.0) + 0.5) * 8.0 / resolution;
  vec3 blk = cToYCC(cDevelop(texture2D(tMip2, cSrc(cToP(bc), 1.0)).rgb + glow * bloomK, expo));
  // 4:2:0: chroma from the 2×2-averaged half-res level.
  vec2 sub = cToYCC(dw).yz;
  ycc.yz = mix(ycc.yz, sub, uCodec.z);
  ycc.yz = mix(ycc.yz, blk.yz, uCodec.w);
  // Luma: block DC + quantised, attenuated AC.
  float ac = (ycc.x - blk.x) * uCodec.y;
  float q = uCodec.x;
  ac = q > 0.0005 ? floor(ac / q + 0.5) * q : ac;
  ycc.x = blk.x + ac;
  d = clamp(cFromYCC(ycc), 0.0, 1.0);

  // Vignette + image circle with warm/cyan fringe ring.
  float rc = rOut / uLens.w;
  d *= mix(1.0, smoothstep(1.05, 0.35, rc), uLens2.w);
  float fe = uLens2.x;
  float mr = smoothstep(uLens.w + fe * 0.5, uLens.w - fe * 0.5, rOut);
  float mg = smoothstep(uLens.w + fe * 0.2, uLens.w - fe * 0.8, rOut);
  float mb = smoothstep(uLens.w - fe * 0.1, uLens.w - fe * 1.1, rOut);
  float band = smoothstep(uLens.w - fe * 1.6, uLens.w - fe * 0.5, rOut);
  vec3 ring = vec3(1.0, 0.68, 0.38) * band * clamp(cLuma(glow) * expo, 0.0, 1.5) * uGrade.w;
  d = (d + ring) * vec3(mr, mg, mb);

  d *= uExpo.z;
  // Display gamma (settings): applied last, after the camera's own processing.
  d = pow(max(d, vec3(0.0)), vec3(uGamma));
  outputColor = vec4(d, 1.0);
}
`;
