import { Module } from '@nestjs/common';
import { ServiceBusClient } from '@azure/service-bus';
import { envs } from 'src/config/env';
import { IAListener } from './ia-listener.service';

@Module({
  providers: [
    IAListener,
    {
      provide: ServiceBusClient,
      useFactory: () => new ServiceBusClient(envs.serviceBusConnectionString),
    },
  ],
})
export class IaListenerModule {}
