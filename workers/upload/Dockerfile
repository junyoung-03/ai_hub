FROM node:24.12.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY workers/upload ./workers/upload
USER node
CMD ["node", "workers/upload/server.mjs"]
