export interface INotificationRepository {
  sendEmail(to: string, subject: string): Promise<void>
  sendSms(to: string, message: string): Promise<void>
}

export class NotificationRepository implements INotificationRepository {
  async sendEmail(to: string, subject: string): Promise<void> {
    // Send email
  }

  async sendSms(to: string, message: string): Promise<void> {
    // Send SMS
  }
}
