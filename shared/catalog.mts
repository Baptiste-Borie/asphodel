export type CatalogState = {
  installed: boolean; updatedAt: string|null; printings: number|null; usedBytes: number; availableBytes: number|null;
  reclaimableBytes: number; needsRestart: boolean; latest: {updatedAt:string;bytes:number}|null;
  lastCheck: string|null; checking: boolean; error: string|null;
  job: {generation:string;status:'downloading'|'verifying'|'indexing'|'activating'|'paused'|'completed'|'canceled';startedAt:string;phase:string;cards:number;receivedBytes:number;totalBytes:number;error:string|null;active:boolean}|null;
};
