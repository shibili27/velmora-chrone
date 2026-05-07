import mongoose from 'mongoose';

const brandSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  isDeleted:   { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Brand', brandSchema);