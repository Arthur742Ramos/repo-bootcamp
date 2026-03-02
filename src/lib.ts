export * from "./api.js";
export {
  clearCache,
  getCacheDir,
  pruneCache,
  readCache,
  writeCache,
  type CacheGenerationOptions,
} from "./cache.js";
export {
  extractDependencies,
  generateDependencyDiagram,
  generateDependencyDocs,
  type Dependency,
  type DependencyAnalysis,
  type DependencyCategory,
} from "./deps.js";
export {
  analyzeDiff,
  fetchPullRequestRefs,
  generateDiffDocs,
  parsePullRequestTarget,
  type PullRequestRefs,
} from "./diff.js";
export {
  isMermaidCliAvailable,
  parseMermaidFile,
  renderDiagram,
  renderMermaidFile,
  renderOutputDiagrams,
  type DiagramFormat,
  type RenderResult,
} from "./diagrams.js";
export {
  analyzeBadges,
  analyzeCLIDrift,
  analyzeDocumentation,
  analyzeFrameworkDocs,
  analyzePrerequisites,
  analyzeVersionMismatches,
  type BadgeIssue,
  type CLIDrift,
  type DocsAnalysisResult,
  type FrameworkIssue,
  type PrerequisiteIssue,
  type VersionMismatch,
} from "./docs-analyzer.js";
export {
  addMissingFrameworks,
  fixDocumentation,
  updateCLIUsage,
  updateVersionNumbers,
  type FixResult,
  type FixSummary,
} from "./docs-fixer.js";
export {
  cloneRepo,
  detectFrameworksFromDeps,
  listFilesByPattern,
  mergeFrameworksFromDeps,
  parseGitHubUrl,
  readRepoFile,
  scanRepo,
} from "./ingest.js";
export {
  isAnalyzerPlugin,
  isFormatterPlugin,
  isOutputTargetPlugin,
  type AnalyzerPlugin,
  type BootcampPlugin,
  type FormatterContext,
  type FormatterPlugin,
  type OutputTargetContext,
  type OutputTargetPlugin,
  type PluginDocument,
  type PluginOutput,
} from "./plugin-api.js";
export {
  STYLE_PACK_NAMES,
  STYLE_PACKS,
  examplePlugin,
  generateExampleConfig,
  getStyleConfig,
  loadConfig,
  loadPlugins,
  runPlugins,
  type BootcampConfig,
  type StyleConfig,
} from "./plugins.js";
export {
  getMissingFieldsSummary,
  RepoFactsSchema,
  validateRepoFacts,
  type ValidatedRepoFacts,
  type ValidationResult,
} from "./schema.js";
export {
  analyzeSecurityPatterns,
  generateSecurityDocs,
  getSecurityGrade,
  type AuthPattern,
  type SecurityAnalysis,
  type SecurityDependency,
  type SecurityFinding,
  type Severity,
} from "./security.js";
export { getRepoTools, safePath, type RepoTool, type ToolContext } from "./tools.js";
export {
  fetchAndCheckUpdates,
  getHeadCommit,
  startWatch,
  type FetchUpdateOptions,
  type WatchHandle,
  type WatchOptions,
} from "./watch.js";
