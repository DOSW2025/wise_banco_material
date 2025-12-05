import {Controller,Post,UploadedFile,UseInterceptors,BadRequestException,Body,Logger,Get,Param, Query,UsePipes,ValidationPipe, Res, Req,Put} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaterialService } from './material.service';
import { PrismaService } from '../prisma/prisma.service';
import {ApiOperation,ApiParam,ApiResponse,ApiTags,ApiConsumes,ApiBody,ApiQuery} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { MaterialDto } from './dto/material.dto';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { CreateMaterialDto } from './dto/createMaterial.dto';
import { CreateMaterialResponseDto } from './dto/create-material-response.dto';
import { DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { CreateRatingDto } from './dto/create-rating.dto';
import { RateMaterialResponseDto } from './dto/rate-material-response.dto';
import { SearchMaterialsDto } from './dto/search-materials.dto';
import { PaginatedMaterialsDto } from './dto/paginated-materials.dto';
import { AutocompleteResponseDto } from './dto/autocomplete-response.dto';
import { GetMaterialRatingsResponseDto } from './dto/get-material-ratings.dto';

/**
 * Controlador para la gestión de materiales (PDF) en el sistema.
 *
 * Expone endpoints para:
 * - Subir un nuevo material en formato PDF.
 * - Obtener materiales de un usuario con estadísticas.
 * - Consultar los materiales más populares del sistema.
 */
@ApiTags('Material')
@Controller('material')
export class MaterialController {
  private readonly logger = new Logger(MaterialController.name);

  constructor(
    private readonly materialService: MaterialService,
    private prisma: PrismaService,
  ) {}

  /**
   * Endpoint para subir un nuevo material en formato PDF.
   *
   * Reglas de validacion:
   * - title: obligatorio, minimo 3 caracteres
   * - description: opcional, maximo 300 caracteres
   * - subject: obligatorio
   * - file: obligatorio, tipo PDF
   * - userId: obligatorio y debe existir en la tabla User
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: 'Subir un nuevo material PDF',
    description:
      'Permite subir un archivo PDF asociado a un usuario. El archivo debe enviarse en el campo `file` (multipart/form-data).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Datos para subir un nuevo material. Incluye el archivo PDF y la información del usuario.',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo PDF a subir (campo `file`).',
        },
        title: {
          type: 'string',
          description: 'Titulo del material (minimo 3 caracteres).',
          example: 'Introduccion a Calculo Diferencial',
          minLength: 3,
        },
        description: {
          type: 'string',
          description: 'Descripcion opcional del material (maximo 300 caracteres).',
          example: 'Material de estudio para primer parcial',
          maxLength: 300,
          nullable: true,
        },
        subject: {
          type: 'string',
          description: 'Materia o tema del material.',
          example: 'Matematicas',
        },
        userId: {
          type: 'string',
          description: 'ID del usuario al que se asocia el material.',
          example: 'user-123',
        },
      },
      required: ['file', 'title', 'subject', 'userId'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Material subido y registrado correctamente.',
    type: CreateMaterialResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validacion fallida. Campos invalidos o archivo no es PDF.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Material ya existe con el mismo contenido.',
  })
  @ApiResponse({
    status: 422,
    description:
      'PDF fallo la validacion automatizada de IA.',
  })
  async subirNuevoMaterial(
    @UploadedFile() file: any,
    @Body() body: CreateMaterialDto,
  ): Promise<CreateMaterialResponseDto> {
    // Validacion: debe enviarse un archivo
    if (!file) {
      throw new BadRequestException(
        'Archivo PDF requerido en el campo "file"',
      );
    }

    // Validación: mimetype debe ser PDF
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }

    // Validacion: userId debe existir en la base de datos
    const userExists = await this.prisma.usuarios.findUnique({ 
      where: { id: body.userId } 
    });
    if (!userExists) {
      throw new BadRequestException(`El userId ${body.userId} no existe en la base de datos`);
    }

    this.logger.log(`Archivo '${file.originalname}' de tamaño ${file.size} bytes para el usuario ${body.userId}`,);

    // Pasar al servicio el buffer del archivo y metadata validada
    const result = await this.materialService.validateMaterial(
      file.buffer,
      body,
      file.originalname,
    );

    return result;
  }

  /**
   * Endpoint para obtener los materiales de un usuario junto con estadísticas básicas.
   *
   * Retorna:
   * - Listado de materiales del usuario.
   * - Estadísticas agregadas: total de vistas, descargas y calificación promedio.
   */
  @Get('user/:userId')
  @ApiOperation({
    summary: 'Obtener materiales de un usuario',
    description:
      'Retorna la biblioteca de materiales del usuario indicado, junto con estadísticas globales (totalVistas, totalDescargas, calificacionPromedio).',
  })
  @ApiParam({
    name: 'userId',
    description: 'ID del usuario propietario de los materiales',
    example: 'user-123',
  })
  @ApiResponse({
    status: 200,
    description:
      'Listado de materiales del usuario y estadísticas básicas asociadas.',
    type: UserMaterialsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'El usuario no existe o no tiene materiales registrados.',
  })
  async getMaterialsByUser(
    @Param('userId') userId: string,
  ): Promise<UserMaterialsResponseDto> {
    return this.materialService.getMaterialsByUserWithStats(userId);
  }

  /**
   * Endpoint para obtener los materiales más populares del sistema.
   *
   * La popularidad se mide según vistas/descargas (la lógica exacta está en el servicio).
   * Actualmente devuelve el top 10 de materiales.
   */
  @Get('stats/popular')
  @ApiOperation({
    summary: 'Obtener materiales populares',
    description:
      'Devuelve el ranking de materiales más descargados y vistos en el sistema. Actualmente retorna el top 10.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de materiales ordenados por popularidad.',
    type: MaterialDto,
    isArray: true,
  })
  @ApiResponse({
  status: 400,
  description:
    'Parámetro `limit` inválido.',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor.',
  })
  async getPopularMaterials(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<MaterialDto[]> {
    return this.materialService.getPopularMaterials(limit);
  }
  /**
   * POST /api/material/:id/ratings
   *
   * Recibe:
   * - rating (1-5)
   * - comentario 
   * - userId 
   *
   */
  @Post(':id/ratings')
  @ApiOperation({
    summary: 'Registrar calificación para un material',
    description:
      'Permite registrar una calificación (1-5) y un comentario opcional para un material. ' +
      'Por ahora no se valida si el usuario ya visualizó o descargó el material.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del material a calificar',
    example: 'mat-1',
  })
  @ApiBody({ type: CreateRatingDto })
  @ApiResponse({
    status: 201,
    description: 'Calificación registrada y promedio actualizado.',
    type: RateMaterialResponseDto,
  })
  @ApiResponse({
  status: 400,
  description:
    'Datos inválidos.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Material o usuario no encontrado.',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor.',
  })
  async rateMaterial(
    @Param('id') materialId: string,
    @Body() body: CreateRatingDto,
  ): Promise<RateMaterialResponseDto> {
    const { userId, rating, comentario } = body;

    return this.materialService.rateMaterial(
      materialId,
      userId,
      rating,
      comentario,
    );
  }

  /**
   * Endpoint para obtener todas las calificaciones de un material.
   *
   * Retorna:
   * - Listado de todas las calificaciones del material
   * - Promedio de calificaciones
   * - Total de calificaciones
   */
  @Get(':id/ratings')
  @ApiOperation({
    summary: 'Obtener calificaciones de un material',
    description:
      'Retorna todas las calificaciones (ratings) registradas para un material específico, junto con el promedio y el total de calificaciones.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del material',
    example: 'mat-1',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de calificaciones y promedio del material.',
    type: GetMaterialRatingsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'El material no existe.',
  })
  async getMaterialRatings(
    @Param('id') materialId: string,
  ): Promise<GetMaterialRatingsResponseDto> {
    return this.materialService.getMaterialRatings(materialId);
  }

  /**
   * Endpoint para filtrar materiales con filtros avanzados y paginación.
   */
  @Get('filter')
  @ApiOperation({
    summary: 'Filtrar materiales con filtros avanzados',
    description:
      'Filtra materiales por palabra clave, materia, autor, tipo, semestre y calificación mínima con paginación.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de materiales que coinciden con los filtros.',
    type: PaginatedMaterialsDto,
  })
  async searchMaterials(@Query() filters: SearchMaterialsDto): Promise<PaginatedMaterialsDto> {
    const { materials, total } = await this.materialService.searchMaterials(
      filters.palabraClave,
      filters.materia,
      filters.autor,
      filters.tipoMaterial,
      filters.semestre,
      filters.calificacionMin,
      filters.page || 1,
      filters.size || 10,
    );

    return {
      materials,
      total,
      page: filters.page || 1,
      size: filters.size || 10,
      totalPages: Math.ceil(total / (filters.size || 10)),
    };
  }

  /**
   * Endpoint para descargar un material específico.
   *
   * Cumple con las siguientes reglas de negocio:
   * - RN-026-1: Incrementa el contador de descargas del material
   * - RN-026-3: Registra un evento de descarga en analytics vía RabbitMQ
   *
   * Operaciones:
   * 1. Valida que el material exista
   * 2. Incrementa el contador de descargas
   * 3. Registra el evento en analytics
   * 4. Retorna la URL del archivo para descargar
   *
   * @param materialId - ID del material a descargar
   * @param userId - ID del usuario que descarga (query parameter requerido)
   * @returns Objeto con la URL del archivo para descargar
   */
  @Get(':id/download')
  @ApiOperation({
    summary: 'Descargar un material',
    description:
      'Permite descargar un material específico. Incrementa automáticamente el contador de descargas y registra un evento en analytics.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del material a descargar',
  })
  @ApiOperation({
    summary: 'Incrementar vistas de material',
    description: 'Incrementa en 1 el contador de vistas del material especificado.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del material',
    example: 'material-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Descarga iniciada. Muestra opción para descargar el archivo.',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL del archivo para descargar',
          example: 'https://storage.blob.core.windows.net/materials/file.pdf',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Material no existe o parámetros inválidos.',
  })
  async downloadMaterial(@Param('id') materialId: string, @Res() res: Response, @Req() req: Request) {
    this.logger.log(`Solicitud de descarga del material ${materialId}`);
    
    // Solicitar stream y metadatos al servicio
    const { stream, contentType, filename } = await this.materialService.downloadMaterial(materialId);

    // Preparar cabeceras y pipear el stream al cliente
    res.setHeader('Content-Type', contentType);
    // Forzar descarga con nombre de archivo
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);

    // Manejar errores en el stream
    stream.on('error', (err) => {
      this.logger.error(`Error streaming file ${materialId}: ${err?.message ?? err}`);
      if (!res.headersSent) {
        res.status(500).send('Error descargando el archivo');
      } else {
        res.end();
      }
    });
    // Pipear el stream al response
    stream.pipe(res);
  }

  /**
  * Autocompletado de materiales.
  *
  * Busca coincidencias en título, descripción y autor,
  * retornando un máximo de 5 sugerencias ordenadas por relevancia.
  */
  @Get('autocomplete')
  @ApiOperation({
    summary: 'Autocompletado de búsqueda de materiales',
    description:
      'Busca en título, descripción y autor. Retorna hasta 5 sugerencias ordenadas por relevancia.',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Cadena ingresada por el usuario',
  })
  @ApiQuery({
    name: 'materia',
    required: false,
    description: 'Materia — no disponible actualmente',
  })
  @ApiQuery({
    name: 'autor',
    required: false,
    description: 'Filtro opcional por autor',
  })
  @ApiResponse({
    status: 200,
    type: AutocompleteResponseDto,
  })
  @ApiResponse({
  status: 400,
  description:
    'Parámetros inválidos. Ocurre, por ejemplo, si la palabra clave está vacía.',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor.',
  })
  async autocompleteMateriales(
    @Query('query') query: string,
    @Query('materia') materia?: string,
    @Query('autor') autor?: string,
  ): Promise<AutocompleteResponseDto> {
    return this.materialService.autocompleteMaterials(query, materia, autor);
  }

  /**
 * Endpoint para actualizar la versión de un material existente.
 * - Reemplaza el archivo PDF en Blob Storage.
 * - Actualiza la metadata del material y sus tags.
 */
@Put(':id')
@UseInterceptors(FileInterceptor('file'))
@UsePipes(new ValidationPipe({ transform: true }))
@ApiOperation({
  summary: 'Actualizar versión de un material',
  description:
    'Reemplaza el archivo PDF y actualiza la metadata de un material existente. ' +
    'El archivo debe enviarse en el campo `file` (multipart/form-data).',
})
@ApiConsumes('multipart/form-data')
@ApiParam({
  name: 'id',
  description: 'ID del material a actualizar',
  example: 'abc123-def456',
})
@ApiBody({
  description:
    'Datos para actualizar el material. Incluye el archivo PDF y la nueva metadata.',
  schema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'Nuevo archivo PDF a subir (campo `file`).',
      },
      title: {
        type: 'string',
        description: 'Nuevo título del material (mínimo 3 caracteres).',
        example: 'Introducción a Cálculo Diferencial - Versión 2',
        minLength: 3,
      },
      description: {
        type: 'string',
        description: 'Nueva descripción opcional del material (máximo 300 caracteres).',
        example: 'Versión actualizada del material de estudio para primer parcial',
        maxLength: 300,
        nullable: true,
      },
      subject: {
        type: 'string',
        description: 'Materia o tema del material.',
        example: 'Matemáticas',
      },
      userId: {
        type: 'string',
        description:
          'ID del usuario que realiza la actualización. No cambia la propiedad del material en BD.',
        example: 'user-123',
      },
    },
    required: ['file', 'title', 'subject', 'userId'],
  },
})
@ApiResponse({
  status: 200,
  description: 'Material actualizado correctamente.',
  type: CreateMaterialResponseDto,
})
@ApiResponse({
  status: 400,
  description: 'Validación fallida. Campos inválidos o archivo no es PDF.',
})
@ApiResponse({
  status: 404,
  description: 'Material no encontrado.',
})
@ApiResponse({
  status: 409,
  description: 'Otro material ya existe con el mismo contenido (hash duplicado).',
})
@ApiResponse({
  status: 422,
  description: 'PDF falló la validación automatizada de IA.',
})
async actualizarMaterialVersion(
  @Param('id') materialId: string,
  @UploadedFile() file: any,
  @Body() body: CreateMaterialDto,
): Promise<CreateMaterialResponseDto> {
  if (!file) {
    throw new BadRequestException(
      'Archivo PDF requerido en el campo "file"',
    );
  }

  if (file.mimetype !== 'application/pdf') {
    throw new BadRequestException('Solo se permiten archivos PDF');
  }

  this.logger.log(
    `Actualizando material ${materialId} con archivo '${file.originalname}' (userId=${body.userId})`,
  );

  return this.materialService.updateMaterialVersion(
    materialId,
    file.buffer,
    body,
    file.originalname,
  );
}
  
}
