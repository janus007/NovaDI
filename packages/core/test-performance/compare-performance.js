/**
 * Performance comparison script
 * Compares build and runtime performance between unplugin and ts-patch approaches
 */

import { execSync } from 'child_process'
import { existsSync, unlinkSync } from 'fs'

console.log('========================================')
console.log('NovaDI Performance Comparison')
console.log('unplugin vs direct transformer')
console.log('========================================\n')

// Clean up previous builds
console.log('[Cleanup] Removing previous builds...')
if (existsSync('dist/bundle.js')) unlinkSync('dist/bundle.js')
if (existsSync('dist/bundle-tspatch.js')) unlinkSync('dist/bundle-tspatch.js')

const results = {
  unplugin: {
    buildTime: 0,
    transformTime: 0,
    programCreateTime: 0
  },
  transformer: {
    buildTime: 0,
    transformTime: 0,
    programCreateTime: 0
  }
}

// Test 1: unplugin approach
console.log('\n[Test 1] Building with unplugin...')
const unpluginStart = performance.now()
try {
  const output = execSync('npm run build:unplugin', { encoding: 'utf8' })
  const unpluginEnd = performance.now()
  results.unplugin.buildTime = unpluginEnd - unpluginStart

  // Parse performance logs from output
  const programMatch = output.match(/Program created in ([\d.]+)ms/)
  const transformMatch = output.match(/Total transform time: ([\d.]+)ms/)

  if (programMatch) results.unplugin.programCreateTime = parseFloat(programMatch[1])
  if (transformMatch) results.unplugin.transformTime = parseFloat(transformMatch[1])

  console.log(`✓ unplugin build completed in ${results.unplugin.buildTime.toFixed(2)}ms`)
  if (results.unplugin.programCreateTime > 0) {
    console.log(`  - Program creation: ${results.unplugin.programCreateTime.toFixed(2)}ms`)
  }
  if (results.unplugin.transformTime > 0) {
    console.log(`  - Transform time: ${results.unplugin.transformTime.toFixed(2)}ms`)
  }
} catch (error) {
  console.error('✗ unplugin build failed:', error.message)
}

// Test 2: Direct transformer approach
console.log('\n[Test 2] Building with direct transformer...')
const transformerStart = performance.now()
try {
  const output = execSync('npm run build:transformer', { encoding: 'utf8' })
  const transformerEnd = performance.now()
  results.transformer.buildTime = transformerEnd - transformerStart

  // Parse performance logs from output
  const programMatch = output.match(/Program created in ([\d.]+)ms/)
  const transformMatch = output.match(/Total transform time: ([\d.]+)ms/)

  if (programMatch) results.transformer.programCreateTime = parseFloat(programMatch[1])
  if (transformMatch) results.transformer.transformTime = parseFloat(transformMatch[1])

  console.log(`✓ transformer build completed in ${results.transformer.buildTime.toFixed(2)}ms`)
  if (results.transformer.programCreateTime > 0) {
    console.log(`  - Program creation: ${results.transformer.programCreateTime.toFixed(2)}ms`)
  }
  if (results.transformer.transformTime > 0) {
    console.log(`  - Transform time: ${results.transformer.transformTime.toFixed(2)}ms`)
  }
} catch (error) {
  console.error('✗ transformer build failed:', error.message)
}

// Summary
console.log('\n========================================')
console.log('Performance Summary')
console.log('========================================')
console.log(`\nunplugin approach:`)
console.log(`  Total build time:    ${results.unplugin.buildTime.toFixed(2)}ms`)
console.log(`  Program creation:    ${results.unplugin.programCreateTime.toFixed(2)}ms`)
console.log(`  Transform time:      ${results.unplugin.transformTime.toFixed(2)}ms`)

console.log(`\ndirect transformer approach:`)
console.log(`  Total build time:    ${results.transformer.buildTime.toFixed(2)}ms`)
console.log(`  Program creation:    ${results.transformer.programCreateTime.toFixed(2)}ms`)
console.log(`  Transform time:      ${results.transformer.transformTime.toFixed(2)}ms`)

const diff = results.unplugin.buildTime - results.transformer.buildTime
const diffPercent = (diff / results.transformer.buildTime) * 100

console.log(`\nDifference:`)
console.log(`  unplugin is ${diff > 0 ? 'slower' : 'faster'} by ${Math.abs(diff).toFixed(2)}ms (${Math.abs(diffPercent).toFixed(1)}%)`)

if (results.unplugin.buildTime < results.transformer.buildTime) {
  console.log(`\n🚀 Winner: unplugin (faster build)`)
} else if (results.unplugin.buildTime > results.transformer.buildTime) {
  console.log(`\n🚀 Winner: direct transformer (faster build)`)
} else {
  console.log(`\n🤝 Tie: Both approaches have similar performance`)
}

console.log('\n========================================\n')
