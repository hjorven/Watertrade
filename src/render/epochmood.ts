import * as THREE from 'three';

/**
 * Farbstimmung je Epoche (Plan 5.8), über die Jahreszeiten gelegt:
 * - Treidelzeit: erdig, warmes Ocker, weiche Kontraste
 * - Dampf: Rauch und Backstein, dunstiger Himmel, rötlich-braune Töne, Nebel rückt näher
 * - Motor: kräftig, klare Luft, satte Farben, mehr Kontrast
 *
 * Die Werte sind Faktoren und Mischanteile, damit Jahreszeit und Epoche zusammenspielen.
 */
export interface EpochMood {
  /** Faktor auf die Grundsättigung der Nachbearbeitung */
  saturation: number;
  /** Kontrast um ein mittleres Grau, 1 = unverändert */
  contrast: number;
  /** Farbverschiebung, die zum Bild addiert wird */
  tint: THREE.Vector3;
  /** Farbe, zu der Himmel und Nebel gemischt werden, und wie stark */
  sky: THREE.Color;
  skyMix: number;
  /** Sonnenfarbe und Mischanteil */
  sun: THREE.Color;
  sunMix: number;
  /** Himmelslicht und Bodenlicht der Hemisphäre */
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  /** Faktor auf die Sichtweite des Nebels */
  fog: number;
}

const mood = (m: {
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  sky: number;
  skyMix: number;
  sun: number;
  sunMix: number;
  hemiSky: number;
  hemiGround: number;
  fog: number;
}): EpochMood => ({
  saturation: m.saturation,
  contrast: m.contrast,
  tint: new THREE.Vector3(...m.tint),
  sky: new THREE.Color(m.sky),
  skyMix: m.skyMix,
  sun: new THREE.Color(m.sun),
  sunMix: m.sunMix,
  hemiSky: new THREE.Color(m.hemiSky),
  hemiGround: new THREE.Color(m.hemiGround),
  fog: m.fog,
});

/** Index 0 = Epoche 1 */
export const EPOCH_MOODS: readonly EpochMood[] = [
  // erdig: Ocker und Lehm, etwas weniger Sättigung, weiche Kontraste
  mood({ saturation: 0.92, contrast: 0.95, tint: [0.04, 0.024, -0.025], sky: 0xe4d0a4, skyMix: 0.35, sun: 0xffd9a2, sunMix: 0.3, hemiSky: 0xffeccc, hemiGround: 0x735632, fog: 1 }),
  // Rauch und Backstein: rauchiger Dunst, gedämpfte Farben mit Ziegelrot, Nebel rückt näher
  mood({ saturation: 0.74, contrast: 1.05, tint: [0.05, 0.004, -0.03], sky: 0xbfb2a2, skyMix: 0.6, sun: 0xffbe86, sunMix: 0.45, hemiSky: 0xe2d6c6, hemiGround: 0x5a3c2c, fog: 0.85 }),
  // kräftig: klare Luft, satte Farben, mehr Kontrast
  mood({ saturation: 1.28, contrast: 1.1, tint: [-0.01, 0.004, 0.018], sky: 0xd6e5ee, skyMix: 0.45, sun: 0xfff4e0, sunMix: 0.35, hemiSky: 0xf4f8ff, hemiGround: 0x5c5a3c, fog: 1.15 }),
];

/** Nebel-Sichtweite ohne Stimmung (wie in Stage angelegt) */
export const BASE_FOG = { near: 260, far: 520 };

/** Stimmung für eine gleitende Epoche (1..3), damit ein Epochenwechsel sanft überblendet */
export function moodAt(epoch: number, out: EpochMood = mood({ saturation: 1, contrast: 1, tint: [0, 0, 0], sky: 0, skyMix: 0, sun: 0, sunMix: 0, hemiSky: 0, hemiGround: 0, fog: 1 })): EpochMood {
  const x = THREE.MathUtils.clamp(epoch, 1, EPOCH_MOODS.length) - 1;
  const i = Math.min(Math.floor(x), EPOCH_MOODS.length - 2);
  const f = x - i;
  const a = EPOCH_MOODS[i];
  const b = EPOCH_MOODS[i + 1];
  const lerp = (p: number, q: number) => p + (q - p) * f;
  out.saturation = lerp(a.saturation, b.saturation);
  out.contrast = lerp(a.contrast, b.contrast);
  out.tint.lerpVectors(a.tint, b.tint, f);
  out.sky.copy(a.sky).lerp(b.sky, f);
  out.skyMix = lerp(a.skyMix, b.skyMix);
  out.sun.copy(a.sun).lerp(b.sun, f);
  out.sunMix = lerp(a.sunMix, b.sunMix);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, f);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, f);
  out.fog = lerp(a.fog, b.fog);
  return out;
}

/** Gleitende Epoche einen Schritt Richtung Ziel bewegen: etwa vier Sekunden für einen Wechsel */
export function easeEpoch(current: number, target: number, dt: number): number {
  const step = dt / 4;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}
