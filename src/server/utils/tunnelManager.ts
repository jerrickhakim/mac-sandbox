import { ChildProcess, spawn } from "child_process";
import log from "./logger.js";

/** Metadata about a running tunnel */
export interface TunnelEntry {
  process: ChildProcess;
  tunnelId?: string;
  tunnelToken?: string;
  hostname?: string;
}

/**
 * Global manager for tracking tunnel processes
 * Ensures we can clean them up when sandboxes are stopped
 */
export class TunnelManager {
  private tunnels: Map<string, TunnelEntry> = new Map();

  /**
   * Register a tunnel process for a sandbox
   */
  registerTunnel(
    sandboxId: string,
    process: ChildProcess,
    metadata?: { tunnelId?: string; tunnelToken?: string; hostname?: string }
  ): void {
    this.tunnels.set(sandboxId, {
      process,
      tunnelId: metadata?.tunnelId,
      tunnelToken: metadata?.tunnelToken,
      hostname: metadata?.hostname,
    });
  }

  /**
   * Start a named tunnel using a token from the control plane
   * This runs: cloudflared tunnel run --token <token>
   */
  startNamedTunnel(sandboxId: string, tunnelToken: string, tunnelId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      log.tunnel.starting(sandboxId);

      const cloudflared = spawn("cloudflared", ["tunnel", "run", "--token", tunnelToken], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let resolved = false;

      console.log("cloudflared process", cloudflared);

      const handleOutput = (data: Buffer) => {
        console.log("cloudflared output", data.toString());
        const text = data.toString();
        output += text;

        // Only log errors from cloudflared, suppress verbose INFO messages
        if (text.includes("ERR") || text.includes("error")) {
          log.step(`[tunnel] ${text.trim()}`);
        }

        // Look for connection established message
        if ((text.includes("Registered tunnel connection") || text.includes("Connection")) && !resolved) {
          console.log("cloudflared resolved", text);
          resolved = true;
          this.registerTunnel(sandboxId, cloudflared, { tunnelId, tunnelToken });
          log.tunnel.ready(sandboxId, `${sandboxId}.app.tl`);
          resolve();
        }
      };

      cloudflared.stdout.on("data", handleOutput);
      cloudflared.stderr.on("data", handleOutput);

      cloudflared.on("error", (error) => {
        if (!resolved) {
          log.tunnel.error(sandboxId, error.message);
          reject(new Error(`Failed to start cloudflared: ${error.message}`));
        }
      });

      cloudflared.on("close", (code) => {
        if (!resolved) {
          log.tunnel.error(sandboxId, `exited with code ${code}`);
          reject(new Error(`cloudflared exited with code ${code}. Output: ${output}`));
        }
        this.tunnels.delete(sandboxId);
      });

      // Timeout after 30 seconds, but still register the tunnel
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.registerTunnel(sandboxId, cloudflared, { tunnelId, tunnelToken });
          log.warn(`Tunnel ${sandboxId} started (timeout waiting for confirmation)`);
          resolve();
        }
      }, 30000);
    });
  }

  /**
   * Stop and clean up a tunnel for a sandbox
   */
  stopTunnel(sandboxId: string): void {
    const entry = this.tunnels.get(sandboxId);
    if (entry) {
      try {
        entry.process.kill("SIGTERM");
        // Fallback to SIGKILL after grace period
        setTimeout(() => {
          if (!entry.process.killed) {
            entry.process.kill("SIGKILL");
          }
        }, 2000);
        log.tunnel.stopped(sandboxId);
      } catch (error: any) {
        log.tunnel.error(sandboxId, error.message);
      }
      this.tunnels.delete(sandboxId);
    }
  }

  /**
   * Get tunnel entry for a sandbox
   */
  getTunnel(sandboxId: string): TunnelEntry | undefined {
    return this.tunnels.get(sandboxId);
  }

  /**
   * Stop all tunnels
   */
  stopAll(): void {
    if (this.tunnels.size > 0) {
      log.step(`Stopping ${this.tunnels.size} sandbox tunnel(s)...`);
    }
    for (const [sandboxId, entry] of this.tunnels) {
      try {
        entry.process.kill("SIGTERM");
        setTimeout(() => {
          if (!entry.process.killed) {
            entry.process.kill("SIGKILL");
          }
        }, 2000);
      } catch (error: any) {
        log.tunnel.error(sandboxId, error.message);
      }
    }
    this.tunnels.clear();
  }

  /**
   * Get the number of active tunnels
   */
  count(): number {
    return this.tunnels.size;
  }

  /**
   * Check if a tunnel exists for a sandbox
   */
  hasTunnel(sandboxId: string): boolean {
    return this.tunnels.has(sandboxId);
  }
}

// Singleton instance
let tunnelManagerInstance: TunnelManager | null = null;

export function getTunnelManager(): TunnelManager {
  if (!tunnelManagerInstance) {
    tunnelManagerInstance = new TunnelManager();
  }
  return tunnelManagerInstance;
}

export function resetTunnelManager(): void {
  if (tunnelManagerInstance) {
    tunnelManagerInstance.stopAll();
  }
  tunnelManagerInstance = null;
}
