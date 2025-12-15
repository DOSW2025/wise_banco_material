import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para la respuesta de calificación promedio de un usuario
 */
export class UserAverageRatingDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Calificación promedio de todos los materiales del usuario (escala 1-5)',
    example: 4.5,
    nullable: true,
  })
  calificacionPromedio: number | null;

  @ApiProperty({
    description: 'Total de calificaciones recibidas en todos los materiales del usuario',
    example: 25,
  })
  totalCalificaciones: number;

  @ApiProperty({
    description: 'Total de materiales que tiene el usuario',
    example: 10,
  })
  totalMateriales: number;
}
