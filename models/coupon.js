import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: {
    type      : String,
    required  : [true, 'Coupon code is required'],
    unique    : true,
    uppercase : true,
    trim      : true,
  },
  description: {
    type   : String,
    default: '',
    trim   : true,
  },
  discountType: {
    type    : String,
    enum    : ['percentage', 'flat'],
    required: true,
  },
  discountValue: {
    type    : Number,
    required: true,
    min     : [0, 'Discount value cannot be negative'],
  },
  // Only meaningful for discountType: 'percentage' — caps the rupee amount discounted
  maxDiscount: {
    type   : Number,
    default: null,
    min    : [0, 'Max discount cannot be negative'],
  },
  minOrderAmount: {
    type   : Number,
    default: 0,
    min    : [0, 'Minimum order amount cannot be negative'],
  },
  expiryDate: {
    type    : Date,
    required: [true, 'Expiry date is required'],
  },
  isActive: {
    type   : Boolean,
    default: true,
  },
  // Total number of times this coupon can be used across all users. null = unlimited.
  usageLimit: {
    type   : Number,
    default: null,
    min    : [1, 'Usage limit must be at least 1'],
  },
  usedCount: {
    type   : Number,
    default: 0,
    min    : 0,
  },
  // Per-user usage limit. Most coupons should be one-time-per-user.
  perUserLimit: {
    type   : Number,
    default: 1,
    min    : [1, 'Per-user limit must be at least 1'],
  },
  usedBy: [{
    user : { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    count: { type: Number, default: 1 },
  }],
}, { timestamps: true });

couponSchema.index({ isActive: 1, expiryDate: 1 });

// --- Validation helpers -----------------------------------------------

couponSchema.methods.isExpired = function () {
  return this.expiryDate < new Date();
};

couponSchema.methods.isUsageLimitReached = function () {
  return this.usageLimit !== null && this.usedCount >= this.usageLimit;
};

couponSchema.methods.getUserUsage = function (userId) {
  const entry = this.usedBy.find(u => String(u.user) === String(userId));
  return entry ? entry.count : 0;
};

couponSchema.methods.hasUserReachedLimit = function (userId) {
  return this.getUserUsage(userId) >= this.perUserLimit;
};

/**
 * Validates a coupon against a user and an order subtotal.
 * Returns { valid: boolean, message: string }
 */
couponSchema.methods.validateFor = function (userId, subtotal) {
  if (!this.isActive) {
    return { valid: false, message: 'This coupon is no longer active.' };
  }
  if (this.isExpired()) {
    return { valid: false, message: 'This coupon has expired.' };
  }
  if (this.isUsageLimitReached()) {
    return { valid: false, message: 'This coupon has reached its usage limit.' };
  }
  if (this.hasUserReachedLimit(userId)) {
    return { valid: false, message: 'You have already used this coupon.' };
  }
  if (subtotal < this.minOrderAmount) {
    return {
      valid  : false,
      message: `Add items worth ₹${(this.minOrderAmount - subtotal).toLocaleString('en-IN')} more to use this coupon.`,
    };
  }
  return { valid: true, message: 'Coupon is valid.' };
};

/**
 * Calculates the discount amount for a given subtotal.
 * Applies the maxDiscount cap for percentage coupons.
 */
couponSchema.methods.calculateDiscount = function (subtotal) {
  let discount = 0;
  if (this.discountType === 'percentage') {
    discount = (subtotal * this.discountValue) / 100;
    if (this.maxDiscount !== null && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }
  } else {
    discount = this.discountValue;
  }
  // Never let discount exceed the subtotal itself
  return Math.round(Math.min(discount, subtotal));
};

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
export default Coupon;