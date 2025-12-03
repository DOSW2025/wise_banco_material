jest.mock('../config', () => ({
  envs: {
    blobStorageConnectionString: 'test-connection-string',
    blobStorageAccountName: 'test-account',
  },
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}), { virtual: true });

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

import { MaterialController } from './material.controller';
import { MaterialService } from './material.service';
import { PdfExportService } from './pdf-export.service';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { MaterialDto } from './dto/material.dto';
import { CreateMaterialResponseDto } from './dto/create-material-response.dto';
import { StreamableFile } from '@nestjs/common';

describe('MaterialController', () => {
  let controller: MaterialController;
  let serviceMock: any;
  let pdfExportServiceMock: any;
  let prismaMock: any;

  beforeEach(() => {
    serviceMock = {
      getMaterialsByUserWithStats: jest.fn(),
      getPopularMaterials: jest.fn(),
      validateMaterial: jest.fn(),
      getMaterialStats: jest.fn(),
      incrementViews: jest.fn(),
      searchMaterials: jest.fn(),
      rateMaterial: jest.fn(),
      getMaterialRatings: jest.fn(),
      downloadMaterial: jest.fn(),
      autocompleteMaterials: jest.fn(),
    };

    pdfExportServiceMock = {
      generateMaterialStatsPDF: jest.fn(),
    };

    prismaMock = {
      usuarios: {
        findUnique: jest.fn(),
      },
    };

    controller = new MaterialController(serviceMock, pdfExportServiceMock, prismaMock);
  });

  // ────────────────────────────
  // PRUEBAS QUE YA TENÍAS
  // ────────────────────────────

  it('getMaterialsByUser debería delegar en el servicio', async () => {
    const mockResponse: UserMaterialsResponseDto = {
      materials: [],
      totalVistas: 0,
      totalDescargas: 0,
      calificacionPromedio: null,
    };

    serviceMock.getMaterialsByUserWithStats.mockResolvedValue(mockResponse);

    const result = await controller.getMaterialsByUser('user-123');

    expect(serviceMock.getMaterialsByUserWithStats).toHaveBeenCalledWith('user-123');
    expect(result).toBe(mockResponse);
  });

  it('getPopularMaterials debería delegar en el servicio', async () => {
    const now = new Date();
    const mockMaterials: MaterialDto[] = [
      {
        id: 'mat-1',
        nombre: 'Popular',
        userId: 'u1',
        userName: 'John',
        extension: 'pdf',
        url: 'https://blob/m1.pdf',
        descripcion: null,
        vistos: 10,
        descargas: 5,
        createdAt: now,
        updatedAt: now,
        tags: [],
        calificacionPromedio: 4,
        totalComentarios: 0,
      },
    ];

    serviceMock.getPopularMaterials.mockResolvedValue(mockMaterials);

    const result = await controller.getPopularMaterials();

    expect(serviceMock.getPopularMaterials).toHaveBeenCalledWith(10);
    expect(result).toBe(mockMaterials);
  });

  it('getPopularMaterials debería aceptar limit personalizado', async () => {
    serviceMock.getPopularMaterials.mockResolvedValue([]);

    await controller.getPopularMaterials(5);

    expect(serviceMock.getPopularMaterials).toHaveBeenCalledWith(5);
  });

  // ────────────────────────────
  // NUEVAS PRUEBAS: subirNuevoMaterial
  // ────────────────────────────

  describe('subirNuevoMaterial', () => {
    it('debería lanzar error si no se envía archivo', async () => {
      await expect(
        controller.subirNuevoMaterial(undefined as any, {
          title: 'Test',
          subject: 'Math',
          userId: 'user-123',
        } as any),
      ).rejects.toThrow('Archivo PDF requerido en el campo "file"');
    });

    it('debería lanzar error si el archivo no es PDF', async () => {
      const fakeFile = {
        mimetype: 'image/png',
        originalname: 'imagen.png',
        size: 1234,
        buffer: Buffer.from('fake'),
      };

      await expect(
        controller.subirNuevoMaterial(fakeFile as any, {
          title: 'Test',
          subject: 'Math',
          userId: 'user-123',
        } as any),
      ).rejects.toThrow('Solo se permiten archivos PDF');
    });

    it('debería lanzar error si el usuario no existe', async () => {
      const fakeFile = {
        mimetype: 'application/pdf',
        originalname: 'doc.pdf',
        size: 1234,
        buffer: Buffer.from('%PDF-1.4'),
      };

      prismaMock.usuarios.findUnique.mockResolvedValue(null);

      await expect(
        controller.subirNuevoMaterial(fakeFile as any, {
          title: 'Test',
          subject: 'Math',
          userId: 'user-123',
        } as any),
      ).rejects.toThrow('El userId user-123 no existe en la base de datos');
    });

    it('debería llamar a validateMaterial y devolver su resultado en el caso feliz', async () => {
      const fakeFile = {
        mimetype: 'application/pdf',
        originalname: 'material.pdf',
        size: 2048,
        buffer: Buffer.from('%PDF-1.4 contenido'),
      };

      const body = {
        title: 'Material de Cálculo',
        description: 'Apuntes de cálculo',
        subject: 'Matemáticas',
        userId: 'user-123',
      };

      const mockResult: CreateMaterialResponseDto = {
        id: 'mat-1',
        title: body.title,
        description: body.description,
        subject: body.subject,
        filename: body.title,
        fileUrl: 'https://blob.storage/material.pdf',
        createdAt: new Date(),
      };

      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-123' });
      serviceMock.validateMaterial.mockResolvedValue(mockResult);

      const result = await controller.subirNuevoMaterial(fakeFile as any, body as any);

      expect(serviceMock.validateMaterial).toHaveBeenCalledWith(
        fakeFile.buffer,
        body,
        fakeFile.originalname,
      );
      expect(result).toBe(mockResult);
    });
  });

  // ────────────────────────────
  // NUEVAS PRUEBAS: getMaterialStats
  // ────────────────────────────

  describe('getMaterialStats', () => {
    it('debería devolver las estadísticas de un material', async () => {
      const materialId = 'mat-123';
      const mockStats: MaterialDto = {
        id: materialId,
        nombre: 'Material 1',
        userId: 'user-1',
        userName: 'John',
        extension: 'pdf',
        url: 'https://blob/m1.pdf',
        descripcion: 'Test',
        vistos: 10,
        descargas: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: ['math'],
        calificacionPromedio: 4.5,
        totalComentarios: 2,
      };

      serviceMock.getMaterialStats.mockResolvedValue(mockStats);

      const result = await controller.getMaterialStats(materialId);

      expect(serviceMock.getMaterialStats).toHaveBeenCalledWith(materialId);
      expect(result).toBe(mockStats);
    });
  });

  // ────────────────────────────
  // NUEVAS PRUEBAS: exportMaterialStatsToPDF
  // ────────────────────────────

  describe('exportMaterialStatsToPDF', () => {
    it('debería exportar las estadísticas a PDF', async () => {
      const materialId = 'mat-123';
      const mockStats: MaterialDto = {
        id: materialId,
        nombre: 'Material 1',
        userId: 'user-1',
        userName: 'John',
        extension: 'pdf',
        url: 'https://blob/m1.pdf',
        descripcion: 'Test',
        vistos: 10,
        descargas: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: ['math'],
        calificacionPromedio: 4.5,
        totalComentarios: 2,
      };

      const mockPdfBuffer = Buffer.from('pdf content');

      serviceMock.getMaterialStats.mockResolvedValue(mockStats);
      pdfExportServiceMock.generateMaterialStatsPDF.mockResolvedValue(mockPdfBuffer);

      const result = await controller.exportMaterialStatsToPDF(materialId);

      expect(serviceMock.getMaterialStats).toHaveBeenCalledWith(materialId);
      expect(pdfExportServiceMock.generateMaterialStatsPDF).toHaveBeenCalledWith(mockStats);
      expect(result).toBeInstanceOf(StreamableFile);
    });
  });

  // ────────────────────────────
  // NUEVAS PRUEBAS: incrementViews
  // ────────────────────────────

  describe('incrementViews', () => {
    it('debería incrementar las vistas de un material', async () => {
      const materialId = 'mat-123';
      serviceMock.incrementViews.mockResolvedValue(undefined);

      const result = await controller.incrementViews(materialId);

      expect(serviceMock.incrementViews).toHaveBeenCalledWith(materialId);
      expect(result).toEqual({ message: 'Vista registrada' });
    });
  });
});