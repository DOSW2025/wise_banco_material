import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  /** Logger interno del servicio para registrar eventos de conexión */
  private logger = new Logger('PrismaService');

  /**
   * Ejecutado automáticamente al iniciar el módulo.
   * Establece la conexión con la base de datos usando Prisma Client.
   */
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Conexión a la base de datos establecida.');
    } catch (error) {
      this.logger.error('Error al conectar a la base de datos', error);
      throw error;
    }
  }
}
