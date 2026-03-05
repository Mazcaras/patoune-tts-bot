FROM node:20-slim

# installer ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# log pour vérifier que le container démarre
CMD ["sh", "-c", "echo 'Starting bot...' && node src/index.js"]