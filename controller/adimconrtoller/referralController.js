import ReferralSettings from '../../models/referral.js';

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

    const referrerAmt = parseFloat(referrerRewardAmount);
    const refereeAmt  = parseFloat(refereeRewardAmount);

    if (isNaN(referrerAmt) || referrerAmt < 0) {
      req.flash('error', 'Referrer reward amount must be a positive number.');
      return res.redirect('/admin/referrals');
    }
    if (isNaN(refereeAmt) || refereeAmt < 0) {
      req.flash('error', 'Referee reward amount must be a positive number.');
      return res.redirect('/admin/referrals');
    }

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