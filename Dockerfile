FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# No real database, Portal or gateway credentials are needed or copied into the image;
# server settings are read at runtime (see .env.example).
# The sidebar links to the other Systems are inlined at build time. An unset one keeps the app's own default.
ARG NEXT_PUBLIC_HOST_URL
ARG NEXT_PUBLIC_CRMS_URL
ARG NEXT_PUBLIC_HRMS_URL
ARG NEXT_PUBLIC_POS_URL
ARG NEXT_PUBLIC_IMS_URL
RUN --mount=type=cache,target=/app/.next/cache for v in NEXT_PUBLIC_HOST_URL NEXT_PUBLIC_CRMS_URL NEXT_PUBLIC_HRMS_URL NEXT_PUBLIC_POS_URL NEXT_PUBLIC_IMS_URL; do \
      eval "[ -n \"\$$v\" ] || unset $v"; \
    done && npm run build

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
