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
# Read by the browser bundle, so it has to be known when the bundle is built.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# `output: "standalone"` in next.config.ts is what makes .next/standalone a
# server that can run without node_modules beside it.
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333

# No ffmpeg or yt-dlp here any more: the ingest runs in the API's image.

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3333
CMD ["node", "server.js"]
