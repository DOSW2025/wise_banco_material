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
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { MaterialListItemDto } from './dto/material.dto';

describe('MaterialController', () => {
  let controller: MaterialController;
  let serviceMock: {
    getMaterialsByUserWithStats: jest.Mock;
    getPopularMaterials: jest.Mock;
  };

  beforeEach(() => {
    serviceMock = {
      getMaterialsByUserWithStats: jest.fn(),
      getPopularMaterials: jest.fn(),
    };

    // 🔹 Esta instancia se usa solo para las pruebas existentes
    controller = new MaterialController(serviceMock as any, {} as any);
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
    const mockMaterials: MaterialListItemDto[] = [
      {
        id: 'mat-1',
        nombre: 'Popular',
        userId: 'u1',
        url: 'https://blob/m1.pdf',
        descripcion: null,
        vistos: 10,
        descargas: 5,
        createdAt: now,
        updatedAt: now,
        tags: [],
        calificacionPromedio: 4,
      },
    ];

    serviceMock.getPopularMaterials.mockResolvedValue(mockMaterials);

    const result = await controller.getPopularMaterials();

    expect(serviceMock.getPopularMaterials).toHaveBeenCalledWith(10);
    expect(result).toBe(mockMaterials);
  });

  // ────────────────────────────
  // NUEVAS PRUEBAS: subirNuevoMaterial
  // ────────────────────────────

  describe('subirNuevoMaterial', () => {
    /**
     * Helper para crear una instancia independiente del controlador
     * sin afectar la instancia global usada en las pruebas anteriores.
     */
    const createControllerWithServiceMock = () => {
      const materialServiceMock: Partial<MaterialService> = {
        validateMaterial: jest.fn(),
      };

      const prismaMock = {}; // no se usa en estas pruebas

      const controllerLocal = new MaterialController(
        materialServiceMock as any,
        prismaMock as any,
      );

      return { controllerLocal, materialServiceMock };
    };

    it('debería lanzar error si no se envía archivo', async () => {
      const { controllerLocal } = createControllerWithServiceMock();

      await expect(
        controllerLocal.subirNuevoMaterial(undefined as any, {
          userId: 'user-123',
        }),
      ).rejects.toThrow('Archivo PDF requerido en el campo "file"');
    });

    it('debería lanzar error si el archivo no es PDF', async () => {
      const { controllerLocal } = createControllerWithServiceMock();

      const fakeFile = {
        mimetype: 'image/png',
        originalname: 'imagen.png',
        size: 1234,
        buffer: Buffer.from('fake'),
      };

      await expect(
        controllerLocal.subirNuevoMaterial(fakeFile as any, {
          userId: 'user-123',
        }),
      ).rejects.toThrow('Solo se permiten archivos PDF');
    });

    it('debería lanzar error si falta userId en el body', async () => {
      const { controllerLocal } = createControllerWithServiceMock();

      const fakeFile = {
        mimetype: 'application/pdf',
        originalname: 'doc.pdf',
        size: 1234,
        buffer: Buffer.from('%PDF-1.4'),
      };

      // body sin userId
      await expect(
        controllerLocal.subirNuevoMaterial(fakeFile as any, {} as any),
      ).rejects.toThrow('Campo "userId" es requerido');
    });

    it('debería llamar a validateMaterial y devolver su resultado en el caso feliz', async () => {
      const { controllerLocal, materialServiceMock } =
        createControllerWithServiceMock();

      const fakeFile = {
        mimetype: 'application/pdf',
        originalname: 'material.pdf',
        size: 2048,
        buffer: Buffer.from('%PDF-1.4 contenido'),
      };

      const body = {
        userId: 'user-123',
        descripcion: 'Apuntes de cálculo',
      };

      const mockResult = { id: 'mat-1', message: 'ok' };
      (materialServiceMock.validateMaterial as jest.Mock).mockResolvedValue(
        mockResult,
      );

      const result = await controllerLocal.subirNuevoMaterial(
        fakeFile as any,
        body,
      );

      expect(materialServiceMock.validateMaterial).toHaveBeenCalledWith(
        fakeFile.buffer,
        fakeFile.originalname,
        body.userId,
        body.descripcion,
      );
      expect(result).toBe(mockResult);
    });
  });
});
