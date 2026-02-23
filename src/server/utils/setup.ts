import { execSync, spawnSync } from "child_process";
import { createWriteStream, existsSync, unlinkSync } from "fs";
import https from "https";
import { tmpdir } from "os";
import { join } from "path";

const CLOUDFLARED_BREW_FORMULA = "cloudflare/cloudflare/cloudflared";
const CONTAINER_PKG_URL = "https://github.com/apple/container/releases/download/0.8.0/container-installer-signed.pkg";

/** Check if a command exists in PATH */
function hasCommand(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Get command version or empty string */
function getVersion(cmd: string): string {
  try {
    return execSync(`${cmd} --version 2>/dev/null`, { encoding: "utf-8" }).trim().split("\n")[0];
  } catch {
    return "";
  }
}

/** Check if running on macOS */
function isMacOS(): boolean {
  return process.platform === "darwin";
}

/** Download a file from URL */
function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          download(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });

    request.on("error", (err) => {
      file.close();
      if (existsSync(dest)) unlinkSync(dest);
      reject(err);
    });
  });
}

/** Install cloudflared via Homebrew or direct download */
async function installCloudflared(): Promise<boolean> {
  if (hasCommand("cloudflared")) {
    console.log(`✅ cloudflared already installed: ${getVersion("cloudflared")}`);
    return true;
  }

  const arch = process.arch;
  console.log(`🔍 cloudflared not found. Installing for ${process.platform} (${arch})...`);

  // Prefer Homebrew if available
  if (hasCommand("brew")) {
    console.log("🍺 Homebrew detected, installing via brew...");
    try {
      execSync(`brew install ${CLOUDFLARED_BREW_FORMULA}`, { stdio: "inherit" });
      console.log(`✅ cloudflared installed: ${getVersion("cloudflared")}`);
      return true;
    } catch (error) {
      console.log("⚠️ Homebrew install failed, trying direct download...");
    }
  }

  // Fallback to direct download
  const tmpDir = tmpdir();
  let url: string;

  if (process.platform === "darwin") {
    url =
      arch === "arm64"
        ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
        : "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz";

    const tgzPath = join(tmpDir, "cloudflared.tgz");
    console.log("⬇️ Downloading cloudflared tarball...");

    try {
      await download(url, tgzPath);
      execSync(`tar xzf "${tgzPath}"`, { cwd: tmpDir });
      execSync(`chmod +x "${join(tmpDir, "cloudflared")}"`);

      console.log("🚀 Installing cloudflared to /usr/local/bin (sudo may be required)...");
      execSync(`sudo mv "${join(tmpDir, "cloudflared")}" /usr/local/bin/cloudflared`, { stdio: "inherit" });

      console.log(`✅ cloudflared installed: ${getVersion("cloudflared")}`);
      return true;
    } catch (error: any) {
      console.log(`❌ Failed to install cloudflared: ${error.message}`);
      return false;
    }
  } else if (process.platform === "linux") {
    url =
      arch === "arm64"
        ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
        : "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";

    const binPath = join(tmpDir, "cloudflared");
    console.log("⬇️ Downloading cloudflared binary...");

    try {
      await download(url, binPath);
      execSync(`chmod +x "${binPath}"`);

      console.log("🚀 Installing cloudflared to /usr/local/bin (sudo may be required)...");
      execSync(`sudo mv "${binPath}" /usr/local/bin/cloudflared`, { stdio: "inherit" });

      console.log(`✅ cloudflared installed: ${getVersion("cloudflared")}`);
      return true;
    } catch (error: any) {
      console.log(`❌ Failed to install cloudflared: ${error.message}`);
      return false;
    }
  }

  console.log(`❌ Unsupported OS for cloudflared install: ${process.platform}`);
  return false;
}

/** Install Apple Containers (macOS only) */
async function installAppleContainer(): Promise<boolean> {
  if (!isMacOS()) {
    console.log("❌ Apple Containers is only available on macOS.");
    return false;
  }

  if (hasCommand("container")) {
    console.log(`✅ Apple Containers already installed: ${getVersion("container")}`);
    return true;
  }

  console.log("🔍 Apple Containers CLI ('container') not found.");
  console.log("⬇️ Downloading signed installer pkg...");

  const pkgPath = join(tmpdir(), "container-installer-signed.pkg");

  try {
    await download(CONTAINER_PKG_URL, pkgPath);

    const autoInstall = process.env.AUTO_INSTALL_CONTAINER_PKG === "1";

    if (autoInstall) {
      console.log("⚠️ AUTO_INSTALL_CONTAINER_PKG=1 set — attempting sudo installer...");
      try {
        execSync(`sudo installer -pkg "${pkgPath}" -target /`, { stdio: "inherit" });
      } catch {
        console.log("⚠️ Installer failed. You may need to approve in System Settings → Privacy & Security.");
      }
    } else {
      console.log("🧩 Opening Apple installer UI (recommended)...");
      spawnSync("open", [pkgPath]);
      console.log("");
      console.log("➡️ Finish the installer window, then re-run 'sandbox start' to continue.");
      console.log("");
      return false;
    }

    // Verify installation
    if (hasCommand("container")) {
      console.log(`✅ Apple Containers installed: ${getVersion("container")}`);
      return true;
    } else {
      console.log("⚠️ Installation finished but 'container' still not found.");
      console.log("   Check the installer completed and look at:");
      console.log("   System Settings → Privacy & Security (approve if needed), then re-run.");
      return false;
    }
  } catch (error: any) {
    console.log(`❌ Failed to download/install Apple Containers: ${error.message}`);
    return false;
  }
}

/** Start the container system service */
function startContainerSystem(): boolean {
  if (!hasCommand("container")) {
    return false;
  }

  console.log("🚀 Starting container system service...");
  try {
    // Check if already running by trying to list containers
    const result = spawnSync("container", ["list"], { encoding: "utf-8", timeout: 10000 });
    if (result.status === 0) {
      console.log("✅ Container system service is running.");
      return true;
    }
  } catch {
    // Not running, try to start
  }

  try {
    // First-time kernel installation can take several minutes, so no timeout
    console.log("   (First-time setup may take a few minutes to install the kernel...)");
    execSync("container system start", { stdio: "inherit" });
    console.log("✅ Container system service started.");
    return true;
  } catch (error: any) {
    // Check if it actually succeeded despite the error (sometimes exits with error but works)
    try {
      const checkResult = spawnSync("container", ["list"], { encoding: "utf-8", timeout: 10000 });
      if (checkResult.status === 0) {
        console.log("✅ Container system service started.");
        return true;
      }
    } catch {
      // Still not working
    }
    console.log(`⚠️ Failed to start container system: ${error.message}`);
    console.log("   Try running manually: container system start");
    return false;
  }
}

export interface SetupResult {
  success: boolean;
  cloudflaredInstalled: boolean;
  containerInstalled: boolean;
  containerSystemStarted: boolean;
  needsRerun: boolean;
}

/**
 * Run the setup process to ensure all dependencies are installed.
 * Returns true if setup completed successfully and we can proceed.
 */
export async function runSetup(): Promise<SetupResult> {
  console.log("==============================");
  console.log("RepoGo Host Setup");
  console.log(" - cloudflared (Cloudflare Tunnel)");
  console.log(" - Apple Containers (container)");
  console.log("==============================");
  console.log("");

  const cloudflaredInstalled = await installCloudflared();
  console.log("");

  const containerInstalled = await installAppleContainer();
  console.log("");

  // If container is not installed, user needs to finish installer and re-run
  if (!containerInstalled && !hasCommand("container")) {
    return {
      success: false,
      cloudflaredInstalled,
      containerInstalled: false,
      containerSystemStarted: false,
      needsRerun: true,
    };
  }

  // Start the container system service
  let containerSystemStarted = false;
  if (containerInstalled || hasCommand("container")) {
    containerSystemStarted = startContainerSystem();
    console.log("");
  }

  // If both are installed and service is started, we're good
  if (cloudflaredInstalled && (containerInstalled || hasCommand("container")) && containerSystemStarted) {
    console.log("✅ All dependencies installed and container system started.");
    console.log("");
    return {
      success: true,
      cloudflaredInstalled,
      containerInstalled: containerInstalled || hasCommand("container"),
      containerSystemStarted,
      needsRerun: false,
    };
  }

  return {
    success: cloudflaredInstalled && (containerInstalled || hasCommand("container")),
    cloudflaredInstalled,
    containerInstalled: containerInstalled || hasCommand("container"),
    containerSystemStarted,
    needsRerun: false,
  };
}

/** Quick check if all dependencies are already installed */
export function checkDependencies(): { cloudflared: boolean; container: boolean } {
  return {
    cloudflared: hasCommand("cloudflared"),
    container: hasCommand("container"),
  };
}

/** Ensure container system is started (call before creating sandboxes) */
export function ensureContainerSystemStarted(): boolean {
  if (!hasCommand("container")) {
    return false;
  }

  // Quick check if system is running
  const result = spawnSync("container", ["list"], { encoding: "utf-8", timeout: 10000 });
  if (result.status === 0) {
    return true;
  }

  // Try to start it (no timeout - kernel install can take minutes on first run)
  console.log("🚀 Starting container system service...");
  console.log("   (First-time setup may take a few minutes to install the kernel...)");
  try {
    execSync("container system start", { stdio: "inherit" });
    console.log("✅ Container system service started.");
    return true;
  } catch {
    // Check if it actually succeeded despite the error
    try {
      const checkResult = spawnSync("container", ["list"], { encoding: "utf-8", timeout: 10000 });
      if (checkResult.status === 0) {
        console.log("✅ Container system service started.");
        return true;
      }
    } catch {
      // Still not working
    }
    console.log("⚠️ Failed to start container system. Run: container system start");
    return false;
  }
}
