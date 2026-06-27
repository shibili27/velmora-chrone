import User   from '../models/user.js';
import Wallet from '../models/wallet.js';

export const REFERRAL_REWARD_AMOUNT = 100; // ₹100 each, fixed amount

/**
 * Validates a referral code typed in at signup.
 * Returns the referrer's User document if valid, or null if the code field
 * was left empty. Throws if a code was entered but doesn't match any user.
 *
 * @param {string} code
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const validateReferralCode = async (code) => {
  const trimmed = (code || '').trim().toUpperCase();
  if (!trimmed) return null; // referral code is optional

  const referrer = await User.findOne({ referralCode: trimmed });
  if (!referrer) {
    throw Object.assign(new Error('Invalid referral code.'), { field: 'referralCode', status: 400 });
  }

  return referrer;
};

/**
 * Credits both the referrer and the newly-referred user once the referred
 * user's first order is successfully placed (COD confirmed or online
 * payment verified). Safe to call on every order — it only pays out once,
 * guarded by `hasUsedReferralDiscount`.
 *
 * @param {string|ObjectId} userId - the user who just placed an order
 */
export const rewardReferralIfEligible = async (userId) => {
  const user = await User.findById(userId).select('referredBy hasUsedReferralDiscount name');
  if (!user || !user.referredBy || user.hasUsedReferralDiscount) return;

  const referrer = await User.findById(user.referredBy).select('name');
  if (!referrer) return;

  const [referrerWallet, referredWallet] = await Promise.all([
    Wallet.getOrCreate(referrer._id),
    Wallet.getOrCreate(user._id),
  ]);

  await referrerWallet.credit(
    REFERRAL_REWARD_AMOUNT,
    `Referral bonus — ${user.name} placed their first order`,
    'referral_bonus'
  );

  await referredWallet.credit(
    REFERRAL_REWARD_AMOUNT,
    `Referral bonus — welcome reward for using ${referrer.name}'s code`,
    'referral_bonus'
  );

  user.hasUsedReferralDiscount = true;
  await user.save();
};

/**
 * Returns referral stats for a user's profile page: their own code, a
 * shareable link, and how many people they've successfully referred
 * (i.e. referred users who've placed their first order and triggered payout).
 *
 * @param {string|ObjectId} userId
 */
export const getReferralStats = async (userId) => {
  const user = await User.findById(userId).select('referralCode');
  const successfulReferrals = await User.countDocuments({
    referredBy: userId,
    hasUsedReferralDiscount: true,
  });
  const pendingReferrals = await User.countDocuments({
    referredBy: userId,
    hasUsedReferralDiscount: false,
  });

  return {
    referralCode: user?.referralCode || null,
    successfulReferrals,
    pendingReferrals,
    rewardAmount: REFERRAL_REWARD_AMOUNT,
  };
};