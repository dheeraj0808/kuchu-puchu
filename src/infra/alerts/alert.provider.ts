export type OutboxAlertKind = 'outbox_relay_failed' | 'outbox_handler_failed';
export type SmsBudgetAlertKind = 'sms_budget_warning' | 'sms_budget_exhausted';
export type AlertKind = OutboxAlertKind | SmsBudgetAlertKind;

/**
 * An outbox alert. It carries identifiers and the error class only:
 * there is deliberately no field for a payload, an error message or user data.
 */
export interface OutboxAlert {
  kind: OutboxAlertKind;
  eventType: string;
  outboxId: string;
  /** Set for handler failures. */
  handler?: string;
  /**
   * How many events or failures this alert stands for when several are
   * reported together (a relay batch, or repeats of one handler failure that
   * were held back). `outboxId` is then the first of them.
   */
  count?: number;
  errorClass: string;
}

/** The daily SMS budget (guide M06) reached 80 % (warning) or 100 % (sending stopped). Counts only. */
export interface SmsBudgetAlert {
  kind: SmsBudgetAlertKind;
  used: number;
  budget: number;
  /** The IST calendar day the budget belongs to, YYYY-MM-DD. */
  day: string;
}

export type Alert = OutboxAlert | SmsBudgetAlert;

export function isOutboxAlert(alert: Alert): alert is OutboxAlert {
  return alert.kind === 'outbox_relay_failed' || alert.kind === 'outbox_handler_failed';
}

/** Port for sending operational alerts (guide §4.4: providers behind an adapter). */
export abstract class AlertProvider {
  /** Never throws: a failing alert channel must not break the job that raised it. */
  abstract send(alert: Alert): Promise<void>;
}

const SAFE_VALUE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Anything outside a plain identifier charset is replaced, so no free text reaches the channel. */
export function safeAlertValue(value: string | undefined): string {
  return value !== undefined && SAFE_VALUE.test(value) ? value : 'unknown';
}

/** The error class of a thrown value, e.g. "TypeError". Never the message. */
export function errorClassOf(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  return safeAlertValue(name) === 'unknown' ? 'Error' : name;
}

const TITLES: Record<AlertKind, string> = {
  outbox_relay_failed: 'Outbox event could not be relayed',
  outbox_handler_failed: 'Outbox handler failed after all retries',
  sms_budget_warning: 'Daily SMS budget is 80% used',
  sms_budget_exhausted: 'Daily SMS budget used up; SMS codes are no longer sent today',
};

/** One-line alert text, e.g. for a Slack `{ "text": … }` body. */
export function formatAlert(alert: Alert, environment: string): string {
  if (!isOutboxAlert(alert)) {
    const parts = [`used=${Math.trunc(alert.used)}`, `budget=${Math.trunc(alert.budget)}`, `day=${safeAlertValue(alert.day)}`];
    return `[kuchu-puchu ${safeAlertValue(environment)}] ${TITLES[alert.kind]}: ${parts.join(' ')}`;
  }
  const parts = [
    `event=${safeAlertValue(alert.eventType)}`,
    `id=${safeAlertValue(alert.outboxId)}`,
    ...(alert.handler !== undefined ? [`handler=${safeAlertValue(alert.handler)}`] : []),
    ...(alert.count !== undefined && alert.count > 1 ? [`count=${Math.trunc(alert.count)}`] : []),
    `error=${safeAlertValue(alert.errorClass)}`,
  ];
  return `[kuchu-puchu ${safeAlertValue(environment)}] ${TITLES[alert.kind]}: ${parts.join(' ')}`;
}
