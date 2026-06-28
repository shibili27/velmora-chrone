import mongoose from 'mongoose';

const referralSettingsSchema = new mongoose.Schema(
  {
    refereeRewardAmount: {
      type    : Number,
      required: true,
      min     : [0, 'Reward amount cannot be negative'],
      default : 100,
    },
   
    referrerRewardAmount: {
      type    : Number,
      required: true,
      min     : [0, 'Reward amount cannot be negative'],
      default : 100,
    },
    isEnabled: {
      type   : Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

referralSettingsSchema.statics.getOrCreate = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

const ReferralSettings =
  mongoose.models.ReferralSettings ||
  mongoose.model('ReferralSettings', referralSettingsSchema);

export default ReferralSettings;