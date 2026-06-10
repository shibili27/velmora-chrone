import * as authService from '../../services/authService.js';

const login = async (req, res) => {
  try {
    const user = await authService.loginUser(req.body);
    req.session.user = user._id;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.redirect('/');
  } catch (err) {
    req.flash('authError',   err.message);
    req.flash('errorSource', err.field || 'email');
    req.flash('formEmail',   req.body.email);
    res.redirect('/login');
  }
};

const sendSignupOtp = async (req, res) => {
  try {
    const validationError = authService.validateSignupFields(req.body);
    if (validationError) return res.status(400).json({ success: false, ...validationError });

    const { name, email, password } = req.body;
    const { otp, expiry } = await authService.initiateSignupOTP({ name, email, password });

    req.session.signupOTP       = otp;
    req.session.signupEmail     = email;
    req.session.signupName      = name;
    req.session.signupPassword  = password;
    req.session.signupOTPExpiry = expiry;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    return res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, field: err.field, message: err.message });
  }
};

const verifySignupOTP = async (req, res) => {
  try {
    const otp = req.body.otp?.toString().trim() || '';
    await authService.verifySignupAndCreate({ otp, session: req.session });

    req.session.signupOTP = req.session.signupEmail = req.session.signupName =
      req.session.signupPassword = req.session.signupOTPExpiry = null;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    return res.json({ success: true, message: 'Account created! Redirecting to login...' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { otp, expiry } = await authService.initiateForgotPassword(req.body.email);
    req.session.resetOTP       = otp;
    req.session.resetEmail     = req.body.email;
    req.session.resetOTPExpiry = expiry;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    return res.json({ success: true, message: 'OTP sent successfully.' });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const verifyResetOTP = async (req, res) => {
  try {
    authService.verifyResetOTP({ otp: req.body.otp?.toString().trim() || '', session: req.session });
    req.session.otpVerified = true;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    return res.json({ success: true, message: 'OTP verified! Redirecting...' });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    if (!req.session.otpVerified) return res.redirect('/forget-password');
    await authService.resetUserPassword({ email: req.session.resetEmail, ...req.body });
    req.session.resetOTP = req.session.resetEmail = req.session.resetOTPExpiry = req.session.otpVerified = null;
    res.redirect('/login');
  } catch (err) {
    res.render('user/newPassword', { error: err.message });
  }
};

const resendOTP = async (req, res) => {
  try {
    const { otp, expiry, isReset } = await authService.resendOTPToSession(req.session);
    if (isReset) { req.session.resetOTP = otp;  req.session.resetOTPExpiry  = expiry; }
    else         { req.session.signupOTP = otp; req.session.signupOTPExpiry = expiry; }
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

export default { login, sendSignupOtp, verifySignupOTP, forgotPassword, verifyResetOTP, resetPassword, resendOTP };