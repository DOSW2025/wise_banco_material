import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para la respuesta del endpoint GET /api/materials/:id
 * Retorna la información detallada de un material específico.
 */
export class MaterialDetailDto {
  @ApiProperty({
    description: 'Metadatos del material',
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Identificador único del material' },
      nombre: { type: 'string', description: 'Nombre del material' },
      descripcion: { type: 'string', description: 'Descripción del material', nullable: true },
      userId: { type: 'string', description: 'ID del usuario propietario' },
      userName: { type: 'string', description: 'Nombre del usuario propietario' },
      vistos: { type: 'number', description: 'Número de vistas' },
      descargas: { type: 'number', description: 'Número de descargas' },
      createdAt: { type: 'string', format: 'date-time', description: 'Fecha de creación' },
      updatedAt: { type: 'string', format: 'date-time', description: 'Fecha de actualización' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Etiquetas asociadas' },
    },
  })
  metadata: {
    id: string;
    nombre: string;
    descripcion?: string | null;
    userId: string;
    userName?: string;
    vistos: number;
    descargas: number;
    createdAt: Date;
    updatedAt: Date;
    tags: string[];
  };

  @ApiProperty({
    description: 'Calificación promedio del material (escala 1-5)',
    example: 4.5,
    type: 'number',
    nullable: true,
  })
  calificación: number | null;

  @ApiProperty({
    description: 'URL para previsualizar o descargar el material',
    example: 'https://storage.blob.core.windows.net/materials/file.pdf',
  })
  previewURL: string;
}
