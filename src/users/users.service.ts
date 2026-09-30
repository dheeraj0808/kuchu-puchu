import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';

import { IdentifierType } from '../auth/models/otp-verification.model';
import { User, UserStatus } from './models/user.model';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  findById(id: string, transaction?: Transaction): Promise<User | null> {
    return this.userModel.findByPk(id, { transaction });
  }

  findByIdentifier(
    type: IdentifierType,
    identifier: string,
    transaction?: Transaction,
  ): Promise<User | null> {
    const where = type === IdentifierType.Email ? { email: identifier } : { phone: identifier };
    return this.userModel.findOne({ where, transaction });
  }

  createVerified(
    type: IdentifierType,
    identifier: string,
    transaction?: Transaction,
  ): Promise<User> {
    const now = new Date();
    const attrs =
      type === IdentifierType.Email
        ? { email: identifier, emailVerifiedAt: now }
        : { phone: identifier, phoneVerifiedAt: now };
    return this.userModel.create({ ...attrs, lastLoginAt: now }, { transaction });
  }

  /** Row-locks the user for the duration of the transaction. */
  findByIdForUpdate(id: string, transaction: Transaction): Promise<User | null> {
    return this.userModel.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  }

  /**
   * Account deletion: frees the email/phone for reuse, deactivates the account and
   * soft-deletes the row so audit records keep a valid user reference.
   */
  async anonymizeAndSoftDelete(user: User, transaction: Transaction): Promise<void> {
    user.set({
      email: null,
      phone: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      isActive: false,
      status: UserStatus.Deactivated,
    });
    await user.save({ transaction });
    await user.destroy({ transaction });
  }

  toResponse(user: User): UserResponseDto {
    return UserResponseDto.fromModel(user);
  }
}
