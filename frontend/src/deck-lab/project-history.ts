import type { BuilderProject } from '../../../shared/builder-project.mjs';
import type { LabCard } from '../../../shared/deck-lab';
import type { Sheet } from './deck-model';
import { initializeZones, reconcileWorkspace } from './deck-workspace';
import { prepareProject, type Storage } from './project-persistence';

type PackedProject = Omit<BuilderProject, 'groups' | 'cuts' | 'workspace' | 'versions'> & {
  groups: (Omit<BuilderProject['groups'][number], 'entries'> & { entries: { id?: string; quantity: number; card: number }[] })[];
  cuts: number[]; workspace: Omit<BuilderProject['workspace'], 'camera'>;
};
type Entry = { before: string; after: string; label: string };
export interface HistoryState { canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string; editing: boolean }

/** Session history per Sheet. Immutable card metadata is interned once, rather than
 * copied 100 times for a drag. Viewport and database identity are never rewound. */
export class ProjectHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private cards = new Map<number, string>();
  private cardIds = new Map<string, number>();
  private nextCard = 0;
  private current: string;
  private pending: { before: string; label: string } | undefined;
  private sheet: Sheet;
  private storage: Pick<Storage, 'getItem'> | undefined;
  private maxEntries: number;
  private maxBytes: number;

  constructor(sheet: Sheet, storage?: Pick<Storage, 'getItem'>, maxEntries = 100, maxBytes = 32 * 1024 * 1024) {
    this.sheet = sheet; this.storage = storage; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
    prepareProject(sheet, storage);
    // Establish the one-time table migration before recording V1 edits. Switching
    // builders must not generate new zone ids in old undo/redo states.
    initializeZones(sheet.workspace!, reconcileWorkspace(sheet, sheet.workspace!), false);
    this.current = this.capture();
  }
  private intern(card: LabCard): number {
    const value = JSON.stringify(card);
    let id = this.cardIds.get(value);
    if (id === undefined) { id = ++this.nextCard; this.cardIds.set(value, id); this.cards.set(id, value); }
    return id;
  }
  private capture(): string {
    // Named checkpoints outlive construction undo/redo and aren't copied for each drag.
    const { versions: _versions, ...p } = prepareProject(this.sheet, this.storage);
    const { camera: _camera, ...workspace } = p.workspace;
    const packed: PackedProject = { ...p, workspace,
      groups: p.groups.map(g => ({ ...g, entries: g.entries.map(e => ({ ...e, card: this.intern(e.card) })) })),
      cuts: p.cuts.map(c => this.intern(c)),
    };
    return JSON.stringify(packed);
  }
  private apply(value: string) {
    const p = JSON.parse(value) as PackedProject;
    const card = (id: number) => JSON.parse(this.cards.get(id)!) as LabCard;
    this.sheet.name = p.name;
    this.sheet.groups = p.groups.map(g => ({ ...g, entries: g.entries.map(e => ({ ...e, card: card(e.card) })) }));
    this.sheet.cuts = p.cuts.map(card);
    if (p.tags === undefined) delete this.sheet.tags;
    else this.sheet.tags = structuredClone(p.tags);
    // Keep the workspace object used by a mounted table, but replace its contents.
    const w = this.sheet.workspace!;
    const camera = w.camera;
    Object.assign(w, p.workspace, { camera });
    // A missing optional flag in an older snapshot must not leak from a later state.
    if (p.workspace.zonesInitialized === undefined) delete w.zonesInitialized;
    if (p.workspace.piles === undefined) delete w.piles;
    if (p.workspace.notes === undefined) delete w.notes;
  }
  get state(): HistoryState {
    return { canUndo: !this.pending && this.past.length > 0, canRedo: !this.pending && this.future.length > 0,
      undoLabel: this.past.at(-1)?.label ?? '', redoLabel: this.future.at(-1)?.label ?? '', editing: !!this.pending };
  }
  begin(label: string) {
    if (this.pending) throw new Error('Une modification est déjà en cours.');
    this.sync(); this.pending = { before: this.current, label };
  }
  /** Sync migrations/rendering without adding an action or invalidating redo. */
  sync() { if (!this.pending) this.current = this.capture(); }
  commit(label?: string): boolean {
    const before = this.pending?.before ?? this.current;
    const action = label ?? this.pending?.label;
    const after = this.capture();
    this.pending = undefined;
    if (!action || before === after) { this.current = after; return false; }
    this.past.push({ before, after, label: action }); this.future = []; this.current = after;
    this.prune(); return true;
  }
  cancel(): boolean {
    if (!this.pending) return false;
    const before = this.pending.before; this.pending = undefined;
    this.apply(before); this.current = before; this.pruneCards(); return true;
  }
  undo(): string | null {
    if (this.pending) return null;
    const entry = this.past.pop(); if (!entry) return null;
    this.apply(entry.before); this.current = entry.before; this.future.push(entry); return entry.label;
  }
  redo(): string | null {
    if (this.pending) return null;
    const entry = this.future.pop(); if (!entry) return null;
    this.apply(entry.after); this.current = entry.after; this.past.push(entry); return entry.label;
  }
  private snapshots() { return [this.current, ...this.past.flatMap(e => [e.before, e.after]), ...this.future.flatMap(e => [e.before, e.after]), ...(this.pending ? [this.pending.before] : [])]; }
  private pruneCards() {
    const used = new Set<number>();
    for (const value of new Set(this.snapshots())) {
      const p = JSON.parse(value) as PackedProject;
      for (const id of [...p.cuts, ...p.groups.flatMap(g => g.entries.map(e => e.card))]) used.add(id);
    }
    for (const [id, value] of this.cards) if (!used.has(id)) { this.cards.delete(id); this.cardIds.delete(value); }
  }
  get estimatedBytes(): number { return [...new Set(this.snapshots()), ...this.cards.values()].reduce((sum, value) => sum + value.length * 2, 0); }
  private prune() {
    this.pruneCards();
    while (this.past.length > this.maxEntries || (this.past.length > 0 && this.estimatedBytes > this.maxBytes)) {
      this.past.shift(); this.pruneCards();
    }
  }
}

/** Let text inputs and modal dialogs keep their normal keyboard undo behavior. */
export function historyShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'>, editingText: boolean, modalOpen: boolean): 'undo' | 'redo' | null {
  if (editingText || modalOpen || event.altKey || event.repeat || event.isComposing || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' && !event.shiftKey ? 'redo' : null;
}
