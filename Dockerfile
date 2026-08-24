# Single-container build — for hosts that run one image per service (Render, Fly,
# a bare `docker run`). It bundles the API and nginx together, because passkeys
# require the app and /api to share one origin and there is no second container
# here to proxy to.
#
# `docker compose` does NOT use this file: it builds web/Dockerfile (nginx only)
# and runs the API as its own service. Keep the two in step.
#
# --platform=$BUILDPLATFORM pins the build stage to the host's native arch even when
# cross-building for other targets (e.g. amd64 host building an arm64 image). The build
# output (static JS/CSS/HTML) is arch-independent, so there's no reason to run it under
# QEMU — and QEMU-emulated npm installs are known to corrupt esbuild/rollup's platform-
# specific native binaries, which is what breaks `vite build` with unrelated-looking
# module-resolution errors.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY frontend/ ./
# There is no media volume on a single-container host, so the exercise images and
# GIFs are pointed at the upstream dataset on jsDelivr instead of being served
# locally — the same trade the mobile build makes. Pinned to a commit so the URLs
# stay immutable and cache forever.
ENV VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/
ENV VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/
RUN npm run build

FROM node:22-alpine
# /run/nginx is where the alpine package expects to write its pid file, and it is
# not created by the package itself — without it nginx exits before serving a byte.
RUN apk add --no-cache nginx && mkdir -p /run/nginx

WORKDIR /srv/api
COPY api/package.json api/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY api/server.js ./

COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Profiles, passkeys and per-user state. Mount a persistent disk here or every
# deploy starts empty — see render.yaml.
ENV DATA_DIR=/data
VOLUME /data

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
