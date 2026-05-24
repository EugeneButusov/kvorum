import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActorDto {
  @ApiProperty()
  declare actor_id: string;

  @ApiProperty()
  declare primary_address: string;

  @ApiPropertyOptional({ nullable: true })
  declare display_name: string | null;
}

export class ActorResponseDto {
  @ApiProperty({ type: ActorDto })
  declare data: ActorDto;
}
