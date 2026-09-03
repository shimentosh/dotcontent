# The API, as a server runs it.
#
# Built from the REPO ROOT as context (`docker build -f api/Dockerfile .`),
# because the service shares lib/server with the web app: the repos, the run
# driver, the ingest. The image carries only what a request actually reaches —
# the compiled TypeScript and the binaries the ingest shells out to.
FROM node:24-bookworm-slim AS deps
WORKDIR /app/api
COPY api/package.json api/package-lock.json* ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/api/node_modules ./api/node_modules
# The shared code, and the root packages it imports (pg, the Anthropic SDK).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY lib ./lib
COPY api ./api
RUN cd api && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# `@/lib/...` inside the compiled output points at dist, not at the sources.
ENV TS_NODE_BASEURL=./dist
# Downloads and frames live here; mount a volume on it.
ENV CONTENTOS_DATA_DIR=/app/.data

# The tools the ingest runs. Without them the API still starts; source-video
# features report the binary as missing, which is the truth.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/node_modules ./api/node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/package.json /app/api/tsconfig.json ./api/

WORKDIR /app/api
EXPOSE 4000
# tsconfig-paths resolves the `@/` imports inside the compiled output, the
# same way ts-node does in development.
CMD ["node", "-r", "tsconfig-paths/register", "dist/api/src/main.js"]
