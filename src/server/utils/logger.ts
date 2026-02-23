import chalk from "chalk";
import { spawnSync } from "child_process";

/**
 * Centralized logger with chalk styling for consistent CLI output.
 * Provides visual hierarchy through colors and icons.
 */
export const log = {
  /** Success message - green checkmark */
  success: (msg: string) => console.log(chalk.green("✓") + " " + msg),

  /** Info/action message - cyan arrow */
  info: (msg: string) => console.log(chalk.cyan("→") + " " + msg),

  /** Warning message - yellow warning icon */
  warn: (msg: string) => console.log(chalk.yellow("⚠") + " " + msg),

  /** Error message - red X */
  error: (msg: string) => console.log(chalk.red("✗") + " " + msg),

  /** Secondary/step info - gray indented */
  step: (msg: string) => console.log(chalk.gray("  " + msg)),

  /** Plain message without icon */
  plain: (msg: string) => console.log(msg),

  /** Dimmed verbose output */
  verbose: (msg: string) => console.log(chalk.dim(msg)),

  /** Format a URL for display */
  url: (url: string) => chalk.cyan(url),

  /** Format an ID for display */
  id: (id: string) => chalk.yellow(id),

  /** Format a duration for display */
  duration: (ms: number) => chalk.gray(`(${formatDuration(ms)})`),

  /** HTTP request log - compact format */
  request: (method: string, path: string, status: number, durationMs: number) => {
    const statusColor = status >= 400 ? chalk.red : status >= 300 ? chalk.yellow : chalk.green;
    const methodPad = method.padEnd(6);
    console.log(chalk.gray(methodPad) + " " + path + " " + statusColor(status) + " " + chalk.gray(`${durationMs}ms`));
  },

  /** Sandbox lifecycle events */
  sandbox: {
    creating: (id: string) => console.log(chalk.cyan("→") + " Creating sandbox " + chalk.yellow(id) + "..."),
    created: (id: string, ip: string, durationMs?: number) => {
      const dur = durationMs ? " " + chalk.gray(`(${formatDuration(durationMs)})`) : "";
      console.log(chalk.green("✓") + " Sandbox " + chalk.yellow(id) + " ready " + chalk.gray(`(${ip})`) + dur);
    },
    deleted: (id: string) => console.log(chalk.green("✓") + " Sandbox " + chalk.yellow(id) + " deleted"),
    error: (id: string, error: string) => console.log(chalk.red("✗") + " Sandbox " + chalk.yellow(id) + " failed: " + error),
  },

  /** Tunnel lifecycle events */
  tunnel: {
    starting: (name: string) => console.log(chalk.cyan("→") + " Starting tunnel " + chalk.gray(name) + "..."),
    ready: (name: string, url: string) => console.log(chalk.green("✓") + " Tunnel " + chalk.gray(name) + " ready: " + chalk.cyan(url)),
    stopped: (name: string) => console.log(chalk.green("✓") + " Tunnel " + chalk.gray(name) + " stopped"),
    error: (name: string, error: string) => console.log(chalk.red("✗") + " Tunnel " + chalk.gray(name) + " failed: " + error),
  },

  /** Health check progress */
  health: {
    waiting: (target: string) => console.log(chalk.gray("  Waiting for " + target + "...")),
    progress: (target: string, attempt: number, status?: number) => {
      const statusStr = status ? ` (${status})` : "";
      process.stdout.write(`\r${chalk.gray("  Health check: " + target + " attempt " + attempt + statusStr)}    `);
    },
    passed: (target: string, attempts: number) => {
      process.stdout.write("\r" + " ".repeat(80) + "\r"); // Clear the line
      console.log(chalk.green("✓") + " Health check passed " + chalk.gray(`(${attempts} attempts)`));
    },
    failed: (target: string, attempts: number) => {
      process.stdout.write("\r" + " ".repeat(80) + "\r"); // Clear the line
      console.log(chalk.red("✗") + " Health check failed after " + attempts + " attempts");
    },
  },

  /** Server startup */
  server: {
    starting: (port: number) => console.log(chalk.cyan("→") + " Starting server on port " + chalk.yellow(port) + "..."),
    ready: (url: string) => console.log(chalk.green("✓") + " Server ready: " + chalk.cyan(url)),
    shutdown: () => {
      console.log(chalk.yellow("→") + " Shutting down...");
    },
  },

  /** Device pairing */
  pairing: {
    waiting: (code: string) => console.log(chalk.gray("  Pairing code: ") + chalk.yellow.bold(code)),
    confirmed: () => console.log(chalk.green("✓") + " Device paired"),
  },
};

/** Format milliseconds to human readable string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default log;
