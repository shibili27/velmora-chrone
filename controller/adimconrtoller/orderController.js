import Order from '../../models/Order.js';
import { broadcastOrderUpdate } from '../../public/utils/ssemanager.js';

const LIMIT = 15;

export const listOrders = async (req, res) => {
  try {
    const {
      page   = 1,
      search = '',
      status = 'all',
      sort   = 'date_desc',
      from,
      to,
    } = req.query;

    const currentPage = Math.max(1, parseInt(page));
    const query = {};
    const validStatuses = ['confirmed', 'processing', 'dispatched', 'delivered', 'cancelled', 'returned'];

    if (status && status !== 'all' && validStatuses.includes(status)) {
      query.orderStatus = status;
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

    const totalPages = Math.ceil(totalOrders / LIMIT);

    res.render('admin/orders', {
      adminName     : req.session.adminName || 'Admin',
      adminRole     : req.session.adminRole || 'Administrator',
      orders,
      totalOrders,
      counts,
      currentPage,
      totalPages,
      limit         : LIMIT,
      currentStatus : status,
      currentSearch : search,
      currentSort   : sort,
      currentFrom   : from || '',
      currentTo     : to   || '',
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

    res.render('admin/orderDetail', {
      adminName : req.session.adminName || 'Admin',
      adminRole : req.session.adminRole || 'Administrator',
      order,
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
      updateFields.returnStatus           = 'pending';
      updateFields.returnRequestedAt      = new Date();
      updateFields.returnRejectionReason  = '';
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

export const handleReturnRequest = async (req, res) => {
  try {
    const { decision, rejectionReason } = req.body;

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

    order.returnStatus = decision;

    if (decision === 'rejected' && rejectionReason && rejectionReason.trim()) {
      order.returnRejectionReason = rejectionReason.trim();
    }

    await order.save();

    broadcastOrderUpdate(order._id.toString(), { orderStatus: order.orderStatus });

    return res.json({
      success : true,
      message : decision === 'accepted' ? 'Return accepted. Refund initiated.' : 'Return rejected.',
    });
  } catch (err) {
    console.error('handleReturnRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};