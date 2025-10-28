import type { IOrderRepository } from '../repositories/OrderRepository.js'
import type { IUserRepository } from '../repositories/UserRepository.js'
import type { IPaymentRepository } from '../repositories/PaymentRepository.js'
import type { IInventoryRepository } from '../repositories/InventoryRepository.js'

export interface IOrderService {
  createOrder(userId: string, items: any[]): Promise<any>
  getUserOrders(userId: string): Promise<any[]>
}

export class OrderService implements IOrderService {
  constructor(
    private orderRepository: IOrderRepository,
    private userRepository: IUserRepository,
    private paymentRepository: IPaymentRepository,
    private inventoryRepository: IInventoryRepository
  ) {}

  async createOrder(userId: string, items: any[]): Promise<any> {
    const user = await this.userRepository.findById(userId)

    // Reserve stock
    for (const item of items) {
      await this.inventoryRepository.reserveStock(item.productId, item.quantity)
    }

    const order = { userId, items, total: 100 }
    await this.orderRepository.create(order)

    await this.paymentRepository.processPayment(order.total)

    return order
  }

  async getUserOrders(userId: string): Promise<any[]> {
    return this.orderRepository.findByUserId(userId)
  }
}
