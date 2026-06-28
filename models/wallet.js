import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  type: {
    type    : String,
    enum    : ['credit', 'debit'],
    required: true,
  },
  amount: {
    type    : Number,
    required: true,
    min     : [0, 'Amount cannot be negative'],
  },
  description: {
    type    : String,
    required: true,
    trim    : true,
  },
  source: {
    type: String,
    enum: [
      'cancellation_refund',
      'return_refund',
      'order_payment',
      'manual_credit',
      'referral_bonus', 
    ],
    required: true,
  },
  orderId: {
    type   : mongoose.Schema.Types.ObjectId,
    ref    : 'Order',
    default: null,
  },
  orderNumber: {
    type   : String,
    default: null,
  },
  balanceAfter: {
    type    : Number,
    required: true,
    min     : 0,
  },
}, { timestamps: true });

const walletSchema = new mongoose.Schema({
  user: {
    type    : mongoose.Schema.Types.ObjectId,
    ref     : 'User',
    required: true,
    unique  : true,   
  },
  balance: {
    type   : Number,
    default: 0,
    min    : [0, 'Wallet balance cannot be negative'],
  },
  transactions: {
    type   : [transactionSchema],
    default: [],
  },
}, { timestamps: true });


walletSchema.methods.credit = async function (amount, description, source, order = null) {
  if (amount <= 0) throw new Error('Credit amount must be positive.');
  this.balance = Math.round(this.balance + amount);
  this.transactions.push({
    type        : 'credit',
    amount      : Math.round(amount),
    description,
    source,
    orderId     : order?._id        || null,
    orderNumber : order?.orderNumber || null,
    balanceAfter: this.balance,
  });
  return this.save();
};

walletSchema.methods.debit = async function (amount, description, source, order = null) {
  if (amount <= 0) throw new Error('Debit amount must be positive.');
  if (this.balance < amount) {
    throw Object.assign(
      new Error(`Insufficient wallet balance. Available: ₹${this.balance.toLocaleString('en-IN')}`),
      { status: 400 }
    );
  }
  this.balance = Math.round(this.balance - amount);
  this.transactions.push({
    type        : 'debit',
    amount      : Math.round(amount),
    description,
    source,
    orderId     : order?._id        || null,
    orderNumber : order?.orderNumber || null,
    balanceAfter: this.balance,
  });
  return this.save();
};

walletSchema.statics.getOrCreate = async function (userId) {
  let wallet = await this.findOne({ user: userId });
  if (!wallet) wallet = await this.create({ user: userId, balance: 0, transactions: [] });
  return wallet;
};

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
export default Wallet;