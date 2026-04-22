// models/category.js
import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Category name is required'],
      trim:     true,
      unique:   true,
    },
    description: {
      type:    String,
      trim:    true,
      default: '',
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

export default mongoose.model('Category', categorySchema);