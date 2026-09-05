import { apiRequest } from "./api-client.js";
import type { AgentChoice, PlaytestReportDTO, StartPlaytestRequest, WebPlaytestStateDTO } from "../playtest/types.js";

export function startPlaytest(request: StartPlaytestRequest): Promise<{ sessionId: string; status: string }> {
  return apiRequest("/playtests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function getPlaytestState(sessionId: string): Promise<WebPlaytestStateDTO> {
  return apiRequest(`/playtests/${encodeURIComponent(sessionId)}`);
}

export function submitPlaytestChoice(sessionId: string, choice: AgentChoice): Promise<{ accepted: true }> {
  return apiRequest(`/playtests/${encodeURIComponent(sessionId)}/choice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice),
  });
}

export function endPlaytest(sessionId: string): Promise<WebPlaytestStateDTO> {
  return apiRequest(`/playtests/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
}

export function getPlaytestReport(sessionId: string): Promise<PlaytestReportDTO> {
  return apiRequest(`/playtests/${encodeURIComponent(sessionId)}/report`);
}
