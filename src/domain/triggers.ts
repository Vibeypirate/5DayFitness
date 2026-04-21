function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchTrigger(text: string | undefined | null, triggers: string[]): boolean {
  if (!text) {
    return false;
  }

  const normalized = normalize(text);
  return triggers.some((trigger) => normalized.includes(normalize(trigger)));
}
