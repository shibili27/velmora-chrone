import PDFDocument from 'pdfkit';
import ExcelJS     from 'exceljs';
import Order       from '../../models/order.js';


const fmtINR  = n  => '₹' + (n || 0).toLocaleString('en-IN');
const fmtDate = d  => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const getDateRange = (filter, customStart, customEnd) => {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filter) {
    case 'today':
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
    case 'alltime': {
    
      return { start: null, end: null };
    }
    case 'custom': {
      if (!customStart || !customEnd)
        throw Object.assign(new Error('Please provide both start and end dates.'), { status: 400 });
      const start = new Date(customStart);
      const end   = new Date(customEnd);
      end.setDate(end.getDate() + 1);
      if (isNaN(start) || isNaN(end))
        throw Object.assign(new Error('Invalid date format.'), { status: 400 });
      if (start > end)
        throw Object.assign(new Error('Start date must be before end date.'), { status: 400 });
      return { start, end };
    }
    default:
      throw Object.assign(new Error('Invalid filter type.'), { status: 400 });
  }
};

const buildMatchStage = (start, end) => {
  const match = {
    orderStatus  : 'delivered',
    paymentStatus: { $nin: ['failed'] },
  };

  if (start && end) {
    match.createdAt = { $gte: start, $lt: end };
  }
  return match;
};


async function fetchReportData(filter, startDate, endDate) {
  const { start, end } = getDateRange(filter, startDate, endDate);
  const matchStage     = buildMatchStage(start, end);


  const summaryPipeline = [
    { $match: matchStage },
    { $unwind: '$items' },
    {
      $group: {
        _id           : '$_id',
        grandTotal    : { $first: '$pricing.grandTotal'    },
        subtotal      : { $first: '$pricing.subtotal'      },
        tax           : { $first: '$pricing.tax'           },
        shipping      : { $first: '$pricing.shipping'      },
        couponDiscount: { $first: '$pricing.couponDiscount' },
       
        itemDiscount  : {
          $sum: {
            $cond: [
              { $and: [
                { $gt: ['$items.originalPrice', 0] },
                { $gt: ['$items.originalPrice', '$items.price'] }
              ]},
              {
                $multiply: [
                  { $subtract: ['$items.originalPrice', '$items.price'] },
                  '$items.quantity'
                ]
              },
              0
            ]
          }
        },
      },
    },
    {
      $group: {
        _id           : null,
        totalOrders   : { $sum: 1 },
        totalRevenue  : { $sum: '$grandTotal'     },
        totalSubtotal : { $sum: '$subtotal'       },
        itemDiscount  : { $sum: '$itemDiscount'   },
        couponDiscount: { $sum: '$couponDiscount' },
        totalTax      : { $sum: '$tax'            },
        totalShipping : { $sum: '$shipping'       },
      },
    },
  ];

  const [summary] = await Order.aggregate(summaryPipeline);

  const s = summary || {};

  const itemDiscount   = s.itemDiscount   || 0;
  const couponDiscount = s.couponDiscount || 0;

  return {
    start,
    end,
    matchStage,
    summary: {
      totalOrders   : s.totalOrders    || 0,
      
      totalRevenue  : s.totalRevenue   || 0,
      totalSubtotal : s.totalSubtotal  || 0,       
      orderAmount   : s.totalRevenue   || 0,      
      itemDiscount,
      couponDiscount,
      totalDiscount : itemDiscount + couponDiscount,
      totalTax      : s.totalTax       || 0,
      totalShipping : s.totalShipping  || 0,
    },
  };
}


export async function getSalesReport(req, res) {
  try {
    const { filter = 'today', startDate, endDate } = req.query;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;

    const { start, end, matchStage, summary } = await fetchReportData(filter, startDate, endDate);

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

    const totalOrders = await Order.countDocuments(matchStage);
    const totalPages  = Math.ceil(totalOrders / limit);

    const orders = await Order.find(matchStage)
      .populate('user', 'name email')
      .select('orderNumber createdAt pricing couponCode paymentMethod orderStatus items')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    
    const ordersWithDiscount = orders.map(o => {
      let itemDiscount = o.pricing?.itemDiscount || 0;
      if (!itemDiscount && o.items?.length) {
        itemDiscount = o.items.reduce((acc, item) => {
          if (item.originalPrice && item.originalPrice > item.price) {
            return acc + (item.originalPrice - item.price) * (item.quantity || 1);
          }
          return acc;
        }, 0);
      }
      return { ...o, computedItemDiscount: itemDiscount };
    });

    return res.render('admin/salesReport', {
      title      : 'Sales Report — Velmora Chroné Admin',
      adminName  : req.session.adminName || 'Admin',
      success    : req.flash?.('success')[0] || null,
      error      : req.flash?.('error')[0]   || null,
      filter,
      startDate  : startDate || '',
      endDate    : endDate   || '',
      summary,
      chartData,
      orders     : ordersWithDiscount,
      page,
      totalPages,
      totalOrders,
      limit,
    });
  } catch (err) {
    console.error('[SalesReport] error:', err);
    req.flash?.('error', err.message || 'Failed to load sales report.');
    return res.redirect('/admin/dashboard');
  }
}


export async function exportSalesReportPDF(req, res) {
  try {
    const { filter = 'today', startDate, endDate } = req.query;
    const { start, end, matchStage, summary } = await fetchReportData(filter, startDate, endDate);

    const orders = await Order.find(matchStage)
      .populate('user', 'name email')
      .select('orderNumber createdAt pricing couponCode paymentMethod orderStatus items')
      .sort({ createdAt: -1 })
      .lean();

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="velmora-sales-${filter}-${Date.now()}.pdf"`);
    doc.pipe(res);

    const periodLabel = start && end
      ? `${fmtDate(start)} – ${fmtDate(new Date(end.getTime() - 86400000))}`
      : 'All Time';

    doc
      .font('Helvetica-Bold').fontSize(18).fillColor('#1a1f1e')
      .text('VELMORA CHRONÉ', 40, 40)
      .font('Helvetica').fontSize(9).fillColor('#9aa8a5')
      .text('ADMIN · SALES REPORT', 40, 62)
      .text(`Period: ${periodLabel}`, 40, 74)
      .text(`Generated: ${fmtDate(new Date())}`, 40, 86);

    doc.moveTo(40, 102).lineTo(800, 102).strokeColor('#e2e6e4').lineWidth(1).stroke();

    const boxes = [
      { label: 'Total Orders',      value: String(summary.totalOrders)     },
      { label: 'Total Revenue',     value: fmtINR(summary.totalRevenue)    },
      { label: 'Order Amount',      value: fmtINR(summary.totalSubtotal)   },
      { label: 'Total Discount',    value: fmtINR(summary.totalDiscount)   },
      { label: 'Item Discounts',    value: fmtINR(summary.itemDiscount)    },
      { label: 'Coupon Deductions', value: fmtINR(summary.couponDiscount)  },
    ];

    const boxW = 120, boxH = 52, boxGap = 10;
    const bx0 = 40, by0 = 114;

    boxes.forEach((b, i) => {
      const x = bx0 + i * (boxW + boxGap);
      doc.roundedRect(x, by0, boxW, boxH, 3).fillColor('#f8faf9').fill();
      doc.roundedRect(x, by0, boxW, boxH, 3).strokeColor('#e2e6e4').lineWidth(0.5).stroke();
      doc.moveTo(x, by0).lineTo(x + boxW, by0).strokeColor('#2d8c84').lineWidth(2).stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#9aa8a5')
         .text(b.label.toUpperCase(), x + 8, by0 + 10, { width: boxW - 16 });
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a1f1e')
         .text(b.value, x + 8, by0 + 26, { width: boxW - 16 });
    });

    const tableTop = by0 + boxH + 20;
    const cols = [
      { label: '#',           w: 24  },
      { label: 'Order No.',   w: 90  },
      { label: 'Date',        w: 68  },
      { label: 'Customer',    w: 110 },
      { label: 'Items',       w: 32  },
      { label: 'Subtotal',    w: 64  },
      { label: 'Item Disc.',  w: 60  },
      { label: 'Coupon',      w: 60  },
      { label: 'Cpn Disc.',   w: 60  },
      { label: 'Tax',         w: 50  },
      { label: 'Shipping',    w: 52  },
      { label: 'Grand Total', w: 70  },
      { label: 'Payment',     w: 60  },
      { label: 'Status',      w: 56  },
    ];

    const drawTableHeader = (y) => {
      doc.rect(40, y, 760, 18).fillColor('#f2f4f3').fill();
      let cx = 40;
      cols.forEach(c => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#5a6461')
           .text(c.label.toUpperCase(), cx + 3, y + 5, { width: c.w - 6, ellipsis: true });
        cx += c.w;
      });
    };

    drawTableHeader(tableTop);

    let rowY      = tableTop + 18;
    const rowH    = 18;
    const pageBot = doc.page.height - 60;

    orders.forEach((o, idx) => {
      if (rowY + rowH > pageBot) {
        doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
        rowY = 40;
        drawTableHeader(rowY);
        rowY += 18;
      }

      if (idx % 2 === 0) {
        doc.rect(40, rowY, 760, rowH).fillColor('#fafcfb').fill();
      }

      let rowItemDiscount = o.pricing?.itemDiscount || 0;
      if (!rowItemDiscount && o.items?.length) {
        rowItemDiscount = o.items.reduce((acc, item) => {
          if (item.originalPrice && item.originalPrice > item.price) {
            return acc + (item.originalPrice - item.price) * (item.quantity || 1);
          }
          return acc;
        }, 0);
      }

      const cells = [
        String(idx + 1),
        o.orderNumber || '—',
        fmtDate(o.createdAt),
        o.user?.name || '—',
        String(o.items?.length || 0),
        fmtINR(o.pricing?.subtotal),
        rowItemDiscount > 0 ? `-${fmtINR(rowItemDiscount)}` : '—',
        o.couponCode || '—',
        o.pricing?.couponDiscount > 0 ? `-${fmtINR(o.pricing.couponDiscount)}` : '—',
        fmtINR(o.pricing?.tax),
        o.pricing?.shipping === 0 ? 'Free' : fmtINR(o.pricing?.shipping),
        fmtINR(o.pricing?.grandTotal),
        o.paymentMethod || '—',
        o.orderStatus   || '—',
      ];

      let cx = 40;
      cells.forEach((cell, ci) => {
        doc.font('Helvetica').fontSize(7).fillColor('#1a1f1e')
           .text(cell, cx + 3, rowY + 5, { width: cols[ci].w - 6, ellipsis: true });
        cx += cols[ci].w;
      });

      doc.moveTo(40, rowY + rowH).lineTo(800, rowY + rowH)
         .strokeColor('#f0f2f1').lineWidth(0.4).stroke();
      rowY += rowH;
    });

    if (orders.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#9aa8a5')
         .text('No orders found for the selected period.', 40, tableTop + 30);
    }

    doc.font('Helvetica').fontSize(7).fillColor('#c0c8c6')
       .text('© 2026 Velmora Chroné. Confidential.', 40, doc.page.height - 30, { align: 'center', width: 760 });

    doc.end();
  } catch (err) {
    console.error('[ExportPDF] error:', err);
    res.status(500).send('Failed to generate PDF.');
  }
}


export async function exportSalesReportExcel(req, res) {
  try {
    const { filter = 'today', startDate, endDate } = req.query;
    const { start, end, matchStage, summary } = await fetchReportData(filter, startDate, endDate);

    const orders = await Order.find(matchStage)
      .populate('user', 'name email')
      .select('orderNumber createdAt pricing couponCode paymentMethod orderStatus items')
      .sort({ createdAt: -1 })
      .lean();

    const wb      = new ExcelJS.Workbook();
    wb.creator    = 'Velmora Chroné Admin';
    wb.created    = new Date();
    const currFmt = '"₹"#,##0.00';

    const periodLabel = start && end
      ? `${fmtDate(start)} – ${fmtDate(new Date(end.getTime() - 86400000))}`
      : 'All Time';

    const ss = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });

    ss.mergeCells('A1:B1');
    ss.getCell('A1').value     = 'VELMORA CHRONÉ — SALES REPORT';
    ss.getCell('A1').font      = { bold: true, size: 14, color: { argb: 'FF1A1F1E' } };
    ss.getCell('A1').alignment = { vertical: 'middle' };
    ss.getRow(1).height        = 28;

    ss.getCell('A2').value = `Period: ${periodLabel}`;
    ss.getCell('A2').font  = { size: 10, color: { argb: 'FF9AA8A5' } };
    ss.getCell('A3').value = `Generated: ${fmtDate(new Date())}`;
    ss.getCell('A3').font  = { size: 10, color: { argb: 'FF9AA8A5' } };
    ss.getRow(4).height    = 10;

    const summaryRows = [
      ['Metric',                  'Value'                   ],
      ['Total Orders',             summary.totalOrders       ],
      ['Total Revenue',            summary.totalRevenue      ],
      ['Order Amount (Subtotal)',   summary.totalSubtotal    ],
      ['Total Discount',           summary.totalDiscount     ],
      ['Item Discounts',           summary.itemDiscount      ],
      ['Coupon Deductions',        summary.couponDiscount    ],
      ['Total Tax',                summary.totalTax          ],
      ['Total Shipping',           summary.totalShipping     ],
    ];

    summaryRows.forEach((row, i) => {
      const r = ss.addRow(row);
      r.height = 20;
      if (i === 0) {
        r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D8C84' } };
      } else {
        r.getCell(1).font = { color: { argb: 'FF5A6461' }, size: 11 };
        r.getCell(2).font = { bold: true, size: 11 };
        if (i > 1) r.getCell(2).numFmt = currFmt;
        if (i % 2 === 0) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAF9' } };
      }
    });

    ss.getColumn('A').width = 30;
    ss.getColumn('B').width = 22;

    const os = wb.addWorksheet('Orders', {
      views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    });

    os.columns = [
      { header: '#',               key: 'idx',            width: 6  },
      { header: 'Order No.',       key: 'orderNumber',    width: 20 },
      { header: 'Date',            key: 'date',           width: 16 },
      { header: 'Customer',        key: 'customer',       width: 22 },
      { header: 'Email',           key: 'email',          width: 26 },
      { header: 'Items',           key: 'items',          width: 8  },
      { header: 'Subtotal',        key: 'subtotal',       width: 14 },
      { header: 'Item Discount',   key: 'itemDiscount',   width: 16 },
      { header: 'Coupon Code',     key: 'couponCode',     width: 14 },
      { header: 'Coupon Discount', key: 'couponDiscount', width: 18 },
      { header: 'Tax',             key: 'tax',            width: 12 },
      { header: 'Shipping',        key: 'shipping',       width: 12 },
      { header: 'Grand Total',     key: 'grandTotal',     width: 14 },
      { header: 'Payment Method',  key: 'payment',        width: 16 },
      { header: 'Status',          key: 'status',         width: 14 },
    ];

    const hRow = os.getRow(1);
    hRow.height = 22;
    hRow.eachCell(cell => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D8C84' } };
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FF1F6E67' } } };
    });

    const statusColors = {
      confirmed : 'FF2D8C84', processing: 'FF2563EB',
      dispatched: 'FF7C3AED', delivered : 'FF16A34A',
      returned  : 'FFD97706',
    };

    orders.forEach((o, idx) => {
      let rowItemDiscount = o.pricing?.itemDiscount || 0;
      if (!rowItemDiscount && o.items?.length) {
        rowItemDiscount = o.items.reduce((acc, item) => {
          if (item.originalPrice && item.originalPrice > item.price) {
            return acc + (item.originalPrice - item.price) * (item.quantity || 1);
          }
          return acc;
        }, 0);
      }

      const row = os.addRow({
        idx           : idx + 1,
        orderNumber   : o.orderNumber            || '—',
        date          : fmtDate(o.createdAt),
        customer      : o.user?.name             || '—',
        email         : o.user?.email            || '—',
        items         : o.items?.length           || 0,
        subtotal      : o.pricing?.subtotal       || 0,
        itemDiscount  : rowItemDiscount,
        couponCode    : o.couponCode              || '—',
        couponDiscount: o.pricing?.couponDiscount || 0,
        tax           : o.pricing?.tax            || 0,
        shipping      : o.pricing?.shipping       || 0,
        grandTotal    : o.pricing?.grandTotal     || 0,
        payment       : o.paymentMethod           || '—',
        status        : o.orderStatus             || '—',
      });

      row.height = 18;

      if (idx % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFCFB' } };
        });
      }

      ['subtotal','itemDiscount','couponDiscount','tax','shipping','grandTotal'].forEach(k => {
        row.getCell(k).numFmt = currFmt;
      });

      if (rowItemDiscount                 > 0) row.getCell('itemDiscount').font   = { color: { argb: 'FFDC2626' } };
      if (o.pricing?.couponDiscount       > 0) row.getCell('couponDiscount').font = { color: { argb: 'FFDC2626' } };

      row.getCell('grandTotal').font = { bold: true };

      const sc = statusColors[o.orderStatus];
      if (sc) row.getCell('status').font = { color: { argb: sc }, bold: true };
    });

    os.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: os.columns.length } };

    const tRow = os.addRow({
      customer      : 'TOTALS',
      subtotal      : summary.totalSubtotal,
      itemDiscount  : summary.itemDiscount,
      couponDiscount: summary.couponDiscount,
      tax           : summary.totalTax,
      shipping      : summary.totalShipping,
      grandTotal    : summary.totalRevenue,
    });
    tRow.height = 22;
    tRow.eachCell(cell => {
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4F3' } };
      cell.font   = { bold: true, color: { argb: 'FF1F6E67' } };
      cell.border = { top: { style: 'medium', color: { argb: 'FF2D8C84' } } };
    });
    ['subtotal','itemDiscount','couponDiscount','tax','shipping','grandTotal'].forEach(k => {
      tRow.getCell(k).numFmt = currFmt;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="velmora-sales-${filter}-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[ExportExcel] error:', err);
    res.status(500).send('Failed to generate Excel file.');
  }
}