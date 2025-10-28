import type { IPaymentRepository } from '../repositories/PaymentRepository.js'
import type { INotificationRepository } from '../repositories/NotificationRepository.js'

export interface IPaymentService {
  processPayment(userId: string, amount: number): Promise<boolean>
  refundPayment(paymentId: string): Promise<boolean>
}

export class PaymentService implements IPaymentService {
  constructor(
    private paymentRepository: IPaymentRepository,
    private notificationRepository: INotificationRepository
  ) {}

  async processPayment(userId: string, amount: number): Promise<boolean> {
    const success = await this.paymentRepository.processPayment(amount)
    if (success) {
      await this.notificationRepository.sendEmail(userId, 'Payment processed')
    }
    return success
  }

  async refundPayment(paymentId: string): Promise<boolean> {
    return this.paymentRepository.refund(paymentId)
  }
}
