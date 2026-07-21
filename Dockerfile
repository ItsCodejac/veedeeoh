FROM node:20-slim AS builder

WORKDIR /app

# Copy root package.json if it exists (for workspaces), otherwise just the subfolders
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY backend/package.json backend/package-lock.json ./backend/

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the frontend
WORKDIR /app/frontend
RUN npm run build

# Build the backend (if there is a build step, otherwise we just run tsx)
WORKDIR /app/backend
# No build step needed for backend, tsx runs it directly

# Start a new stage for a smaller production image
FROM node:20-slim

WORKDIR /app

# Copy only the necessary files from builder
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/frontend/package.json /app/frontend/package-lock.json ./frontend/
COPY --from=builder /app/backend/package.json /app/backend/package-lock.json ./backend/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy the built frontend static files
COPY --from=builder /app/src/tvlc/static ./src/tvlc/static

# Copy backend source
COPY --from=builder /app/backend ./backend

# We need tsx to run the backend
RUN npm install -g tsx

WORKDIR /app/backend

# Ensure port matches Railway's PORT env variable
ENV PORT=8321
EXPOSE 8321

# Start the server
CMD ["tsx", "server.ts"]
