# Build the browser game and relay together. Set VITE_RELAY_URL at build time
# when serving the game over HTTPS, for example wss://races.example.com.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_RELAY_URL=
ENV VITE_RELAY_URL=${VITE_RELAY_URL}
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=/app/dist \
    BOARD_FILE=/data/board.json \
    PLAYERS_FILE=/data/players.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
VOLUME ["/data"]
EXPOSE 8787
CMD ["npm", "run", "server"]
