import {Controller,Logger,Get,Param, Res,} from '@nestjs/common';
import {ApiOperation,ApiParam,ApiResponse,ApiTags} from '@nestjs/swagger';
import type { Response} from 'express';
import { PdfExportService } from './pdf-export.service';
import { MaterialService } from '../material/material.service';


@ApiTags('PDF Export')
@Controller('pdf-export')
export class PdfExportController {
  private readonly logger = new Logger(PdfExportController.name);

  constructor(
    private readonly pdfExportService: PdfExportService,
    private readonly materialService: MaterialService,
  ) {}

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

}