import { IsString, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';


export class RespuestaIADto {

    @ApiProperty({ description: 'Indica si el material es válido' })
    @IsBoolean()
    valid: boolean;

    @ApiProperty({ description: 'Etiquetas asociadas al material', required: false, type: [String] })
    @IsOptional()
    @Type(() => String)
    @IsString({ each: true })
    tags: string[];

    @ApiProperty({ description: 'Tema asociado al material', required: false })
    @IsOptional()
    @IsString()
    tema?: string;

    @ApiProperty({ description: 'Materia asociada al material', required: false })
    @IsOptional()
    @IsString()
    materia?: string;

    @ApiProperty({ description: 'Motivo por el cual el material no es válido', required: false })
    @IsOptional()
    @IsString()
    detalles?: string;

}