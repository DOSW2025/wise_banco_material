import { ApiProperty } from '@nestjs/swagger';
import { MaterialDto } from './material.dto';

export class UserMaterialsResponseDto {
  @ApiProperty({
    description: 'Listado de materiales asociados al usuario',
    type: [MaterialDto],
  })
  materials: MaterialDto[];

  @ApiProperty({
    description: 'Total de vistas sumadas de todos los materiales del usuario',
    example: 120,
  })
  totalVistas: number;

  @ApiProperty({
    description: 'Total de descargas sumadas de todos los materiales del usuario',
    example: 45,
  })
  totalDescargas: number;

  @ApiProperty({
    description:
      'Calificación promedio global de los materiales del usuario (1-5). ' +
      'Si no hay calificaciones, puede ser null.',
    example: 4.2,
    nullable: true,
  })
  calificacionPromedio: number | null;
}
