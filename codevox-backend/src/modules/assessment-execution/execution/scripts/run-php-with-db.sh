#!/bin/sh
set -e

MYSQL_TCP_PORT="${ASSESSMENT_DB_PORT:-3306}"

start_redis_localhost_bridge() {
  if [ -z "$ASSESSMENT_REDIS_HOST" ]; then
    return 0
  fi
  if ! command -v socat >/dev/null 2>&1; then
    echo "socat is required for Redis localhost bridging" >&2
    exit 1
  fi
  REDIS_TCP_HOST="${ASSESSMENT_REDIS_HOST:-assessment-redis}"
  REDIS_TCP_PORT="${ASSESSMENT_REDIS_PORT:-6379}"
  socat "TCP-LISTEN:${REDIS_TCP_PORT},fork,reuseaddr,bind=127.0.0.1" "TCP:${REDIS_TCP_HOST}:${REDIS_TCP_PORT}" &
  sleep 0.3
}

start_redis_localhost_bridge

if [ -f /workspace/schema.sql ] && [ -n "$ASSESSMENT_DB_HOST" ]; then
  if [ -n "$ASSESSMENT_DB_PASSWORD" ]; then
    mysql -h127.0.0.1 -P"$MYSQL_TCP_PORT" --connect-timeout=5 \
      -u"${ASSESSMENT_DB_USER:-root}" -p"$ASSESSMENT_DB_PASSWORD" \
      "${ASSESSMENT_DB_NAME:-testdb}" < /workspace/schema.sql || true
  else
    mysql -h127.0.0.1 -P"$MYSQL_TCP_PORT" --connect-timeout=5 \
      -u"${ASSESSMENT_DB_USER:-root}" \
      "${ASSESSMENT_DB_NAME:-testdb}" < /workspace/schema.sql || true
  fi
fi

exec /usr/local/bin/run.sh
