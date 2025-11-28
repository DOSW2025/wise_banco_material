import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class NotificationDto {

    @IsString()
    @IsOptional()
    rol?: string;

    @IsString()
    @ApiProperty({ example: 'nuevoMaterialSubido', required: true })
    template!: string;

    @IsString()
    @ApiProperty({ required: true, example: 'Resumen del correo' })
    resumen!: string;

    @IsBoolean()
    @ApiProperty({ required: true, example: true })
    guardar!: boolean;
    
    @IsOptional()
    @IsBoolean()
    @Type(() => Boolean)
    @ApiProperty({ required: false, example: true })
    mandarCorreo?: boolean = true;

    @IsString()
    @IsOptional()
    materia?: string;

    @IsString()
    @IsOptional()
    tema?: string;

}