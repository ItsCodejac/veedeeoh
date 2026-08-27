FROM node:20-slim AS builder

WORKDIR /app

# The frontend's Supabase details are compiled into the bundle, so they have to
# be present at BUILD time, not run time. They were not passed at all, which is
# how the image ended up shipping whatever frontend/.env.local happened to hold
# -- and, before the fallback was removed, our own project's credentials.
#
# The build now fails with the name of the missing variable instead:
#
#   docker build \
#     --build-arg VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=eyJ... \
#     -t veedeeoh .
#
# The anon key is public by design -- it is in the JavaScript either way, and
# row-level security is what actually protects the data. The service role key is
# NOT passed here and must never be: it bypasses RLS entirely, and a build arg
# is readable in the image history.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
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

# SUPABASE_URL and SUPABASE_ANON_KEY are read at run time by the server, and
# are supplied by docker-compose or the host rather than baked in. Account
# deletion additionally needs SUPABASE_SERVICE_ROLE_KEY; without it that one
# endpoint answers 501 and says why, rather than half-deleting an account.
ENV PORT=8321
EXPOSE 8321

CMD ["tsx", "server.ts"]
