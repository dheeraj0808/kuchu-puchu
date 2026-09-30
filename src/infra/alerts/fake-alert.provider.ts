import { type Alert, AlertProvider } from './alert.provider';

/** Test double: keeps every alert in memory. */
export class FakeAlertProvider extends AlertProvider {
  readonly sent: Alert[] = [];

  override async send(alert: Alert): Promise<void> {
    this.sent.push({ ...alert });
  }

  clear(): void {
    this.sent.length = 0;
  }
}
