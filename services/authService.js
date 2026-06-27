import User      from '../models/user.js';
import bcrypt     from 'bcryptjs';
import nodemailer from 'nodemailer';
import { validateReferralCode } from './referralService.js';

// ─── OTP helpers ──────────────────────────────────────────────────────────────
export const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

export const sendOTP = async (email, otp, subject = 'Your OTP Code') => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from   : process.env.EMAIL_USER,
    to     : email,
    subject,
    text   : `Your OTP is ${otp}. It is valid for 5 minutes.`,
  });
  console.log(`[OTP] Sent to ${email} → ${otp}`);
};

// ─── Validation ───────────────────────────────────────────────────────────────
export const validateSignupFields = ({ name, email, password, confirmPassword }) => {
  if (!name?.trim())                               return { field: 'name',            message: 'Full name is required.' };
  if (!/^[a-zA-Z\s]+$/.test(name.trim()))          return { field: 'name',            message: 'Only letters and spaces allowed.' };
  if (name.trim().length < 3)                      return { field: 'name',            message: 'Name must be at least 3 characters.' };
  if (!email?.trim())                              return { field: 'email',           message: 'Email is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))  return { field: 'email',           message: 'Invalid email format.' };
  if (!password)                                   return { field: 'password',        message: 'Password is required.' };
  if (password.length < 8)                         return { field: 'password',        message: 'Minimum 8 characters required.' };
  if (!/[A-Z]/.test(password))                    return { field: 'password',        message: 'Add at least one uppercase letter.' };
  if (!/[0-9]/.test(password))                    return { field: 'password',        message: 'Add at least one number.' };
  if (!/[^A-Za-z0-9]/.test(password))             return { field: 'password',        message: 'Add at least one special character.' };
  if (!confirmPassword)                            return { field: 'confirmPassword', message: 'Confirm your password.' };
  if (password !== confirmPassword)                return { field: 'confirmPassword', message: 'Passwords do not match.' };
  return null;
};

// ─── Login ────────────────────────────────────────────────────────────────────
export const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email });
  if (!user)          throw Object.assign(new Error('No account found with that email address.'), { field: 'email' });
  if (user.isBlocked) throw Object.assign(new Error('Your account has been blocked. Please contact support.'), { field: 'email' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw Object.assign(new Error('The passcode you entered is incorrect.'), { field: 'password' });

  return user;
};

// ─── Signup OTP ───────────────────────────────────────────────────────────────
// FIX: now accepts an optional referralCode, validates it up front (so a bad
// code fails fast before an OTP email is even sent), and returns it so the
// controller can stash it in the session alongside name/email/password.
export const initiateSignupOTP = async ({ name, email, password, referralCode }) => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw Object.assign(new Error('Email already registered.'), { field: 'email', status: 409 });

  // Validates the code exists; throws { field: 'referralCode' } if not.
  // Returns null if no code was entered (referral is optional).
  const referrer = await validateReferralCode(referralCode);

  const otp = generateOTP();
  console.log(`[OTP] Signup OTP for ${email} → ${otp}`);
  await sendOTP(email, otp, 'Your OTP Code - Velmora Chroné');

  return {
    otp,
    expiry: Date.now() + 5 * 60 * 1000,
    referrerId: referrer ? referrer._id.toString() : null,
  };
};

export const verifySignupAndCreate = async ({ otp, session }) => {
  const { signupOTP, signupEmail, signupName, signupPassword, signupOTPExpiry, signupReferrerId } = session;

  if (!signupOTP || !signupEmail)            throw new Error('Session expired. Please signup again.');
  if (Date.now() > Number(signupOTPExpiry))  throw new Error('OTP has expired. Please request a new one.');
  if (otp !== signupOTP.toString().trim())   throw new Error('Invalid OTP. Please try again.');

  console.log(`[OTP] Signup OTP verified for ${signupEmail}`);

  const existing = await User.findOne({ email: signupEmail });
  if (existing) throw new Error('Email already registered. Please login.');

  const hashed = await bcrypt.hash(signupPassword, 10);
  const user   = new User({
    name    : signupName,
    email   : signupEmail,
    password: hashed,
    referredBy: signupReferrerId || null, // FIX: carry referrer through from session
  });
  await user.save();
  return user;
};

// ─── Forgot password OTP ──────────────────────────────────────────────────────
export const initiateForgotPassword = async (email) => {
  const user = await User.findOne({ email });
  if (!user)          throw new Error('Email not registered.');
  if (user.isBlocked) throw new Error('Your account has been blocked. Please contact support.');

  const otp = generateOTP();
  console.log(`[OTP] Forgot password OTP for ${email} → ${otp}`);
  await sendOTP(email, otp, 'Reset Password OTP - Velmora Chroné');
  return { otp, expiry: Date.now() + 5 * 60 * 1000 };
};

export const verifyResetOTP = ({ otp, session }) => {
  const { resetOTP, resetEmail, resetOTPExpiry } = session;
  if (!resetOTP || !resetEmail)             throw new Error('Session expired. Please try again.');
  if (Date.now() > Number(resetOTPExpiry))  throw new Error('OTP has expired. Please request a new one.');
  if (otp !== resetOTP.toString().trim())   throw new Error('Invalid OTP. Please try again.');
  console.log(`[OTP] Reset OTP verified for ${resetEmail}`);
};

// ─── Reset password ───────────────────────────────────────────────────────────
export const resetUserPassword = async ({ email, password, confirmPassword }) => {
  if (password !== confirmPassword) throw new Error('Passwords do not match');
  const hashed = await bcrypt.hash(password, 10);
  await User.updateOne({ email }, { $set: { password: hashed } });
  console.log(`[Auth] Password reset successful for ${email}`);
};

// ─── Resend OTP ───────────────────────────────────────────────────────────────
export const resendOTPToSession = async (session) => {
  // Determine flow
  const isReset = !!(session.resetEmail);
  const email   = isReset ? session.resetEmail : session.signupEmail;

  if (!email) throw new Error('Session expired. Please start again.');

  const otp    = generateOTP();
  const expiry = Date.now() + 5 * 60 * 1000;

  console.log(`[OTP] Resend OTP (${isReset ? 'reset' : 'signup'}) for ${email} → ${otp}`);
  await sendOTP(email, otp, 'Resend OTP - Velmora Chroné');

  return { otp, expiry, isReset };
};