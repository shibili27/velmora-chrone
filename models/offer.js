import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema(
  {
    title: {
      type:     String,
      required: [true, 'Offer title is required'],
      trim:     true,
    },
    description: {
      type:    String,
      trim:    true,
      default: '',
    },

    // What this offer discounts
    appliesTo: {
      type:     String,
      enum:     ['product', 'category'],
      required: [true, 'Offer must apply to either a product or a category'],
    },
    // Points to a Product._id when appliesTo === 'product',
    // or a Category._id when appliesTo === 'category'.
    targetId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: [true, 'Offer must target a product or category'],
    },

    // How much it discounts
    discountType: {
      type:     String,
      enum:     ['percentage', 'flat'],
      required: [true, 'Discount type is required'],
    },
    discountValue: {
      type:     Number,
      required: [true, 'Discount value is required'],
      min:      [0, 'Discount value cannot be negative'],
    },

    // Validity window
    startDate: {
      type:     Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type:     Date,
      required: [true, 'End date is required'],
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

// A product can only have one ACTIVE, non-deleted offer at a time, and
// likewise for a category — keeps "find the offer for this target" unambiguous.
offerSchema.index({ appliesTo: 1, targetId: 1, isActive: 1, isDeleted: 1 });

// ── Validation: percentage discounts must be 0-100 ─────────────────────────
offerSchema.pre('validate', function (next) {
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    return next(new Error('Percentage discount cannot exceed 100.'));
  }
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    return next(new Error('End date cannot be before start date.'));
  }
  next();
});

// ── Instance helper: is this offer currently live? ──────────────────────────
offerSchema.methods.isLiveNow = function (at = new Date()) {
  return (
    this.isActive &&
    !this.isDeleted &&
    this.startDate <= at &&
    this.endDate   >= at
  );
};

// ── Instance helper: compute the discount amount for a given base price ────
offerSchema.methods.calculateDiscount = function (basePrice) {
  if (this.discountType === 'percentage') {
    return Math.round((basePrice * this.discountValue) / 100);
  }
  return Math.min(this.discountValue, basePrice); // flat discount never exceeds the price itself
};

const Offer = mongoose.models.Offer || mongoose.model('Offer', offerSchema);
export default Offer;