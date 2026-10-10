#!/usr/bin/env bash
# Starts Metro for Expo Go advertising this machine's current LAN address
# (Wi-Fi changes at the venue would otherwise leave Expo pointing at a stale IP).
# The app derives its API URL from the same host (port 3000) unless EXPO_PUBLIC_API_URL is set.
set -euo pipefail
cd "$(dirname "$0")/.."
LAN_IP="$(ip route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
echo "LAN IP: ${LAN_IP} – phone and laptop must share this network; API expected at http://${LAN_IP}:3000"
REACT_NATIVE_PACKAGER_HOSTNAME="${LAN_IP}" exec npx expo start --go "$@"
