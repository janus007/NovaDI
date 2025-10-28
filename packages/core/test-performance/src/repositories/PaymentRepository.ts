export interface IPaymentRepository {
  processPayment(amount: number): Promise<boolean>
  refund(paymentId: string): Promise<boolean>
}

export class PaymentRepository implements IPaymentRepository {
  async processPayment(amount: number): Promise<boolean> {
    return true
  }

  async refund(paymentId: string): Promise<boolean> {
    return true
  }
}
