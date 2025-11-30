import { ApiProperty } from '@nestjs/swagger';

export class MaterialDto {
  @ApiProperty({ description: 'Identificador del material' })
  id: string;

  @ApiProperty({ description: 'Nombre del material' })
  nombre: string;

  @ApiProperty({ description: 'ID del usuario propietario del material' })
  userId: string;

  @ApiProperty({
    description: 'URL del archivo almacenado en el blob storage',
  })
  url: string;

  @ApiProperty({
    description: 'Descripción opcional del material',
    required: false,
    nullable: true,
  })
  descripcion?: string | null;

  @ApiProperty({ description: 'Número de vistas del material', example: 5 })
  vistos: number;

  @ApiProperty({ description: 'Número de descargas del material', example: 2 })
  descargas: number;

  @ApiProperty({ description: 'Fecha de creación del material' })
  createdAt: Date;

  @ApiProperty({ description: 'Fecha de última actualización del material' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Etiquetas asociadas al material',
    type: [String],
    required: false,
  })
  tags?: string[];

  @ApiProperty({
    description: 'Calificación promedio del material (1-5)',
    required: false,
    example: 4.5,
  })
  calificacionPromedio?: number;
}
