export interface ICacheRepository {
  get(key: string): Promise<any>
  set(key: string, value: any, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
}

export class CacheRepository implements ICacheRepository {
  async get(key: string): Promise<any> {
    return null
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    // Set cache
  }

  async delete(key: string): Promise<void> {
    // Delete cache
  }
}
