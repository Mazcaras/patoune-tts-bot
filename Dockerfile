FROM node:20-slim

# Installer ffmpeg (et certificats)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .
ENV NODE_ENV=production
CMD ["npm", "start"]