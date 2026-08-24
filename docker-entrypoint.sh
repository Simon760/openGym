#!/bin/sh
# Runs the API and nginx side by side in one container (see Dockerfile).
#
# Two ports are in play and they must not collide: the platform tells us which
# port to serve on via $PORT (Render picks it, and health-checks exactly that
# one), so nginx takes it and the API is pinned to an internal 3000 that only
# nginx talks to. Handing $PORT to the API instead would expose the JSON API
# where the app is supposed to be.
set -eu

: "${PORT:=8080}"
sed -i "s/listen  *80;/listen ${PORT};/" /etc/nginx/http.d/default.conf

PORT=3000 node /srv/api/server.js &
api=$!

nginx -g 'daemon off;' &
web=$!

# A half-dead container serves 502s indefinitely and looks healthy to a platform
# that only checks the port is open. Exiting as soon as either half dies hands
# the problem back to the scheduler, which knows how to restart it.
trap 'kill -TERM "$api" "$web" 2>/dev/null || true' TERM INT
while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do
  sleep 2
done

kill -TERM "$api" "$web" 2>/dev/null || true
wait "$api" "$web" 2>/dev/null || true
echo "opengym: api or nginx exited — stopping container" >&2
exit 1
