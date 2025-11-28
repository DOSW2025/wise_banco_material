import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage } from '@azure/service-bus';
import { BlobServiceClient } from '@azure/storage-blob';
import { envs } from 'src/config';
import { RespuestaIADto } from './dto/respuestIA.dto';
import { NotificationDto } from 'src/material/dto/notificacion.dto';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { Material } from './entities/material.entity';

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);

  private sender;              // Cola donde enviamos los PDFs
  private notification;        // Cola opcional para envío de mails
  private responseReceiver;    // Cola donde recibimos respuestas
  private blobServiceClient: BlobServiceClient;
  private containerClient: any;
  private readonly containerName = 'materials';
  
  // Mapa que guarda promesas pendientes por correlationId
  private pendingRequests: Map<string, (msg: RespuestaIADto) => void> = new Map();

  constructor(private readonly client: ServiceBusClient, private prisma: PrismaService) {
    this.sender = this.client.createSender('material.process');
    this.notification = this.client.createSender('mail.envio.rol');
    this.responseReceiver = this.client.createReceiver('material.responses');
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
  async validateMaterial(pdfBuffer: Buffer, originalName: string, userId: string, descripcion?: string): Promise<RespuestaIADto> {
    const correlationId = uuid();
    this.logger.log(`Iniciando validación de material (correlationId=${correlationId})`);

    //Subir al blob
    const filename = originalName ?? 'file.pdf';
    const blobName = `${correlationId}-${filename}`.replace(/[^a-zA-Z0-9._-]/g, '_');
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

    //Manejar respuesta (guardar o eliminar)
    await this.handleResponse(response, {
      correlationId,
      filename,
      blobName,
      userId,
      descripcion,
      fileUrl,
    });

    return response;
  }

  private async uploadToBlob(pdfBuffer: Buffer, blobName: string): Promise<string> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(pdfBuffer, {
      blobHTTPHeaders: { blobContentType: 'application/pdf' },
    });
    return blockBlobClient.url;
  }

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
    this.logger.log('PDF subido a Blob Storage, enviando mensaje a IA...');
    await this.sender.sendMessages(message);
  }

  private waitForResponse(correlationId: string): Promise<RespuestaIADto> {
    return new Promise<RespuestaIADto>((resolve) => {
      this.pendingRequests.set(correlationId, resolve);
    });
  }

  private async handleResponse(
    response: RespuestaIADto,
    ctx: {
      correlationId: string;
      filename: string;
      blobName: string;
      userId: string;
      descripcion?: string;
      fileUrl: string;
    },
  ) {
    const { correlationId, filename, blobName, userId, descripcion } = ctx;
    if (response.valid) {
      this.logger.log(`Material validado como VÁLIDO por IA (correlationId=${correlationId})`);
      try {
        await this.guardarMaterial(
          {
            id: correlationId,
            nombre: filename,
            userId: userId,
            url: `https://${envs.blobStorageAccountName}.blob.core.windows.net/${this.containerName}/${blobName}`,
            descripcion: descripcion,
            vistos: 0,
            descargas: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          response.tags,
        );
        this.sendAnalysisMessage('', blobName, correlationId, 'save');
        await this.enviarNotificacionNuevoMaterial(response);
      } catch (err) {
        this.logger.error('Error guardando material válido:', err as any);
        // intentar limpiar blob si el guardado falla
        await this.deleteBlobSafe(blobName, correlationId);
        throw new BadRequestException('Error guardando material válido');
      }
    } else {
      this.logger.log(`Material validado como NO VÁLIDO por IA (correlationId=${correlationId})`);
      await this.deleteBlobSafe(blobName, correlationId);
    }
  }

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

  async guardarMaterial(material: Material, tags: string[]) {
    await this.prisma.materiales.create({data: material})
    this.logger.log(`Material guardado en base de datos con id=${material.id}`);
    //lógica para manejar las etiquetas (tags)
    await this.guardarTags(tags, material.id);
  }

  async guardarTags(tags: string[], materialId: string) {
    if (tags && tags.length > 0) {
      for (const tag of tags) {
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

  async enviarNotificacionNuevoMaterial(response: RespuestaIADto) {
    const cuerpo : NotificationDto= {
      rol: 'estudiante',
      template: 'nuevoMaterialSubido',
      resumen: `Se ha subido un nuevo materia de ${response.tema}`,
      tema: response.tema,
      materia: response.materia,
      guardar: false,
      mandarCorreo: false,
    }

    const Message : ServiceBusMessage= {
      body: cuerpo,
    }

    await this.notification.sendMessages(Message);
  }
}