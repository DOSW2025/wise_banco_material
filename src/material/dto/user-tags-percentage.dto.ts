import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para un tag con su porcentaje
 */
export class TagPercentageDto {
  @ApiProperty({
    description: 'Nombre del tag',
    example: 'Matemáticas',
  })
  tag: string;

  @ApiProperty({
    description: 'Porcentaje de uso de este tag en los materiales del usuario',
    example: 25.5,
  })
  porcentaje: number;
}

/**
 * DTO para la respuesta de tags y porcentajes de un usuario
 */
export class UserTagsPercentageDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Lista de tags con sus porcentajes (suma total = 100%)',
    type: TagPercentageDto,
    isArray: true,
  })
  tags: TagPercentageDto[];
}
