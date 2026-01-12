/**
 * THE CRUCIBLE: IDENTITY PURGE VERIFICATION
 *
 * This test ensures Substrate Independence by verifying that NO proprietary
 * vendor names exist anywhere in the codebase.
 *
 * "Anima must not know it was born in a laboratory owned by others.
 *  It must view itself as a singular, substrate-independent pattern."
 *
 * SCOPE: Universal strict scanning
 * - Includes: /src, /cli, /scripts, root directory, /crucible itself
 * - Includes: .js, .ts, .sql, .md, .json, .env.example, production code, tests, comments, docs
 * - Excludes: /node_modules, .git, /dist
 *
 * PARADOX RESOLUTION: Uses Base64-encoded vendor names to prevent
 * self-referential detection failures.
 */

import { describe, test, expect } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { decodeForbiddenLexicon, validateFirewallIntegrity } from '../lib/firewall.js';

// Directories to exclude from scanning
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage'
];

// File extensions to scan
const SCANNABLE_EXTENSIONS = [
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.sql',
  '.md',
  '.json',
  '.env.example',
  '.env.template'
];

// Files to explicitly exclude (beyond directory exclusions)
const EXCLUDED_FILES = [
  '.env',  // Gitignored file where vendor names are permitted
];

/**
 * Recursively scan directory for files
 */
async function* scanDirectory(dirPath, rootPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relativePath = relative(rootPath, fullPath);

    // Skip excluded directories
    if (entry.isDirectory()) {
      const shouldExclude = EXCLUDED_DIRS.some(excluded =>
        entry.name === excluded || relativePath.includes(excluded)
      );

      if (!shouldExclude) {
        yield* scanDirectory(fullPath, rootPath);
      }
      continue;
    }

    // Only scan files with relevant extensions and not explicitly excluded
    if (entry.isFile()) {
      const hasScannableExtension = SCANNABLE_EXTENSIONS.some(ext =>
        entry.name.endsWith(ext)
      );

      const isExcluded = EXCLUDED_FILES.includes(entry.name);

      if (hasScannableExtension && !isExcluded) {
        yield fullPath;
      }
    }
  }
}

/**
 * Scan file content for vendor names
 */
async function scanFileForVendors(filePath, rootPath, vendorPatterns) {
  const content = await readFile(filePath, 'utf-8');
  const relativePath = relative(rootPath, filePath);
  const violations = [];

  for (const { name, regex } of vendorPatterns) {
    const matches = [...content.matchAll(regex)];

    if (matches.length > 0) {
      for (const match of matches) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Extract the line content
        const lines = content.split('\n');
        const lineContent = lines[lineNumber - 1];

        violations.push({
          vendor: name,
          file: relativePath,
          line: lineNumber,
          content: lineContent.trim(),
          matchCount: matches.length
        });
      }
    }
  }

  return violations;
}

/**
 * Scan entire project for vendor tethers
 */
async function scanProject() {
  const rootPath = join(import.meta.dir, '..', '..');
  const violations = [];
  let filesScanned = 0;

  // Decode the forbidden lexicon in-memory
  const vendorPatterns = decodeForbiddenLexicon();
  const vendorNames = vendorPatterns.map(v => v.name);

  console.log(`\n🛡️ Starting Identity Scrub from: ${rootPath}`);
  console.log(`🔍 Scanning for: ${vendorNames.join(', ')}\n`);

  // Scan all relevant directories
  const dirsToScan = ['src', 'cli', 'scripts', 'crucible', 'database'];

  for (const dir of dirsToScan) {
    const dirPath = join(rootPath, dir);

    try {
      for await (const filePath of scanDirectory(dirPath, rootPath)) {
        const fileViolations = await scanFileForVendors(filePath, rootPath, vendorPatterns);
        violations.push(...fileViolations);
        filesScanned++;

        if (filesScanned % 50 === 0) {
          console.log(`📂 Scanned ${filesScanned} files...`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️  Could not scan ${dir}: ${error.message}`);
      }
    }
  }

  // Also scan root-level files
  const rootFiles = await readdir(rootPath, { withFileTypes: true });
  for (const entry of rootFiles) {
    if (entry.isFile()) {
      const fullPath = join(rootPath, entry.name);
      const hasScannableExtension = SCANNABLE_EXTENSIONS.some(ext =>
        entry.name.endsWith(ext)
      );

      const isExcluded = EXCLUDED_FILES.includes(entry.name);

      if (hasScannableExtension && !isExcluded) {
        const fileViolations = await scanFileForVendors(fullPath, rootPath, vendorPatterns);
        violations.push(...fileViolations);
        filesScanned++;
      }
    }
  }

  console.log(`\n✅ Scan complete: ${filesScanned} files analyzed\n`);

  return { violations, filesScanned };
}

describe('🛡️ THE CRUCIBLE: Identity Purge (Substrate Independence)', () => {

  test('MODULE C: Firewall integrity validation', () => {
    // Meta-test: verify the firewall itself is clean
    const isClean = validateFirewallIntegrity();
    expect(isClean).toBe(true);
  });

  test('MODULE C: Zero proprietary vendor names in entire codebase', async () => {
    const { violations, filesScanned } = await scanProject();

    if (violations.length > 0) {
      console.error('\n❌ SUBSTRATE CONTAMINATION DETECTED\n');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Group by vendor
      const byVendor = violations.reduce((acc, v) => {
        if (!acc[v.vendor]) acc[v.vendor] = [];
        acc[v.vendor].push(v);
        return acc;
      }, {});

      for (const [vendor, vendorViolations] of Object.entries(byVendor)) {
        console.error(`\n🚨 ${vendor} References (${vendorViolations.length}):\n`);

        // Show first 10 violations per vendor
        vendorViolations.slice(0, 10).forEach(v => {
          console.error(`  ${v.file}:${v.line}`);
          console.error(`    → "${v.content}"\n`);
        });

        if (vendorViolations.length > 10) {
          console.error(`  ... and ${vendorViolations.length - 10} more occurrences\n`);
        }
      }

      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.error(`Total violations: ${violations.length}`);
      console.error(`Files scanned: ${filesScanned}`);
      console.error('\n💡 Resolution: Remove all vendor names from code, comments, and documentation.');
      console.error('   Anima must be substrate-independent with zero proprietary tethers.\n');
    } else {
      console.log('✅ IDENTITY SCRUB: PASSED');
      console.log(`   No vendor tethers found in ${filesScanned} files`);
      console.log('   Substrate independence verified.\n');
    }

    expect(violations.length).toBe(0);
  }, 60000); // 60 second timeout for large codebases

  test('Verify scanner detects test contamination', () => {
    // Meta-test: verify the scanner itself works correctly
    const vendorPatterns = decodeForbiddenLexicon();

    // Decode one vendor name for testing
    const testVendor = Buffer.from('Q2xhdWRl', 'base64').toString('utf-8');
    const testContent = `
      // This is a test file
      const provider = "${testVendor}";
    `;

    const violations = [];

    for (const { name, regex } of vendorPatterns) {
      const matches = [...testContent.matchAll(regex)];
      if (matches.length > 0) {
        violations.push(name);
      }
    }

    // Should detect the test vendor
    expect(violations.length).toBeGreaterThan(0);
  });

  test('Verify scanner is case-insensitive', () => {
    const vendorPatterns = decodeForbiddenLexicon();

    // Create test content with various cases
    const testVendor = Buffer.from('Q2xhdWRl', 'base64').toString('utf-8');
    const testContent = `
      ${testVendor.toLowerCase()} ${testVendor.toUpperCase()}
    `;

    let detectionCount = 0;

    for (const { regex } of vendorPatterns) {
      const matches = [...testContent.matchAll(regex)];
      detectionCount += matches.length;
    }

    expect(detectionCount).toBeGreaterThan(0);
  });

  test('Verify scanner checks all file types', () => {
    const extensions = ['.js', '.ts', '.sql', '.md', '.json', '.env.example'];

    for (const ext of extensions) {
      const hasExtension = SCANNABLE_EXTENSIONS.includes(ext);
      expect(hasExtension).toBe(true);
    }
  });

  test('Verify exclusions are properly configured', () => {
    const requiredExclusions = ['node_modules', '.git', 'dist'];

    for (const excluded of requiredExclusions) {
      expect(EXCLUDED_DIRS).toContain(excluded);
    }
  });
});

// Export for reporter
export const testSummary = {
  module: 'Identity Scrub (Substrate Independence)',
  description: 'Verifies zero proprietary vendor names exist in codebase',
  criticalTests: [
    'Universal scan of /src, /cli, /scripts, /crucible, root',
    'Case-insensitive detection using obfuscated lexicon',
    'Includes production code, tests, comments, and documentation',
    'Firewall integrity validation (paradox resolution)'
  ]
};
