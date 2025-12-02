import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { MaterialStatsDto } from './dto/material-stats.dto';

@Injectable()
export class PdfExportService {
  private readonly logger = new Logger(PdfExportService.name);

  /**
   * Genera un PDF con las estadísticas del material
   */
  async generateMaterialStatsPDF(stats: MaterialStatsDto): Promise<Buffer> {
    this.logger.log(`Generando PDF para material: ${stats.id}`);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];

        // Capturar los chunks del PDF
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // === ENCABEZADO ===
        doc
          .fontSize(24)
          .fillColor('#2c3e50')
          .text('Estadísticas del Material', { align: 'center' })
          .moveDown(0.5);

        doc
          .fontSize(10)
          .fillColor('#7f8c8d')
          .text(`Generado el: ${new Date().toLocaleDateString('es-CO')}`, {
            align: 'center',
          })
          .moveDown(2);

        // === INFORMACIÓN BÁSICA ===
        this.addSection(doc, 'Información General');

        this.addInfoRow(doc, 'ID del Material:', stats.id);
        this.addInfoRow(doc, 'Nombre:', stats.nombre);
        this.addInfoRow(
          doc,
          'Fecha de Creación:',
          new Date(stats.createdAt).toLocaleDateString('es-CO'),
        );

        doc.moveDown(1);

        // === ESTADÍSTICAS ===
        this.addSection(doc, 'Estadísticas de Uso');

        this.addStatCard(doc, 'Total de Descargas', stats.descargas, '#3498db');
        this.addStatCard(doc, 'Total de Vistas', stats.vistos, '#2ecc71');
        this.addStatCard(doc, 'Total de Comentarios', stats.totalComentarios, '#e74c3c');

        if (stats.calificacionPromedio !== undefined) {
          this.addStatCard(
            doc,
            'Calificación Promedio',
            `${stats.calificacionPromedio.toFixed(1)} / 5`,
            '#f39c12',
          );
        }

        doc.moveDown(1);

        // === TAGS ===
        if (stats.tags && stats.tags.length > 0) {
          this.addSection(doc, 'Etiquetas');
          doc
            .fontSize(12)
            .fillColor('#34495e')
            .text(stats.tags.join(', '), { indent: 20 });
        }

        // === PIE DE PÁGINA ===
        doc.moveDown(2);
        doc
          .fontSize(8)
          .fillColor('#95a5a6')
          .text(
            'ECIWISE+ - Plataforma de Aprendizaje Colaborativo',
            50,
            doc.page.height - 50,
            { align: 'center' },
          );

        // Finalizar el documento
        doc.end();
      } catch (error) {
        this.logger.error('Error generando PDF:', error);
        reject(error);
      }
    });
  }

  /**
   * Agrega un título de sección al PDF
   */
  private addSection(doc: PDFKit.PDFDocument, title: string) {
    doc
      .fontSize(16)
      .fillColor('#2c3e50')
      .text(title, { underline: true })
      .moveDown(0.5);
  }

  /**
   * Agrega una fila de información (clave: valor)
   */
  private addInfoRow(doc: PDFKit.PDFDocument, label: string, value: string) {
    doc
      .fontSize(12)
      .fillColor('#34495e')
      .text(label, { continued: true, indent: 20 })
      .fillColor('#7f8c8d')
      .text(` ${value}`)
      .moveDown(0.3);
  }

  /**
   * Agrega una tarjeta de estadística con color
   */
  private addStatCard(
    doc: PDFKit.PDFDocument,
    label: string,
    value: number | string,
    color: string,
  ) {
    const y = doc.y;

    // Rectángulo de fondo
    doc
      .rect(50, y, 500, 40)
      .fillAndStroke('#f8f9fa', '#dee2e6');

    // Etiqueta
    doc
      .fillColor('#34495e')
      .fontSize(11)
      .text(label, 60, y + 10, { width: 300 });

    // Valor con color
    doc
      .fillColor(color)
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(String(value), 350, y + 8, { width: 180, align: 'right' })
      .font('Helvetica');

    doc.moveDown(0.8);
  }
}