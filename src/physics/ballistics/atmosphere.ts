/**
 * ICAO standard atmosphere (troposphere) with optional temperature/pressure overrides and humidity.
 * Ballistic tables are referenced to ρ0 = 1.225 kg/m³ (ICAO); the drag model scales by ρ/ρ0 implicitly
 * by using the real density.
 */

export interface Atmosphere {
  /** kg/m³ */
  density: number;
  /** m/s */
  soundSpeed: number;
  tempC: number;
  pressurePa: number;
}

const R_DRY = 287.058;
const R_VAP = 461.495;
const LAPSE = 0.0065;
const T0 = 288.15;
const P0 = 101325;

/** Saturation vapour pressure (Pa), Tetens. */
const pSat = (tc: number) => 610.78 * Math.exp((17.27 * tc) / (tc + 237.3));

/**
 * Atmosphere at `altitude` metres. `tempC`/`pressurePa` default to ISA at that altitude; `humidity` 0..1.
 * Humid air is slightly *less* dense (water vapour is lighter than N2/O2).
 */
export function atmosphere(
  o: { altitude?: number; tempC?: number; pressurePa?: number; humidity?: number } = {},
): Atmosphere {
  const h = o.altitude ?? 0;
  const tIsa = T0 - LAPSE * h;
  const T = o.tempC !== undefined ? o.tempC + 273.15 : tIsa;
  const P = o.pressurePa ?? P0 * Math.pow(tIsa / T0, 5.25588);
  const pv = (o.humidity ?? 0) * pSat(T - 273.15);
  const density = (P - pv) / (R_DRY * T) + pv / (R_VAP * T);
  return { density, soundSpeed: 331.3 * Math.sqrt(T / 273.15), tempC: T - 273.15, pressurePa: P };
}

/** Sea-level ISA: ρ = 1.225 kg/m³, c = 340.3 m/s, 15 °C. */
export const ISA = atmosphere();
