import Order      from '../models/order.js';
import Product    from '../models/product.js';
import Wallet     from '../models/wallet.js';
import PDFDocument from 'pdfkit';
import { restoreStockAndBroadcast } from './checkoutService.js';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Determines the refund amount for an order.
 * For Razorpay: full grandTotal.
 * For COD: no refund (nothing was paid online).
 * For Wallet: full grandTotal (was debited from wallet).
 * Returns 0 if nothing should be refunded.
 */
const getRefundAmount = (order) => {
  if (order.paymentMethod === 'COD')       return 0;
  if (order.paymentMethod === 'Razorpay' && order.paymentStatus !== 'paid') return 0;
  return order.pricing.grandTotal;
};

/**
 * Calculates the refund amount for a single cancelled item proportionally.
 * Uses the item's totalPrice relative to the order subtotal to prorate
 * discounts (coupon + item discount) and tax/shipping.
 */
const getItemRefundAmount = (order, item) => {
  if (order.paymentMethod === 'COD') return 0;
  if (order.paymentMethod === 'Razorpay' && order.paymentStatus !== 'paid') return 0;

  // If only one active item remains (or this is the last), just refund what remains
  const activeItems = order.items.filter(i => i.status === 'active');
  if (activeItems.length === 1) {
    // This is effectively a full cancellation — caller should handle via cancelEntireOrder
    return order.pricing.grandTotal;
  }

  // Prorate: item's share of the grand total
  const subtotal    = order.pricing.subtotal;
  const itemShare   = subtotal > 0 ? item.totalPrice / subtotal : 0;
  const refund      = Math.round(order.pricing.grandTotal * itemShare);
  return refund;
};

// ── Read operations ───────────────────────────────────────────────────────

export const fetchOrders = async ({ userId, search, page }) => {
  const limit     = 8;
  const safePage  = Math.max(1, parseInt(page) || 1);
  const baseQuery = { user: userId };

  if (search) {
    const statusValues  = ['confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'];
    const matchedStatus = statusValues.find(s => s.startsWith(search.toLowerCase()));

    baseQuery.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { 'items.name': { $regex: search, $options: 'i' } },
      { 'items.brand': { $regex: search, $options: 'i' } },
      ...(matchedStatus ? [{ orderStatus: matchedStatus }] : []),
    ];
  }

  const total       = await Order.countDocuments(baseQuery);
  const totalPages  = Math.ceil(total / limit) || 1;
  const currentPage = Math.min(safePage, totalPages);

  const orders = await Order.find(baseQuery)
    .sort({ createdAt: -1 })
    .skip((currentPage - 1) * limit)
    .limit(limit)
    .lean();

  return { orders, total, page: currentPage, totalPages };
};

export const fetchOrderDetail = async ({ orderNumber, userId }) => {
  const order = await Order.findOne({ orderNumber, user: userId }).lean();
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  return order;
};

export const fetchOrderForSSE = async ({ orderNumber, userId }) => {
  const order = await Order.findOne({ orderNumber, user: userId }).lean();
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  return order;
};

// ── Cancellation ──────────────────────────────────────────────────────────

export const cancelEntireOrder = async ({ orderNumber, userId, reason }) => {
  const order = await Order.findOne({ orderNumber, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const cancellable = ['confirmed', 'processing'];
  if (!cancellable.includes(order.orderStatus)) {
    throw Object.assign(
      new Error(`Order cannot be cancelled in "${order.orderStatus}" status.`),
      { status: 400 }
    );
  }

  // Restore stock for all active items
  await Promise.all(
    order.items
      .filter(i => i.status === 'active')
      .map(i => restoreStockAndBroadcast(i.product, i.quantity, i.variantName || null))
  );

  order.items.forEach(i => {
    if (i.status === 'active') i.status = 'cancelled';
  });

  order.orderStatus      = 'cancelled';
  order.cancellationNote = (reason || '').trim();
  await order.save();

  // Wallet refund — immediate for Razorpay/Wallet paid orders
  const refundAmount = getRefundAmount(order);
  if (refundAmount > 0) {
    const wallet = await Wallet.getOrCreate(userId);
    await wallet.credit(
      refundAmount,
      `Refund for cancelled order ${order.orderNumber}`,
      'cancellation_refund',
      order
    );
    return { order, refunded: true, refundAmount };
  }

  return { order, refunded: false, refundAmount: 0 };
};

export const cancelSingleItem = async ({ orderNumber, userId, itemId, reason }) => {
  if (!itemId) throw Object.assign(new Error('itemId is required.'), { status: 400 });

  const order = await Order.findOne({ orderNumber, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const cancellable = ['confirmed', 'processing'];
  if (!cancellable.includes(order.orderStatus)) {
    throw Object.assign(
      new Error(`Items cannot be cancelled in "${order.orderStatus}" status.`),
      { status: 400 }
    );
  }

  const item = order.items.id(itemId);
  if (!item)                   throw Object.assign(new Error('Item not found in order.'),        { status: 404 });
  if (item.status === 'cancelled') throw Object.assign(new Error('Item is already cancelled.'), { status: 400 });

  // Calculate refund BEFORE mutating the order
  const refundAmount = getItemRefundAmount(order, item);

  await restoreStockAndBroadcast(item.product, item.quantity, item.variantName || null);

  item.status           = 'cancelled';
  item.cancellationNote = (reason || '').trim();

  const allCancelled = order.items.every(i => i.status === 'cancelled');
  if (allCancelled) {
    order.orderStatus      = 'cancelled';
    order.cancellationNote = 'All items cancelled individually.';
  }

  await order.save();

  // Wallet refund — immediate
  let refunded = false;
  if (refundAmount > 0) {
    const wallet = await Wallet.getOrCreate(userId);
    await wallet.credit(
      refundAmount,
      `Refund for cancelled item "${item.name}" in order ${order.orderNumber}`,
      'cancellation_refund',
      order
    );
    refunded = true;
  }

  return { order, allCancelled, refunded, refundAmount };
};

// ── Return requests ───────────────────────────────────────────────────────

export const requestReturn = async ({ orderNumber, userId, reason }) => {
  if (!reason) throw Object.assign(new Error('Return reason is required.'), { status: 400 });

  const order = await Order.findOne({ orderNumber, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (order.orderStatus !== 'delivered') {
    throw Object.assign(new Error('Only delivered orders can be returned.'), { status: 400 });
  }

  if (order.returnStatus && order.returnStatus !== 'none') {
    throw Object.assign(
      new Error('A return request has already been submitted for this order.'),
      { status: 400 }
    );
  }

  order.orderStatus           = 'returned';
  order.returnStatus          = 'pending';
  order.returnReason          = reason;
  order.returnRequestedAt     = new Date();
  order.returnRejectionReason = '';

  order.items.forEach(i => {
    if (i.status === 'active' && i.returnStatus === 'none') {
      i.returnStatus      = 'pending';
      i.returnReason      = reason;
      i.returnRequestedAt = new Date();
    }
  });

  await order.save();
  return order;
};

export const requestItemReturn = async ({ orderNumber, userId, itemId, reason }) => {
  if (!itemId) throw Object.assign(new Error('itemId is required.'), { status: 400 });
  if (!reason) throw Object.assign(new Error('Return reason is required.'), { status: 400 });

  const order = await Order.findOne({ orderNumber, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (order.orderStatus !== 'delivered') {
    throw Object.assign(new Error('Only delivered orders can have items returned.'), { status: 400 });
  }

  const item = order.items.id(itemId);
  if (!item)                      throw Object.assign(new Error('Item not found in order.'),                              { status: 404 });
  if (item.status === 'cancelled') throw Object.assign(new Error('This item was cancelled and cannot be returned.'),      { status: 400 });
  if (item.returnStatus !== 'none') throw Object.assign(new Error('A return request has already been submitted for this item.'), { status: 400 });

  item.returnStatus      = 'pending';
  item.returnReason      = reason;
  item.returnRequestedAt = new Date();

  const activeItems = order.items.filter(i => i.status === 'active');
  const allPending  = activeItems.every(i =>
    i.returnStatus === 'pending' || i._id.toString() === itemId
  );

  if (allPending) {
    order.returnStatus      = 'pending';
    order.returnReason      = 'All items return requested.';
    order.returnRequestedAt = new Date();
    order.orderStatus       = 'returned';
  }

  await order.save();
  return order;
};

// ── Admin: accept / reject returns (with wallet refund on accept) ─────────

/**
 * Admin accepts an entire order return.
 * Restores stock + credits wallet immediately.
 */
export const acceptOrderReturn = async ({ orderNumber }) => {
  const order = await Order.findOne({ orderNumber });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (order.returnStatus !== 'pending') {
    throw Object.assign(new Error('No pending return request on this order.'), { status: 400 });
  }

  // Restore stock for every active item with a pending return
  await Promise.all(
    order.items
      .filter(i => i.status === 'active' && i.returnStatus === 'pending')
      .map(i => restoreStockAndBroadcast(i.product, i.quantity, i.variantName || null))
  );

  order.returnStatus = 'accepted';
  order.items.forEach(i => {
    if (i.status === 'active' && i.returnStatus === 'pending') {
      i.returnStatus = 'accepted';
    }
  });
  await order.save();

  // Wallet refund — only if the order was paid online or via wallet
  const refundAmount = getRefundAmount(order);
  if (refundAmount > 0) {
    const wallet = await Wallet.getOrCreate(order.user);
    await wallet.credit(
      refundAmount,
      `Refund for returned order ${order.orderNumber}`,
      'return_refund',
      order
    );
    return { order, refunded: true, refundAmount };
  }

  return { order, refunded: false, refundAmount: 0 };
};

/**
 * Admin rejects an entire order return.
 * No stock or wallet changes.
 */
export const rejectOrderReturn = async ({ orderNumber, rejectionReason }) => {
  const order = await Order.findOne({ orderNumber });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (order.returnStatus !== 'pending') {
    throw Object.assign(new Error('No pending return request on this order.'), { status: 400 });
  }

  order.returnStatus          = 'rejected';
  order.returnRejectionReason = (rejectionReason || '').trim();
  order.orderStatus           = 'delivered'; // revert to delivered
  order.items.forEach(i => {
    if (i.status === 'active' && i.returnStatus === 'pending') {
      i.returnStatus           = 'rejected';
      i.returnRejectionReason  = (rejectionReason || '').trim();
    }
  });
  await order.save();
  return order;
};

/**
 * Admin accepts a single-item return.
 * Restores stock + credits wallet proportionally.
 */
export const acceptItemReturn = async ({ orderNumber, itemId }) => {
  if (!itemId) throw Object.assign(new Error('itemId is required.'), { status: 400 });

  const order = await Order.findOne({ orderNumber });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const item = order.items.id(itemId);
  if (!item)                         throw Object.assign(new Error('Item not found.'),                    { status: 404 });
  if (item.returnStatus !== 'pending') throw Object.assign(new Error('Item has no pending return request.'), { status: 400 });

  // Calculate refund BEFORE mutating
  const refundAmount = getItemRefundAmount(order, item);

  await restoreStockAndBroadcast(item.product, item.quantity, item.variantName || null);

  item.returnStatus = 'accepted';

  // If all active items are now accepted → mark order-level as accepted too
  const activeItems = order.items.filter(i => i.status === 'active');
  const allAccepted = activeItems.every(i => i.returnStatus === 'accepted');
  if (allAccepted) order.returnStatus = 'accepted';

  await order.save();

  // Wallet refund
  let refunded = false;
  if (refundAmount > 0) {
    const wallet = await Wallet.getOrCreate(order.user);
    await wallet.credit(
      refundAmount,
      `Refund for returned item "${item.name}" in order ${order.orderNumber}`,
      'return_refund',
      order
    );
    refunded = true;
  }

  return { order, refunded, refundAmount };
};

/**
 * Admin rejects a single-item return.
 */
export const rejectItemReturn = async ({ orderNumber, itemId, rejectionReason }) => {
  if (!itemId) throw Object.assign(new Error('itemId is required.'), { status: 400 });

  const order = await Order.findOne({ orderNumber });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const item = order.items.id(itemId);
  if (!item)                           throw Object.assign(new Error('Item not found.'),                    { status: 404 });
  if (item.returnStatus !== 'pending') throw Object.assign(new Error('Item has no pending return request.'), { status: 400 });

  item.returnStatus          = 'rejected';
  item.returnRejectionReason = (rejectionReason || '').trim();

  // If all active items are now settled (accepted/rejected) → update order-level return status
  const activeItems  = order.items.filter(i => i.status === 'active');
  const allSettled   = activeItems.every(i => ['accepted', 'rejected', 'none'].includes(i.returnStatus) && i.returnStatus !== 'pending');
  const anyAccepted  = activeItems.some(i => i.returnStatus === 'accepted');
  if (allSettled) {
    order.returnStatus = anyAccepted ? 'accepted' : 'rejected';
    if (order.returnStatus === 'rejected') {
      order.returnRejectionReason = (rejectionReason || '').trim();
      order.orderStatus = 'delivered';
    }
  }

  await order.save();
  return order;
};

// ── Wallet read ───────────────────────────────────────────────────────────

export const fetchWallet = async (userId) => {
  const wallet = await Wallet.getOrCreate(userId);
  // Return transactions newest-first for display
  const transactions = [...wallet.transactions].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  return { balance: wallet.balance, transactions };
};

// ── Invoice PDF ───────────────────────────────────────────────────────────

export const generateInvoicePDF = async ({ orderNumber, userId, res }) => {
  const order = await Order.findOne({ orderNumber, user: userId }).lean();
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const doc  = new PDFDocument({ margin: 50, size: 'A4' });
  const GOLD  = '#c9a96e';
  const DARK  = '#111110';
  const GREY  = '#555555';
  const LIGHT = '#888888';
  const W     = 495;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.orderNumber}.pdf"`);
  doc.pipe(res);

  doc.rect(50, 40, W, 70).fill(DARK);
  doc.fillColor('#f5f2eb').font('Helvetica-Bold').fontSize(18).text('VELMORA CHRONÉ', 60, 58);
  doc.fillColor(GOLD).font('Helvetica').fontSize(8).text('L U X U R Y  T I M E P I E C E S', 60, 80);
  doc.fillColor('#f5f2eb').fontSize(9)
    .text('INVOICE', 450, 58, { align: 'right', width: 95 })
    .text(`#${order.orderNumber}`, 450, 72, { align: 'right', width: 95 });

  let y = 130;
  const placed = new Date(order.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  doc.fillColor(GREY).font('Helvetica').fontSize(8);
  doc.text(`Date: ${placed}`, 50, y);
  doc.text(`Payment: ${order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod}`, 250, y);
  doc.text(`Status: ${order.orderStatus.toUpperCase()}`, 420, y);

  y += 24;
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(7).text('SHIP TO', 50, y);
  y += 12;
  const addr = order.shippingAddress;
  doc.fillColor(DARK).font('Helvetica').fontSize(8)
    .text(addr.fullName, 50, y)
    .text(addr.line1, 50, y + 12)
    .text(`${addr.city}${addr.state ? ', ' + addr.state : ''} — ${addr.pincode}`, 50, y + 24)
    .text(addr.phone, 50, y + 36);

  y += 70;
  doc.rect(50, y, W, 18).fill('#f0ece3');
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7.5);
  doc.text('ITEM',       55,  y + 5);
  doc.text('QTY',        340, y + 5, { width: 50, align: 'center' });
  doc.text('UNIT PRICE', 390, y + 5, { width: 70, align: 'right'  });
  doc.text('TOTAL',      460, y + 5, { width: 85, align: 'right'  });
  y += 20;

  doc.font('Helvetica').fontSize(8);
  order.items.forEach((item, idx) => {
    const isCancelled = item.status === 'cancelled';
    doc.rect(50, y, W, 22).fill(idx % 2 === 0 ? '#fafaf8' : '#ffffff');
    doc.fillColor(isCancelled ? LIGHT : DARK)
      .text(item.name + (item.brand ? ` (${item.brand})` : ''), 55, y + 7, { width: 270 });
    if (isCancelled) {
      doc.fillColor(LIGHT).font('Helvetica-Oblique').fontSize(7).text('Cancelled', 55, y + 16, { width: 270 });
      doc.font('Helvetica').fontSize(8);
    }
    const unitPrice = item.price || (item.totalPrice / item.quantity);
    doc.fillColor(isCancelled ? LIGHT : GREY)
      .text(String(item.quantity),  340, y + 7, { width: 50, align: 'center' })
      .text(`Rs.${unitPrice.toLocaleString('en-IN')}`, 390, y + 7, { width: 70, align: 'right' })
      .text(isCancelled ? '—' : `Rs.${item.totalPrice.toLocaleString('en-IN')}`, 460, y + 7, { width: 85, align: 'right' });
    y += 24;
  });

  doc.moveTo(50, y).lineTo(545, y).strokeColor('#dddddd').lineWidth(0.5).stroke();
  y += 14;

  const p = order.pricing;
  const addRow = (label, value, bold = false, color = DARK) => {
    if (bold) { doc.font('Helvetica-Bold'); doc.rect(50, y - 3, W, 18).fill('#f0ece3'); }
    else        doc.font('Helvetica');
    doc.fillColor(color).fontSize(bold ? 9 : 8)
      .text(label, 350, y, { width: 150 })
      .text(value, 500, y, { width: 45, align: 'right' });
    y += bold ? 20 : 16;
  };

  addRow('Subtotal',  `Rs.${p.subtotal.toLocaleString('en-IN')}`);
  if (p.itemDiscount   > 0) addRow('Item Discount',   `- Rs.${p.itemDiscount.toLocaleString('en-IN')}`,   false, '#16a34a');
  if (p.couponDiscount > 0) addRow('Coupon Discount', `- Rs.${p.couponDiscount.toLocaleString('en-IN')}`, false, '#16a34a');
  addRow('GST (18%)', `Rs.${p.tax.toLocaleString('en-IN')}`);
  addRow('Shipping',  p.shipping === 0 ? 'Free' : `Rs.${p.shipping.toLocaleString('en-IN')}`);
  y += 4;
  addRow('TOTAL PAID', `Rs.${p.grandTotal.toLocaleString('en-IN')}`, true);

  y += 30;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(GOLD).lineWidth(0.5).stroke();
  y += 10;
  doc.fillColor(LIGHT).font('Helvetica').fontSize(7)
    .text('Thank you for your purchase from Velmora Chroné.', 50, y, { align: 'center', width: W })
    .text('For support, contact support@velmorachrone.com',   50, y + 12, { align: 'center', width: W });

  doc.end();
};