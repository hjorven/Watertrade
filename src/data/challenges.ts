import type { Chapter } from './campaign.ts';

/**
 * Herausforderungen: kurze Szenarien mit Zeitlimit. Sie haben dieselbe Form wie Kampagnenkapitel,
 * zählen aber nicht zur Geschichte und sind von Anfang an offen.
 */
export const CHALLENGES: Chapter[] = [
  {
    id: 'h-floss',
    number: 1,
    title: 'Flößer',
    intro: ['Ein Sommer lang nur mit der Strömung: Baue in den Holzstädten Flöße, lass sie talwärts treiben und verkaufe Ladung und Stämme am Ziel.'],
    outro: 'Fünf Flöße, kein einziges Pferd. Die Flößer in Oberau ziehen den Hut.',
    startTown: 'oberau',
    money: 300,
    startShip: 'treidelkahn',
    allowedShips: ['floss', 'treidelkahn'],
    rivals: false,
    epoch: 1,
    deadlineDays: 120,
    goals: [
      { type: 'rafts', count: 5, text: 'Zerlege fünf Flöße am Ziel' },
      { type: 'money', amount: 3000, text: 'Besitze 3000 Taler' },
    ],
  },
  {
    id: 'h-auftrag',
    number: 2,
    title: 'Das Auftragsbuch',
    intro: ['Die Städte vertrauen nur dem, der liefert. Erfülle Aufträge, bevor die Konkurrenz es tut.'],
    outro: 'Dein Auftragsbuch ist voll, und jede Zeile ist abgehakt.',
    startTown: 'muehlheim',
    money: 1500,
    startShip: 'treidelkahn',
    allowedShips: [],
    rivals: true,
    epoch: 1,
    startYear: 2,
    deadlineDays: 240,
    goals: [
      { type: 'contracts', count: 6, text: 'Erfülle sechs Aufträge' },
      { type: 'worth', amount: 12000, text: 'Komme auf ein Vermögen von 12 000 Talern' },
    ],
  },
  {
    id: 'h-kontor',
    number: 3,
    title: 'Kontorkette',
    intro: ['Vier Städte, vier Kontore, vier Werkstätten. Baue ein Netz, das ohne dich arbeitet.'],
    outro: 'Von Oberau bis Niedermünd hängt dein Schild über den Türen.',
    startTown: 'altenfurt',
    money: 4000,
    startShip: 'treidelkahn',
    allowedShips: [],
    rivals: true,
    epoch: 1,
    startYear: 3,
    deadlineDays: 240,
    goals: [
      { type: 'kontore', count: 4, text: 'Unterhalte vier Kontore' },
      { type: 'betriebe', count: 4, text: 'Lass vier eigene Betriebe arbeiten' },
      { type: 'routes', count: 1, text: 'Lass ein Schiff eine Route allein fahren' },
    ],
  },
  {
    id: 'h-dampf',
    number: 4,
    title: 'Volldampf',
    intro: ['Ein Raddampfer, volle Bunker und ein Jahr Zeit. Zeig, was Kohle auf dem Fluss bewegt.'],
    outro: 'Der Rauch deiner Schlote steht über dem ganzen Tal.',
    startTown: 'muehlheim',
    money: 3000,
    startShip: 'raddampfer',
    allowedShips: [],
    rivals: true,
    epoch: 2,
    startYear: 6,
    deadlineDays: 120,
    goals: [
      { type: 'ships', count: 3, text: 'Besitze drei Schiffe' },
      { type: 'worth', amount: 30000, text: 'Komme auf ein Vermögen von 30 000 Talern' },
    ],
  },
  {
    id: 'h-rang',
    number: 5,
    title: 'Erster am Fluss',
    intro: ['Vier Handelshäuser, ein Fluss. Am Ende des Jahres zählt nur, wer vorne liegt.'],
    outro: 'Die alten Häuser schauen jetzt zu dir herüber, nicht mehr auf dich herab.',
    startTown: 'oberau',
    money: 1500,
    startShip: 'treidelkahn',
    allowedShips: [],
    rivals: true,
    epoch: 1,
    startYear: 2,
    deadlineDays: 240,
    goals: [{ type: 'rank', place: 1, text: 'Sei das reichste Handelshaus am Fluss' }],
  },
];

/** Tagesmarkt: dauert so viele Spieltage */
export const DAILY_DAYS = 60;
export const DAILY_TOWNS = ['oberau', 'muehlheim', 'altenfurt', 'weidenhof', 'niedermuend'];

/** Aufbau des Tagesmarkts aus dem gemeinsamen Startwert, für alle Spieler gleich */
export function dailySetup(seed: number): { startTown: string; money: number; startYear: number } {
  return {
    startTown: DAILY_TOWNS[seed % DAILY_TOWNS.length],
    money: 600 + (Math.floor(seed / 7) % 5) * 100,
    startYear: 1 + (Math.floor(seed / 31) % 3),
  };
}
