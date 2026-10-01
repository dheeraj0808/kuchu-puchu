import { ApiProperty } from '@nestjs/swagger';

import { InterestResponse } from '../../interests/dto/interest.response';

export class InterestCategoryResponse {
  @ApiProperty({ example: 'arts' }) category: string;
  @ApiProperty({ type: [InterestResponse] }) interests: InterestResponse[];
}

export class PromptResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'My perfect Sunday is…' }) text: string;
  @ApiProperty({ example: 'about_me' }) category: string;
}

export class MinVersionsResponse {
  @ApiProperty({ example: '1.0.0' }) android: string;
  @ApiProperty({ example: '1.0.0' }) ios: string;
}

export class FeatureFlagsResponse {
  @ApiProperty() voiceVideoCalls: boolean;
  @ApiProperty() contactExchange: boolean;
  @ApiProperty() idVerification: boolean;
}

export class SupportLinksResponse {
  @ApiProperty({ nullable: true, type: String }) helpCenterUrl: string | null;
  @ApiProperty({ nullable: true, type: String }) privacyPolicyUrl: string | null;
  @ApiProperty({ nullable: true, type: String }) termsUrl: string | null;
  @ApiProperty({ nullable: true, type: String }) supportEmail: string | null;
}

export class AppConfigResponse {
  @ApiProperty({ type: MinVersionsResponse, description: 'Below this version the app must ask the user to update' })
  minVersion: MinVersionsResponse;
  @ApiProperty({ description: 'When true the app shows a maintenance screen. The API does not block requests.' })
  maintenance: boolean;
  @ApiProperty({ type: FeatureFlagsResponse }) featureFlags: FeatureFlagsResponse;
  @ApiProperty({ type: SupportLinksResponse }) supportLinks: SupportLinksResponse;
}
