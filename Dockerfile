FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV npm_config_build_from_source=true

COPY package*.json ./

# Compile sqlite3 inside this Linux image instead of using a prebuilt native addon.
RUN npm ci --omit=dev \
    && npm rebuild sqlite3 --build-from-source

COPY . .

ENV NODE_ENV=production

RUN mkdir -p /app/data

CMD ["npm", "start"]
