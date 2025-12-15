import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para un tag con su porcentaje
 */
export class TagPercentageItemDto {
  @ApiProperty({
    description: 'Nombre del tag',
    example: 'Matemáticas',
  })
  tag: string;

  @ApiProperty({
    description: 'Porcentaje de uso de este tag en todos los materiales del sistema',
    example: 25.5,
  })
  porcentaje: number;

  @ApiProperty({
    description: 'Cantidad de veces que se usa este tag',
    example: 50,
  })
  cantidad: number;
}

/**
 * DTO para la respuesta de tags y porcentajes globales del sistema
 */
export class GlobalTagsPercentageDto {
  @ApiProperty({
    description: 'Total de tags únicos en el sistema',
    example: 12,
  })
  totalTags: number;

  @ApiProperty({
    description: 'Total de asociaciones tag-material en el sistema',
    example: 200,
  })
  totalAsociaciones: number;

  @ApiProperty({
    description: 'Lista de tags con sus porcentajes y cantidades',
    type: TagPercentageItemDto,
    isArray: true,
  })
  tags: TagPercentageItemDto[];
}
