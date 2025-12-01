import { Module } from '@nestjs/common';
import { MaterialModule } from './material/material.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [MaterialModule,PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
