#!/bin/sh
# Expose embedded MySQL to PHP code that connects via localhost (unix socket) or 127.0.0.1:3306.
set -e

MYSQL_TCP_HOST="${ASSESSMENT_DB_HOST:-assessment-mysql}"
MYSQL_TCP_PORT="${ASSESSMENT_DB_PORT:-3306}"
MYSQL_SOCK="${PDO_MYSQL_SOCKET:-/var/run/mysqld/mysqld.sock}"

mkdir -p "$(dirname "$MYSQL_SOCK")"

if command -v socat >/dev/null 2>&1; then
  socat "UNIX-LISTEN:${MYSQL_SOCK},fork,reuseaddr,unlink-early" "TCP:${MYSQL_TCP_HOST}:${MYSQL_TCP_PORT}" &
  socat "TCP-LISTEN:${MYSQL_TCP_PORT},fork,reuseaddr,bind=127.0.0.1" "TCP:${MYSQL_TCP_HOST}:${MYSQL_TCP_PORT}" &
  sleep 0.3
else
  echo "socat is required for MySQL localhost bridging" >&2
  exit 1
fi
