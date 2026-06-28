import User        from '../../models/user.js';
import Wallet      from '../../models/wallet.js';
import { getReferralStats } from '../../services/referralService.js';
import cloudinary  from '../../config/cloudinary.js';
import streamifier from 'streamifier';
import bcrypt      from 'bcrypt';
import crypto      from 'crypto';
import multer      from 'multer';
import nodemailer  from 'nodemailer';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'), false);
  },
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from:    `"Velmora Chroné" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Your email-change verification code',
    html:    `<p>Your 6-digit code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
  });
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generateReferralCode = () =>
  Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');


const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.session.user).lean();
    if (!user) return res.redirect('/login');

    const referralData = await getReferralStats(user._id);
    user.referralCode  = referralData.referralCode;
    user.referrals     = referralData.referrals;

    res.render('user/profile', { user, title: 'My Profile — Velmora Chroné' });
  } catch (err) {
    console.error('getProfile error:', err);
    res.redirect('/');
  }
};


const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.redirect('/profile?editError=Name+cannot+be+empty');
    }
    await User.findByIdAndUpdate(req.session.user, { name: name.trim() });
    req.flash?.('success', 'Profile updated.');
    res.redirect('/profile');
  } catch (err) {
    console.error('updateProfile error:', err);
    res.redirect('/profile');
  }
};


const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file received.' });
    }
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'velmora/profiles', transformation: [{ width: 400, height: 400, crop: 'fill' }] },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });
    await User.findByIdAndUpdate(req.session.user, { profileImage: result.secure_url });
    res.json({ success: true, imageUrl: result.secure_url });
  } catch (err) {
    console.error('uploadProfileImage error:', err);
    res.status(500).json({ success: false, message: 'Upload failed.' });
  }
};

const requestEmailChange = async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail || !/^\S+@\S+\.\S+$/.test(newEmail.trim())) {
      return res.json({ success: false, message: 'Enter a valid email address.' });
    }
    const existing = await User.findOne({ email: newEmail.trim().toLowerCase() });
    if (existing) {
      return res.json({ success: false, message: 'That email is already in use.' });
    }
    const otp    = crypto.randomInt(100000, 999999).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    await User.findByIdAndUpdate(req.session.user, {
      pendingEmail:      newEmail.trim().toLowerCase(),
      emailChangeOtp:    otp,
      emailChangeOtpExp: expiry,
    });
    await sendOtpEmail(newEmail.trim(), otp);
    res.json({ success: true });
  } catch (err) {
    console.error('requestEmailChange error:', err);
    res.json({ success: false, message: 'Failed to send OTP. Try again.' });
  }
};


const verifyEmailChange = async (req, res) => {
  try {
    const { otp } = req.body;
    const user = await User.findById(req.session.user).select(
      'pendingEmail emailChangeOtp emailChangeOtpExp'
    );
    if (!user || !user.emailChangeOtp) {
      return res.json({ success: false, message: 'No pending email change. Please start again.' });
    }
    if (new Date() > user.emailChangeOtpExp) {
      return res.json({ success: false, message: 'Code expired. Please request a new one.' });
    }
    if (otp.toString().trim() !== user.emailChangeOtp) {
      return res.json({ success: false, message: 'Incorrect code. Please try again.' });
    }
    await User.findByIdAndUpdate(req.session.user, {
      email:             user.pendingEmail,
      pendingEmail:      null,
      emailChangeOtp:    null,
      emailChangeOtpExp: null,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('verifyEmailChange error:', err);
    res.json({ success: false, message: 'Verification failed. Try again.' });
  }
};


const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword || !confirmPassword) {
      req.flash?.('error', 'All fields are required.');
      return res.redirect('/profile#password');
    }
    if (newPassword.length < 8) {
      req.flash?.('error', 'New password must be at least 8 characters.');
      return res.redirect('/profile#password');
    }
    if (newPassword !== confirmPassword) {
      req.flash?.('error', 'Passwords do not match.');
      return res.redirect('/profile#password');
    }
    const user = await User.findById(req.session.user).select('password');
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      req.flash?.('error', 'Current password is incorrect.');
      return res.redirect('/profile#password');
    }
    user.password = newPassword;
    await user.save();
    req.flash?.('success', 'Password updated successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error('changePassword error:', err);
    res.redirect('/profile');
  }
};


const addAddress = async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    const addr = buildAddrFromBody(req.body);
    if (user.addresses.length === 0) addr.isDefault = true;
    user.addresses.push(addr);
    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('addAddress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateAddress = async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    const addr = user.addresses.id(req.params.id);
    if (!addr) return res.status(404).json({ success: false, message: 'Address not found.' });
    Object.assign(addr, buildAddrFromBody(req.body));
    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('updateAddress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    const addr = user.addresses.id(req.params.id);
    if (!addr) return res.status(404).json({ success: false, message: 'Address not found.' });
    const wasDefault = addr.isDefault;
    addr.deleteOne();
    if (wasDefault && user.addresses.length > 0) user.addresses[0].isDefault = true;
    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('deleteAddress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    user.addresses.forEach(a => { a.isDefault = a._id.toString() === req.params.id; });
    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('setDefaultAddress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

function buildAddrFromBody(body) {
  return {
    fullName:    (body.fullName    || '').trim(),
    phone:       (body.phone       || '').trim(),
    line1:       (body.line1       || '').trim(),
    line2:       (body.line2       || '').trim(),
    city:        (body.city        || '').trim(),
    state:       (body.state       || '').trim(),
    pincode:     (body.pincode     || '').trim(),
    addressType:  body.addressType || 'Home',
  };
}


export const generateMissingReferralCodes = async () => {
  try {
    const usersWithoutCode = await User.find({
      $or: [
        { referralCode: { $exists: false } },
        { referralCode: null },
        { referralCode: '' },
      ],
    }).select('_id');

    if (usersWithoutCode.length === 0) {
      console.log('[Referral] All users already have referral codes. ✓');
      return;
    }

    console.log(`[Referral] Generating codes for ${usersWithoutCode.length} user(s)…`);

    for (const u of usersWithoutCode) {
      let code, exists, attempts = 0;
      do {
        code   = generateReferralCode();
        exists = await User.findOne({ referralCode: code }).lean();
        attempts++;
      } while (exists && attempts < 20);

      await User.updateOne({ _id: u._id }, { $set: { referralCode: code } });
      console.log(`  ✓ Generated code ${code} for user ${u._id}`);
    }

    console.log('[Referral] Done — all codes generated. ✓');
  } catch (err) {
    console.error('[Referral] generateMissingReferralCodes error:', err);
  }
};


export default {
  getProfile,
  updateProfile,
  uploadProfileImage,
  requestEmailChange,
  verifyEmailChange,
  changePassword,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};