import { ApiProperty } from '@nestjs/swagger';

export class MaterialStatsDto {
  @ApiProperty({
    description: 'ID del material',
    example: 'abc123-def456',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del material',
    example: 'Cálculo Diferencial - Guía de ejercicios',
  })
  nombre: string;

  @ApiProperty({
    description: 'Número total de descargas',
    example: 150,
  })
  descargas: number;

  @ApiProperty({
    description: 'Número total de vistas',
    example: 320,
  })
  vistos: number;

  @ApiProperty({
    description: 'Calificación promedio del material',
    example: 4.5,
    required: false,
  })
  calificacionPromedio?: number;

  @ApiProperty({
    description: 'Número total de comentarios',
    example: 12,
  })
  totalComentarios: number;

  @ApiProperty({
    description: 'Fecha de creación del material',
    example: '2025-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Tags asociados al material',
    example: ['matematicas', 'calculo', 'derivadas'],
    type: [String],
  })
  tags: string[];
}