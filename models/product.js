// models/product.js
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Product name is required'],
      trim:     true,
    },
    description: {
      type:    String,
      trim:    true,
      default: '',
    },
    price: {
      type:     Number,
      required: [true, 'Price is required'],
      min:      [0, 'Price cannot be negative'],
    },
    stock: {
      type:    Number,
      default: 0,
      min:     [0, 'Stock cannot be negative'],
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Category',
    },
    images: {
      type:     [String],
      validate: {
        validator: (arr) => arr.length >= 3,
        message:   'At least 3 images are required',
      },
    },
    isDeleted: {
      type:    Boolean,
      default: false,
    },
    isListed: {
      type:    Boolean,
      default: true,   // true = visible to users
    },
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);