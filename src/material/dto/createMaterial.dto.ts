import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional } from 'class-validator';

/**
 * DTO para crear un nuevo material.
 * Define las validaciones de metadata requeridas para el endpoint POST /material
 */
export class CreateMaterialDto {
  @ApiProperty({
    description: 'Titulo del material',
    example: 'Introduccion a Calculo Diferencial',
    minLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'title must be longer than or equal to 3 characters' })
  title: string;

  @ApiProperty({
    description: 'Descripcion del material',
    example: 'Material de estudio para primer parcial',
    maxLength: 300,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'description must be shorter than or equal to 300 characters' })
  description?: string;

  @ApiProperty({
    description: 'Materia o tema del material',
    example: 'Matematicas',
    required: false,
  })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({
    description: 'ID del usuario propietario del material',
    example: 'user-123',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;
}
