import './desktop-controls.css';
import { element } from './dom';

export interface DesktopDisplayState { fullscreen: boolean; saveError: string | null }
export interface DesktopAPI {
  getDisplayState(): Promise<DesktopDisplayState>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  openData(): Promise<void>;
  quit(): Promise<void>;
  onDisplayState(callback: (state: DesktopDisplayState) => void): () => void;
}
declare global { interface Window { asphodelDesktop?: DesktopAPI } }

export function initDesktopControls(closeMenu: () => void) {
  const desktop = window.asphodelDesktop;
  if (!desktop) return;
  document.body.classList.add('desktop-app');
  const settings = element<HTMLButtonElement>('#desktop-settings-button');
  const quit = element<HTMLButtonElement>('#desktop-quit-button');
  settings.hidden = false;
  quit.hidden = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'desktop-settings';
  dialog.setAttribute('aria-labelledby', 'desktop-settings-title');
  dialog.innerHTML = `
    <header><div><p class="desktop-settings-eyebrow">ASPHODEL</p><h2 id="desktop-settings-title">Paramètres</h2></div>
      <button type="button" data-desktop-close class="icon-button" aria-label="Fermer les paramètres">✕</button></header>
    <section><h3>Affichage</h3>
      <label for="desktop-display-mode">Mode d’affichage</label>
      <select id="desktop-display-mode"><option value="fullscreen">Plein écran</option><option value="window">Fenêtre</option></select>
      <p>Ton choix sera conservé au prochain lancement.</p>
      <p><kbd>F11</kbd> permet de basculer à tout moment. <kbd>Échap</kbd> ferme les paramètres.</p>
      <p data-desktop-status role="status" aria-live="polite" hidden></p>
    </section>
    <footer><button type="button" data-desktop-data class="secondary-button">Ouvrir mes données</button>
      <button type="button" data-desktop-close class="primary-button">Terminé</button></footer>`;
  document.body.append(dialog);
  const mode = element<HTMLSelectElement>('#desktop-display-mode', dialog);
  const feedback = element<HTMLElement>('[data-desktop-status]', dialog);
  let changing = false;
  function status(message: string, error = false) {
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.dataset.error = String(error);
  }
  function render(state: DesktopDisplayState) {
    if (!changing) mode.value = state.fullscreen ? 'fullscreen' : 'window';
    if (state.saveError) status(state.saveError, true);
  }
  desktop.onDisplayState(render);
  settings.addEventListener('click', () => {
    closeMenu();
    status('');
    dialog.showModal();
    mode.disabled = true;
    void desktop.getDisplayState().then(render).catch(() => status('Impossible de lire le mode d’affichage.', true))
      .finally(() => { mode.disabled = false; mode.focus(); });
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => {
    if (settings.getClientRects().length) settings.focus();
    else element<HTMLButtonElement>('#app-menu-toggle').focus();
  });
  mode.addEventListener('change', async () => {
    changing = true;
    mode.disabled = true;
    status('');
    try {
      await desktop.setFullscreen(mode.value === 'fullscreen');
      status('Mode d’affichage enregistré.');
    } catch {
      status('Le mode n’a pas pu être enregistré. Réessaie ou vérifie l’accès au dossier de données.', true);
    } finally {
      changing = false;
      mode.disabled = false;
      try { render(await desktop.getDisplayState()); } catch { /* keep the reported error */ }
      mode.focus();
    }
  });
  element<HTMLButtonElement>('[data-desktop-data]', dialog).addEventListener('click', async () => {
    try { await desktop.openData(); }
    catch { status('Impossible d’ouvrir le dossier de données.', true); }
  });
  quit.addEventListener('click', async () => {
    closeMenu();
    quit.disabled = true;
    try { await desktop.quit(); }
    catch { quit.disabled = false; status('Impossible de quitter l’application.', true); if (!dialog.open) dialog.showModal(); }
  });
}
