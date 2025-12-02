import { ApiProperty } from '@nestjs/swagger';

export class RateMaterialResponseDto {
  @ApiProperty({
    description: 'ID del material calificado',
    example: 'mat-1',
  })
  materialId: string;

  @ApiProperty({
    description: 'Calificación registrada en esta operación',
    example: 5,
  })
  rating: number;

  @ApiProperty({
    description: 'Comentario enviado por el usuario (si aplica)',
    required: false,
    nullable: true,
    example: 'Excelente material',
  })
  comentario?: string | null;

  @ApiProperty({
    description: 'Promedio de calificaciones del material después de esta operación',
    example: 4.5,
  })
  calificacionPromedio: number;

  @ApiProperty({
    description: 'Total de calificaciones registradas para este material',
    example: 12,
  })
  totalCalificaciones: number;
}
