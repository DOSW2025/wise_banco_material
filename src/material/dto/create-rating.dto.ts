import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @ApiProperty({
    description: 'Calificación numérica (1 a 5)',
    minimum: 1,
    maximum: 5,
    example: 4,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({
    description: 'Comentario opcional sobre el material',
    required: false,
    nullable: true,
    example: 'Muy útil y bien explicado',
  })
  @IsOptional()
  @IsString()
  comentario?: string | null;

  @ApiProperty({
    description: 'ID del usuario que califica el material',
    example: 'user-123',
  })
  @IsString()
  userId: string;
}
