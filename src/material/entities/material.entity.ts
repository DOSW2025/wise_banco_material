import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Entidad que representa una notificación almacenada en la base de datos.
 */
@Entity('notifications')
export class Material {

    /**
     * Identificador único del material (UUID generado automáticamente).
     */
    @PrimaryGeneratedColumn()
    id!: string;

    /**
     * Nombre del material.
     */
    @Column({ type: 'varchar' })//, length: 255
    nombre!: string;

    /**
     * ID del usuario al que pertenece este material.
     */
    @Index()
    @Column({ type: 'varchar' })//, length: 255
    userId!: string;

    /**
     * URL del material almacenado en el Blob Storage.
     */
    @Column({ type: 'varchar' })//, length: 255
    url!: string;

    /**
     * Descripción del material.
     */
    @Column({ type: 'varchar', nullable: true })//, length: 255
    descripcion?: string;

    /**
     * Número de veces que el material ha sido visto.
     */
    @Column({ type: 'int', default: 0 })//, length: 255
    vistos!: number;
    
    /**
     * Número de descargas del material.
     */
    @Column({ type: 'int', default: 0 })//, length: 255
    descargas!: number;

    /**
     * Fecha en que la notificación fue creada.
     */
    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt!: Date;

    /**
     * Fecha de la última actualización del material.
     */
    @CreateDateColumn({ type: 'timestamp', default: () => 'UPDATED_TIMESTAMP' })
    updatedAt!: Date;

    /**
     * Hash del material para evitar duplicados.
     */
    @Index()
    @Column({ type: 'varchar', length: 64 })
    hash!: string;

    /**
     * Extensión del archivo del material.
     */
    @Index()
    @Column({ type: 'varchar', length: 10 })
    extension!: string;

}