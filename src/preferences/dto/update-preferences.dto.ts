import type { Gender } from '../../profiles/models/profile.model';
import type { RelationshipIntent } from '../models/dating-preference.model';
import { AgeField, MaxDistanceField, PreferredGendersField, RelationshipIntentField } from './preference.fields';

/** Partial update; the merged result is re-validated (e.g. minAge <= maxAge) in the service. */
export class UpdatePreferencesDto {
  @AgeField('min', false)
  minAge?: number;

  @AgeField('max', false)
  maxAge?: number;

  @PreferredGendersField(false)
  preferredGenders?: Gender[];

  @MaxDistanceField(false)
  maxDistanceKm?: number;

  @RelationshipIntentField(false)
  relationshipIntent?: RelationshipIntent;
}
