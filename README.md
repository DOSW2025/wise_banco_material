# Wise Banco Material - Microservicio Backend

## Descripción
Repositorio digital colaborativo donde los usuarios pueden almacenar, buscar y calificar materiales de apoyo académico organizados por asignaturas, semestres y temas específicos.

## Tecnologías

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)
![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Azure DevOps](https://img.shields.io/badge/Azure_DevOps-0078D4?style=for-the-badge&logo=azure-devops&logoColor=white)
![Azure](https://img.shields.io/badge/Microsoft_Azure-0089D0?style=for-the-badge&logo=microsoft-azure&logoColor=white)

- **Lenguaje**: TypeScript
- **Framework**: NestJS
- **Entorno**: Node.js 18+
- **Documentación**: Swagger/OpenAPI
- **Testing**: Jest
- **Contenedorización**: Docker
- **CI/CD**: Azure DevOps
- **Despliegue**: Azure Container Instances

## Requisitos Previos
- Node.js 18 o superior
- npm o yarn
- Docker (opcional, para contenedorización)

## Instalación

### 1. Clonar el repositorio
```bash
git clone <repository-url>
cd wise_banco_material
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env
```

Editar el archivo `.env` con tus configuraciones:
```env
# Application
NODE_ENV=development
PORT=3000

# Database
DB_CONNECTION_STRING=your-database-connection-string

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads
```

### 4. Configurar base de datos
```bash
# La configuración de base de datos se definirá posteriormente
# Editar .env con la cadena de conexión correspondiente
```

## Ejecución

### Desarrollo
```bash
# Modo desarrollo con hot reload
npm run start:dev

# Modo debug
npm run start:debug
```

### Producción
```bash
# Compilar
npm run build

# Ejecutar
npm run start:prod
```

## Testing

```bash
# Tests unitarios
npm run test

# Tests con watch mode
npm run test:watch

# Tests con coverage
npm run test:cov

# Tests e2e
npm run test:e2e
```

## Linting y Formateo

```bash
# Linting
npm run lint

# Formateo de código
npm run format
```

## Docker

### Construir imagen
```bash
npm run docker:build
```

### Ejecutar contenedor
```bash
npm run docker:run
```

### Docker Compose (recomendado para desarrollo)
```bash
# Crear docker-compose.yml para desarrollo local
docker-compose up -d
```

## Documentación API
Una vez ejecutada la aplicación, la documentación Swagger estará disponible en:
```
http://localhost:3000/api
```

## Estructura del Proyecto
```
src/
├── common/           # Utilidades compartidas
│   ├── decorators/   # Decoradores personalizados
│   ├── guards/       # Guards personalizados
│   ├── interceptors/ # Interceptores
│   └── dto/          # DTOs compartidos
├── config/           # Configuraciones
├── modules/          # Módulos de la aplicación
│   ├── users/        # Gestión de usuarios
│   └── materials/    # Gestión de materiales
├── app.module.ts     # Módulo principal
└── main.ts           # Punto de entrada
```

## Funcionalidades Principales
- ✅ Carga de materiales (PDF, Word, imágenes, videos)
- ✅ Organización por curso, docente, semestre
- ✅ Filtros de búsqueda avanzada
- ✅ Sistema de calificación y popularidad
- ✅ Prevención de duplicados
- ✅ Control de versiones
- ✅ Registro de actividad de usuarios
- ✅ Moderación automática de contenido

## SonarCloud

### Configuración
1. Crear proyecto en SonarCloud
2. Configurar `sonar-project.properties` con tu organización
3. Agregar SonarCloud service connection en Azure DevOps
4. El pipeline ejecutará automáticamente el análisis

## CI/CD y Despliegue

### Azure DevOps Pipeline
El proyecto usa **Azure DevOps** para CI/CD, no GitHub Actions.

### Configuración del Pipeline
1. Crear proyecto en Azure DevOps
2. Conectar el repositorio de código
3. Configurar el archivo `azure-pipelines.yml` (ya incluido)
4. Configurar service connections:
   - Azure Container Registry
   - SonarCloud
   - Azure Subscription
5. Configurar variables de entorno en Azure DevOps

### Variables de Entorno en Azure
- `DB_CONNECTION_STRING`: Cadena de conexión a la base de datos
- Otras variables según `.env.example`

## Contribución
1. Fork del proyecto
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## Scripts Disponibles
- `npm run build` - Compilar el proyecto
- `npm run start` - Ejecutar en modo producción
- `npm run start:dev` - Ejecutar en modo desarrollo
- `npm run start:debug` - Ejecutar en modo debug
- `npm run test` - Ejecutar tests
- `npm run test:watch` - Tests en modo watch
- `npm run test:cov` - Tests con coverage
- `npm run test:e2e` - Tests end-to-end
- `npm run lint` - Linting del código
- `npm run format` - Formatear código

## Información de Base de Datos
La configuración de base de datos se definirá en las siguientes iteraciones del proyecto.
Por el momento, configurar la variable `DB_CONNECTION_STRING` en el archivo `.env`.

## Soporte
Para soporte técnico o preguntas sobre el proyecto, contactar al equipo de desarrollo.