export interface IssueLike {
  readonly code: string;
  readonly path: string;
}

export function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareIssue<T extends IssueLike>(a: T, b: T): number {
  const pathOrder = compareString(a.path, b.path);
  if (pathOrder !== 0) return pathOrder;
  return compareString(a.code, b.code);
}

export function formatIssueDetail<T extends IssueLike>(issues: readonly T[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");
  return `${countLabel}: ${issueSummary}`;
}

export function sortIssues<T extends IssueLike>(issues: readonly T[]): readonly T[] {
  return [...issues].sort(compareIssue);
}
