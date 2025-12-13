import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para estadísticas agregadas de todos los materiales de un usuario
 */
export class UserMaterialsStatsDto {
  @ApiProperty({
    description: 'ID del usuario propietario de los materiales',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Promedio de calificaciones de todos los materiales del usuario',
    example: 4.2,
  })
  calificacionPromedio: number;

  @ApiProperty({
    description: 'Total de calificaciones registradas en todos los materiales del usuario',
    example: 15,
  })
  totalCalificaciones: number;

  @ApiProperty({
    description: 'Total de descargas de todos los materiales del usuario',
    example: 128,
  })
  totalDescargas: number;

  @ApiProperty({
    description: 'Total de vistas de todos los materiales del usuario',
    example: 456,
  })
  totalVistas: number;
}
