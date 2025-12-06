# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Generar Prisma Client (antes del build)
RUN npx prisma generate

RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Evitar que el postinstall (prisma generate) se ejecute aquí
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package*.json ./
RUN npm ci --omit=dev

# Copiar dist y prisma client desde el builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "dist/main"]
