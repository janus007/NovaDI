export interface ICategoryRepository {
  findAll(): Promise<any[]>
  findById(id: string): Promise<any>
}

export class CategoryRepository implements ICategoryRepository {
  async findAll(): Promise<any[]> {
    return []
  }

  async findById(id: string): Promise<any> {
    return { id, name: 'Category' + id }
  }
}
