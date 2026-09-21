export interface FilterOption { value: string; label: string }

/** Local prototype combobox with removable values and keyboard navigation. */
export function initFilterCombobox(
  host: HTMLElement,
  options: FilterOption[],
  onChange: (values: string[]) => void,
  allowCustom = false,
) {
  const input = host.querySelector<HTMLInputElement>('input')!;
  const list = host.querySelector<HTMLElement>('[role=listbox]')!;
  const chips = host.querySelector<HTMLElement>('.lab-filter-chips')!;
  const status = host.querySelector<HTMLElement>('[role=status]')!;
  const selected = new Map<string, FilterOption>();
  let matches: FilterOption[] = [];
  let cursor = 0;
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function renderOptions() {
    const query = normalize(input.value.trim());
    const rank = (o: FilterOption) => normalize(o.value) === query || normalize(o.label) === query ? 3 : normalize(o.label).startsWith(query) ? 2 : 1;
    matches = options.filter(o => !selected.has(o.value) && normalize(`${o.label} ${o.value}`).includes(query))
      .sort((a, b) => rank(b) - rank(a));
    if (allowCustom && query && !options.some(o => normalize(o.value) === query) && !selected.has(input.value.trim())) {
      matches.push({value:input.value.trim(), label:input.value.trim()});
    }
    cursor = Math.min(cursor, Math.max(0, matches.length - 1));
    list.replaceChildren();
    matches.forEach((option, index) => {
      const row = document.createElement('div');
      row.id = `${list.id}-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === cursor));
      row.textContent = option.label;
      if (option.value !== option.label) {
        const code = document.createElement('small'); code.textContent = option.value.toUpperCase(); row.append(code);
      }
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', () => add(option));
      list.append(row);
    });
    if (!matches.length) {
      const empty = document.createElement('p'); empty.textContent = 'No matching values'; list.append(empty);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (matches.length) input.setAttribute('aria-activedescendant', `${list.id}-${cursor}`);
    else input.removeAttribute('aria-activedescendant');
    status.textContent = `${matches.length} suggestions`;
  }
  function renderChips() {
    chips.replaceChildren();
    selected.forEach(option => {
      const chip = document.createElement('button'); chip.type = 'button';
      chip.textContent = `${option.label} ×`;
      chip.setAttribute('aria-label', `Remove ${option.label} filter`);
      chip.addEventListener('click', () => {
        selected.delete(option.value); renderChips(); onChange([...selected.keys()]); input.focus(); renderOptions();
      });
      chips.append(chip);
    });
  }
  function add(option: FilterOption) {
    selected.set(option.value, option); input.value = ''; cursor = 0;
    renderChips(); onChange([...selected.keys()]); input.focus(); close();
    status.textContent = `${option.label} added`;
  }
  input.addEventListener('focus', () => { cursor = 0; renderOptions(); });
  input.addEventListener('click', () => { if (list.hidden) renderOptions(); });
  input.addEventListener('input', () => { cursor = 0; renderOptions(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Tab') close();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) { cursor = 0; renderOptions(); }
      else { cursor = (cursor + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1); renderOptions(); }
      list.children[cursor]?.scrollIntoView({block:'nearest'});
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (list.hidden && input.value.trim()) renderOptions();
      if (!list.hidden && matches[cursor]) add(matches[cursor]!);
    }
    if (event.key === 'Backspace' && !input.value && selected.size) {
      selected.delete([...selected.keys()].at(-1)!); renderChips(); onChange([...selected.keys()]); renderOptions();
    }
  });
  host.addEventListener('focusout', event => {
    if (!host.contains(event.relatedTarget as Node | null)) close();
  });
}
