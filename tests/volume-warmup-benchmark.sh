#!/bin/bash
# Benchmark: cold start (new volume) vs warm start (reused volume)
# Run 1: create with storage=10G  → wait for 200 → delete with preserveStorage=true
# Run 2: create with volumeId     → wait for 200 → compare elapsed times

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
GIT_URL="${1:-https://github.com/jerrickhakim/next}"
GIT_TOKEN="${GIT_ACCESS_TOKEN:-}"
TOKEN="855ed9eafb51c4978e2cd366bb274785e56f9a9a86cb7055"
HASH="d76797bab131e71e24004a9a2212000e296bc83cfca4464aa1e1447d65b71696"
AUTH_HEADER="Authorization: Bearer $TOKEN"

# ─── helpers ──────────────────────────────────────────────────────────────────

ts() { python3 -c "import time; print(int(time.time() * 1000))"; }   # milliseconds (macOS-safe)

wait_for_200() {
  local url="$1"
  local label="$2"
  local max_attempts="${3:-120}"
  local attempt=0
  echo "  ⏳ Waiting for 200 from $url ..."
  while (( attempt < max_attempts )); do
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    if [[ "$status" == "200" ]]; then
      echo "  ✅ $label is up (attempt $((attempt+1)))"
      return 0
    fi
    (( attempt++ )) || true
    sleep 2
  done
  echo "  ❌ $label never returned 200 after $max_attempts attempts"
  return 1
}

build_payload() {
  local storage="$1"   # e.g. "10G" or ""
  local volume_id="$2" # e.g. "abc123"  or ""

  local storage_field='"storage": null'
  local volume_field=""

  [[ -n "$storage" ]]   && storage_field="\"storage\": \"$storage\""
  [[ -n "$volume_id" ]] && volume_field=", \"volumeId\": \"$volume_id\""

  # Build env block — append git token line only when present
  local env_extra=""
  [[ -n "$GIT_TOKEN" ]] && env_extra=", \"GIT_ACCESS_TOKEN\": \"$GIT_TOKEN\""

  # volume_field already carries its own leading comma (set above)
  cat <<EOF
{
  "cpus": 2,
  "memory": "4G",
  $storage_field${volume_field},
  "healthCheck": {
    "url": "container",
    "maxAttempts": 120,
    "interval": 2000
  },
  "flags": {
    "lan": false,
    "tunnel": false
  },
  "env": {
    "USER_APP_PORT": "3000",
    "INSTALL": "bun install",
    "START": "bun run dev",
    "ROOT_DIR": "/workspace",
    "SOURCE": "git",
    "URL": "$GIT_URL"${env_extra},
    "ROUTE_PREFIX": "/__platform",
    "SANDBOX_SERVICE_TOKEN_HASH": "$HASH"
  }
}
EOF
}

create_sandbox() {
  local payload="$1"
  curl -s -X POST "$BASE_URL/sandbox/create" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "$payload"
}

delete_sandbox() {
  local id="$1"
  local preserve="${2:-false}"
  curl -s -X DELETE "$BASE_URL/sandbox/$id?preserveStorage=$preserve" \
    -H "$AUTH_HEADER" | jq -r '.ok'
}

# ─── RUN 1: fresh volume ───────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════"
echo "  RUN 1 — cold start (new 10G volume)"
echo "═══════════════════════════════════════════════════"

PAYLOAD_1=$(build_payload "10G" "")
T1_START=$(ts)

echo "  → Creating sandbox..."
RESPONSE_1=$(create_sandbox "$PAYLOAD_1")
echo "$RESPONSE_1" | jq '.' 2>/dev/null || echo "$RESPONSE_1"

SANDBOX_ID_1=$(echo "$RESPONSE_1" | jq -r '.id // empty')
VOLUME_ID=$(echo "$RESPONSE_1"    | jq -r '.volume // empty')
IP_1=$(echo "$RESPONSE_1"         | jq -r '.ipAddress // empty')

if [[ -z "$SANDBOX_ID_1" ]]; then
  echo "  ❌ Failed to create sandbox (no id in response)"
  exit 1
fi

echo "  → Sandbox: $SANDBOX_ID_1 | Volume: $VOLUME_ID | IP: $IP_1"

# The healthCheck in the payload already waited — record time now
T1_END=$(ts)
T1_MS=$(( T1_END - T1_START ))

# Extra sanity poll from this machine (container IP is accessible on same host)
if [[ -n "$IP_1" ]]; then
  wait_for_200 "http://$IP_1/__platform/health" "sandbox-1" || true
fi

echo ""
echo "  ⏱  Run 1 ready in ${T1_MS} ms  (~$(( T1_MS / 1000 ))s)"

# ─── Delete preserving the volume ─────────────────────────────────────────────

echo ""
echo "  → Deleting sandbox (preserveStorage=true)..."
OK=$(delete_sandbox "$SANDBOX_ID_1" "true")
echo "  → Deleted: $OK"

if [[ -z "$VOLUME_ID" ]]; then
  echo "  ⚠️  No volume id returned — cannot run warm benchmark"
  exit 1
fi

sleep 2  # brief pause before reuse

# ─── RUN 2: reuse volume ──────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════"
echo "  RUN 2 — warm start (reusing volume: $VOLUME_ID)"
echo "═══════════════════════════════════════════════════"

PAYLOAD_2=$(build_payload "" "$VOLUME_ID")
T2_START=$(ts)

echo "  → Creating sandbox..."
RESPONSE_2=$(create_sandbox "$PAYLOAD_2")
echo "$RESPONSE_2" | jq '.' 2>/dev/null || echo "$RESPONSE_2"

SANDBOX_ID_2=$(echo "$RESPONSE_2" | jq -r '.id // empty')
IP_2=$(echo "$RESPONSE_2"         | jq -r '.ipAddress // empty')

if [[ -z "$SANDBOX_ID_2" ]]; then
  echo "  ❌ Failed to create sandbox (no id in response)"
  exit 1
fi

echo "  → Sandbox: $SANDBOX_ID_2 | IP: $IP_2"

T2_END=$(ts)
T2_MS=$(( T2_END - T2_START ))

if [[ -n "$IP_2" ]]; then
  wait_for_200 "http://$IP_2/__platform/health" "sandbox-2" || true
fi

echo ""
echo "  ⏱  Run 2 ready in ${T2_MS} ms  (~$(( T2_MS / 1000 ))s)"

# ─── Cleanup run 2 ────────────────────────────────────────────────────────────

echo ""
echo "  → Cleaning up sandbox 2 (preserveStorage=false)..."
delete_sandbox "$SANDBOX_ID_2" "false" > /dev/null

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════"
echo "  BENCHMARK RESULTS"
echo "═══════════════════════════════════════════════════"
echo "  Cold start (new volume)    : ${T1_MS} ms  (~$(( T1_MS / 1000 ))s)"
echo "  Warm start (reused volume) : ${T2_MS} ms  (~$(( T2_MS / 1000 ))s)"

if (( T2_MS < T1_MS )); then
  DIFF=$(( T1_MS - T2_MS ))
  echo "  🚀 Warm start was faster by ${DIFF} ms  (~$(( DIFF / 1000 ))s)"
elif (( T1_MS < T2_MS )); then
  DIFF=$(( T2_MS - T1_MS ))
  echo "  🐢 Cold start was faster by ${DIFF} ms  (unexpected!)"
else
  echo "  🤝 Both runs took the same time"
fi
echo ""
