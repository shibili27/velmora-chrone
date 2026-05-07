import mongoose from 'mongoose';

const colorVariantSchema = new mongoose.Schema(
  {
    name:   { type: String, trim: true, required: true },
    hex:    { type: String, trim: true, required: true },
    images: { type: [String], default: [] },
    stock:  { type: Number,  default: 0, min: 0 },
  },
  { _id: true }
);

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
    brand: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Brand',
      default: null,
    },
    images: {
      type:    [String],
      default: [],
    },
    colorVariants: {
      type:    [colorVariantSchema],
      default: [],
    },
    colors: {
      type:    [{ name: String, hex: String }],
      default: [],
    },
    isDeleted: { type: Boolean, default: false },
    isListed:  { type: Boolean, default: true  },
  },
  { timestamps: true }
);

productSchema.pre('save', function () {
  if (this.colorVariants && this.colorVariants.length > 0) {
    this.stock = this.colorVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
  }
});

export default mongoose.models.Product || mongoose.model('Product', productSchema);