#!/bin/bash
# Cleanup script for stuck/zombie containers on macOS
# Kills the container-apiserver to reset VM states, then deletes all containers

# Colors for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}🧹 Cleaning up sandbox containers...${NC}"
echo ""

# Check if container command exists
if ! command -v container &> /dev/null; then
    echo -e "${YELLOW}⚠️  'container' command not found. Skipping cleanup.${NC}"
    exit 0
fi

# Count containers before cleanup (handle errors gracefully)
# grep -c returns exit code 1 when there are no matches; keep the "0" output
CONTAINER_COUNT=$(container list --all 2>/dev/null | grep -c "sandbox:latest" 2>/dev/null || true)
CONTAINER_COUNT=$(printf "%s" "${CONTAINER_COUNT:-0}" | tr -d '[:space:]')
if ! [[ "$CONTAINER_COUNT" =~ ^[0-9]+$ ]]; then
    CONTAINER_COUNT=0
fi

if [ "$CONTAINER_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ No containers to clean up${NC}"
    echo ""
    exit 0
fi

echo -e "${YELLOW}📋 Found ${CONTAINER_COUNT} container(s) to clean up:${NC}"
container list --all 2>/dev/null | grep "sandbox:latest" || true
echo ""

# Stop container-apiserver if running
if pgrep -f container-apiserver > /dev/null; then
    echo -e "${BLUE}🛑 Stopping container-apiserver...${NC}"
    pkill -f container-apiserver || true
    sleep 2
fi

# Delete all containers
echo -e "${YELLOW}🗑️  Deleting containers...${NC}"
if container delete --all --force 2>/dev/null; then
    echo ""
    echo -e "${GREEN}✅ Successfully cleaned up ${CONTAINER_COUNT} container(s)${NC}"
else
    echo ""
    echo -e "${RED}❌ Failed to delete some containers${NC}"
    echo -e "${YELLOW}   You may need to run: container delete --all --force${NC}"
fi

# Show final state
echo ""
echo -e "${BLUE}📋 Final container state:${NC}"
container list --all 2>/dev/null || echo "   (no containers)"
echo ""
