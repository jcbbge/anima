FROM oven/bun:1-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy application code
COPY src ./src

# Create non-root user
RUN addgroup -g 1001 -S bunuser && \
    adduser -S bunuser -u 1001 && \
    chown -R bunuser:bunuser /app

USER bunuser

# Expose port
EXPOSE 7000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run -e "fetch('http://localhost:7000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start application
CMD ["bun", "run", "src/server.js"]
