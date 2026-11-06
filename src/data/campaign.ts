export type Goal =
  | { type: 'profit'; text: string }
  | { type: 'money'; amount: number; text: string }
  | { type: 'ships'; count: number; shipType?: string; text: string }
  | { type: 'townLevel'; town: string; level: number; text: string }
  | { type: 'deliver'; town: string; good: string; amount: number; text: string }
  | { type: 'rafts'; count: number; text: string };

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
];
