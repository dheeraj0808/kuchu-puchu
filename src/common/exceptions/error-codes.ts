import { HttpStatus } from '@nestjs/common';

/**
 * Stable, client-facing error codes (guide Appendix C).
 * Codes marked "not in Appendix C" are kept because existing code returns them.
 */
export enum ErrorCode {
  // 400
  ValidationError = 'VALIDATION_ERROR',
  PhotoInvalidFile = 'PHOTO_INVALID_FILE',
  InvalidRequest = 'INVALID_REQUEST', // not in Appendix C
  InvalidInterests = 'INVALID_INTERESTS', // not in Appendix C

  // 413
  PayloadTooLarge = 'PAYLOAD_TOO_LARGE', // not in Appendix C

  // 401
  Unauthorized = 'UNAUTHORIZED',
  OtpInvalid = 'OTP_INVALID',

  // 403
  Forbidden = 'FORBIDDEN',
  AccountRestricted = 'ACCOUNT_RESTRICTED',
  ReauthRequired = 'REAUTH_REQUIRED',
  OnboardingIncomplete = 'ONBOARDING_INCOMPLETE',
  EntitlementRequired = 'ENTITLEMENT_REQUIRED',

  // 404
  NotFound = 'NOT_FOUND', // not in Appendix C
  UserNotFound = 'USER_NOT_FOUND',
  ProfileNotFound = 'PROFILE_NOT_FOUND',
  MatchNotFound = 'MATCH_NOT_FOUND',
  ReportTargetInvalid = 'REPORT_TARGET_INVALID',
  PreferencesNotFound = 'PREFERENCES_NOT_FOUND', // not in Appendix C

  // 409
  ProfileAlreadyExists = 'PROFILE_ALREADY_EXISTS',
  PhotoLimitReached = 'PHOTO_LIMIT_REACHED',
  DiscoveryNotReady = 'DISCOVERY_NOT_READY',
  InteractionAlreadyLiked = 'INTERACTION_ALREADY_LIKED',
  ContactExchangePending = 'CONTACT_EXCHANGE_PENDING',
  PreferencesAlreadyExist = 'PREFERENCES_ALREADY_EXIST', // not in Appendix C

  // 422
  ProfileDobLocked = 'PROFILE_DOB_LOCKED',
  Underage = 'UNDERAGE',
  ContactDetailsNotAllowed = 'CONTACT_DETAILS_NOT_ALLOWED',
  PhotoFaceMismatch = 'PHOTO_FACE_MISMATCH',
  MessageContentRejected = 'MESSAGE_CONTENT_REJECTED',
  ContactSharingLocked = 'CONTACT_SHARING_LOCKED',
  ContactExchangeNotAllowed = 'CONTACT_EXCHANGE_NOT_ALLOWED',
  PurchaseInvalid = 'PURCHASE_INVALID',
  PurchaseAlreadyLinked = 'PURCHASE_ALREADY_LINKED',
  CallNotAllowed = 'CALL_NOT_ALLOWED',

  // 429
  OtpCooldown = 'OTP_COOLDOWN',
  TooManyRequests = 'TOO_MANY_REQUESTS',
  LikeLimitReached = 'LIKE_LIMIT_REACHED',
  MessageAwaitingReply = 'MESSAGE_AWAITING_REPLY',
  VerificationAttemptsExceeded = 'VERIFICATION_ATTEMPTS_EXCEEDED',

  // 500 / 503
  InternalError = 'INTERNAL_ERROR',
  OtpDeliveryFailed = 'OTP_DELIVERY_FAILED',
  ProviderUnavailable = 'PROVIDER_UNAVAILABLE',
}

export interface ErrorDefinition {
  httpStatus: HttpStatus;
  defaultMessage: string;
}

/** The single place that decides the HTTP status and client message of each code. */
export const ERROR_DEFINITIONS: Record<ErrorCode, ErrorDefinition> = {
  [ErrorCode.ValidationError]: { httpStatus: HttpStatus.BAD_REQUEST, defaultMessage: 'Validation failed' },
  [ErrorCode.PhotoInvalidFile]: {
    httpStatus: HttpStatus.BAD_REQUEST,
    defaultMessage: 'The photo must be a JPEG, PNG or WebP image within the size limits',
  },
  [ErrorCode.InvalidRequest]: { httpStatus: HttpStatus.BAD_REQUEST, defaultMessage: 'Invalid request' },
  [ErrorCode.InvalidInterests]: {
    httpStatus: HttpStatus.BAD_REQUEST,
    defaultMessage: 'One or more interests are invalid or unavailable',
  },

  [ErrorCode.PayloadTooLarge]: {
    httpStatus: HttpStatus.PAYLOAD_TOO_LARGE,
    defaultMessage: 'Request body is too large',
  },

  [ErrorCode.Unauthorized]: { httpStatus: HttpStatus.UNAUTHORIZED, defaultMessage: 'Authentication required' },
  [ErrorCode.OtpInvalid]: {
    httpStatus: HttpStatus.UNAUTHORIZED,
    defaultMessage: 'Invalid or expired verification code',
  },

  [ErrorCode.Forbidden]: { httpStatus: HttpStatus.FORBIDDEN, defaultMessage: 'Forbidden' },
  [ErrorCode.AccountRestricted]: {
    httpStatus: HttpStatus.FORBIDDEN,
    defaultMessage: 'This account cannot sign in. Contact support.',
  },
  [ErrorCode.ReauthRequired]: {
    httpStatus: HttpStatus.FORBIDDEN,
    defaultMessage: 'Please confirm it is you before continuing',
  },
  [ErrorCode.OnboardingIncomplete]: {
    httpStatus: HttpStatus.FORBIDDEN,
    defaultMessage: 'Finish setting up your account to continue',
  },
  [ErrorCode.EntitlementRequired]: {
    httpStatus: HttpStatus.FORBIDDEN,
    defaultMessage: 'This feature is not included in your plan',
  },

  [ErrorCode.NotFound]: { httpStatus: HttpStatus.NOT_FOUND, defaultMessage: 'Not found' },
  [ErrorCode.UserNotFound]: { httpStatus: HttpStatus.NOT_FOUND, defaultMessage: 'User not found' },
  [ErrorCode.ProfileNotFound]: { httpStatus: HttpStatus.NOT_FOUND, defaultMessage: 'Profile not found' },
  [ErrorCode.MatchNotFound]: { httpStatus: HttpStatus.NOT_FOUND, defaultMessage: 'Match not found' },
  [ErrorCode.ReportTargetInvalid]: { httpStatus: HttpStatus.NOT_FOUND, defaultMessage: 'Report target not found' },
  [ErrorCode.PreferencesNotFound]: { httpStatus: HttpStatus.NOT_FOUND, defaultMessage: 'Preferences not set yet' },

  [ErrorCode.ProfileAlreadyExists]: { httpStatus: HttpStatus.CONFLICT, defaultMessage: 'Profile already exists' },
  [ErrorCode.PhotoLimitReached]: { httpStatus: HttpStatus.CONFLICT, defaultMessage: 'Photo limit reached' },
  [ErrorCode.DiscoveryNotReady]: {
    httpStatus: HttpStatus.CONFLICT,
    defaultMessage: 'Finish your profile setup to start discovering',
  },
  [ErrorCode.InteractionAlreadyLiked]: {
    httpStatus: HttpStatus.CONFLICT,
    defaultMessage: 'You have already liked this profile',
  },
  [ErrorCode.ContactExchangePending]: {
    httpStatus: HttpStatus.CONFLICT,
    defaultMessage: 'A contact exchange request is already open',
  },
  [ErrorCode.PreferencesAlreadyExist]: {
    httpStatus: HttpStatus.CONFLICT,
    defaultMessage: 'Preferences already exist; use PATCH to update',
  },

  [ErrorCode.ProfileDobLocked]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'Date of birth cannot be changed. Contact support if it is incorrect.',
  },
  [ErrorCode.Underage]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'You must be at least 18 years old',
  },
  [ErrorCode.ContactDetailsNotAllowed]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'Contact details are not allowed here',
  },
  [ErrorCode.PhotoFaceMismatch]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'Your primary photo must clearly show your verified face',
  },
  [ErrorCode.MessageContentRejected]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'This message cannot be sent',
  },
  [ErrorCode.ContactSharingLocked]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'Use contact exchange to share contact details',
  },
  [ErrorCode.ContactExchangeNotAllowed]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'Contact exchange is not available for this match',
  },
  [ErrorCode.PurchaseInvalid]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'The purchase could not be verified',
  },
  [ErrorCode.PurchaseAlreadyLinked]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'This purchase belongs to another account',
  },
  [ErrorCode.CallNotAllowed]: {
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    defaultMessage: 'Calling is not available for this match',
  },

  [ErrorCode.OtpCooldown]: {
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    defaultMessage: 'Please wait before requesting another verification code.',
  },
  [ErrorCode.TooManyRequests]: {
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    defaultMessage: 'Too many requests. Please try again later.',
  },
  [ErrorCode.LikeLimitReached]: {
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    defaultMessage: 'You have reached your daily like limit',
  },
  [ErrorCode.MessageAwaitingReply]: {
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    defaultMessage: 'Wait for a reply before sending more messages',
  },
  [ErrorCode.VerificationAttemptsExceeded]: {
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    defaultMessage: 'Too many verification attempts. Contact support.',
  },

  [ErrorCode.InternalError]: {
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    defaultMessage: 'Internal server error',
  },
  [ErrorCode.OtpDeliveryFailed]: {
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    defaultMessage: 'Unable to send verification code. Please try again later.',
  },
  [ErrorCode.ProviderUnavailable]: {
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    defaultMessage: 'A required service is temporarily unavailable. Please try again later.',
  },
};
