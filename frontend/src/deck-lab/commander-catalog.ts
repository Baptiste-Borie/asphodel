import { apiRequest } from '../api/api-client';
import { commanderName, type CommanderCatalogResult, type CommanderFacts } from '../../../shared/commander.mjs';
import type { Sheet } from './deck-model';
export type CommanderLookupState = { facts: ReadonlyMap<string, CommanderFacts>; busy: boolean; done: number; total: number; error: string; snapshotDate?: string; checkedAt?: string; missing: string[] };

/** Catalog checks are explicit and read-only; complete responses replace the prior result atomically. */
export class CommanderCatalog {
  private states = new WeakMap<Sheet, CommanderLookupState>();
  private controllers = new Set<AbortController>();
  private retired = false;
  private request: (names: string[], signal: AbortSignal) => Promise<CommanderCatalogResult>;
  constructor(request = (names: string[], signal: AbortSignal) => apiRequest<CommanderCatalogResult>('/cards/search/commander-facts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }), signal })) { this.request = request; }
  state(sheet: Sheet): CommanderLookupState {
    let state = this.states.get(sheet);
    if (!state) { state = { facts: new Map(), busy: false, done: 0, total: 0, error: '', missing: [] }; this.states.set(sheet, state); }
    return state;
  }
  async refresh(sheet: Sheet, changed: () => void) {
    const state = this.state(sheet); if (state.busy || this.retired) return;
    const names = [...new Map(sheet.groups.filter(g => !g.maybeboard).flatMap(g => g.entries.map(e => [commanderName(e.card.name), e.card.name] as const))).values()];
    if (!names.length) return;
    const controller = new AbortController(); this.controllers.add(controller);
    Object.assign(state, { busy: true, done: 0, total: names.length, error: '' }); changed();
    try {
      const facts = new Map<string, CommanderFacts>(), missing: string[] = []; let stamp: string | undefined;
      for (let offset = 0; offset < names.length; offset += 120) {
        const batch = names.slice(offset, offset + 120), result = await this.request(batch, controller.signal);
        if (controller.signal.aborted) return;
        if (!result || !Array.isArray(result.cards) || !Array.isArray(result.missing) || typeof result.snapshotDate !== 'string' || !Number.isFinite(Date.parse(result.snapshotDate))
          || (stamp !== undefined && stamp !== result.snapshotDate)) throw new Error('Le catalogue a changé ou la réponse est incomplète. Relance la vérification.');
        stamp = result.snapshotDate;
        const expected = new Set(batch.map(commanderName)), answered = new Set<string>();
        for (const c of result.cards) {
          if (!c || typeof c.requestedName !== 'string') throw new Error('Données de catalogue invalides.');
          const key = commanderName(c.requestedName);
          if (!expected.has(key) || answered.has(key) || typeof c.name !== 'string' || typeof c.typeLine !== 'string' || !Array.isArray(c.colorIdentity)
            || !c.colorIdentity.every(v => typeof v === 'string') || typeof c.oracleId !== 'string' || (c.oracleText !== null && typeof c.oracleText !== 'string')
            || (c.power !== null && typeof c.power !== 'string') || (c.toughness !== null && typeof c.toughness !== 'string')
            || (c.commanderLegal !== undefined && typeof c.commanderLegal !== 'string')) throw new Error('Données de catalogue invalides.');
          answered.add(key); facts.set(key, c);
        }
        for (const name of result.missing) { if (typeof name !== 'string') throw new Error('Réponse de catalogue incohérente.'); const key = commanderName(name); if (!expected.has(key) || answered.has(key)) throw new Error('Réponse de catalogue incohérente.'); answered.add(key); missing.push(name); }
        if (answered.size !== expected.size) throw new Error('Réponse de catalogue incomplète.');
        state.done += batch.length; changed();
      }
      Object.assign(state, { facts, missing, snapshotDate: stamp, checkedAt: new Date().toISOString() });
    } catch (error) { if (!controller.signal.aborted) state.error = error instanceof Error ? error.message : 'Catalogue local indisponible.'; }
    finally { state.busy = false; this.controllers.delete(controller); if (!this.retired) changed(); }
  }
  retire() { this.retired = true; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}
