export {
  analyzeRepo,
  createSessionWithFallback,
  readCustomPrompt,
  PREFERRED_MODELS,
  type AnalysisStats,
} from "./agent.js";
export { runParallelAnalysis, type ParallelAnalysisResult } from "./analysis.js";
export {
  evaluateDoctor,
  formatDoctorReport,
  gatherEnvironment,
  parseNodeMajor,
  MIN_NODE_MAJOR,
  TOKEN_ENV_VARS,
  type DoctorCheck,
  type DoctorReport,
  type EnvironmentSnapshot,
  type CheckStatus,
  type CheckSeverity,
} from "./doctor.js";
export {
  computeCodebaseMetrics,
  generateMetricsDocs,
  getApproachabilityGrade,
  formatBytes,
  type CodebaseMetrics,
  type LanguageMetric,
  type FileHotspot,
  type DirectoryMetric,
  type CodebaseSizeClass,
  type Approachability,
} from "./metrics.js";
export {
  computeRepoHealth,
  generateHealthDocs,
  getHealthGrade,
  type RepoHealth,
  type HealthCheck,
  type HealthStatus,
  type HealthCategory,
} from "./health.js";
export {
  generateBootcamp,
  generateOnboarding,
  generateArchitecture,
  generateCodemap,
  generateFirstTasks,
  generateRunbook,
  generateDiagrams,
} from "./generator.js";
export { isLocalPath, resolveRepo } from "./repo-resolver.js";
export {
  discoverTasks,
  categorizeTask,
  suggestGettingStarted,
  toCommands,
  CATEGORY_ORDER,
  type DiscoveredTask,
  type TaskCategory,
  type PackageManager,
  type DiscoverTasksOptions,
} from "./tasks.js";
export type {
  AnalyzeRepoDependencies,
  BootcampOptions,
  LlmClient,
  LlmSession,
  LlmSessionConfig,
  RepoFacts,
  RepoInfo,
  ScanResult,
  StylePack,
  TechRadar,
  ChangeImpact,
  DiffSummary,
  Command,
  StackInfo,
  FirstTask,
} from "./types.js";
