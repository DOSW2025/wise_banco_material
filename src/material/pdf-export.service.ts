import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException, Body, Logger, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaterialService } from './material.service';
import { PrismaService } from '../prisma/prisma.service';
import { Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { MaterialListItemDto } from './dto/material-list-item.dto';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { MaterialStatsDto } from './dto/material-stats.dto';
import { PdfExportService } from './pdf-export.service';
import { Response } from 'express';


@Controller('material')
export class MaterialController {
  private readonly logger = new Logger(MaterialController.name);
  constructor(
    private readonly materialService: MaterialService,
    private readonly pdfExportService: PdfExportService,
    private prisma: PrismaService
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async subirNuevoMaterial(
    @UploadedFile() file: any, 
    @Body() body: { userId: string; descripcion?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Archivo PDF requerido en el campo "file"');
    }

    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }

    if (!body?.userId) {
      throw new BadRequestException('Campo "userId" es requerido');
    }

    // if ((await this.prisma.usuarios.findUnique({where:{id:body.userId}}))==null){
    //   throw new BadRequestException(`El userId ${body.userId} no existe en la base de datos`);
    // }

    this.logger.log(`Recibido archivo '${file.originalname}' de tamaño ${file.size} bytes para el usuario ${body.userId}, iniciando validación...`);
    // Pasamos también el nombre original del archivo, userId y descripción opcional
    const result = await this.materialService.validateMaterial(file.buffer,file.originalname,body.userId,body.descripcion);

    return result;
  }
  
  @Get('user/:userId')
  @ApiOperation({
    summary: 'Obtener materiales de un usuario',
    description:
      'Retorna la biblioteca de materiales del usuario indicada, junto con estadísticas globales (totalVistas, totalDescargas, calificacionPromedio).',
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
  async getMaterialsByUser(
    @Param('userId') userId: string,
  ): Promise<UserMaterialsResponseDto> {
    return this.materialService.getMaterialsByUserWithStats(userId);
  }

  @Get('stats/popular')
  @ApiOperation({
    summary: 'Obtener materiales populares',
    description:
      'Devuelve el ranking de materiales más descargados y vistos en el sistema.',
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


}