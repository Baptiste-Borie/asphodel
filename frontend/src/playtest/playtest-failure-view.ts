import type { WebPlaytestStateDTO } from './types';

export function playtestDiagnostic(state: WebPlaytestStateDTO) {
  const f = state.failure;
  return [`Asphodel — diagnostic de playtest`, `Session : ${state.sessionId}`, `Mode : ${state.playMode}`, `Deck humain : ${state.humanDeckName}`,
    `Adversaires : ${state.asphodelDeckNames.join(' / ')}`, `Décisions Asphodel : ${state.asphodelDecisionCount}`, `Erreur : ${state.error ?? f?.message ?? 'inconnue'}`,
    ...(f ? [`Code : ${f.code}`, `Graine de partie : ${f.seed}`, `Date : ${f.capturedAt}`, ...(f.requestType ? [`Requête : ${f.requestType}`] : []), ...f.details, ...(f.bridgeMessage ? [`Messages récents du bridge :\n${f.bridgeMessage}`] : [])] : ['Version précédente : détails techniques indisponibles.'])].join('\n');
}
export function appendPlaytestDiagnostic(root: HTMLElement, state: WebPlaytestStateDTO) {
  const paragraph = document.createElement('p'); paragraph.textContent = 'Le moteur n’a pas terminé la partie. Le diagnostic permet d’identifier le deck, la requête et l’erreur ; la cause exacte peut encore nécessiter une reproduction.';
  const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Diagnostic du playtest';
  const text = document.createElement('textarea'); text.readOnly = true; text.rows = 12; text.style.width = '100%'; text.setAttribute('aria-label', 'Diagnostic à copier'); text.value = playtestDiagnostic(state);
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Copier le diagnostic';
  const feedback = document.createElement('p'); feedback.setAttribute('role', 'status');
  button.addEventListener('click', async () => {
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(text.value); feedback.textContent = 'Diagnostic copié.'; }
    catch { details.open = true; text.focus(); text.select(); feedback.textContent = 'Diagnostic sélectionné : Ctrl+C pour le copier.'; }
  });
  details.append(summary, text); root.append(paragraph, button, feedback, details);
}
