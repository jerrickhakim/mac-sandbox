#!/bin/bash
# Test script for DESTRUCTIVE endpoints
# WARNING: This will delete resources and shutdown the server!

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

# Helper function to make requests
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
echo "  DESTRUCTIVE ENDPOINTS TEST SUITE"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "${RED}⚠️  WARNING: This will DELETE resources and SHUTDOWN the server!${NC}"
echo ""
echo "Base URL: $BASE_URL"
echo "Git URL:  $GIT_URL"
echo ""
read -p "Press ENTER to continue or Ctrl+C to cancel..."
echo ""

# ============================================================================
# PHASE 1: CREATE TEST RESOURCES
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 1: Create Test Resources${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Create first sandbox with storage
PAYLOAD1=$(cat <<EOF
{
  "cpus": 2,
  "memory": "4G",
  "tunnel": false,
  "storage": "10G",
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

((TOTAL_TESTS++))
echo -e "${YELLOW}➤ Test $TOTAL_TESTS: Create sandbox 1 with 10G storage${NC}"
echo "   POST $BASE_URL/sandbox/create"

RESPONSE1=$(make_request "POST" "/sandbox/create" "$PAYLOAD1")
HTTP_CODE=$(echo "$RESPONSE1" | $GREP "HTTP_STATUS:" | $CUT -d: -f2)
BODY1=$(echo "$RESPONSE1" | $GREP -v "HTTP_STATUS:")

if [ "$HTTP_CODE" -eq "200" ]; then
  echo -e "${GREEN}   ✓ Success (HTTP $HTTP_CODE)${NC}"
  ((PASSED_TESTS++))
  echo "$BODY1" | $JQ '.'
else
  echo -e "${RED}   ✗ Failed (HTTP $HTTP_CODE)${NC}"
  ((FAILED_TESTS++))
  echo "$BODY1"
fi
echo ""

SANDBOX_ID_1=$(echo "$BODY1" | $JQ -r '.id' 2>/dev/null)
VOLUME_NAME_1=$(echo "$BODY1" | $JQ -r '.volume' 2>/dev/null)

# Create second sandbox with storage
PAYLOAD2=$(cat <<EOF
{
  "cpus": 2,
  "memory": "4G",
  "tunnel": false,
  "storage": "10G",
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

((TOTAL_TESTS++))
echo -e "${YELLOW}➤ Test $TOTAL_TESTS: Create sandbox 2 with 10G storage${NC}"
echo "   POST $BASE_URL/sandbox/create"

RESPONSE2=$(make_request "POST" "/sandbox/create" "$PAYLOAD2")
HTTP_CODE=$(echo "$RESPONSE2" | $GREP "HTTP_STATUS:" | $CUT -d: -f2)
BODY2=$(echo "$RESPONSE2" | $GREP -v "HTTP_STATUS:")

if [ "$HTTP_CODE" -eq "200" ]; then
  echo -e "${GREEN}   ✓ Success (HTTP $HTTP_CODE)${NC}"
  ((PASSED_TESTS++))
  echo "$BODY2" | $JQ '.'
else
  echo -e "${RED}   ✗ Failed (HTTP $HTTP_CODE)${NC}"
  ((FAILED_TESTS++))
  echo "$BODY2"
fi
echo ""

SANDBOX_ID_2=$(echo "$BODY2" | $JQ -r '.id' 2>/dev/null)
VOLUME_NAME_2=$(echo "$BODY2" | $JQ -r '.volume' 2>/dev/null)

# Create standalone volume for testing
VOLUME_PAYLOAD='{"name":"test-standalone-volume","size":"5G","label":"test"}'

((TOTAL_TESTS++))
echo -e "${YELLOW}➤ Test $TOTAL_TESTS: Create standalone volume${NC}"
echo "   POST $BASE_URL/volume/create"

RESPONSE3=$(make_request "POST" "/volume/create" "$VOLUME_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE3" | $GREP "HTTP_STATUS:" | $CUT -d: -f2)
BODY3=$(echo "$RESPONSE3" | $GREP -v "HTTP_STATUS:")

if [ "$HTTP_CODE" -eq "200" ]; then
  echo -e "${GREEN}   ✓ Success (HTTP $HTTP_CODE)${NC}"
  ((PASSED_TESTS++))
  echo "$BODY3" | $JQ '.'
else
  echo -e "${RED}   ✗ Failed (HTTP $HTTP_CODE)${NC}"
  ((FAILED_TESTS++))
  echo "$BODY3"
fi
echo ""

STANDALONE_VOLUME=$(echo "$BODY3" | $JQ -r '.name' 2>/dev/null)

echo -e "${CYAN}📋 Created Resources:${NC}"
echo "   Sandbox 1 ID:       $SANDBOX_ID_1"
echo "   Sandbox 1 Volume:   $VOLUME_NAME_1"
echo "   Sandbox 2 ID:       $SANDBOX_ID_2"
echo "   Sandbox 2 Volume:   $VOLUME_NAME_2"
echo "   Standalone Volume:  $STANDALONE_VOLUME"
echo ""

# ============================================================================
# PHASE 2: TEST DESTRUCTIVE OPERATIONS
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 2: Destructive Operations${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Delete first sandbox
if [ -n "$SANDBOX_ID_1" ] && [ "$SANDBOX_ID_1" != "null" ]; then
  test_endpoint "DELETE" "/sandbox/$SANDBOX_ID_1" "Delete sandbox 1"
fi

# Delete standalone volume
if [ -n "$STANDALONE_VOLUME" ] && [ "$STANDALONE_VOLUME" != "null" ]; then
  test_endpoint "DELETE" "/volume/$STANDALONE_VOLUME" "Delete standalone volume"
fi

# Batch delete volumes (if sandbox 2 volume still exists)
if [ -n "$VOLUME_NAME_2" ] && [ "$VOLUME_NAME_2" != "null" ]; then
  BATCH_DELETE_PAYLOAD="{\"ids\":[\"$VOLUME_NAME_2\"]}"
  test_endpoint "POST" "/volume/batch-delete" "Batch delete volume" "$BATCH_DELETE_PAYLOAD"
fi

# Kill all remaining sandboxes
echo -e "${RED}⚠️  About to kill all remaining sandboxes...${NC}"
sleep 2
test_endpoint "POST" "/admin/kill-all" "Kill all sandboxes"

# ============================================================================
# PHASE 3: SERVER SHUTDOWN
# ============================================================================
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  PHASE 3: Server Shutdown${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${RED}⚠️  About to shutdown the server...${NC}"
echo "   This will disconnect and stop the server process."
echo ""
sleep 3

test_endpoint "POST" "/admin/disconnect" "Disconnect and shutdown server"

# Give server time to shutdown
sleep 2

# Try to verify server is down
echo -e "${CYAN}Verifying server shutdown...${NC}"
if $CURL -s --connect-timeout 2 "$BASE_URL/health" > /dev/null 2>&1; then
  echo -e "${RED}✗ Server is still running${NC}"
else
  echo -e "${GREEN}✓ Server has been shutdown${NC}"
fi
echo ""

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
  echo -e "${GREEN}✓ All destructive tests passed!${NC}"
  EXIT_CODE=0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  EXIT_CODE=1
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Destructive Operations Completed"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "✓ Deleted sandbox:     $SANDBOX_ID_1"
echo "✓ Deleted volume:      $STANDALONE_VOLUME"
echo "✓ Batch deleted:       $VOLUME_NAME_2"
echo "✓ Killed all sandboxes"
echo "✓ Server shutdown"
echo ""
echo -e "${CYAN}Note: You will need to restart the server manually.${NC}"
echo ""

exit $EXIT_CODE
