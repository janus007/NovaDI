export interface IInventoryRepository {
  checkStock(productId: string): Promise<number>
  reserveStock(productId: string, quantity: number): Promise<boolean>
}

export class InventoryRepository implements IInventoryRepository {
  async checkStock(productId: string): Promise<number> {
    return 100
  }

  async reserveStock(productId: string, quantity: number): Promise<boolean> {
    return true
  }
}
