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
# Everything, including devDependencies — `tsc` needs them.
#
# This was `--omit=dev`, which looks right for an image and is not: the type
# packages for what lib/server imports live in the root's devDependencies, so
# `@types/pg` was absent and the build below failed with a screenful of
# implicit-any on code that compiles fine on a laptop. The dev dependencies
# are needed to BUILD and not to RUN, which is what `npm prune` is for.
RUN npm ci
COPY lib ./lib
COPY api ./api
RUN cd api && npm run build
# Now that tsc is done, take them back out. The runtime stage copies this
# node_modules wholesale, so pruning here is what keeps the shipped image to
# what a request actually reaches.
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# `@/lib/...` inside the compiled output points at dist, not at the sources.
ENV TS_NODE_BASEURL=./dist
# Downloads and frames live here; mount a volume on it.
ENV DOTCONTENT_DATA_DIR=/app/.data

# ffmpeg, and only ffmpeg.
#
# This image used to carry python3 and a downloaded yt-dlp as well, because
# fetching a link ran here. It does not any more: an `ingest_source` job goes
# to a machine that has yt-dlp, the download happens there, and what comes
# back is the stills and a 16 kHz WAV. Nothing on this side touches a URL's
# media.
#
# ffmpeg stays for the one ingest that is still local — a BROWSER UPLOAD,
# whose bytes already arrived here, and where posting them back out to a
# laptop to cut eight stills would double the transfer to learn nothing.
# `ffprobe` ships in the same package. Whisper is deliberately absent:
# transcription is a job over that WAV, aimed at a desktop with a GPU, and a
# CPU transcriber on a 2GB VPS is the slowest way to get the worst answer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
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
