import { ApiProperty } from '@nestjs/swagger';

export class AutocompleteItemDto {
  @ApiProperty({ example: 'mat-123' })
  id: string;

  @ApiProperty({ example: 'Álgebra Lineal I' })
  titulo: string;

  @ApiProperty({
    example: 'Juan Pérez',
    nullable: true,
  })
  autor: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Materia (no disponible en esta versión del sistema)',
  })
  materia: string | null;

  @ApiProperty({
    example: 4.5,
    nullable: true,
  })
  calificacionPromedio: number | null;

  @ApiProperty({
    example: 15,
  })
  descargas: number;
}
