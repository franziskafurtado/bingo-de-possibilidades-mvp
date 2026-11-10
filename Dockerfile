FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
