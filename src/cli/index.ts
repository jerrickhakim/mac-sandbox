#!/usr/bin/env node

import chalk from "chalk";
import { spawnSync } from "child_process";
import { dirname } from "path";
import { networkInterfaces } from "os";
import { createInterface } from "readline";
import qrcode from "qrcode-terminal";
import { fileURLToPath } from "url";
import { getTokenManager, startServer } from "../server/index.js";
import { getHostInfo } from "../server/utils/hostInfo.js";
import log from "../server/utils/logger.js";
import { checkDependencies, ensureContainerSystemStarted, runSetup } from "../server/utils/setup.js";
import { isCloudflaredInstalled, startTunnel } from "../server/utils/tunnel.js";
import type { ServerConfig } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get the local network IP address
 */

function getLocalNetworkIP(): string | undefined {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;

    for (const net of netInfo) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      const familyV4Value = typeof net.family === "string" ? "IPv4" : 4;
      if (net.family === familyV4Value && !net.internal) {
        return net.address;
      }
    }
  }
  return undefined;
}

const HELP = `
╔═══════════════════════════════════════════════════════════════╗
║                    🖥️  Mac Sandbox CLI                        ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  sandbox <command> [options]

COMMANDS:
  start         Start the sandbox server (auto-installs deps)
  setup         Install required dependencies
  health        Check system dependencies
  pair          Generate a new pairing code
  tokens        List all active tokens
  list          List all containers
  delete        Delete all containers
  destroy       Destroy container system and all containers
  help          Show this help message

OPTIONS:
  --port, -p        Port to run the server on (default: 4000)
  --tunnel, -t      Enable Cloudflare tunnel (for QR code)
  --image, -i       Container image to use (default: sandbox)
  --skip-setup      Skip dependency installation check

EXAMPLES:
  sandbox start                     # Start with local network URL
  sandbox start -t                  # Start with Cloudflare tunnel
  sandbox start --port 8080 -t      # Custom port with tunnel
  sandbox pair
  sandbox tokens
`;

function printConnectionInfo(tunnelUrl: string | undefined, pairingCode: string, port: number) {
  console.log();
  console.log(chalk.bold("🏖️  Mac Sandbox"));
  console.log();

  if (tunnelUrl) {
    // Tunnel mode - generate QR code for the tunnel URL
    const pairingUrl = `${tunnelUrl}/pairing/confirm?code=${pairingCode}`;
    qrcode.generate(pairingUrl, { small: true });
    console.log();
    console.log(chalk.gray("Tunnel URL:"));
    console.log(chalk.cyan(tunnelUrl));
  } else {
    // Local mode - generate QR code for the network URL
    const networkIP = getLocalNetworkIP();
    const networkUrl = networkIP ? `http://${networkIP}:${port}` : `http://127.0.0.1:${port}`;
    const pairingUrl = `${networkUrl}/pairing/confirm?code=${pairingCode}`;

    qrcode.generate(pairingUrl, { small: true });
    console.log();
    console.log(chalk.gray("Network URL:"));
    console.log(chalk.cyan(networkUrl));
    console.log();
    console.log(chalk.gray("Local URL:"));
    console.log(chalk.cyan(`http://localhost:${port}`));
  }

  console.log();
  console.log(chalk.gray("Pairing Code:"));
  console.log(chalk.yellow.bold(pairingCode));
  console.log();

  if (tunnelUrl) {
    console.log(chalk.gray(`Visit ${chalk.cyan(tunnelUrl + "/pairing/confirm")} or scan the QR code above`));
  } else {
    console.log(chalk.gray(`Scan the QR code above or POST to /pairing/confirm with the code`));
  }
  console.log();
}

function parseArgs(args: string[]): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = true;
      }
    } else if (!result._command) {
      result._command = arg;
    } else {
      rest.push(arg);
    }
  }

  if (rest.length > 0) {
    result._rest = rest;
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = (args._command as string) || "help";

  switch (command) {
    case "start": {
      const port = Number(args.port || args.p) || 4000;
      const enableTunnel = args.tunnel === true || args.t === true;
      const skipSetup = args["skip-setup"] === true;

      // Run setup to ensure dependencies are installed
      if (!skipSetup) {
        const deps = checkDependencies();
        if (!deps.cloudflared || !deps.container) {
          const setupResult = await runSetup();
          if (!setupResult.success) {
            if (setupResult.needsRerun) {
              console.log(chalk.yellow("Please complete the installer and run 'sandbox start' again."));
            } else {
              console.log(chalk.red("Setup failed. Please install dependencies manually."));
            }
            process.exit(1);
          }
        } else {
          // Dependencies exist but ensure container system is started
          if (!ensureContainerSystemStarted()) {
            console.log(chalk.red("Failed to start container system. Run: container system start"));
            process.exit(1);
          }
        }
      } else {
        // Even with skip-setup, ensure container system is running
        if (!ensureContainerSystemStarted()) {
          console.log(chalk.red("Failed to start container system. Run: container system start"));
          process.exit(1);
        }
      }

      let tunnelUrl: string | undefined;

      // Start tunnel only if -t flag is provided
      if (enableTunnel) {
        const hasCloudflared = await isCloudflaredInstalled();
        if (hasCloudflared) {
          try {
            const tunnel = await startTunnel(port, "localhost");
            tunnelUrl = tunnel.url;

            // Store the host tunnel info (including process) so proxy can distinguish it
            // and killAll doesn't kill the host tunnel
            const hostInfo = getHostInfo();
            hostInfo.setHostTunnel(tunnelUrl, tunnel.process);
          } catch (error: any) {
            console.log(chalk.yellow(`⚠️  Failed to start tunnel: ${error.message}`));
            console.log(chalk.gray("Falling back to local network mode"));
          }
        } else {
          console.log(chalk.yellow("⚠️  cloudflared not installed. Run 'sandbox setup' to install it."));
          console.log(chalk.gray("Falling back to local network mode"));
        }
      }

      const config: ServerConfig = {
        port,
        sandboxImage: (args.image || args.i) as string,
      };

      const { pairingCode } = startServer(config);

      // Display clean connection info
      printConnectionInfo(tunnelUrl, pairingCode, port);

      // Poll for pairing confirmation
      const tokenManager = getTokenManager();
      const checkInterval = setInterval(() => {
        const status = tokenManager.checkPairingStatus(pairingCode);
        if (status.confirmed) {
          log.pairing.confirmed();
          clearInterval(checkInterval);
        }
      }, 2000);

      break;
    }

    case "pair": {
      // Generate a new pairing code (for use when server is already running)
      const tokenManager = getTokenManager();
      const request = tokenManager.createPairingRequest();

      console.log();
      console.log(chalk.gray("New Pairing Code:"));
      console.log(chalk.yellow.bold(request.code));
      console.log();
      console.log(chalk.gray(`Expires in ${Math.floor((request.expiresAt - Date.now()) / 1000)}s`));
      console.log();
      break;
    }

    case "tokens": {
      const tokenManager = getTokenManager();
      const tokens = tokenManager.listTokens();

      console.log("\n🔑 Active Tokens\n");

      if (tokens.length === 0) {
        console.log("   No active tokens.\n");
      } else {
        console.log("   ┌────────────────────┬─────────────────────┬─────────────────────┐");
        console.log("   │ Device Name        │ Created             │ Last Used           │");
        console.log("   ├────────────────────┼─────────────────────┼─────────────────────┤");

        for (const token of tokens) {
          const name = token.deviceName.padEnd(18).substring(0, 18);
          const created = new Date(token.createdAt).toLocaleString().padEnd(19).substring(0, 19);
          const lastUsed = new Date(token.lastUsed).toLocaleString().padEnd(19).substring(0, 19);
          console.log(`   │ ${name} │ ${created} │ ${lastUsed} │`);
        }

        console.log("   └────────────────────┴─────────────────────┴─────────────────────┘");
      }
      console.log("");
      break;
    }

    case "setup": {
      const setupResult = await runSetup();
      if (!setupResult.success) {
        if (setupResult.needsRerun) {
          console.log(chalk.yellow("Please complete the installer and run 'sandbox setup' again."));
        } else {
          console.log(chalk.red("Setup failed. Please install dependencies manually."));
        }
        process.exit(1);
      }
      console.log(chalk.green("✅ Setup complete! You can now run 'sandbox start'."));
      break;
    }

    case "health": {
      console.log(chalk.bold("\n🩺 System Health Check\n"));

      const deps = checkDependencies();

      // Check cloudflared
      if (deps.cloudflared) {
        const version = spawnSync("cloudflared", ["--version"], { encoding: "utf-8" }).stdout?.trim().split("\n")[0];
        console.log(chalk.green(`  ✅ cloudflared: ${version || "installed"}`));
      } else {
        console.log(chalk.red("  ❌ cloudflared: not installed"));
      }

      // Check container
      if (deps.container) {
        const version = spawnSync("container", ["--version"], { encoding: "utf-8" }).stdout?.trim().split("\n")[0];
        console.log(chalk.green(`  ✅ container: ${version || "installed"}`));

        // Check if container system is running
        const listResult = spawnSync("container", ["list"], { encoding: "utf-8", timeout: 5000 });
        if (listResult.status === 0) {
          console.log(chalk.green("  ✅ container system: running"));
        } else {
          console.log(chalk.yellow("  ⚠️ container system: not running"));
        }
      } else {
        console.log(chalk.red("  ❌ container: not installed"));
      }

      console.log("");

      if (!deps.cloudflared || !deps.container) {
        console.log(chalk.yellow("Run 'sandbox start' to install missing dependencies.\n"));
        process.exit(1);
      } else {
        console.log(chalk.green("All dependencies installed!\n"));
      }
      break;
    }

    case "list": {
      const result = spawnSync("container", ["list", "--all"], { stdio: "inherit" });
      process.exit(result.status ?? 0);
    }

    case "delete": {
      const result = spawnSync("container", ["delete", "--all", "--force"], { stdio: "inherit" });
      process.exit(result.status ?? 0);
    }

    case "destroy": {
      const confirmed = await new Promise<boolean>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(
          chalk.red("⚠️  This will stop the container system and delete ALL containers. Are you sure? (y/N) "),
          (answer: string) => {
            rl.close();
            resolve(answer.toLowerCase() === "y");
          },
        );
      });

      if (!confirmed) {
        console.log(chalk.gray("Aborted."));
        break;
      }

      console.log(chalk.yellow("💥 Destroying container system..."));

      console.log(chalk.gray("   Stopping container-apiserver..."));
      spawnSync("pkill", ["-f", "container-apiserver"], { stdio: "ignore" });

      await new Promise((r) => setTimeout(r, 2000));

      console.log(chalk.gray("   Deleting all containers..."));
      spawnSync("container", ["delete", "--all", "--force"], { stdio: "inherit" });
      console.log(chalk.green("✅ Container system destroyed"));

      // Delete all volumes
      spawnSync("container", ["volume", "delete", "--all"], { stdio: "inherit" });
      console.log(chalk.green("✅ Volumes deleted"));

      break;
    }

    case "help":
    default:
      console.log(HELP);
      break;
  }
}

main().catch((error) => {
  // cleanup-containers.sh
  spawnSync("bash", ["scripts/cleanup-containers.sh"], { stdio: "inherit" });

  console.error("Fatal error:", error);
  process.exit(1);
  // Kill all sandboxes
});
