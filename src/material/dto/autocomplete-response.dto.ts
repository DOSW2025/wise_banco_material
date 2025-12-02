import { ApiProperty } from '@nestjs/swagger';
import { AutocompleteItemDto } from './autocomplete-item.dto';

export class AutocompleteResponseDto {
  @ApiProperty({ type: AutocompleteItemDto, isArray: true })
  listaResultados: AutocompleteItemDto[];

  @ApiProperty({ example: 3 })
  contadorResultados: number;
}
