import { Color, MeshStandardMaterial } from 'three';
import { sourceMaterial } from './sourceAssets';

/**
 * Restyle of the AK pack's Ch08 arms: bare hands → tactical gloves, hoodie → combat-shirt sleeves.
 * The source albedo is reduced to its luminance (keeps the baked folds/knuckle shading) and recoloured;
 * the normal maps are kept. Sleeves get a procedural ripstop grid; gloves get synthetic-leather palms
 * (darker where the source skin is darker) and a slightly glossier, rubbery finish.
 */
export interface ArmsLook {
  glove: Color;
  gloveDark: Color;
  shirt: Color;
}

export const DEFAULT_LOOK: ArmsLook = {
  glove: new Color(0.2, 0.17, 0.13), // coyote synthetic back
  gloveDark: new Color(0.045, 0.045, 0.048), // black palm / knuckle panels
  shirt: new Color(0.21, 0.225, 0.16), // ranger green
};

function recolor(m: MeshStandardMaterial, kind: 'glove' | 'shirt', look: ArmsLook) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uA = { value: kind === 'glove' ? look.glove : look.shirt };
    sh.uniforms.uB = { value: kind === 'glove' ? look.gloveDark : look.shirt.clone().multiplyScalar(0.55) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uA;\nuniform vec3 uB;')
      .replace(
        '#include <map_fragment>',
        kind === 'glove'
          ? `#ifdef USE_MAP
  vec4 srcCol = texture2D( map, vMapUv );
  float lum = dot( srcCol.rgb, vec3( 0.299, 0.587, 0.114 ) );
  // Skin luminance → glove: creases and palms (darker skin) read as the darker panel.
  float panel = smoothstep( 0.42, 0.62, lum );
  vec3 glove = mix( uB, uA, panel ) * ( 0.65 + 0.7 * lum );
  diffuseColor.rgb *= glove;
#endif`
          : `#ifdef USE_MAP
  vec4 srcCol = texture2D( map, vMapUv );
  float lum = dot( srcCol.rgb, vec3( 0.299, 0.587, 0.114 ) );
  // Ripstop: a faint thicker thread on a fine grid.
  vec2 g = abs( fract( vMapUv * 260.0 ) - 0.5 );
  float rip = 1.0 - 0.05 * smoothstep( 0.42, 0.5, max( g.x, g.y ) );
  vec3 shirt = mix( uB, uA, smoothstep( 0.2, 0.75, lum ) ) * ( 0.5 + 0.55 * lum ) * rip;
  diffuseColor.rgb *= shirt;
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'arms-' + kind;
}

export async function armsMaterials(look: ArmsLook = DEFAULT_LOOK) {
  const [gloves, sleeves] = await Promise.all([sourceMaterial('Ch08_body'), sourceMaterial('Ch08_body1')]);
  gloves.name = 'ArmsGloves';
  sleeves.name = 'ArmsSleeves';
  recolor(gloves, 'glove', look);
  recolor(sleeves, 'shirt', look);
  gloves.roughness = 0.85;
  gloves.metalness = 0;
  gloves.normalScale.set(1.2, 1.2);
  sleeves.roughness = 1;
  sleeves.metalness = 0;
  return { gloves, sleeves };
}
