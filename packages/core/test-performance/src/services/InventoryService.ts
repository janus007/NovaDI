import type { IInventoryRepository } from '../repositories/InventoryRepository.js'
import type { IProductRepository } from '../repositories/ProductRepository.js'

export interface IInventoryService {
  checkAvailability(productId: string, quantity: number): Promise<boolean>
  reserveItems(productId: string, quantity: number): Promise<boolean>
}

export class InventoryService implements IInventoryService {
  constructor(
    private inventoryRepository: IInventoryRepository,
    private productRepository: IProductRepository
  ) {}

  async checkAvailability(productId: string, quantity: number): Promise<boolean> {
    const stock = await this.inventoryRepository.checkStock(productId)
    return stock >= quantity
  }

  async reserveItems(productId: string, quantity: number): Promise<boolean> {
    const available = await this.checkAvailability(productId, quantity)
    if (!available) return false

    return this.inventoryRepository.reserveStock(productId, quantity)
  }
}
