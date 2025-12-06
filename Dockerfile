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

# Copiamos package.json y lock para instalar dependencias de producción
COPY package*.json ./

# Copiar otra vez Prisma → necesario porque postinstall corre aquí también
COPY prisma ./prisma

# Instalar solo dependencias necesarias para producción
RUN npm ci --omit=dev

# Copiar build generado en el stage anterior
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
