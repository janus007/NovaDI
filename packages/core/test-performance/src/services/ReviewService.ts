import type { IReviewRepository } from '../repositories/ReviewRepository.js'
import type { IProductRepository } from '../repositories/ProductRepository.js'
import type { IUserRepository } from '../repositories/UserRepository.js'

export interface IReviewService {
  getProductReviews(productId: string): Promise<any[]>
  createReview(userId: string, productId: string, rating: number): Promise<void>
}

export class ReviewService implements IReviewService {
  constructor(
    private reviewRepository: IReviewRepository,
    private productRepository: IProductRepository,
    private userRepository: IUserRepository
  ) {}

  async getProductReviews(productId: string): Promise<any[]> {
    return this.reviewRepository.findByProductId(productId)
  }

  async createReview(userId: string, productId: string, rating: number): Promise<void> {
    const user = await this.userRepository.findById(userId)
    const product = await this.productRepository.findById(productId)

    await this.reviewRepository.create({ userId, productId, rating })
  }
}
