/** Shared by every view module — throws loudly on a missing element instead of a silent null downstream. */
export function element<T extends Element>(selector: string, root: ParentNode = document): T {
  const result = root.querySelector<T>(selector);
  if (!result) throw new Error(`Élément introuvable : ${selector}`);
  return result;
}
