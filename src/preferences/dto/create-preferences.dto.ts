import type { Gender } from '../../profiles/models/profile.model';
import type { RelationshipIntent } from '../models/dating-preference.model';
import { AgeField, MaxDistanceField, PreferredGendersField, RelationshipIntentField } from './preference.fields';

export class CreatePreferencesDto {
  @AgeField('min', true)
  minAge: number;

  @AgeField('max', true)
  maxAge: number;

  @PreferredGendersField(true)
  preferredGenders: Gender[];

  @MaxDistanceField(true)
  maxDistanceKm: number;

  @RelationshipIntentField(true)
  relationshipIntent: RelationshipIntent;
}
