/** Kleine Helfer für den lokalen Speicher. Jeder Zugriff kann scheitern (privates Fenster, gesperrter Speicher). */
const PREFIX = 'flussreich.';

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
