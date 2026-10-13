FROM node:24.12.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/build-analysis-worker.mjs scripts/build-analysis-worker.mjs
COPY workers/analysis/server.ts workers/analysis/runner.ts workers/analysis/
COPY src/lib/gemini/client.ts src/lib/gemini/validation.ts src/lib/gemini/date-context.ts src/lib/gemini/
COPY src/lib/items/analysis-policy.ts src/lib/items/analysis-failure.ts src/lib/items/analysis-job-rpc.ts src/lib/items/
COPY AI_OUTPUT_SCHEMA.json ./
RUN node scripts/build-analysis-worker.mjs
FROM node:24.12.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/.analysis-worker ./.analysis-worker
USER node
CMD ["node", "--conditions=react-server", ".analysis-worker/workers/analysis/server.cjs"]
