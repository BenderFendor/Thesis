#!/usr/bin/env bash

# Script to run the backend and frontend locally without Docker.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-newsuser}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-newspass}"
POSTGRES_DB="${POSTGRES_DB:-newsdb}"
DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}}"
CHROMA_HOST="${CHROMA_HOST:-localhost}"
CHROMA_PORT="${CHROMA_PORT:-8001}"
CHROMA_DATA_DIR="${CHROMA_DATA_DIR:-$ROOT_DIR/.chroma}"
CHROMA_LOG_FILE="${CHROMA_LOG_FILE:-$CHROMA_DATA_DIR/chroma.log}"
AUTO_INSTALL="${AUTO_INSTALL:-1}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${BACKEND_PORT}}"
NEXT_PUBLIC_DOCKER_API_URL="${NEXT_PUBLIC_DOCKER_API_URL:-$NEXT_PUBLIC_API_URL}"
RUNLOCAL_STATE_DIR="${RUNLOCAL_STATE_DIR:-$ROOT_DIR/.runlocal}"
RUNLOCAL_PID_FILE="${RUNLOCAL_PID_FILE:-$RUNLOCAL_STATE_DIR/pids}"

export DATABASE_URL CHROMA_HOST CHROMA_PORT NEXT_PUBLIC_API_URL NEXT_PUBLIC_DOCKER_API_URL

PIDS=()

log() {
	echo "[runlocal] $*"
}

usage() {
	cat <<'USAGE'
Usage: ./runlocal.sh [setup|services|backend|frontend|all|killall|help]

  setup     Install local Postgres + Chroma dependencies and prep defaults
  services  Start Postgres + Chroma locally (no Docker)
  backend   Create/refresh the Python venv, install deps, start FastAPI (uvicorn)
  frontend  Install npm deps if needed and start Next.js dev server (also starts Postgres + Chroma)
  all       Run backend and frontend together (default)
  killall   Stop processes spawned by previous runlocal.sh runs
  help      Show this message

Environment overrides:
  BACKEND_PORT   Port for uvicorn (default 8000)
  FRONTEND_PORT  Port for Next.js dev server (default 3000)
  POSTGRES_HOST  Postgres hostname (default localhost)
  POSTGRES_PORT  Postgres port (default 5432)
  POSTGRES_USER  Postgres user (default newsuser)
  POSTGRES_PASSWORD Postgres password (default newspass)
  POSTGRES_DB    Postgres database (default newsdb)
  DATABASE_URL   Override Postgres connection string for the backend
  CHROMA_HOST    Hostname for ChromaDB (default localhost)
  CHROMA_PORT    Port for ChromaDB (default 8001)
  CHROMA_DATA_DIR Persistent directory for Chroma data (default ./.chroma)
  CHROMA_LOG_FILE Log file for Chroma server (default ./.chroma/chroma.log)
  AUTO_INSTALL   Set to 1 to auto-install Postgres if missing (default 1)
  NEXT_PUBLIC_API_URL        Frontend base URL for local backend (default http://localhost:<BACKEND_PORT>)
  NEXT_PUBLIC_DOCKER_API_URL Overrides API URL when frontend runs in Docker (default matches NEXT_PUBLIC_API_URL)
USAGE
}

cleanup() {
	log "Stopping background processes..."
	for pid in "${PIDS[@]}"; do
		if kill -0 "$pid" >/dev/null 2>&1; then
			kill "$pid" >/dev/null 2>&1 || true
		fi
	done
	remove_pids_from_file
	PIDS=()

	stop_backend_processes
}

stop_backend_processes() {
	# Ensure uvicorn launched from the backend venv does not linger after shutdown.
	pkill -9 -f "$BACKEND_DIR/.venv/bin/python3 $BACKEND_DIR/.venv/bin/uvicorn app.main" >/dev/null 2>&1 || true
}

ensure_runlocal_state_dir() {
	mkdir -p "$RUNLOCAL_STATE_DIR"
}

record_pid() {
	local pid="$1"
	local label="$2"
	local timestamp

	if [[ -z "$pid" ]]; then
		return 0
	fi

	ensure_runlocal_state_dir
	timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
	printf "%s|%s|%s\n" "$timestamp" "$pid" "$label" >>"$RUNLOCAL_PID_FILE"
}

remove_pids_from_file() {
	if [[ ! -f "$RUNLOCAL_PID_FILE" ]] || [[ ${#PIDS[@]} -eq 0 ]]; then
		return 0
	fi

	local tmp_file="${RUNLOCAL_PID_FILE}.tmp"
	: >"$tmp_file"

	while IFS= read -r line; do
		local pid
		pid="$(printf "%s" "$line" | cut -d'|' -f2)"
		if [[ -z "$pid" ]]; then
			continue
		fi
		local keep=1
		for target_pid in "${PIDS[@]}"; do
			if [[ "$pid" == "$target_pid" ]]; then
				keep=0
				break
			fi
		done
		if [[ "$keep" -eq 1 ]]; then
			printf "%s\n" "$line" >>"$tmp_file"
		fi
	done <"$RUNLOCAL_PID_FILE"

	mv "$tmp_file" "$RUNLOCAL_PID_FILE"
}

prune_pid_file() {
	if [[ ! -f "$RUNLOCAL_PID_FILE" ]]; then
		return 0
	fi

	local tmp_file="${RUNLOCAL_PID_FILE}.tmp"
	: >"$tmp_file"

	while IFS='|' read -r timestamp pid label; do
		if [[ -z "$pid" ]]; then
			continue
		fi
		if kill -0 "$pid" >/dev/null 2>&1; then
			printf "%s|%s|%s\n" "$timestamp" "$pid" "$label" >>"$tmp_file"
		fi
	done <"$RUNLOCAL_PID_FILE"

	mv "$tmp_file" "$RUNLOCAL_PID_FILE"
}

killall_services() {
	if [[ ! -f "$RUNLOCAL_PID_FILE" ]]; then
		log "No runlocal PID file found."
		return 0
	fi

	prune_pid_file

	if [[ ! -s "$RUNLOCAL_PID_FILE" ]]; then
		log "No active runlocal processes found."
		rm -f "$RUNLOCAL_PID_FILE"
		return 0
	fi

	log "Stopping recorded runlocal processes..."
	while IFS='|' read -r _ pid label; do
		if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
			log "Stopping ${label:-process} (pid ${pid})"
			kill "$pid" >/dev/null 2>&1 || true
		fi
	done <"$RUNLOCAL_PID_FILE"

	sleep 0.3

	while IFS='|' read -r _ pid label; do
		if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
			log "Force-stopping ${label:-process} (pid ${pid})"
			kill -9 "$pid" >/dev/null 2>&1 || true
		fi
	done <"$RUNLOCAL_PID_FILE"

	rm -f "$RUNLOCAL_PID_FILE"
	stop_backend_processes
}

free_port() {
	local port="$1"
	if command -v ss >/dev/null 2>&1; then
		local pid
		pid="$(ss -lptn "sport = :${port}" 2>/dev/null | awk -F'pid=' 'NR>1 {print $2}' | awk -F',' '{print $1}' | head -n 1)"
		if [[ -n "$pid" ]]; then
			log "Stopping process $pid on port $port"
			kill "$pid" >/dev/null 2>&1 || true
			sleep 0.2
			if kill -0 "$pid" >/dev/null 2>&1; then
				log "Force-stopping process $pid on port $port"
				kill -9 "$pid" >/dev/null 2>&1 || true
			fi
		fi
	else
		log "ss not available; cannot auto-free port $port"
	fi
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

detect_package_manager() {
	if command -v brew >/dev/null 2>&1; then
		echo "brew"
	elif command -v pacman >/dev/null 2>&1; then
		echo "pacman"
	elif command -v apt-get >/dev/null 2>&1; then
		echo "apt-get"
	elif command -v dnf >/dev/null 2>&1; then
		echo "dnf"
	else
		echo ""
	fi
}

ensure_postgres_initialized() {
	local pkg_mgr="$1"
	if [[ "$pkg_mgr" != "pacman" ]]; then
		return 0
	fi

	local data_dir="/var/lib/postgres/data"
	if [[ -d "$data_dir/base" ]]; then
		return 0
	fi

	if command -v initdb >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
		log "Initializing Postgres data directory at ${data_dir}..."
		sudo -iu postgres initdb -D "$data_dir"
		return $?
	fi

	log "Postgres data directory is not initialized. Run:"
	log "  sudo -iu postgres initdb -D ${data_dir}"
	return 1
}

install_postgres() {
	local pkg_mgr
	pkg_mgr="$(detect_package_manager)"
	if [[ -z "$pkg_mgr" ]]; then
		log "No supported package manager found. Install Postgres manually."
		return 1
	fi

	log "Installing Postgres using ${pkg_mgr}..."
	case "$pkg_mgr" in
		brew)
			brew install postgresql
			;;
		apt-get)
			sudo apt-get update
			sudo apt-get install -y postgresql postgresql-contrib
			;;
		dnf)
			sudo dnf install -y postgresql-server postgresql-contrib
			;;
		pacman)
			sudo pacman -S --noconfirm postgresql
			ensure_postgres_initialized "$pkg_mgr"
			;;
		*)
			log "Package manager ${pkg_mgr} not supported in this script."
			return 1
			;;
	esac
}

ensure_backend_venv() {
	if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
		log "Creating backend virtual environment..."
		python -m venv "$BACKEND_DIR/.venv"
	fi
}

install_backend_deps() {
	# shellcheck disable=SC1091
	source "$BACKEND_DIR/.venv/bin/activate"
	log "Installing backend dependencies..."
	uv pip install -r "$BACKEND_DIR/requirements.txt"
	deactivate || true
}

install_chroma() {
	ensure_backend_venv
	install_backend_deps
}

postgres_ready() {
	if command -v pg_isready >/dev/null 2>&1; then
		pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" >/dev/null 2>&1
		return $?
	fi

	if command -v psql >/dev/null 2>&1; then
		PGPASSWORD="$POSTGRES_PASSWORD" psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1
		return $?
	fi

	return 1
}

start_postgres_service() {
	if postgres_ready; then
		return 0
	fi

	if command -v systemctl >/dev/null 2>&1; then
		log "Starting Postgres with systemctl..."
		sudo systemctl start postgresql || true
	fi

	if command -v brew >/dev/null 2>&1; then
		log "Starting Postgres with brew services..."
		brew services start postgresql || true
	fi

	if postgres_ready; then
		return 0
	fi

	if [[ "$POSTGRES_PORT" != "5432" ]] && command -v pg_isready >/dev/null 2>&1; then
		if pg_isready -h "$POSTGRES_HOST" -p 5432 >/dev/null 2>&1; then
			log "Postgres is responding on port 5432. Set POSTGRES_PORT=5432 or update DATABASE_URL."
		fi
	fi

	log "Postgres is not running at ${POSTGRES_HOST}:${POSTGRES_PORT}."
	return 1
}

ensure_postgres_setup() {
	if command -v psql >/dev/null 2>&1; then
		return 0
	fi

	if [[ "$AUTO_INSTALL" == "1" ]]; then
		install_postgres || return 1
		return 0
	fi

	log "Postgres is not installed. Run ./runlocal.sh setup or set AUTO_INSTALL=1."
	return 1
}

ensure_postgres_user_db() {
	if ! command -v psql >/dev/null 2>&1; then
		return 1
	fi

	if PGPASSWORD="$POSTGRES_PASSWORD" psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
		return 0
	fi

	if command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
		log "Creating Postgres user/database defaults if missing..."
		if ! sudo -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" | grep -q 1; then
			sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}'" || true
		fi

		if ! sudo -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
			sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER}" || true
		fi

		return 0
	fi

	log "Postgres is running, but ${POSTGRES_DB} or ${POSTGRES_USER} may be missing."
	log "Create them manually if needed:"
	log "  createuser -s ${POSTGRES_USER}"
	log "  createdb -O ${POSTGRES_USER} ${POSTGRES_DB}"
	return 0
}

chroma_ready() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsS "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v1/heartbeat" >/dev/null 2>&1
		return $?
	fi

	return 1
}

start_chroma() {
	mkdir -p "$CHROMA_DATA_DIR"

	if chroma_ready; then
		return 0
	fi

	local chroma_bin="$BACKEND_DIR/.venv/bin/chroma"
	if [[ ! -x "$chroma_bin" ]]; then
		if [[ "$AUTO_INSTALL" == "1" ]]; then
			install_chroma
		else
			log "Chroma CLI not found. Run ./runlocal.sh setup or set AUTO_INSTALL=1."
			return 1
		fi
	fi

	log "Starting Chroma server on ${CHROMA_HOST}:${CHROMA_PORT}"
	log "Chroma logs: ${CHROMA_LOG_FILE}"
	"$chroma_bin" run --host "$CHROMA_HOST" --port "$CHROMA_PORT" --path "$CHROMA_DATA_DIR" >>"$CHROMA_LOG_FILE" 2>&1 &
	local chroma_pid=$!
	PIDS+=("$chroma_pid")
	record_pid "$chroma_pid" "chroma"
}

start_services() {
	ensure_postgres_setup || return 1
	start_postgres_service || return 1
	ensure_postgres_user_db || true
	start_chroma || return 1
}

setup_services() {
	log "Setting up local Postgres and Chroma..."
	AUTO_INSTALL=1 ensure_postgres_setup || return 1
	start_postgres_service || true
	ensure_postgres_user_db || true
	install_chroma
	log "Setup complete."
}

run_backend() {
	require_cmd python
	require_cmd uv
	free_port "$BACKEND_PORT"

	pushd "$BACKEND_DIR" >/dev/null

	ensure_backend_venv

	# shellcheck disable=SC1091
	source .venv/bin/activate
	log "Installing backend dependencies..."
	uv pip install -r requirements.txt
	log "Using DATABASE_URL=$DATABASE_URL"
	log "Using Chroma at $CHROMA_HOST:$CHROMA_PORT"

	log "Starting FastAPI dev server on port $BACKEND_PORT"
	uvicorn app.main:app --reload --port "$BACKEND_PORT" &
	local backend_pid=$!
	PIDS+=("$backend_pid")
	record_pid "$backend_pid" "backend"

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
	local frontend_pid=$!
	PIDS+=("$frontend_pid")
	record_pid "$frontend_pid" "frontend"

	popd >/dev/null
}

main() {
	local target="${1:-all}"

	case "$target" in
		setup)
			setup_services
			;;
		services)
			start_services
			;;
		backend)
			start_services
			run_backend
			;;
		frontend)
			start_services
			run_frontend
			;;
		all)
			start_services
			run_backend
			run_frontend
			;;
		killall)
			killall_services
			exit 0
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
