import type { IShippingRepository } from '../repositories/ShippingRepository.js'
import type { IOrderRepository } from '../repositories/OrderRepository.js'
import type { INotificationRepository } from '../repositories/NotificationRepository.js'

export interface IShippingService {
  calculateShipping(orderId: string): Promise<number>
  trackOrder(orderId: string): Promise<any>
}

export class ShippingService implements IShippingService {
  constructor(
    private shippingRepository: IShippingRepository,
    private orderRepository: IOrderRepository,
    private notificationRepository: INotificationRepository
  ) {}

  async calculateShipping(orderId: string): Promise<number> {
    const order = await this.orderRepository.findById(orderId)
    return this.shippingRepository.calculateShipping(order.address)
  }

  async trackOrder(orderId: string): Promise<any> {
    const tracking = await this.shippingRepository.trackShipment(orderId)
    await this.notificationRepository.sendEmail(orderId, 'Tracking update')
    return tracking
  }
}
