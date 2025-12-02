import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchMaterialsDto {
  @ApiPropertyOptional({
    description: 'Palabra clave para buscar en título y descripción',
    example: 'Programacion orientada a objetos',
  })
  @IsOptional()
  @IsString()
  palabraClave?: string;

  @ApiPropertyOptional({
    description: 'Materia o tag del material',
    example: 'DOPO',
  })
  @IsOptional()
  @IsString()
  materia?: string;

  @ApiPropertyOptional({
    description: 'ID del autor (usuario que subió el material)',
    example: 'Carlos',
  })
  @IsOptional()
  @IsString()
  autor?: string;
}