import Order       from '../../models/order.js';
import Product     from '../../models/product.js';
import PDFDocument from 'pdfkit';
import { addOrderClient } from '../../public/utils/ssemanager.js';

export const streamOrderStatus = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id  : req.params.id,
      user : req.user._id,
    }).lean();

    if (!order) {
      res.status(404).end();
      return;
    }

    addOrderClient(req.params.id, res);

    res.write(`event: orderStatus\ndata: ${JSON.stringify({ orderStatus: order.orderStatus })}\n\n`);
  } catch (err) {
    console.error('[streamOrderStatus]', err);
    res.status(500).end();
  }
};

export const getOrders = async (req, res) => {
  try {
    const search   = (req.query.search || '').trim();
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = 8;

    const baseQuery = { user: req.user._id };

    if (search) {
      const statusValues = ['confirmed','processing','dispatched','delivered','cancelled','returned'];
      const matchedStatus = statusValues.find(s => s.startsWith(search.toLowerCase()));

      baseQuery.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'items.name': { $regex: search, $options: 'i' } },
        { 'items.brand': { $regex: search, $options: 'i' } },
        ...(matchedStatus ? [{ orderStatus: matchedStatus }] : []),
      ];
    }

    const total      = await Order.countDocuments(baseQuery);
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage   = Math.min(page, totalPages);

    const orders = await Order.find(baseQuery)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    res.render('user/orders', {
      orders,
      search,
      total,
      page      : safePage,
      totalPages,
    });
  } catch (err) {
    console.error('[getOrders]', err);
    res.status(500).render('500', { message: 'Something went wrong' });
  }
};

export const getOrderDetail = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id  : req.params.id,
      user : req.user._id,
    }).lean();

    if (!order) {
      return res.status(404).render('404', { message: 'Order not found' });
    }

    res.render('user/orderDetail', { order });
  } catch (err) {
    console.error('[getOrderDetail]', err);
    res.status(500).render('500', { message: 'Something went wrong' });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id  : req.params.id,
      user : req.user._id,
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const cancellable = ['confirmed', 'processing'];
    if (!cancellable.includes(order.orderStatus)) {
      return res.status(400).json({
        success : false,
        message : `Order cannot be cancelled in "${order.orderStatus}" status.`,
      });
    }

    const stockOps = order.items
      .filter(i => i.status === 'active')
      .map(i => Product.findByIdAndUpdate(i.product, { $inc: { stock: i.quantity } }));
    await Promise.all(stockOps);

    order.items.forEach(i => {
      if (i.status === 'active') i.status = 'cancelled';
    });

    order.orderStatus      = 'cancelled';
    order.cancellationNote = (req.body.reason || '').trim();
    await order.save();

    return res.json({ success: true, message: 'Order cancelled successfully.' });
  } catch (err) {
    console.error('[cancelOrder]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

export const cancelItem = async (req, res) => {
  try {
    const { itemId, reason } = req.body;

    if (!itemId) {
      return res.status(400).json({ success: false, message: 'itemId is required.' });
    }

    const order = await Order.findOne({
      _id  : req.params.id,
      user : req.user._id,
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const cancellable = ['confirmed', 'processing'];
    if (!cancellable.includes(order.orderStatus)) {
      return res.status(400).json({
        success : false,
        message : `Items cannot be cancelled in "${order.orderStatus}" status.`,
      });
    }

    const item = order.items.id(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found in order.' });
    }
    if (item.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Item is already cancelled.' });
    }

    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });

    item.status           = 'cancelled';
    item.cancellationNote = (reason || '').trim();

    const allCancelled = order.items.every(i => i.status === 'cancelled');
    if (allCancelled) {
      order.orderStatus      = 'cancelled';
      order.cancellationNote = 'All items cancelled individually.';
    }

    await order.save();

    return res.json({ success: true, message: 'Item cancelled.', allCancelled });
  } catch (err) {
    console.error('[cancelItem]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

export const returnOrder = async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim();

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Return reason is required.' });
    }

    const order = await Order.findOne({
      _id  : req.params.id,
      user : req.user._id,
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({
        success : false,
        message : 'Only delivered orders can be returned.',
      });
    }

    if (order.returnStatus && order.returnStatus !== 'none') {
      return res.status(400).json({
        success : false,
        message : 'A return request has already been submitted for this order.',
      });
    }

    order.orderStatus           = 'returned';
    order.returnStatus          = 'pending';
    order.returnReason          = reason;
    order.returnRequestedAt     = new Date();
    order.returnRejectionReason = '';

    await order.save();

    return res.json({ success: true, message: 'Return request submitted successfully.' });
  } catch (err) {
    console.error('[returnOrder]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

export const downloadInvoice = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id  : req.params.id,
      user : req.user._id,
    }).lean();

    if (!order) {
      return res.status(404).send('Order not found.');
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${order.orderNumber}.pdf"`
    );
    doc.pipe(res);

    const GOLD  = '#c9a96e';
    const DARK  = '#111110';
    const GREY  = '#555555';
    const LIGHT = '#888888';
    const W     = 495;

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
  } catch (err) {
    console.error('[downloadInvoice]', err);
    res.status(500).send('Could not generate invoice.');
  }
};