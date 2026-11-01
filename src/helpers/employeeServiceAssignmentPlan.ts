/**
 * Plan an employee's booking-service assignments against the active Core catalog.
 * Never silently convert legacy IDs to another catalog service, since equally
 * named home/on-site services may have different prices, durations and policies.
 * The caller must show an explicit confirmation for unresolved IDs before writing.
 */
export function planActiveEmployeeServiceAssignments(
  selectedIds: readonly string[],
  activeCatalog: readonly { id: string; active?: boolean }[]
): { activeIds: string[]; unresolvedIds: string[] } {
  const validIds = new Set(
    activeCatalog
      .filter((row) => row.active !== false)
      .map((row) => String(row.id || "").trim())
      .filter(Boolean)
  );
  const activeIds: string[] = [];
  const unresolvedIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of selectedIds) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (validIds.has(id)) activeIds.push(id);
    else unresolvedIds.push(id);
  }
  return { activeIds, unresolvedIds };
}
