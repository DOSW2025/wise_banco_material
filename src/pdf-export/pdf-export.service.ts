import { Injectable, Logger } from '@nestjs/common';
import { PassThrough } from 'stream';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { MaterialDto } from '../material/dto/material.dto';

@Injectable()
export class PdfExportService {
  private readonly logger = new Logger(PdfExportService.name);

  constructor() {}

  /**
   * Resuelve ruta de template soportando dev (src/) y build (dist/).
   */
  private resolveTemplatePath(): string {
    const candidates = [
      path.join(__dirname, 'templates', 'material-report.hbs'),
      path.join(process.cwd(), 'src', 'pdf-export', 'templates', 'material-report.hbs'),
      path.join(process.cwd(), 'dist', 'src', 'pdf-export', 'templates', 'material-report.hbs'),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      this.logger.error(`Template 'material-report.hbs' no encontrado. Tried: ${candidates.join(', ')}`);
      throw new Error('Template material-report.hbs no encontrado');
    }
    return found;
  }

  /**
   * Genera PDF a partir del template Handlebars y devuelve un stream para pipear.
   */
  async generateMaterialStatsPDF(
    stats: MaterialDto,
  ): Promise<{ stream: PassThrough; filename: string; contentType: string }> {

    // Validar que el template existe (se mantiene referencia solicitada)
    const templatePath = this.resolveTemplatePath();
    readFileSync(templatePath, 'utf8');

    const doc = new PDFDocument({ margin: 40 });
    const stream = new PassThrough();
    doc.pipe(stream);

    const formatDate = (date?: Date) =>
      date ? new Date(date).toLocaleString('es-CO') : 'N/D';

    const addSectionTitle = (title: string) => {
      doc.moveDown(0.8);
      doc.fontSize(16).fillColor('#003366').text(title, { underline: true });
      doc.moveDown(0.3);
    };

    const addKeyValue = (label: string, value: string | number | null | undefined) => {
      doc.fontSize(11).fillColor('#000000').text(`${label}: `, { continued: true });
      doc.fillColor('#333333').text(`${value ?? 'N/D'}`);
    };

    // Header
    doc.fontSize(20).fillColor('#003366').text('Reporte de Material', { align: 'center' });
    doc.fontSize(12).fillColor('#555555').text('Informe generado automáticamente por ECIWISE+', {
      align: 'center',
    });
    doc.moveDown();

    // Información general
    addSectionTitle('Información General');
    addKeyValue('ID', stats.id);
    addKeyValue('Nombre', stats.nombre);
    addKeyValue('Estudiante', stats.userName);
    addKeyValue('Descripción', stats.descripcion || 'N/D');
    addKeyValue('URL', stats.url);
    addKeyValue('Creado', formatDate(stats.createdAt));
    addKeyValue('Última actualización', formatDate(stats.updatedAt));

    // Estadísticas
    addSectionTitle('Estadísticas del Material');
    addKeyValue('Vistas', stats.vistos ?? 0);
    addKeyValue('Descargas', stats.descargas ?? 0);
    addKeyValue('Calificación Promedio', stats.calificacionPromedio ?? 0);
    addKeyValue('Total Comentarios', stats.totalComentarios ?? 0);

    // Etiquetas
    addSectionTitle('Etiquetas');
    if (stats.tags && stats.tags.length > 0) {
      stats.tags.forEach((tag) => doc.fontSize(11).fillColor('#003366').text(`• ${tag}`));
    } else {
      doc.fontSize(11).fillColor('#777777').text('No hay etiquetas asociadas');
    }

    // Footer
    doc.moveDown();
    doc.fontSize(10).fillColor('#777777').text(
      `ECIWISE+ — Plataforma de Aprendizaje Colaborativo — ${new Date().getFullYear()}`,
      { align: 'center' },
    );

    doc.end();

    return {
      stream,
      filename: `material-stats-${stats.id}.pdf`,
      contentType: 'application/pdf',
    };
  }
}