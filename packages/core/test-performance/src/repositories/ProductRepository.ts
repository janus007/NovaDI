export interface IProductRepository {
  findById(id: string): Promise<any>
  findByCategory(category: string): Promise<any[]>
}

export class ProductRepository implements IProductRepository {
  async findById(id: string): Promise<any> {
    return { id, name: 'Product' + id }
  }

  async findByCategory(category: string): Promise<any[]> {
    return []
  }
}
