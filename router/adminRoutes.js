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
import {
  listOrders,
  getOrderDetail,
  updateOrderStatus,
  handleReturnRequest, 
   getRecentOrders,            
} from '../controller/adimconrtoller/orderController.js';

const router = express.Router();

router.get('/login', isGuest, (req, res) => {
  res.render('admin/login', {
    title:      'Admin Sign In — Velmora Chroné',
    error:      req.flash('adminError')[0]      || null,
    errorField: req.flash('adminErrorField')[0] || null,
    success:    req.flash('adminSuccess')[0]    || null,
    formData:   req.flash('formData')[0]        || {},
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('adminError', 'Email and password are required.');
    req.flash('adminErrorField', 'both');
    req.flash('formData', { email });
    return res.redirect('/admin/login');
  }

  try {
    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });

    if (!admin) {
      req.flash('adminError', 'No account found with that email address.');
      req.flash('adminErrorField', 'email');
      req.flash('formData', { email });
      return res.redirect('/admin/login');
    }

    if (admin.isActive === false) {
      req.flash('adminError', 'This account has been deactivated.');
      req.flash('adminErrorField', 'email');
      req.flash('formData', { email });
      return res.redirect('/admin/login');
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      req.flash('adminError', 'Incorrect password. Please try again.');
      req.flash('adminErrorField', 'password');
      req.flash('formData', { email });
      return res.redirect('/admin/login');
    }

    req.session.adminId   = admin._id.toString();
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;

    req.session.save(async (err) => {
      if (err) {
        req.flash('adminError', 'Something went wrong. Please try again.');
        req.flash('adminErrorField', 'both');
        return res.redirect('/admin/login');
      }
      await Admin.findByIdAndUpdate(admin._id, { lastLogin: new Date() });
      res.redirect('/admin/dashboard');
    });

  } catch (err) {
    console.error('Login error:', err);
    req.flash('adminError', 'An unexpected error occurred.');
    req.flash('adminErrorField', 'both');
    res.redirect('/admin/login');
  }
});

router.get('/logout', isAuthenticated, (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.clearCookie('connect.sid');
    res.redirect('/admin/login');
  });
});

router.get('/dashboard', isAuthenticated, getDashboard);

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
  try {
    await User.findByIdAndUpdate(req.params.id, { isBlocked: true });
    req.flash('success', 'Customer blocked.');
    req.session.save((err) => {
      if (err) console.error('Session save error on block:', err);
      res.redirect('/admin/customers');
    });
  } catch (err) {
    console.error('Block customer error:', err);
    req.flash('error', 'Failed to block customer.');
    res.redirect('/admin/customers');
  }
});

router.post('/customers/:id/unblock', isAuthenticated, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBlocked: false });
    req.flash('success', 'Customer unblocked.');
    req.session.save((err) => {
      if (err) console.error('Session save error on unblock:', err);
      res.redirect('/admin/customers');
    });
  } catch (err) {
    console.error('Unblock customer error:', err);
    req.flash('error', 'Failed to unblock customer.');
    res.redirect('/admin/customers');
  }
});

router.get('/categories',isAuthenticated, getCategories);
router.post('/categories/add',isAuthenticated, addCategory);
router.post('/categories/:id/edit',isAuthenticated, editCategory);
router.post('/categories/:id/delete', isAuthenticated, deleteCategory);

router.get('/products',isAuthenticated, getProducts);
router.post('/products/add',isAuthenticated, addProduct);
router.post('/products/:id/edit',isAuthenticated, editProduct);
router.post('/products/:id/delete',  isAuthenticated, deleteProduct);
router.post('/products/:id/block',isAuthenticated, blockProduct);
router.post('/products/:id/unblock', isAuthenticated, unblockProduct);

router.get('/brands',isAuthenticated, getBrands);
router.post('/brands/add',isAuthenticated, addBrand);
router.post('/brands/:id/edit',isAuthenticated, editBrand);
router.post('/brands/:id/delete', isAuthenticated, deleteBrand);

router.get('/orders',isAuthenticated, listOrders);
router.get('/orders/notify/recent',    isAuthenticated, getRecentOrders);
router.get('/orders/:id',isAuthenticated, getOrderDetail);
router.patch('/orders/:id/status',isAuthenticated, updateOrderStatus);
router.patch('/orders/:id/return',isAuthenticated, handleReturnRequest);  
export default router;