import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

  @ApiPropertyOptional({
    description: 'Tipo de material',
    example: 'PDF',
  })
  @IsOptional()
  @IsString()
  tipoMaterial?: string;

  @ApiPropertyOptional({
    description: 'Semestre del material',
    example: 5,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  semestre?: number;

  @ApiPropertyOptional({
    description: 'Calificación mínima del material',
    example: 4.0,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  calificacionMin?: number;

  @ApiPropertyOptional({
    description: 'Número de página (empezando en 1)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Tamaño de página (número de elementos por página)',
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  size?: number = 10;
}