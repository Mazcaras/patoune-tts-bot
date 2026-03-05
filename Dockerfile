FROM node:22

WORKDIR /app

# dépendances système pour discord voice
RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    python3 \
    make \
    g++ \
    libopus-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "src/index.js"]