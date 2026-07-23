import mongoose from 'mongoose';

const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    product : { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = guest/admin-added

    customerName : { type: String, required: true, trim: true },
    customerEmail: { type: String, required: true, trim: true, lowercase: true },

    rating       : { type: Number, required: true, min: 1, max: 5 },
    reviewTitle  : { type: String, trim: true, maxlength: 120, default: '' },
    reviewMessage: { type: String, required: true, trim: true, minlength: 20, maxlength: 1000 },
    reviewImages : [{ type: String }],

    verifiedPurchase: { type: Boolean, default: false },

    adminReply    : { type: String, default: null },
    adminRepliedAt: { type: Date, default: null },
    adminRepliedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    replyPinned   : { type: Boolean, default: false },

    status: {
      type   : String,
      enum   : ['pending', 'approved', 'rejected', 'spam', 'hidden'],
      default: 'pending',
      index  : true,
    },

    likes       : { type: Number, default: 0 },
    dislikes    : { type: Number, default: 0 },
    reportsCount: { type: Number, default: 0 },

    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true } // gives createdAt / updatedAt
);

reviewSchema.index({ product: 1, customerEmail: 1, reviewMessage: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ rating: 1 });

export default mongoose.model('Review', reviewSchema);