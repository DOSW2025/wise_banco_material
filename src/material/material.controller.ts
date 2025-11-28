import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException, Body, Logger} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaterialService } from './material.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('material')
export class MaterialController {
  private readonly logger = new Logger(MaterialController.name);
  constructor(private readonly materialService: MaterialService,private prisma: PrismaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async subirNuevoMaterial(
    @UploadedFile() file: any, 
    @Body() body: { userId: string; descripcion?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Archivo PDF requerido en el campo "file"');
    }

    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }

    if (!body?.userId) {
      throw new BadRequestException('Campo "userId" es requerido');
    }

    // if ((await this.prisma.usuarios.findUnique({where:{id:body.userId}}))==null){
    //   throw new BadRequestException(`El userId ${body.userId} no existe en la base de datos`);
    // }

    this.logger.log(`Recibido archivo '${file.originalname}' de tamaño ${file.size} bytes para el usuario ${body.userId}, iniciando validación...`);
    // Pasamos también el nombre original del archivo, userId y descripción opcional
    const result = await this.materialService.validateMaterial(file.buffer,file.originalname,body.userId,body.descripcion);

    return result;
  }
  
}
