import type { ProjectNote, ProjectWorkspace, ProjectPoint } from '../../../shared/builder-project.mjs';

export const NOTE_WIDTH = 270;
export const NOTE_HEIGHT = 212;
/** Linked coordinates are offsets from the stable entry, independent of its category. */
export function notePosition(note: ProjectNote, workspace: ProjectWorkspace): ProjectPoint {
  const anchor = workspace.cards.find(c => c.id === note.cardId);
  return { x: note.x + (anchor?.x ?? 0), y: note.y + (anchor?.y ?? 0) };
}
export function createNote(workspace: ProjectWorkspace, point: ProjectPoint, cardId?: string): ProjectNote {
  if ((workspace.notes?.length ?? 0) >= 500) throw new Error('La table contient déjà 500 notes.');
  if (cardId && !workspace.cards.some(c => c.id === cardId)) throw new Error('Carte absente de la table.');
  const note: ProjectNote = { id: crypto.randomUUID(), text: '', color: 'sand', ...point, ...(cardId ? { cardId } : {}) };
  (workspace.notes ??= []).push(note);
  return note;
}
export function detachNote(note: ProjectNote, workspace: ProjectWorkspace) {
  Object.assign(note, notePosition(note, workspace));
  delete note.cardId;
}
/** Cutting/removing an entry keeps its annotation as a free note at the same position. */
export function reconcileNotes(workspace: ProjectWorkspace, active: Set<string>) {
  for (const note of workspace.notes ?? []) if (note.cardId && !active.has(note.cardId)) detachNote(note, workspace);
}
