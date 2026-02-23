#!/bin/bash
# Comprehensive test script for all non-destructive endpoints
# Tests: Sandbox, Volume, Admin endpoints
# Skips: Pairing endpoints, Destructive operations (delete, kill-all, disconnect)

# Use full paths for commands
CURL="/usr/bin/curl"
JQ="/usr/bin/jq"
GREP="/usr/bin/grep"
CUT="/usr/bin/cut"

BASE_URL="${BASE_URL:-http://localhost:4000}"
TOKEN="855ed9eafb51c4978e2cd366bb274785e56f9a9a86cb7055"
HASH="d76797bab131e71e24004a9a2212000e296bc83cfca4464aa1e1447d65b71696"
GIT_URL="${1:-https://github.com/jerrickhakim/next}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Helper function to make requests and return response
make_request() {
  local METHOD=$1
  local PATH=$2
  local DATA=$3
  
  if [ "$METHOD" = "GET" ]; then
    RESPONSE=$($CURL -X GET "$BASE_URL$PATH" \
      -H "Authorization: Bearer $TOKEN" \
      -s -w "\nHTTP_STATUS:%{http_code}")
  else
    if [ -n "$DATA" ]; then
      RESPONSE=$($CURL -X "$METHOD" "$BASE_URL$PATH" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$DATA" \
        -s -w "\nHTTP_STATUS:%{http_code}")
    else
      RESPONSE=$($CURL -X "$METHOD" "$BASE_URL$PATH" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -s -w "\nHTTP_STATUS:%{http_code}")
    fi
  fi
  
  echo "$RESPONSE"
}

# Helper function to test an endpoint
test_endpoint() {
  local METHOD=$1
  local PATH=$2
  local DESCRIPTION=$3
  local DATA=$4
  local EXPECTED_CODE=${5:-200}
  
  ((TOTAL_TESTS++))
  
  echo -e "${YELLOW}➤ Test $TOTAL_TESTS: $DESCRIPTION${NC}"
  echo "   $METHOD $BASE_URL$PATH"
  
  RESPONSE=$(make_request "$METHOD" "$PATH" "$DATA")
  
  HTTP_CODE=$(echo "$RESPONSE" | $GREP "HTTP_STATUS:" | $CUT -d: -f2)
  BODY=$(echo "$RESPONSE" | $GREP -v "HTTP_STATUS:")
  
  if [ "$HTTP_CODE" -eq "$EXPECTED_CODE" ]; then
    echo -e "${GREEN}   ✓ Success (HTTP $HTTP_CODE)${NC}"
    ((PASSED_TESTS++))
    echo "$BODY" | $JQ '.' 2>/dev/null || echo "$BODY"
  else
    echo -e "${RED}   ✗ Failed (HTTP $HTTP_CODE, expected $EXPECTED_CODE)${NC}"
    ((FAILED_TESTS++))
    echo "$BODY" | $JQ '.' 2>/dev/null || echo "$BODY"
  fi
  
  echo ""
}

echo "════════════════════════════════════════════════════════════════"
echo "  Comprehensive API Test Suite"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Base URL: $BASE_URL"
echo "Git URL:  $GIT_URL"
echo ""

# ============================================================================
# PHASE 1: CREATE SANDBOX WITH STORAGE
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 1: Create Sandbox${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

PAYLOAD=$(cat <<EOF
{
  "cpus": 2,
  "memory": "4G",
  "tunnel": false,
  "storage": "20G",
  "env": {
    "USER_APP_PORT": "3000",
    "INSTALL": "npm install",
    "START": "npm run dev",
    "ROOT_DIR": "/workspace",
    "SOURCE": "git",
    "URL": "$GIT_URL",
    "ROUTE_PREFIX": "/__platform",
    "SANDBOX_SERVICE_TOKEN_HASH": "$HASH"
  }
}
EOF
)

# Create sandbox and capture response
((TOTAL_TESTS++))
echo -e "${YELLOW}➤ Test $TOTAL_TESTS: Create sandbox with 20G storage${NC}"
echo "   POST $BASE_URL/sandbox/create"

CREATE_RESPONSE=$(make_request "POST" "/sandbox/create" "$PAYLOAD")
HTTP_CODE=$(echo "$CREATE_RESPONSE" | $GREP "HTTP_STATUS:" | $CUT -d: -f2)
CREATE_BODY=$(echo "$CREATE_RESPONSE" | $GREP -v "HTTP_STATUS:")

if [ "$HTTP_CODE" -eq "200" ]; then
  echo -e "${GREEN}   ✓ Success (HTTP $HTTP_CODE)${NC}"
  ((PASSED_TESTS++))
  echo "$CREATE_BODY" | $JQ '.'
else
  echo -e "${RED}   ✗ Failed (HTTP $HTTP_CODE)${NC}"
  ((FAILED_TESTS++))
  echo "$CREATE_BODY" | $JQ '.' 2>/dev/null || echo "$CREATE_BODY"
fi
echo ""

# Extract sandbox ID and volume from response
SANDBOX_ID=$(echo "$CREATE_BODY" | $JQ -r '.id' 2>/dev/null)
VOLUME_NAME=$(echo "$CREATE_BODY" | $JQ -r '.volume' 2>/dev/null)
IP_ADDRESS=$(echo "$CREATE_BODY" | $JQ -r '.ipAddress' 2>/dev/null)
HOST_PORT=$(echo "$CREATE_BODY" | $JQ -r '.hostPort' 2>/dev/null)

if [ -z "$SANDBOX_ID" ] || [ "$SANDBOX_ID" = "null" ]; then
  echo -e "${RED}Failed to extract sandbox ID. Exiting.${NC}"
  exit 1
fi

echo -e "${CYAN}📋 Extracted Information:${NC}"
echo "   Sandbox ID:   $SANDBOX_ID"
echo "   Volume Name:  $VOLUME_NAME"
echo "   IP Address:   $IP_ADDRESS"
echo "   Host Port:    $HOST_PORT"
echo ""

# ============================================================================
# PHASE 2: SANDBOX ENDPOINTS
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 2: Sandbox Endpoints${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# List all sandboxes
test_endpoint "GET" "/sandbox/list" "List all sandboxes"

# Get specific sandbox
test_endpoint "GET" "/sandbox/$SANDBOX_ID" "Get sandbox details"

# Health check
test_endpoint "GET" "/sandbox/$SANDBOX_ID/health" "Check sandbox health"

# Inspect sandbox (includes container and volume info)
test_endpoint "GET" "/sandbox/$SANDBOX_ID/inspect" "Inspect sandbox (full details)"

# Execute command in sandbox
EXEC_PAYLOAD='{"command":"echo","args":["Hello from sandbox"],"timeout":10000}'
test_endpoint "POST" "/sandbox/$SANDBOX_ID/exec" "Execute command in sandbox" "$EXEC_PAYLOAD"

# Execute another command - list files
EXEC_PAYLOAD2='{"command":"ls","args":["-la","/workspace"],"timeout":10000}'
test_endpoint "POST" "/sandbox/$SANDBOX_ID/exec" "List files in workspace" "$EXEC_PAYLOAD2"

# ============================================================================
# PHASE 3: VOLUME ENDPOINTS
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 3: Volume Endpoints${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# List all volumes
test_endpoint "GET" "/volume/list" "List all volumes"

# Get specific volume (the one we created)
if [ "$VOLUME_NAME" != "null" ] && [ -n "$VOLUME_NAME" ]; then
  test_endpoint "GET" "/volume/$VOLUME_NAME" "Get volume details for $VOLUME_NAME"
else
  echo -e "${YELLOW}⊘ Skipping volume detail test (no volume created)${NC}"
  echo ""
fi

# ============================================================================
# PHASE 4: ADMIN ENDPOINTS
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 4: Admin Endpoints${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# List all sandboxes (admin)
test_endpoint "GET" "/admin/sandboxes" "Admin: List all sandboxes"

# List all containers
test_endpoint "GET" "/admin/containers" "Admin: List all containers"

# Get server stats
test_endpoint "GET" "/admin/stats" "Admin: Get server statistics"

# ============================================================================
# PHASE 5: HEALTH CHECK
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 5: Server Health${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Server health
test_endpoint "GET" "/health" "Server health check"

# ============================================================================
# SKIPPED ENDPOINTS (Documented)
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  Skipped Endpoints (By Design)${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}⊘ Pairing Endpoints (Authentication setup):${NC}"
echo "   - GET/POST /pairing/confirm"
echo "   - GET /pairing/:code"
echo "   - POST /pairing/request"
echo ""
echo -e "${YELLOW}⊘ Destructive Endpoints (Would break tests):${NC}"
echo "   - DELETE /sandbox/:id (would delete test sandbox)"
echo "   - DELETE /volume/:name (would delete test volume)"
echo "   - POST /volume/batch-delete (would delete volumes)"
echo "   - POST /admin/kill-all (would kill all sandboxes)"
echo "   - POST /admin/disconnect (would shutdown server)"
echo "   - POST /sandbox/:id/tunnel (requires tunnel token)"
echo ""
echo -e "${YELLOW}⊘ Stream Endpoint (Requires SSE handling):${NC}"
echo "   - POST /sandbox/:id/exec/stream (SSE streaming)"
echo ""

# ============================================================================
# PHASE 6: CLEANUP
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 6: Cleanup${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Delete the sandbox we created
if [ -n "$SANDBOX_ID" ] && [ "$SANDBOX_ID" != "null" ]; then
  test_endpoint "DELETE" "/sandbox/$SANDBOX_ID" "Delete test sandbox"
  
  # Note: Volume is automatically deleted when sandbox is deleted
  # because it was created with the sandbox
else
  echo -e "${YELLOW}⊘ No sandbox to cleanup${NC}"
  echo ""
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo "════════════════════════════════════════════════════════════════"
echo "  Test Summary"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "Total Tests:  $TOTAL_TESTS"
echo -e "${GREEN}Passed:       $PASSED_TESTS${NC}"
echo -e "${RED}Failed:       $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  EXIT_CODE=0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  EXIT_CODE=1
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Resources Cleaned Up${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "✓ Deleted Sandbox:  $SANDBOX_ID"
echo "✓ Deleted Volume:   $VOLUME_NAME (auto-deleted with sandbox)"
echo ""

exit $EXIT_CODE
