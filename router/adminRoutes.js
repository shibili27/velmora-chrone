import express from 'express';
import Admin    from '../models/admin.js';
import User     from '../models/user.js';
import Product  from '../models/product.js';
import Category from '../models/category.js';
import { isAuthenticated, isGuest } from '../middlewares/auth.js';
import {
  getDashboard,
  getCategories, addCategory, editCategory, deleteCategory,
  getProducts,   addProduct,  editProduct,  deleteProduct,
  blockProduct,  unblockProduct,
  getBrands,     addBrand,    editBrand,    deleteBrand,
} from '../controller/adimconrtoller/adminController.js';

const router = express.Router();

// ── Login ─────────────────────────────────────────────────────────────────────
router.get('/login', isGuest, (req, res) => {
  res.render('admin/login', {
    title:    'Admin Sign In — Velmora Chroné',
    error:    req.flash('error')[0]   || null,
    success:  req.flash('success')[0] || null,
    formData: req.flash('formData')[0] || {},
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    req.flash('formData', { email });
    return res.redirect('/admin/login');
  }
  try {
    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin) {
      req.flash('error', 'Invalid email or password.');
      req.flash('formData', { email });
      return res.redirect('/admin/login');
    }
    if (admin.isActive === false) {
      req.flash('error', 'This account has been deactivated.');
      return res.redirect('/admin/login');
    }
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Invalid email or password.');
      req.flash('formData', { email });
      return res.redirect('/admin/login');
    }

    // ── Admin session uses adminId — completely separate from user session ──
    req.session.adminId   = admin._id.toString();
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;

    req.session.save(async (err) => {
      if (err) {
        req.flash('error', 'Something went wrong. Please try again.');
        return res.redirect('/admin/login');
      }
      await Admin.findByIdAndUpdate(admin._id, { lastLogin: new Date() });
      res.redirect('/admin/dashboard');
    });
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', 'An unexpected error occurred.');
    res.redirect('/admin/login');
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.get('/logout', isAuthenticated, (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.clearCookie('connect.sid');
    res.redirect('/admin/login');
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', isAuthenticated, getDashboard);

// ── Customers ─────────────────────────────────────────────────────────────────
router.get('/customers', isAuthenticated, async (req, res) => {
  try {
    const page   = parseInt(req.query.page) || 1;
    const limit  = 8;
    const search = req.query.search || '';

    let query = {};
    if (search) {
      query = {
        $or: [
          { name:  { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      };
    }

    const total     = await User.countDocuments(query);
    const customers = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.render('admin/customers', {
      title:     'Customers — Velmora Chroné Admin',
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      customers,
      total,
      page,
      pages: Math.ceil(total / limit),
      search,
      error:   req.flash('error')[0]   || null,
      success: req.flash('success')[0] || null,
    });
  } catch (err) {
    console.error('Customers error:', err);
    req.flash('error', 'Failed to load customers.');
    res.redirect('/admin/dashboard');
  }
});

router.post('/customers/:id/block', isAuthenticated, async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { isBlocked: true });
  req.flash('success', 'Customer blocked.');
  res.redirect('/admin/customers');
});

router.post('/customers/:id/unblock', isAuthenticated, async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { isBlocked: false });
  req.flash('success', 'Customer unblocked.');
  res.redirect('/admin/customers');
});

// ── Categories ────────────────────────────────────────────────────────────────
router.get('/categories',             isAuthenticated, getCategories);
router.post('/categories/add',        isAuthenticated, addCategory);
router.post('/categories/:id/edit',   isAuthenticated, editCategory);
router.post('/categories/:id/delete', isAuthenticated, deleteCategory);

// ── Products ──────────────────────────────────────────────────────────────────
router.get('/products',               isAuthenticated, getProducts);
router.post('/products/add',          isAuthenticated, addProduct);
router.post('/products/:id/edit',     isAuthenticated, editProduct);
router.post('/products/:id/delete',   isAuthenticated, deleteProduct);
// Block / Unblock (soft toggle — does NOT delete)
router.post('/products/:id/block',    isAuthenticated, blockProduct);
router.post('/products/:id/unblock',  isAuthenticated, unblockProduct);

// ── Brands ────────────────────────────────────────────────────────────────────
router.get('/brands',             isAuthenticated, getBrands);
router.post('/brands/add',        isAuthenticated, addBrand);
router.post('/brands/:id/edit',   isAuthenticated, editBrand);
router.post('/brands/:id/delete', isAuthenticated, deleteBrand);

export default router;