import ReferralSettings from '../../models/referral.js';

const MAX_REWARD_AMOUNT = 50000;

function validateRewardAmount(raw, label) {
  const errors = [];

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    errors.push(`${label} is required.`);
    return errors;
  }

  const num = parseFloat(raw);
  if (isNaN(num)) {
    errors.push(`${label} must be a valid number.`);
    return errors;
  }
  if (num < 0) {
    errors.push(`${label} cannot be negative.`);
  }
  if (num > MAX_REWARD_AMOUNT) {
    errors.push(`${label} cannot exceed ₹${MAX_REWARD_AMOUNT.toLocaleString('en-IN')}.`);
  }

  if (/\.\d{3,}/.test(String(raw).trim())) {
    errors.push(`${label} cannot have more than 2 decimal places.`);
  }

  return errors;
}

export const getReferralSettings = async (req, res) => {
  try {
    const settings = await ReferralSettings.getOrCreate();

    res.render('admin/referrals', {
      title: 'Referral Settings — Velmora Chroné',
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      settings,
      error:   res.locals.error   || [],
      success: res.locals.success || [],
    });
  } catch (err) {
    console.error('Get referral settings error:', err);
    req.flash('error', 'Failed to load referral settings.');
    res.redirect('/admin/dashboard');
  }
};

export const updateReferralSettings = async (req, res) => {
  try {
    const { referrerRewardAmount, refereeRewardAmount, isEnabled } = req.body;

    const errors = [
      ...validateRewardAmount(referrerRewardAmount, 'Referrer reward amount'),
      ...validateRewardAmount(refereeRewardAmount, 'Referee reward amount'),
    ];
    if (errors.length) {
      errors.forEach(e => req.flash('error', e));
      return res.redirect('/admin/referrals');
    }

    const referrerAmt = parseFloat(referrerRewardAmount);
    const refereeAmt  = parseFloat(refereeRewardAmount);

    const settings = await ReferralSettings.getOrCreate();
    settings.referrerRewardAmount = referrerAmt;
    settings.refereeRewardAmount  = refereeAmt;
    settings.isEnabled = isEnabled === 'on' || isEnabled === 'true' || isEnabled === true;
    await settings.save();

    req.flash('success', 'Referral settings updated successfully.');
    res.redirect('/admin/referrals');
  } catch (err) {
    console.error('Update referral settings error:', err);
    req.flash('error', `Failed to update settings: ${err.message}`);
    res.redirect('/admin/referrals');
  }
};