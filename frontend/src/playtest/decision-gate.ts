/** A submitted decision stays consumed even if an in-flight poll returns its old snapshot. */
export class DecisionGate {
  private consumed = new Set<string>();
  private current: string | null = null;
  observe(id: string | null): void { this.current = id; }
  allows(id: string): boolean { return id === this.current && !this.consumed.has(id); }
  consume(id: string): boolean {
    if (!this.allows(id)) return false;
    this.consumed.add(id);
    return true;
  }
  retry(id: string): void { this.consumed.delete(id); }
}
