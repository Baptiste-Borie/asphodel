/** Bounded diagnostic fields; never the request payload, observations or hidden game state. */
export interface PlaytestFailure {
  code: string; message: string; details: string[]; seed: number; capturedAt: string;
  requestType?: string; bridgeMessage?: string;
}
