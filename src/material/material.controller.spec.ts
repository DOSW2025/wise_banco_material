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
import { MaterialListItemDto } from './dto/material-list-item.dto';

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

    controller = new MaterialController(serviceMock as any);
  });

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
});
