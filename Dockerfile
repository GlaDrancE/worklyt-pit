# TrackRush relay server (1 vs 1 online). Build: docker build -t trackrush-relay .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm i
COPY server ./server
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY tsconfig.json ./
ENV PORT=8787 BOARD_FILE=/data/board.json PLAYERS_FILE=/data/players.json
VOLUME ["/data"]
EXPOSE 8787
CMD ["npx", "tsx", "server/server.ts"]
