import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Body,
  Logger,
  Get,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaterialService } from './material.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { MaterialListItemDto } from './dto/material-list-item.dto';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';

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
   * Reglas de validación:
   * - El archivo es obligatorio y debe venir en el campo `file`.
   * - El archivo debe ser de tipo `application/pdf`.
   * - El campo `userId` es obligatorio en el cuerpo de la petición.
   * - Opcionalmente puede venir una `descripcion` del material.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
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
        userId: {
          type: 'string',
          description: 'ID del usuario al que se asocia el material.',
          example: 'user-123',
        },
        descripcion: {
          type: 'string',
          description: 'Descripción opcional del material.',
          example: 'Apuntes de cálculo para primer parcial.',
          nullable: true,
        },
      },
      required: ['file', 'userId'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Material subido y registrado correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Petición inválida. Puede deberse a falta de archivo, tipo de archivo incorrecto o ausencia de userId.',
  })
  async subirNuevoMaterial(
    @UploadedFile() file: any,
    @Body() body: { userId: string; descripcion?: string },
  ) {
    // Validación: debe enviarse un archivo
    if (!file) {
      throw new BadRequestException('Archivo PDF requerido en el campo "file"');
    }

    // Validación: mimetype debe ser PDF
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }

    // Validación: userId es obligatorio
    if (!body?.userId) {
      throw new BadRequestException('Campo "userId" es requerido');
    }

    // Validación de existencia del usuario (opcional: descomentarlo si ya tienes la tabla/relación correcta)
    // if ((await this.prisma.usuarios.findUnique({ where: { id: body.userId } })) == null) {
    //   throw new BadRequestException(`El userId ${body.userId} no existe en la base de datos`);
    // }

    this.logger.log(
      `Recibido archivo '${file.originalname}' de tamaño ${file.size} bytes para el usuario ${body.userId}, iniciando validación...`,
    );

    // Pasamos al servicio el buffer del archivo, el nombre original, el userId y la descripción opcional
    const result = await this.materialService.validateMaterial(
      file.buffer,
      file.originalname,
      body.userId,
      body.descripcion,
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
    description: 'El usuario no existe.',
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
    type: MaterialListItemDto,
    isArray: true,
  })
  async getPopularMaterials(): Promise<MaterialListItemDto[]> {
    // top 10 fijo temporal
    return this.materialService.getPopularMaterials(10);
  }
}
