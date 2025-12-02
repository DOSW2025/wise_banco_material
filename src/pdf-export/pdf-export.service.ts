import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { MaterialDto } from '../material/dto/material.dto';

@Injectable()
export class PdfExportService {
  private readonly logger = new Logger(PdfExportService.name);

  constructor() {}

  /**
   * Genera PDF cargando un template HTML
   */
  async generateMaterialStatsPDF(stats: MaterialDto): Promise<Buffer> {
    this.logger.log(`Generando PDF industrial para material ${stats.id}`);

    // Cargar template: buscar en varios lugares para soportar dev (src/) y build (dist/)
    const candidates = [
      path.join(__dirname, 'templates', 'material-report.hbs'),
      path.join(process.cwd(), 'src', 'pdf-export', 'templates', 'material-report.hbs'),
      path.join(process.cwd(), 'templates', 'material-report.hbs'),
    ];

    const templatePath = candidates.find((p) => existsSync(p));
    if (!templatePath) {
      this.logger.error(
        `Template 'material-stats-template.html' not found. Tried: ${candidates.join(', ')}`,
      );
      throw new Error(
        `Template 'material-stats-template.html' not found. Please place it under 'src/pdf-export/templates' or 'dist/src/pdf-export/templates' depending on runtime.`,
      );
    }

    const htmlTemplate = readFileSync(templatePath, 'utf8');
    const compiled = Handlebars.compile(htmlTemplate);
    
    const html = compiled({
      ...stats,
      createdAt: new Date(stats.createdAt).toLocaleDateString('es-CO'),
      updatedAt: new Date(stats.updatedAt).toLocaleDateString('es-CO'),
      year: new Date().getFullYear(),
    });

    // Renderizar con Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '40px',
        bottom: '40px',
        left: '30px',
        right: '30px',
      },
    });

    await browser.close();

    // Ensure we return a Node Buffer (page.pdf may return a Uint8Array)
    return Buffer.from(pdfBuffer);
  }
}
