# BookLeaf API image. Used by docker-compose.prod.yml on the VPS.
FROM node:24-alpine AS build
WORKDIR /app
# Prisma's schema engine (used by `migrate deploy`) needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
# Full node_modules is kept on purpose: the Prisma CLI (a dev dependency) runs migrations at startup.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts openapi.yaml ./
COPY prisma ./prisma
COPY data ./data
USER node
EXPOSE 4000
# migrate deploy only applies migrations that have not run yet, so it is safe on every start.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/server.js"]
