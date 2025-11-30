jest.mock('../config', () => ({
  envs: {
    blobStorageConnectionString:
      'DefaultEndpointsProtocol=https;AccountName=fakeaccount;AccountKey=fakeKey1234567890==;EndpointSuffix=core.windows.net',
    blobStorageAccountName: 'fakeaccount',
  },
}));

jest.mock(
  '../prisma/prisma.service',
  () => ({
    PrismaService: jest.fn(),
  }),
  { virtual: true },
);

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

describe('MaterialService', () => {
  let service: MaterialService;
  let prismaMock: any;
  let serviceBusClientMock: any;
  let subscribeMock: jest.Mock;

  beforeEach(() => {
    prismaMock = {
      materiales: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      tags: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      materialTags: {
        create: jest.fn(),
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

    service = new MaterialService(serviceBusClientMock, prismaMock);
  });

  // estadísticas
  describe('getMaterialsByUserWithStats', () => {
    it('debería devolver los materiales del usuario con estadísticas correctas', async () => {
      const now = new Date();

      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-123' });
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
          tags: [{ Tags: { tag: 'cálculo' } }, { Tags: { tag: 'parcial' } }],
          calificaciones: [{ calificacion: 4 }, { calificacion: 5 }],
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
          calificaciones: [{ calificacion: 3 }],
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

      prismaMock.usuarios.findUnique.mockResolvedValue({ id: 'user-123' });
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

    it('debería lanzar NotFoundException si el usuario no existe', async () => {
      prismaMock.usuarios.findUnique.mockResolvedValue(null);

      await expect(
        service.getMaterialsByUserWithStats('user-no-existe'),
      ).rejects.toThrow('El usuario con id user-no-existe no existe');
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

  // Cobertura para guardarMaterial / tags
  describe('guardarMaterial y guardarTags', () => {
    it('debería guardar el material y crear/relacionar las tags', async () => {
      const now = new Date();

      const material = {
        id: 'mat-1',
        nombre: 'Material prueba',
        userId: 'user-1',
        url: 'https://blob/m1.pdf',
        descripcion: 'desc',
        vistos: 0,
        descargas: 0,
        createdAt: now,
        updatedAt: now,
      };

      prismaMock.tags.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tag-2', tag: 'algebra' });

      prismaMock.tags.create.mockResolvedValue({ id: 'tag-1', tag: 'calculo' });
      prismaMock.materialTags.create.mockResolvedValue({});

      await service.guardarMaterial(material as any, ['calculo', 'algebra']);

      expect(prismaMock.materiales.create).toHaveBeenCalledWith({
        data: material,
      });
      expect(prismaMock.tags.findUnique).toHaveBeenCalledTimes(2);
      expect(prismaMock.tags.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.materialTags.create).toHaveBeenCalledTimes(2);
    });

    it('no debería fallar si no se pasan tags', async () => {
      const material = {
        id: 'mat-2',
        nombre: 'Sin tags',
        userId: 'user-1',
        url: 'https://blob/m2.pdf',
        descripcion: null,
        vistos: 0,
        descargas: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.guardarMaterial(material as any, []);

      expect(prismaMock.materiales.create).toHaveBeenCalledWith({
        data: material,
      });
      expect(prismaMock.tags.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.materialTags.create).not.toHaveBeenCalled();
    });
  });

  // Notificación
  describe('enviarNotificacionNuevoMaterial', () => {
    it('debería enviar un mensaje a la cola de notificaciones con el cuerpo correcto', async () => {
      const response = {
        tema: 'Cálculo diferencial',
        materia: 'Cálculo I',
        valid: true,
        tags: ['cálculo'],
      } as any;

      const notificationSender = (service as any).notification;
      (notificationSender.sendMessages as jest.Mock).mockResolvedValue(
        undefined,
      );

      await service.enviarNotificacionNuevoMaterial(response);

      expect(notificationSender.sendMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            rol: 'estudiante',
            template: 'nuevoMaterialSubido',
            resumen: `Se ha subido un nuevo materia de ${response.tema}`,
            tema: response.tema,
            materia: response.materia,
            guardar: false,
            mandarCorreo: false,
          }),
        }),
      );
    });
  });

  // Listener de respuestas
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

  // Helpers privados: upload / send / wait / delete
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
      const deleteMock = jest.fn().mockResolvedValue({ succeeded: true });

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
      const deleteMock = jest.fn().mockResolvedValue({ succeeded: false });

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
      const deleteMock = jest.fn().mockRejectedValue(new Error('blob error'));

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

  // validateMaterial: orquestación
  describe('validateMaterial', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 fake');

    it('debería orquestar subida, envío a IA y manejo de respuesta (caso feliz)', async () => {
      (service as any).uploadToBlob = jest
        .fn()
        .mockResolvedValue('https://blob/fake.pdf');
      (service as any).sendAnalysisMessage = jest
        .fn()
        .mockResolvedValue(undefined);
      const fakeResponse = {
        valid: true,
        tags: [],
        tema: 'T',
        materia: 'M',
      } as any;
      (service as any).waitForResponse = jest
        .fn()
        .mockResolvedValue(fakeResponse);
      (service as any).handleResponse = jest.fn().mockResolvedValue(undefined);

      const result = await service.validateMaterial(
        pdfBuffer,
        'archivo.pdf',
        'user-1',
        'desc',
      );

      const expectedBlobName = 'test-uuid-archivo.pdf';

      expect((service as any).uploadToBlob).toHaveBeenCalledWith(
        pdfBuffer,
        expectedBlobName,
      );

      expect((service as any).sendAnalysisMessage).toHaveBeenCalledWith(
        'https://blob/fake.pdf',
        expectedBlobName,
        'test-uuid',
        'analysis',
      );

      expect((service as any).waitForResponse).toHaveBeenCalledWith(
        'test-uuid',
      );

      expect((service as any).handleResponse).toHaveBeenCalledWith(
        fakeResponse,
        expect.objectContaining({
          correlationId: 'test-uuid',
          filename: 'archivo.pdf',
          blobName: expectedBlobName,
          userId: 'user-1',
          descripcion: 'desc',
          fileUrl: 'https://blob/fake.pdf',
        }),
      );

      expect(result).toBe(fakeResponse);
    });

    it('debería lanzar error si falla la subida al blob', async () => {
      (service as any).uploadToBlob = jest
        .fn()
        .mockRejectedValue(new Error('blob error'));

      await expect(
        service.validateMaterial(pdfBuffer, 'archivo.pdf', 'user-1', 'desc'),
      ).rejects.toThrow('Error almacenando PDF');
    });

    it('debería lanzar error y limpiar blob si falla el envío a IA', async () => {
      (service as any).uploadToBlob = jest
        .fn()
        .mockResolvedValue('https://blob/fake.pdf');
      (service as any).sendAnalysisMessage = jest
        .fn()
        .mockRejectedValue(new Error('IA error'));
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.validateMaterial(pdfBuffer, 'archivo.pdf', 'user-1', 'desc'),
      ).rejects.toThrow('Error enviando a IA');

      const expectedBlobName = 'test-uuid-archivo.pdf';

      expect((service as any).deleteBlobSafe).toHaveBeenCalledWith(
        expectedBlobName,
        'test-uuid',
      );
    });
  });

  // handleResponse
  describe('handleResponse', () => {
    const baseCtx = {
      correlationId: 'corr-1',
      filename: 'archivo.pdf',
      blobName: 'corr-1-archivo.pdf',
      userId: 'user-1',
      descripcion: 'desc',
      fileUrl: 'https://blob/archivo.pdf',
    };

    it('debería guardar material y enviar notificación cuando la respuesta es válida', async () => {
      const response = {
        valid: true,
        tags: ['tag1', 'tag2'],
        tema: 'Tema X',
        materia: 'Materia Y',
      } as any;

      (service as any).guardarMaterial = jest.fn().mockResolvedValue(undefined);
      (service as any).sendAnalysisMessage = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).enviarNotificacionNuevoMaterial = jest
        .fn()
        .mockResolvedValue(undefined);
      (service as any).deleteBlobSafe = jest.fn();

      await (service as any).handleResponse(response, baseCtx);

      expect((service as any).guardarMaterial).toHaveBeenCalled();
      expect((service as any).sendAnalysisMessage).toHaveBeenCalledWith(
        '',
        baseCtx.blobName,
        baseCtx.correlationId,
        'save',
      );
      expect(
        (service as any).enviarNotificacionNuevoMaterial,
      ).toHaveBeenCalledWith(response);
    });

    it('debería eliminar el blob cuando la respuesta es NO válida', async () => {
      const response = { valid: false } as any;
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await (service as any).handleResponse(response, baseCtx);

      expect((service as any).deleteBlobSafe).toHaveBeenCalledWith(
        baseCtx.blobName,
        baseCtx.correlationId,
      );
    });

    it('debería lanzar error y limpiar blob si falla guardarMaterial', async () => {
      const response = {
        valid: true,
        tags: [],
        tema: 'Tema',
        materia: 'Materia',
      } as any;

      (service as any).guardarMaterial = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));
      (service as any).deleteBlobSafe = jest.fn().mockResolvedValue(undefined);

      await expect(
        (service as any).handleResponse(response, baseCtx),
      ).rejects.toThrow('Error guardando material válido');

      expect((service as any).deleteBlobSafe).toHaveBeenCalledWith(
        baseCtx.blobName,
        baseCtx.correlationId,
      );
    });
  });
});
