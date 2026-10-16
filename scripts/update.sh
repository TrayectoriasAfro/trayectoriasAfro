#!/usr/bin/env bash
# Update the checkout, rebuild production images, migrate, and replace services.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.server.yml -f docker-compose.prod.yml -f docker-compose.monitoring.yml)

cd "$PROJECT_ROOT"

# Default: back up the database before touching anything (same `dbbackup -c`
# invocation as the nightly cron, lands in ./backups/ on the host).
# --no-backup skips it (e.g. stack not running yet on a first deploy).
SKIP_BACKUP=false
for arg in "$@"; do
	case "$arg" in
	--no-backup) SKIP_BACKUP=true ;;
	-h | --help)
		echo "Usage: ./scripts/update.sh [--no-backup]"
		exit 0
		;;
	*)
		echo "Unknown option: $arg" >&2
		exit 1
		;;
	esac
done

if [[ "$SKIP_BACKUP" == "false" ]]; then
	echo "==> Backing up database to ./backups/ ..."
	# Runs against the currently deployed web container, so the backup always
	# reflects the pre-update state. A failed backup aborts the update.
	"${COMPOSE[@]}" exec -T web python manage.py dbbackup -c
	echo "==> Backup completed."
fi

git pull --ff-only --recurse-submodules
git submodule update --init --recursive

"${COMPOSE[@]}" up -d --wait postgres
"${COMPOSE[@]}" build --pull web frontend

# Apply schema changes using the newly built image before replacing the web service.
"${COMPOSE[@]}" run --rm --no-deps web python manage.py migrate --noinput
"${COMPOSE[@]}" up -d --force-recreate --wait web frontend

# Populate search vectors for PersonaEsclavizada and Persona models
"${COMPOSE[@]}" exec -T web python manage.py populate_search_vectors

echo "Production update completed successfully."
