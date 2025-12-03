import { Injectable, BadRequestException, Logger, ConflictException, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage, ServiceBusAdministrationClient } from '@azure/service-bus';
import { BlobServiceClient } from '@azure/storage-blob';
import { createHash } from 'node:crypto';
import * as path from 'path';
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
import { RateMaterialResponseDto } from './dto/rate-material-response.dto';
import { PaginatedMaterialsDto } from './dto/paginated-materials.dto';
import { AutocompleteResponseDto } from './dto/autocomplete-response.dto';
import { GetMaterialRatingsResponseDto } from './dto/get-material-ratings.dto';

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
    // Programar envío semanal de top materiales cada lunes
    this.scheduleWeeklyTopMaterials();
  }

  /**
   * Programa la tarea semanal para enviar el top 5 de materiales cada lunes a las 08:00.
   */
  private scheduleWeeklyTopMaterials() {
    const runWeekly = async () => {
      try {
        await this.sendWeeklyTopMaterialsEmail();
      } catch (err) {
        this.logger.error('Error enviando top materials semanal:', err as any);
      }
    };

    const nextMondayAt8 = this.getNextWeekdayDate(1, 8, 0, 0); // 1 = Monday
    const now = new Date();
    const initialDelay = nextMondayAt8.getTime() - now.getTime();

    // Si por alguna razón el delay es negativo, ejecutar inmediatamente
    const safeInitialDelay = initialDelay > 0 ? initialDelay : 0;

    // Programar la primera ejecución
    setTimeout(() => {
      // Ejecutar la tarea y luego programar intervalos semanales
      runWeekly();
      setInterval(runWeekly, 7 * 24 * 60 * 60 * 1000); // 7 días
    }, safeInitialDelay);
  }

  /**
   * Retorna la próxima fecha del día de la semana dado (0=Sunday,1=Monday...) a la hora especificada.
   */
  private getNextWeekdayDate(weekday: number, hour = 8, minute = 0, second = 0): Date {
    const now = new Date();
    const result = new Date(now);
    result.setHours(hour, minute, second, 0);
    const diff = (weekday + 7 - result.getDay()) % 7;
    if (diff === 0 && result.getTime() <= now.getTime()) {
      // Ya pasó la hora de hoy, programar para la próxima semana
      result.setDate(result.getDate() + 7);
    } else if (diff > 0) {
      result.setDate(result.getDate() + diff);
    }
    return result;
  }

  /**
   * Obtiene los top N materiales y envía una notificación por correo con el listado.
   */
  private async sendWeeklyTopMaterialsEmail() {
    this.logger.log('Preparando envío semanal de top materiales...');
    const topMaterials = await this.getPopularMaterials(5);

    const resumen = `Top ${topMaterials.length} materiales de la semana`;

    const cuerpo: any = {
      rol: 'estudiante',
      template: 'top5Semanal',
      resumen,
      guardar: false,
      mandarCorreo: true,
      topMaterials: topMaterials.map((m) => ({ id: m.userId,userName: m.userName, title: m.nombre, url: m.url, views: m.vistos, downloads: m.descargas })),
    };

    const message: ServiceBusMessage = {
      body: cuerpo,
    };

    await this.notification.sendMessages(message);
    this.logger.log('Envío semanal de top materiales encolado');
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
  async validateMaterial(pdfBuffer: Buffer, materialData: CreateMaterialDto, originalName?: string): Promise<CreateMaterialResponseDto> {
    const correlationId = uuid();

    // Calcular hash (SHA-256) y crear registro provisional en BD para evitar duplicados
    const filename = materialData.title;
    // Determinar extension desde el nombre original del archivo si está disponible
    const extension = originalName ? path.extname(originalName).replace(/^\./, '').toLowerCase() : 'pdf';
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
      materialData.subject, {
        correlationId,
        filename,
        blobName,
        materialData,
        fileUrl,
        hash,
        extension,
      },
    );

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
      extension: string;
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
            extension: ctx.extension,
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
        usuarios: { select: { nombre: true } },
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
      (m: any) => m.Calificaciones ?? [],
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
      take: Number(limit),
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });

    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  /**
   * Mapea el modelo de Prisma al DTO de salida para listas.
   */
  private toMaterialDto(material: any): MaterialDto {
    // calcular promedio usando la relación exacta devuelta por Prisma: Calificaciones
    const promedio =
      material.Calificaciones && material.Calificaciones.length > 0
        ? material.Calificaciones.reduce(
            (acc: number, c: any) => acc + c.calificacion,
            0,
          ) / material.Calificaciones.length
        : undefined;

    return {
      id: material.id,
      nombre: material.nombre,
      userId: material.userId,
      userName: material.usuarios?.nombre ?? undefined,
      extension: material.extension,
      url: material.url,
      descripcion: material.descripcion,
      vistos: material.vistos,
      descargas: material.descargas,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      tags: material.MaterialTags?.map((mt: any) => mt.Tags?.tag) ?? [],
      calificacionPromedio: promedio,
      totalComentarios: material.Calificaciones.length ?? 0,
    };
  }

  /**
   * Registra una calificación para un material y devuelve el promedio actualizado.
   */
  async rateMaterial(
    materialId: string,
    userId: string,
    rating: number,
    comentario?: string | null,
  ): Promise<RateMaterialResponseDto> {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('La calificación debe estar entre 1 y 5');
    }

    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      this.logger.warn(
        `Intento de calificar material inexistente: ${materialId} (userId=${userId})`,
      );
      throw new NotFoundException('Material no encontrado');
    }

    const usuario = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    if (!usuario) {
      this.logger.warn(
        `Intento de calificar por usuario inexistente: ${userId} (materialId=${materialId})`,
      );
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.prisma.calificaciones.create({
      data: {
        idMaterial: materialId,
        calificacion: rating,
        comentario: comentario ?? undefined,
      },
    });

    const aggregate = await this.prisma.calificaciones.aggregate({
      where: { idMaterial: materialId },
      _avg: { calificacion: true },
      _count: { _all: true },
    });

    const promedio = aggregate._avg.calificacion ?? 0;
    const totalCalificaciones = aggregate._count._all;

    const response: RateMaterialResponseDto = {
      materialId,
      rating,
      comentario: comentario ?? null,
      calificacionPromedio: promedio,
      totalCalificaciones,
    };

    return response;
  }

  /**
   * Obtiene todas las calificaciones de un material y devuelve el promedio.
   * 
   * @param materialId - ID del material
   * @returns Objeto con lista de calificaciones y el promedio
   */
  async getMaterialRatings(
    materialId: string,
  ): Promise<GetMaterialRatingsResponseDto> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    if (!material) {
      this.logger.warn(`Intento de obtener calificaciones de material inexistente: ${materialId}`);
      throw new NotFoundException('Material no encontrado');
    }

    const calificaciones = await this.prisma.calificaciones.findMany({
      where: { idMaterial: materialId },
      orderBy: { createdAt: 'desc' },
    });

    const totalCalificaciones = calificaciones.length;
    const calificacionPromedio =
      totalCalificaciones > 0
        ? calificaciones.reduce((acc: number, c: any) => acc + c.calificacion, 0) / totalCalificaciones
        : 0;

    return {
      materialId,
      calificacionPromedio,
      totalCalificaciones,
      calificaciones: calificaciones.map((c: any) => ({
        id: c.id,
        calificacion: c.calificacion,
        comentario: c.comentario ?? null,
        createdAt: c.createdAt,
      })),
    };
  }
      
   /*
   * Obtiene un stream legible del blob del material y realiza las tareas
   * asociadas a la descarga (incremento de contador y evento analytics).
   *
   * Devuelve el stream y metadatos para que el controlador lo sirva al cliente.
   */
  async downloadMaterial(materialId: string) {
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

      // Descargar/stream del blob
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
      //Incrementar contador de descargas (RN-026-1) ahora que el blob existe
      await this.incrementDownloads(materialId);
      this.logger.log(`Contador de descargas incrementado para material ${materialId}`);

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

  

    /**   * Incrementa el contador de vistas de un material específico.
   */
  async incrementViews(materialId: string): Promise<void> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    
    if (!material) {
      throw new BadRequestException(`Material con ID ${materialId} no encontrado`);
    }
    await this.prisma.materiales.update({
      where: { id: materialId },
      data: { vistos: { increment: 1 } },
    });
  }

  /**
   * Busca materiales con filtros avanzados y paginación
   */
  async searchMaterials(
    palabraClave?: string,
    materia?: string,
    autor?: string,
    tipoMaterial?: string,
    semestre?: number,
    calificacionMin?: number,
    page: number = 1,
    size: number = 10,
  ): Promise<{ materials: MaterialDto[]; total: number }> {
    const whereConditions: any = {};
    const skip = (page - 1) * size;

    // Filtro por palabra clave (busca en nombre y descripción)
    if (palabraClave) {
      whereConditions.OR = [
        { nombre: { contains: palabraClave, mode: 'insensitive' } },
        { descripcion: { contains: palabraClave, mode: 'insensitive' } },
      ];
    }

    // Filtro por autor (userId)
    if (autor) {
      whereConditions.userId = autor;
    }

    // Filtro por tipo de material (asumiendo que está en el nombre del archivo)
    if (tipoMaterial) {
      whereConditions.extension = { contains: tipoMaterial, mode: 'insensitive' };
    }

    // Filtro por semestre (asumiendo que está en los tags o descripción)
    if (semestre) {
      whereConditions.descripcion = { contains: semestre.toString(), mode: 'insensitive' };
    }

    // Obtener materiales con paginación
    const [materiales, total] = await Promise.all([
      this.prisma.materiales.findMany({
        where: whereConditions,
        include: {
          MaterialTags: { include: { Tags: true } },
          Calificaciones: true,
          usuarios: { select: { nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: size,
      }),
      this.prisma.materiales.count({ where: whereConditions }),
    ]);

    // Filtrar por materia (tags) y calificación mínima
    let materialesFiltrados = materiales;
    
    if (materia) {
      materialesFiltrados = materialesFiltrados.filter((m: any) =>
        m.MaterialTags?.some((mt: any) =>
          mt.Tags?.tag.toLowerCase().includes(materia.toLowerCase()),
        ),
      );
    }

    if (calificacionMin) {
      materialesFiltrados = materialesFiltrados.filter((m: any) => {
        if (!m.Calificaciones || m.Calificaciones.length === 0) return false;
        const promedio = m.Calificaciones.reduce((acc: number, c: any) => acc + c.calificacion, 0) / m.Calificaciones.length;
        return promedio >= calificacionMin;
      });
    }

    return {
      materials: materialesFiltrados.map((m: any) => this.toMaterialDto(m)),
      total: materialesFiltrados.length,
    };
  }
  
  /**
   * Asegura (idempotente) que la queue `material.analytics` exista en el namespace.
   * Si no puede crear/consultar la queue, registra la advertencia y no lanza.
   * Obtiene las estadísticas de un material específico
   */
  async getMaterialStats(materialId: string): Promise<MaterialDto> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });

    return this.toMaterialDto(material);
  }
    /**   * Incrementa el contador de vistas de un material específico.
   */
  private async incrementDownloads(materialId: string): Promise<void> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
    });
    
    if (!material) {
      throw new BadRequestException(`Material con ID ${materialId} no encontrado`);
    }
    await this.prisma.materiales.update({
      where: { id: materialId },
      data: { descargas: { increment: 1 } },
    });
  }

  /**
   *
   * Entrada:
   * - query (palabraClave): texto ingresado por el usuario
   * - materia: filtro opcional 
   * - autor: filtro opcional 
   *
   * Salida:
   * - listaResultados: lista de máx. 5 materiales con título, autor, materia, calificación, descargas
   * - contadorResultados: número total de coincidencias 
   *
   */
  async autocompleteMaterials(
    palabraClave: string,
    materia?: string,
    autor?: string,   
  ): Promise<AutocompleteResponseDto> {
    const term = palabraClave?.trim();

    if (!term || term.length < 1) {
      throw new BadRequestException(
        'La palabra clave debe tener al menos 1 carácter',
      );
    }

    const whereBase: any = {
      OR: [
        { nombre: { contains: term, mode: 'insensitive' } },
        { descripcion: { contains: term, mode: 'insensitive' } },
      ],
    };

    if (autor) {
      whereBase.usuarios = {
        OR: [
          { nombre: { contains: autor, mode: 'insensitive' } },
          { apellido: { contains: autor, mode: 'insensitive' } },
        ],
      };
    }

    const contadorResultados = await this.prisma.materiales.count({
      where: whereBase,
    });

    if (contadorResultados === 0) {
      return {
        listaResultados: [],
        contadorResultados: 0,
      };
    }

    const select = {
      id: true,
      nombre: true,
      descripcion: true,
      descargas: true,
      usuarios: {
        select: { nombre: true, apellido: true },
      },
    };

    const sugerencias: any[] = [];
    const seen = new Set<string>();

    const addUnique = (arr: any[]) => {
      for (const item of arr) {
        if (sugerencias.length >= 5) break;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        sugerencias.push(item);
      }
    };

    const inicio = await this.prisma.materiales.findMany({
      where: {
        AND: [
          whereBase,
          {
            nombre: { startsWith: term, mode: 'insensitive' },
          },
        ],
      },
      select,
      take: 5,
    });
    addUnique(inicio);

    if (sugerencias.length < 5) {
      const contieneTitulo = await this.prisma.materiales.findMany({
        where: {
          AND: [
            whereBase,
            {
              nombre: {
                contains: term,
                mode: 'insensitive',
              },
            },
            {
              NOT: {
                nombre: {
                  startsWith: term,
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
        select,
        take: 5,
      });
      addUnique(contieneTitulo);
    }

    if (sugerencias.length < 5) {
      const descripcionMatches = await this.prisma.materiales.findMany({
        where: {
          AND: [
            whereBase,
            {
              descripcion: {
                contains: term,
                mode: 'insensitive',
              },
            },
          ],
        },
        select,
        take: 5,
      });
      addUnique(descripcionMatches);
    }

    const listaResultados: AutocompleteResponseDto['listaResultados'] = [];


    for (const mat of sugerencias) {
      const promedioAgg = await this.prisma.calificaciones.aggregate({
        where: { idMaterial: mat.id },
        _avg: { calificacion: true },
      });

      const autorNombre = mat.usuarios
        ? `${mat.usuarios.nombre} ${mat.usuarios.apellido}`.trim()
        : null;

      listaResultados.push({
        id: mat.id,
        titulo: mat.nombre,
        autor: autorNombre,
        materia: null, 
        calificacionPromedio: promedioAgg._avg.calificacion ?? null,
        descargas: mat.descargas,
      });
    }

    return {
      listaResultados,
      contadorResultados,
    };
  }
}
