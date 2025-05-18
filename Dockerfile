# pi-cube-backend/Dockerfile
FROM node:18-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./

RUN npm run build

CMD ["node", "dist/index.js"]
