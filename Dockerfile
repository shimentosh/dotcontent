# The app, as a server runs it.
#
# Three stages so the image that ships carries no toolchain: deps installs,
# build compiles, runtime holds the standalone output and the binaries a run
# actually shells out to.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `output: "standalone"` in next.config.ts is what makes .next/standalone a
# server that can run without node_modules beside it.
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333

# The tools the Integrations page probes for. Without them the app still runs;
# source-video features report the binary as missing, which is the truth.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Migrations run from the image on deploy, before the server takes traffic.
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib/server/db ./lib/server/db

EXPOSE 3333
CMD ["node", "server.js"]
