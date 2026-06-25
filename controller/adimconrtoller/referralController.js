import ReferralSettings from '../../models/referral.js';

// ── View settings ────────────────────────────────────────────────────────
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

// ── Update settings ──────────────────────────────────────────────────────
export const updateReferralSettings = async (req, res) => {
  try {
    const { refereeDiscountPercentage, referrerRewardAmount, isEnabled } = req.body;

    const discountPct = parseFloat(refereeDiscountPercentage);
    const rewardAmt    = parseFloat(referrerRewardAmount);

    if (isNaN(discountPct) || discountPct < 0 || discountPct > 100) {
      req.flash('error', 'Referee discount must be a percentage between 0 and 100.');
      return res.redirect('/admin/referrals');
    }
    if (isNaN(rewardAmt) || rewardAmt < 0) {
      req.flash('error', 'Referrer reward amount must be a positive number.');
      return res.redirect('/admin/referrals');
    }

    const settings = await ReferralSettings.getOrCreate();
    settings.refereeDiscountPercentage = discountPct;
    settings.referrerRewardAmount      = rewardAmt;
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