# ── Stage 1: Build the SvelteKit frontend ─────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Docker CLI + Compose plugin + core utilities
# openssh-client is required for DOCKER_HOST=ssh:// transport
RUN apk add --no-cache docker-cli docker-cli-compose git curl openssh-client rsync

# Security scanners — installed best-effort; gracefully unavailable if any download fails.
# Update versions here to upgrade. Using || true so image still builds on network issues.
ARG TRIVY_VERSION=0.70.0
ARG GITLEAKS_VERSION=8.30.1
ARG OSV_VERSION=2.3.8

RUN set -e && \
    ARCH="$(uname -m | sed 's/x86_64/64bit/;s/aarch64/ARM64/')" && \
    # Trivy (filesystem + dependency CVE scanner)
    curl -sSfL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin trivy || echo "[WDP] Trivy install failed — scanner will show as unavailable" && \
    # Gitleaks (secret / credential scanner)
    curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks || echo "[WDP] Gitleaks install failed — scanner will show as unavailable" && \
    # OSV-Scanner (Google open-source vulnerability DB)
    curl -sSfL "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64" \
      -o /usr/local/bin/osv-scanner && chmod +x /usr/local/bin/osv-scanner || echo "[WDP] OSV-Scanner install failed — scanner will show as unavailable"

# Install backend dependencies (production only)
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy compiled frontend from the build stage
COPY --from=frontend-builder /build/build ./frontend/build

# User-facing documentation (in-app Help)
COPY application_documentation/ ./application_documentation/

# Persistent data volume (sessions + wdp-config.json)
VOLUME ["/data"]

# Isolated Docker CLI config (no docker-credential-desktop from mounted $HOME)
RUN mkdir -p /app/.wdp-docker-cli && printf '%s\n' '{}' > /app/.wdp-docker-cli/config.json

COPY docker/docker-entrypoint.sh /usr/local/bin/wdp-entrypoint.sh
RUN chmod +x /usr/local/bin/wdp-entrypoint.sh

EXPOSE 8900

ENV PORT=8900
ENV HOST=0.0.0.0
ENV SESSION_DIR=/data/sessions
ENV CONFIG_PATH=/data/wdp-config.json

ENTRYPOINT ["/usr/local/bin/wdp-entrypoint.sh"]
