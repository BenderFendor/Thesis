#!/usr/bin/env bash

# Script to run the backend and frontend locally for development without Docker for the backend and frontend still using it for databases.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://newsuser:newspass@localhost:6543/newsdb}"
CHROMA_HOST="${CHROMA_HOST:-localhost}"
CHROMA_PORT="${CHROMA_PORT:-8001}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${BACKEND_PORT}}"
NEXT_PUBLIC_DOCKER_API_URL="${NEXT_PUBLIC_DOCKER_API_URL:-$NEXT_PUBLIC_API_URL}"

export DATABASE_URL CHROMA_HOST CHROMA_PORT NEXT_PUBLIC_API_URL NEXT_PUBLIC_DOCKER_API_URL

PIDS=()

log() {
	echo "[runlocal] $*"
}

usage() {
	cat <<'USAGE'
Usage: ./runlocal.sh [backend|frontend|all|help]

  backend   Create/refresh the Python venv, install deps, start FastAPI (uvicorn)
  frontend  Install npm deps if needed and start Next.js dev server
  all       Run backend and frontend together (default)
  help      Show this message

Environment overrides:
  BACKEND_PORT   Port for uvicorn (default 8000)
  FRONTEND_PORT  Port for Next.js dev server (default 3000)
	DATABASE_URL   Override Postgres connection string for the backend
	CHROMA_HOST    Hostname for ChromaDB (default localhost)
	CHROMA_PORT    Port for ChromaDB (default 8001)
	NEXT_PUBLIC_API_URL        Frontend base URL for local backend (default http://localhost:<BACKEND_PORT>)
	NEXT_PUBLIC_DOCKER_API_URL Overrides API URL when frontend runs in Docker (default matches NEXT_PUBLIC_API_URL)
USAGE
}

cleanup() {
	if [[ ${#PIDS[@]} -eq 0 ]]; then
		return
	fi

	log "Stopping background processes..."
	for pid in "${PIDS[@]}"; do
		if kill -0 "$pid" >/dev/null 2>&1; then
			kill "$pid" >/dev/null 2>&1 || true
		fi
	done
	PIDS=()
}

handle_signal() {
	local signal="$1"
	log "Received ${signal}. Cleaning up..."
	cleanup
	trap - EXIT
	trap - INT TERM
	exit 130
}

trap cleanup EXIT
trap 'handle_signal SIGINT' INT
trap 'handle_signal SIGTERM' TERM

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		log "Missing required command: $1"
		exit 1
	fi
}

start_data_services() {
	if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
		log "Ensuring Postgres and ChromaDB containers are running via docker compose..."
		docker compose up -d postgres chromadb
		return
	fi

	if command -v docker-compose >/dev/null 2>&1; then
		log "Ensuring Postgres and ChromaDB containers are running via docker-compose..."
		docker-compose up -d postgres chromadb
		return
	fi

	log "Docker Compose is not available; skipping Postgres/Chroma startup"
}

run_backend() {
	require_cmd python
	require_cmd uv pip
	start_data_services

	pushd "$BACKEND_DIR" >/dev/null

	if [[ ! -d .venv ]]; then
		log "Creating backend virtual environment..."
		python -m venv .venv
	fi

	# shellcheck disable=SC1091
	source .venv/bin/activate
	log "Installing backend dependencies..."
	uv pip install -r requirements.txt
	log "Using DATABASE_URL=$DATABASE_URL"
	log "Using Chroma at $CHROMA_HOST:$CHROMA_PORT"

	log "Starting FastAPI dev server on port $BACKEND_PORT"
	uvicorn app.main:app --reload --port "$BACKEND_PORT" &
	PIDS+=($!)

	deactivate || true
	popd >/dev/null
}

run_frontend() {
	require_cmd npm

	pushd "$FRONTEND_DIR" >/dev/null

	if [[ ! -d node_modules ]]; then
		log "Installing frontend dependencies..."
		npm install
	fi

	log "Starting Next.js dev server on port $FRONTEND_PORT"
	npm run dev -- --port "$FRONTEND_PORT" &
	PIDS+=($!)

	popd >/dev/null
}

main() {
	local target="${1:-all}"

	case "$target" in
		backend)
			run_backend
			;;
		frontend)
			run_frontend
			;;
		all)
			run_backend
			run_frontend
			;;
		help|--help|-h)
			usage
			exit 0
			;;
		*)
			log "Unknown target: $target"
			usage
			exit 1
			;;
	esac

	if [[ ${#PIDS[@]} -eq 0 ]]; then
		exit 0
	fi

	log "Services are running. Press Ctrl+C to stop."
	for pid in "${PIDS[@]}"; do
		wait "$pid" || true
	done
}

main "$@"
