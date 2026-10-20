#!/usr/bin/env bash
# Full local backup of selected Compose stacks; briefly stops app writers.
# See deploy/RECOVERY-PL.md before scheduling. Tests use isolated fixtures.
set -euo pipefail
umask 077

DEST="${NIMBLE_BACKUP_DEST:-/var/backups/nimble}"
KEEP_DAYS="${NIMBLE_BACKUP_KEEP_DAYS:-14}"
COMPOSE_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo 'KEEP_DAYS must be a nonnegative integer' >&2; exit 1; }
mkdir -p "$DEST"
exec 9>"$DEST/.backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }

backup_stack() (
  set -e
  local stack="$1" partial='' resume=0
  local env_file="$COMPOSE_DIR/.env.$stack"
  [[ "$stack" == main || "$stack" == test ]] || { echo 'Expected stack main or test' >&2; exit 1; }
  [[ -f "$env_file" ]] || { echo "FAILED $stack: missing configuration" >&2; exit 1; }
  local -a compose=(docker compose -p "nimble-$stack" -f "$COMPOSE_DIR/docker-compose.prod.yml" --env-file "$env_file")
  cleanup() {
    local result=$?
    trap - EXIT
    if [[ "$resume" == 1 ]]; then
      if ! "${compose[@]}" start app; then
        echo "FAILED $stack: app could not be restarted; operator intervention required" >&2
        result=1
      fi
    fi
    [[ -z "$partial" ]] || rm -rf -- "$partial"
    exit "$result"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  partial=$(mktemp -d "$DEST/.$stack-partial.XXXXXXXX")
  # Stop API/workers before dumping so DB references and media agree.
  # A stack already stopped by its operator must remain stopped.
  local running
  running=$("${compose[@]}" ps --status running --services) || exit 1
  if [[ $'\n'"$running"$'\n' == *$'\napp\n'* ]]; then
    resume=1
    "${compose[@]}" stop app || exit 1
  fi

  if ! "${compose[@]}" exec -T db pg_dump -U nimble -d nimble --clean --if-exists | gzip > "$partial/database.sql.gz"; then
    echo "FAILED $stack: database dump failed; older backups retained" >&2
    exit 1
  fi
  if ! gzip -t "$partial/database.sql.gz" || [[ $(stat -c%s "$partial/database.sql.gz") -lt 2000 ]]; then
    echo "FAILED $stack: invalid or implausibly small database dump" >&2
    exit 1
  fi
  # A one-off container mounts the same named volumes while the writer is stopped.
  if ! "${compose[@]}" run --rm --no-deps -T --entrypoint tar app -C /var/lib/nimble -czf - menu-images task-photos > "$partial/media.tar.gz"; then
    echo "FAILED $stack: media copy failed; older backups retained" >&2
    exit 1
  fi
  tar -tzf "$partial/media.tar.gz" > /dev/null || exit 1
  local source_commit
  source_commit=$(git -C "$COMPOSE_DIR/.." rev-parse HEAD 2>/dev/null) || source_commit=UNKNOWN
  printf 'format=nimble-full-backup-v1\nstack=%s\ncreated_utc=%s\nsource_checkout=%s\n' \
    "$stack" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$source_commit" > "$partial/MANIFEST.txt"
  (cd "$partial" && sha256sum database.sql.gz media.tar.gz MANIFEST.txt > SHA256SUMS && sha256sum -c SHA256SUMS) || exit 1

  # A failed restart must not discard old copies.
  if [[ "$resume" == 1 ]]; then
    "${compose[@]}" start app || exit 1
    resume=0
  fi
  local out="$DEST/$stack-$(date -u +%Y%m%dT%H%M%SZ)-${partial##*.}.backup"
  mv -T -- "$partial" "$out" || exit 1
  partial=''
  echo "ok $stack: $out"
  # Only rotate this successful stack. Keep legacy SQL copies until a full restore
  # has been verified, and never delete the snapshot just published.
  find "$DEST" -mindepth 1 -maxdepth 1 -type d -name "$stack-*.backup" \
    ! -path "$out" -mtime "+$KEEP_DAYS" -exec rm -rf -- {} + || exit 1
  exit 0
)

if [[ "$#" == 0 ]]; then set -- main test; fi
result=0
for stack in "$@"; do
  # Running a function inside 'if' would disable errexit throughout its body.
  set +e
  backup_stack "$stack"
  stack_result=$?
  set -e
  if [[ "$stack_result" != 0 ]]; then result=1; fi
done
exit "$result"
