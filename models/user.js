import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    match: [/^[a-zA-Z\s]+$/, 'Name must contain only letters and spaces']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
  },
  password: {
    type: String,
    required: false,
    default: null,
    minlength: [8, 'Password must be at least 8 characters']
  },
  googleId: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  profileImage: {
    type: String,
    default: '/images/default-avatar.png'
  },
  addresses: [{
    fullName:    { type: String, trim: true, default: '' },
    phone:       { type: String, trim: true, default: '' },
    line1:       { type: String, trim: true, default: '' },  // replaces 'street'
    line2:       { type: String, trim: true, default: '' },
    city:        { type: String, trim: true, default: '' },
    state:       { type: String, trim: true, default: '' },
    pincode:     { type: String, trim: true, default: '' },
    addressType: { type: String, default: 'Home' },
    isDefault:   { type: Boolean, default: false }
  }],
  lastLogin: {
    type: Date
  },
  emailVerified: {
    type: Boolean,
    default: false
  },

  // ── Referral system ───────────────────────────────────────────────────
  // This user's own shareable code (e.g. "SHELBY1"). Auto-generated on
  // creation — see the pre-save hook below and utils/referralCode.js.
  referralCode: {
    type: String,
    unique: true,
    sparse: true, // allows existing users (created before this field existed) to have null without violating uniqueness
  },
  // Who referred THIS user, if anyone. Set once at signup, never changed.
  referredBy: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
  },
  // Flips to true the moment this user's first order successfully completes
  // AND their one-time referral discount has been consumed on it. Prevents
  // the referral discount from being reused on later orders.
  hasUsedReferralDiscount: {
    type:    Boolean,
    default: false,
  },
}, {
  timestamps: true
});

userSchema.index({ role: 1 });

// Auto-generate a referral code for every new user, regardless of which
// signup path created them (regular signup, Google OAuth, admin-created).
// Uses a dynamic import to avoid a circular import (referralCode.js imports
// this same User model to check for collisions).
userSchema.pre('save', async function (next) {
  if (this.isNew && !this.referralCode) {
    try {
      const { generateReferralCode } = await import('../utils/referralCode.js');
      this.referralCode = await generateReferralCode(this.name);
    } catch (err) {
      // Don't block user creation if code generation somehow fails —
      // log it and move on; the code can be backfilled later if needed.
      console.error('Referral code generation failed:', err.message);
    }
  }
  next();
});

export default mongoose.model('User', userSchema);