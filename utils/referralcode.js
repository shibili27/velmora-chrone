import User from '../models/user.js';

/**
 * Generates a unique referral code based on the user's first name, e.g.
 * "Shelby Rodriguez" -> "SHELBY1" (or "SHELBY2" if SHELBY1 is taken, etc).
 *
 * Strategy:
 *   1. Take the first name, strip non-letters, uppercase it.
 *   2. Try base name with no suffix first ("SHELBY").
 *   3. If taken, append an incrementing counter (1, 2, 3...) until unique.
 *
 * Falls back to a short random alphanumeric code if the name yields nothing
 * usable (e.g. empty after stripping non-letters — defensive edge case).
 *
 * @param {string} fullName - the user's `name` field
 * @returns {Promise<string>} a unique referral code, ready to save
 */
export async function generateReferralCode(fullName) {
  const firstName = (fullName || '').trim().split(/\s+/)[0] || '';
  let base = firstName.replace(/[^a-zA-Z]/g, '').toUpperCase();

  if (!base) {
    // Defensive fallback — shouldn't normally happen given the User schema's
    // name validation, but guards against blank/symbol-only names.
    base = 'USER' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  // Try the bare name first (e.g. "SHELBY"), then "SHELBY1", "SHELBY2", ...
  let candidate = base;
  let counter = 0;

  // Cap attempts to avoid a runaway loop in a pathological case (extremely
  // unlikely with real data, but keeps this provably terminating).
  const MAX_ATTEMPTS = 1000;

  while (counter < MAX_ATTEMPTS) {
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;

    counter += 1;
    candidate = `${base}${counter}`;
  }

  // Extremely unlikely fallback if somehow 1000 collisions occurred.
  return `${base}${Date.now().toString().slice(-6)}`;
}