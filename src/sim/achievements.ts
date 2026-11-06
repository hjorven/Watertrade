import { SHIPS } from '../data/ships.ts';
import { playerWorth } from './house.ts';
import { levelOf } from './towns.ts';
import type { GameState } from './state.ts';

/** Erfolge: kleine Meilensteine, die spielübergreifend im Browser gespeichert werden */
export interface Achievement {
  id: string;
  title: string;
  text: string;
  /** Prüfung am Spielstand; fehlt sie, schaltet das Spiel den Erfolg selbst frei */
  test?: (s: GameState) => boolean;
}

const owns = (s: GameState, f: (epoch: number) => boolean) => s.ships.some((x) => f(SHIPS[x.type]?.epoch ?? 1));

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'gewinn', title: 'Erster Gewinn', text: 'Mit einem Verkauf Gewinn machen', test: (s) => s.firstProfitDone },
  { id: 'floss', title: 'Mit der Strömung', text: 'Ein Floß am Ziel zerlegen', test: (s) => s.stats.rafts >= 1 },
  { id: 'flotte5', title: 'Kleine Flotte', text: 'Fünf Schiffe besitzen', test: (s) => s.ships.length >= 5 },
  { id: 'flotte10', title: 'Reederei', text: 'Zehn Schiffe besitzen', test: (s) => s.ships.length >= 10 },
  { id: 'kontor', title: 'Eine Tür am Hafen', text: 'Ein Kontor bauen', test: (s) => Object.keys(s.kontore).length >= 1 },
  { id: 'speicher', title: 'Großer Speicher', text: 'Ein Kontor auf die höchste Stufe ausbauen', test: (s) => Object.values(s.kontore).some((k) => k.level >= 3) },
  { id: 'betriebe5', title: 'Unternehmer', text: 'Fünf eigene Betriebe unterhalten', test: (s) => s.betriebe.length >= 5 },
  { id: 'kapitaen', title: 'Anheuern', text: 'Einen Kapitän einstellen', test: (s) => s.ships.some((x) => x.captain) },
  { id: 'route', title: 'Fahrplan', text: 'Eine Handelsroute selbst fahren lassen', test: (s) => s.ships.some((x) => x.route?.active) },
  { id: 'auftraege10', title: 'Verlässlich', text: 'Zehn Aufträge erfüllen', test: (s) => s.stats.contracts >= 10 },
  { id: 'fahrten100', title: 'Alter Flussschiffer', text: 'Hundert Fahrten unternehmen', test: (s) => s.stats.trips >= 100 },
  { id: 'reich10k', title: 'Wohlhabend', text: '10 000 Taler in der Kasse haben', test: (s) => s.money >= 10000 },
  { id: 'reich100k', title: 'Flussbaron', text: 'Ein Vermögen von 100 000 Talern', test: (s) => playerWorth(s) >= 100000 },
  { id: 'wasserbau', title: 'Den Fluss formen', text: 'Ein Wasserbauprojekt fertigstellen', test: (s) => s.works.some((w) => w.done && w.started > 0 && (!w.owner || w.owner === 'spieler')) },
  { id: 'dampf', title: 'Unter Dampf', text: 'Ein Dampfschiff besitzen', test: (s) => owns(s, (e) => e === 2) },
  { id: 'motor', title: 'Diesel und Stahl', text: 'Ein Motorschiff besitzen', test: (s) => owns(s, (e) => e >= 3) },
  { id: 'grossstadt', title: 'Stadtgründer', text: 'Eine Stadt zur Großstadt wachsen lassen', test: (s) => Object.values(s.towns).some((t) => levelOf(t.population) >= 3) },
  { id: 'chronist', title: 'Hundert Jahre', text: 'Die Kampagne abschließen' },
  { id: 'herausforderer', title: 'Herausforderer', text: 'Eine Herausforderung bestehen' },
  { id: 'meister', title: 'Meister des Flusses', text: 'Alle Herausforderungen bestehen' },
  { id: 'tagesmarkt', title: 'Markttag', text: 'Einen Tagesmarkt zu Ende spielen' },
  { id: 'liga', title: 'Ligahändler', text: 'In der Handelsliga handeln' },
];

/** Neu erreichte Erfolge, die noch nicht in have stehen */
export function newAchievements(state: GameState, have: Record<string, string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !have[a.id] && a.test?.(state));
}
