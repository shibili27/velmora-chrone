import mongoose from 'mongoose';

const referralSettingsSchema = new mongoose.Schema(
  {
    // Percentage off the REFERRED user's first order (e.g. 10 = 10% off).
    refereeDiscountPercentage: {
      type:     Number,
      required: true,
      min:      [0, 'Discount percentage cannot be negative'],
      max:      [100, 'Discount percentage cannot exceed 100'],
      default:  10,
    },
    // Flat ₹ amount credited to the REFERRER's wallet when their referred
    // friend's first order is placed.
    referrerRewardAmount: {
      type:     Number,
      required: true,
      min:      [0, 'Reward amount cannot be negative'],
      default:  100,
    },
    // Master on/off switch for the whole referral program.
    isEnabled: {
      type:    Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

/**
 * This is a singleton settings document — there should only ever be one.
 * getOrCreate() always returns the same single doc, creating it with
 * defaults on first access if it doesn't exist yet.
 */
referralSettingsSchema.statics.getOrCreate = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const ReferralSettings = mongoose.models.ReferralSettings || mongoose.model('ReferralSettings', referralSettingsSchema);
export default ReferralSettings;