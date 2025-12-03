import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// Importamos desde @prisma/client (ubicación por defecto en node_modules)
// Antes usábamos '' pero causaba problemas con la compilación de NestJS
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // En Prisma 7, usamos un adapter específico para PostgreSQL
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}