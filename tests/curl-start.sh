#!/bin/bash
# Simple curl script to test the sandbox server

BASE_URL="${BASE_URL:-http://localhost:4000}"
ENDPOINT="${1:-create}"  # Default to 'create', can pass 'health' or 'create'

HASH="d76797bab131e71e24004a9a2212000e296bc83cfca4464aa1e1447d65b71696"

# THIS IS THE TOKENT THAT IS USED FOR TESTING
TOKEN="855ed9eafb51c4978e2cd366bb274785e56f9a9a86cb7055"
case "$ENDPOINT" in
  health)
    echo "🏥 Checking server health at $BASE_URL"
    echo ""
    curl -s "$BASE_URL/health" | jq '.' 2>/dev/null || curl -s "$BASE_URL/health"
    echo ""
    ;;
  create)
    # Hardcoded GitHub repository URL (git source)
    GIT_URL="${2:-https://github.com/jerrickhakim/next}"
    GIT_TOKEN="${GIT_ACCESS_TOKEN:-}"
    echo "🚀 Creating sandbox at $BASE_URL"
    echo "   With Git repository: $GIT_URL"
    if [ -n "$GIT_TOKEN" ]; then
      echo "   Using Git access token"
    fi
    echo ""
    
    # Build JSON payload with git repository
    if [ -n "$GIT_TOKEN" ]; then
      PAYLOAD=$(cat <<EOF
{
  "port": 3000,
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
    "GIT_ACCESS_TOKEN": "$GIT_TOKEN",
    "ROUTE_PREFIX": "/__platform",
    "SANDBOX_SERVICE_TOKEN_HASH": "$HASH"
  }
}
EOF
)
    else
      PAYLOAD=$(cat <<EOF
{
  "port": 3000,
  "cpus": 2,
  "memory": "4G",
  "tunnel": false,
  "storage": null,
  "env": {
    "USER_APP_PORT": "3000",
    "INSTALL": "bun install",
    "START": "bun run dev",
    "ROOT_DIR": "/workspace",
    "SOURCE": "git",
    "URL": "$GIT_URL",
    "ROUTE_PREFIX": "/__platform",
    "SANDBOX_SERVICE_TOKEN_HASH": "$HASH"
  }
}
EOF
)
    fi
    
    curl -X POST "$BASE_URL/sandbox/create" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      -w "\n\nHTTP Status: %{http_code}\n" \
      -s | jq '.' 2>/dev/null || cat
    echo ""
    ;;
  *)
    echo "Usage: $0 [health|create] [GIT_URL]"
    echo ""
    echo "Examples:"
    echo "  $0 health                                    # Check server health"
    echo "  $0 create                                    # Create sandbox with jerrickhakim/next repo (default)"
    echo "  $0 create https://github.com/user/repo       # Create sandbox with custom Git repository"
    echo ""
    echo "For private repositories, set GIT_ACCESS_TOKEN:"
    echo "  GIT_ACCESS_TOKEN=your_token $0 create https://github.com/user/private-repo"
    echo ""
    echo "Set BASE_URL env var to use different server:"
    echo "  BASE_URL=http://192.168.1.100:4000 $0 create"
    exit 1
    ;;
esac
