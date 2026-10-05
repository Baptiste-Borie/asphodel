import { parseBuilderProject, type BuilderProject } from '../../../shared/builder-project.mjs';
import type { Sheet } from './deck-model';
import { emptyWorkspace, parseWorkspace, reconcileWorkspace } from './deck-workspace';

export const DRAFT_PREFIX = 'asphodel.builder-draft.v1.';
export type Draft = { version: 1; backendId?: number; project: BuilderProject; pending: boolean; updatedAt: string };
export type SaveStatus = 'pending' | 'saved' | 'error';
export type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Stable ids are assigned once. Migration keeps the old layout key for rollback. */
export function prepareProject(sheet: Sheet, storage?: Pick<Storage, 'getItem'>): BuilderProject {
  sheet.projectId ??= sheet.backendId ? `deck-${sheet.backendId}` : crypto.randomUUID();
  if (!sheet.workspace) sheet.workspace = sheet.backendId ? parseWorkspace(storage?.getItem(`asphodel.deck-table.v1.${sheet.backendId}`) ?? null) : emptyWorkspace();
  for (const group of sheet.groups) group.id ??= crypto.randomUUID();
  for (const row of reconcileWorkspace(sheet, sheet.workspace)) row.entry.id ??= row.placement.id;
  return parseBuilderProject(JSON.parse(JSON.stringify({ version: 1, projectId: sheet.projectId, name: sheet.name, groups: sheet.groups, cuts: sheet.cuts, workspace: sheet.workspace })));
}
export function sheetFromProject(project: BuilderProject, backendId?: number): Sheet {
  return { ...JSON.parse(JSON.stringify(parseBuilderProject(project))), ...(backendId ? { backendId } : {}) };
}
export function loadDrafts(storage: Storage): { drafts: Draft[]; unreadable: number } {
  const drafts: Draft[] = [];
  let unreadable = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    try {
      const d = JSON.parse(storage.getItem(key) ?? '') as Draft;
      parseBuilderProject(d.project);
      if (d.version !== 1 || typeof d.pending !== 'boolean' || typeof d.updatedAt !== 'string'
        || (d.backendId !== undefined && (!Number.isSafeInteger(d.backendId) || d.backendId < 1)) || key !== DRAFT_PREFIX + d.project.projectId) throw Error('Invalid draft');
      if (d.pending) drafts.push(d);
    } catch { unreadable++; }
  }
  return { drafts, unreadable };
}

type Job = { sheet: Sheet; project: BuilderProject; signature: string; revision: number; acknowledged: number; status: SaveStatus; timer?: ReturnType<typeof setTimeout>; flight?: Promise<void>; removed?: boolean };
/** Every edit journals synchronously; serialized writes acknowledge only the snapshot they sent. */
export class ProjectPersistence {
  private jobs = new Map<Sheet, Job>();
  private invalid = new Set<Sheet>();
  private removed = new WeakSet<Sheet>();
  private storage: Storage;
  private write: (project: BuilderProject, id?: number) => Promise<{ id: number }>;
  private notify: (sheet: Sheet, status: SaveStatus, error?: unknown) => void;
  private delay: number;
  constructor(storage: Storage, write: (project: BuilderProject, id?: number) => Promise<{ id: number }>, notify: (sheet: Sheet, status: SaveStatus, error?: unknown) => void, delay = 700) {
    this.storage = storage; this.write = write; this.notify = notify; this.delay = delay;
  }
  private journal(job: Job, pending: boolean) {
    const draft: Draft = { version: 1, project: job.project, pending, updatedAt: new Date().toISOString(), ...(job.sheet.backendId ? { backendId: job.sheet.backendId } : {}) };
    if (pending) this.storage.setItem(DRAFT_PREFIX + job.project.projectId, JSON.stringify(draft));
    else this.storage.removeItem(DRAFT_PREFIX + job.project.projectId);
  }
  changed(sheet: Sheet) {
    if (this.removed.has(sheet)) return;
    let project: BuilderProject;
    try { project = prepareProject(sheet, this.storage); }
    catch (error) { this.invalid.add(sheet); this.notify(sheet, 'error', error); throw error; }
    this.invalid.delete(sheet);
    const signature = JSON.stringify(project);
    let job = this.jobs.get(sheet);
    if (job?.removed || job?.signature === signature) return;
    if (!job) { job = { sheet, project, signature, revision: 0, acknowledged: 0, status: 'saved' }; this.jobs.set(sheet, job); }
    Object.assign(job, { project, signature, revision: job.revision + 1, status: 'pending' });
    try { this.journal(job, true); this.notify(sheet, 'pending'); }
    catch (error) { job.status = 'error'; this.notify(sheet, 'error', error); }
    clearTimeout(job.timer);
    job.timer = setTimeout(() => { job!.timer = undefined; void this.drain(job!); }, this.delay);
  }
  status(sheet: Sheet): SaveStatus { return this.invalid.has(sheet) ? 'error' : this.jobs.get(sheet)?.status ?? 'saved'; }
  private drain(job: Job): Promise<void> {
    clearTimeout(job.timer); job.timer = undefined;
    if (job.flight) return job.flight;
    const flight = (async () => {
      while (!job.removed && job.acknowledged < job.revision) {
        clearTimeout(job.timer); job.timer = undefined;
        const revision = job.revision, project = job.project;
        try {
          const result = await this.write(project, job.sheet.backendId);
          job.sheet.backendId = result.id;
          job.acknowledged = revision;
          if (job.removed) return;
          // Keep the latest draft and attach a newly-created id even if edits arrived in flight.
          let journalError: unknown;
          try { this.journal(job, job.acknowledged < job.revision); } catch (error) { journalError = error; }
          job.status = job.acknowledged === job.revision ? 'saved' : 'pending';
          this.notify(job.sheet, job.status, journalError);
        } catch (error) { job.status = 'error'; this.notify(job.sheet, 'error', error); return; }
      }
    })();
    job.flight = flight;
    void flight.finally(() => { if (job.flight === flight) job.flight = undefined; });
    return flight;
  }
  async flush(): Promise<boolean> {
    await Promise.all([...this.jobs.values()].map(job => this.drain(job)));
    return this.invalid.size === 0 && [...this.jobs.values()].every(j => j.removed || (j.acknowledged === j.revision && j.status === 'saved'));
  }
  async retry(sheet: Sheet) { this.changed(sheet); const job = this.jobs.get(sheet); if (job) { await job.flight; await this.drain(job); } }
  async remove(sheet: Sheet) {
    this.removed.add(sheet); this.invalid.delete(sheet);
    const job = this.jobs.get(sheet);
    if (job) { job.removed = true; clearTimeout(job.timer); await job.flight; this.jobs.delete(sheet); }
    if (sheet.projectId) this.storage.removeItem(DRAFT_PREFIX + sheet.projectId);
  }
}
