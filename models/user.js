import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    match: [/^[a-zA-Z\s]+$/, 'Name must contain only letters and spaces']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
  },
  password: {
    type: String,
    required: false,
    default: null,
    minlength: [8, 'Password must be at least 8 characters']
  },
  googleId: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  profileImage: {
    type: String,
    default: '/images/default-avatar.png'
  },
  addresses: [{
    fullName:    { type: String, trim: true, default: '' },
    phone:       { type: String, trim: true, default: '' },
    line1:       { type: String, trim: true, default: '' },  // replaces 'street'
    line2:       { type: String, trim: true, default: '' },
    city:        { type: String, trim: true, default: '' },
    state:       { type: String, trim: true, default: '' },
    pincode:     { type: String, trim: true, default: '' },
    addressType: { type: String, default: 'Home' },
    isDefault:   { type: Boolean, default: false }
  }],
  lastLogin: {
    type: Date
  },
  emailVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

userSchema.index({ role: 1 });

export default mongoose.model('User', userSchema);