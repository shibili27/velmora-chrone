// controller/adimconrtoller/adminController.js
import User     from '../../models/user.js';
import Category from '../../models/category.js';
import Product  from '../../models/product.js';
import cloudinary from '../../config/cloudinary.js';

/* ═══════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════ */
export const getDashboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 10;
    const skip   = (page - 1) * limit;

    const customerQuery = { role: 'user' };
    if (search) customerQuery.name = { $regex: search, $options: 'i' };

    const [
      totalUsers, blockedUsers, newUsersToday,
      totalProducts, totalCategories,
      customers, total,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ createdAt: { $gte: today } }),
      Product.countDocuments({ isDeleted: false }),
      Category.countDocuments({ isDeleted: false }),
      User.find(customerQuery).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(customerQuery),
    ]);

    res.render('admin/dashboard', {
      stats: { totalUsers, blockedUsers, newUsersToday, totalProducts, totalCategories },
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      customers,
      search,
      page,
      pages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard');
  }
};

/* ═══════════════════════════════════════════════════
   CATEGORIES
═══════════════════════════════════════════════════ */

// GET /admin/categories
export const getCategories = async (req, res) => {
  try {
    const search  = req.query.search?.trim() || '';
    const page    = Math.max(1, parseInt(req.query.page) || 1);
    const limit   = 8;
    const skip    = (page - 1) * limit;

    const query = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };

    const [categories, total] = await Promise.all([
      Category.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Category.countDocuments(query),
    ]);

    res.render('admin/categories', {
      title:      'Categories — Velmora Chroné',
      adminName:  req.session.adminName,
      categories,
      search,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    console.error('Get categories error:', err);
    req.flash('error', 'Failed to load categories.');
    res.redirect('/admin/dashboard');
  }
};

// POST /admin/categories/add
export const addCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const exists = await Category.findOne({
      name:      { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false,
    });
    if (exists) {
      req.flash('error', 'Category with this name already exists.');
      return res.redirect('/admin/categories');
    }
    await Category.create({ name: name.trim(), description: description?.trim() });
    req.flash('success', 'Category added successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Add category error:', err);
    req.flash('error', 'Failed to add category.');
    res.redirect('/admin/categories');
  }
};

// POST /admin/categories/:id/edit
export const editCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const duplicate = await Category.findOne({
      name:      { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false,
      _id:       { $ne: req.params.id },
    });
    if (duplicate) {
      req.flash('error', 'Another category with this name already exists.');
      return res.redirect('/admin/categories');
    }
    await Category.findByIdAndUpdate(req.params.id, {
      name:        name.trim(),
      description: description?.trim(),
    });
    req.flash('success', 'Category updated successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Edit category error:', err);
    req.flash('error', 'Failed to update category.');
    res.redirect('/admin/categories');
  }
};

// POST /admin/categories/:id/delete
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

/* ═══════════════════════════════════════════════════
   PRODUCTS
═══════════════════════════════════════════════════ */

// GET /admin/products
export const getProducts = async (req, res) => {
  try {
    const search  = req.query.search?.trim() || '';
    const page    = Math.max(1, parseInt(req.query.page) || 1);
    const limit   = 8;
    const skip    = (page - 1) * limit;

    const query = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };

    const [products, total, categories] = await Promise.all([
      Product.find(query).populate('category').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(query),
      Category.find({ isDeleted: false }).sort({ name: 1 }),
    ]);

    res.render('admin/products', {
      title:      'Products — Velmora Chroné',
      adminName:  req.session.adminName,
      products,
      categories,
      search,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    console.error('Get products error:', err);
    req.flash('error', 'Failed to load products.');
    res.redirect('/admin/dashboard');
  }
};

// POST /admin/products/add
export const addProduct = async (req, res) => {
  try {
    const { name, description, price, stock, images } = req.body;
    const category = req.body.category || null; // ✅ empty string becomes null

    if (!category) {
      req.flash('error', 'Please select a category.');
      return res.redirect('/admin/products');
    }

    let imageUrls = [];
    if (images) {
      const parsed = JSON.parse(images);
      for (const b64 of parsed) {
        const result = await cloudinary.uploader.upload(b64, {
          folder: 'velmora/products',
          transformation: [{ width: 800, height: 800, crop: 'fill' }],
        });
        imageUrls.push(result.secure_url);
      }
    }

    if (imageUrls.length < 3) {
      req.flash('error', 'Please upload at least 3 product images.');
      return res.redirect('/admin/products');
    }

    await Product.create({ name, description, price, stock, category, images: imageUrls });
    req.flash('success', 'Product added successfully.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Add product error:', err);
    req.flash('error', 'Failed to add product.');
    res.redirect('/admin/products');
  }
};

// POST /admin/products/:id/edit
export const editProduct = async (req, res) => {
  try {
    const { name, description, price, stock, images, existingImages } = req.body;
    const category = req.body.category || null; // ✅ empty string becomes null

    if (!category) {
      req.flash('error', 'Please select a category.');
      return res.redirect('/admin/products');
    }

    let imageUrls = existingImages ? JSON.parse(existingImages) : [];

    if (images) {
      const parsed = JSON.parse(images);
      for (const b64 of parsed) {
        if (b64.startsWith('data:')) {
          const result = await cloudinary.uploader.upload(b64, {
            folder: 'velmora/products',
            transformation: [{ width: 800, height: 800, crop: 'fill' }],
          });
          imageUrls.push(result.secure_url);
        }
      }
    }

    if (imageUrls.length < 3) {
      req.flash('error', 'Product must have at least 3 images.');
      return res.redirect('/admin/products');
    }

    await Product.findByIdAndUpdate(req.params.id, {
      name, description, price, stock, category, images: imageUrls,
    });
    req.flash('success', 'Product updated successfully.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Edit product error:', err);
    req.flash('error', 'Failed to update product.');
    res.redirect('/admin/products');
  }
};

// POST /admin/products/:id/delete
export const deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isDeleted: true });
    req.flash('success', 'Product deleted.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Delete product error:', err);
    req.flash('error', 'Failed to delete product.');
    res.redirect('/admin/products');
  }
};