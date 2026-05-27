import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { isoSeconds } from '../http/iso';

export class AnalyticsMetaDto {
  @ApiProperty()
  declare confirmed: boolean;

  @ApiPropertyOptional({ nullable: true })
  declare derived_through: string | null;
}

export function toAnalyticsMeta(derivedThrough: Date | null): AnalyticsMetaDto {
  return {
    confirmed: true,
    derived_through: isoSeconds(derivedThrough),
  };
}
