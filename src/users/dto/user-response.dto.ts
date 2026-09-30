import { ApiProperty } from '@nestjs/swagger';

import { User, UserRole, UserStatus } from '../models/user.model';

/** Public, safe projection of a user. Never return the model directly. */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true, type: String }) email: string | null;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
  @ApiProperty() emailVerified: boolean;
  @ApiProperty() phoneVerified: boolean;
  @ApiProperty({ enum: UserStatus }) status: UserStatus;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty() createdAt: Date;

  static fromModel(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.phone = user.phone;
    dto.emailVerified = !!user.emailVerifiedAt;
    dto.phoneVerified = !!user.phoneVerifiedAt;
    dto.status = user.status;
    dto.role = user.role;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
