# The Budokai Tenkaichi 3 plugin's builder (builder.ts): compiles the browser port from the server owner's disc image.
# The image holds the toolchain and the fork's source only, never anything from the disc: that lives in the data
# volume (/app/data/bt3/), and so does everything made from it.
FROM oven/bun:1.4 AS bun

# The port is built with Emscripten 6.0 (docs/web/README.md of the fork).
FROM emscripten/emsdk:6.0.13
# 7z reads the disc image (install.py); venv holds splat; Pillow draws the icons (port/web/make_icons.py).
RUN apt-get update \
  && apt-get install -y --no-install-recommends p7zip-full python3-venv python3-pip python3-pil git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Splits the game's programs (install.py: SPLAT). Installed once here; the venv install.py makes sees it.
RUN PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install --no-cache-dir "splat64[mips]==0.50.0"
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# The fork at a fixed commit: plugins/bt3/builder/patch.ts is checked against this one.
ARG BT3_REPO=https://github.com/stufno102/Tenkaichi3Decomp.git
ARG BT3_COMMIT=81507cde58685a6f5aab917c298d9a9f82fe09b0
RUN git init -q /opt/t3 \
  && git -C /opt/t3 fetch -q --depth 1 "$BT3_REPO" "$BT3_COMMIT" \
  && git -C /opt/t3 checkout -q FETCH_HEAD \
  && rm -rf /opt/t3/.git
ENV BT3_SOURCE=/opt/t3 BT3_COMMIT=$BT3_COMMIT BT3_DIR=/app/data/bt3

WORKDIR /opt/builder
COPY builder.ts patch.ts steps.py ./
CMD ["bun", "builder.ts"]
