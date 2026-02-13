FROM oven/bun:1-alpine

WORKDIR /app

# Install production dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy application source
COPY src ./src

# Create non-root user
RUN addgroup -g 1001 -S bunuser && \
    adduser -S bunuser -u 1001 && \
    chown -R bunuser:bunuser /app

USER bunuser

EXPOSE 7100

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:7100/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
