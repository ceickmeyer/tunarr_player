#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="/tmp/tunarr-player.pid"
PORT=8002
FIREFOX_CLASS="WebApp-TunarrPlayer"
FIREFOX_PROFILE="$HOME/.local/share/ice/firefox/tunarr-player"

is_running() {
    [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

if is_running; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    pkill -f "$FIREFOX_CLASS" 2>/dev/null
    echo "Tunarr stopped."
else
    rm -f "$PID_FILE"
    cd "$SCRIPT_DIR"
    python3 server.py >/tmp/tunarr-server.log 2>&1 &
    echo $! > "$PID_FILE"

    for i in {1..10}; do
        curl -sf "http://localhost:$PORT/" >/dev/null 2>&1 && break
        sleep 0.3
    done

    firefox --class "$FIREFOX_CLASS" --name "$FIREFOX_CLASS" \
        --profile "$FIREFOX_PROFILE" \
        --no-remote "http://localhost:$PORT" &
    disown
    echo "Tunarr started."
fi
