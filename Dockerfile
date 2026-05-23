FROM alpine:3.20

WORKDIR /app
RUN apk add --no-cache nodejs npm

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./server.js
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3030
ENV DATA_DIR=/data
EXPOSE 3030

CMD ["node", "server.js"]
