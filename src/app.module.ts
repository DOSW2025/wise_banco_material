import { Module } from '@nestjs/common';
import { MaterialModule } from './material/material.module';
import { PrismaModule } from './prisma/prisma.module';
import { PdfExportModule } from './pdf-export/pdf-export.module';

@Module({
  imports: [MaterialModule,PrismaModule,PdfExportModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
