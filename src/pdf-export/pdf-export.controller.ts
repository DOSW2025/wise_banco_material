import { Controller, Logger, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PdfExportService } from './pdf-export.service';
import { MaterialService } from '../material/material.service';

@Controller('pdf-export')
export class PdfExportController {
  private readonly logger = new Logger(PdfExportController.name);

  constructor(
    private readonly pdfExportService: PdfExportService,
    private readonly materialService: MaterialService,
  ) {}

  @Get(':id/stats/export')
  async exportMaterialStatsToPDF(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Exportando PDF industrial para material ${id}`);

    const stats = await this.materialService.getMaterialStats(id);
    
    const pdf = await this.pdfExportService.generateMaterialStatsPDF(stats);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="material-stats-${stats.id}.pdf"`,
    );
    res.end(pdf);
  }
}
