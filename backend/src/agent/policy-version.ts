import { BaselineAsphodelAgent, type AsphodelAgent } from "./baseline-agent.js";

export interface VersionedAsphodelAgent extends AsphodelAgent {
  readonly version: string;
}
/** Deliberately inherits the unchanged V2a implementation. */
export class BaselineAsphodelAgentV2a extends BaselineAsphodelAgent implements VersionedAsphodelAgent {
  readonly version = "v2a";
}
