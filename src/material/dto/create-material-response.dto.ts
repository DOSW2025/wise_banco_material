import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para respuesta exitosa al crear un material
 */
export class CreateMaterialResponseDto {
  @ApiProperty({
    description: 'ID unico del material',
    example: 'abc123-def456-ghi789',
  })
  id: string;

  @ApiProperty({
    description: 'Titulo del material',
    example: 'Introduccion a Calculo Diferencial',
  })
  title: string;

  @ApiProperty({
    description: 'Descripcion del material',
    example: 'Material de estudio para primer parcial',
    nullable: true,
  })
  description?: string;

  @ApiProperty({
    description: 'Materia o tema del material',
    example: 'Matematicas',
  })
  subject: string;

  @ApiProperty({
    description: 'Nombre del archivo PDF',
    example: 'calculo-diferencial.pdf',
  })
  filename: string;

  @ApiProperty({
    description: 'URL del archivo en Azure Blob Storage',
    example: 'https://wisestorage.blob.core.windows.net/materials/abc123-file.pdf',
  })
  fileUrl: string;

  @ApiProperty({
    description: 'Fecha de creacion del material',
    example: '2025-11-30T10:30:00.000Z',
  })
  createdAt: Date;
}
