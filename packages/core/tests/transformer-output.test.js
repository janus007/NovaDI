/**
 * Test to verify that the transformer generates position-based autowiring metadata
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../src/container';
describe('Transformer - Position-Based AutoWire Generation', () => {
    let container;
    beforeEach(() => {
        container = new Container();
    });
    it('should automatically generate position metadata for registerType without explicit autoWire', () => {
        // This test verifies that the transformer adds .autoWire({ positions: [...] })
        // automatically when it sees .registerType(X).asInterface<Y>()
        class Logger {
            log(msg) {
                console.log(msg);
            }
        }
        class Database {
            query() {
                return [];
            }
        }
        class UserService {
            constructor(logger, database) {
                this.logger = logger;
                this.database = database;
            }
        }
        // Register types - NO explicit .autoWire() call
        // Transformer should automatically inject position metadata
        const builder = container.builder();
        builder.registerType(Logger).asInterface("ILogger");
        builder.registerType(Database).asInterface("IDatabase");
        builder.registerType(UserService).asInterface("UserService");
        const builtContainer = builder.build();
        const service = builtContainer.resolveInterface("UserService");
        // If transformer worked correctly, dependencies should be resolved
        // via automatically generated position metadata
        expect(service).toBeInstanceOf(UserService);
        expect(service.logger).toBeInstanceOf(Logger);
        expect(service.database).toBeInstanceOf(Database);
    });
    it('should work with nested dependencies using transformer', () => {
        class Logger {
            constructor(config) {
                this.config = config;
            }
            log(msg) {
                console.log(msg);
            }
        }
        class Config {
            get(key) {
                return 'value';
            }
        }
        class Service {
            constructor(logger, config) {
                this.logger = logger;
                this.config = config;
            }
        }
        const builder = container.builder();
        builder.registerType(Config).asInterface("IConfig");
        builder.registerType(Logger).asInterface("ILogger"); // Has dependency on IConfig
        builder.registerType(Service).asInterface("Service"); // Has dependencies on both
        const builtContainer = builder.build();
        const service = builtContainer.resolveInterface("Service");
        expect(service).toBeInstanceOf(Service);
        expect(service.logger).toBeInstanceOf(Logger);
        expect(service.config).toBeInstanceOf(Config);
        expect(service.logger.config).toBeInstanceOf(Config);
    });
});
