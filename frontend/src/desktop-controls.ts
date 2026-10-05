import './desktop-controls.css';
import { element } from './dom';
import { captureLibraryStorage } from './library-storage';

export interface DesktopDisplayState { fullscreen: boolean; saveError: string | null }
export interface DesktopAPI {
  saveBackup(storage: Record<string, string>): Promise<{ canceled: boolean; decks?: number }>;
  chooseBackup(): Promise<{ createdAt: string; decks: string[]; drafts: number } | null>;
  restoreBackup(storage: Record<string, string>): Promise<{ canceled: boolean; restartRequired?: boolean }>;
  getRestoredStorage(): Promise<Record<string, string> | null>;
  acknowledgeRestore(): Promise<void>;
  saveDeckText(name: string, text: string): Promise<boolean>;
  getDisplayState(): Promise<DesktopDisplayState>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  openData(): Promise<void>;
  quit(): Promise<void>;
  onBeforeClose(callback: () => Promise<boolean>): () => void;
  onDisplayState(callback: (state: DesktopDisplayState) => void): () => void;
}
declare global { interface Window { asphodelDesktop?: DesktopAPI } }

export function initDesktopControls(closeMenu: () => void, builder: { flush(): Promise<boolean>; retire(): void }) {
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
    <section class="desktop-backups"><h3>Bibliothèque et sauvegardes</h3>
      <p>Conserve tes decks, tables, candidats, cartes écartées, sélection et brouillons dans un fichier à emporter sur un autre PC.</p>
      <p>Les images, le catalogue et les parties restent sur ce PC. Les illustrations seront rechargées au besoin.</p>
      <div class="desktop-backup-actions"><button type="button" data-backup-save class="primary-button">Sauvegarder ma bibliothèque</button>
        <button type="button" data-backup-choose class="secondary-button">Choisir une sauvegarde…</button></div>
      <div data-backup-preview hidden><p data-backup-summary></p><ul data-backup-decks></ul>
        <p>Restaurer remplace la bibliothèque actuelle. Une copie de secours sera conservée dans tes données, dans le dossier « backups ».</p>
        <button type="button" data-backup-restore class="primary-button">Restaurer cette sauvegarde…</button></div>
      <p data-backup-status role="status" aria-live="polite" hidden></p>
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
  const backupStatus = element<HTMLElement>('[data-backup-status]', dialog);
  let working = false;
  const backupFeedback = (message: string, error = false) => {
    backupStatus.textContent = message; backupStatus.hidden = !message; backupStatus.dataset.error = String(error);
  };
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  async function operation(action: () => Promise<void>) {
    if (working) return;
    working = true;
    const controls = [...dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')];
    const disabled = controls.map(c => c.disabled);
    controls.forEach(c => { c.disabled = true; });
    backupFeedback('Préparation…');
    try { await action(); }
    catch (error) { backupFeedback(error instanceof Error ? error.message : 'Opération impossible. Réessaie.', true); }
    finally { working = false; controls.forEach((c,i) => { c.disabled = disabled[i]; }); }
  }
  element<HTMLButtonElement>('[data-backup-save]', dialog).addEventListener('click', () => void operation(async () => {
    if (!await builder.flush()) throw new Error('Termine l’enregistrement des decks avant de créer la sauvegarde.');
    const result = await desktop.saveBackup(captureLibraryStorage(window.localStorage));
    backupFeedback(result.canceled ? 'Sauvegarde annulée.' : `Bibliothèque sauvegardée : ${result.decks} deck(s).`);
  }));
  element<HTMLButtonElement>('[data-backup-choose]', dialog).addEventListener('click', () => void operation(async () => {
    const preview = element<HTMLElement>('[data-backup-preview]', dialog);
    preview.hidden = true;
    const result = await desktop.chooseBackup();
    if (!result) { backupFeedback('Sélection annulée.'); return; }
    element<HTMLElement>('[data-backup-summary]', dialog).textContent = `Sauvegarde du ${new Date(result.createdAt).toLocaleString('fr-FR')} — ${result.decks.length} deck(s), ${result.drafts} brouillon(s).`;
    const names = element<HTMLElement>('[data-backup-decks]', dialog); names.replaceChildren();
    for (const name of result.decks) { const li = document.createElement('li'); li.textContent = name; names.append(li); }
    preview.hidden = false;
    backupFeedback('Fichier vérifié. Tu peux consulter son contenu avant de restaurer.');
  }));
  element<HTMLButtonElement>('[data-backup-restore]', dialog).addEventListener('click', () => void operation(async () => {
    if (!await builder.flush()) throw new Error('Termine l’enregistrement des decks avant de restaurer.');
    const result = await desktop.restoreBackup(captureLibraryStorage(window.localStorage));
    if (result.canceled) { backupFeedback('Restauration annulée.'); return; }
    // No pagehide save may send an old table into the newly restored database.
    builder.retire();
    backupFeedback('Restauration de l’espace…');
    window.location.reload();
  }));
  quit.addEventListener('click', async () => {
    closeMenu();
    quit.disabled = true;
    try { await desktop.quit(); }
    catch { quit.disabled = false; status('Impossible de quitter l’application.', true); if (!dialog.open) dialog.showModal(); }
  });
}
