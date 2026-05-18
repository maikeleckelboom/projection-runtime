export {
  type CompileProjectionFailure,
  type CompileProjectionResult,
  type CompileProjectionSuccess,
  compileAuthoredProjectionContract,
} from "./compile";
export {
  COMPILER_ERRORS,
  COMPILER_ISSUE_DEFS,
  type CompilerCompilationRejectedDetails,
  type CompilerError,
  type CompilerErrorCode,
  type CompilerErrorKey,
  type CompilerIssue,
  type CompilerIssueCode,
  type CompilerIssueSource,
  createCompilerError,
  createCompilerIssue,
} from "./error";
export {
  buildProjectionFieldIdentityMirror,
  deriveProjectionFieldIdentityArtifact,
  deriveProjectionFieldIdentityArtifactFromManifest,
  type EmitTypeScriptFieldIdentityModuleOptions,
  emitTypeScriptFieldIdentityModule,
  type ProjectionFieldIdentityArtifact,
  type ProjectionFieldIdentityEntry,
  type ProjectionFieldIdentityMirror,
} from "./field-identity";
export type {
  CanonicalColdLaneDeclaration,
  CanonicalField,
  CanonicalFieldShape,
  CanonicalHotLaneDeclaration,
  CanonicalLaneDeclarations,
  CanonicalProjectionManifest,
  CanonicalWarmLaneDeclaration,
  ColdCodecVersion,
  HotLayoutVersion,
  LaneManifests,
  ResolvedProjectionContract,
  SemanticVersion,
  WarmCodecVersion,
} from "./manifest";
