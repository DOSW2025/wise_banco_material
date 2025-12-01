import { Injectable, Logger } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage } from '@azure/service-bus';
import { inflateSync } from 'zlib';

@Injectable()
export class IAListener {
  private readonly logger = new Logger(IAListener.name);

  private receiver;
  private sender;

  constructor(private readonly client: ServiceBusClient) {

    // Recibe documentos desde la cola "material.process"
    this.receiver = this.client.createReceiver('material.process');

    // Envia respuestas a la cola "material.responses"
    this.sender = this.client.createSender('material.responses');

    this.listen(); // Inicia la escucha
  }

  listen() {
    this.receiver.subscribe({
      processMessage: async (msg) => {
        this.logger.log(`Mensaje recibido con correlationId: ${msg.correlationId}`);
        this.logger.log(`Subject: ${msg.subject}`);
        this.logger.log(`Body: ${JSON.stringify(msg.body)}`);

        // Verificar el tipo de mensaje segun subject
        if (msg.subject === 'save') {
          // Mensaje de guardado, solo logging
          this.logger.log('Mensaje de tipo "save" recibido, no requiere respuesta');
          return;
        }

        // Mensaje de analisis (subject === 'analysis')
        let buffer: Buffer | null = null;

        try {
          // Caso 1: Viene comprimido (zlib + base64)
          if (msg.body?.compressed && msg.body?.file) {
            const compressed = Buffer.from(msg.body.file, 'base64');
            buffer = inflateSync(compressed);
            this.logger.log('PDF descomprimido exitosamente');
          }
          // Caso 2: Viene normal (base64 sin comprimir)
          else if (msg.body?.file) {
            buffer = Buffer.from(msg.body.file, 'base64');
            this.logger.log('PDF decodificado desde base64');
          }
          // Caso 3: Viene con fileUrl (nuevo formato)
          else if (msg.body?.fileUrl) {
            this.logger.log(`PDF disponible en: ${msg.body.fileUrl}`);
            // En produccion, aqui descargarias el PDF desde la URL
            // Por ahora, simulamos que lo procesamos
            buffer = Buffer.from('simulated-pdf-content');
          }
        } catch (err) {
          this.logger.error(
            'Error al descomprimir el mensaje: ' + (err?.message || err)
          );
          buffer = null;
        }

        // --- Procesamiento IA ---
        const result = this.analyze(buffer ?? Buffer.alloc(0));

        // Respuesta con correlación
        const responseMessage: ServiceBusMessage = {
          body: result,
          correlationId: msg.correlationId,
          contentType: 'application/json',
        };

        await this.sender.sendMessages(responseMessage);

        this.logger.log(`Respuesta enviada con correlationId: ${msg.correlationId}`);
      },

      processError: async (error) => {
        this.logger.error('Error en el listener IA:', error);
      },
    });
  }

  // Aquí iría tu IA real
  analyze(buffer: Buffer) {
    const mensaje: ServiceBusMessage ={
      body: {valid: true, 
        reason: 'Documento válido',
        tags: ['ejemplo', 'pdf', 'verificado'],},
      correlationId: '',
      contentType: 'application/json',
    }
    return mensaje.body
  }
}
