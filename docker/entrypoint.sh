#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${CODEX_DATA_DIR:-/app/data}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
DISPLAY=":${DISPLAY_NUM}"
XVFB_PID=""
APP_PID=""

cleanup() {
  if [[ -n "${APP_PID}" ]] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${XVFB_PID}" ]] && kill -0 "${XVFB_PID}" 2>/dev/null; then
    kill "${XVFB_PID}" 2>/dev/null || true
    wait "${XVFB_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

Xvfb "${DISPLAY}" \
  -screen 0 1280x900x24 \
  -ac \
  +extension RANDR \
  -nolisten tcp &
XVFB_PID=$!

for _ in $(seq 1 100); do
  if [[ -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ]]; then
  echo "Xvfb did not become ready on ${DISPLAY}" >&2
  exit 1
fi

export DISPLAY

node index.js "$@" &
APP_PID=$!
wait "${APP_PID}"
