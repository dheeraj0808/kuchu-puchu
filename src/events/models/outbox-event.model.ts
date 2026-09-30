import { AutoIncrement, Column, CreatedAt, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

import type { EventType } from '../event-types';

export enum OutboxStatus {
  Pending = 'pending',
  Done = 'done',
  Failed = 'failed',
}

/**
 * outbox_events (guide M03). Rows are written by OutboxService.publish inside
 * the caller's transaction and moved on by the relay. attempts and last_error
 * record RELAY failures (Redis unreachable); handler failures live in BullMQ.
 */
@Table({ tableName: 'outbox_events', underscored: true, timestamps: true, updatedAt: false })
export class OutboxEvent extends Model {
  /** BIGINT UNSIGNED; kept as a string so ids beyond 2^53 stay exact. */
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT.UNSIGNED)
  override id: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  eventType: EventType;

  @Column({ type: DataType.CHAR(36), allowNull: false })
  aggregateId: string;

  @Column({ type: DataType.JSON, allowNull: false })
  payload: Record<string, unknown>;

  @Column({ type: DataType.ENUM(...Object.values(OutboxStatus)), allowNull: false })
  status: OutboxStatus;

  @Column({ type: DataType.TINYINT.UNSIGNED, allowNull: false })
  attempts: number;

  /** Filled by the database default (CURRENT_TIMESTAMP(3)); the relay uses the DB clock only. */
  @Column(DataType.DATE(3))
  availableAt: Date;

  @Column(DataType.STRING(500))
  lastError: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt: Date;
}
