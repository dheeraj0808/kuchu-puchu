import { ApiProperty } from '@nestjs/swagger';

export enum ProfileField {
  DisplayName = 'displayName',
  DateOfBirth = 'dateOfBirth',
  Gender = 'gender',
  Bio = 'bio',
  Location = 'location',
  Occupation = 'occupation',
  Education = 'education',
  Interests = 'interests',
}

export class ProfileCompletionResponse {
  @ApiProperty({ minimum: 0, maximum: 100, example: 70 })
  profileCompletion: number;

  @ApiProperty({ enum: ProfileField, isArray: true, example: ['bio', 'interests'] })
  missingFields: ProfileField[];
}
