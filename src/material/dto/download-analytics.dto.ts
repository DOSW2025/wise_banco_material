/**
 * DTO para registrar eventos de descarga en el sistema de analytics vía RabbitMQ.
 * Cumple con RN-026-3: Registrar un evento en analytics por cada descarga.
 */
export class DownloadAnalyticsDto {
  /**
   * ID del material descargado
   */
  materialId: string;

  /**
   * ID del usuario que descarga el material
   */
  userId: string;

  /**
   * Nombre del material
   */
  materialName: string;

  /**
   * Timestamp del evento de descarga
   */
  timestamp: Date;

  /**
   * Tipo de evento: 'download' o 'preview'
   */
  eventType: 'download' | 'preview';

  /**
   * IP del cliente que realiza la descarga (opcional)
   */
  clientIp?: string;

  /**
   * User agent del cliente (opcional)
   */
  userAgent?: string;
}
