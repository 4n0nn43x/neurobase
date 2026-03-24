# NeuroBase - Multi-stage Docker build
# Usage:
#   docker build -t neurobase .
#   docker run --env-file .env neurobase serve
#   docker run --env-file .env -p 3000:3000 neurobase serve:api

FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY sql/ ./sql/
RUN npm run build

# Production image
FROM node:22-slim AS runtime

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/sql ./sql

# Non-root user for security
RUN addgroup --system neurobase && adduser --system --ingroup neurobase neurobase
USER neurobase

# Default port for API/MCP SSE
EXPOSE 3000

# Health check for API mode
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["interactive"]
