/** Kleine Helfer für den lokalen Speicher. Jeder Zugriff kann scheitern (privates Fenster, gesperrter Speicher). */
const PREFIX = 'watertrade.';
/** Schlüssel aus der Zeit, als das Spiel noch „Flussreich“ hieß; werden beim Start einmal übernommen */
const LEGACY_PREFIX = 'flussreich.';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function browserStore(): Store | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Vollständiger Schlüssel im lokalen Speicher, etwa `storageKey('save.1')` */
export const storageKey = (key: string): string => PREFIX + key;

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + key);
    return text ? { ...fallback, ...(JSON.parse(text) as T) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ohne Speicher geht es eben ohne
  }
}

/**
 * Alte Einträge (`flussreich.*`) auf die neuen Schlüssel (`watertrade.*`) übertragen: Spielstände,
 * Fortschritt, Erfolge, Einstellungen. Ein schon vorhandener neuer Eintrag bleibt unangetastet,
 * der alte wird nach dem Kopieren entfernt. Scheitert das Kopieren (voller Speicher), bleiben die
 * alten Einträge liegen und der nächste Start versucht es erneut. Liefert die Zahl der übernommenen Einträge.
 */
export function migrateLegacyStorage(store: Store | null = browserStore()): number {
  if (!store) return 0;
  let moved = 0;
  try {
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(LEGACY_PREFIX)) old.push(k);
    }
    for (const k of old) {
      const target = PREFIX + k.slice(LEGACY_PREFIX.length);
      const value = store.getItem(k);
      if (value === null) continue;
      if (store.getItem(target) === null) {
        store.setItem(target, value);
        moved++;
      }
      // erst löschen, wenn der neue Eintrag sicher da ist
      if (store.getItem(target) !== null) store.removeItem(k);
    }
  } catch {
    // voller oder gesperrter Speicher: beim nächsten Start noch einmal
  }
  return moved;
}
