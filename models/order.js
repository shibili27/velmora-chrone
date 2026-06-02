import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product         : { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name            : { type: String, required: true },
  brand           : { type: String, default: '' },
  image           : { type: String, default: '' },
  quantity        : { type: Number, required: true, min: 1 },
  price           : { type: Number, required: true },
  totalPrice      : { type: Number, required: true },
  status          : { type: String, enum: ['active', 'cancelled'], default: 'active' },
  cancellationNote: { type: String, default: '' },
}, { _id: true });

const addressSchema = new mongoose.Schema({
  fullName : { type: String, required: true },
  line1    : { type: String, required: true },
  city     : { type: String, required: true },
  state    : { type: String, default: '' },
  pincode  : { type: String, required: true },
  phone    : { type: String, required: true },
}, { _id: false });

const pricingSchema = new mongoose.Schema({
  subtotal       : { type: Number, required: true },
  itemDiscount   : { type: Number, default: 0 },
  couponDiscount : { type: Number, default: 0 },
  tax            : { type: Number, default: 0 },
  shipping       : { type: Number, default: 0 },
  grandTotal     : { type: Number, required: true },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user            : { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderNumber     : { type: String, unique: true },
  items           : { type: [orderItemSchema], required: true },
  shippingAddress : { type: addressSchema, required: true },
  pricing         : { type: pricingSchema,  required: true },
  paymentMethod   : { type: String, enum: ['COD', 'Razorpay', 'Wallet'], default: 'COD' },
  orderStatus     : {
    type    : String,
    enum    : ['confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'],
    default : 'confirmed',
  },
  cancellationNote    : { type: String, default: '' },
  returnReason        : { type: String, default: '' },

  
  returnStatus        : {
    type    : String,
    enum    : ['none', 'pending', 'accepted', 'rejected'],
    default : 'none',
  },
  returnRejectionReason : { type: String, default: '' },
  returnRequestedAt     : { type: Date, default: null },

}, { timestamps: true });

orderSchema.pre('save', async function () {
  if (this.isNew) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count    = await mongoose.model('Order').countDocuments();
    const seq      = String(count + 1).padStart(5, '0');
    this.orderNumber = `VC-${datePart}-${seq}`;
  }
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;