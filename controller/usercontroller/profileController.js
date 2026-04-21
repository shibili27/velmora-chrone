import User from '../../models/user.js';
import bcrypt from 'bcryptjs';
import cloudinary from '../../config/cloudinary.js';
import multer from 'multer';
import nodemailer from 'nodemailer';

// ─────────────────────────────────────────
// Multer — store in memory, then push to Cloudinary
// ─────────────────────────────────────────
const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  }
});

// ─────────────────────────────────────────
// Helper: get user ID from session
// ─────────────────────────────────────────
const getUserId = (req) => req.session.user;

// ─────────────────────────────────────────
// Helper: send OTP email
// ─────────────────────────────────────────
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOTP = async (email, otp) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Email Change OTP - Velmora Chrone',
    text: `Your OTP to change your email is ${otp}. It is valid for 5 minutes.`
  });

  console.log('Email change OTP sent:', otp);
};

// ─────────────────────────────────────────
// GET /profile
// ─────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.redirect('/login');
    res.render('user/profile', { user });
  } catch (err) {
    console.error('getProfile error:', err);
    res.status(500).send('Something went wrong');
  }
};

// ─────────────────────────────────────────
// POST /profile/update  — update name
// ─────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.redirect('/profile#edit');

    await User.findByIdAndUpdate(getUserId(req), { name: name.trim() });
    res.redirect('/profile');
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).send('Something went wrong');
  }
};

// ─────────────────────────────────────────
// POST /profile/upload-image
// Uses multer (upload.single('profileImage')) defined in routes
// Uploads buffer to Cloudinary and saves the secure URL permanently
// ─────────────────────────────────────────
const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const user = await User.findById(getUserId(req));
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    // Delete old Cloudinary image if it exists (not the default avatar)
    if (user.profileImage && user.profileImage.includes('cloudinary.com')) {
      try {
        // Extract public_id from URL  e.g. .../velmora/profiles/abc123.jpg → velmora/profiles/abc123
        const parts = user.profileImage.split('/');
        const fileWithExt = parts[parts.length - 1];
        const fileName = fileWithExt.split('.')[0];
        const folderIndex = parts.indexOf('upload');
        const publicId = parts.slice(folderIndex + 2).join('/').replace(/\.[^/.]+$/, '');
        await cloudinary.uploader.destroy(publicId);
      } catch (delErr) {
        console.warn('Could not delete old Cloudinary image:', delErr.message);
      }
    }

    // Upload buffer to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'velmora/profiles',
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Save permanent Cloudinary URL to DB
    user.profileImage = uploadResult.secure_url;
    await user.save();

    return res.json({
      success: true,
      message: 'Profile image updated successfully',
      imageUrl: uploadResult.secure_url
    });

  } catch (err) {
    console.error('uploadProfileImage error:', err);
    return res.status(500).json({ success: false, message: 'Image upload failed. Try again.' });
  }
};

// ─────────────────────────────────────────
// POST /change-password
// ─────────────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user || !user.password) return res.redirect('/profile#password');

    const match = await bcrypt.compare(req.body.oldPassword, user.password);
    if (!match) return res.redirect('/profile#password');

    if (req.body.newPassword !== req.body.confirmPassword) {
      return res.redirect('/profile#password');
    }

    user.password = await bcrypt.hash(req.body.newPassword, 10);
    await user.save();
    res.redirect('/profile');
  } catch (err) {
    console.error('changePassword error:', err);
    res.status(500).send('Something went wrong');
  }
};

// ─────────────────────────────────────────
// POST /profile/request-email-change
// Step 1: validate new email, send OTP to NEW email
// ─────────────────────────────────────────
const requestEmailChange = async (req, res) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail || !newEmail.trim()) {
      return res.json({ success: false, message: 'New email is required.' });
    }

    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(newEmail.trim())) {
      return res.json({ success: false, message: 'Invalid email format.' });
    }

    const currentUser = await User.findById(getUserId(req));
    if (!currentUser) {
      return res.json({ success: false, message: 'User not found.' });
    }

    if (newEmail.toLowerCase() === currentUser.email.toLowerCase()) {
      return res.json({ success: false, message: 'New email must be different from current email.' });
    }

    // Check if new email already taken
    const existing = await User.findOne({ email: newEmail.toLowerCase() });
    if (existing) {
      return res.json({ success: false, message: 'This email is already registered to another account.' });
    }

    const otp = generateOTP();

    req.session.emailChangeOTP       = otp;
    req.session.emailChangePending   = newEmail.toLowerCase().trim();
    req.session.emailChangeOTPExpiry = Date.now() + 5 * 60 * 1000; // 5 min

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    await sendOTP(newEmail, otp);

    return res.json({ success: true, message: `OTP sent to ${newEmail}. Valid for 5 minutes.` });

  } catch (err) {
    console.error('requestEmailChange error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Try again.' });
  }
};

// ─────────────────────────────────────────
// POST /profile/verify-email-change
// Step 2: verify OTP and update email in DB
// ─────────────────────────────────────────
const verifyEmailChange = async (req, res) => {
  try {
    const otp = req.body.otp ? req.body.otp.toString().trim() : '';

    if (!req.session.emailChangeOTP || !req.session.emailChangePending) {
      return res.json({ success: false, message: 'Session expired. Please request a new OTP.' });
    }

    if (!req.session.emailChangeOTPExpiry || Date.now() > req.session.emailChangeOTPExpiry) {
      return res.json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (otp !== req.session.emailChangeOTP.toString().trim()) {
      return res.json({ success: false, message: 'Invalid OTP. Please try again.' });
    }

    const newEmail = req.session.emailChangePending;

    // Double-check email isn't taken (race condition guard)
    const existing = await User.findOne({ email: newEmail });
    if (existing) {
      return res.json({ success: false, message: 'This email was just registered by someone else.' });
    }

    await User.findByIdAndUpdate(getUserId(req), { email: newEmail });

    // Clear email change session data
    req.session.emailChangeOTP       = null;
    req.session.emailChangePending   = null;
    req.session.emailChangeOTPExpiry = null;

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    return res.json({ success: true, message: 'Email updated successfully!' });

  } catch (err) {
    console.error('verifyEmailChange error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// ─────────────────────────────────────────
// ADDRESS CRUD  (all JSON responses)
// ─────────────────────────────────────────

const addAddress = async (req, res) => {
  try {
    const { street, city, pincode, isDefault } = req.body;
    if (!street || !city || !pincode) {
      return res.json({ success: false, message: 'All address fields are required' });
    }

    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found' });

    if (isDefault) user.addresses.forEach(a => { a.isDefault = false; });

    user.addresses.push({
      street:    street.trim(),
      city:      city.trim(),
      pincode:   pincode.trim(),
      isDefault: !!isDefault || user.addresses.length === 0
    });

    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('addAddress error:', err);
    res.json({ success: false, message: 'Server error' });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { street, city, pincode, isDefault } = req.body;
    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found' });

    const addr = user.addresses.id(req.params.id);
    if (!addr) return res.json({ success: false, message: 'Address not found' });

    if (isDefault) user.addresses.forEach(a => { a.isDefault = false; });

    addr.street    = street  ? street.trim()  : addr.street;
    addr.city      = city    ? city.trim()    : addr.city;
    addr.pincode   = pincode ? pincode.trim() : addr.pincode;
    addr.isDefault = !!isDefault;

    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('updateAddress error:', err);
    res.json({ success: false, message: 'Server error' });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found' });

    const addr = user.addresses.id(req.params.id);
    if (!addr) return res.json({ success: false, message: 'Address not found' });

    const wasDefault = addr.isDefault;
    addr.deleteOne();

    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('deleteAddress error:', err);
    res.json({ success: false, message: 'Server error' });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found' });

    user.addresses.forEach(a => { a.isDefault = a._id.toString() === req.params.id; });
    await user.save();
    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    console.error('setDefaultAddress error:', err);
    res.json({ success: false, message: 'Server error' });
  }
};

export default {
  getProfile,
  updateProfile,
  uploadProfileImage,
  changePassword,
  requestEmailChange,
  verifyEmailChange,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};