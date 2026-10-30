FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DB_PATH=/app/data/hypemeet.db
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
# The built-in Budokai Tenkaichi 3 plugin's page (server/bt3/). Nothing of the game: that's built on the server.
COPY plugins/bt3/page ./plugins/bt3/page
# The link-preview card draws the logo from here.
COPY public ./public
COPY --from=build /app/dist ./dist
# YouTube in the Discord Activity (server/youtube.ts). Latest on every build: YouTube changes often and old
# yt-dlps stop working. shortcut: x86_64 only; on ARM use yt-dlp_linux_aarch64.
ADD https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp
# Its JS runtime for YouTube's challenges (it doesn't support Bun 1.4).
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
EXPOSE 3001
CMD ["bun", "server/index.ts"]
