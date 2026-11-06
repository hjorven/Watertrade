/** Wasserbau: Projekte, die den Fluss dauerhaft verändern */
export interface ProjectEffect {
  depth?: number; // zusätzliche Tiefe in m
  current?: number; // Änderung der Strömung in km/h
  bridgeHeight?: number; // neue Durchfahrtshöhe
  iceFree?: boolean;
  /** Pegelstation: kündigt Hochwasser und Dürre im Flussboten an */
  gauge?: boolean;
  /** Leuchtfeuer: Abschnitt ist nachts befeuert (Wirkung in der Nachtfahrt) */
  light?: boolean;
}

export interface ProjectDef {
  id: string;
  name: string;
  kind: 'schleuse' | 'bruecke' | 'vertiefung' | 'kanal' | 'pegel' | 'leuchtfeuer';
  seg: string;
  cost: number;
  days: number;
  epoch: number;
  effect: ProjectEffect;
  text: string;
}

export const PROJECTS: ProjectDef[] = [
  {
    id: 'bruecke-kessel',
    name: 'Neue Brücke in Kesselbrück',
    kind: 'bruecke',
    seg: 'kessel-muehl',
    cost: 6000,
    days: 20,
    epoch: 1,
    effect: { bridgeHeight: 11 },
    text: 'Die alte Steinbrücke weicht einer hohen Bogenbrücke. Danach passen Segel und Schornsteine darunter durch.',
  },
  {
    id: 'vertiefung-glas',
    name: 'Ausbaggern des unteren Erzbachs',
    kind: 'vertiefung',
    seg: 'glas-alten',
    cost: 5000,
    days: 18,
    epoch: 1,
    effect: { depth: 0.8 },
    text: 'Eine Fahrrinne zwischen Glashütte und Altenfurt: 0,8 m mehr Tiefe, auch im Sommer.',
  },
  {
    id: 'schleuse-erzbach',
    name: 'Schleusentreppe am Erzbach',
    kind: 'schleuse',
    seg: 'grube-glas',
    cost: 11000,
    days: 30,
    epoch: 2,
    effect: { depth: 1.2, current: -1.4 },
    text: 'Drei Schleusen stauen den oberen Erzbach: tiefes, ruhiges Wasser bis Erzgrube.',
  },
  {
    id: 'kanal-oberlauf',
    name: 'Seitenkanal am Oberlauf',
    kind: 'kanal',
    seg: 'oberau-kessel',
    cost: 14000,
    days: 35,
    epoch: 2,
    effect: { depth: 0.8, current: -1.2, iceFree: true },
    text: 'Ein gemauerter Kanal neben dem wilden Oberlauf: kaum Strömung, friert nicht zu.',
  },
  {
    id: 'hafen-niedermuend',
    name: 'Tiefwasserrinne vor Niedermünd',
    kind: 'vertiefung',
    seg: 'weiden-nieder',
    cost: 9000,
    days: 25,
    epoch: 2,
    effect: { depth: 1.2 },
    text: 'Baggerschiffe räumen die Sandbänke vor der Mündung. Auch tiefe Schleppverbände kommen dann sicher an.',
  },
  {
    id: 'vertiefung-strom',
    name: 'Strombegradigung bei Mühlheim',
    kind: 'kanal',
    seg: 'muehl-alten',
    cost: 12000,
    days: 30,
    epoch: 3,
    effect: { depth: 1, current: -0.4 },
    text: 'Leitwerke und Buhnen halten den Strom zwischen Mühlheim und Altenfurt tief.',
  },
  {
    id: 'pegel-oberau',
    name: 'Pegelhaus am Oberlauf',
    kind: 'pegel',
    seg: 'oberau-kessel',
    cost: 1800,
    days: 8,
    epoch: 1,
    effect: { gauge: true },
    text: 'Ein Pegelwärter liest täglich die Latte unter Oberau ab und schickt Boten talwärts. Der Flussbote kündigt Hochwasser und Dürre 3 bis 5 Tage vorher an.',
  },
  {
    id: 'pegel-erzbach',
    name: 'Pegel am Erzbach',
    kind: 'pegel',
    seg: 'grube-glas',
    cost: 1500,
    days: 6,
    epoch: 1,
    effect: { gauge: true },
    text: 'Eine zweite Messstelle in den Bergen. Schon allein meldet sie Hochwasser und Dürre vorher; zusammen mit dem Pegelhaus am Oberlauf nennt der Flussbote den genauen Tag und den erwarteten Pegel.',
  },
  {
    id: 'leuchtfeuer-muehl',
    name: 'Leuchtfeuer bei Mühlheim',
    kind: 'leuchtfeuer',
    seg: 'muehl-alten',
    cost: 2400,
    days: 10,
    epoch: 1,
    effect: { light: true },
    text: 'Ein Feuerturm am Ufer zwischen Mühlheim und Altenfurt. Nachts finden Schiffer hier sicher ihren Weg.',
  },
  {
    id: 'leuchtfeuer-weiden',
    name: 'Leuchtfeuer am Weidenhofer Bogen',
    kind: 'leuchtfeuer',
    seg: 'alten-weiden',
    cost: 2800,
    days: 12,
    epoch: 1,
    effect: { light: true },
    text: 'Zwischen Altenfurt und Weidenhof zeigt ein Feuer die Fahrrinne im weiten Bogen. Nachtfahrt wird hier sicher.',
  },
  {
    id: 'leuchtfeuer-muendung',
    name: 'Leuchtturm an der Mündung',
    kind: 'leuchtfeuer',
    seg: 'weiden-nieder',
    cost: 3200,
    days: 14,
    epoch: 1,
    effect: { light: true },
    text: 'Ein hoher Leuchtturm vor Niedermünd führt die Schiffe nachts durch die Sandbänke.',
  },
];

export const PROJECT_BY_ID = new Map(PROJECTS.map((p) => [p.id, p]));
