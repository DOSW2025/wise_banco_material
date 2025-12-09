import { Injectable, Logger } from '@nestjs/common';
import { PassThrough } from 'stream';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
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
    this.logger.log(`Generando PDF industrial para material ${stats.id}`);

    const templatePath = this.resolveTemplatePath();
    const htmlTemplate = readFileSync(templatePath, 'utf8');
    const compiled = Handlebars.compile(htmlTemplate);

    const html = compiled({
      ...stats,
      createdAt: stats.createdAt ? new Date(stats.createdAt).toLocaleString('es-CO') : 'N/D',
      updatedAt: stats.updatedAt ? new Date(stats.updatedAt).toLocaleString('es-CO') : 'N/D',
      year: new Date().getFullYear(),
    });

    const executablePath = puppeteer.executablePath();
    if (!executablePath || !existsSync(executablePath)) {
      this.logger.error('Chromium no encontrado. Asegúrate de ejecutar "npx puppeteer browsers install chrome" durante el build/postinstall.');
      throw new Error('Chromium no encontrado para generar PDFs');
    }

    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '40px', bottom: '40px', left: '30px', right: '30px' },
    });

    await browser.close();

    const stream = new PassThrough();
    stream.end(pdfBuffer);

    return {
      stream,
      filename: `material-stats-${stats.id}.pdf`,
      contentType: 'application/pdf',
    };
  }
}