export interface IUserRepository {
  findById(id: string): Promise<any>
  findAll(): Promise<any[]>
  save(user: any): Promise<void>
}

export class UserRepository implements IUserRepository {
  async findById(id: string): Promise<any> {
    return { id, name: 'User' + id }
  }

  async findAll(): Promise<any[]> {
    return []
  }

  async save(user: any): Promise<void> {
    // Save user
  }
}
