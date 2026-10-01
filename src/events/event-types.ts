/**
 * Every domain event (guide Appendix A) and the shape of its payload.
 *
 * Payload rule (guide M03): ids and small values only, never copies of PII
 * (no email, phone, names, message text, coordinates or URLs). A handler that
 * needs more loads it by id. The owning module may refine a shape when it
 * starts publishing the event; until then the shapes below are placeholders.
 */
type Id = string;

export interface EventPayloads {
  // M06 Auth
  'user.registered': { userId: Id };
  'auth.new_device': { userId: Id; sessionId: Id };
  'auth.token_reuse': { userId: Id; sessionId: Id };
  // M04 Users / M15 Moderation
  'user.status_changed': { userId: Id; from: string; to: string };
  // M11 Face verification
  'verification.face.approved': { userId: Id; verificationId: Id };
  'verification.face.rejected': { userId: Id; verificationId: Id };
  // M23 ID verification
  'verification.id.verified': { userId: Id; verificationId: Id };
  'verification.id.failed': { userId: Id; verificationId: Id };
  // M12 Media
  'photo.approved': { userId: Id; photoId: Id };
  'photo.rejected': { userId: Id; photoId: Id };
  'media.delete': { userId: Id; mediaId: Id };
  // M17 Likes
  'like.created': { likeId: Id; fromUserId: Id; toUserId: Id };
  // M16 Matches
  'match.created': { matchId: Id; userIds: [Id, Id] };
  'match.ended': { matchId: Id; endedByUserId: Id | null };
  // M19 Chat
  'message.created': { messageId: Id; matchId: Id; senderId: Id };
  'message.deleted': { messageId: Id; matchId: Id };
  // M13 Blocks
  'block.created': { blockerId: Id; blockedId: Id };
  // M14 Reports
  'report.created': { reportId: Id; reporterId: Id; reportedUserId: Id };
  // M15 Moderation
  'moderation.action_taken': { actionId: Id; targetUserId: Id };
  // M21 Billing
  'subscription.activated': { subscriptionId: Id; userId: Id };
  'subscription.changed': { subscriptionId: Id; userId: Id };
  'subscription.expired': { subscriptionId: Id; userId: Id };
  // M22 Contact exchange
  'contact_exchange.requested': { requestId: Id; matchId: Id };
  'contact_exchange.accepted': { requestId: Id; matchId: Id };
  // M24 Calls
  'call.started': { callId: Id; matchId: Id };
  'call.ended': { callId: Id; matchId: Id };
  // M07 Account
  'account.deleted': { userId: Id };
  /** Not in Appendix A: the worker builds the export ZIP (Appendix B "Data export builder"). */
  'data_export.requested': { requestId: Id; userId: Id };
  /** Not in Appendix A: delete export files after a commit (account deletion). */
  'data_export.purge': { userId: Id; requestIds: Id[] };
  /** Not in Appendix A: delete selfie objects after a commit (account deletion). */
  'verification.face.purge': { userId: Id; verificationIds: Id[] };
}

export type EventType = keyof EventPayloads;

/** A Record over EventType, so the compiler rejects a missing or extra name. */
const KNOWN: Record<EventType, true> = {
  'user.registered': true,
  'auth.new_device': true,
  'auth.token_reuse': true,
  'user.status_changed': true,
  'verification.face.approved': true,
  'verification.face.rejected': true,
  'verification.id.verified': true,
  'verification.id.failed': true,
  'photo.approved': true,
  'photo.rejected': true,
  'media.delete': true,
  'like.created': true,
  'match.created': true,
  'match.ended': true,
  'message.created': true,
  'message.deleted': true,
  'block.created': true,
  'report.created': true,
  'moderation.action_taken': true,
  'subscription.activated': true,
  'subscription.changed': true,
  'subscription.expired': true,
  'contact_exchange.requested': true,
  'contact_exchange.accepted': true,
  'call.started': true,
  'call.ended': true,
  'account.deleted': true,
  'data_export.requested': true,
  'data_export.purge': true,
  'verification.face.purge': true,
};

export const EVENT_TYPES = Object.freeze(Object.keys(KNOWN) as EventType[]);

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN, value);
}
