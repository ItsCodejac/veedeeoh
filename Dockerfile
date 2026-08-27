FROM node:20-slim AS builder

WORKDIR /app

# WHICH PRODUCT THIS IMAGE IS.
#
# Left empty -- which is the default, and what docker compose does -- these build
# the SELF-HOST product: local JSON storage, local profiles, no accounts and no
# database. That is the whole point of this image and needs no configuration.
#
# They exist because the same Dockerfile can build the cloud product, whose
# Supabase details are compiled into the bundle and so must be present at build
# time rather than run time:
#
#   docker build \
#     --build-arg VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=eyJ... \
#     -t veedeeoh .
#
# The anon key is public by design; it is in the JavaScript either way. The
# service role key is NOT passed here and must never be: it bypasses row-level
# security, and a build arg is readable in the image history.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_PARTY_WORKER_URL=""
ARG VITE_PROXY_URL=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_PARTY_WORKER_URL=$VITE_PARTY_WORKER_URL \
    VITE_PROXY_URL=$VITE_PROXY_URL

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY backend/package.json backend/package-lock.json ./backend/

RUN npm ci

COPY . .

WORKDIR /app/frontend
RUN npm run build

# The backend runs through tsx and has no build step.

FROM node:20-slim AS runtime

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/frontend/package.json /app/frontend/package-lock.json ./frontend/
COPY --from=builder /app/backend/package.json /app/backend/package-lock.json ./backend/

RUN npm ci --omit=dev

COPY --from=builder /app/src/tvlc/static ./src/tvlc/static
COPY --from=builder /app/backend ./backend

RUN npm install -g tsx

WORKDIR /app/backend

# The server reads no Supabase configuration. It keeps favourites, watch
# progress and the cached catalogue in a JSON store under this path, which
# docker-compose mounts as a named volume so a rebuild does not discard it.
ENV XDG_DATA_HOME=/root/.local/share
ENV PORT=8321
EXPOSE 8321

CMD ["tsx", "server.ts"]
