import { ApiProperty } from '@nestjs/swagger';
import { MaterialRankingDto } from './top-materials.dto';

/**
 * DTO para respuesta de top materiales del usuario (ordenados por popularidad)
 */
export class UserTopMaterialsDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Total de materiales del usuario',
    example: 10,
  })
  totalMateriales: number;

  @ApiProperty({
    description: 'Materiales del usuario ordenados por popularidad (descargas DESC, luego vistas DESC)',
    type: MaterialRankingDto,
    isArray: true,
  })
  materiales: MaterialRankingDto[];
}
