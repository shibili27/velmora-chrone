import Order   from '../../models/Order.js';
import Wallet  from '../../models/wallet.js';
import Product from '../../models/product.js';
import { broadcastOrderUpdate } from '../../public/utils/ssemanager.js';

const LIMIT = 15;

export const listOrders = async (req, res) => {
  try {
    const {
      page         = 1,
      search       = '',
      status       = 'all',
      sort         = 'date_desc',
      from,
      to,
      returnFilter = '',
    } = req.query;

    const currentPage = Math.max(1, parseInt(page));
    const query = {};
    const validStatuses = ['confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'];

    if (status && status !== 'all' && validStatuses.includes(status)) {
      query.orderStatus = status;
    }

    if (returnFilter && ['pending', 'accepted', 'rejected'].includes(returnFilter)) {
      query.returnStatus = returnFilter;
    }

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }

    const sortMap = {
      date_desc   : { createdAt: -1 },
      date_asc    : { createdAt:  1 },
      amount_desc : { 'pricing.grandTotal': -1 },
      amount_asc  : { 'pricing.grandTotal':  1 },
    };
    const sortObj = sortMap[sort] || { createdAt: -1 };

    let orders;
    let totalOrders;

    if (search && search.trim()) {
      const searchTrim = search.trim();
      const pipeline = [
        { $match: query },
        {
          $lookup: {
            from        : 'users',
            localField  : 'user',
            foreignField: '_id',
            as          : 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmpty: true } },
        {
          $match: {
            $or: [
              { orderNumber : { $regex: searchTrim, $options: 'i' } },
              { 'user.name' : { $regex: searchTrim, $options: 'i' } },
              { 'user.email': { $regex: searchTrim, $options: 'i' } },
            ],
          },
        },
      ];

      const countResult = await Order.aggregate([...pipeline, { $count: 'total' }]);
      totalOrders = countResult[0]?.total || 0;
      orders = await Order.aggregate([
        ...pipeline,
        { $sort: sortObj },
        { $skip: (currentPage - 1) * LIMIT },
        { $limit: LIMIT },
      ]);
    } else {
      totalOrders = await Order.countDocuments(query);
      orders = await Order.find(query)
        .populate('user', 'name email isBlocked createdAt')
        .sort(sortObj)
        .skip((currentPage - 1) * LIMIT)
        .limit(LIMIT)
        .lean();
    }

    const countAgg = await Order.aggregate([
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
    ]);
    const counts = { all: 0 };
    validStatuses.forEach(s => { counts[s] = 0; });
    countAgg.forEach(({ _id, count }) => {
      counts[_id]  = count;
      counts.all  += count;
    });

    counts.returnPending = await Order.countDocuments({
      $or: [
        { returnStatus: 'pending' },
        { 'items.returnStatus': 'pending' },
      ],
    });

    const totalPages = Math.ceil(totalOrders / LIMIT);

    res.render('admin/orders', {
      adminName          : req.session.adminName || 'Admin',
      adminRole          : req.session.adminRole || 'Administrator',
      orders,
      totalOrders,
      counts,
      currentPage,
      totalPages,
      limit              : LIMIT,
      currentStatus      : status,
      currentSearch      : search,
      currentSort        : sort,
      currentFrom        : from || '',
      currentTo          : to   || '',
      currentReturnFilter: returnFilter,
    });
  } catch (err) {
    console.error('listOrders error:', err);
    req.flash('error', 'Failed to load orders.');
    res.redirect('/admin/dashboard');
  }
};

export const getOrderDetail = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email isBlocked createdAt')
      .lean();

    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/admin/orders');
    }

    // ── Pre-compute the refund amount the admin will see in the confirm modal.
    // Whole-order returns: deduct shipping from what the customer actually paid.
    // If grandTotal <= shipping (edge case like the ₹99 scenario), refund is ₹0.
    const shippingCharge  = order.pricing.shipping || 0;
    const refundAmount    = Math.max(0, order.pricing.grandTotal - shippingCharge);

    res.render('admin/orderDetail', {
      adminName    : req.session.adminName || 'Admin',
      adminRole    : req.session.adminRole || 'Administrator',
      order,
      refundAmount,   // passed to EJS so the confirm modal shows the correct figure
      shippingCharge,
    });
  } catch (err) {
    console.error('getOrderDetail error:', err);
    req.flash('error', 'Failed to load order.');
    res.redirect('/admin/orders');
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;

    const validStatuses = ['confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    const updateFields = { orderStatus: status };

    if (note && note.trim()) {
      if (status === 'cancelled') updateFields.cancellationNote = note.trim();
      if (status === 'returned')  updateFields.returnReason     = note.trim();
    }

    if (status === 'returned') {
      updateFields.returnStatus          = 'pending';
      updateFields.returnRequestedAt     = new Date();
      updateFields.returnRejectionReason = '';
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    broadcastOrderUpdate(req.params.id, { orderStatus: order.orderStatus });

    res.json({ success: true, status: order.orderStatus });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Restock a single order item's product (and matching colour variant if present).
 */
async function restockOrderItem(item) {
  if (item.restocked) {
    return { skipped: true, reason: 'already-restocked' };
  }

  const product = await Product.findById(item.product);
  if (!product) {
    item.restocked = true;
    return { skipped: true, reason: 'product-not-found' };
  }

  let fallbackUsed = false;

  if (item.variantName && Array.isArray(product.colorVariants) && product.colorVariants.length > 0) {
    const variant = product.colorVariants.find(v => v.name === item.variantName);
    if (variant) {
      variant.stock = (variant.stock || 0) + item.quantity;
      product.stock = product.colorVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
    } else {
      product.stock = (product.stock || 0) + item.quantity;
      fallbackUsed  = true;
    }
  } else {
    product.stock = (product.stock || 0) + item.quantity;
    fallbackUsed  = true;
  }

  await product.save();
  item.restocked = true;

  return { skipped: false, fallbackUsed, product };
}

/**
 * ── Order-level return verification ──────────────────────────────────────
 * On acceptance the refund = grandTotal − shippingCharge.
 * Shipping is a non-refundable fulfilment cost the business already incurred.
 * If grandTotal ≤ shippingCharge the refund is ₹0 (never goes negative).
 *
 * Free-shipping orders (shipping = 0): full grandTotal is refunded as before.
 */
export const handleReturnRequest = async (req, res) => {
  try {
    const { decision, rejectionReason, restock = true } = req.body;

    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Invalid decision. Must be accepted or rejected.' });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.returnStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending return request on this order.' });
    }

    let restockedCount = 0;

    if (decision === 'accepted') {
      // ── FIX: deduct shipping before refunding ──────────────────────────
      // The shipping charge is a fulfilment cost the business already paid
      // (courier fee). It is non-refundable regardless of why the item was
      // returned. grandTotal already includes tax + shipping, so we strip
      // only the shipping portion before crediting the wallet.
      const shippingCharge = order.pricing.shipping || 0;
      const refundAmount   = Math.max(0, order.pricing.grandTotal - shippingCharge);

      const wallet = await Wallet.getOrCreate(order.user);

      if (refundAmount > 0) {
        await wallet.credit(
          refundAmount,
          `Refund for returned order ${order.orderNumber} (shipping ₹${shippingCharge} non-refundable)`,
          'return_refund',
          order
        );
      }
      // If refundAmount === 0 (edge case: customer paid only shipping),
      // we still mark the return as accepted — no wallet credit needed.

      order.returnStatus = 'accepted';
      order.orderStatus  = 'returned';
      order.items.forEach(item => {
        if (item.status === 'active') {
          item.returnStatus = 'accepted';
        }
      });

      if (restock) {
        for (const item of order.items) {
          if (item.status !== 'active') continue;
          try {
            const result = await restockOrderItem(item);
            if (!result.skipped) restockedCount++;
          } catch (stockErr) {
            console.error(`Restock failed for item "${item.name}" on order ${order.orderNumber}:`, stockErr.message);
          }
        }
      }
    } else {
      order.returnStatus = 'rejected';
      if (rejectionReason && rejectionReason.trim()) {
        order.returnRejectionReason = rejectionReason.trim();
      }
    }

    await order.save();

    broadcastOrderUpdate(order._id.toString(), { orderStatus: order.orderStatus });

    let message;
    if (decision === 'accepted') {
      const shippingCharge = order.pricing.shipping || 0;
      const refundAmount   = Math.max(0, order.pricing.grandTotal - shippingCharge);
      if (refundAmount > 0) {
        message = restock
          ? `Return accepted. ₹${refundAmount.toLocaleString('en-IN')} refunded to wallet (₹${shippingCharge} shipping deducted). ${restockedCount} item(s) restocked.`
          : `Return accepted. ₹${refundAmount.toLocaleString('en-IN')} refunded to wallet (₹${shippingCharge} shipping deducted).`;
      } else {
        message = restock
          ? `Return accepted. No refund issued — order total was only the shipping charge. ${restockedCount} item(s) restocked.`
          : 'Return accepted. No refund issued — order total was only the shipping charge.';
      }
    } else {
      message = 'Return rejected.';
    }

    return res.json({ success: true, message });
  } catch (err) {
    console.error('handleReturnRequest error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error. Please try again.' });
  }
};

/**
 * ── Item-level return verification ───────────────────────────────────────
 * Shipping is an ORDER-level charge, not per-item. So when a single item
 * is returned (not the whole order), NO shipping deduction is applied —
 * the customer paid one shipping fee for the whole order and only one item
 * is coming back. The refund is the item's totalPrice in full.
 *
 * If the LAST remaining item is returned (allResolved), the order cascades
 * to 'returned' but shipping was already non-refundable from the original
 * order-level charge — no further deduction needed here.
 */
export const handleItemReturnRequest = async (req, res) => {
  try {
    const { decision, rejectionReason, restock = true } = req.body;
    const { id: orderId, itemId } = req.params;

    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Invalid decision. Must be accepted or rejected.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const item = order.items.id(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found on this order.' });
    }

    if (item.returnStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending return request on this item.' });
    }

    if (decision === 'accepted') {
      // Item-level returns refund the item price in full —
      // shipping is an order-level charge, not split per item.
      const wallet = await Wallet.getOrCreate(order.user);
      await wallet.credit(
        item.totalPrice,
        `Refund for returned item "${item.name}" — order ${order.orderNumber}`,
        'return_refund',
        order
      );

      item.returnStatus = 'accepted';

      if (restock) {
        try {
          await restockOrderItem(item);
        } catch (stockErr) {
          console.error(`Restock failed for item "${item.name}" on order ${order.orderNumber}:`, stockErr.message);
        }
      }

      const allResolved = order.items.every(
        i => i.status !== 'active' || i.returnStatus === 'accepted'
      );
      if (allResolved) {
        order.orderStatus  = 'returned';
        order.returnStatus = 'accepted';
      }
    } else {
      item.returnStatus = 'rejected';
      if (rejectionReason && rejectionReason.trim()) {
        item.returnRejectionReason = rejectionReason.trim();
      }
    }

    await order.save();

    broadcastOrderUpdate(order._id.toString(), { orderStatus: order.orderStatus });

    return res.json({
      success : true,
      message : decision === 'accepted'
        ? `Item return accepted. ₹${item.totalPrice.toLocaleString('en-IN')} refunded to wallet.`
        : 'Item return rejected.',
    });
  } catch (err) {
    console.error('handleItemReturnRequest error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error. Please try again.' });
  }
};

export const restockItem = async (req, res) => {
  try {
    const { id: orderId, itemId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const item = order.items.id(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found on this order.' });
    }

    if (item.returnStatus !== 'accepted') {
      return res.status(400).json({ success: false, message: 'This item\'s return has not been accepted yet.' });
    }

    if (item.restocked) {
      return res.status(400).json({ success: false, message: 'This item has already been added back to stock.' });
    }

    const result = await restockOrderItem(item);
    await order.save();

    if (result.skipped && result.reason === 'product-not-found') {
      return res.json({
        success: true,
        message: 'Product no longer exists — nothing to restock, but marked as handled.',
      });
    }

    return res.json({
      success: true,
      message: result.fallbackUsed
        ? `Added ${item.quantity} unit(s) back to total stock (variant "${item.variantName || 'none'}" not found — applied to overall stock instead).`
        : `Added ${item.quantity} unit(s) back to "${item.variantName}" stock.`,
    });
  } catch (err) {
    console.error('restockItem error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error. Please try again.' });
  }
};

export const getRecentOrders = async (req, res) => {
  try {
    const since  = new Date(Date.now() - 60 * 1000);
    const orders = await Order.find({ createdAt: { $gte: since } })
      .populate('user', 'name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      orders : orders.map(o => ({
        _id          : o._id,
        orderNumber  : o.orderNumber,
        grandTotal   : o.pricing.grandTotal,
        itemCount    : o.items.length,
        paymentMethod: o.paymentMethod,
        customerName : o.user?.name || 'Customer',
        createdAt    : o.createdAt,
      })),
    });
  } catch (err) {
    console.error('getRecentOrders error:', err);
    res.json({ success: false, orders: [] });
  }
};