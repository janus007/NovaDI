import type { IProductRepository } from '../repositories/ProductRepository.js'
import type { ICategoryRepository } from '../repositories/CategoryRepository.js'
import type { IInventoryRepository } from '../repositories/InventoryRepository.js'

export interface IProductService {
  getProduct(id: string): Promise<any>
  getProductsByCategory(categoryId: string): Promise<any[]>
}

export class ProductService implements IProductService {
  constructor(
    private productRepository: IProductRepository,
    private categoryRepository: ICategoryRepository,
    private inventoryRepository: IInventoryRepository
  ) {}

  async getProduct(id: string): Promise<any> {
    const product = await this.productRepository.findById(id)
    const stock = await this.inventoryRepository.checkStock(id)
    return { ...product, stock }
  }

  async getProductsByCategory(categoryId: string): Promise<any[]> {
    const category = await this.categoryRepository.findById(categoryId)
    return this.productRepository.findByCategory(category.name)
  }
}
