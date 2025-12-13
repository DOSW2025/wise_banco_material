import { ApiProperty } from '@nestjs/swagger';

export class MaterialRatingDto {
  @ApiProperty({
    description: 'ID de la calificación',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'Calificación numérica (1 a 5)',
    example: 5,
  })
  calificacion: number;

  @ApiProperty({
    description: 'Comentario opcional del usuario',
    required: false,
    nullable: true,
    example: 'Excelente material',
  })
  comentario?: string | null;

  @ApiProperty({
    description: 'Fecha de creación de la calificación',
    example: '2025-12-02T10:30:00Z',
  })
  createdAt: Date;
}

export class GetMaterialRatingsResponseDto {
  @ApiProperty({
    description: 'ID del material',
    example: 'mat-1',
  })
  materialId: string;

  @ApiProperty({
    description: 'Promedio de todas las calificaciones del material',
    example: 4.2,
  })
  calificacionPromedio: number;

  @ApiProperty({
    description: 'Total de calificaciones registradas',
    example: 10,
  })
  totalCalificaciones: number;

  @ApiProperty({
    description: 'Total de descargas del material',
    example: 42,
  })
  totalDescargas: number;

  @ApiProperty({
    description: 'Total de vistas del material',
    example: 156,
  })
  totalVistas: number;
}
