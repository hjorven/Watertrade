import { fail, getClient, offline, type Result } from './client.ts';
import { ensureSession } from './auth.ts';

import { SLOT_COUNT } from './rules.ts';

export { SLOT_COUNT };

export interface SlotInfo {
  slot: number;
  name: string;
  updatedAt: string;
}

export interface SlotData<T> extends SlotInfo {
  data: T;
}

function badSlot(slot: number): boolean {
  return !Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT;
}

const BAD_SLOT = { ok: false as const, error: `Spielstand-Platz muss 1 bis ${SLOT_COUNT} sein.`, offline: false };

/** Speichert beliebiges JSON in Platz 1 bis 5 (überschreibt) */
export async function saveSlot<T>(slot: number, name: string, data: T): Promise<Result<SlotInfo>> {
  if (badSlot(slot)) return BAD_SLOT;
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data: row, error } = await sb
      .from('saves')
      .upsert(
        { user_id: session.data.id, slot, name: name.slice(0, 60) || `Spielstand ${slot}`, data, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,slot' },
      )
      .select('slot, name, updated_at')
      .single();
    if (error) return fail(error);
    return { ok: true, data: { slot: row.slot, name: row.name, updatedAt: row.updated_at } };
  } catch (e) {
    return fail(e);
  }
}

/** Lädt einen Platz, data ist null, wenn er leer ist */
export async function loadSlot<T>(slot: number): Promise<Result<SlotData<T> | null>> {
  if (badSlot(slot)) return BAD_SLOT;
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data: row, error } = await sb
      .from('saves')
      .select('slot, name, data, updated_at')
      .eq('user_id', session.data.id)
      .eq('slot', slot)
      .maybeSingle();
    if (error) return fail(error);
    if (!row) return { ok: true, data: null };
    return { ok: true, data: { slot: row.slot, name: row.name, data: row.data as T, updatedAt: row.updated_at } };
  } catch (e) {
    return fail(e);
  }
}

/** Alle belegten Plätze des Spielers, aufsteigend */
export async function listSlots(): Promise<Result<SlotInfo[]>> {
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { data, error } = await sb
      .from('saves')
      .select('slot, name, updated_at')
      .eq('user_id', session.data.id)
      .order('slot');
    if (error) return fail(error);
    return { ok: true, data: (data ?? []).map((r) => ({ slot: r.slot, name: r.name, updatedAt: r.updated_at })) };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSlot(slot: number): Promise<Result<null>> {
  if (badSlot(slot)) return BAD_SLOT;
  const sb = getClient();
  if (!sb) return offline();
  const session = await ensureSession();
  if (!session.ok) return session;
  try {
    const { error } = await sb.from('saves').delete().eq('user_id', session.data.id).eq('slot', slot);
    return error ? fail(error) : { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
