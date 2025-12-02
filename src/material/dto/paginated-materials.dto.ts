import { ApiProperty } from '@nestjs/swagger';
import { MaterialDto } from './material.dto';

export class PaginatedMaterialsDto {
  @ApiProperty({
    description: 'Lista de materiales',
    type: [MaterialDto],
  })
  materials: MaterialDto[];

  @ApiProperty({
    description: 'Número total de materiales',
    example: 150,
  })
  total: number;

  @ApiProperty({
    description: 'Página actual',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Tamaño de página',
    example: 10,
  })
  size: number;

  @ApiProperty({
    description: 'Número total de páginas',
    example: 15,
  })
  totalPages: number;
}