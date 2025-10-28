import type { INotificationRepository } from '../repositories/NotificationRepository.js'
import type { IUserRepository } from '../repositories/UserRepository.js'

export interface INotificationService {
  notifyUser(userId: string, message: string): Promise<void>
  sendOrderConfirmation(userId: string, orderId: string): Promise<void>
}

export class NotificationService implements INotificationService {
  constructor(
    private notificationRepository: INotificationRepository,
    private userRepository: IUserRepository
  ) {}

  async notifyUser(userId: string, message: string): Promise<void> {
    const user = await this.userRepository.findById(userId)
    await this.notificationRepository.sendEmail(user.email, message)
  }

  async sendOrderConfirmation(userId: string, orderId: string): Promise<void> {
    await this.notifyUser(userId, `Order ${orderId} confirmed`)
  }
}
