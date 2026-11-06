export type Goal =
  | { type: 'profit'; text: string }
  | { type: 'money'; amount: number; text: string }
  | { type: 'ships'; count: number; shipType?: string; text: string }
  | { type: 'townLevel'; town: string; level: number; text: string }
  | { type: 'deliver'; town: string; good: string; amount: number; text: string }
  | { type: 'rafts'; count: number; text: string }
  | { type: 'kontore'; count: number; text: string }
  | { type: 'betriebe'; count: number; text: string }
  | { type: 'contracts'; count: number; text: string }
  | { type: 'worth'; amount: number; text: string }
  | { type: 'rank'; place: number; text: string }
  | { type: 'project'; id: string; text: string }
  | { type: 'routes'; count: number; text: string }
  | { type: 'allTowns'; level: number; text: string };

export interface Chapter {
  id: string;
  number: number;
  title: string;
  intro: string[];
  outro: string;
  startTown: string;
  money: number;
  startShip: string;
  allowedShips: string[];
  goals: Goal[];
  deadlineDays?: number;
  /** Konkurrierende Handelshäuser am Fluss */
  rivals?: boolean;
  /** feste Epoche des Kapitels */
  epoch?: number;
  startYear?: number;
  extraShips?: string[];
  kontore?: string[];
  works?: string[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'k1',
    number: 1,
    title: 'Der erste Kahn',
    intro: [
      'Oberau, im Frühjahr. Dein Onkel hat dir einen alten Treidelkahn und 300 Taler hinterlassen, dazu einen Satz in seiner krakeligen Schrift: "Der Fluss gibt, wer ihn versteht."',
      'Kaufe, wo eine Ware reichlich da ist, und verkaufe, wo sie gebraucht wird. Talwärts trägt dich die Strömung, bergwärts ziehen Pferde. Im Frühjahr ist das Wasser hoch und schnell, im Sommer wird es flach.',
    ],
    outro: 'Oberau ist kein Dorf mehr, und in den Kontoren am Fluss kennt man deinen Namen. Das Handelshaus steht.',
    startTown: 'oberau',
    money: 300,
    startShip: 'treidelkahn',
    allowedShips: ['floss', 'treidelkahn'],
    goals: [
      { type: 'profit', text: 'Mach mit einem Verkauf Gewinn' },
      { type: 'rafts', count: 1, text: 'Bau in Oberau ein Floß, lass es talwärts treiben und zerlege es am Ziel' },
      { type: 'deliver', town: 'oberau', good: 'getreide', amount: 60, text: 'Bring 60 t Getreide nach Oberau' },
      { type: 'ships', count: 2, shipType: 'treidelkahn', text: 'Besitze zwei Treidelkähne' },
      { type: 'townLevel', town: 'oberau', level: 1, text: 'Lass Oberau zum Marktflecken wachsen' },
      { type: 'money', amount: 6000, text: 'Besitze 6000 Taler' },
    ],
  },
  {
    id: 'k2',
    number: 2,
    title: 'Kontor und Werkstatt',
    intro: [
      'Mühlheim, drei Jahre später. Dein Name steht über einer Tür am Hafen, aber eine Tür ist noch kein Handelshaus.',
      'Wer nur fährt, verdient nur, solange er fährt. Bau Kontore, lass eigene Betriebe für dich arbeiten und such dir Kapitäne, die Routen allein fahren. Und gib acht: Auch andere Häuser haben den Fluss entdeckt.',
    ],
    outro: 'Deine Kontore arbeiten Tag und Nacht. Das Haus wächst auch, wenn du schläfst.',
    startTown: 'muehlheim',
    money: 2500,
    startShip: 'treidelkahn',
    allowedShips: [],
    rivals: true,
    epoch: 1,
    startYear: 3,
    goals: [
      { type: 'kontore', count: 2, text: 'Unterhalte zwei Kontore' },
      { type: 'betriebe', count: 2, text: 'Lass zwei eigene Betriebe arbeiten' },
      { type: 'routes', count: 1, text: 'Lass ein Schiff mit Kapitän eine Handelsroute fahren' },
      { type: 'contracts', count: 3, text: 'Erfülle drei Aufträge' },
      { type: 'worth', amount: 20000, text: 'Bring dein Haus auf 20.000 Taler Vermögen' },
    ],
  },
  {
    id: 'k3',
    number: 3,
    title: 'Die alte Brücke',
    intro: [
      'Kesselbrück, im Frühjahr. Die Steinbrücke ist älter als jedes Handelshaus am Fluss, und genau so niedrig. Segelkähne müssen davor umladen, das kostet alle Geld.',
      'Der Rat hat beschlossen: Wer die neue Brücke bezahlt, bekommt das Recht der ersten Durchfahrt. Steinbrück und Kessler wollen das auch. Sei schneller.',
    ],
    outro: 'Die neue Brücke ist hoch genug für jeden Mast. Am Kai erzählt man, wer sie bezahlt hat.',
    startTown: 'kesselbrueck',
    money: 4000,
    startShip: 'segelkahn',
    extraShips: ['treidelkahn'],
    allowedShips: [],
    rivals: true,
    epoch: 1,
    startYear: 4,
    kontore: ['muehlheim'],
    goals: [
      { type: 'project', id: 'bruecke-kessel', text: 'Bau die neue Brücke in Kesselbrück' },
      { type: 'project', id: 'vertiefung-glas', text: 'Lass den unteren Erzbach ausbaggern' },
      { type: 'townLevel', town: 'altenfurt', level: 2, text: 'Lass Altenfurt zur Stadt wachsen' },
      { type: 'rank', place: 1, text: 'Werde das reichste Haus im Handelsregister' },
    ],
  },
  {
    id: 'k4',
    number: 4,
    title: 'Dampf auf dem Strom',
    intro: [
      'Niedermünd, Jahr 6. Ein Schiff ohne Pferde und ohne Segel kommt den Strom herauf, gegen die Strömung, schwarzer Rauch über dem Schornstein. Die Treidler am Ufer schauen ihm stumm nach.',
      'Dampfer brauchen Kohle und tiefes Wasser. Der Erzbach ist für sie zu seicht, die Kohle liegt aber genau dort. Bau Schleusen, und die Kohle kommt zu dir.',
    ],
    outro: 'Kohle fährt den Erzbach hinunter, Dampfer den Strom hinauf. Das Tal ist schneller geworden.',
    startTown: 'niedermuend',
    money: 6000,
    startShip: 'treidelkahn',
    extraShips: ['plaette'],
    allowedShips: [],
    rivals: true,
    epoch: 2,
    startYear: 6,
    kontore: ['niedermuend'],
    works: ['bruecke-kessel'],
    goals: [
      { type: 'ships', count: 2, shipType: 'raddampfer', text: 'Stell zwei Raddampfer in Dienst' },
      { type: 'project', id: 'schleuse-erzbach', text: 'Bau die Schleusentreppe am Erzbach' },
      { type: 'deliver', town: 'niedermuend', good: 'kohle', amount: 300, text: 'Bring 300 t Kohle nach Niedermünd' },
      { type: 'worth', amount: 50000, text: 'Bring dein Haus auf 50.000 Taler Vermögen' },
    ],
  },
  {
    id: 'k5',
    number: 5,
    title: 'Die große Stadt',
    intro: [
      'Niedermünd wächst über seine Mauern hinaus. Fabriken entstehen, Arbeiter ziehen zu, und alle wollen Brot, Bier, Möbel und Stoff.',
      'Wer diese Stadt versorgt, versorgt das halbe Land. Ein Schleppverband trägt so viel wie fünf Kähne, braucht aber tiefes Wasser bis zur Mündung.',
    ],
    outro: 'Niedermünd ist eine Großstadt, und ihre Speicher tragen deine Farben.',
    startTown: 'niedermuend',
    money: 10000,
    startShip: 'raddampfer',
    extraShips: ['treidelkahn'],
    allowedShips: [],
    rivals: true,
    epoch: 2,
    startYear: 8,
    kontore: ['niedermuend', 'muehlheim'],
    works: ['bruecke-kessel', 'schleuse-erzbach'],
    goals: [
      { type: 'townLevel', town: 'niedermuend', level: 3, text: 'Lass Niedermünd zur Großstadt wachsen' },
      { type: 'ships', count: 1, shipType: 'schleppverband', text: 'Stell einen Schleppverband in Dienst' },
      { type: 'project', id: 'hafen-niedermuend', text: 'Bau die Tiefwasserrinne vor Niedermünd' },
      { type: 'betriebe', count: 6, text: 'Lass sechs eigene Betriebe arbeiten' },
      { type: 'routes', count: 3, text: 'Lass drei Schiffe Handelsrouten fahren' },
    ],
  },
  {
    id: 'k6',
    number: 6,
    title: 'Hundert Jahre am Fluss',
    intro: [
      'Motoren tuckern, wo einst Pferde zogen. Kühlschiffe bringen frischen Fisch bis in die Berge. Dein Haus ist alt geworden, der Fluss nicht.',
      'Ein letztes Mal: Mach das ganze Tal reich. Jede Stadt soll wachsen, und dein Haus soll das erste am Fluss sein.',
    ],
    outro: 'Hundert Jahre am Fluss. Die Treidelpfade sind Spazierwege geworden, aber die Kontore stehen noch, und über den Türen steht dein Name.',
    startTown: 'altenfurt',
    money: 15000,
    startShip: 'motorschiff',
    extraShips: ['raddampfer', 'treidelkahn'],
    allowedShips: [],
    rivals: true,
    epoch: 3,
    startYear: 11,
    kontore: ['altenfurt', 'niedermuend', 'oberau'],
    works: ['bruecke-kessel', 'schleuse-erzbach', 'vertiefung-glas'],
    goals: [
      { type: 'ships', count: 1, shipType: 'kuehlschiff', text: 'Stell ein Kühlschiff in Dienst' },
      { type: 'project', id: 'kanal-oberlauf', text: 'Bau den Seitenkanal am Oberlauf' },
      { type: 'allTowns', level: 1, text: 'Jede Stadt im Tal ist mindestens Marktflecken' },
      { type: 'rank', place: 1, text: 'Sei das reichste Haus im Handelsregister' },
      { type: 'worth', amount: 150000, text: 'Bring dein Haus auf 150.000 Taler Vermögen' },
    ],
  },
];
