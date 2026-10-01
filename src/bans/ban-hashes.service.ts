import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';

import type { IdentifierType } from '../auth/models/otp-verification.model';
import { canonicalIdentifier } from '../auth/utils/identifier.util';
import { hmacSha256 } from '../common/utils/hmac';
import type { SecurityConfig } from '../config/security.config';
import { BanHash, BanHashType } from './models/ban-hash.model';

export interface BanSubject {
  identifiers: Array<{ type: IdentifierType; value: string }>;
  deviceIds: string[];
}

/**
 * Ban evasion (guide M07 / M15). Identifiers are hashed in their canonical
 * form (Gmail dots, +tags and googlemail folded), so an alias of a banned
 * address is caught; device ids as they are. Keyed HMACs with a domain
 * prefix, so a hash here never equals an OTP or audit hash.
 */
@Injectable()
export class BanHashesService {
  constructor(
    @InjectModel(BanHash) private readonly banHashModel: typeof BanHash,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.getOrThrow<SecurityConfig>('security').identifierHashSecret;
  }

  identifierHash(type: IdentifierType, normalizedIdentifier: string): string {
    return hmacSha256(this.secret, `ban:identifier:${type}:${canonicalIdentifier(type, normalizedIdentifier)}`);
  }

  deviceHash(deviceId: string): string {
    return hmacSha256(this.secret, `ban:device:${deviceId}`);
  }

  async isIdentifierBanned(type: IdentifierType, normalizedIdentifier: string, transaction?: Transaction): Promise<boolean> {
    const row = await this.banHashModel.findOne({
      attributes: ['id'],
      where: { hashType: BanHashType.Identifier, hash: this.identifierHash(type, normalizedIdentifier) },
      transaction,
    });
    return row !== null;
  }

  /** Adds the subject's hashes; ones already listed are kept as they are. Returns how many are new. */
  async add(sourceUserId: string, subject: BanSubject, transaction: Transaction): Promise<number> {
    const rows = [
      ...subject.identifiers.map((i) => ({ hashType: BanHashType.Identifier, hash: this.identifierHash(i.type, i.value) })),
      ...[...new Set(subject.deviceIds)].map((d) => ({ hashType: BanHashType.Device, hash: this.deviceHash(d) })),
    ];
    if (rows.length === 0) return 0;
    const existing = await this.banHashModel.findAll({
      attributes: ['hashType', 'hash'],
      where: { [Op.or]: rows.map((r) => ({ hashType: r.hashType, hash: r.hash })) },
      transaction,
    });
    const known = new Set(existing.map((e) => `${e.hashType}:${e.hash}`));
    const fresh = rows.filter((r) => !known.has(`${r.hashType}:${r.hash}`));
    if (fresh.length > 0) {
      await this.banHashModel.bulkCreate(
        fresh.map((r) => ({ ...r, sourceUserId })),
        { transaction, ignoreDuplicates: true },
      );
    }
    return fresh.length;
  }
}
