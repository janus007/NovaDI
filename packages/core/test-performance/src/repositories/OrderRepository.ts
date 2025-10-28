export interface IOrderRepository {
  findById(id: string): Promise<any>
  findByUserId(userId: string): Promise<any[]>
  create(order: any): Promise<void>
}

export class OrderRepository implements IOrderRepository {
  async findById(id: string): Promise<any> {
    return { id, total: 100 }
  }

  async findByUserId(userId: string): Promise<any[]> {
    return []
  }

  async create(order: any): Promise<void> {
    // Create order
  }
}
