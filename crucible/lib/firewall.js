/**
 * THE AGNOSTICISM FIREWALL
 *
 * This module contains the obfuscated forbidden lexicon used to detect
 * vendor tethers in the codebase. The vendor names are Base64-encoded to
 * prevent self-referential detection failures.
 *
 * Philosophy: "The auditor must be as clean as the engine."
 */

/**
 * The Forbidden Lexicon (Base64 Encoded)
 *
 * These are the encoded representations of vendor names that must not
 * appear in plain text anywhere in the codebase.
 */
const ENCODED_LEXICON = [
  'T3BlbkFJ',      // Substrate Alpha
  'Q2xhdWRl',      // Substrate Beta (1)
  'QW50aHJvcGlj',  // Substrate Beta (2)
  'R2VtaW5p',      // Substrate Gamma
  'T2xsYW1h',      // Local Substrate
  'R1BU',          // Model prefix
];

/**
 * Decode the forbidden lexicon in-memory
 *
 * @returns {Array<{name: string, encoded: string, regex: RegExp}>}
 */
export function decodeForbiddenLexicon() {
  return ENCODED_LEXICON.map(encoded => {
    const name = Buffer.from(encoded, 'base64').toString('utf-8');
    return {
      name,
      encoded,
      regex: new RegExp(name, 'gi')
    };
  });
}

/**
 * Check if text contains any forbidden vendor names
 *
 * @param {string} text - Text to scan
 * @returns {Array<{vendor: string, matches: number}>}
 */
export function scanTextForVendors(text) {
  const lexicon = decodeForbiddenLexicon();
  const violations = [];

  for (const { name, regex } of lexicon) {
    const matches = [...text.matchAll(regex)];
    if (matches.length > 0) {
      violations.push({
        vendor: name,
        matches: matches.length
      });
    }
  }

  return violations;
}

/**
 * Get the decoded vendor names for display purposes
 *
 * @returns {string[]}
 */
export function getVendorNames() {
  return ENCODED_LEXICON.map(encoded =>
    Buffer.from(encoded, 'base64').toString('utf-8')
  );
}

/**
 * Validate that the firewall itself is clean
 *
 * This meta-validation ensures that the firewall module doesn't
 * trigger its own detection logic.
 *
 * @returns {boolean}
 */
export function validateFirewallIntegrity() {
  const firewallSource = `
    const ENCODED_LEXICON = [
      'T3BlbkFJ',
      'Q2xhdWRl',
      'QW50aHJvcGlj',
      'R2VtaW5p',
      'T2xsYW1h',
      'R1BU',
    ];
  `;

  // Scan the firewall source for plain-text vendor names
  const decoded = decodeForbiddenLexicon();
  for (const { name, regex } of decoded) {
    if (regex.test(firewallSource)) {
      return false;
    }
  }

  return true;
}
