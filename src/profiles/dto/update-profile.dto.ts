import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, ValidateIf } from 'class-validator';

import { Gender, ProfileVisibility } from '../models/profile.model';
import { EDUCATION_MAX, OCCUPATION_MAX } from '../profile.constants';
import { LocationDto } from './location.dto';
import { BioField, DisplayNameField, GenderField, LocationField, ShortTextField } from './profile.fields';

/**
 * Partial update. `dateOfBirth` is intentionally not updatable (age integrity);
 * sending it is rejected by forbidNonWhitelisted. Optional text fields and
 * `location` accept null to clear.
 */
export class UpdateProfileDto {
  @DisplayNameField(false)
  displayName?: string;

  @GenderField(false)
  gender?: Gender;

  @BioField()
  bio?: string | null;

  @ShortTextField(OCCUPATION_MAX, 'Software engineer')
  occupation?: string | null;

  @ShortTextField(EDUCATION_MAX, 'B.Tech, IIT Delhi')
  education?: string | null;

  @LocationField()
  location?: LocationDto | null;

  @ApiPropertyOptional()
  @ValidateIf((_o: object, v: unknown) => v !== undefined)
  @IsBoolean()
  isDiscoverable?: boolean;

  @ApiPropertyOptional({ enum: ProfileVisibility })
  @ValidateIf((_o: object, v: unknown) => v !== undefined)
  @IsEnum(ProfileVisibility)
  profileVisibility?: ProfileVisibility;
}
