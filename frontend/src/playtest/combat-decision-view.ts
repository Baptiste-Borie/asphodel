import {battlefieldArtUri} from './card-art';
import type {CombatDecisionModel, CombatIdentity} from './combat-decision';
import type {AgentChoice, CardPresentation} from './types';

/** The selected creature is local navigation. Only explicit edit/finish buttons submit Forge choices. */
export function createCombatDecisionView() {
  let scope = '', activeRef: string | null = null, generation = 0, busy = false;
  let mountedRoot: HTMLElement | null = null;
  function deactivate() {generation++; busy = true; mountedRoot?.removeAttribute('aria-busy');}
  function reset() {deactivate(); scope = ''; activeRef = null;}

  function render(root: HTMLElement, model: CombatDecisionModel,
      get: (name: string) => CardPresentation | null | undefined, choose: (choice: AgentChoice) => void) {
    mountedRoot = root;
    if (scope !== model.scope) {scope = model.scope; activeRef = null;}
    if (!model.groups.some(group => group.card.ref === activeRef)) activeRef = model.groups[0]?.card.ref ?? null;
    busy = false;
    let serial: number;
    const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.combatFocus : undefined;

    function portrait(card: CombatIdentity) {
      const element = document.createElement('span'); element.className = 'combat-card';
      const art = card.artName ? battlefieldArtUri(get(card.artName)) : null;
      if (art) {
        const image = document.createElement('img'); image.src = art; image.alt = ''; image.onerror = () => image.remove(); element.append(image);
      }
      const text = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = card.label; text.append(name);
      if (card.stats) {const stats = document.createElement('small'); stats.textContent = card.stats; text.append(stats);}
      element.append(text); return element;
    }
    function submit(choice: AgentChoice) {
      if (busy || serial !== generation || !root.isConnected || choice.decisionId !== model.decisionId) return;
      busy = true; root.setAttribute('aria-busy','true');
      for (const button of root.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true;
      root.querySelector<HTMLElement>('.combat-submit-status')!.textContent = 'Envoi du choix…';
      choose(choice);
    }
    function paint() {
      serial = ++generation;
      root.classList.remove('table-decision-dock--complex','table-decision-dock--cards','table-decision-dock--opening-hand','physical-declaration');
      root.classList.add('table-decision-dock--combat'); root.setAttribute('aria-busy','false');
      const panel = document.createElement('section'); panel.className = 'combat-flow';
      const heading = document.createElement('h2'); heading.textContent = model.heading;
      const hint = document.createElement('p'); hint.className = 'combat-hint';
      hint.textContent = model.type === 'attackers_selection' ? 'Choisis une créature, puis qui elle attaque.' : 'Choisis une créature, puis l’attaquant qu’elle bloque.';
      const body = document.createElement('div'); body.className = 'combat-body';
      if (model.attackers !== null) {
        const threats = document.createElement('details'); threats.className = 'combat-threats'; threats.open = true;
        const title = document.createElement('summary'); title.textContent = `Attaquants · ${model.attackers.length}`; threats.append(title);
        for (const attacker of model.attackers) {
          const row = document.createElement('p'); row.className = 'combat-assignment'; row.append(portrait(attacker.card));
          const detail = document.createElement('span');
          detail.textContent = `→ ${attacker.defender.label} · Tes blocs : ${attacker.ownBlocks ?? '?'}`
            + (!attacker.canAddBlock ? ' · Aucun ajout de bloc proposé' : '');
          row.append(detail); threats.append(row);
        }
        body.append(threats);
      }
      const columns = document.createElement('div'); columns.className = 'combat-columns';
      const creatures = document.createElement('div'); creatures.className = 'combat-creatures'; creatures.setAttribute('aria-label','Créatures disponibles');
      for (const group of model.groups) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'combat-creature';
        button.dataset.combatCard = group.card.ref; button.dataset.combatFocus = `card:${group.card.ref}`;
        button.setAttribute('aria-pressed',String(activeRef === group.card.ref)); button.append(portrait(group.card));
        if (group.selected) {const marker = document.createElement('small'); marker.className = 'combat-selected'; marker.textContent = 'Déclarée'; button.append(marker);}
        const token = generation;
        button.onclick = () => {
          if (busy || token !== generation) return;
          activeRef = group.card.ref; paint();
          root.querySelector<HTMLButtonElement>('.combat-edit')?.focus();
        };
        creatures.append(button);
      }
      const edits = document.createElement('div'); edits.className = 'combat-edits';
      const current = model.groups.find(group => group.card.ref === activeRef);
      if (current) {
        const name = document.createElement('h3'); name.textContent = current.card.label; edits.append(name);
        for (const option of current.options) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'combat-edit';
          const verb = option.operation === 'remove' ? 'Retirer' : model.type === 'attackers_selection' ? 'Attaquer' : 'Bloquer';
          button.dataset.operation = option.operation;
          button.dataset.combatFocus = `choice:${'choice' in option.item.choice ? option.item.choice.choice : ''}`;
          button.textContent = `${verb} → ${option.destination.label}${option.destination.stats ? ` (${option.destination.stats})` : ''}`;
          const token = generation; button.onclick = () => {if (token === generation) submit(option.item.choice);};
          edits.append(button);
        }
      } else {
        const none = document.createElement('p'); none.textContent = 'Aucune créature à modifier dans cette décision.'; edits.append(none);
      }
      columns.append(creatures,edits); body.append(columns);
      const assignments = document.createElement('details'); assignments.className = 'combat-assignments';
      const title = document.createElement('summary');
      title.textContent = model.assignments === null ? 'Affectations indisponibles' : `Affectations confirmées · ${model.assignments.length}`;
      assignments.append(title);
      if (model.assignments?.length) {
        for (const pair of model.assignments) {
          const row = document.createElement('p'); row.textContent = `${pair.card.label} → ${pair.destination.label}`; assignments.append(row);
        }
      } else if (model.assignments) {
        const empty = document.createElement('p'); empty.textContent = 'Aucune créature déclarée pour le moment.'; assignments.append(empty);
      }
      body.append(assignments);
      const footer = document.createElement('footer'); footer.className = 'combat-footer';
      const status = document.createElement('p'); status.className = 'combat-submit-status'; status.setAttribute('role','status');
      if (!model.finishes.length) status.textContent = 'La déclaration n’est pas encore validable. Ajuste les affectations proposées.';
      for (const finish of model.finishes) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'combat-finish'; button.textContent = finish.label;
        button.dataset.combatFocus = `finish:${'choice' in finish.item.choice ? finish.item.choice.choice : ''}`;
        const token = generation; button.onclick = () => {if (token === generation) submit(finish.item.choice);}; footer.append(button);
      }
      footer.append(status); panel.append(heading,hint,body,footer); root.replaceChildren(panel);
    }
    paint();
    if (focusKey) {
      const controls = [...root.querySelectorAll<HTMLButtonElement>('[data-combat-focus]')];
      (controls.find(control => control.dataset.combatFocus === focusKey)
        ?? controls.find(control => control.dataset.combatCard === activeRef))?.focus();
    }
  }
  return {render,deactivate,reset};
}
