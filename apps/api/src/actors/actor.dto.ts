import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActorDto {
  @ApiProperty()
  declare actor_id: string;

  @ApiProperty()
  declare primary_address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;

  @ApiProperty({ type: () => [ActorAddressDto] })
  declare all_addresses: ActorAddressDto[];
}

export class ActorAddressDto {
  @ApiProperty()
  declare address: string;

  @ApiProperty()
  declare is_primary: boolean;

  @ApiProperty()
  declare source: string;
}

export class ActorResponseDto {
  @ApiProperty({ type: ActorDto })
  declare data: ActorDto;
}
