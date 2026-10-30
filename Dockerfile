ARG PREVIOUS_WEB_IMAGE=empty-assets
ARG RETAINED_WEB_IMAGE=empty-assets
ARG BOOTSTRAP_WEB_IMAGE=empty-assets
FROM node:20-bookworm-slim AS empty-assets
RUN mkdir -p /app/.next/static
FROM ${PREVIOUS_WEB_IMAGE} AS previous-assets
FROM ${RETAINED_WEB_IMAGE} AS retained-assets
FROM ${BOOTSTRAP_WEB_IMAGE} AS bootstrap-assets
FROM node:20-bookworm-slim AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && rm -rf /var/lib/apt/lists/*

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends jq \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG GIT_SHA=local
ARG NEXT_PUBLIC_APP_ENVIRONMENT=staging
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_FIREBASE_API_KEY=
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
ARG NEXT_PUBLIC_FIREBASE_APP_ID=
ARG GOOGLE_ANALYTICS_ID=
ENV GIT_SHA=$GIT_SHA
ENV NEXT_PUBLIC_APP_ENVIRONMENT=$NEXT_PUBLIC_APP_ENVIRONMENT
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV GOOGLE_ANALYTICS_ID=$GOOGLE_ANALYTICS_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next typegen && npm run verify

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=bootstrap-assets /app/.next/static ./.next/static
COPY --from=retained-assets /app/.next/static ./.next/static
COPY --from=previous-assets /app/.next/static ./.next/static
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 8080
CMD ["node", "server.js"]
