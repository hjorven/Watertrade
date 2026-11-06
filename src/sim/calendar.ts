/** Ein Spieljahr hat vier Jahreszeiten zu je 30 Tagen */
export const SEASON_DAYS = 30;
export const YEAR_DAYS = SEASON_DAYS * 4;

export type Season = 'fruehling' | 'sommer' | 'herbst' | 'winter';
export const SEASONS: Season[] = ['fruehling', 'sommer', 'herbst', 'winter'];
export const SEASON_NAME: Record<Season, string> = {
  fruehling: 'Frühling',
  sommer: 'Sommer',
  herbst: 'Herbst',
  winter: 'Winter',
};

/** Tag 1 ist der erste Frühlingstag im Jahr 1 */
export function dayOfYear(day: number): number {
  return (day - 1) % YEAR_DAYS;
}

export function year(day: number): number {
  return Math.floor((day - 1) / YEAR_DAYS) + 1;
}

export function season(day: number): Season {
  return SEASONS[Math.floor(dayOfYear(day) / SEASON_DAYS)];
}

export function dayInSeason(day: number): number {
  return (dayOfYear(day) % SEASON_DAYS) + 1;
}

/**
 * Wasserstand übers Jahr (Abweichung vom Normalwasser in m):
 * Schneeschmelze im Frühling, Niedrigwasser im Sommer, normal im Herbst, leicht niedrig im Winter.
 */
const LEVEL_KEYS: [number, number][] = [
  [0, 0.6],
  [12, 1.4],
  [30, 0.3],
  [50, -0.9],
  [66, -0.5],
  [80, 0.1],
  [100, -0.2],
  [120, 0.6],
];

/** Kleine Abweichung je Jahr, damit nicht jedes Jahr gleich ist (trockene und nasse Jahre) */
function yearVariation(y: number): number {
  const x = Math.sin(y * 91.7 + 3.1) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 0.5;
}

export function waterLevel(dayFloat: number): number {
  const doy = (((dayFloat - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  let i = 0;
  while (i < LEVEL_KEYS.length - 2 && LEVEL_KEYS[i + 1][0] <= doy) i++;
  const [d0, l0] = LEVEL_KEYS[i];
  const [d1, l1] = LEVEL_KEYS[i + 1];
  const f = (doy - d0) / (d1 - d0);
  const smooth = (1 - Math.cos(f * Math.PI)) / 2;
  const base = l0 + (l1 - l0) * smooth;
  // Sommer trockener oder nasser je nach Jahr, weich ein- und ausgeblendet
  const inSummer = doy >= SEASON_DAYS && doy < SEASON_DAYS * 2 ? Math.sin(((doy - SEASON_DAYS) / SEASON_DAYS) * Math.PI) : 0;
  const v = inSummer * yearVariation(year(Math.floor(dayFloat)));
  return Math.round((base + v) * 100) / 100;
}

/** Eis auf den Flüssen, die zufrieren können: mitten im Winter */
export function isIce(day: number): boolean {
  const doy = dayOfYear(day);
  return doy >= 95 && doy < 116;
}

export function dateText(day: number): string {
  return `${dayInSeason(day)}. ${SEASON_NAME[season(day)]}, Jahr ${year(day)}`;
}
