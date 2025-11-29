import { Module } from '@nestjs/common';
import { MaterialModule } from './material/material.module';
import { IaListenerModule } from './simula-ia/ia-listener.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [MaterialModule, IaListenerModule, PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
