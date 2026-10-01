import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export class StartFaceSessionDto {
  @ApiProperty({
    description: 'Version of the consent screen the user accepted before capture. Must be one the server accepts.',
    example: 'v1',
    maxLength: 20,
  })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,20}$/, { message: 'consentVersion must be 1–20 letters, digits, dots, dashes or underscores' })
  consentVersion: string;
}

/** Only the session id: the result is always fetched from the provider by the server. */
export class CompleteFaceSessionDto {
  @ApiProperty({ format: 'uuid', description: 'sessionId from POST /verification/face/session' })
  @IsUUID()
  sessionId: string;
}
