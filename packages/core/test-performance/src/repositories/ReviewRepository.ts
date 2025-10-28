export interface IReviewRepository {
  findByProductId(productId: string): Promise<any[]>
  create(review: any): Promise<void>
}

export class ReviewRepository implements IReviewRepository {
  async findByProductId(productId: string): Promise<any[]> {
    return []
  }

  async create(review: any): Promise<void> {
    // Create review
  }
}
