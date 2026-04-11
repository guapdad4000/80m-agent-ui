#!/usr/bin/env bash
# deploy-tailscale.sh — Build and deploy 80m-agent-ui with Tailscale Funnel
# Usage: ./deploy-tailscale.sh [--serve-only] [--funnel]
#   --serve-only : only build and start local server (no Tailscale)
#   --funnel     : build, serve, and expose via Tailscale Funnel

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$APP_DIR/dist"
PORT=5190
SERVICE_NAME="80m-agent-ui"
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

cd "$APP_DIR"

# ====================================================================
# Step 1 — Build
# ====================================================================
info "Building 80m-agent-ui..."
if ! npm run build 2>&1; then
  error "Build failed. Fix errors and retry."
  exit 1
fi
info "Build complete: $DIST_DIR"

# ====================================================================
# Step 2 — Check dependencies
# ====================================================================
if ! command -v npx &>/dev/null; then
  error "npx not found — install Node.js"
  exit 1
fi

# Check if Tailscale is available
if command -v tailscale &>/dev/null; then
  TS_VERSION=$(tailscale version 2>/dev/null | head -1 || echo "unknown")
  info "Tailscale detected: $TS_VERSION"
  TS_AVAILABLE=true
else
  warn "Tailscale not installed — install from https://tailscale.com/download"
  TS_AVAILABLE=false
fi

# ====================================================================
# Step 3 — Start local server
# ====================================================================
SERVE_PID=""
cleanup() {
  if [[ -n "$SERVE_PID" ]] && kill -0 "$SERVE_PID" 2>/dev/null; then
    info "Stopping local server (PID $SERVE_PID)..."
    kill "$SERVE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

info "Starting local server on port $PORT..."
npx serve "$DIST_DIR" -l "$PORT" --no-clipboard &
SERVE_PID=$!
sleep 2

if ! kill -0 "$SERVE_PID" 2>/dev/null; then
  error "Failed to start server"
  exit 1
fi
info "Server running at http://localhost:$PORT"
info "Local network: http://$(hostname -I | awk '{print $1}'):$PORT"

# ====================================================================
# Step 4 — Tailscale Funnel (optional)
# ====================================================================
if [[ "${1:-}" == "--funnel" ]] || [[ "${1:-}" == "-f" ]]; then
  if ! $TS_AVAILABLE; then
    error "Tailscale not available. Install it to use --funnel."
    exit 1
  fi

  info "Configuring Tailscale Funnel..."

  # Ensure logged in
  if ! tailscale status --json &>/dev/null; then
    error "Tailscale not logged in. Run: tailscale login"
    exit 1
  fi

  # Enable Funnel on the port
  info "Running: tailscale funnel $PORT"
  if ! sudo tailscale funnel "$PORT"; then
    warn "Funnel command failed — trying without sudo..."
    if ! tailscale funnel "$PORT"; then
      error "Funnel setup failed. Try manually:"
      echo ""
      echo "  sudo tailscale funnel $PORT"
      echo "  tailscale funnel 5190"
    fi
  fi

  # Show public URL
  FQDN=$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
  if [[ -n "$FQDN" ]]; then
    info "PUBLIC URL: https://$FQDN"
  else
    info "Funnel enabled. Find your public URL at: https://login.tailscale.com/admin/machines"
  fi

  info "Funnel is active — server accessible from anywhere"
fi

# ====================================================================
# Step 5 — Systemd service (optional)
# ====================================================================
if [[ "${1:-}" == "--systemd" ]] || [[ "${2:-}" == "--systemd" ]]; then
  info "Creating systemd user service..."

  mkdir -p "$HOME/.config/systemd/user"

  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=80m Agent Control UI
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStartPre=$APP_DIR/deploy-tailscale.sh --serve-only
ExecStart=npx serve $DIST_DIR -l $PORT --no-clipboard
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

  info "Service file created: $SERVICE_FILE"
  echo ""
  echo "To enable and start:"
  echo "  systemctl --user daemon-reload"
  echo "  systemctl --user enable --now ${SERVICE_NAME}"
  echo "  systemctl --user status ${SERVICE_NAME}"
  echo ""
  echo "For Tailscale Funnel with systemd:"
  echo "  sudo tailscale funnel $PORT"
  echo "  # then in /etc/systemd/system/:"
  echo "  sudo systemctl enable --now tailscale-80m-agent-ui"
fi

# ====================================================================
# Summary
# ====================================================================
echo ""
info "=============================================="
info "  80m-agent-ui deployment summary"
info "=============================================="
echo ""
echo "  Local:     http://localhost:$PORT"
echo "  LAN:       http://$(hostname -I | awk '{print $1}' 2>/dev/null || echo 'your-ip'):$PORT"
if $TS_AVAILABLE; then
  echo "  Tailscale: tailscale funnel $PORT"
fi
echo ""
echo "  Build dir: $DIST_DIR"
echo ""
if [[ -z "${1:-}" ]]; then
  echo "  Options:"
  echo "    --funnel   : expose via Tailscale Funnel (public)"
  echo "    --systemd  : install as user systemd service"
  echo "    --serve-only : local server only (this mode)"
fi
echo ""
info "Server is running. Press Ctrl+C to stop."
echo ""

# Keep alive
wait $SERVE_PID
