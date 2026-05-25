import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsMetaDto {
  @ApiProperty()
  declare confirmed: boolean;

  @ApiProperty()
  declare mirror_ready: boolean;

  @ApiPropertyOptional({ nullable: true })
  declare mirror_last_etl: string | null;
}

export function toAnalyticsMeta(mirrorLastEtl: Date | null): AnalyticsMetaDto {
  return {
    confirmed: true,
    mirror_ready: mirrorLastEtl !== null,
    mirror_last_etl: mirrorLastEtl?.toISOString() ?? null,
  };
}
