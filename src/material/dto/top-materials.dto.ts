import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para un material en el ranking (top descargados/vistos)
 */
export class MaterialRankingDto {
  @ApiProperty({
    description: 'ID del material',
    example: 'mat-1',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre/título del material',
    example: 'Introducción a Cálculo Diferencial',
  })
  nombre: string;

  @ApiProperty({
    description: 'Total de descargas del material',
    example: 42,
  })
  descargas: number;

  @ApiProperty({
    description: 'Total de vistas del material',
    example: 156,
  })
  vistos: number;

  @ApiProperty({
    description: 'Calificación promedio del material',
    example: 4.5,
  })
  calificacionPromedio: number;
}

/**
 * DTO para respuesta de top materiales descargados del usuario
 */
export class TopDownloadedMaterialsDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Top 3 materiales más descargados del usuario',
    type: MaterialRankingDto,
    isArray: true,
  })
  topDownloaded: MaterialRankingDto[];
}

/**
 * DTO para respuesta de top materiales vistos del usuario
 */
export class TopViewedMaterialsDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Top 3 materiales más vistos del usuario',
    type: MaterialRankingDto,
    isArray: true,
  })
  topViewed: MaterialRankingDto[];
}
