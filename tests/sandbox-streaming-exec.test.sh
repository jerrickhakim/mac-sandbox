#!/bin/bash

# Test script for streaming exec endpoint
# Usage: ./test-stream-exec.sh [sandbox_id] [message]

SANDBOX_ID=${1:-"02a5bd10"}
MESSAGE=${2:-"Hi how are you?"}
TOKEN="8b2cfaf69794087cdcd79f8d72eb14baedf663a8945e9e58ea5f2553fcfe2e8a1eb6e03f1ec688de"
API_KEY=""

echo "🚀 Testing streaming exec endpoint"
echo "Sandbox ID: $SANDBOX_ID"
echo "Message: $MESSAGE"
echo "---"

curl -X POST "http://localhost:4000/sandbox/${SANDBOX_ID}/exec/stream" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"command\": \"sh\",
    \"args\": [\"-c\", \"export PATH=\\\"\$HOME/.local/bin:\$PATH\\\"; CURSOR_API_KEY=\\\"${API_KEY}\\\" agent \\\"-p\\\" \\\"--model\\\" \\\"composer-1.5\\\" \\\"--output-format\\\" \\\"stream-json\\\" \\\"--force\\\" \\\"${MESSAGE}\\\"\"],
    \"timeout\": 60000
  }" \
  --no-buffer

echo ""
echo "✅ Stream completed"
