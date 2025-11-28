# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala todas las dependencias (incluidas las de desarrollo)
RUN npm ci

# Copia el código fuente y configuraciones
COPY . .

# Compila el proyecto NestJS
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala solo dependencias de producción
RUN npm ci --omit=dev

# Copia los archivos compilados desde el stage de build
COPY --from=builder /app/dist ./dist

# Expone el puerto 3000
EXPOSE 3000

# Comando por defecto
CMD ["node", "dist/main"]
