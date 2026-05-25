import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetaDto } from './analytics-meta.dto';
import { PaginationDto } from '../openapi/openapi.dto';

export class DelegateAlignmentQueryDto {
  @ApiProperty()
  declare delegate: string;

  @ApiPropertyOptional({ type: Number })
  declare limit?: number;

  @ApiPropertyOptional()
  declare cursor?: string;

  @ApiPropertyOptional({ example: '-vote_count' })
  declare sort?: string;

  @ApiPropertyOptional()
  declare from?: string;

  @ApiPropertyOptional()
  declare to?: string;
}

export class DelegateAlignmentPeerDto {
  @ApiProperty()
  declare actor_id: string;

  @ApiProperty()
  declare address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty()
  declare vote_count: number;

  @ApiProperty()
  declare shared_proposals: number;

  @ApiProperty()
  declare alignment_score: number;
}

export class DelegateAlignmentFocalDto {
  @ApiProperty()
  declare actor_id: string;

  @ApiProperty()
  declare address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;
}

export class DelegateAlignmentResponseDto {
  @ApiProperty({ type: DelegateAlignmentFocalDto })
  declare focal_delegate: DelegateAlignmentFocalDto;

  @ApiProperty({ type: () => [DelegateAlignmentPeerDto] })
  declare peers: DelegateAlignmentPeerDto[];

  @ApiProperty({ type: PaginationDto })
  declare pagination: PaginationDto;

  @ApiProperty({ type: AnalyticsMetaDto })
  declare _meta: AnalyticsMetaDto;
}
