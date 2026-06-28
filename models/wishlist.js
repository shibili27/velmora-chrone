import mongoose from 'mongoose';

const wishlistItemSchema = new mongoose.Schema(
  {
    product: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Product',
      required: true,
    },
    addedAt: {
      type:    Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      unique:   true,
    },
    items: {
      type:    [wishlistItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

wishlistSchema.index({ user: 1, 'items.product': 1 });

export default mongoose.model('Wishlist', wishlistSchema);