import * as authService from '../../services/authService.js';

const EXPECTED_ERRORS = [
  'Session expired. Please signup again.',
  'OTP has expired. Please request a new one.',
  'Invalid OTP. Please try again.',
  'Email already registered. Please login.',
  'Session expired. Please try again.',
];

const login = async (req, res) => {
  try {
    const user = await authService.loginUser(req.body);
    req.session.user = user._id;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );
    res.redirect('/');
  } catch (err) {
    req.flash('authError', err.message);
    req.flash('errorSource', err.field || 'email');
    req.flash('formEmail', req.body.email);
    res.redirect('/login');
  }
};

const sendSignupOtp = async (req, res) => {
  try {
    const validationError = authService.validateSignupFields(req.body);
    if (validationError)
      return res.status(400).json({ success: false, ...validationError });

    const { name, email, password, referralCode } = req.body;
    const { otp, expiry, referrerId } = await authService.initiateSignupOTP({
      name, email, password, referralCode,
    });

    req.session.signupOTP       = otp;
    req.session.signupEmail     = email;
    req.session.signupName      = name;
    req.session.signupPassword  = password;
    req.session.signupOTPExpiry = expiry;
    req.session.signupReferrerId = referrerId; 

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    return res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    return res
      .status(err.status || 500)
      .json({ success: false, field: err.field, message: err.message });
  }
};

const verifySignupOTP = async (req, res) => {
  try {
    const otp = req.body.otp?.toString().trim() || '';
    await authService.verifySignupAndCreate({ otp, session: req.session });

    req.session.signupOTP        = null;
    req.session.signupEmail      = null;
    req.session.signupName       = null;
    req.session.signupPassword   = null;
    req.session.signupOTPExpiry  = null;
    req.session.signupReferrerId = null;

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    return res.json({ success: true, message: 'Account created! Redirecting to login...' });
  } catch (err) {
    console.error('[verifySignupOTP] error:', err);
    const status = EXPECTED_ERRORS.includes(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { otp, expiry } = await authService.initiateForgotPassword(req.body.email);
    req.session.resetOTP       = otp;
    req.session.resetEmail     = req.body.email;
    req.session.resetOTPExpiry = expiry;

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    return res.json({ success: true, message: 'OTP sent successfully.' });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const verifyResetOTP = async (req, res) => {
  try {
    authService.verifyResetOTP({
      otp: req.body.otp?.toString().trim() || '',
      session: req.session,
    });

    req.session.otpVerified = true;

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    return res.json({ success: true, message: 'OTP verified! Redirecting...' });
  } catch (err) {
    console.error('[verifyResetOTP] error:', err);
    const status = EXPECTED_ERRORS.includes(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    if (!req.session.otpVerified) return res.redirect('/forget-password');

    await authService.resetUserPassword({
      email: req.session.resetEmail,
      ...req.body,
    });

    req.session.resetOTP       = null;
    req.session.resetEmail     = null;
    req.session.resetOTPExpiry = null;
    req.session.otpVerified    = null;

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    res.redirect('/login');
  } catch (err) {
    res.render('user/newPassword', { error: err.message });
  }
};

const resendOTP = async (req, res) => {
  try {
    const { otp, expiry, isReset } = await authService.resendOTPToSession(req.session);

    if (isReset) {
      req.session.resetOTP       = otp;
      req.session.resetOTPExpiry = expiry;
    } else {
      req.session.signupOTP       = otp;
      req.session.signupOTPExpiry = expiry;
    }

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    return res.json({ success: true, message: 'OTP resent successfully' });
  } catch (err) {
    console.error('[resendOTP] error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Page renders (GET) ─────────────────────────────────────────────────────

const getLoginPage = (req, res) => {
  const authError   = req.flash('authError')[0]   || null;
  const errorSource = req.flash('errorSource')[0] || null;
  res.render('user/login', {
    authError,
    errorSource,
    formData: { email: req.flash('formEmail')[0] || '' },
  });
};

const getSignupPage = (req, res) => {
  res.render('user/signup', {
    authError: req.flash('authError')[0] || null,
    formData: {
      email: req.flash('formEmail')[0] || '',
      name:  req.flash('formName')[0]  || '',
    },
  });
};

const getOtpPage = (req, res) => {
  res.render('user/otp');
};

const getForgotPasswordPage = (req, res) => {
  res.render('user/forgot');
};

const getResetPasswordPage = (req, res) => {
  res.render('user/newPassword');
};

// Handler for the passport.authenticate('google', ...) callback route.
// Runs AFTER passport has already populated req.user.
const googleAuthCallback = async (req, res) => {
  try {
    req.session.user = req.user._id;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );
    res.redirect('/');
  } catch (err) {
    console.error('Google callback error:', err);
    req.flash('authError', 'Google sign-in failed. Please try again.');
    req.flash('errorSource', 'email');
    res.redirect('/login');
  }
};

const logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
};

export default {
  login,
  sendSignupOtp,
  verifySignupOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  resendOTP,
  getLoginPage,
  getSignupPage,
  getOtpPage,
  getForgotPasswordPage,
  getResetPasswordPage,
  googleAuthCallback,
  logout,
};