import { ApiProperty } from '@nestjs/swagger';

export class MaterialsCountDto {
  @ApiProperty({
    description: 'Cantidad total de materiales en el sistema',
    example: 3,
  })
  Count: number;
}
