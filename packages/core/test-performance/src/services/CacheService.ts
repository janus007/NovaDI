import type { ICacheRepository } from '../repositories/CacheRepository.js'

export interface ICacheService {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  invalidate(key: string): Promise<void>
}

export class CacheService implements ICacheService {
  constructor(private cacheRepository: ICacheRepository) {}

  async get<T>(key: string): Promise<T | null> {
    return this.cacheRepository.get(key)
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cacheRepository.set(key, value, ttl)
  }

  async invalidate(key: string): Promise<void> {
    await this.cacheRepository.delete(key)
  }
}
