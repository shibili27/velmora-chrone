import User      from '../../models/user.js';
import Category  from '../../models/category.js';
import Product   from '../../models/product.js';
import Brand     from '../../models/brand.js';
import Order     from '../../models/order.js';
import cloudinary from '../../config/cloudinary.js';
import { broadcast } from '../../public/utils/ssemanager.js';
import Coupon from '../../models/coupon.js';

//  dash

export const getDashboard = async (req, res) => {
  try {
    const now            = new Date();
    const todayStart     = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      totalOrders,
      pendingOrders,
      shippedOrders,
      deliveredOrders,
      cancelledOrders,
      totalCustomers,
      newCustomers,
      blockedUsers,
      totalProducts,
      outOfStock,
      totalCategories,
      totalBrands,
      recentOrders,
      revenueAgg,
      todayRevenueAgg,
      lastMonthRevenueAgg,
      monthlySalesAgg,
      topProductsAgg,
      thisMonthOrders,
      lastMonthOrders,
      lastMonthCustomers,
    ] = await Promise.all([

      Order.countDocuments(),
      Order.countDocuments({ orderStatus: 'confirmed' }),
      Order.countDocuments({ orderStatus: { $in: ['processing', 'dispatched'] } }),
      Order.countDocuments({ orderStatus: 'delivered' }),
      Order.countDocuments({ orderStatus: 'cancelled' }),

      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', createdAt: { $gte: monthStart } }),
      User.countDocuments({ isBlocked: true }),

      Product.countDocuments({ isDeleted: false }),
      Product.countDocuments({ isDeleted: false, stock: 0 }),
      Category.countDocuments({ isDeleted: false }),
      Brand.countDocuments({ isDeleted: false }),

      Order.find()
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),

      Order.aggregate([
        { $match: { orderStatus: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$pricing.grandTotal' } } },
      ]),

      Order.aggregate([
        { $match: { orderStatus: 'delivered', createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: '$pricing.grandTotal' } } },
      ]),

      Order.aggregate([
        { $match: { orderStatus: 'delivered', createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: '$pricing.grandTotal' } } },
      ]),

      Order.aggregate([
        { $match: { orderStatus: 'delivered' } },
        {
          $group: {
            _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            revenue: { $sum: '$pricing.grandTotal' },
            count:   { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 7 },
      ]),

      Order.aggregate([
        { $match: { orderStatus: 'delivered' } },
        { $unwind: '$items' },
        { $match: { 'items.status': 'active' } },
        {
          $group: {
            _id:          '$items.product',
            name:         { $first: '$items.name' },
            brand:        { $first: '$items.brand' },
            image:        { $first: '$items.image' },
            totalSold:    { $sum: '$items.quantity' },
            totalRevenue: { $sum: '$items.totalPrice' },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
      ]),

      Order.countDocuments({ createdAt: { $gte: monthStart } }),

      Order.countDocuments({ createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),

      User.countDocuments({ role: 'user', createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
    ]);

    const totalRevenue     = Math.round(revenueAgg[0]?.total       ?? 0);
    const todayRevenue     = Math.round(todayRevenueAgg[0]?.total   ?? 0);
    const lastMonthRevenue = Math.round(lastMonthRevenueAgg[0]?.total ?? 0);

    const thisMonthEntry = monthlySalesAgg.find(
      m => m._id.year === now.getFullYear() && m._id.month === now.getMonth() + 1
    );
    const thisMonthRevenue = Math.round(thisMonthEntry?.revenue ?? 0);

    const revenueGrowth = lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : thisMonthRevenue > 0 ? 100 : 0;

    const ordersGrowth = lastMonthOrders > 0
      ? Math.round(((thisMonthOrders - lastMonthOrders) / lastMonthOrders) * 100)
      : thisMonthOrders > 0 ? 100 : 0;

    const customersGrowth = lastMonthCustomers > 0
      ? Math.round(((newCustomers - lastMonthCustomers) / lastMonthCustomers) * 100)
      : newCustomers > 0 ? 100 : 0;

    const avgOrderValue = deliveredOrders > 0
      ? Math.round(totalRevenue / deliveredOrders)
      : 0;

    const highestMonth = monthlySalesAgg.length > 0
      ? Math.round(Math.max(...monthlySalesAgg.map(m => m.revenue)))
      : 0;

    const safeTotal    = totalOrders || 1;
    const deliveredPct = Math.round((deliveredOrders / safeTotal) * 100);
    const pendingPct   = Math.round((pendingOrders   / safeTotal) * 100);
    const shippedPct   = Math.round((shippedOrders   / safeTotal) * 100);
    const cancelledPct = Math.round((cancelledOrders / safeTotal) * 100);

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthlySales = monthlySalesAgg.map(m => ({
      label: MONTH_NAMES[m._id.month - 1],
      value: Math.round(m.revenue),
    }));

    const recentOrdersMapped = recentOrders.map(o => ({
      _id:         o._id,
      orderId:     o.orderNumber,
      userId:      { name: o.user?.name ?? 'Unknown' },
      totalAmount: o.pricing.grandTotal,
      status:      o.orderStatus,
    }));

    const colorMap = {
      confirmed:  'teal',
      processing: 'blue',
      dispatched: 'blue',
      delivered:  'green',
      cancelled:  'red',
      returned:   'amber',
    };
    const recentActivity = recentOrders.slice(0, 8).map(o => ({
      color:   colorMap[o.orderStatus] ?? 'teal',
      message: `Order <strong>${o.orderNumber}</strong> by ${o.user?.name ?? 'a customer'} — ${o.orderStatus}`,
      time:    new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    }));

    const topProducts = topProductsAgg.map(p => ({
      ...p,
      images: p.image ? [p.image] : [],
    }));

    res.render('admin/dashboard', {
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,

      totalRevenue,
      todayRevenue,
      revenueGrowth,
      totalOrders,
      ordersGrowth,
      pendingOrders,
      totalCustomers,
      customersGrowth,
      newCustomers,
      totalProducts,
      outOfStock,
      blockedUsers,
      totalCategories,
      totalBrands,

      monthlySales,
      avgOrderValue,
      highestMonth,
      conversionRate: 0,

      deliveredOrders,
      shippedOrders,
      cancelledOrders,
      deliveredPct,
      pendingPct,
      shippedPct,
      cancelledPct,

      recentOrders:   recentOrdersMapped,
      recentActivity,
      topProducts,

      totalReviews:   0,
      avgRating:      '0.0',
      activeCoupons:  0,
      pendingRefunds: 0,
      activeBanners:  0,
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard');
  }
};


// cat

export const getCategories = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;
    const query  = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };
    const [categories, total] = await Promise.all([
      Category.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Category.countDocuments(query),
    ]);
    res.render('admin/categories', {
      title: 'Categories — Velmora Chroné',
      adminName: req.session.adminName,
      categories, search, page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   res.locals.error   || [],
      success: res.locals.success || [],
    });
  } catch (err) {
    console.error('Get categories error:', err);
    req.flash('error', 'Failed to load categories.');
    res.redirect('/admin/dashboard');
  }
};



export const addCategory = async (req, res) => {
  try {
    const { name, description, brand } = req.body;
    if (!name?.trim()) {
      req.flash('error', 'Category name is required.');
      return res.redirect('/admin/categories');
    }
    const exists = await Category.findOne({
      name: { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      isDeleted: false,
    });
    if (exists) {
      req.flash('error', `A category named "${name.trim()}" already exists.`);
      return res.redirect('/admin/categories');
    }
    await Category.create({ name: name.trim(), description: description?.trim() || '', brand: brand?.trim() || '' });
    req.flash('success', 'Category added successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Add category error:', err);
    req.flash('error', 'Failed to add category.');
    res.redirect('/admin/categories');
  }
};

export const editCategory = async (req, res) => {
  try {
    const { name, description, brand } = req.body;
    if (!name?.trim()) {
      req.flash('error', 'Category name is required.');
      return res.redirect('/admin/categories');
    }
    const duplicate = await Category.findOne({
      name: { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      isDeleted: false,
      _id: { $ne: req.params.id },
    });
    if (duplicate) {
      req.flash('error', `Another category named "${name.trim()}" already exists.`);
      return res.redirect('/admin/categories');
    }
    await Category.findByIdAndUpdate(req.params.id, {
      name: name.trim(),
      description: description?.trim() || '',
      brand: brand?.trim() || '',
    });
    req.flash('success', 'Category updated successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Edit category error:', err);
    req.flash('error', 'Failed to update category.');
    res.redirect('/admin/categories');
  }
};

export const deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndUpdate(req.params.id, { isDeleted: true });
    req.flash('success', 'Category deleted.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Delete category error:', err);
    req.flash('error', 'Failed to delete category.');
    res.redirect('/admin/categories');
  }
};


// prod
export const getProducts = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;
    const query  = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };
    const [products, total, categories, brands] = await Promise.all([
      Product.find(query).populate('category').populate('brand').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(query),
      Category.find({ isDeleted: false }).sort({ name: 1 }),
      Brand.find({ isDeleted: false }).sort({ name: 1 }),
    ]);
    res.render('admin/products', {
      title: 'Products — Velmora Chroné',
      adminName: req.session.adminName,
      products, categories, brands, search, page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   res.locals.error   || [],
      success: res.locals.success || [],
    });
  } catch (err) {
    console.error('Get products error:', err);
    req.flash('error', 'Failed to load products.');
    res.redirect('/admin/dashboard');
  }
};

export const blockProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/admin/products');
    }
    await Product.findByIdAndUpdate(req.params.id, { isListed: false });
    broadcast('productUpdate', {
      productId: req.params.id,
      stock:     product.stock,
      price:     product.price,
      isListed:  false,
      isDeleted: product.isDeleted,
    });
    req.flash('success', `"${product.name}" has been blocked.`);
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Block product error:', err);
    req.flash('error', 'Failed to block product.');
    res.redirect('/admin/products');
  }
};

export const unblockProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/admin/products');
    }
    await Product.findByIdAndUpdate(req.params.id, { isListed: true });
    broadcast('productUpdate', {
      productId: req.params.id,
      stock:     product.stock,
      price:     product.price,
      isListed:  true,
      isDeleted: product.isDeleted,
    });
    req.flash('success', `"${product.name}" has been unblocked.`);
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Unblock product error:', err);
    req.flash('error', 'Failed to unblock product.');
    res.redirect('/admin/products');
  }
};

async function uploadBase64(base64String, folder = 'velmora/products') {
  const result = await cloudinary.uploader.upload(base64String, {
    folder,
    transformation: [{ width: 800, height: 800, crop: 'fill' }],
  });
  return result.secure_url;
}

async function parseAndUploadVariants(raw) {
  if (!raw) return [];
  let variants;
  try { variants = JSON.parse(raw); } catch (e) { console.error('Failed to parse colorVariants JSON:', e.message); return []; }
  if (!Array.isArray(variants) || variants.length === 0) return [];
  const result = [];
  for (const v of variants) {
    if (!v.name || !v.hex) { console.warn('Skipping variant — missing name or hex:', v); continue; }
    let rawImages = [];
    if (Array.isArray(v.images) && v.images.length > 0) {
      rawImages = v.images;
    } else {
      rawImages = [
        ...(Array.isArray(v.existingImages) ? v.existingImages : []),
        ...(Array.isArray(v.newImages)      ? v.newImages      : []),
      ];
    }
    const finalImages = [];
    for (const img of rawImages) {
      if (!img || typeof img !== 'string') continue;
      if (img.startsWith('data:image/')) {
        try { finalImages.push(await uploadBase64(img)); }
        catch (uploadErr) { console.error(`Cloudinary upload failed for variant "${v.name}":`, uploadErr.message); }
      } else if (img.startsWith('http://') || img.startsWith('https://')) {
        finalImages.push(img);
      }
    }
    if (finalImages.length < 3) { console.warn(`Variant "${v.name}" only has ${finalImages.length} valid image(s) — skipping.`); continue; }
    result.push({ name: v.name.trim(), hex: v.hex.trim(), stock: Math.max(0, parseInt(v.stock) || 0), images: finalImages });
  }
  return result;
}

export const addProduct = async (req, res) => {
  try {
    const { name, description, price, colorVariants: rawVariants } = req.body;
    const category = req.body.category || null;
    const brand    = req.body.brand    || null;
    if (!name || !price || !category) {
      req.flash('error', 'Name, price, and category are required.');
      return res.redirect('/admin/products');
    }
    const colorVariants = await parseAndUploadVariants(rawVariants);
    if (colorVariants.length === 0) {
      req.flash('error', 'Please add at least one colour variant with 3 or more images.');
      return res.redirect('/admin/products');
    }
    const totalStock = colorVariants.reduce((s, v) => s + v.stock, 0);
    const colors     = colorVariants.map(v => ({ name: v.name, hex: v.hex }));
    await Product.create({
      name: name.trim(), description: description?.trim() || '',
      price: parseFloat(price), stock: totalStock,
      category, brand: brand || null,
      images: colorVariants[0].images,
      colorVariants, colors, isListed: true, isDeleted: false,
    });
    req.flash('success', 'Product added successfully.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Add product error:', err);
    req.flash('error', `Failed to add product: ${err.message}`);
    res.redirect('/admin/products');
  }
};

export const editProduct = async (req, res) => {
  try {
    const { name, description, price, colorVariants: rawVariants } = req.body;
    const category = req.body.category || null;
    const brand    = req.body.brand    || null;
    if (!name || !price || !category) {
      req.flash('error', 'Name, price, and category are required.');
      return res.redirect('/admin/products');
    }
    const colorVariants = await parseAndUploadVariants(rawVariants);
    if (colorVariants.length === 0) {
      req.flash('error', 'Please add at least one colour variant with 3 or more images.');
      return res.redirect('/admin/products');
    }
    const totalStock = colorVariants.reduce((s, v) => s + v.stock, 0);
    const colors     = colorVariants.map(v => ({ name: v.name, hex: v.hex }));
    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(), description: description?.trim() || '',
        price: parseFloat(price), stock: totalStock,
        category, brand: brand || null,
        images: colorVariants[0].images,
        colorVariants, colors,
      },
      { new: true, runValidators: true }
    );
    broadcast('productUpdate', {
      productId:     req.params.id,
      stock:         totalStock,
      price:         parseFloat(price),
      isListed:      updated.isListed,
      isDeleted:     updated.isDeleted,
      colorVariants: colorVariants.map(v => ({ name: v.name, hex: v.hex, stock: v.stock })),
    });
    req.flash('success', 'Product updated successfully.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Edit product error:', err);
    req.flash('error', `Failed to update product: ${err.message}`);
    res.redirect('/admin/products');
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    await Product.findByIdAndUpdate(req.params.id, { isDeleted: true });
    if (product) {
      broadcast('productUpdate', {
        productId: req.params.id,
        stock:     0,
        price:     product.price,
        isListed:  product.isListed,
        isDeleted: true,
      });
    }
    req.flash('success', 'Product deleted.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Delete product error:', err);
    req.flash('error', 'Failed to delete product.');
    res.redirect('/admin/products');
  }
};



export const getBrands = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;
    const query  = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };
    const [brands, total] = await Promise.all([
      Brand.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Brand.countDocuments(query),
    ]);
    res.render('admin/brands', {
      title: 'Brands — Velmora Chroné',
      adminName: req.session.adminName,
      brands, search, page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   res.locals.error   || [],
      success: res.locals.success || [],
    });
  } catch (err) {
    console.error('Get brands error:', err);
    req.flash('error', 'Failed to load brands.');
    res.redirect('/admin/dashboard');
  }
};

export const addBrand = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) {
      req.flash('error', 'Brand name is required.');
      return res.redirect('/admin/brands');
    }
    const exists = await Brand.findOne({
      name: { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      isDeleted: false,
    });
    if (exists) {
      req.flash('error', `A brand named "${name.trim()}" already exists.`);
      return res.redirect('/admin/brands');
    }
    await Brand.create({ name: name.trim(), description: description?.trim() || '' });
    req.flash('success', 'Brand added successfully.');
    res.redirect('/admin/brands');
  } catch (err) {
    console.error('Add brand error:', err);
    req.flash('error', 'Failed to add brand.');
    res.redirect('/admin/brands');
  }
};

export const editBrand = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) {
      req.flash('error', 'Brand name is required.');
      return res.redirect('/admin/brands');
    }
    const duplicate = await Brand.findOne({
      name: { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      isDeleted: false,
      _id: { $ne: req.params.id },
    });
    if (duplicate) {
      req.flash('error', `Another brand named "${name.trim()}" already exists.`);
      return res.redirect('/admin/brands');
    }
    await Brand.findByIdAndUpdate(req.params.id, { name: name.trim(), description: description?.trim() || '' });
    req.flash('success', 'Brand updated successfully.');
    res.redirect('/admin/brands');
  } catch (err) {
    console.error('Edit brand error:', err);
    req.flash('error', 'Failed to update brand.');
    res.redirect('/admin/brands');
  }
};

export const deleteBrand = async (req, res) => {
  try {
    await Brand.findByIdAndUpdate(req.params.id, { isDeleted: true });
    req.flash('success', 'Brand deleted.');
    res.redirect('/admin/brands');
  } catch (err) {
    console.error('Delete brand error:', err);
    req.flash('error', 'Failed to delete brand.');
    res.redirect('/admin/brands');
  }
};




function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateCouponBody(body) {
  const { code, discountType, discountValue, minOrderAmount, maxDiscount, expiryDate, usageLimit, perUserLimit } = body;
  const errors = [];

  if (!code?.trim())
    errors.push('Coupon code is required.');
  else if (!/^[A-Z0-9_-]{3,20}$/i.test(code.trim()))
    errors.push('Code must be 3–20 characters — letters, numbers, _ and - only.');

  if (!['percentage', 'flat'].includes(discountType))
    errors.push('Invalid discount type.');

  const val = parseFloat(discountValue);
  if (isNaN(val) || val <= 0)
    errors.push('Discount value must be a positive number.');
  if (discountType === 'percentage' && val > 100)
    errors.push('Percentage discount cannot exceed 100.');

  const min = parseFloat(minOrderAmount);
  if (!isNaN(min) && min < 0)
    errors.push('Minimum order amount cannot be negative.');

  if (maxDiscount !== '' && maxDiscount != null) {
    const cap = parseFloat(maxDiscount);
    if (isNaN(cap) || cap <= 0)
      errors.push('Max discount cap must be a positive number.');
  }

  if (!expiryDate)
    errors.push('Expiry date is required.');
  else if (new Date(expiryDate) <= new Date())
    errors.push('Expiry date must be in the future.');

  if (usageLimit !== '' && usageLimit != null) {
    const ul = parseInt(usageLimit);
    if (isNaN(ul) || ul < 1) errors.push('Usage limit must be at least 1.');
  }

  if (perUserLimit !== '' && perUserLimit != null) {
    const pl = parseInt(perUserLimit);
    if (isNaN(pl) || pl < 1) errors.push('Per-user limit must be at least 1.');
  }

  return errors;
}

// ── GET /admin/coupons ────────────────────────────────────────────────────────

export const getCoupons = async (req, res) => {
  try {
    const search      = req.query.search?.trim() || '';
    const page        = Math.max(1, parseInt(req.query.page) || 1);
    const limit       = 10;
    const skip        = (page - 1) * limit;
    const query       = {};

    if (search) query.code = { $regex: escapeRegex(search), $options: 'i' };

    const [coupons, total] = await Promise.all([
      Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Coupon.countDocuments(query),
    ]);

    const now      = new Date();
    const enriched = coupons.map(c => ({
      ...c,
      isExpired:   c.expiryDate < now,
      isExhausted: c.usageLimit !== null && c.usedCount >= c.usageLimit,
    }));

    res.render('admin/coupons', {
      title:      'Coupons — Velmora Chroné',
      adminName:  req.session.adminName,
      adminRole:  req.session.adminRole,
      coupons:    enriched,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      search,
      error:      res.locals.error   || [],
      success:    res.locals.success || [],
    });
  } catch (err) {
    console.error('getCoupons error:', err);
    req.flash('error', 'Failed to load coupons.');
    res.redirect('/admin/dashboard');
  }
};

// ── POST /admin/coupons/create ────────────────────────────────────────────────

export const createCoupon = async (req, res) => {
  try {
    const {
      code, discountType, discountValue,
      minOrderAmount, maxDiscount, expiryDate,
      usageLimit, perUserLimit, description,
    } = req.body;

    const errors = validateCouponBody(req.body);
    if (errors.length) {
      errors.forEach(e => req.flash('error', e));
      return res.redirect('/admin/coupons');
    }

    const exists = await Coupon.findOne({
      code: { $regex: `^${escapeRegex(code.trim())}$`, $options: 'i' },
    });
    if (exists) {
      req.flash('error', `Coupon code "${code.trim().toUpperCase()}" already exists.`);
      return res.redirect('/admin/coupons');
    }

    await Coupon.create({
      code:           code.trim().toUpperCase(),
      description:    description?.trim() || '',
      discountType,
      discountValue:  parseFloat(discountValue),
      minOrderAmount: parseFloat(minOrderAmount) || 0,
      maxDiscount:    (maxDiscount !== '' && maxDiscount != null) ? parseFloat(maxDiscount) : null,
      expiryDate:     new Date(expiryDate),
      usageLimit:     (usageLimit !== '' && usageLimit != null) ? parseInt(usageLimit) : null,
      perUserLimit:   (perUserLimit !== '' && perUserLimit != null) ? parseInt(perUserLimit) : 1,
    });

    req.flash('success', 'Coupon created successfully.');
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error('createCoupon error:', err);
    req.flash('error', 'Failed to create coupon.');
    res.redirect('/admin/coupons');
  }
};

// ── POST /admin/coupons/:id/delete ───────────────────────────────────────────

export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) {
      req.flash('error', 'Coupon not found.');
      return res.redirect('/admin/coupons');
    }
    req.flash('success', `Coupon "${coupon.code}" deleted.`);
    res.redirect('/admin/coupons');
  } catch (err) {
    console.error('deleteCoupon error:', err);
    req.flash('error', 'Failed to delete coupon.');
    res.redirect('/admin/coupons');
  }
};

// ── POST /admin/coupons/:id/toggle  (AJAX) ───────────────────────────────────

export const toggleCouponStatus = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({ success: true, isActive: coupon.isActive });
  } catch (err) {
    console.error('toggleCouponStatus error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};