import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { Gender, ProfileVisibility } from '../models/profile.model';
import { EDUCATION_MAX, OCCUPATION_MAX } from '../profile.constants';
import { LocationDto } from './location.dto';
import {
  BioField,
  DateOfBirthField,
  DisplayNameField,
  GenderField,
  LocationField,
  ShortTextField,
} from './profile.fields';

export class CreateProfileDto {
  @DisplayNameField(true)
  displayName: string;

  @DateOfBirthField()
  dateOfBirth: string;

  @GenderField(true)
  gender: Gender;

  @BioField()
  bio?: string | null;

  @ShortTextField(OCCUPATION_MAX, 'Software engineer')
  occupation?: string | null;

  @ShortTextField(EDUCATION_MAX, 'B.Tech, IIT Delhi')
  education?: string | null;

  @LocationField()
  location?: LocationDto | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isDiscoverable?: boolean;

  @ApiPropertyOptional({ enum: ProfileVisibility, default: ProfileVisibility.Public })
  @IsOptional()
  @IsEnum(ProfileVisibility)
  profileVisibility?: ProfileVisibility;
}
