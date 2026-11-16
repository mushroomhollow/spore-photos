# syntax=docker/dockerfile:1
#
# One image, two services: the API (which also serves the web UI) and the
# public-share service. Compose starts them with different commands.
#
#   docker build -t spore-photos .                  # from the repo root
#   docker build -f docker/Dockerfile -t spore-photos .
#
# The build context must be the repository root: the client build reads
# ../VERSION and the runtime needs config/, the three projects, and VERSION.

# ─── Stage 1: build the web client ────────────────────────────────────
FROM node:22-bookworm-slim AS client-build

WORKDIR /app
# vite.config.js reads ../VERSION, so keep the repo layout intact.
COPY VERSION ./VERSION
COPY config ./config
COPY spore-photos-client/package.json spore-photos-client/package-lock.json ./spore-photos-client/
RUN cd spore-photos-client && npm ci

COPY spore-photos-client ./spore-photos-client
# Android builds are not part of this image; keep any APK that was dropped in
# public/apk so the download link works.
RUN cd spore-photos-client && npm run build

# ─── Stage 2: runtime ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# ffmpeg/ffprobe: video ingest. tini: signal forwarding as PID 1.
# gosu: drop from root to PUID/PGID after fixing volume ownership.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg tini gosu ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PICTURES_ROOT=/data/library \
    PORT=4051

WORKDIR /app

# Install runtime dependencies first so code edits don't invalidate them.
COPY VERSION ./VERSION
COPY config ./config
COPY spore-photos-server/package.json spore-photos-server/package-lock.json ./spore-photos-server/
RUN cd spore-photos-server && npm ci --omit=dev
COPY spore-photos-public-share/package.json spore-photos-public-share/package-lock.json ./spore-photos-public-share/
RUN cd spore-photos-public-share && npm ci --omit=dev

COPY spore-photos-server ./spore-photos-server
COPY spore-photos-public-share ./spore-photos-public-share
COPY --from=client-build /app/spore-photos-client/dist ./spore-photos-client/dist

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh && mkdir -p /data/library && chown -R node:node /data

EXPOSE 4051 4052

# Readiness: the API answers /api/health once the schema is applied.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4051)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["api"]