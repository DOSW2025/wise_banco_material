import { Module } from '@nestjs/common';
import { MaterialModule } from '../material/material.module';
import { PdfExportController } from './pdf-export.controller';
import { PdfExportService } from './pdf-export.service';

@Module({
  imports: [MaterialModule],
  controllers: [PdfExportController],
  providers: [PdfExportService],
  exports: [PdfExportService],
})
export class PdfExportModule {}
