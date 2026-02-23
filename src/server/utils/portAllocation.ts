/**
 * Port allocation and routing management for sandbox containers
 */

import { createConnection } from "net";

const PORT_RANGE_START = 9000; // range is 9000 to 9999
const PORT_RANGE_END = 9999;

// Routing map: subdomain -> { hostPort, containerName }
export const routing: Map<string, { hostPort: number; containerName: string }> = new Map();

// Track allocated ports
const allocatedPorts = new Set<number>();

/**
 * Get the next available port in the range 9000-9999
 * Checks if port is actually in use before allocating
 */
export async function getNextPort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (allocatedPorts.has(port)) {
      continue;
    }

    // Check if port is actually in use
    const isInUse = await checkPortInUse(port);
    if (!isInUse) {
      allocatedPorts.add(port);
      return port;
    }
  }

  throw new Error("No available ports in range 9000-9999");
}

/**
 * Check if a port is in use by attempting to connect to it.
 * ECONNREFUSED means nothing is listening → port is free.
 */
async function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", (err: NodeJS.ErrnoException) => {
      socket.destroy();
      resolve(err.code !== "ECONNREFUSED");
    });

    socket.setTimeout(200, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Release a port when sandbox is deleted
 */
export function releasePort(port: number): void {
  allocatedPorts.delete(port);
}
