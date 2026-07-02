import mongoose from 'mongoose';

const { Schema } = mongoose;

const contactMessageSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 150,
    },
    subject: {
      type: String,
      required: true,
      enum: ['general', 'order', 'repair', 'press', 'other'],
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ['new', 'read', 'resolved'],
      default: 'new',
    },
    // Optional: link to a logged-in user if they submitted while authenticated
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('ContactMessage', contactMessageSchema);