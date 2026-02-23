#!/bin/bash
# Test script for ZIP source functionality

BASE_URL="${BASE_URL:-http://localhost:4000}"
ENDPOINT="${1:-create}"  # Default to 'create', can pass 'health' or 'create'
HASH="d76797bab131e71e24004a9a2212000e296bc83cfca4464aa1e1447d65b71696"
TOKEN="855ed9eafb51c4978e2cd366bb274785e56f9a9a86cb7055"

ZIP_URL="https://github.com/jerrickhakim/next/archive/refs/heads/main.zip"

case "$ENDPOINT" in
  health)
    echo "🏥 Checking server health at $BASE_URL"
    echo ""
    curl -s "$BASE_URL/health" | jq '.' 2>/dev/null || curl -s "$BASE_URL/health"
    echo ""
    ;;
  create)

    echo "🚀 Creating sandbox with ZIP source at $BASE_URL"
    echo "   ZIP URL: ${ZIP_URL:0:80}..."
    echo ""
    
    # Build JSON payload with ZIP source
    PAYLOAD=$(cat <<EOF
{
  "port": 3000,
  "cpus": 2,
  "memory": "4G",
  "flags": {
    "lan": false,
    "tunnel": true
  },
  "env": {
    "USER_APP_PORT": "3000",
    "INSTALL": "npm install",
    "START": "npm run dev",
    "ROOT_DIR": "/workspace",
    "SOURCE": "zip",
    "URL": "$ZIP_URL",
    "ROUTE_PREFIX": "/__platform",
    "SANDBOX_SERVICE_TOKEN_HASH": "$HASH"
  }
}
EOF
)
    
    curl -X POST "$BASE_URL/sandbox/create" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      -w "\n\nHTTP Status: %{http_code}\n" \
      -s | jq '.' 2>/dev/null || cat
    echo ""
    ;;
  test)

    echo "🧪 Test Mode: Creating sandbox and monitoring startup..."
    echo "   ZIP URL: ${ZIP_URL:0:80}..."
    echo ""
    
    PAYLOAD=$(cat <<EOF
{
  "cpus": 2,
  "memory": "4G",
  "tunnel": true,
  "flags": {
    "lan": false,
    "tunnel": true
  },
  "env": {
    "USER_APP_PORT": "3000",
    "INSTALL": "npm install",
    "START": "npm run dev",
    "ROOT_DIR": "/workspace",
    "SOURCE": "zip",
    "URL": "$ZIP_URL",
    "ROUTE_PREFIX": "/__platform",
    "SANDBOX_SERVICE_TOKEN_HASH": "$HASH"
  }
}
EOF
)
    
    # Create sandbox and capture response
    RESPONSE=$(curl -X POST "$BASE_URL/sandbox/create" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      -s)
    
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    echo ""
    
    # Extract sandbox ID from response
    SANDBOX_ID=$(echo "$RESPONSE" | jq -r '.sandboxId // .id // empty' 2>/dev/null)
    
    if [ -z "$SANDBOX_ID" ]; then
      echo "❌ Failed to create sandbox or extract sandbox ID"
      exit 1
    fi
    
    echo "✅ Sandbox created: $SANDBOX_ID"
    echo ""
    echo "📋 Monitoring container startup (waiting 30 seconds)..."
    echo "   (Container will download ZIP, extract, install deps, and start app)"
    echo ""
    
    # Wait for container to start and show progress
    for i in {1..30}; do
      echo -n "."
      sleep 1
    done
    echo ""
    echo ""
    
    echo "📊 Checking sandbox info..."
    curl -s "$BASE_URL/sandbox/$SANDBOX_ID/info" | jq '.' 2>/dev/null || echo "Failed to get sandbox info"
    echo ""
    
    echo "📝 Fetching container logs..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    curl -s "$BASE_URL/sandbox/$SANDBOX_ID/logs?lines=50" | jq -r '.logs // .data // .' 2>/dev/null || echo "No logs available"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    echo "🌐 Testing sandbox endpoints..."
    echo ""
    
    # Get tunnel URL
    TUNNEL_URL=$(curl -s "$BASE_URL/sandbox/$SANDBOX_ID/info" | jq -r '.tunnelUrl // empty' 2>/dev/null)
    
    if [ -n "$TUNNEL_URL" ]; then
      echo "✅ Tunnel URL: $TUNNEL_URL"
      echo ""
      echo "Testing health endpoint..."
      curl -s -w "\nHTTP Status: %{http_code}\n" "$TUNNEL_URL/health" || echo "Health check failed"
      echo ""
    else
      echo "⚠️  No tunnel URL available yet"
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎯 Test Summary"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Sandbox ID: $SANDBOX_ID"
    echo "Source Type: ZIP"
    echo "ZIP URL: ${ZIP_URL:0:80}..."
    if [ -n "$TUNNEL_URL" ]; then
      echo "Tunnel URL: $TUNNEL_URL"
    fi
    echo ""
    echo "Next steps:"
    echo "  - Visit the tunnel URL in your browser"
    echo "  - Check logs: curl $BASE_URL/sandbox/$SANDBOX_ID/logs"
    echo "  - Stop sandbox: curl -X POST $BASE_URL/sandbox/$SANDBOX_ID/stop"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    ;;
  *)
    echo "Usage: $0 [health|create|test] [ZIP_URL]"
    echo ""
    echo "Examples:"
    echo "  $0 health                           # Check server health"
    echo "  $0 create                           # Create sandbox with default Next.js ZIP"
    echo "  $0 create https://example.com/app.zip  # Create sandbox with custom ZIP"
    echo "  $0 test                             # Create sandbox and monitor startup"
    echo "  $0 test https://example.com/app.zip    # Test with custom ZIP"
    echo ""
    echo "Default ZIP contains a Next.js application from S3."
    echo ""
    echo "Set BASE_URL env var to use different server:"
    echo "  BASE_URL=http://192.168.1.100:4000 $0 create"
    exit 1
    ;;
esac
