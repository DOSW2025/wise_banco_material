import { Module } from '@nestjs/common';
import { MaterialService } from './material.service';
import { MaterialController } from './material.controller';
import { PdfExportService } from './pdf-export.service';
import { ServiceBusClient } from '@azure/service-bus';
import { envs } from 'src/config/env';

@Module({
  controllers: [MaterialController],
  providers: [
    MaterialService,
    PdfExportService,
    {
      provide: ServiceBusClient,
      useFactory: () => {
        return new ServiceBusClient(envs.serviceBusConnectionString);
      },
    },
  ],
})
export class MaterialModule {}
