# ---------- STAGE 1: Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copiamos únicamente package.json + lock para instalar dependencias rápido
COPY package*.json ./

# Copiar carpeta Prisma ANTES de instalar dependencias (postinstall necesita schema.prisma)
COPY prisma ./prisma

# Instalar TODAS las dependencias (incluidas dev)
RUN npm ci

# Copiar el resto del código
COPY . .

# Compilar NestJS
RUN npm run build


# ---------- STAGE 2: Production ----------
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema necesarias para Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Variables de entorno para Puppeteer en Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copiamos package.json y lock para instalar dependencias de producción
COPY package*.json ./

# Copiar otra vez Prisma → necesario porque postinstall corre aquí también
COPY prisma ./prisma

# Instalar solo dependencias necesarias para producción (sin ejecutar postinstall de Chromium)
RUN npm ci --omit=dev --ignore-scripts && \
    node node_modules/prisma/build/index.js generate

# Copiar build generado en el stage anterior
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
