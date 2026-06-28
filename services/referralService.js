import User             from '../models/user.js';
import Wallet           from '../models/wallet.js';
import ReferralSettings from '../models/referral.js';


export const getReferralSettings = async () => {
  return ReferralSettings.getOrCreate();
};

export const getReferralRewardAmount = async () => {
  const settings = await getReferralSettings();
  if (!settings.isEnabled) return 0;
  return settings.referrerRewardAmount || 0;
};

export const getRefereeRewardAmount = async () => {
  const settings = await getReferralSettings();
  if (!settings.isEnabled) return 0;
  return settings.refereeRewardAmount || 0;
};


export const validateReferralCode = async (code) => {
  const trimmed = (code || '').trim().toUpperCase();
  if (!trimmed) return null;

  const referrer = await User.findOne({ referralCode: trimmed });
  if (!referrer) {
    throw Object.assign(
      new Error('Invalid referral code.'),
      { field: 'referralCode', status: 400 }
    );
  }
  return referrer;
};



export const rewardReferralIfEligible = async (userId) => {
  const user = await User.findById(userId).select(
    'referredBy hasUsedReferralDiscount name'
  );

  if (!user || !user.referredBy || user.hasUsedReferralDiscount) return;

  const settings = await getReferralSettings();

  if (!settings.isEnabled) {
    user.hasUsedReferralDiscount = true;
    await user.save();
    return;
  }

  const referrerReward = settings.referrerRewardAmount || 0;
  const refereeReward  = settings.refereeRewardAmount  || 0;

  if (referrerReward <= 0 && refereeReward <= 0) {
    user.hasUsedReferralDiscount = true;
    await user.save();
    return;
  }

  const referrer = await User.findById(user.referredBy).select('name');
  if (!referrer) {
    user.hasUsedReferralDiscount = true;
    await user.save();
    return;
  }

  const [referrerWallet, refereeWallet] = await Promise.all([
    Wallet.getOrCreate(referrer._id),
    Wallet.getOrCreate(user._id),
  ]);

  if (referrerReward > 0) {
    await referrerWallet.credit(
      referrerReward,
      `Referral bonus — ${user.name} placed their first order`,
      'referral_bonus'
    );
  }

  if (refereeReward > 0) {
    await refereeWallet.credit(
      refereeReward,
      `Referral bonus — welcome reward for joining via ${referrer.name}'s code`,
      'referral_bonus'
    );
  }

  user.hasUsedReferralDiscount = true;
  await user.save();
};


export const getReferralStats = async (userId) => {
  const [user, referredUsers, settings] = await Promise.all([
    User.findById(userId).select('referralCode').lean(),
    User.find({ referredBy: userId })
        .select('name email createdAt hasUsedReferralDiscount')
        .sort({ createdAt: -1 })
        .lean(),
    getReferralSettings(),
  ]);

  const referrals = referredUsers.map(u => ({
    name      : u.name  || 'Anonymous',
    email     : u.email || '',
    joinedAt  : u.createdAt,
    hasOrdered: u.hasUsedReferralDiscount,
  }));

  return {
    referralCode        : user?.referralCode || null,
    referrerRewardAmount: settings.isEnabled ? settings.referrerRewardAmount : 0,
    refereeRewardAmount : settings.isEnabled ? settings.refereeRewardAmount  : 0,
    referrals,
  };
};