export type ArtworkRequest = { id: string; name: string; urls: string[]; unavailable: number };
export type ArtworkPlan = ArtworkRequest & { total: number; cached: number; missing: number; estimatedBytes: number };
export type ArtworkJob = { id: string; name: string; status: 'downloading'|'paused'|'completed'|'partial'|'canceled'; total: number; cached: number; missing: number; unavailable: number; failed: number; active: number; error: string|null };
export type ArtworkState = { limitBytes: number; usedBytes: number; protectedBytes: number; reclaimableBytes: number; bundledBytes: number; cachedImages: number; recoveryError: string|null;
  decks: { id: string; name: string; keep: boolean; total: number; cached: number; missing: number; unavailable: number }[]; job: ArtworkJob|null };
