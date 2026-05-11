# Minimal Bun-based Dockerfile for the MPP echo mock.
# Render auto-detects this when runtime: docker is set in render.yaml.
FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock* ./
# Copy the postinstall script BEFORE running `bun install` — postinstall
# fires during install and patches node_modules/@solana/mpp.
COPY scripts ./scripts
RUN bun install --frozen-lockfile || bun install

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000

# Render injects PORT — server.ts reads it.
CMD ["bun", "run", "src/server.ts"]
