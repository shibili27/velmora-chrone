import User from '../models/user.js';

/** 
 * @param {string} fullName 
 * @returns {Promise<string>}
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomSuffix(length = 4) {
  return Array.from({ length }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

export async function generateReferralCode(fullName) {
  const firstName = (fullName || '').trim().split(/\s+/)[0] || '';
  let base = firstName.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4);

  while (base.length < 4) base += 'X';

  if (!base || base === 'XXXX') base = 'VELM';

  const MAX_ATTEMPTS = 20;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = base + randomSuffix(4); 
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;
  }

  return base + Date.now().toString().slice(-4);
}