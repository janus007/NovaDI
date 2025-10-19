# @novadi/core

Annotation-free, Autofac-style dependency injection container for TypeScript.

## Status

🚧 **Work in Progress** - Currently in test-driven development phase (M1: Core Container)

## Test Structure

### M1: Core Container (Current)

Tests written for:
- ✅ **Token** (`tests/token.test.ts`)
  - Unique token creation
  - Type safety
  - Symbol-based tokens
  - Debug toString()
  - Map key compatibility

- ✅ **Container** (`tests/container.test.ts`)
  - Value/Factory/Class bindings
  - Scopes (singleton, transient, per-request)
  - Sync/async resolution
  - Circular dependency detection
  - Child containers
  - Disposal lifecycle

## Running Tests

```bash
# Install dependencies first
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Test-Driven Development

All tests are currently written and **failing** (red phase). Next step is to implement the actual code to make them pass (green phase).

### Expected Test Results

Currently: All tests should fail with "not yet implemented" errors.

This is expected! We're following TDD:
1. ✅ **Red**: Write tests first (DONE)
2. ⏳ **Green**: Implement code to pass tests (NEXT)
3. ⏳ **Refactor**: Clean up implementation (AFTER)

## Implementation Roadmap

- [ ] M1: Core Container (Token, Binding, Container)
- [ ] M2: Builder & Interface Registry
- [ ] M3: Autowiring & Parameter Overrides
- [ ] M4: Scanning (build-time)
- [ ] M5: Generics
- [ ] M6: Orphan Detection & CLI
- [ ] M7: Documentation & Polish

## Browser Compatibility

Target: Modern browsers (ES2020+)
- Zero filesystem dependencies in runtime
- Lightweight bundle (<10KB gzipped)
- Tree-shakeable

## License

MIT
