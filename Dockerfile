FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json prepare.mjs ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json prepare.mjs ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4199 STATE_GALLERY_DATA=/data
EXPOSE 4199
CMD ["node", "dist/server/index.js"]
