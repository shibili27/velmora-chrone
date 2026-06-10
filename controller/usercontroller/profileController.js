import multer         from 'multer';
import * as profileService from '../../services/profileService.js';

export const upload = multer({
  storage : multer.memoryStorage(),
  limits  : { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'), false);
    cb(null, true);
  },
});

const getUserId = (req) => req.session.user;

const getProfile = async (req, res) => {
  try {
    const user = await profileService.getUserProfile(getUserId(req));
    res.render('user/profile', { user });
  } catch (err) {
    if (err.status === 401) return res.redirect('/login');
    res.status(500).send('Something went wrong');
  }
};

const updateProfile = async (req, res) => {
  try {
    await profileService.updateUserName(getUserId(req), req.body.name);
    res.redirect('/profile');
  } catch (err) {
    res.redirect('/profile#edit');
  }
};

const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided' });
    const imageUrl = await profileService.uploadProfileImage(getUserId(req), req.file.buffer);
    return res.json({ success: true, message: 'Profile image updated successfully', imageUrl });
  } catch (err) {
    console.error('uploadProfileImage error:', err);
    return res.status(err.status || 500).json({ success: false, message: 'Image upload failed. Try again.' });
  }
};

const changePassword = async (req, res) => {
  try {
    await profileService.changeUserPassword(getUserId(req), req.body);
    res.redirect('/profile');
  } catch (err) {
    res.redirect('/profile#password');
  }
};

const requestEmailChange = async (req, res) => {
  try {
    const { otp, expiry, pendingEmail } = await profileService.sendEmailChangeOTP(getUserId(req), req.body.newEmail);
    req.session.emailChangeOTP       = otp;
    req.session.emailChangePending   = pendingEmail;
    req.session.emailChangeOTPExpiry = expiry;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    return res.json({ success: true, message: `OTP sent to ${req.body.newEmail}. Valid for 5 minutes.` });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const verifyEmailChange = async (req, res) => {
  try {
    await profileService.verifyAndChangeEmail(getUserId(req), { otp: req.body.otp?.toString().trim(), session: req.session });
    req.session.emailChangeOTP = req.session.emailChangePending = req.session.emailChangeOTPExpiry = null;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    return res.json({ success: true, message: 'Email updated successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const addAddress = async (req, res) => {
  try {
    const addresses = await profileService.addAddress(getUserId(req), req.body);
    return res.json({ success: true, message: 'Address saved.', addresses });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const updateAddress = async (req, res) => {
  try {
    const addresses = await profileService.updateAddress(getUserId(req), req.params.id, req.body);
    return res.json({ success: true, message: 'Address updated.', addresses });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const addresses = await profileService.deleteAddress(getUserId(req), req.params.id);
    return res.json({ success: true, message: 'Address removed.', addresses });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const addresses = await profileService.setDefaultAddress(getUserId(req), req.params.id);
    return res.json({ success: true, message: 'Default address updated.', addresses });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

export default { getProfile, updateProfile, uploadProfileImage, changePassword, requestEmailChange, verifyEmailChange, addAddress, updateAddress, deleteAddress, setDefaultAddress };