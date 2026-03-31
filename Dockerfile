# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS client-build

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app/server

# Install production dependencies only
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server source and built client
COPY server/ ./
COPY --from=client-build /app/client/dist ./public

# Data volume — SQLite database lives here
VOLUME ["/data"]
ENV DB_PATH=/data/wealth.db
ENV PORT=3001

EXPOSE 3001

CMD ["node", "index.js"]
