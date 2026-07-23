import Review   from '../../models/review.js';
import Product  from '../../models/product.js';

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getCounts() {
  const [statusAgg, reportedCount, ratingAgg, avgAgg] = await Promise.all([
    Review.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Review.countDocuments({ reportsCount: { $gt: 0 } }),
    Review.aggregate([{ $group: { _id: '$rating', count: { $sum: 1 } } }]),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' }, total: { $sum: 1 } } }]),
  ]);

  const counts = {
    total: 0, pending: 0, approved: 0, rejected: 0, spam: 0, hidden: 0,
    reported: reportedCount,
    avgRating: avgAgg[0]?.avg || 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
  statusAgg.forEach((s) => { counts[s._id] = s.count; counts.total += s.count; });
  ratingAgg.forEach((r) => { counts.distribution[r._id] = r.count; });
  return counts;
}

/* -------------------------------------------------------------------------- */
/* GET /admin/reviews  — dashboard + list                                    */
/* -------------------------------------------------------------------------- */

export const listReviews = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;

    const {
      status   = 'all',
      search   = '',
      rating   = '',
      verified = '',
      product  = '',
      from     = '',
      to       = '',
      reported = '',
    } = req.query;

    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (rating) filter.rating = Number(rating);
    if (verified === 'yes') filter.verifiedPurchase = true;
    if (verified === 'no') filter.verifiedPurchase = false;
    if (product) filter.product = product;
    if (reported) filter.reportsCount = { $gt: 0 };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { customerName:  re },
        { customerEmail: re },
        { reviewMessage: re },
        { reviewTitle:   re },
      ];
      if (/^[a-fA-F0-9]{6,24}$/.test(search)) {
        filter.$or.push({ _id: { $regex: search, $options: 'i' } });
      }
    }

    const [reviewsRaw, totalReviews, counts, products] = await Promise.all([
      Review.find(filter)
        .populate('product', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
      getCounts(),
      // Only active/unblocked products can be picked when adding a review.
      // Adjust the field name below if your Product schema uses something
      // other than `isBlocked` (e.g. `isActive`, `isListed`, `status`).
      Product.find({ isBlocked: { $ne: true } }, 'name').lean(),
    ]);

    const reviews = reviewsRaw.map((rv) => ({
      ...rv,
      productId  : rv.product?._id,
      productName: rv.product?.name || 'Deleted Product',
    }));

    res.render('admin/reviews', {
      title    : 'Ratings & Reviews — Velmora Chroné Admin',
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      reviews,
      totalReviews,
      totalPages : Math.max(1, Math.ceil(totalReviews / limit)),
      currentPage: page,
      limit,
      counts,
      products,
      currentStatus  : status,
      currentSearch  : search,
      currentRating  : rating,
      currentVerified: verified,
      currentProduct : product,
      currentFrom    : from,
      currentTo      : to,
      currentReported: reported,
      error  : req.flash('error')[0]   || null,
      success: req.flash('success')[0] || null,
    });
  } catch (err) {
    console.error('listReviews error:', err);
    req.flash('error', 'Failed to load reviews.');
    res.redirect('/admin/dashboard');
  }
};

/* -------------------------------------------------------------------------- */
/* POST /admin/reviews  — create (admin-added review)                        */
/* -------------------------------------------------------------------------- */

export const createReview = async (req, res) => {
  try {
    const { productId, customerName, customerEmail, rating, reviewTitle, reviewMessage, verifiedPurchase, status } = req.body;

    if (!productId) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    if (!reviewMessage || reviewMessage.trim().length < 20) return res.status(400).json({ success: false, message: 'Review must be at least 20 characters' });
    if (reviewMessage.trim().length > 1000) return res.status(400).json({ success: false, message: 'Review cannot exceed 1000 characters' });

    const product = await Product.findById(productId).lean();
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    if (product.isBlocked) return res.status(400).json({ success: false, message: 'Cannot add a review for a blocked/inactive product' });

    const dup = await Review.findOne({
      product      : productId,
      customerEmail: customerEmail.toLowerCase(),
      reviewMessage: reviewMessage.trim(),
    });
    if (dup) return res.status(409).json({ success: false, message: 'A duplicate review already exists' });

    const review = await Review.create({
      product         : productId,
      customerName,
      customerEmail   : customerEmail.toLowerCase(),
      rating,
      reviewTitle,
      reviewMessage   : reviewMessage.trim(),
      verifiedPurchase: !!verifiedPurchase,
      status          : status || 'pending',
      approvedAt      : status === 'approved' ? new Date() : null,
      approvedBy      : status === 'approved' ? req.session.adminId : null,
    });

    const io = req.app.get('io');
    if (io) io.to('admin-room').emit('new-review', {
      _id: review._id, rating: review.rating, productName: '', customerName: review.customerName, createdAt: review.createdAt,
    });

    res.json({ success: true, review });
  } catch (err) {
    console.error('createReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to create review' });
  }
};

/* -------------------------------------------------------------------------- */
/* PUT /admin/reviews/:id — edit                                             */
/* -------------------------------------------------------------------------- */

export const editReview = async (req, res) => {
  try {
    const { productId, customerName, customerEmail, rating, reviewTitle, reviewMessage, verifiedPurchase, status } = req.body;

    if (rating && (rating < 1 || rating > 5)) return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    if (reviewMessage && (reviewMessage.trim().length < 20 || reviewMessage.trim().length > 1000)) {
      return res.status(400).json({ success: false, message: 'Review must be 20–1000 characters' });
    }
    if (productId) {
      const product = await Product.findById(productId).lean();
      if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
      if (product.isBlocked) return res.status(400).json({ success: false, message: 'Cannot assign a review to a blocked/inactive product' });
    }

    const update = {
      ...(productId       && { product: productId }),
      ...(customerName    && { customerName }),
      ...(customerEmail   && { customerEmail: customerEmail.toLowerCase() }),
      ...(rating          && { rating }),
      ...(reviewTitle   !== undefined && { reviewTitle }),
      ...(reviewMessage   && { reviewMessage: reviewMessage.trim() }),
      ...(verifiedPurchase !== undefined && { verifiedPurchase: !!verifiedPurchase }),
      ...(status          && { status }),
    };
    if (status === 'approved') { update.approvedAt = new Date(); update.approvedBy = req.session.adminId; }

    const review = await Review.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    res.json({ success: true, review });
  } catch (err) {
    console.error('editReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to update review' });
  }
};

/* -------------------------------------------------------------------------- */
/* DELETE /admin/reviews/:id                                                 */
/* -------------------------------------------------------------------------- */

export const deleteReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete review' });
  }
};

/* -------------------------------------------------------------------------- */
/* PATCH /admin/reviews/:id/status — approve / reject / spam / hidden        */
/* -------------------------------------------------------------------------- */

export const updateReviewStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'approved', 'rejected', 'spam', 'hidden'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });

    const update = { status };
    if (status === 'approved') { update.approvedAt = new Date(); update.approvedBy = req.session.adminId; }

    const review = await Review.findByIdAndUpdate(req.params.id, update, { new: true }).populate('product', 'name');
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    const io = req.app.get('io');
    if (io && review.customer) {
      io.to(`user-${review.customer}`).emit(status === 'approved' ? 'review-approved' : 'review-status-changed', {
        reviewId: review._id, status,
      });
    }

    res.json({ success: true, review });
  } catch (err) {
    console.error('updateReviewStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

/* -------------------------------------------------------------------------- */
/* POST /admin/reviews/bulk — bulk approve/reject/spam/delete                */
/* -------------------------------------------------------------------------- */

export const bulkReviewAction = async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'No reviews selected' });

    if (action === 'delete') {
      await Review.deleteMany({ _id: { $in: ids } });
      return res.json({ success: true, deleted: ids.length });
    }

    const statusMap = { approve: 'approved', reject: 'rejected', spam: 'spam' };
    const status = statusMap[action];
    if (!status) return res.status(400).json({ success: false, message: 'Invalid bulk action' });

    const update = { status };
    if (status === 'approved') { update.approvedAt = new Date(); update.approvedBy = req.session.adminId; }

    await Review.updateMany({ _id: { $in: ids } }, update);
    res.json({ success: true, updated: ids.length });
  } catch (err) {
    console.error('bulkReviewAction error:', err);
    res.status(500).json({ success: false, message: 'Bulk action failed' });
  }
};

/* -------------------------------------------------------------------------- */
/* Admin reply                                                                */
/* -------------------------------------------------------------------------- */

export const addReviewReply = async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim()) return res.status(400).json({ success: false, message: 'Reply cannot be empty' });

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { adminReply: reply.trim(), adminRepliedAt: new Date(), adminRepliedBy: req.session.adminId },
      { new: true }
    );
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });

    const io = req.app.get('io');
    if (io && review.customer) io.to(`user-${review.customer}`).emit('admin-replied', { reviewId: review._id });

    res.json({ success: true, review });
  } catch (err) {
    console.error('addReviewReply error:', err);
    res.status(500).json({ success: false, message: 'Failed to save reply' });
  }
};

export const deleteReviewReply = async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { adminReply: null, adminRepliedAt: null, adminRepliedBy: null, replyPinned: false },
      { new: true }
    );
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteReviewReply error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete reply' });
  }
};

/* -------------------------------------------------------------------------- */
/* Notification polling fallback (used alongside sockets)                    */
/* -------------------------------------------------------------------------- */

export const getRecentReviews = async (req, res) => {
  try {
    const since = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes
    const [newReviews, reported, spam, lowRating] = await Promise.all([
      Review.find({ createdAt: { $gte: since } }).populate('product', 'name').sort({ createdAt: -1 }).limit(20).lean(),
      Review.find({ reportsCount: { $gt: 0 }, updatedAt: { $gte: since } }).populate('product', 'name').limit(20).lean(),
      Review.find({ status: 'spam', updatedAt: { $gte: since } }).populate('product', 'name').limit(20).lean(),
      Review.find({ rating: { $lte: 2 }, createdAt: { $gte: since } }).populate('product', 'name').limit(20).lean(),
    ]);

    const shape = (list) => list.map((r) => ({
      _id: r._id, rating: r.rating, customerName: r.customerName,
      productName: r.product?.name || '', createdAt: r.createdAt,
    }));

    res.json({ success: true, newReviews: shape(newReviews), reported: shape(reported), spam: shape(spam), lowRating: shape(lowRating) });
  } catch (err) {
    console.error('getRecentReviews error:', err);
    res.status(500).json({ success: false });
  }
};

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export const exportReviewsPDF = async (req, res) => {
  try {
    const PDFDocument = (await import('pdfkit')).default; // requires: npm install pdfkit
    const reviews = await Review.find({}).populate('product', 'name').sort({ createdAt: -1 }).lean();

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="reviews-export.pdf"');
    doc.pipe(res);
    doc.fontSize(16).text('Reviews Report', { align: 'center' }).moveDown();
    reviews.forEach((r) => {
      doc.fontSize(10).text(
        `${r._id} | ${r.product?.name || ''} | ${r.customerName} | ${r.rating}★ | ${r.status} | ${new Date(r.createdAt).toLocaleDateString()}`
      );
    });
    doc.end();
  } catch (err) {
    console.error('exportReviewsPDF error:', err);
    res.status(500).send('Export failed');
  }
};

export const exportReviewsExcel = async (req, res) => {
  try {
    const ExcelJS = (await import('exceljs')).default; // requires: npm install exceljs
    const reviews = await Review.find({}).populate('product', 'name').sort({ createdAt: -1 }).lean();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reviews');
    ws.columns = [
      { header: 'Review ID', key: 'id',       width: 26 },
      { header: 'Product',   key: 'product',  width: 24 },
      { header: 'Customer',  key: 'customer', width: 20 },
      { header: 'Email',     key: 'email',    width: 26 },
      { header: 'Rating',    key: 'rating',   width: 10 },
      { header: 'Title',     key: 'title',    width: 24 },
      { header: 'Message',   key: 'message',  width: 50 },
      { header: 'Verified',  key: 'verified', width: 10 },
      { header: 'Status',    key: 'status',   width: 12 },
      { header: 'Date',      key: 'date',     width: 20 },
    ];
    reviews.forEach((r) => {
      ws.addRow({
        id      : r._id.toString(),
        product : r.product?.name || '',
        customer: r.customerName,
        email   : r.customerEmail,
        rating  : r.rating,
        title   : r.reviewTitle || '',
        message : r.reviewMessage.replace(/\n/g, ' '),
        verified: r.verifiedPurchase ? 'Yes' : 'No',
        status  : r.status,
        date    : new Date(r.createdAt).toISOString(),
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reviews-export.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('exportReviewsExcel error:', err);
    res.status(500).send('Export failed');
  }
};

export const exportReviewsCSV = async (req, res) => {
  try {
    const reviews = await Review.find({}).populate('product', 'name').sort({ createdAt: -1 }).lean();
    const rows = reviews.map((r) => ({
      ReviewID: r._id.toString(),
      Product : r.product?.name || '',
      Customer: r.customerName,
      Email   : r.customerEmail,
      Rating  : r.rating,
      Title   : r.reviewTitle || '',
      Message : r.reviewMessage.replace(/\n/g, ' '),
      Verified: r.verifiedPurchase ? 'Yes' : 'No',
      Status  : r.status,
      Date    : new Date(r.createdAt).toISOString(),
    }));

    const headers = Object.keys(rows[0] || { ReviewID: '' });
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => `"${String(row[h]).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reviews-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error('exportReviewsCSV error:', err);
    res.status(500).send('Export failed');
  }
};