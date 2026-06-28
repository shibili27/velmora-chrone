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

    appliesTo: {
      type:     String,
      enum:     ['product', 'category'],
      required: [true, 'Offer must apply to either a product or a category'],
    },
    targetId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: [true, 'Offer must target a product or category'],
    },

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

offerSchema.index({ appliesTo: 1, targetId: 1, isActive: 1, isDeleted: 1 });

offerSchema.pre('validate', function () {
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    throw new Error('Percentage discount cannot exceed 100.');
  }
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    throw new Error('End date cannot be before start date.');
  }
});

offerSchema.methods.isLiveNow = function (at = new Date()) {
  return (
    this.isActive &&
    !this.isDeleted &&
    this.startDate <= at &&
    this.endDate   >= at
  );
};

offerSchema.methods.calculateDiscount = function (basePrice) {
  if (this.discountType === 'percentage') {
    return Math.round((basePrice * this.discountValue) / 100);
  }
  return Math.min(this.discountValue, basePrice); 
};

const Offer = mongoose.models.Offer || mongoose.model('Offer', offerSchema);
export default Offer;