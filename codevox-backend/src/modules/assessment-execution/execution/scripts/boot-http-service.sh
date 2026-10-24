#!/bin/sh
set -e

HTTP_PORT="${ASSESSMENT_HTTP_PORT:-8080}"
MYSQL_TCP_PORT="${ASSESSMENT_DB_PORT:-3306}"

wait_for_tcp_port() {
  host="$1"
  port="$2"
  attempts="${3:-40}"
  i=0
  while [ "$i" -lt "$attempts" ]; do
    if command -v nc >/dev/null 2>&1 && nc -z "$host" "$port" 2>/dev/null; then
      return 0
    fi
    if command -v node >/dev/null 2>&1 && node -e "const n=require('net');const s=n.createConnection({host:'${host}',port:${port}},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));" 2>/dev/null; then
      return 0
    fi
    if command -v php >/dev/null 2>&1 && php -r "exit(@fsockopen('${host}', (int)${port}) ? 0 : 1);"; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.2
  done
  return 1
}

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
  if ! wait_for_tcp_port 127.0.0.1 "$REDIS_TCP_PORT" 20; then
    echo "Redis localhost bridge did not become ready" >&2
    exit 1
  fi
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

ASSESSMENT_HTTP_RUNTIME="${ASSESSMENT_HTTP_RUNTIME:-php}"

ASSESSMENT_INSTALL_DEPS_ONLY=1 /usr/local/bin/run.sh || true

if [ "$ASSESSMENT_HTTP_RUNTIME" = "node" ]; then
  exec node /workspace/node_runner_bootstrap.js
fi

exec php \
  -S "0.0.0.0:${HTTP_PORT}" \
  -t /workspace \
  /workspace/php_runner_bootstrap.php
