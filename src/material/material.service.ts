import { Injectable, BadRequestException, Logger, ConflictException, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage, ServiceBusAdministrationClient } from '@azure/service-bus';
import { BlobServiceClient } from '@azure/storage-blob';
import { createHash } from 'node:crypto';
import { envs } from '../config';
import { RespuestaIADto } from './dto/respuestIA.dto';
import { NotificationDto } from 'src/material/dto/notificacion.dto';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { Material } from './entities/material.entity';
import { MaterialDto } from './dto/material.dto';
import { UserMaterialsResponseDto } from './dto/user-materials-response.dto';
import { CreateMaterialDto } from './dto/createMaterial.dto';
import { CreateMaterialResponseDto } from './dto/create-material-response.dto';

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);

  private sender;              // Cola donde enviamos los PDFs
  private notification;        // Cola opcional para envío de mails
  private responseReceiver;    // Cola donde recibimos respuestas
  private readonly adminClient?: ServiceBusAdministrationClient;
  private analyticsQueueEnsured = false;
  private readonly blobServiceClient: BlobServiceClient;
  private readonly containerClient: any;
  private readonly containerName = 'materials';
  
  // Mapa que guarda promesas pendientes por correlationId
  private readonly pendingRequests: Map<string, (msg: RespuestaIADto) => void> = new Map();

  constructor(private readonly client: ServiceBusClient, private readonly prisma: PrismaService) {
    this.sender = this.client.createSender('material.process');
    this.notification = this.client.createSender('mail.envio.rol');
    this.responseReceiver = this.client.createReceiver('material.responses');
    // Admin client para operaciones de administración (crear/consultar queues)
    try {
      this.adminClient = new ServiceBusAdministrationClient(envs.serviceBusConnectionString);
    } catch (err) {
      this.logger.warn('No se pudo inicializar ServiceBusAdministrationClient: ' + (err as Error).message);
    }
    // Inicializar BlobServiceClient
    this.blobServiceClient = BlobServiceClient.fromConnectionString(envs.blobStorageConnectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    // Intentar crear el contenedor si no existe (no bloqueante)
    this.containerClient.createIfNotExists().catch((err: any) => {
      this.logger.warn(`No se pudo crear/asegurar contenedor '${this.containerName}': ${err?.message ?? err}`);
    });

    this.listenForResponses();
  }

  /**
   * Listener permanente que consume mensajes desde material.responses
   */
  private listenForResponses() {
    this.responseReceiver.subscribe({
      processMessage: async (message) => {
        const correlationId = message.correlationId;

        if (!correlationId) {
          this.logger.warn('Mensaje recibido SIN correlationId, se ignora');
          return;
        }

        if (this.pendingRequests.has(correlationId)) {
          const resolver = this.pendingRequests.get(correlationId);
          resolver?.(message.body as RespuestaIADto);
          this.pendingRequests.delete(correlationId);
        } else {
          this.logger.warn(`No hay solicitud pendiente para correlationId: ${correlationId}`);
        }
      },

      processError: async (err) => {
        console.error('Error receiving response:', err);
      },
    });
  }

  /**
   * Envía un PDF a IA y espera su respuesta vía correlationId
   */
  async validateMaterial(pdfBuffer: Buffer, materialData: CreateMaterialDto): Promise<CreateMaterialResponseDto> {
    const correlationId = uuid();

    // Calcular hash (SHA-256) y crear registro provisional en BD para evitar duplicados
    const filename = materialData.title;
    const hash = createHash('sha256').update(pdfBuffer).digest('hex');
    this.logger.log(`Hash calculado: ${hash}`);

    // Verificar si ya existe un material con el mismo hash
    const existingMaterial = await this.prisma.materiales.findFirst({
      where: { hash },
    });
    if (existingMaterial) {
      this.logger.warn(`Material duplicado detectado`);
      throw new ConflictException('Material already exists with same content');
    } 
    
    //Subir al blob
    const blobName = `${correlationId}-${filename}`;
    let fileUrl: string;
    try {
      fileUrl = await this.uploadToBlob(pdfBuffer, blobName);
    } catch (err) {
      this.logger.error('Error subiendo PDF a Blob:', err as any);
      throw new BadRequestException('Error almacenando PDF');
    }

    //Enviar mensaje a la cola de IA
    try {
      await this.sendAnalysisMessage(fileUrl, blobName, correlationId, 'analysis');
    } catch (err) {
      this.logger.error('Error enviando mensaje a IA:', err as any);
      // intentar limpiar blob si el envio falla
      await this.deleteBlobSafe(blobName, correlationId);
      throw new BadRequestException('Error enviando a IA');
    }

    //Esperar respuesta
    const response: RespuestaIADto = await this.waitForResponse(correlationId);

    //Manejar respuesta (guardar o eliminar) y retornar metadata del material
    const materialResponse = await this.handleResponse(response, 
      materialData.subject,{
      correlationId,
      filename,
      blobName,
      materialData,
      fileUrl,
      hash,
    });

    return materialResponse;
  }

  /**
   *  Sube el PDF a Azure Blob Storage
   * @param pdfBuffer  Buffer que contiene el PDF
   * @param blobName Nombre del blob en Azure Storage
   * @returns URL del blob subido
   */
  private async uploadToBlob(pdfBuffer: Buffer, blobName: string): Promise<string> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(pdfBuffer, {
      blobHTTPHeaders: { blobContentType: 'application/pdf' },
    });
    return blockBlobClient.url;
  }
  
  /**
   *  Envía un mensaje a la cola de IA para análisis o guardado
   * @param fileUrl URL del archivo en Azure Blob Storage
   * @param blobName Nombre del blob en Azure Storage
   * @param correlationId Identificador único para correlacionar mensajes
   * @param eventType Tipo de evento (e.g., 'analysis', 'save')
   */
  private async sendAnalysisMessage(fileUrl: string, blobName: string, correlationId: string, eventType: string) {
    const message: ServiceBusMessage = {
      body: {
        fileUrl,
        filename: blobName,
      },
      correlationId,
      subject: eventType,
      contentType: 'application/json',
    };
    this.logger.log(`enviando mensaje a IA...${eventType}, correlationId = ${correlationId}`);
    await this.sender.sendMessages(message);
  }

  private waitForResponse(correlationId: string): Promise<RespuestaIADto> {
    return new Promise<RespuestaIADto>((resolve, reject) => {
      // Timeout de 15 segundos
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new BadRequestException('Timeout: No se recibio respuesta de IA en 15 segundos'));
      }, 15000);

      // Resolver con la respuesta de IA y limpiar timeout
      this.pendingRequests.set(correlationId, (response: RespuestaIADto) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  /**  * Maneja la respuesta de IA: guarda el material si es válido, o elimina el blob si no lo es */
  private async handleResponse(
    response: RespuestaIADto,
    subject: string,
    ctx: {
      correlationId: string;
      filename: string;
      blobName: string;
      materialData: CreateMaterialDto;
      fileUrl: string;
      hash: string;
    },
  ): Promise<CreateMaterialResponseDto> {
    const { correlationId, filename, blobName, materialData, hash } = ctx;
    if (response.valid) {
      this.logger.log(`Material validado como VÁLIDO por IA (correlationId=${correlationId})`);
      try {
        await this.guardarMaterial(
          {
            id: correlationId,
            nombre: filename,
            userId: materialData.userId,
            url: `https://${envs.blobStorageAccountName}.blob.core.windows.net/${this.containerName}/${blobName}`,
            descripcion: materialData.description,
            vistos: 0,
            descargas: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            hash: hash,
          },
          response.tags,
          subject
        );
        this.sendAnalysisMessage('', blobName, correlationId, 'save');
        await this.enviarNotificacionNuevoMaterial(response);
        
        // Retornar respuesta exitosa 201 con formato especificado
        return {
          id: correlationId,
          title: materialData.title,
          description: materialData.description,
          subject: materialData.subject,
          filename,
          fileUrl: `https://${envs.blobStorageAccountName}.blob.core.windows.net/${this.containerName}/${blobName}`,
          createdAt: new Date(),
        };
      } catch (err) {
        this.logger.error('Error guardando material válido:', err as any);
        // intentar limpiar blob si el guardado falla
        await this.deleteBlobSafe(blobName, correlationId);
        throw new BadRequestException('Error guardando material válido');
      }
    } else {
      const reason = response.reason;
      this.logger.log(
        `Material validado como NO VÁLIDO por IA (correlationId=${correlationId})${
          reason ? ` - motivo: ${reason}` : ''
        }`
      );
      await this.deleteBlobSafe(blobName, correlationId);
      const message = reason
        ? `PDF falló la validación automatizada: ${reason}`
        : 'PDF falló la validación automatizada';
      throw new UnprocessableEntityException(message);
    }
  }

  /**  * Elimina un blob de Azure Storage de forma segura, registrando errores si ocurren */
  private async deleteBlobSafe(blobName: string, correlationId: string) {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const deleteResult = await blockBlobClient.deleteIfExists();
      if (deleteResult.succeeded) {
        this.logger.log(`Blob eliminado: ${blobName} (correlationId=${correlationId})`);
      } else {
        this.logger.warn(`No se pudo eliminar el blob (no existe o ya eliminado): ${blobName} (correlationId=${correlationId})`);
      }
    } catch (err) {
      this.logger.error(`Error eliminando blob ${blobName}:`, err as any);
    }
  }
  
  /**
   * Guarda un material y sus etiquetas asociadas en la base de datos.
   * @param material Objeto Material a guardar
   * @param tags Lista de etiquetas asociadas al material
   */
  async guardarMaterial(material: Material, tags: string[], subject: string) {
    // Usamos upsert para actualizar el registro provisional creado antes del upload
    await this.prisma.materiales.create({
      data: material,
    });
    this.logger.log(`Material guardado/actualizado en base de datos con id=${material.id}`);
    //lógica para manejar las etiquetas (tags)
    await this.guardarTags(tags, material.id, subject);
  }

  /**  * Guarda las etiquetas asociadas a un material, creando nuevas si es necesario */
  async guardarTags(tags: string[], materialId: string, subject: string) {
    const allTags = tags.concat([subject]);
    if (allTags && allTags.length > 0) {
      for (const tag of allTags) {
        // Verificar si la etiqueta ya existe
        let etiqueta = await this.prisma.tags.findUnique({
          where: { tag: tag },
        });
        // Si no existe, crearla
        if (!etiqueta) {
          etiqueta = await this.prisma.tags.create({
            data: { tag: tag },
          });
          this.logger.log(`Etiqueta creada: ${tag}`);
        }
        // Crear la relación entre material y etiqueta
        await this.prisma.materialTags.create({
          data: {
            idMaterial: materialId,
            idTag: etiqueta.id,
          },
        });
        this.logger.log(`Relación creada entre material ${materialId} y etiqueta ${etiqueta.id}`);
      }
    }
  }

  /**  * Envía una notificación a los estudiantes sobre un nuevo material subido */
  async enviarNotificacionNuevoMaterial(response: RespuestaIADto) {
    const cuerpo : NotificationDto= {
      rol: 'estudiante',
      template: 'nuevoMaterialSubido',
      resumen: `Se ha subido un nuevo materia de ${response.tema}`,
      tema: response.tema,
      materia: response.materia,
      guardar: true,
      mandarCorreo: false,
    }

    const Message : ServiceBusMessage= {
      body: cuerpo,
    }

    await this.notification.sendMessages(Message);
  }

    /**
   * Obtiene los materiales de un usuario y calcula estadísticas básicas:
   * totalVistas
   * totalDescargas
   * calificacionPromedio global (sobre todas las calificaciones de sus materiales).
   */
  async getMaterialsByUserWithStats(userId: string): Promise<UserMaterialsResponseDto> {
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
      },
    });

    const materialsDto = materiales.map((m: any) => this.toMaterialDto(m));

    // Estadísticas básicas
    const totalVistas = materiales.reduce(
      (acc: number, m: any) => acc + (m.vistos ?? 0),
      0,
    );

    const totalDescargas = materiales.reduce(
      (acc: number, m: any) => acc + (m.descargas ?? 0),
      0,
    );

    // Calificación global: promedio sobre todas las calificaciones de todos los materiales del usuario
    const todasLasCalificaciones = materiales.flatMap(
      (m: any) => m.calificaciones ?? [],
    );

    const calificacionPromedio =
      todasLasCalificaciones.length > 0
        ? todasLasCalificaciones.reduce(
            (acc: number, c: any) => acc + c.calificacion,
            0,
          ) / todasLasCalificaciones.length
        : null;

    return {
      materials: materialsDto,
      totalVistas,
      totalDescargas,
      calificacionPromedio,
    };
  }

  /**
   * Obtiene los materiales más populares en el sistema,
   * ordenados por descargas y, en segundo lugar, por vistas.
   */
  async getPopularMaterials(limit: number): Promise<MaterialDto[]> {
    const materiales = await this.prisma.materiales.findMany({
      orderBy: [
        { descargas: 'desc' },
        { vistos: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
      },
    });

    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  /**
   * Mapea el modelo de Prisma al DTO de salida para listas.
   */
  private toMaterialDto(material: any): MaterialDto {
    const promedio =
      material.calificaciones && material.calificaciones.length > 0
        ? material.calificaciones.reduce(
            (acc: number, c: any) => acc + c.calificacion,
            0,
          ) / material.calificaciones.length
        : undefined;

    return {
      id: material.id,
      nombre: material.nombre,
      userId: material.userId,
      url: material.url, 
      descripcion: material.descripcion,
      vistos: material.vistos,
      descargas: material.descargas,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      tags: material.tag?.map((t: any) => t.Tags?.tag) ?? [],
      calificacionPromedio: promedio,
    };
  }

  /**
   * Descarga un material específico.
   * 
   * Cumple con las siguientes reglas de negocio:
   * - RN-026-1: Incrementa el contador de descargas del material
   * - RN-026-3: Registra un evento de descarga en analytics vía RabbitMQ
   * 
   * Operaciones:
   * 1. Valida que el material exista en la base de datos
   * 2. Incrementa el contador de descargas (descargas++)
   * 3. Envía un evento de analytics a RabbitMQ para registrar la descarga
   * 4. Retorna la URL del material para su descarga
   * 
   * @param materialId - ID del material a descargar
   * @param userId - ID del usuario que descarga (para analytics)
   * @param clientIp - Dirección IP del cliente (opcional)
   * @param userAgent - User agent del cliente (opcional)
   * @returns Promesa que contiene la URL del archivo para descargar
   * @throws BadRequestException si el material no existe
   * @throws Error si falla el registro del evento de analytics
   */
  async downloadMaterial(
    materialId: string,
    userId: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ url: string }> {
    this.logger.log(`Iniciando descarga del material ${materialId} por usuario ${userId}`);

    // 1. Validar que el material existe
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });

    if (!material) {
      this.logger.warn(`Intento de descarga de material inexistente: ${materialId}`);
      throw new BadRequestException(`Material con id ${materialId} no existe`);
    }

    try {
      // 2. Incrementar contador de descargas (RN-026-1)
      await this.prisma.materiales.update({
        where: { id: materialId },
        data: { descargas: { increment: 1 } },
      });
      this.logger.log(`Contador de descargas incrementado para material ${materialId}`);

      // 3. Enviar evento de analytics a RabbitMQ (RN-026-3)
      await this.publishDownloadAnalyticsEvent(
        materialId,
        userId,
        material.nombre,
        clientIp,
        userAgent,
      );

      // 4. Retornar la URL del material
      return { url: material.url };
    } catch (error) {
      this.logger.error(
        `Error al procesar descarga del material ${materialId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Obtiene un stream legible del blob del material y realiza las tareas
   * asociadas a la descarga (incremento de contador y evento analytics).
   *
   * Devuelve el stream y metadatos para que el controlador lo sirva al cliente.
   */
  async getMaterialStream(
    materialId: string,
    analyticsCtx?: { userId?: string; clientIp?: string; userAgent?: string },
  ): Promise<{ stream: NodeJS.ReadableStream; contentType: string; filename: string }> {
    this.logger.log(`Preparando stream para material ${materialId}`);

    // 1. Buscar material
    const material = await this.prisma.materiales.findUnique({ where: { id: materialId } });
    if (!material) {
      this.logger.warn(`Material no encontrado: ${materialId}`);
      throw new BadRequestException(`Material con id ${materialId} no existe`);
    }

    // 2. Preparar acceso al blob y comprobar existencia antes de incrementar
    try {
      const url = new URL(material.url);
      const parts = url.pathname.split('/');
      const blobName = parts.slice(2).join('/');
      // Muchos SDKs/URLs codifican caracteres (espacios -> %20). Decodificamos para obtener el nombre real del blob.
      const decodedBlobName = decodeURIComponent(blobName);
      let blockBlobClient = this.containerClient.getBlockBlobClient(decodedBlobName);

      const exists = await blockBlobClient.exists();
      if (!exists) {
        // Intento rápido: si no existe con el nombre decodificado, probar con el nombre original (codificado)
        const fallbackClient = this.containerClient.getBlockBlobClient(blobName);
        const fallbackExists = await fallbackClient.exists();
        if (fallbackExists) {
          this.logger.log(`Blob encontrado con nombre codificado para material ${materialId}: ${blobName}`);
          // usar fallbackClient como cliente final
          blockBlobClient = fallbackClient;
        } else {
          this.logger.warn(`Blob no existe en storage para material ${materialId}: ${decodedBlobName} (decodificado) ni ${blobName} (original)`);
          throw new NotFoundException('Archivo no encontrado en almacenamiento');
        }
      }

      // 3. Incrementar contador de descargas (RN-026-1) ahora que el blob existe
      await this.prisma.materiales.update({ where: { id: materialId }, data: { descargas: { increment: 1 } } });
      this.logger.log(`Contador de descargas incrementado para material ${materialId}`);

      // 4. Publicar evento analytics de forma asíncrona (no bloquear la descarga)
      (async () => {
        try {
          await this.publishDownloadAnalyticsEvent(
            materialId,
            analyticsCtx?.userId ?? null,
            material.nombre,
            analyticsCtx?.clientIp,
            analyticsCtx?.userAgent,
          );
        } catch (err) {
          this.logger.warn(`Fallo al publicar evento analytics para ${materialId}: ${(err as Error).message}`);
        }
      })();

      // 5. Descargar/stream del blob
      const downloadResponse = await blockBlobClient.download();
      const stream = downloadResponse.readableStreamBody;
      const contentType = downloadResponse.contentType ?? 'application/pdf';
      const filename = material.nombre || decodedBlobName.split('/').pop() || 'material.pdf';

      if (!stream) {
        // Fallback a buffer si el SDK no entrega stream
        const buffer = await blockBlobClient.downloadToBuffer();
        const { Readable } = await import('node:stream');
        const fallbackStream = Readable.from(buffer);
        return { stream: fallbackStream as NodeJS.ReadableStream, contentType, filename };
      }

      return { stream, contentType, filename };
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.error(`Error obteniendo blob para material ${materialId}: ${(err as Error).message}`);
        throw err;
      }
      this.logger.error(`Error obteniendo blob para material ${materialId}: ${(err as Error).message}`);
      throw new BadRequestException('Error obteniendo archivo de almacenamiento');
    }
  }

  /**
   * Publica un evento de descarga en el bus de mensajes (RabbitMQ/Service Bus)
   * para el sistema de analytics.
   * 
   * Cumple con RN-026-3: Registrar un evento en analytics por cada descarga
   * 
   * @param materialId - ID del material descargado
   * @param userId - ID del usuario que descarga
   * @param materialName - Nombre del material
   * @param clientIp - IP del cliente (opcional)
   * @param userAgent - User agent del cliente (opcional)
   */
  private async publishDownloadAnalyticsEvent(
    materialId: string,
    userId?: string | null,
    materialName?: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      // Asegurar que la queue de analytics existe (crearla si es necesario)
      await this.ensureAnalyticsQueue();

      const analyticsEvent = {
        materialId,
        userId: userId ?? null,
        materialName: materialName ?? null,
        timestamp: new Date(),
        eventType: 'download',
        clientIp: clientIp ?? null,
        userAgent: userAgent ?? null,
      };

      const message: ServiceBusMessage = {
        body: analyticsEvent,
        subject: 'material.download',
        contentType: 'application/json',
      };

      const analyticsSender = this.client.createSender('material.analytics');
      await analyticsSender.sendMessages(message);
      await analyticsSender.close();

      this.logger.log(`Evento de descarga publicado en analytics para material ${materialId}`);
    } catch (error) {
      // No lanzar excepción para que la descarga no falle si analytics falla
      this.logger.warn(`Advertencia: Error publicando evento de analytics: ${(error as Error).message}`);
    }
  }

  /**
   * Asegura (idempotente) que la queue `material.analytics` exista en el namespace.
   * Si no puede crear/consultar la queue, registra la advertencia y no lanza.
   */
  private async ensureAnalyticsQueue(): Promise<void> {
    const queueName = 'material.analytics';
    if (this.analyticsQueueEnsured) return;
    if (!this.adminClient) {
      this.logger.warn('AdminClient no disponible; omitido ensureAnalyticsQueue');
      return;
    }
    try {
      // Intentar obtener información de la queue
      await this.adminClient.getQueue(queueName);
      this.analyticsQueueEnsured = true;
      return;
    } catch (err) {
      // Si no existe, crearla
      try {
        await this.adminClient.createQueue(queueName);
        this.analyticsQueueEnsured = true;
        this.logger.log(`Queue '${queueName}' creada en Service Bus`);
        return;
      } catch (error_) {
        this.logger.warn(`No se pudo crear la queue '${queueName}': ${(error_ as Error).message}`);
        return;
      }
    }
  }
}
