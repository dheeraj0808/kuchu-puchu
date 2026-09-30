import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** Hard cap independent of config; the configured PROFILE_MAX_INTERESTS is enforced in the service. */
export const INTEREST_IDS_HARD_CAP = 50;

export class UpdateProfileInterestsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Full replacement set of interest ids (empty array clears). Order is ignored.',
    example: ['6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'],
  })
  @IsArray()
  @ArrayMaxSize(INTEREST_IDS_HARD_CAP)
  @ArrayUnique({ message: 'interestIds must not contain duplicates' })
  @IsUUID('4', { each: true, message: 'each value in interestIds must be a UUID' })
  interestIds: string[];
}
