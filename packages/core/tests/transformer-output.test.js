/**
 * Test to verify that the transformer generates mapResolvers autowiring
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../src/container';
describe('Transformer - MapResolvers AutoWire Generation', () => {
    let container;
    beforeEach(() => {
        container = new Container();
    });
    it('should automatically generate mapResolvers for registerType without explicit autoWire', () => {
        // This test verifies that the transformer adds .autoWire({ mapResolvers: [...] })
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
        // Register types - Transformer automatically injects mapResolvers
        const builder = container.builder();
        builder.registerType(Logger).asInterface("ILogger");
        builder.registerType(Database).asInterface("IDatabase");
        builder.registerType(UserService).asInterface("UserService").autoWire({
            mapResolvers: [
                (c) => c.resolveType("ILogger"),
                (c) => c.resolveType("IDatabase")
            ]
        });
        const builtContainer = builder.build();
        const service = builtContainer.resolveType("UserService");
        // If transformer worked correctly, dependencies should be resolved
        // via automatically generated mapResolvers
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
        builder.registerType(Logger).asInterface("ILogger").autoWire({
            mapResolvers: [
                (c) => c.resolveType("IConfig")
            ]
        }); // Has dependency on IConfig
        builder.registerType(Service).asInterface("Service").autoWire({
            mapResolvers: [
                (c) => c.resolveType("ILogger"),
                (c) => c.resolveType("IConfig")
            ]
        }); // Has dependencies on both
        const builtContainer = builder.build();
        const service = builtContainer.resolveType("Service");
        expect(service).toBeInstanceOf(Service);
        expect(service.logger).toBeInstanceOf(Logger);
        expect(service.config).toBeInstanceOf(Config);
        expect(service.logger.config).toBeInstanceOf(Config);
    });
});
