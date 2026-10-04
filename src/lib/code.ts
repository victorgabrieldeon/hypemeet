/** Strips separators/spaces and uppercases: "abc-def" → "ABCDEF". Mirrors the server. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "ABCDEF" → "ABC-DEF" for display. */
export function formatCode(code: string): string {
  const clean = normalizeCode(code);
  return clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
}
