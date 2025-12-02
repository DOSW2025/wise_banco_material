import {Controller,Post,UploadedFile,UseInterceptors,BadRequestException,Body,Logger,Get,Param, Query,UsePipes,ValidationPipe, Res, Req,} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaterialService } from './material.service';
import { PrismaService } from '../prisma/prisma.service';
import {ApiOperation,ApiParam,ApiResponse,ApiTags,ApiConsumes,ApiBody,} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { MaterialDto } from './dto/material.dto';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { CreateMaterialDto } from './dto/createMaterial.dto';
import { CreateMaterialResponseDto } from './dto/create-material-response.dto';
import { PdfExportService } from './pdf-export.service';
import { MaterialStatsDto } from './dto/material-stats.dto';
import type { Response } from 'express';

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
    private readonly pdfExportService: PdfExportService,
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
      body
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
  async getPopularMaterials(@Query('limit') limit?: number): Promise<MaterialDto[]> {
    // top 10 fijo temporal
    return this.materialService.getPopularMaterials(limit ?? 10);
  }

  /**
   * Endpoint para obtener estadísticas de un material específico.
   */
  @Get(':id/stats')
  @ApiOperation({
    summary: 'Obtener estadísticas de un material',
    description:
      'Retorna las estadísticas detalladas de un material específico: descargas, vistas, calificación promedio y comentarios.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del material',
    example: 'abc123-def456',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas del material obtenidas exitosamente.',
    type: MaterialStatsDto,
  })
  async getMaterialStats(@Param('id') id: string): Promise<MaterialStatsDto> {
    return this.materialService.getMaterialStats(id);
  }

  /**
   * Endpoint para exportar estadísticas de un material a PDF.
   */
  @Get(':id/stats/export')
  @ApiOperation({
    summary: 'Exportar estadísticas de un material a PDF',
    description:
      'Genera y descarga un PDF con las estadísticas detalladas del material.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del material',
    example: 'abc123-def456',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF generado exitosamente.',
  })
  async exportMaterialStatsToPDF(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Solicitando exportación PDF para material: ${id}`);
    
    // Obtener estadísticas del material
    const stats = await this.materialService.getMaterialStats(id);
    
    // Generar PDF
    const pdfBuffer = await this.pdfExportService.generateMaterialStatsPDF(stats);
    
    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="estadisticas-${stats.id}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Enviar el PDF
    res.send(pdfBuffer);
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
}