import { ApiProperty } from '@nestjs/swagger';

import type { Interest } from '../models/interest.model';

export class InterestResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Music' }) name: string;
  @ApiProperty({ example: 'music' }) slug: string;

  static fromModel(i: Interest): InterestResponse {
    return Object.assign(new InterestResponse(), { id: i.id, name: i.name, slug: i.slug });
  }
}
