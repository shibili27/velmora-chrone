import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: {
      type:      String,
      required:  true,
      unique:    true,
      uppercase: true,
      trim:      true,
    },

    description: {
      type:    String,
      default: '',
      trim:    true,
    },

    discountType: {
      type:     String,
      enum:     ['flat', 'percentage', 'free_shipping'],
      required: true,
    },

    discountValue: {
      type:    Number,
      default: 0,
      min:     0,
    },

  
    minOrderValue: {
      type:    Number,
      default: 0,
      min:     0,
    },

    maxDiscountCap: {
      type:    Number,
      default: null,
      min:     0,
    },

    expiryDate: {
      type:     Date,
      required: true,
    },

    usageLimit: {
      type:    Number,
      default: null,
      min:     1,
    },

    usedCount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    perUserLimit: {
      type:    Number,
      default: null,
      min:     1,
    },

    
    usedBy: {
      type: [
        {
          user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          count: { type: Number, default: 1, min: 1 },
        },
      ],
      default: [],
    },

    isActive: {
      type:    Boolean,
      default: true,
    },

    isDeleted: {
      type:    Boolean,
      default: false,
    },
  },
  { timestamps: true }
);


couponSchema.virtual('isValid').get(function () {
  if (!this.isActive || this.isDeleted)                                  return false;
  if (new Date() > this.expiryDate)                                      return false;
  if (this.usageLimit !== null && this.usedCount >= this.usageLimit)     return false;
  return true;
});


/**
 * Validate a coupon for a specific order.
 * @param {number} orderSubtotal  
 * @param {number} userUsageCount  
 * @returns {{ valid: boolean, message: string }}
 */
couponSchema.methods.validateFor = function (orderSubtotal, userUsageCount = 0) {
  if (!this.isActive || this.isDeleted) {
    return { valid: false, message: 'This coupon is no longer active.' };
  }

  if (new Date() > this.expiryDate) {
    return { valid: false, message: 'This coupon has expired.' };
  }

  if (this.usageLimit !== null && this.usedCount >= this.usageLimit) {
    return { valid: false, message: 'This coupon has reached its usage limit.' };
  }

  if (orderSubtotal < this.minOrderValue) {
    return {
      valid:   false,
      message: `A minimum order value of ₹${this.minOrderValue} is required to use this coupon.`,
    };
  }

  if (this.perUserLimit !== null && userUsageCount >= this.perUserLimit) {
    return { valid: false, message: 'You have already used this coupon the maximum number of times.' };
  }

  return { valid: true, message: 'Coupon applied successfully.' };
};

/**
 * Get how many times a specific user has already used this coupon.
 * @param {string|ObjectId} userId
 * @returns {number}
 */
couponSchema.methods.getUserUsageCount = function (userId) {
  const entry = this.usedBy.find(u => String(u.user) === String(userId));
  return entry ? entry.count : 0;
};

/**
 
 * @param {number} subtotal
 * @returns {number} 
 */
couponSchema.methods.calculateDiscount = function (subtotal) {
  let discount = 0;

  if (this.discountType === 'flat') {
    discount = this.discountValue;
  } else if (this.discountType === 'percentage') {
    discount = (subtotal * this.discountValue) / 100;
    if (this.maxDiscountCap !== null) {
      discount = Math.min(discount, this.maxDiscountCap);
    }
  } else if (this.discountType === 'free_shipping') {
    discount = 0; 
  }

  return Math.min(discount, subtotal); 
};

export default mongoose.model('Coupon', couponSchema);