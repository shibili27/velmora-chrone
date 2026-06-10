import User       from '../models/user.js';
import bcrypt      from 'bcryptjs';
import cloudinary  from '../config/cloudinary.js';
import nodemailer  from 'nodemailer';
import { generateOTP } from './authService.js';

export const getUserProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });
  return user;
};

export const updateUserName = async (userId, name) => {
  if (!name?.trim()) throw Object.assign(new Error('Name is required'), { status: 400 });
  await User.findByIdAndUpdate(userId, { name: name.trim() });
};

export const uploadProfileImage = async (userId, fileBuffer) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  if (user.profileImage?.includes('cloudinary.com')) {
    try {
      const parts       = user.profileImage.split('/');
      const folderIndex = parts.indexOf('upload');
      const publicId    = parts.slice(folderIndex + 2).join('/').replace(/\.[^/.]+$/, '');
      await cloudinary.uploader.destroy(publicId);
    } catch (e) {
      console.warn('[Profile] Could not delete old Cloudinary image:', e.message);
    }
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder        : 'velmora/profiles',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(fileBuffer);
  });

  user.profileImage = result.secure_url;
  await user.save();
  return result.secure_url;
};

export const changeUserPassword = async (userId, { oldPassword, newPassword, confirmPassword }) => {
  const user = await User.findById(userId);
  if (!user || !user.password) throw Object.assign(new Error('User not found'), { status: 401 });

  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) throw Object.assign(new Error('Current password is incorrect'), { status: 400 });
  if (newPassword !== confirmPassword) throw Object.assign(new Error('Passwords do not match'), { status: 400 });

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  console.log(`[Profile] Password changed for user ${userId}`);
};

export const sendEmailChangeOTP = async (userId, newEmail) => {
  if (!newEmail?.trim()) throw Object.assign(new Error('New email is required.'), { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(newEmail.trim())) throw Object.assign(new Error('Invalid email format.'), { status: 400 });

  const currentUser = await User.findById(userId);
  if (!currentUser) throw Object.assign(new Error('User not found.'), { status: 401 });
  if (newEmail.toLowerCase() === currentUser.email.toLowerCase())
    throw Object.assign(new Error('New email must be different from current email.'), { status: 400 });

  const existing = await User.findOne({ email: newEmail.toLowerCase() });
  if (existing) throw Object.assign(new Error('This email is already registered to another account.'), { status: 409 });

  const otp         = generateOTP();
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from   : process.env.EMAIL_USER,
    to     : newEmail,
    subject: 'Email Change OTP - Velmora Chroné',
    text   : `Your OTP to change your email is ${otp}. It is valid for 5 minutes.`,
  });
  console.log(`[OTP] Email change OTP for ${newEmail} → ${otp}`);

  return { otp, expiry: Date.now() + 5 * 60 * 1000, pendingEmail: newEmail.toLowerCase().trim() };
};

export const verifyAndChangeEmail = async (userId, { otp, session }) => {
  const { emailChangeOTP, emailChangePending, emailChangeOTPExpiry } = session;

  if (!emailChangeOTP || !emailChangePending)   throw new Error('Session expired. Please request a new OTP.');
  if (Date.now() > emailChangeOTPExpiry)         throw new Error('OTP has expired. Please request a new one.');
  if (otp !== emailChangeOTP.toString().trim())  throw new Error('Invalid OTP. Please try again.');

  const existing = await User.findOne({ email: emailChangePending });
  if (existing) throw new Error('This email was just registered by someone else.');

  await User.findByIdAndUpdate(userId, { email: emailChangePending });
  console.log(`[OTP] Email change OTP verified for user ${userId} → new email: ${emailChangePending}`);
};

const validateAddress = ({ fullName, phone, line1, city, state, pincode }) => {
  if (!fullName?.trim())                            throw Object.assign(new Error('Full name is required.'), { status: 400 });
  if (!phone || !/^\d{10}$/.test(phone.trim()))     throw Object.assign(new Error('Enter a valid 10-digit phone number.'), { status: 400 });
  if (!line1?.trim())                               throw Object.assign(new Error('Address line 1 is required.'), { status: 400 });
  if (!city?.trim())                                throw Object.assign(new Error('City is required.'), { status: 400 });
  if (!state?.trim())                               throw Object.assign(new Error('Please select a state.'), { status: 400 });
  if (!pincode || !/^\d{6}$/.test(pincode.trim()))  throw Object.assign(new Error('Enter a valid 6-digit PIN code.'), { status: 400 });
};

export const addAddress = async (userId, fields) => {
  validateAddress(fields);
  const { fullName, phone, line1, line2, city, state, pincode, addressType } = fields;

  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found.'), { status: 401 });

  user.addresses.push({
    fullName   : fullName.trim(),
    phone      : phone.trim(),
    line1      : line1.trim(),
    line2      : line2 ? line2.trim() : '',
    city       : city.trim(),
    state      : state.trim(),
    pincode    : pincode.trim(),
    addressType: addressType || 'Home',
    isDefault  : user.addresses.length === 0,
  });

  await user.save();
  return user.addresses;
};

export const updateAddress = async (userId, addressId, fields) => {
  validateAddress(fields);
  const { fullName, phone, line1, line2, city, state, pincode, addressType } = fields;

  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found.'), { status: 401 });

  const addr = user.addresses.id(addressId);
  if (!addr) throw Object.assign(new Error('Address not found.'), { status: 404 });

  addr.fullName    = fullName.trim();
  addr.phone       = phone.trim();
  addr.line1       = line1.trim();
  addr.line2       = line2 ? line2.trim() : '';
  addr.city        = city.trim();
  addr.state       = state.trim();
  addr.pincode     = pincode.trim();
  addr.addressType = addressType || addr.addressType;

  await user.save();
  return user.addresses;
};

export const deleteAddress = async (userId, addressId) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found.'), { status: 401 });

  const addr = user.addresses.id(addressId);
  if (!addr) throw Object.assign(new Error('Address not found.'), { status: 404 });

  const wasDefault = addr.isDefault;
  addr.deleteOne();
  if (wasDefault && user.addresses.length > 0) user.addresses[0].isDefault = true;

  await user.save();
  return user.addresses;
};

export const setDefaultAddress = async (userId, addressId) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found.'), { status: 401 });

  user.addresses.forEach(a => { a.isDefault = a._id.toString() === addressId; });
  await user.save();
  return user.addresses;
};