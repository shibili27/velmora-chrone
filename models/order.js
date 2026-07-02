import mongoose from 'mongoose';
import { getIO } from '../utils/socket.js';

const orderItemSchema = new mongoose.Schema({
  product              : { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name                 : { type: String, required: true },
  brand                : { type: String, default: '' },
  image                : { type: String, default: '' },
  variantName          : { type: String, default: null },
  quantity             : { type: Number, required: true, min: 1 },
  price                : { type: Number, required: true },
  totalPrice           : { type: Number, required: true },
  status               : { type: String, enum: ['active', 'cancelled'], default: 'active' },
  cancellationNote     : { type: String, default: '' },
  returnStatus         : { type: String, enum: ['none', 'pending', 'accepted', 'rejected'], default: 'none' },
  returnReason         : { type: String, default: '' },
  returnRequestedAt    : { type: Date, default: null },
  returnRejectionReason: { type: String, default: '' },
  restocked            : { type: Boolean, default: false },
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
  pricing         : { type: pricingSchema, required: true },

  couponCode      : { type: String, default: null },

  paymentMethod   : { type: String, enum: ['COD', 'Razorpay', 'Wallet'], default: 'COD' },

  paymentStatus      : { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  razorpayOrderId     : { type: String, default: null },
  razorpayPaymentId   : { type: String, default: null },
  razorpaySignature   : { type: String, default: null },
  paymentFailureReason: { type: String, default: '' },

  // 'payment_pending' and 'payment_failed' added so a Razorpay order isn't
  // forced into 'confirmed' before the payment has actually succeeded.
  orderStatus     : {
    type    : String,
    enum    : [
      'payment_pending',
      'confirmed',
      'processing',
      'dispatched',
      'delivered',
      'cancelled',
      'returned',
      'payment_failed',
    ],
    default : 'confirmed',
  },
  cancellationNote      : { type: String, default: '' },
  returnReason           : { type: String, default: '' },
  returnStatus          : {
    type    : String,
    enum    : ['none', 'pending', 'accepted', 'rejected'],
    default : 'none',
  },
  returnRejectionReason : { type: String, default: '' },
  returnRequestedAt     : { type: Date, default: null },
}, { timestamps: true });

orderSchema.pre('save', async function () {
  this._wasNew = this.isNew;
  if (this.isNew) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count    = await mongoose.model('Order').countDocuments();
    const seq      = String(count + 1).padStart(5, '0');
    this.orderNumber = `VC-${datePart}-${seq}`;
  }
});

// Only notify admin in real time when an order is a genuinely confirmed,
// payable order at creation time (COD / Wallet). Razorpay orders start as
// 'payment_pending' and are announced separately once verified — see
// verifyRazorpayCheckoutPayment in checkoutService.js — so unpaid Razorpay
// attempts don't get broadcast to the admin dashboard as real orders.
orderSchema.post('save', function (doc) {
  if (!this._wasNew) return;
  if (doc.paymentMethod === 'Razorpay' && doc.orderStatus === 'payment_pending') return;

  const io = getIO();
  if (!io) return;

  io.to('admin-room').emit('new-order', {
    _id          : doc._id,
    orderNumber  : doc.orderNumber,
    grandTotal   : doc.pricing.grandTotal,
    itemCount    : doc.items.length,
    paymentMethod: doc.paymentMethod,
    createdAt    : doc.createdAt,
  });
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;