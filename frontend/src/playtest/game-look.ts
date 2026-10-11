const looks = [
  ['current', 'Interface actuelle'],
  ['luminous', 'Table lumineuse'],
  ['strategy', 'Stratégie contrastée'],
] as const;

/** Session-only exploration: no match state or permanent presentation preference changes. */
export function mountGameLook(root: HTMLElement): HTMLFieldSetElement {
  const panel = document.createElement('fieldset');
  panel.className = 'game-look-picker';
  const title = document.createElement('legend');
  title.textContent = 'Exploration visuelle';
  const description = document.createElement('p');
  description.textContent = 'Deux pistes à comparer. Ce choix ne dure que pour cette session.';
  panel.append(title, description);
  let selected = 'current';
  try { selected = sessionStorage.getItem('asphodel-game-look') || selected; } catch { /* Storage can be unavailable. */ }
  if (!looks.some(([id]) => id === selected)) selected = 'current';
  root.dataset.look = selected;
  for (const [id, label] of looks) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.gameLook = id;
    button.textContent = label; button.setAttribute('aria-pressed', String(id === selected));
    button.addEventListener('click', () => {
      root.dataset.look = id;
      for (const control of panel.querySelectorAll('button')) {
        control.setAttribute('aria-pressed', String(control === button));
      }
      try { sessionStorage.setItem('asphodel-game-look', id); } catch { /* Keep the live selection. */ }
    });
    panel.append(button);
  }
  return panel;
}
