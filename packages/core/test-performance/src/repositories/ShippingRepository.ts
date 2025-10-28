export interface IShippingRepository {
  calculateShipping(address: any): Promise<number>
  trackShipment(orderId: string): Promise<any>
}

export class ShippingRepository implements IShippingRepository {
  async calculateShipping(address: any): Promise<number> {
    return 10
  }

  async trackShipment(orderId: string): Promise<any> {
    return { status: 'shipped' }
  }
}
