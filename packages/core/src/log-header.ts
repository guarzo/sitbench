const LISTENER_LINE = /^\s*Listener:\s*(.+?)\s*$/m;

export function parseLogHeader(text: string): { character: string | null } {
  const match = LISTENER_LINE.exec(text);

  return {
    character: match?.[1]?.trim() ?? null,
  };
}
