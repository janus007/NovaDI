/**
 * Performance test entry point
 * This file imports and registers all services and repositories with NovaDI
 */
import { Container } from '../../dist/index.js'

// Import repositories
import { UserRepository, type IUserRepository } from './repositories/UserRepository.js'
import { ProductRepository, type IProductRepository } from './repositories/ProductRepository.js'
import { OrderRepository, type IOrderRepository } from './repositories/OrderRepository.js'
import { PaymentRepository, type IPaymentRepository } from './repositories/PaymentRepository.js'
import { InventoryRepository, type IInventoryRepository } from './repositories/InventoryRepository.js'
import { CategoryRepository, type ICategoryRepository } from './repositories/CategoryRepository.js'
import { ReviewRepository, type IReviewRepository } from './repositories/ReviewRepository.js'
import { ShippingRepository, type IShippingRepository } from './repositories/ShippingRepository.js'
import { NotificationRepository, type INotificationRepository } from './repositories/NotificationRepository.js'
import { CacheRepository, type ICacheRepository } from './repositories/CacheRepository.js'

// Import services
import { UserService, type IUserService } from './services/UserService.js'
import { ProductService, type IProductService } from './services/ProductService.js'
import { OrderService, type IOrderService } from './services/OrderService.js'
import { PaymentService, type IPaymentService } from './services/PaymentService.js'
import { InventoryService, type IInventoryService } from './services/InventoryService.js'
import { CategoryService, type ICategoryService } from './services/CategoryService.js'
import { ReviewService, type IReviewService } from './services/ReviewService.js'
import { ShippingService, type IShippingService } from './services/ShippingService.js'
import { NotificationService, type INotificationService } from './services/NotificationService.js'
import { CacheService, type ICacheService } from './services/CacheService.js'

console.log('[Performance Test] Starting container setup...')
const setupStart = performance.now()

const container = new Container()
const builder = container.builder()

// Register repositories
builder.registerType(UserRepository).asInterface<IUserRepository>()
builder.registerType(ProductRepository).asInterface<IProductRepository>()
builder.registerType(OrderRepository).asInterface<IOrderRepository>()
builder.registerType(PaymentRepository).asInterface<IPaymentRepository>()
builder.registerType(InventoryRepository).asInterface<IInventoryRepository>()
builder.registerType(CategoryRepository).asInterface<ICategoryRepository>()
builder.registerType(ReviewRepository).asInterface<IReviewRepository>()
builder.registerType(ShippingRepository).asInterface<IShippingRepository>()
builder.registerType(NotificationRepository).asInterface<INotificationRepository>()
builder.registerType(CacheRepository).asInterface<ICacheRepository>()

// Register services with automatic autowiring
// The transformer should inject .autoWire({ mapResolvers: [...] }) automatically
builder.registerType(UserService).asInterface<IUserService>()
builder.registerType(ProductService).asInterface<IProductService>()
builder.registerType(OrderService).asInterface<IOrderService>()
builder.registerType(PaymentService).asInterface<IPaymentService>()
builder.registerType(InventoryService).asInterface<IInventoryService>()
builder.registerType(CategoryService).asInterface<ICategoryService>()
builder.registerType(ReviewService).asInterface<IReviewService>()
builder.registerType(ShippingService).asInterface<IShippingService>()
builder.registerType(NotificationService).asInterface<INotificationService>()
builder.registerType(CacheService).asInterface<ICacheService>()

const builtContainer = builder.build()

const setupTime = performance.now() - setupStart
console.log(`[Performance Test] Container setup completed in ${setupTime.toFixed(2)}ms`)

// Test resolution
console.log('[Performance Test] Testing service resolution...')
const resolveStart = performance.now()

const userService = builtContainer.resolveInterface<IUserService>()
const orderService = builtContainer.resolveInterface<IOrderService>()
const productService = builtContainer.resolveInterface<IProductService>()

const resolveTime = performance.now() - resolveStart
console.log(`[Performance Test] Resolved 3 services in ${resolveTime.toFixed(2)}ms`)

console.log('[Performance Test] Services resolved successfully:')
console.log('  - UserService:', userService.constructor.name)
console.log('  - OrderService:', orderService.constructor.name)
console.log('  - ProductService:', productService.constructor.name)

console.log('[Performance Test] ✓ All systems operational')

export { builtContainer }
