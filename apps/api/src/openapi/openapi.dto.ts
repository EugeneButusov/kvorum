import { ApiProperty } from '@nestjs/swagger';

export class PaginationDto {
  @ApiProperty()
  declare limit: number;

  @ApiProperty({ nullable: true })
  declare next_cursor: string | null;

  @ApiProperty()
  declare has_more: boolean;
}

export class ProblemDto {
  @ApiProperty()
  declare type: string;

  @ApiProperty()
  declare title: string;

  @ApiProperty()
  declare status: number;

  @ApiProperty()
  declare detail: string;

  @ApiProperty()
  declare instance: string;

  @ApiProperty({ required: false, type: 'array', items: { type: 'object' } })
  declare violations?: unknown[];
}
