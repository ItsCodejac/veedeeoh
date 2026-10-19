FROM node:24-slim AS builder
WORKDIR /app

# This image always builds the standalone product, even if cloud credentials
# happen to be present in the caller's environment.
ENV VEEDEEOH_TARGET=selfhost
ARG VITE_PROXY_URL=""
ENV VITE_PROXY_URL=$VITE_PROXY_URL
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend
COPY . .
RUN npm run build --prefix frontend

FROM node:24-slim AS runtime
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=builder /app/src/tvlc/static /app/src/tvlc/static

# The named Compose volume retains the same files across container rebuilds.
ENV VEEDEEOH_DATA_DIR=/data
ENV PORT=8321
EXPOSE 8321
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8321/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server.ts"]
