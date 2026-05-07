// models/cart.js
import mongoose from 'mongoose';

const MAX_QTY_PER_ITEM = 5;

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      default: 1,
    },
    price: {
      type: Number,
      required: true,
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

cartSchema.virtual('totalItems').get(function () {
  return this.items.reduce((sum, i) => sum + i.quantity, 0);
});

cartSchema.virtual('subtotal').get(function () {
  return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
});

cartSchema.set('toJSON',   { virtuals: true });
cartSchema.set('toObject', { virtuals: true });

cartSchema.statics.MAX_QTY = MAX_QTY_PER_ITEM;

export default mongoose.model('Cart', cartSchema);