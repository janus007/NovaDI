/**
 * NovaDI TypeScript Transformer
 *
 * Automatically injects type names into:
 * - .as<T>() → .as<T>("TypeName")
 * - .resolveType<T>() → .resolveType<T>("TypeName")
 * - .bindInterface<T>(value) → .bindInterface<T>(value, "TypeName")
 * - .registerType(X) → .registerType(X).autoWire({ map: {...} }) (default autowiring)
 *
 * Usage in tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "plugins": [
 *       { "transform": "@novadi/core/transformer" }
 *     ]
 *   }
 * }
 *
 * Compile with: ttsc (ttypescript) or ts-patch
 */
import * as ts from 'typescript';
export default function novadiTransformer(program: ts.Program | null): ts.TransformerFactory<ts.SourceFile>;
//# sourceMappingURL=index.d.ts.map