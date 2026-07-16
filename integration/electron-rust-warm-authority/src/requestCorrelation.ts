export function takeCorrelatedRequest<T>(
  pending: Map<string, T>,
  requestKey: string,
  label: string,
): T {
  const request = pending.get(requestKey);
  if (request === undefined) throw new Error(`uncorrelated ${label} ${requestKey}`);
  pending.delete(requestKey);
  return request;
}
