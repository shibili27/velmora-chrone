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
  // Human-readable reason shown to the user
  description: {
    type    : String,
    required: true,
    trim    : true,
  },
  // What triggered this transaction
  source: {
    type: String,
    enum: [
      'cancellation_refund',   // order or item cancelled by user
      'return_refund',         // admin accepted a return
      'order_payment',         // wallet used to pay for an order
      'manual_credit',         // admin-issued credit (future use)
    ],
    required: true,
  },
  // Reference to the order involved (if any)
  orderId: {
    type   : mongoose.Schema.Types.ObjectId,
    ref    : 'Order',
    default: null,
  },
  orderNumber: {
    type   : String,
    default: null,
  },
  // Running balance AFTER this transaction was applied
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

walletSchema.index({ user: 1 });

// ── Instance methods ──────────────────────────────────────────────────────

/**
 * Credit the wallet and record the transaction.
 * @param {number}  amount
 * @param {string}  description  - shown to the user
 * @param {string}  source       - one of the source enum values
 * @param {object}  [order]      - optional Order doc (for orderId + orderNumber)
 */
walletSchema.methods.credit = async function (amount, description, source, order = null) {
  if (amount <= 0) throw new Error('Credit amount must be positive.');
  this.balance = Math.round(this.balance + amount);
  this.transactions.push({
    type        : 'credit',
    amount      : Math.round(amount),
    description,
    source,
    orderId     : order?._id    || null,
    orderNumber : order?.orderNumber || null,
    balanceAfter: this.balance,
  });
  return this.save();
};

/**
 * Debit the wallet and record the transaction.
 * Throws if balance is insufficient.
 */
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
    orderId     : order?._id    || null,
    orderNumber : order?.orderNumber || null,
    balanceAfter: this.balance,
  });
  return this.save();
};

// ── Static helpers ────────────────────────────────────────────────────────

/**
 * Get or create a wallet for a user.
 */
walletSchema.statics.getOrCreate = async function (userId) {
  let wallet = await this.findOne({ user: userId });
  if (!wallet) wallet = await this.create({ user: userId, balance: 0, transactions: [] });
  return wallet;
};

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
export default Wallet;