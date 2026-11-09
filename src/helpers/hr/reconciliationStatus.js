// Shared response contract: an operational save is distinct from its financial completion.
export function pendingReconciliations(value,depth=0) {
  if (!value || typeof value !== 'object' || depth>10) return [];
  const id=value.operationId || value.operation?.id;
  if (value.fullyCompleted === false && id) return [{id,status:value.status || value.operation?.status || 'pending'}];
  return Object.values(value).flatMap(child=>pendingReconciliations(child,depth+1));
}
