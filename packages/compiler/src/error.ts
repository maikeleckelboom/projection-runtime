export interface CompilerIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly source?: "schema" | "compiler" | "hot-codec";
  readonly causeCode?: string;
}

export class CompilerError extends Error {
  readonly issues: readonly CompilerIssue[];

  constructor(issues: readonly CompilerIssue[]) {
    const sortedIssues = sortCompilerIssues(issues);
    super(formatCompilerMessage(sortedIssues));
    this.name = "CompilerError";
    this.issues = sortedIssues;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function sortCompilerIssues(issues: readonly CompilerIssue[]): readonly CompilerIssue[] {
  return [...issues].sort(compareIssue);
}

function compareIssue(left: CompilerIssue, right: CompilerIssue): number {
  const pathOrder = compareString(left.path, right.path);
  if (pathOrder !== 0) {
    return pathOrder;
  }

  return compareString(left.code, right.code);
}

function compareString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function formatCompilerMessage(issues: readonly CompilerIssue[]): string {
  const countLabel = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const issueSummary = issues
    .map((issue) => `${issue.code}@${issue.path.length === 0 ? "<root>" : issue.path}`)
    .join("; ");

  return `Compiler rejected authored projection contract: ${countLabel}: ${issueSummary}`;
}
