import type { IUserRepository } from '../repositories/UserRepository.js'
import type { ICacheRepository } from '../repositories/CacheRepository.js'

export interface IUserService {
  getUser(id: string): Promise<any>
  createUser(user: any): Promise<void>
}

export class UserService implements IUserService {
  constructor(
    private userRepository: IUserRepository,
    private cacheRepository: ICacheRepository
  ) {}

  async getUser(id: string): Promise<any> {
    const cached = await this.cacheRepository.get(`user:${id}`)
    if (cached) return cached

    const user = await this.userRepository.findById(id)
    await this.cacheRepository.set(`user:${id}`, user, 3600)
    return user
  }

  async createUser(user: any): Promise<void> {
    await this.userRepository.save(user)
  }
}
