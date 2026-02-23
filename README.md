# mac-sandbox

```bash
npm i mac-sandbox -g
```

```bash
sandbox start
```

Or, to expose your API publicly via a Cloudflare Tunnel:

```bash
sandbox start -t
```

Self-hosted sandbox containers on Apple Silicon Macs, with Cloudflare Tunnel routing and a pairing-based auth flow. Built with [Hono](https://hono.dev), TypeScript, and [Apple Containers](https://developer.apple.com/documentation/virtualization).

> **Note:** This library is still actively being worked on. If you have feedback or run into issues, feel free to DM [@jerrickhakim](https://x.com/jerrickhakim).

## Why this was created

Most sandbox solutions are cloud-hosted and charge per execution. This project creates an API layer that lets you self-host sandboxes on hardware you already own — your Mac. If you have an Apple Silicon Mac sitting around, you can run isolated, ephemeral containers locally and expose them publicly through Cloudflare Tunnels, with no third-party sandbox provider needed.

---

## How it works

```
Your Mac (port 4000)
  ├── Sandbox API server            ← you talk to this
  └── Apple Container(s)            ← your image, your app
```

- The **Sandbox API** runs on your Mac at port 4000 and manages container lifecycle.
- Each sandbox runs your own container image — bring whatever stack you need.
- Containers can be exposed publicly via **Cloudflare Tunnels** (named or free `trycloudflare.com`).

---

## Prerequisites

- Apple Silicon Mac (M1/M2/M3/M4)
- Node.js ≥ 20
- [Apple Containers](https://developer.apple.com/documentation/virtualization) CLI (`container`)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) (auto-installed by `sandbox setup`)

---

## Installation

### Install the CLI

```bash
npm install -g mac-sandbox
```

### Build your container image

Build any Linux container image that suits your workload and tag it:

```bash
container build -t sandbox:latest /path/to/your/Dockerfile
```

Then point the CLI at it:

```bash
sandbox start --image my-image:latest
```

Verify available images:

```bash
container image list
```

> If the build fails, run: `container system kernel set --recommended --force`

---

## CLI Reference

```
sandbox <command> [options]

COMMANDS:
  start         Start the sandbox server (auto-installs dependencies)
  setup         Install required dependencies (cloudflared, container CLI)
  health        Check system dependencies
  pair          Generate a new pairing code
  tokens        List all active auth tokens
  list          List all running containers
  delete        Delete all containers
  destroy       Stop container system and delete all containers + volumes

OPTIONS:
  --port, -p        Port to run the server on (default: 4000)
  --tunnel, -t      Enable Cloudflare tunnel (generates a public QR code URL)
  --image, -i       Container image name (default: sandbox)
  --skip-setup      Skip dependency check on startup
```

### Quick start

**Local network mode (default):**

```bash
sandbox start
```

Prints a QR code, a 6-digit pairing code, and the local network URL (e.g. `http://192.168.1.100:4000`). Scan the QR code or POST the code to `/pairing/confirm` from any device on the same network.

**Tunnel mode:**

```bash
sandbox start -t
```

Same as above, but the QR code points to a public `trycloudflare.com` URL so remote devices can pair.

---

## Pairing Flow

```
1. sandbox start                  → server starts, displays QR code + 6-digit code
2. Client scans QR or POSTs code  → POST /pairing/confirm
3. Server returns Bearer token    → client stores it
4. Token used on all API calls    → Authorization: Bearer <token>
```

### Confirm pairing (public — no auth required)

```http
POST /pairing/confirm
Content-Type: application/json

{
  "code": "ABC123",
  "deviceName": "My Laptop"   // optional
}
```

**Response:**

```json
{ "token": "tok_secret..." }
```

---

## Environment Variables

### Server (runtime)

| Variable                         | Default   | Description                                                                     |
| -------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `PORT`                           | `4000`    | Port the sandbox API server listens on                                          |
| `SANDBOX_IMAGE`                  | `sandbox` | Container image name used when spawning sandboxes                               |
| `FLAGS_DESTROY_CONTAINERS`       | —         | Set `"true"` to stop & delete all containers on server shutdown                 |
| `FLAGS_PRESERVE_SANDBOX_TUNNELS` | —         | Set `"true"` to also tear down per-sandbox Cloudflare tunnels on shutdown       |
| `AUTO_INSTALL_CONTAINER_PKG`     | —         | Set `"1"` to run `sudo installer` silently instead of opening the GUI installer |

### Cloudflare (optional — only for named tunnels)

Skip these if you use free `trycloudflare.com` tunnels and pass `flags.tunnel: false` when creating sandboxes.

| Variable                    | Description                                  |
| --------------------------- | -------------------------------------------- |
| `CLOUDFLARE_TUNNEL_API_KEY` | Cloudflare API token with tunnel permissions |
| `CLOUDFLARE_ACCOUNT_ID`     | Cloudflare account ID                        |
| `CLOUDFLARE_ZONE_ID`        | Cloudflare zone ID for your domain           |

---

## Sandbox API

All sandbox endpoints require `Authorization: Bearer <token>`.

### Create sandbox

```http
POST /sandbox/create
```

```json
{
  "cpus": 2,
  "memory": "4G",
  "storage": "10G",
  "volumeId": "existing-volume-id",
  "flags": {
    "tunnel": false,
    "lan": true
  },
  "healthCheck": {
    "url": "tunnel",
    "timeout": 5000,
    "interval": 1000,
    "maxAttempts": 10,
    "destroy": true
  },
  "env": {
    "MY_VAR": "my-value"
  }
}
```

`env` is an arbitrary key/value map passed as environment variables to your container. Use it however your image expects.

**`storage` options:** `1G` `5G` `10G` `15G` `20G` `25G` `30G` `32G` `64G` `128G`

**Response:**

```json
{
  "id": "abc123",
  "ipAddress": "192.168.64.5",
  "urls": {
    "tunnel": "https://abc.trycloudflare.com",
    "lan": "http://192.168.1.100:8080",
    "container": "http://192.168.64.5:80"
  }
}
```

### Other sandbox endpoints

| Method   | Endpoint               | Description                                                        |
| -------- | ---------------------- | ------------------------------------------------------------------ |
| `GET`    | `/sandbox/list`        | List all sandboxes                                                 |
| `GET`    | `/sandbox/:id`         | Get sandbox details                                                |
| `GET`    | `/sandbox/:id/health`  | Check container reachability                                       |
| `GET`    | `/sandbox/:id/inspect` | Full inspection: sandbox + container + volume info                 |
| `DELETE` | `/sandbox/:id`         | Stop and remove sandbox (`?preserveStorage=true` keeps the volume) |

### Attach a Cloudflare tunnel

```http
POST /sandbox/:id/tunnel
```

```json
{
  "tunnelToken": "<from-cloudflare>",
  "tunnelId": "<tunnel-uuid>",
  "url": "https://abc123.yourdomain.com",
  "checkhealth": true
}
```

### Execute a command

```http
POST /sandbox/:id/exec
```

```json
{
  "command": "npm",
  "args": ["run", "build"],
  "timeout": 30000,
  "user": "node"
}
```

**Response:**

```json
{
  "success": true,
  "exitCode": 0,
  "stdout": "...",
  "stderr": "",
  "durationMs": 1234
}
```

### Execute with streaming output (SSE)

```http
POST /sandbox/:id/exec/stream
```

Same request body as `/exec`. Returns a Server-Sent Events stream with events:

| Event    | Payload                               |
| -------- | ------------------------------------- |
| `stdout` | Base64-encoded stdout chunk           |
| `stderr` | Base64-encoded stderr chunk           |
| `exit`   | `{ exitCode, signal }`                |
| `error`  | `{ error }`                           |
| `ping`   | `{ timestamp }` (keepalive every 15s) |

---

## Volume API

Persistent volumes can be attached to sandboxes at `/workspace`.

| Method   | Endpoint               | Description             |
| -------- | ---------------------- | ----------------------- |
| `POST`   | `/volume/create`       | Create a volume         |
| `GET`    | `/volume/list`         | List all volumes        |
| `GET`    | `/volume/:id`          | Get volume details      |
| `DELETE` | `/volume/:id`          | Delete a volume         |
| `POST`   | `/volume/batch-delete` | Delete multiple volumes |

### Create a volume

```http
POST /volume/create
```

```json
{
  "id": "my-volume",
  "size": "10G",
  "label": "my-label"
}
```

### Attach a volume to a sandbox

Pass `volumeId` in the create sandbox request to mount an existing volume at `/workspace`:

```json
{ "volumeId": "my-volume", ... }
```

Or pass `storage: "10G"` to create and mount a new volume automatically.

---

## API Documentation

The server serves interactive API docs:

- **Scalar UI:** `http://localhost:4000/reference`
- **OpenAPI JSON:** `http://localhost:4000/doc`

---

## Server Integration Example

Minimal backend code to create a sandbox and wire up a Cloudflare tunnel:

```typescript
import axios from "axios";

const api = axios.create({
  baseURL: "https://xyz.trycloudflare.com", // from pairing
  headers: { Authorization: `Bearer ${platformToken}` },
});

// 1. Create sandbox
const { data } = await api.post("/sandbox/create", {
  cpus: 2,
  memory: "4G",
  env: {
    // pass whatever env vars your image expects
    MY_VAR: "my-value",
  },
});

const { id: sandboxId, ipAddress } = data;

// 2. Create a named Cloudflare tunnel + CNAME pointing to the container
const { tunnelId, tunnelToken } = await createCloudflareTunnel({
  hostname: `${sandboxId}.yourdomain.com`,
  localServiceUrl: `http://${ipAddress}:80`,
});

// 3. Send tunnel credentials to Mac so cloudflared starts in the container
await api.post(`/sandbox/${sandboxId}/tunnel`, {
  tunnelToken,
  tunnelId,
  url: `https://${sandboxId}.yourdomain.com`,
  checkhealth: true,
});
```

---

## Type Definitions

```typescript
interface SandboxConfig {
  cpus?: number;
  memory?: string;
  storage?: "1G" | "5G" | "10G" | "15G" | "20G" | "25G" | "30G" | "32G" | "64G" | "128G" | null;
  volumeId?: string;
  flags?: { tunnel?: boolean; lan?: boolean };
  healthCheck?: {
    url?: "tunnel" | "lan" | "container";
    timeout?: number;
    interval?: number;
    maxAttempts?: number;
    destroy?: boolean;
  };
  env?: Record<string, string>;
}

interface SandboxEntry {
  id: string;
  ipAddress: string;
  hostPort: number;
  createdAt: number;
  volume: string | null;
  urls: {
    tunnel: string | null;
    lan: string | null;
    container: string;
  };
}

interface ExecRequest {
  command: string;
  args?: string[];
  timeout?: number;
  user?: string;
}

interface ExecResponse {
  success: boolean;
  command: string;
  args?: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

---

## Troubleshooting

| Issue                                          | Solution                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| Container build fails                          | `container system kernel set --recommended --force` |
| Build export error: "structure needs cleaning" | See [Build Export Error](#build-export-error) below |
| Stuck containers                               | `sandbox restart` or `sandbox destroy`              |
| `cloudflared` not found                        | `sandbox setup`                                     |
| Container system not running                   | `container system start`                            |

### Build export error

If you see `Error: failed to write compressed diff: lstat /tmp/containerd-mount*: structure needs cleaning`:

```bash
# 1. Clean stale mounts
sudo rm -rf /tmp/containerd-mount*

# 2. Restart container system
container system stop && container system start

# 3. Retry build without cache
container build --no-cache -t sandbox:latest .
```

If it still fails:

```bash
container system kernel set --recommended --force
container system start
container build -t sandbox:latest .
```

---

## License

MIT
