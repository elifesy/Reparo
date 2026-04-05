FROM node:22

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm install --omit=dev

RUN npm rebuild better-sqlite3

RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "server.js"]
