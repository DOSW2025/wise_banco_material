# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copia archivos de dependencias
COPY package*.json ./

# Instala TODAS las dependencias (incluye prisma y devDeps)
RUN npm ci

# Copia el código fuente y configuraciones
COPY . .

# Genera Prisma Client
RUN npx prisma generate

# Compila el proyecto
RUN npm run build


# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copia solo package.json para deps de producción
COPY package*.json ./

# Instala solo dependencias de producción
RUN npm ci --omit=dev

# Copia Prisma Client generado en el builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copia archivos compilados
COPY --from=builder /app/dist ./dist

# Si usas seed, opcional
# COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/main.js"]
