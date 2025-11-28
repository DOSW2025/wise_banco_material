import { Module , Global} from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo global que expone PrismaService en toda la aplicación.
 * Marca el módulo como global para evitar múltiples importaciones explícitas.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}