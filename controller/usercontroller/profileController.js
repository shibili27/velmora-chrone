import User from '../../models/user.js';
import bcrypt from 'bcryptjs';
import cloudinary from '../../config/cloudinary.js';
import multer from 'multer';
import nodemailer from 'nodemailer';

const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  }
});

const getUserId = (req) => req.session.user;

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

const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const user = await User.findById(getUserId(req));
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    if (user.profileImage && user.profileImage.includes('cloudinary.com')) {
      try {
        const parts = user.profileImage.split('/');
        const folderIndex = parts.indexOf('upload');
        const publicId = parts.slice(folderIndex + 2).join('/').replace(/\.[^/.]+$/, '');
        await cloudinary.uploader.destroy(publicId);
      } catch (delErr) {
        console.warn('Could not delete old Cloudinary image:', delErr.message);
      }
    }

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

const changePassword = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user || !user.password) return res.redirect('/profile#password');
    const match = await bcrypt.compare(req.body.oldPassword, user.password);
    if (!match) return res.redirect('/profile#password');
    if (req.body.newPassword !== req.body.confirmPassword) return res.redirect('/profile#password');
    user.password = await bcrypt.hash(req.body.newPassword, 10);
    await user.save();
    res.redirect('/profile');
  } catch (err) {
    console.error('changePassword error:', err);
    res.status(500).send('Something went wrong');
  }
};


const requestEmailChange = async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail || !newEmail.trim()) return res.json({ success: false, message: 'New email is required.' });
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(newEmail.trim())) return res.json({ success: false, message: 'Invalid email format.' });

    const currentUser = await User.findById(getUserId(req));
    if (!currentUser) return res.json({ success: false, message: 'User not found.' });
    if (newEmail.toLowerCase() === currentUser.email.toLowerCase()) return res.json({ success: false, message: 'New email must be different from current email.' });

    const existing = await User.findOne({ email: newEmail.toLowerCase() });
    if (existing) return res.json({ success: false, message: 'This email is already registered to another account.' });

    const otp = generateOTP();
    req.session.emailChangeOTP       = otp;
    req.session.emailChangePending   = newEmail.toLowerCase().trim();
    req.session.emailChangeOTPExpiry = Date.now() + 5 * 60 * 1000;

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

const verifyEmailChange = async (req, res) => {
  try {
    const otp = req.body.otp ? req.body.otp.toString().trim() : '';
    if (!req.session.emailChangeOTP || !req.session.emailChangePending) return res.json({ success: false, message: 'Session expired. Please request a new OTP.' });
    if (!req.session.emailChangeOTPExpiry || Date.now() > req.session.emailChangeOTPExpiry) return res.json({ success: false, message: 'OTP has expired. Please request a new one.' });
    if (otp !== req.session.emailChangeOTP.toString().trim()) return res.json({ success: false, message: 'Invalid OTP. Please try again.' });

    const newEmail = req.session.emailChangePending;
    const existing = await User.findOne({ email: newEmail });
    if (existing) return res.json({ success: false, message: 'This email was just registered by someone else.' });

    await User.findByIdAndUpdate(getUserId(req), { email: newEmail });

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



const addAddress = async (req, res) => {
  try {
    const { fullName, phone, line1, line2, city, state, pincode, addressType } = req.body;

    // Validation
    if (!fullName || !fullName.trim()) return res.json({ success: false, message: 'Full name is required.' });
    if (!phone || !/^\d{10}$/.test(phone.trim())) return res.json({ success: false, message: 'Enter a valid 10-digit phone number.' });
    if (!line1 || !line1.trim()) return res.json({ success: false, message: 'Address line 1 is required.' });
    if (!city || !city.trim()) return res.json({ success: false, message: 'City is required.' });
    if (!state || !state.trim()) return res.json({ success: false, message: 'Please select a state.' });
    if (!pincode || !/^\d{6}$/.test(pincode.trim())) return res.json({ success: false, message: 'Enter a valid 6-digit PIN code.' });

    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found.' });

    const isDefault = user.addresses.length === 0;

    user.addresses.push({
      fullName:    fullName.trim(),
      phone:       phone.trim(),
      line1:       line1.trim(),
      line2:       line2 ? line2.trim() : '',
      city:        city.trim(),
      state:       state.trim(),
      pincode:     pincode.trim(),
      addressType: addressType || 'Home',
      isDefault,
    });

    await user.save();

    return res.json({
      success: true,
      message: 'Address saved.',
      addresses: user.addresses  
    });

  } catch (err) {
    console.error('addAddress error:', err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { fullName, phone, line1, line2, city, state, pincode, addressType } = req.body;

    // Validation
    if (!fullName || !fullName.trim()) return res.json({ success: false, message: 'Full name is required.' });
    if (!phone || !/^\d{10}$/.test(phone.trim())) return res.json({ success: false, message: 'Enter a valid 10-digit phone number.' });
    if (!line1 || !line1.trim()) return res.json({ success: false, message: 'Address line 1 is required.' });
    if (!city || !city.trim()) return res.json({ success: false, message: 'City is required.' });
    if (!state || !state.trim()) return res.json({ success: false, message: 'Please select a state.' });
    if (!pincode || !/^\d{6}$/.test(pincode.trim())) return res.json({ success: false, message: 'Enter a valid 6-digit PIN code.' });

    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found.' });

    const addr = user.addresses.id(req.params.id);
    if (!addr) return res.json({ success: false, message: 'Address not found.' });

    // Update all fields
    addr.fullName    = fullName.trim();
    addr.phone       = phone.trim();
    addr.line1       = line1.trim();
    addr.line2       = line2 ? line2.trim() : '';
    addr.city        = city.trim();
    addr.state       = state.trim();
    addr.pincode     = pincode.trim();
    addr.addressType = addressType || addr.addressType;

    await user.save();

    return res.json({
      success: true,
      message: 'Address updated.',
      addresses: user.addresses   
    });

  } catch (err) {
    console.error('updateAddress error:', err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found.' });

    const addr = user.addresses.id(req.params.id);
    if (!addr) return res.json({ success: false, message: 'Address not found.' });

    const wasDefault = addr.isDefault;
    addr.deleteOne();

    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Address removed.',
      addresses: user.addresses  
    });

  } catch (err) {
    console.error('deleteAddress error:', err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.json({ success: false, message: 'User not found.' });

    user.addresses.forEach(a => {
      a.isDefault = a._id.toString() === req.params.id;
    });

    await user.save();

    return res.json({
      success: true,
      message: 'Default address updated.',
      addresses: user.addresses  
    });

  } catch (err) {
    console.error('setDefaultAddress error:', err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
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