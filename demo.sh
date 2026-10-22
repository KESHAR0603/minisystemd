#!/bin/bash

set -u
cd "$(dirname "$0")"

if pgrep -x minisystemd >/dev/null; then
    echo "ERROR: MiniSystemd is already running. Stop it before running a demo."
    exit 1
fi

if [ ! -x ./minisystemd ]; then
    echo "ERROR: minisystemd binary not found. Compile it first."
    exit 1
fi

FEATURE="${1:-}"
BACKUP_DIR="$(mktemp -d)"
DAEMON_PID=""

mkdir -p "$BACKUP_DIR/services"
cp -a services/. "$BACKUP_DIR/services/" 2>/dev/null || true

cleanup() {
    trap - EXIT INT TERM

    if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
        echo
        echo "Stopping demo daemon (PID $DAEMON_PID)..."
        kill -TERM "$DAEMON_PID" 2>/dev/null || true

        for _ in {1..30}; do
            kill -0 "$DAEMON_PID" 2>/dev/null || break
            sleep 0.1
        done

        if kill -0 "$DAEMON_PID" 2>/dev/null; then
            echo "Daemon did not stop within 3 seconds; sending SIGKILL."
            kill -KILL "$DAEMON_PID" 2>/dev/null || true
        fi

        wait "$DAEMON_PID" 2>/dev/null || true
    fi

    find services -maxdepth 1 -type f -name '*.service' -delete
    cp -a "$BACKUP_DIR/services/." services/ 2>/dev/null || true
    rm -rf "$BACKUP_DIR"

    echo
    echo "Original service files restored."
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p services
find services -maxdepth 1 -type f -name '*.service' -delete

case "$FEATURE" in
    reaping)
        cp test.service services/
        echo "DEMO: Process supervision and zombie reaping"
        ;;
    dependency)
        cp demos/dependency-a.service services/
        cp demos/dependency-b.service services/
        echo "DEMO: Dependency ordering (demo_a before demo_b)"
        ;;
    circular)
        cp demos/circular-a.service services/
        cp demos/circular-b.service services/
        echo "DEMO: Circular dependency detection"
        ;;
    restart)
        cp demos/restart.service services/
        echo "DEMO: Automatic restart after failure"
        ;;
    *)
        echo "Usage: ./demo.sh {reaping|dependency|circular|restart}"
        exit 2
        ;;
esac

echo "----------------------------------------"
stdbuf -oL -eL ./minisystemd &
DAEMON_PID=$!

echo "Started demo daemon with PID $DAEMON_PID."
echo "Waiting for the demonstration to finish..."

if [ "$FEATURE" = "circular" ]; then
    # Circular dependency detection exits during startup.
    wait "$DAEMON_PID"
    RESULT=$?
else
    # Allow the demo to run long enough to show its behavior.
    case "$FEATURE" in
        reaping)   sleep 10 ;;
        dependency) sleep 4 ;;
        restart)   sleep 12 ;;
    esac

    RESULT=0
fi

echo "----------------------------------------"
echo "Demo finished (observed exit status: $RESULT)"
exit 0
