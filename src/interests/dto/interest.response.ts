import { ApiProperty } from '@nestjs/swagger';

import type { Interest } from '../models/interest.model';

export class InterestResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Music' }) name: string;
  @ApiProperty({ example: 'music' }) slug: string;
  @ApiProperty({ example: 'arts' }) category: string;
  @ApiProperty({ example: 'music', description: 'Icon name from the app icon set' }) icon: string;

  static fromModel(i: Interest): InterestResponse {
    return Object.assign(new InterestResponse(), { id: i.id, name: i.name, slug: i.slug, category: i.category, icon: i.icon });
  }
}
