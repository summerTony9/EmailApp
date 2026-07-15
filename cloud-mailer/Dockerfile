FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV MAILER_HOST=0.0.0.0
ENV MAILER_PORT=8090
ENV MAILER_DB_PATH=/data/cloud-mailer.sqlite

EXPOSE 8090

CMD ["node", "src/index.js"]
