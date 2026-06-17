import Order      from '../models/order.js';
import Product    from '../models/product.js';
import PDFDocument from 'pdfkit';
import { restoreStockAndBroadcast } from './checkoutService.js';

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

  return order;
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
  if (!item) throw Object.assign(new Error('Item not found in order.'), { status: 404 });
  if (item.status === 'cancelled') throw Object.assign(new Error('Item is already cancelled.'), { status: 400 });

  await restoreStockAndBroadcast(item.product, item.quantity, item.variantName || null);

  item.status           = 'cancelled';
  item.cancellationNote = (reason || '').trim();

  const allCancelled = order.items.every(i => i.status === 'cancelled');
  if (allCancelled) {
    order.orderStatus      = 'cancelled';
    order.cancellationNote = 'All items cancelled individually.';
  }

  await order.save();
  return { order, allCancelled };
};

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

  order.orderStatus       = 'returned';
  order.returnStatus      = 'pending';
  order.returnReason      = reason;
  order.returnRequestedAt = new Date();
  order.returnRejectionReason = '';

  // Mark all active items as return pending too
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
  if (!item) throw Object.assign(new Error('Item not found in order.'), { status: 404 });
  if (item.status === 'cancelled') throw Object.assign(new Error('This item was cancelled and cannot be returned.'), { status: 400 });
  if (item.returnStatus !== 'none') {
    throw Object.assign(new Error('A return request has already been submitted for this item.'), { status: 400 });
  }

  item.returnStatus      = 'pending';
  item.returnReason      = reason;
  item.returnRequestedAt = new Date();

  // If every active item now has a return request, bubble up to order level
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