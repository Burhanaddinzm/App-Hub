FROM node:20-alpine

# Install build tools for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY app.js ./
COPY public/ ./public/

# Data directory for SQLite
RUN mkdir -p /data && chown node:node /data

# Drop to non-root
USER node

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/api/auth/me || exit 1

CMD ["node", "app.js"]
