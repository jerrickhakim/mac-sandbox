import { ChildProcess, spawn } from "child_process";
import log from "./logger.js";

export interface TunnelInfo {
  url: string;
  process: ChildProcess;
}

/**
 * Start a cloudflared quick tunnel
 * This creates a temporary tunnel URL that routes to the specified IP address and port
 */
export function startTunnel(port: number, ipAddress?: string, name?: string): Promise<TunnelInfo> {
  return new Promise((resolve, reject) => {
    const tunnelName = name || `sandbox-${port}`;
    log.tunnel.starting(tunnelName);

    // Use the provided IP address or default to localhost
    const targetHost = ipAddress || "localhost";
    const cloudflared = spawn("cloudflared", ["tunnel", "--url", `http://${targetHost}:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let resolved = false;

    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      output += text;

      // Look for the tunnel URL in the output
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        const url = match[0];
        log.tunnel.ready(tunnelName, url);
        resolve({ url, process: cloudflared });
      }
    };

    cloudflared.stdout.on("data", handleOutput);
    cloudflared.stderr.on("data", handleOutput);

    cloudflared.on("error", (error) => {
      if (!resolved) {
        log.tunnel.error(tunnelName, error.message);
        reject(new Error(`Failed to start cloudflared: ${error.message}`));
      }
    });

    cloudflared.on("close", (code) => {
      if (!resolved) {
        log.tunnel.error(tunnelName, `exited with code ${code}`);
        reject(new Error(`cloudflared exited with code ${code}. Output: ${output}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        cloudflared.kill();
        log.tunnel.error(tunnelName, "startup timed out after 30 seconds");
        reject(new Error(`Tunnel startup timed out after 30 seconds. Output: ${output}`));
      }
    }, 30000);
  });
}

/**
 * Check if cloudflared is installed
 */
export async function isCloudflaredInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", ["cloudflared"]);
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}
