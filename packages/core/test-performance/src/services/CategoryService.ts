import type { ICategoryRepository } from '../repositories/CategoryRepository.js'
import type { IProductRepository } from '../repositories/ProductRepository.js'

export interface ICategoryService {
  getAllCategories(): Promise<any[]>
  getCategoryProducts(categoryId: string): Promise<any[]>
}

export class CategoryService implements ICategoryService {
  constructor(
    private categoryRepository: ICategoryRepository,
    private productRepository: IProductRepository
  ) {}

  async getAllCategories(): Promise<any[]> {
    return this.categoryRepository.findAll()
  }

  async getCategoryProducts(categoryId: string): Promise<any[]> {
    const category = await this.categoryRepository.findById(categoryId)
    return this.productRepository.findByCategory(category.name)
  }
}
