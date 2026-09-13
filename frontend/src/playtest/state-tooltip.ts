/** One viewport-clamped tooltip, outside scrolling card bands. Keyboard and pointer share it. */
export function attachStateTooltip(root: HTMLElement): void {
  const tooltip = document.createElement('div'); tooltip.className = 'card-state-tooltip';
  tooltip.id = 'physical-state-tooltip'; tooltip.role = 'tooltip'; tooltip.hidden = true;
  document.body.append(tooltip);
  let current: HTMLElement | null = null;
  const hide = () => { current?.removeAttribute('aria-describedby'); current = null; tooltip.hidden = true; };
  const show = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null;
    if (!target || !target.closest('.table-root--physical')) return;
    hide(); current = target;
    tooltip.textContent = target.dataset.tooltip ?? ''; tooltip.hidden = false;
    target.setAttribute('aria-describedby', tooltip.id);
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(10, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 10))}px`;
    tooltip.style.top = `${Math.max(10, Math.min(rect.bottom + 8, innerHeight - tooltip.offsetHeight - 10))}px`;
  };
  root.addEventListener('pointerover', show); root.addEventListener('focusin', show);
  root.addEventListener('pointerout', hide); root.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}
