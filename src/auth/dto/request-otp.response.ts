import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpResponse {
  @ApiProperty() message: string;
  @ApiProperty({ example: 300 }) expiresInSeconds: number;
  @ApiProperty({ example: 60 }) resendAfterSeconds: number;
}
