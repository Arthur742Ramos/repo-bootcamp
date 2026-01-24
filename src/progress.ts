/**
 * Enhanced Progress Indicators
 * Provides real-time progress updates with elapsed time, phases, and tool tracking
 */

import ora, { Ora } from "ora";
import chalk from "chalk";

/**
 * Progress phases for the bootcamp generation
 */
export type ProgressPhase = "clone" | "scan" | "analyze" | "generate" | "cleanup";

const PHASE_LABELS: Record<ProgressPhase, string> = {
  clone: "Cloning repository",
  scan: "Scanning files",
  analyze: "Analyzing with AI",
  generate: "Generating docs",
  cleanup: "Cleaning up",
};

const PHASE_ICONS: Record<ProgressPhase, string> = {
  clone: "📦",
  scan: "🔍",
  analyze: "🤖",
  generate: "📝",
  cleanup: "🧹",
};

/**
 * Format elapsed time as human-readable string
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Enhanced progress tracker with real-time updates
 */
export class ProgressTracker {
  private spinner: Ora;
  private startTime: number;
  private phaseStartTime: number;
  private currentPhase: ProgressPhase | null = null;
  private toolCalls: { name: string; timestamp: number }[] = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private lastMessage: string = "";
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.spinner = ora({
      spinner: "dots",
      color: "cyan",
    });
    this.startTime = Date.now();
    this.phaseStartTime = Date.now();
    this.verbose = verbose;
  }

  /**
   * Start a new phase
   */
  startPhase(phase: ProgressPhase, detail?: string): void {
    // Stop any existing interval
    this.stopInterval();

    this.currentPhase = phase;
    this.phaseStartTime = Date.now();
    this.lastMessage = detail || "";

    const label = PHASE_LABELS[phase];
    const icon = PHASE_ICONS[phase];
    const text = detail ? `${icon} ${label}: ${detail}` : `${icon} ${label}...`;

    this.spinner.start(text);

    // Start real-time timer updates for analyze phase
    if (phase === "analyze") {
      this.startTimerUpdates();
    }
  }

  /**
   * Update the current phase with a new message
   */
  update(message: string): void {
    if (!this.currentPhase) return;

    this.lastMessage = message;
    this.updateSpinnerText();
  }

  /**
   * Record a tool call (for analyze phase)
   */
  recordToolCall(name: string): void {
    this.toolCalls.push({ name, timestamp: Date.now() });
    this.updateSpinnerText();
  }

  /**
   * Update spinner text with current state
   */
  private updateSpinnerText(): void {
    if (!this.currentPhase) return;

    const elapsed = formatElapsed(Date.now() - this.phaseStartTime);
    const totalElapsed = formatElapsed(Date.now() - this.startTime);
    const icon = PHASE_ICONS[this.currentPhase];
    const label = PHASE_LABELS[this.currentPhase];

    let text = `${icon} ${label}`;

    if (this.currentPhase === "analyze") {
      const toolCount = this.toolCalls.length;
      const lastTool = this.toolCalls[this.toolCalls.length - 1]?.name || "";

      text += chalk.gray(` [${elapsed}]`);

      if (toolCount > 0) {
        text += chalk.cyan(` (${toolCount} tool calls)`);
        if (lastTool && !this.lastMessage.includes("Tool:")) {
          text += chalk.gray(` - last: ${lastTool}`);
        }
      }

      if (this.lastMessage) {
        // Truncate long messages
        const msg = this.lastMessage.length > 40 
          ? this.lastMessage.substring(0, 37) + "..." 
          : this.lastMessage;
        text += chalk.white(` ${msg}`);
      }
    } else if (this.lastMessage) {
      text += `: ${this.lastMessage}`;
      text += chalk.gray(` [${elapsed}]`);
    } else {
      text += chalk.gray(` [${elapsed}]`);
    }

    this.spinner.text = text;
  }

  /**
   * Start periodic timer updates
   */
  private startTimerUpdates(): void {
    this.updateInterval = setInterval(() => {
      this.updateSpinnerText();
    }, 1000);
  }

  /**
   * Stop the timer interval
   */
  private stopInterval(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Complete current phase successfully
   */
  succeed(message?: string): void {
    this.stopInterval();

    const elapsed = formatElapsed(Date.now() - this.phaseStartTime);
    const icon = this.currentPhase ? PHASE_ICONS[this.currentPhase] : "✓";

    let text = message || (this.currentPhase ? PHASE_LABELS[this.currentPhase] : "Done");

    if (this.currentPhase === "analyze") {
      const toolCount = this.toolCalls.length;
      text += chalk.gray(` (${toolCount} tool calls, ${elapsed})`);
    } else {
      text += chalk.gray(` [${elapsed}]`);
    }

    this.spinner.succeed(text);
    this.currentPhase = null;
  }

  /**
   * Fail current phase
   */
  fail(message: string): void {
    this.stopInterval();
    this.spinner.fail(message);
    this.currentPhase = null;
  }

  /**
   * Warn on current phase
   */
  warn(message: string): void {
    this.stopInterval();
    this.spinner.warn(message);
  }

  /**
   * Get statistics about the run
   */
  getStats(): { totalTime: number; toolCalls: number; toolNames: string[] } {
    return {
      totalTime: Date.now() - this.startTime,
      toolCalls: this.toolCalls.length,
      toolNames: this.toolCalls.map((t) => t.name),
    };
  }

  /**
   * Stop and clean up
   */
  stop(): void {
    this.stopInterval();
    this.spinner.stop();
  }

  /**
   * Get tool call count
   */
  getToolCallCount(): number {
    return this.toolCalls.length;
  }

  /**
   * Get elapsed time since start
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Print a phase overview header
   */
  static printPhaseOverview(): void {
    console.log(chalk.gray("\nPhases: ") + 
      Object.entries(PHASE_ICONS)
        .map(([phase, icon]) => `${icon} ${phase}`)
        .join(chalk.gray(" → "))
    );
    console.log();
  }
}

/**
 * Simple progress bar for file scanning
 */
export function createProgressBar(total: number, width: number = 30): (current: number) => string {
  return (current: number): string => {
    const percent = Math.min(100, Math.round((current / total) * 100));
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(empty));
    return `[${bar}] ${percent}%`;
  };
}
