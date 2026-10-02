type Selection = { key: string; clientKey: string; time: string; duration: number };

function minutes(value: unknown): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Core reports the attempted range that overlapped the client's existing booking.
export function clientConflictSelectionKeys(
  selections: Selection[],
  clientKey: string,
  details: unknown
): Set<string> {
  const range = details as { startTime?: unknown; endTime?: unknown } | null;
  const start = minutes(range?.startTime);
  let end = minutes(range?.endTime);
  if (start >= 0 && end >= 0 && end <= start) end += 1440;
  const hasRange = start >= 0 && end > start;
  return new Set(selections.filter((row) => {
    if (row.clientKey !== clientKey || !row.time) return false;
    if (!hasRange) return true;
    const selectedStart = minutes(row.time);
    const selectedEnd = selectedStart + row.duration;
    return selectedStart >= 0 && selectedStart < end && selectedEnd > start;
  }).map((row) => row.key));
}
