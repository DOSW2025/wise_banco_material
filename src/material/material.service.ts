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
import { AutocompleteResponseDto } from './dto/autocomplete-response.dto';
import { GetMaterialRatingsResponseDto, MaterialRatingDto } from './dto/get-material-ratings.dto';
import { UserMaterialsStatsDto } from './dto/user-materials-stats.dto';

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);

  private sender;              // Cola donde enviamos los PDFs
  private notification;        // Cola opcional para envío de mails
  private responseReceiver;    // Cola donde recibimos respuestas
  private readonly adminClient?: ServiceBusAdministrationClient;
  private readonly blobServiceClient: BlobServiceClient;
  private readonly containerClient: any;
  private readonly containerName = 'materials';
  
  // Mapa que guarda promesas pendientes por correlationId
  private readonly pendingRequests: Map<string, (msg: RespuestaIADto) => void> = new Map();

  constructor(private readonly client: ServiceBusClient, private readonly prisma: PrismaService) {
    this.sender = this.client.createSender('material.process');
    this.notification = this.client.createSender('mail.envio.individual');
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
  async validateMaterial(pdfBuffer: Buffer, materialData: CreateMaterialDto, originalName?: string): Promise<CreateMaterialResponseDto> {
    // Verificar que el usuario existe
    await this.validateUserExists(materialData.userId);

    const correlationId = uuid();
    const filename = materialData.title;
    const { hash, extension } = this.calculateHashAndExtension(pdfBuffer, originalName);

    // Verificar si ya existe un material con el mismo hash
    await this.checkDuplicateHash(hash);
    
    // Subir blob y obtener respuesta de IA
    const { blobName, fileUrl, response } = await this.uploadAndAnalyze(
      pdfBuffer,
      correlationId,
      filename,
    );

    // Manejar respuesta (guardar o eliminar) y retornar metadata del material
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
   * Calcula hash SHA-256 y determina extensión del archivo
   */
  private calculateHashAndExtension(pdfBuffer: Buffer, originalName?: string): { hash: string; extension: string } {
    const hash = createHash('sha256').update(pdfBuffer).digest('hex');
    const extension = originalName ? path.extname(originalName).replace(/^\./, '').toLowerCase() : 'pdf';
    this.logger.log(`Hash calculado: ${hash}`);
    return { hash, extension };
  }

  /**
   * Verifica si ya existe un material con el mismo hash (excluyendo materialId si se proporciona)
   */
  private async checkDuplicateHash(hash: string, excludeMaterialId?: string): Promise<void> {
    const where = excludeMaterialId ? { hash, NOT: { id: excludeMaterialId } } : { hash };
    const existingMaterial = await this.prisma.materiales.findFirst({ where });
    
    if (existingMaterial) {
      this.logger.warn(`Material duplicado detectado`);
      throw new ConflictException('Material already exists with same content');
    }
  }

  /**
   * Construye la URL completa del blob en Azure Storage
   */
  private buildBlobUrl(blobName: string): string {
    return `https://${envs.blobStorageAccountName}.blob.core.windows.net/${this.containerName}/${blobName}`;
  }

  /**
   * Sube blob, envía a IA para análisis y espera respuesta
   */
  private async uploadAndAnalyze(
    pdfBuffer: Buffer,
    correlationId: string,
    filename: string,
  ): Promise<{ blobName: string; fileUrl: string; response: RespuestaIADto }> {
    const blobName = `${correlationId}-${filename}`;
    
    // Subir al blob
    let fileUrl: string;
    try {
      fileUrl = await this.uploadToBlob(pdfBuffer, blobName);
    } catch (err) {
      this.logger.error('Error subiendo PDF a Blob:', err as any);
      throw new BadRequestException('Error almacenando PDF');
    }

    // Enviar mensaje a la cola de IA
    try {
      await this.sendAnalysisMessage(fileUrl, blobName, correlationId, 'analysis');
    } catch (err) {
      this.logger.error('Error enviando mensaje a IA:', err as any);
      await this.deleteBlobSafe(blobName, correlationId);
      throw new BadRequestException('Error enviando a IA');
    }

    // Esperar respuesta
    const response = await this.waitForResponse(correlationId);
    
    return { blobName, fileUrl, response };
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
      // Resolver con la respuesta de IA y limpiar timeout
      this.pendingRequests.set(correlationId, (response: RespuestaIADto) => {
        resolve(response);
      });
    });
  }

  /**
   * Maneja la respuesta de IA: guarda el material si es válido, o elimina el blob si no lo es
   */
  private async handleResponse(
    response: RespuestaIADto,
    subject: string | undefined,
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
            url: this.buildBlobUrl(blobName),
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
        await this.enviarNotificacion(response, materialData.userId, filename, "nuevoMaterialSubido");
        
        // Retornar respuesta exitosa 201 con formato especificado
        return {
          id: correlationId,
          title: materialData.title,
          description: materialData.description,
          subject: materialData.subject,
          filename,
          fileUrl: this.buildBlobUrl(blobName),
          createdAt: new Date(),
        };
      } catch (err) {
        this.logger.error('Error guardando material válido:', err as any);
        // intentar limpiar blob si el guardado falla
        await this.deleteBlobSafe(blobName, correlationId);
        throw new BadRequestException('Error guardando material válido');
      }
    } else {
      const reason = response.detalles;
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
   * @param subject Materia o tema del material (opcional)
   */
  async guardarMaterial(material: Material, tags: string[], subject?: string) {
    // Usamos upsert para actualizar el registro provisional creado antes del upload
    await this.prisma.materiales.create({
      data: material,
    });
    this.logger.log(`Material guardado/actualizado en base de datos con id=${material.id}`);
    //lógica para manejar las etiquetas (tags)
    await this.guardarTags(tags, material.id, subject);
  }

  /**
   * Guarda las etiquetas asociadas a un material, creando nuevas si es necesario
   * @param tags Lista de etiquetas de la IA
   * @param materialId ID del material
   * @param subject Materia o tema del material (opcional, se agrega como etiqueta si se proporciona)
   */
  async guardarTags(tags: string[], materialId: string, subject?: string) {
    const allTags = subject ? tags.concat([subject]) : tags;
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
  async enviarNotificacion(response: RespuestaIADto, userId: string, filename: string, template: string) {
    const user = await this.prisma.usuarios.findUnique({where: {id: userId}});

    const cuerpo : NotificationDto= {
      email: user?.email || 'estudiante',
      name: user?.nombre || 'Estudiante',
      template: template,
      resumen: `Se ha subido un nuevo materia de ${response.tema}`,
      fileName: filename,
      tema: response.tema,
      materia: response.materia,
      guardar: true,
      mandarCorreo: true,
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
   * Obtiene las estadísticas agregadas de todos los materiales de un usuario
   * @param userId - ID del usuario
   * @returns Objeto con estadísticas: calificacionPromedio, totalMateriales, totalDescargas, totalVistas
   */
  async getUserMaterialsStats(userId: string): Promise<UserMaterialsStatsDto> {
    // Validar que el usuario existe
    const userExists = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    if (!userExists) {
      throw new NotFoundException(`El usuario ${userId} no existe`);
    }

    // Obtener todos los materiales del usuario
    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      include: { Calificaciones: true },
    });

    // Calcular estadísticas
    const totalMateriales = materiales.length;

    const totalDescargas = materiales.reduce(
      (acc: number, m: any) => acc + (m.descargas ?? 0),
      0,
    );

    const totalVistas = materiales.reduce(
      (acc: number, m: any) => acc + (m.vistos ?? 0),
      0,
    );

    // Obtener todas las calificaciones de todos los materiales del usuario
    const todasLasCalificaciones = materiales.flatMap(
      (m: any) => m.Calificaciones ?? [],
    );

    const calificacionPromedio =
      todasLasCalificaciones.length > 0
        ? todasLasCalificaciones.reduce(
            (acc: number, c: any) => acc + c.calificacion,
            0,
          ) / todasLasCalificaciones.length
        : 0;

    return {
      userId,
      calificacionPromedio,
      totalMateriales,
      totalDescargas,
      totalVistas,
    };
  }

  /**
   * Obtiene los top 3 materiales más descargados de un usuario
   * @param userId - ID del usuario
   * @returns Array de materiales ordenados por descargas descendentes
   */
  async getTopDownloadedMaterials(userId: string): Promise<MaterialDto[]> {
    // Validar que el usuario existe
    const userExists = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    if (!userExists) {
      throw new NotFoundException(`El usuario ${userId} no existe`);
    }

    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      orderBy: { descargas: 'desc' },
      take: 3,
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });

    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  /**
   * Obtiene los top 3 materiales más vistos de un usuario
   * @param userId - ID del usuario
   * @returns Array de materiales ordenados por vistas descendentes
   */
  async getTopViewedMaterials(userId: string): Promise<MaterialDto[]> {
    // Validar que el usuario existe
    const userExists = await this.prisma.usuarios.findUnique({
      where: { id: userId },
    });
    if (!userExists) {
      throw new NotFoundException(`El usuario ${userId} no existe`);
    }

    const materiales = await this.prisma.materiales.findMany({
      where: { userId },
      orderBy: { vistos: 'desc' },
      take: 3,
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });

    return materiales.map((m: any) => this.toMaterialDto(m));
  }

  /**
   * Obtiene todos los materiales del sistema con paginación opcional.
   */
  async getAllMaterials(skip?: number, take?: number): Promise<MaterialDto[]> {
    const materiales = await this.prisma.materiales.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
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
      totalDescargas: material.descargas,
      totalVistas: material.vistos,
    };
  }

  /**
   * Obtiene todas las calificaciones de un material
   * @param materialId - ID del material
   * @returns Lista de calificaciones del material
   */
  async getMaterialRatingsList(
    materialId: string,
  ): Promise<MaterialRatingDto[]> {
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

    return calificaciones.map((c: any) => ({
      id: c.id,
      calificacion: c.calificacion,
      comentario: c.comentario ?? null,
      createdAt: c.createdAt,
    }));
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

  /**
   * Obtiene la información detallada de un material específico.
   * Retorna metadata completa, calificación promedio y URL de previsualización.
   *
   * @param materialId - ID del material a obtener
   * @returns Objeto con metadata, calificación y previewURL
   */
  async getMaterialDetail(materialId: string): Promise<any> {
    const material = await this.prisma.materiales.findUnique({
      where: { id: materialId },
      include: {
        MaterialTags: { include: { Tags: true } },
        Calificaciones: true,
        usuarios: { select: { nombre: true } },
      },
    });

    if (!material) {
      throw new NotFoundException(`Material con id ${materialId} no encontrado`);
    }

    // Calcular calificación promedio
    const calificacionPromedio =
      material.Calificaciones && material.Calificaciones.length > 0
        ? material.Calificaciones.reduce(
            (acc: number, c: any) => acc + c.calificacion,
            0,
          ) / material.Calificaciones.length
        : null;
    await this.incrementViews(materialId);
    return {
      metadata: {
        id: material.id,
        nombre: material.nombre,
        descripcion: material.descripcion,
        userId: material.userId,
        userName: material.usuarios?.nombre,
        vistos: material.vistos,
        descargas: material.descargas,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
        tags: material.MaterialTags?.map((mt: any) => mt.Tags?.tag) ?? [],
      },
      calificación: calificacionPromedio,
      previewURL: material.url,
    };
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

  /**
 * Actualiza la versión de un material existente:
 * - Opcionalmente reemplaza el archivo PDF en Blob Storage
 * - Actualiza: archivo (opcional), título, descripción
 * - Mantiene los tags existentes
 */
async updateMaterialVersion(
  materialId: string,
  pdfBuffer: Buffer | undefined,
  title: string,
  description?: string,
  originalName?: string,
): Promise<any> {
  // Verificar que el material existe
  const existing = await this.prisma.materiales.findUnique({
    where: { id: materialId },
  });

  if (!existing) {
    this.logger.warn(`Intento de actualizar material inexistente: ${materialId}`);
    throw new NotFoundException('Material no encontrado');
  }

  let hash = existing.hash;
  let extension = existing.extension;
  let newFileUrl = existing.url;
  let blobName: string | null = null;
  let correlationId: string | null = null;

  // Si se proporciona un nuevo archivo, procesarlo
  if (pdfBuffer) {
    correlationId = uuid();
    const filename = title;
    const hashResult = this.calculateHashAndExtension(pdfBuffer, originalName);
    hash = hashResult.hash;
    extension = hashResult.extension;

    // Verificar hash duplicado (excluyendo el material actual)
    await this.checkDuplicateHash(hash, materialId);

    // Subir blob y obtener respuesta de IA
    const uploadResult = await this.uploadAndAnalyze(
      pdfBuffer,
      correlationId,
      filename,
    );
    blobName = uploadResult.blobName;
    const response = uploadResult.response;

    // Validar respuesta de IA
    if (!response.valid) {
      const reason = response.detalles;
      this.logger.log(
        `Material actualizado marcado como NO VÁLIDO por IA (correlationId=${correlationId})` +
          (reason ? ` - motivo: ${reason}` : ''),
      );
      await this.deleteBlobSafe(blobName, correlationId);
      const message = reason
        ? `PDF falló la validación automatizada: ${reason}`
        : 'PDF falló la validación automatizada';
      throw new UnprocessableEntityException(message);
    }

    this.logger.log(
      `Material validado como VÁLIDO por IA en actualización (correlationId=${correlationId})`,
    );

    newFileUrl = this.buildBlobUrl(blobName);
  }

  // Actualizar material en BD
  const updated = await this.prisma.materiales.update({
    where: { id: materialId },
    data: {
      nombre: title,
      descripcion: description || existing.descripcion,
      ...(newFileUrl && newFileUrl !== existing.url && { url: newFileUrl }),
      extension,          
      hash,
      updatedAt: new Date(),
    },
  });

  // Si se subió un nuevo archivo, registrar análisis y eliminar el anterior
  if (blobName && correlationId) {
    await this.sendAnalysisMessage('', blobName, correlationId, 'save');
    await this.deleteOldBlob(existing.url, materialId);
  }

  return {
    id: updated.id,
    title,
    description: description || existing.descripcion,
    filename: title,
    fileUrl: updated.url,
    createdAt: existing.createdAt, 
    message: 'Material actualizado correctamente',
  };
}

/**
 * Valida que un usuario existe en la base de datos
 */
private async validateUserExists(userId: string): Promise<void> {
  const userExists = await this.prisma.usuarios.findUnique({
    where: { id: userId },
  });
  if (!userExists) {
    throw new BadRequestException(
      `El userId ${userId} no existe en la base de datos`,
    );
  }
}

/**
 * Elimina el blob anterior de un material de forma segura
 */
private async deleteOldBlob(oldUrl: string | null, materialId: string): Promise<void> {
  try {
    if (oldUrl) {
      const url = new URL(oldUrl);
      const parts = url.pathname.split('/');
      const oldBlobName = decodeURIComponent(parts.slice(2).join('/'));
      await this.deleteBlobSafe(oldBlobName, materialId);
    }
  } catch (err) {
    this.logger.warn(
      `No se pudo eliminar el blob anterior para material ${materialId}: ${(err as Error).message}`,
    );
  }
}

/**
 * Obtiene la cantidad total de materiales en el sistema
 */
async getMaterialsCount(): Promise<{ Count: number }> {
  const count = await this.prisma.materiales.count();
  return { Count: count };
}

/**
 * Elimina un material por ID
 * - Valida que el material exista
 * - Elimina el blob de Azure Storage
 * - Elimina registros relacionados (cascada)
 * - Elimina el material de la base de datos
 */
async deleteMaterial(materialId: string): Promise<{ message: string }> {
  // Verificar que el material existe
  const material = await this.prisma.materiales.findUnique({
    where: { id: materialId },
  });

  if (!material) {
    throw new NotFoundException(
      `El material con ID ${materialId} no existe`,
    );
  }

  // Eliminar el blob de Azure Storage de forma segura
  if (material.url) {
    await this.deleteOldBlob(material.url, materialId);
  }

  // Eliminar el material (la cascada en Prisma eliminará Calificaciones, MaterialTags y Resumen)
  await this.prisma.materiales.delete({
    where: { id: materialId },
  });

  this.logger.log(`Material ${materialId} eliminado correctamente`);

  return {
    message: `Material ${materialId} eliminado correctamente`,
  };
}

}
