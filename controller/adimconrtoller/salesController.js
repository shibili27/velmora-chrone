import Order from '../../models/order.js';

// ── Date range helper ─────────────────────────────────────────────────────

const getDateRange = (filter, customStart, customEnd) => {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filter) {
    case 'daily': {
      const start = new Date(today);
      const end   = new Date(today);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case 'weekly': {
      const start = new Date(today);
      start.setDate(today.getDate() - 6);
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case 'monthly': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end   = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { start, end };
    }
    case 'yearly': {
      const start = new Date(today.getFullYear(), 0, 1);
      const end   = new Date(today.getFullYear() + 1, 0, 1);
      return { start, end };
    }
    case 'custom': {
      if (!customStart || !customEnd) throw Object.assign(new Error('Please provide both start and end dates.'), { status: 400 });
      const start = new Date(customStart);
      const end   = new Date(customEnd);
      end.setDate(end.getDate() + 1);
      if (isNaN(start) || isNaN(end)) throw Object.assign(new Error('Invalid date format.'),                    { status: 400 });
      if (start > end)                throw Object.assign(new Error('Start date must be before end date.'),     { status: 400 });
      return { start, end };
    }
    default:
      throw Object.assign(new Error('Invalid filter type.'), { status: 400 });
  }
};

// ── Page ──────────────────────────────────────────────────────────────────

export async function getSalesReport(req, res) {
  try {
    const { filter = 'daily', startDate, endDate } = req.query;
    const { start, end } = getDateRange(filter, startDate, endDate);

    const matchStage = {
      createdAt    : { $gte: start, $lt: end },
      orderStatus  : { $nin: ['cancelled'] },
      paymentStatus: { $nin: ['failed'] },
    };

    // ── Summary totals ──────────────────────────────────────────────────
    const [summary] = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id           : null,
          totalOrders   : { $sum: 1 },
          totalRevenue  : { $sum: '$pricing.grandTotal' },
          totalSubtotal : { $sum: '$pricing.subtotal' },
          itemDiscount  : { $sum: '$pricing.itemDiscount' },
          couponDiscount: { $sum: '$pricing.couponDiscount' },
          totalTax      : { $sum: '$pricing.tax' },
          totalShipping : { $sum: '$pricing.shipping' },
        },
      },
    ]);

    // ── Chart data grouped by day ───────────────────────────────────────
    const chartData = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id    : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$pricing.grandTotal' },
          orders : { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Order table ─────────────────────────────────────────────────────
    const orders = await Order.find(matchStage)
      .populate('user', 'name email')
      .select('orderNumber createdAt pricing couponCode paymentMethod orderStatus items')
      .sort({ createdAt: -1 })
      .lean();

    const totalDiscount = (summary?.itemDiscount || 0) + (summary?.couponDiscount || 0);

    return res.render('admin/salesReport', {
      title     : 'Sales Report',
      adminName : req.session?.admin?.name || 'Admin',
      success   : req.flash ? req.flash('success')[0] : null,
      error     : req.flash ? req.flash('error')[0]   : null,
      filter,
      startDate : startDate || '',
      endDate   : endDate   || '',
      dateRange : { start, end },
      summary   : {
        totalOrders   : summary?.totalOrders    || 0,
        totalRevenue  : summary?.totalRevenue   || 0,
        totalSubtotal : summary?.totalSubtotal  || 0,
        itemDiscount  : summary?.itemDiscount   || 0,
        couponDiscount: summary?.couponDiscount || 0,
        totalDiscount,
        totalTax      : summary?.totalTax       || 0,
        totalShipping : summary?.totalShipping  || 0,
      },
      chartData,
      orders,
    });
  } catch (err) {
    console.error('[SalesReport] error:', err);
    req.flash?.('error', err.message || 'Failed to load sales report.');
    return res.redirect('/admin/dashboard');
  }
}