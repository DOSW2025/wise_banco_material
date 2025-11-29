jest.mock('../config', () => ({
  envs: {
    // Cadena FALSA pero con formato válido de Azure
    blobStorageConnectionString:
      'DefaultEndpointsProtocol=https;AccountName=fakeaccount;AccountKey=fakeKey1234567890==;EndpointSuffix=core.windows.net',
    blobStorageAccountName: 'fakeaccount',
  },
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}), { virtual: true });

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));
import { MaterialService } from './material.service';

describe('MaterialService - estadísticas de materiales', () => {
  let service: MaterialService;
  let prismaMock: any;
  let serviceBusClientMock: any;

  beforeEach(() => {
    prismaMock = {
      materiales: {
        findMany: jest.fn(),
      },
    };

    // Mock mínimo ServiceBusClient 
    serviceBusClientMock = {
      createSender: jest.fn().mockReturnValue({
        sendMessages: jest.fn(),
      }),
      createReceiver: jest.fn().mockReturnValue({
        subscribe: jest.fn(),
      }),
    };

    // Instanciamos directamente el servicio, sin Nest TestingModule
    service = new MaterialService(
      serviceBusClientMock as any,
      prismaMock as any,
    );
  });

  describe('getMaterialsByUserWithStats', () => {
    it('debería devolver los materiales del usuario con estadísticas correctas', async () => {
      const now = new Date();

      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Guía de cálculo',
          userId: 'user-123',
          url: 'https://blob/guia.pdf',
          descripcion: 'Guía para parcial',
          vistos: 10,
          descargas: 3,
          createdAt: now,
          updatedAt: now,
          tags: [
            { Tags: { tag: 'cálculo' } },
            { Tags: { tag: 'parcial' } },
          ],
          calificaciones: [
            { calificacion: 4 },
            { calificacion: 5 },
          ],
        },
        {
          id: 'mat-2',
          nombre: 'Taller de álgebra',
          userId: 'user-123',
          url: 'https://blob/taller.pdf',
          descripcion: null,
          vistos: 5,
          descargas: 2,
          createdAt: now,
          updatedAt: now,
          tags: [],
          calificaciones: [
            { calificacion: 3 },
          ],
        },
      ]);

      const result = await service.getMaterialsByUserWithStats('user-123');

      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
        include: {
          tags: { include: { Tags: true } },
          calificaciones: true,
        },
      });

      // Lista de materiales
      expect(result.materials).toHaveLength(2);
      expect(result.materials[0].id).toBe('mat-1');
      expect(result.materials[0].url).toBe('https://blob/guia.pdf');
      expect(result.materials[0].tags).toEqual(['cálculo', 'parcial']);
      expect(result.materials[0].calificacionPromedio).toBe(4.5); // (4+5)/2

      // Estadísticas globales
      expect(result.totalVistas).toBe(10 + 5);
      expect(result.totalDescargas).toBe(3 + 2);
      // Calificación global: (4+5+3)/3 = 4
      expect(result.calificacionPromedio).toBeCloseTo(4);
    });

    it('debería manejar el caso sin calificaciones', async () => {
      const now = new Date();

      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Guía sin calificaciones',
          userId: 'user-123',
          url: 'https://blob/guia.pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: now,
          updatedAt: now,
          tags: [],
          calificaciones: [],
        },
      ]);

      const result = await service.getMaterialsByUserWithStats('user-123');

      expect(result.materials).toHaveLength(1);
      expect(result.calificacionPromedio).toBeNull();
      expect(result.totalVistas).toBe(0);
      expect(result.totalDescargas).toBe(0);
    });
  });

  describe('getPopularMaterials', () => {
    it('debería devolver los materiales ordenados por descargas y vistas', async () => {
      const now = new Date();

      prismaMock.materiales.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          nombre: 'Más descargado',
          userId: 'u1',
          url: 'https://blob/m1.pdf',
          descripcion: null,
          vistos: 50,
          descargas: 20,
          createdAt: now,
          updatedAt: now,
          tags: [],
          calificaciones: [],
        },
        {
          id: 'mat-2',
          nombre: 'Segundo lugar',
          userId: 'u2',
          url: 'https://blob/m2.pdf',
          descripcion: null,
          vistos: 40,
          descargas: 10,
          createdAt: now,
          updatedAt: now,
          tags: [],
          calificaciones: [],
        },
      ]);

      const result = await service.getPopularMaterials(10);

      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith({
        orderBy: [
          { descargas: 'desc' },
          { vistos: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 10,
        include: {
          tags: { include: { Tags: true } },
          calificaciones: true,
        },
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mat-1');
      expect(result[0].url).toBe('https://blob/m1.pdf');
    });
  });
});
