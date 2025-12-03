jest.mock('../config', () => ({
  envs: {
    blobStorageConnectionString:
      'DefaultEndpointsProtocol=https;AccountName=fakeaccount;AccountKey=fakeKey1234567890==;EndpointSuffix=core.windows.net',
    blobStorageAccountName: 'fakeaccount',
    serviceBusConnectionString: 'fake-connection-string',
  },
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}), { virtual: true });

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

jest.mock('@azure/storage-blob', () => {
  const createIfNotExists = jest
    .fn()
    .mockRejectedValue(new Error('container error'));

  const getBlockBlobClient = jest.fn().mockReturnValue({
    uploadData: jest.fn(),
    deleteIfExists: jest.fn().mockResolvedValue({ succeeded: true }),
    url: 'https://fake.blob/core/file.pdf',
    exists: jest.fn().mockResolvedValue(true),
    download: jest.fn().mockResolvedValue({
      readableStreamBody: null,
      contentType: 'application/pdf',
    }),
    downloadToBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
  });

  const containerClient = {
    createIfNotExists,
    getBlockBlobClient,
  };

  return {
    BlobServiceClient: {
      fromConnectionString: jest.fn().mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      }),
    },
  };
});

import { MaterialService } from './material.service';
import { BadRequestException, NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';

describe('MaterialService', () => {
  let service: MaterialService;
  let prismaMock: any;
  let serviceBusClientMock: any;
  let subscribeMock: jest.Mock;

  beforeEach(() => {
    prismaMock = {
      materiales: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      tags: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      materialTags: {
        create: jest.fn(),
      },
      calificaciones: {
        create: jest.fn(),
        findMany: jest.fn(),
        aggregate: jest.fn(),
      },
      usuarios: {
        findUnique: jest.fn(),
      },
    };

    subscribeMock = jest.fn();

    serviceBusClientMock = {
      createSender: jest.fn().mockReturnValue({
        sendMessages: jest.fn(),
      }),
      createReceiver: jest.fn().mockReturnValue({
        subscribe: subscribeMock,
      }),
    };

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
          extension: 'pdf',
          descripcion: 'Guía para parcial',
          vistos: 10,
          descargas: 3,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [
            { Tags: { tag: 'cálculo' } },
            { Tags: { tag: 'parcial' } },
          ],
          Calificaciones: [
            { calificacion: 4 },
            { calificacion: 5 },
          ],
          usuarios: { nombre: 'John' },
        },
        {
          id: 'mat-2',
          nombre: 'Taller de álgebra',
          userId: 'user-123',
          url: 'https://blob/taller.pdf',
          extension: 'pdf',
          descripcion: null,
          vistos: 5,
          descargas: 2,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [{ calificacion: 3 }],
          usuarios: { nombre: 'Jane' },
        },
      ]);

      const result = await service.getMaterialsByUserWithStats('user-123');

      expect(prismaMock.materiales.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
        include: {
          MaterialTags: { include: { Tags: true } },
          Calificaciones: true,
          usuarios: { select: { nombre: true } },
        },
      });

      expect(result.materials).toHaveLength(2);
      expect(result.materials[0].id).toBe('mat-1');
      expect(result.materials[0].url).toBe('https://blob/guia.pdf');
      expect(result.materials[0].tags).toEqual(['cálculo', 'parcial']);
      expect(result.materials[0].calificacionPromedio).toBe(4.5);

      expect(result.totalVistas).toBe(15);
      expect(result.totalDescargas).toBe(5);
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
          extension: 'pdf',
          descripcion: null,
          vistos: 0,
          descargas: 0,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'John' },
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
          extension: 'pdf',
          descripcion: null,
          vistos: 50,
          descargas: 20,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'John' },
        },
        {
          id: 'mat-2',
          nombre: 'Segundo lugar',
          userId: 'u2',
          url: 'https://blob/m2.pdf',
          extension: 'pdf',
          descripcion: null,
          vistos: 40,
          descargas: 10,
          createdAt: now,
          updatedAt: now,
          MaterialTags: [],
          Calificaciones: [],
          usuarios: { nombre: 'Jane' },
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
          MaterialTags: { include: { Tags: true } },
          Calificaciones: true,
          usuarios: { select: { nombre: true } },
        },
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mat-1');
      expect(result[0].url).toBe('https://blob/m1.pdf');
    });
  });

  describe('guardarMaterial y guardarTags', () => {
    it('debería guardar el material y crear/relacionar las tags', async () => {
      const now = new Date();

      const material = {
        id: 'mat-1',
        nombre: 'Material prueba',
        userId: 'user-1',
        extension: 'pdf',
        url: 'https://blob/m1.pdf',
        descripcion: 'desc',
        vistos: 0,
        descargas: 0,
        hash: 'hash123',
        createdAt: now,
        updatedAt: now,
      };

      prismaMock.tags.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tag-2', tag: 'algebra' })
        .mockResolvedValueOnce(null);

      prismaMock.tags.create
        .mockResolvedValueOnce({ id: 'tag-1', tag: 'calculo' })
        .mockResolvedValueOnce({ id: 'tag-3', tag: 'matematicas' });
      
      prismaMock.materialTags.create.mockResolvedValue({});

      await service.guardarMaterial(material as any, ['calculo', 'algebra'], 'matematicas');

      expect(prismaMock.materiales.create).toHaveBeenCalledWith({ data: material });
      expect(prismaMock.tags.findUnique).toHaveBeenCalledTimes(3);
      expect(prismaMock.materialTags.create).toHaveBeenCalledTimes(3);
    });

    it('no debería fallar si no se pasan tags', async () => {
      const material = {
        id: 'mat-2',
        nombre: 'Sin tags',
        userId: 'user-1',
        extension: 'pdf',
        url: 'https://blob/m2.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        hash: 'hash456',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.tags.findUnique.mockResolvedValue(null);
      prismaMock.tags.create.mockResolvedValue({ id: 'tag-1', tag: 'matematicas' });

      await service.guardarMaterial(material as any, [], 'matematicas');

      expect(prismaMock.materiales.create).toHaveBeenCalledWith({ data: material });
      expect(prismaMock.materialTags.create).toHaveBeenCalled();
    });
  });

  describe('incrementViews', () => {
    it('debería incrementar las vistas de un material', async () => {
      const materialId = 'mat-1';
      prismaMock.materiales.findUnique.mockResolvedValue({ id: materialId });
      prismaMock.materiales.update.mockResolvedValue({ vistos: 11 });

      await service.incrementViews(materialId);

      expect(prismaMock.materiales.update).toHaveBeenCalledWith({
        where: { id: materialId },
        data: { vistos: { increment: 1 } },
      });
    });

    it('debería lanzar error si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);

      await expect(service.incrementViews('mat-999')).rejects.toThrow(BadRequestException);
    });
  });

  describe('rateMaterial', () => {
    it('debería crear una calificación y devolver el promedio', async () => {
      const materialId = 'mat-1';
      const userId = 'user-1';

      prismaMock.materiales.findUnique.mockResolvedValue({ id: materialId });
      prismaMock.usuarios.findUnique.mockResolvedValue({ id: userId });
      prismaMock.calificaciones.create.mockResolvedValue({});
      prismaMock.calificaciones.aggregate.mockResolvedValue({
        _avg: { calificacion: 4.5 },
        _count: { _all: 2 },
      });

      const result = await service.rateMaterial(materialId, userId, 5, 'Excelente');

      expect(result).toEqual({
        materialId,
        rating: 5,
        comentario: 'Excelente',
        calificacionPromedio: 4.5,
        totalCalificaciones: 2,
      });
    });

    it('debería lanzar error si la calificación está fuera de rango', async () => {
      await expect(service.rateMaterial('mat-1', 'user-1', 6)).rejects.toThrow(BadRequestException);
      await expect(service.rateMaterial('mat-1', 'user-1', 0)).rejects.toThrow(BadRequestException);
    });

    it('debería lanzar error si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.rateMaterial('mat-999', 'user-1', 5)).rejects.toThrow(NotFoundException);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({ id: 'mat-1' });
      prismaMock.usuarios.findUnique.mockResolvedValue(null);
      await expect(service.rateMaterial('mat-1', 'user-999', 5)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMaterialRatings', () => {
    it('debería devolver todas las calificaciones de un material', async () => {
      const materialId = 'mat-1';
      const mockCalificaciones = [
        { id: 1, calificacion: 5, comentario: 'Excelente', createdAt: new Date() },
        { id: 2, calificacion: 4, comentario: null, createdAt: new Date() },
      ];

      prismaMock.materiales.findUnique.mockResolvedValue({ id: materialId });
      prismaMock.calificaciones.findMany.mockResolvedValue(mockCalificaciones);

      const result = await service.getMaterialRatings(materialId);

      expect(result.materialId).toBe(materialId);
      expect(result.calificacionPromedio).toBe(4.5);
      expect(result.totalCalificaciones).toBe(2);
      expect(result.calificaciones).toHaveLength(2);
    });

    it('debería lanzar error si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);
      await expect(service.getMaterialRatings('mat-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchMaterials', () => {
    it('debería buscar materiales con filtros', async () => {
      const mockMateriales = [
        {
          id: 'mat-1',
          nombre: 'Cálculo',
          userId: 'user-1',
          extension: 'pdf',
          url: 'https://blob/m1.pdf',
          descripcion: 'Material de cálculo',
          vistos: 10,
          descargas: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          MaterialTags: [{ Tags: { tag: 'matemáticas' } }],
          Calificaciones: [{ calificacion: 5 }],
          usuarios: { nombre: 'John' },
        },
      ];

      prismaMock.materiales.findMany.mockResolvedValue(mockMateriales);
      prismaMock.materiales.count.mockResolvedValue(1);

      const result = await service.searchMaterials('cálculo', 'matemáticas');

      expect(result.materials).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('debería filtrar por calificación mínima', async () => {
      const mockMateriales = [
        {
          id: 'mat-1',
          nombre: 'Material',
          userId: 'user-1',
          extension: 'pdf',
          url: 'https://blob/m1.pdf',
          descripcion: 'Test',
          vistos: 10,
          descargas: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          MaterialTags: [],
          Calificaciones: [{ calificacion: 5 }, { calificacion: 5 }],
          usuarios: { nombre: 'John' },
        },
      ];

      prismaMock.materiales.findMany.mockResolvedValue(mockMateriales);
      prismaMock.materiales.count.mockResolvedValue(1);

      const result = await service.searchMaterials(undefined, undefined, undefined, undefined, undefined, 4);

      expect(result.materials).toHaveLength(1);
    });
  });

  describe('getMaterialStats', () => {
    it('debería devolver las estadísticas de un material', async () => {
      const mockMaterial = {
        id: 'mat-1',
        nombre: 'Material 1',
        userId: 'user-1',
        extension: 'pdf',
        url: 'https://blob/m1.pdf',
        descripcion: 'Test',
        vistos: 10,
        descargas: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        MaterialTags: [{ Tags: { tag: 'math' } }],
        Calificaciones: [{ calificacion: 5, comentario: 'Great' }],
        usuarios: { nombre: 'John' },
      };

      prismaMock.materiales.findUnique.mockResolvedValue(mockMaterial);

      const result = await service.getMaterialStats('mat-1');

      expect(result.id).toBe('mat-1');
      expect(result.vistos).toBe(10);
      expect(result.descargas).toBe(5);
    });
  });

  describe('autocompleteMaterials', () => {
    it('debería devolver sugerencias de autocompletado', async () => {
      const mockMateriales = [
        {
          id: 'mat-1',
          nombre: 'Cálculo',
          descripcion: 'Material de cálculo',
          descargas: 10,
          usuarios: { nombre: 'John', apellido: 'Doe' },
        },
      ];

      prismaMock.materiales.count.mockResolvedValue(1);
      prismaMock.materiales.findMany.mockResolvedValue(mockMateriales);
      prismaMock.calificaciones.aggregate.mockResolvedValue({
        _avg: { calificacion: 4.5 },
      });

      const result = await service.autocompleteMaterials('cál');

      expect(result.contadorResultados).toBe(1);
      expect(result.listaResultados).toHaveLength(1);
      expect(result.listaResultados[0].titulo).toBe('Cálculo');
    });

    it('debería lanzar error si la consulta está vacía', async () => {
      await expect(service.autocompleteMaterials('')).rejects.toThrow(BadRequestException);
    });

    it('debería devolver resultados vacíos si no hay coincidencias', async () => {
      prismaMock.materiales.count.mockResolvedValue(0);

      const result = await service.autocompleteMaterials('xyz');

      expect(result.contadorResultados).toBe(0);
      expect(result.listaResultados).toHaveLength(0);
    });
  });

  describe('validateMaterial', () => {
    it('debería lanzar ConflictException si el material ya existe', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4');
      const materialData = { title: 'Test', subject: 'Math', userId: 'user-1' } as any;

      prismaMock.materiales.findFirst.mockResolvedValue({ id: 'existing-mat' });

      await expect(service.validateMaterial(pdfBuffer, materialData)).rejects.toThrow(ConflictException);
    });
  });

  describe('downloadMaterial', () => {
    it('debería devolver stream del material', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue({
        id: 'mat-1',
        nombre: 'material.pdf',
        url: 'https://fake.blob/core/materials/file.pdf',
      });

      const result = await service.downloadMaterial('mat-1');

      expect(result).toHaveProperty('stream');
      expect(result).toHaveProperty('contentType');
      expect(result).toHaveProperty('filename');
    });

    it('debería lanzar error si el material no existe', async () => {
      prismaMock.materiales.findUnique.mockResolvedValue(null);

      await expect(service.downloadMaterial('mat-999')).rejects.toThrow(BadRequestException);
    });
  });

  describe('enviarNotificacionNuevoMaterial', () => {
    it('debería enviar un mensaje a la cola de notificaciones con el cuerpo correcto', async () => {
      const response = {
        tema: 'Cálculo diferencial',
        materia: 'Cálculo I',
        valid: true,
        tags: ['cálculo'],
      } as any;

      prismaMock.usuarios.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        nombre: 'John',
      });

      const notificationSender = (service as any).notification;
      (notificationSender.sendMessages as jest.Mock).mockResolvedValue(undefined);

      await service.enviarNotificacion(response, 'user-1', 'material.pdf', 'nuevoMaterialSubido');

      expect(notificationSender.sendMessages).toHaveBeenCalled();
    });
  });

  describe('listenForResponses', () => {
    it('debería resolver la promesa pendiente cuando llega un mensaje con correlationId conocido', async () => {
      const handlers = subscribeMock.mock.calls[0][0];

      const body = { valid: true } as any;
      const promise = (service as any).waitForResponse('corr-1');

      await handlers.processMessage({
        correlationId: 'corr-1',
        body,
      } as any);

      await expect(promise).resolves.toBe(body);
    });

    it('debería ignorar mensajes sin correlationId', async () => {
      const handlers = subscribeMock.mock.calls[0][0];

      await expect(
        handlers.processMessage({ correlationId: undefined, body: {} } as any),
      ).resolves.toBeUndefined();
    });

    it('debería registrar warning si no hay solicitud pendiente', async () => {
      const handlers = subscribeMock.mock.calls[0][0];

      await expect(
        handlers.processMessage({
          correlationId: 'no-existe',
          body: {},
        } as any),
      ).resolves.toBeUndefined();
    });

    it('debería manejar errores en processError', async () => {
      const handlers = subscribeMock.mock.calls[0][0];

      await expect(
        handlers.processError(new Error('boom')),
      ).resolves.toBeUndefined();
    });
  });

  describe('helpers de blob y cola', () => {
    it('uploadToBlob debería subir el PDF y devolver la URL', async () => {
      const uploadMock = jest.fn().mockResolvedValue(undefined);
      const blockBlob = {
        uploadData: uploadMock,
        url: 'https://blob/custom.pdf',
      };
      const getBlockBlobClient = jest.fn().mockReturnValue(blockBlob);

      (service as any).containerClient = {
        getBlockBlobClient,
      };

      const buffer = Buffer.from('%PDF-1.4');
      const url = await (service as any).uploadToBlob(buffer, 'custom.pdf');

      expect(getBlockBlobClient).toHaveBeenCalledWith('custom.pdf');
      expect(uploadMock).toHaveBeenCalledWith(buffer, {
        blobHTTPHeaders: { blobContentType: 'application/pdf' },
      });
      expect(url).toBe('https://blob/custom.pdf');
    });

    it('sendAnalysisMessage debería construir el mensaje y enviarlo', async () => {
      const senderMock = {
        sendMessages: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).sender = senderMock;

      await (service as any).sendAnalysisMessage(
        'https://blob/file.pdf',
        'file.pdf',
        'corr-1',
        'analysis',
      );

      expect(senderMock.sendMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            fileUrl: 'https://blob/file.pdf',
            filename: 'file.pdf',
          },
          correlationId: 'corr-1',
          subject: 'analysis',
          contentType: 'application/json',
        }),
      );
    });

    it('waitForResponse debería registrar la promesa en pendingRequests', async () => {
      const promise = (service as any).waitForResponse('corr-X');
      const pending = (service as any).pendingRequests;

      expect(pending.has('corr-X')).toBe(true);

      const fakeResponse = { valid: true } as any;
      const resolver = pending.get('corr-X');
      resolver(fakeResponse);

      await expect(promise).resolves.toBe(fakeResponse);
    });

    it('deleteBlobSafe debería loggear cuando se elimina el blob', async () => {
      const deleteMock = jest
        .fn()
        .mockResolvedValue({ succeeded: true });

      const blockBlob = {
        deleteIfExists: deleteMock,
      };

      const getBlockBlobClient = jest.fn().mockReturnValue(blockBlob);

      (service as any).containerClient = {
        getBlockBlobClient,
      };

      await (service as any).deleteBlobSafe('blob.pdf', 'corr-1');

      expect(getBlockBlobClient).toHaveBeenCalledWith('blob.pdf');
      expect(deleteMock).toHaveBeenCalled();
    });

    it('deleteBlobSafe debería manejar el caso en que no se pueda eliminar', async () => {
      const deleteMock = jest
        .fn()
        .mockResolvedValue({ succeeded: false });

      const blockBlob = {
        deleteIfExists: deleteMock,
      };

      (service as any).containerClient = {
        getBlockBlobClient: jest.fn().mockReturnValue(blockBlob),
      };

      await (service as any).deleteBlobSafe('blob2.pdf', 'corr-2');

      expect(deleteMock).toHaveBeenCalled();
    });

    it('deleteBlobSafe debería atrapar errores del cliente', async () => {
      const deleteMock = jest
        .fn()
        .mockRejectedValue(new Error('blob error'));

      const blockBlob = {
        deleteIfExists: deleteMock,
      };

      (service as any).containerClient = {
        getBlockBlobClient: jest.fn().mockReturnValue(blockBlob),
      };

      await (service as any).deleteBlobSafe('blob3.pdf', 'corr-3');

      expect(deleteMock).toHaveBeenCalled();
    });
  });

  describe('handleResponse', () => {
    const baseCtx = {
      correlationId: 'corr-1',
      filename: 'archivo.pdf',
      blobName: 'corr-1-archivo.pdf',
      materialData: { userId: 'user-1', title: 'Test', subject: 'Math', description: 'desc' },
      fileUrl: 'https://blob/archivo.pdf',
      hash: 'hash123',
      extension: 'pdf',
    };
  
  describe('validateMaterial - material existente', () => {
    it('debería lanzar ConflictException si el material ya existe', async () => {
      prismaMock.materiales.findFirst.mockResolvedValue({ id: '123' });

      await expect(
        service.validateMaterial(
          Buffer.from('test'),
          { userId: 'u1', title: 'A', subject: 'B' },
          'file.pdf',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('validateMaterial - flujo exitoso', () => {
    it('debería enviar archivo a análisis y devolver correlationId', async () => {
      prismaMock.materiales.findFirst.mockResolvedValue(null);

      const sendSpy = jest
        .spyOn(service as any, 'sendAnalysisMessage')
        .mockResolvedValue(undefined);

      const result = await service.validateMaterial(
        Buffer.from('%PDF-1.4'),
        { userId: 'u1', title: 'Mat', subject: 'Math' },
        'mat.pdf',
      );

      expect(sendSpy).toHaveBeenCalled();
      expect(result).toHaveProperty('correlationId');
    });
  });

  describe('handleResponse - invalid', () => {
    it('debería borrar blob y no guardar material si valid=false', async () => {
      const ctx = {
        fileBuffer: Buffer.from('test'),
        body: { userId: 'u1', title: 'X', description: 'Y' },
        fileName: 'file.pdf',
        blobName: 'blob123',
      };

      (service as any).pendingRequests = {
        c1: ctx,
      };

      (service as any).guardarMaterial = jest.fn();
      (service as any).enviarNotificacion = jest.fn();
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      const response = { valid: false, errors: ['malo'] };

      const result = await (service as any).handleResponse(response, 'Math', 'c1');

      expect((service as any).guardarMaterial).not.toHaveBeenCalled();
      expect((service as any).enviarNotificacion).not.toHaveBeenCalled();
      expect((service as any).deleteBlobSafe).toHaveBeenCalledWith('blob123');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('malo');
    });
  });

  describe('sendAnalysisMessage - error', () => {
    it('no debería lanzar excepción si falla el envío a la cola', async () => {
      (service as any).sender.sendMessages = jest
        .fn()
        .mockRejectedValue(new Error('boom'));

      await expect(
        (service as any).sendAnalysisMessage('u1', 'file', 'c123', 'Math'),
      ).resolves.toBeUndefined();
    });
  });

    it('debería guardar material y enviar notificación cuando la respuesta es válida', async () => {
      const response = {
        valid: true,
        tags: ['tag1', 'tag2'],
        tema: 'Tema X',
        materia: 'Materia Y',
      } as any;

      (service as any).guardarMaterial = jest.fn().mockResolvedValue(undefined);
      (service as any).sendAnalysisMessage = jest.fn().mockResolvedValue(undefined);
      (service as any).enviarNotificacion = jest.fn().mockResolvedValue(undefined);
      (service as any).deleteBlobSafe = jest.fn();

      const result = await (service as any).handleResponse(response, 'Math', baseCtx);

      expect((service as any).guardarMaterial).toHaveBeenCalled();
      expect((service as any).sendAnalysisMessage).toHaveBeenCalledWith(
        '',
        baseCtx.blobName,
        baseCtx.correlationId,
        'save',
      );
      expect((service as any).enviarNotificacion).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('fileUrl');
    });

  });
});