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
builder.registerType(UserRepository).as<IUserRepository>()
builder.registerType(ProductRepository).as<IProductRepository>()
builder.registerType(OrderRepository).as<IOrderRepository>()
builder.registerType(PaymentRepository).as<IPaymentRepository>()
builder.registerType(InventoryRepository).as<IInventoryRepository>()
builder.registerType(CategoryRepository).as<ICategoryRepository>()
builder.registerType(ReviewRepository).as<IReviewRepository>()
builder.registerType(ShippingRepository).as<IShippingRepository>()
builder.registerType(NotificationRepository).as<INotificationRepository>()
builder.registerType(CacheRepository).as<ICacheRepository>()

// Register services with automatic autowiring
// The transformer should inject .autoWire({ mapResolvers: [...] }) automatically
builder.registerType(UserService).as<IUserService>()
builder.registerType(ProductService).as<IProductService>()
builder.registerType(OrderService).as<IOrderService>()
builder.registerType(PaymentService).as<IPaymentService>()
builder.registerType(InventoryService).as<IInventoryService>()
builder.registerType(CategoryService).as<ICategoryService>()
builder.registerType(ReviewService).as<IReviewService>()
builder.registerType(ShippingService).as<IShippingService>()
builder.registerType(NotificationService).as<INotificationService>()
builder.registerType(CacheService).as<ICacheService>()

const builtContainer = builder.build()

const setupTime = performance.now() - setupStart
console.log(`[Performance Test] Container setup completed in ${setupTime.toFixed(2)}ms`)

// Test resolution
console.log('[Performance Test] Testing service resolution...')
const resolveStart = performance.now()

const userService = builtContainer.resolveType<IUserService>()
const orderService = builtContainer.resolveType<IOrderService>()
const productService = builtContainer.resolveType<IProductService>()

const resolveTime = performance.now() - resolveStart
console.log(`[Performance Test] Resolved 3 services in ${resolveTime.toFixed(2)}ms`)

console.log('[Performance Test] Services resolved successfully:')
console.log('  - UserService:', userService.constructor.name)
console.log('  - OrderService:', orderService.constructor.name)
console.log('  - ProductService:', productService.constructor.name)

console.log('[Performance Test] ✓ All systems operational')

export { builtContainer }
