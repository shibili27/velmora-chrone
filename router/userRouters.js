import express from 'express';
const router = express.Router();

import passport from '../config/passport.js';
import {
  isAuth,
  isGuest,
  noCache,
  hasOtpSession,
  hasOtpVerified,
  isOptionalAuth,
} from '../middlewares/authMiddleware.js';

import authController from '../controller/usercontroller/authController.js';
import profileController, { upload } from '../controller/usercontroller/profileController.js';
import {
  getHomePage,
  getProducts,
  getProductDetail,
  getProductStatus,
  getProductStock,
} from '../controller/usercontroller/productController.js';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getCartCount,
} from '../controller/usercontroller/cartController.js';
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  removeFromWishlistByProduct,
  checkInWishlist,
  moveToCart,
  getWishlistCount,
  toggleWishlist,
  getWishlistStatus,
  clearWishlist,
} from '../controller/usercontroller/wishlistController.js';
import {
  getCheckout,
  placeOrder,
  getOrderSuccess,
  getOrderFailure,
  applyCoupon,
  removeCoupon,
  createRazorpayOrder,
  verifyRazorpayPayment,
  markRazorpayFailed,
} from '../controller/usercontroller/checkoutController.js';
import {
  getOrders,
  getOrderDetail,
  cancelOrder,
  cancelItem,
  returnOrder,
  returnItem,
  downloadInvoice,
  streamOrderStatus,
} from '../controller/usercontroller/orderController.js';


router.get('/login', isGuest, noCache, (req, res) => {
  const authError   = req.flash('authError')[0]   || null;
  const errorSource = req.flash('errorSource')[0] || null;
  res.render('user/login', {
    authError,
    errorSource,
    formData: { email: req.flash('formEmail')[0] || '' }
  });
});
router.post('/login', authController.login);

router.get('/auth/google',
  isGuest,
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login', failureFlash: false }),
  async (req, res) => {
    try {
      req.session.user = req.user._id;
      await new Promise((resolve, reject) =>
        req.session.save(err => err ? reject(err) : resolve())
      );
      res.redirect('/');
    } catch (err) {
      console.error('Google callback error:', err);
      req.flash('authError', 'Google sign-in failed. Please try again.');
      req.flash('errorSource', 'email');
      res.redirect('/login');
    }
  }
);

router.get('/signup', isGuest, noCache, (req, res) => {
  res.render('user/signup', {
    authError: req.flash('authError')[0] || null,
    formData: {
      email: req.flash('formEmail')[0] || '',
      name:  req.flash('formName')[0]  || ''
    }
  });
});
router.post('/sendSignupOtp', authController.sendSignupOtp);

router.get('/otp', isGuest, noCache, hasOtpSession, (req, res) => res.render('user/otp'));
router.post('/verify-otp',  noCache, hasOtpSession, authController.verifySignupOTP);
router.post('/resend-otp',  hasOtpSession, authController.resendOTP);

router.get('/forget-password', isGuest, noCache, (req, res) => res.render('user/forgot'));
router.post('/forget-password', authController.forgotPassword);
router.post('/verify-reset-otp', noCache, authController.verifyResetOTP);

router.get('/reset-password',  isGuest, noCache, hasOtpVerified, (req, res) => res.render('user/newPassword'));
router.post('/reset-password', authController.resetPassword);


router.get('/', isOptionalAuth, getHomePage);
router.get('/home', isOptionalAuth, getHomePage);
router.get('/products', isOptionalAuth, getProducts);
router.get('/products/:id/status', isOptionalAuth, getProductStatus);
router.get('/products/:id/stock',  isOptionalAuth, getProductStock);
router.get('/products/:id', isOptionalAuth, getProductDetail);


router.get('/cart', isAuth, getCart);
router.post('/cart/add', isAuth, addToCart);
router.patch('/cart/update/:itemId',  isAuth, updateCartItem);
router.delete('/cart/remove/:itemId', isAuth, removeFromCart);
router.delete('/cart/clear', isAuth, clearCart);
router.get('/api/cart/count', isAuth, getCartCount);


router.get('/checkout', isAuth, noCache, getCheckout);
router.post('/checkout/place-order',  isAuth, placeOrder);
router.get('/checkout/success', isAuth, noCache, getOrderSuccess);
router.get('/checkout/failure', isAuth, noCache, getOrderFailure);
router.post('/checkout/apply-coupon',  isAuth, applyCoupon);
router.post('/checkout/remove-coupon', isAuth, removeCoupon);

// Razorpay
router.post('/checkout/razorpay/create-order', isAuth, createRazorpayOrder);
router.post('/checkout/razorpay/verify',       isAuth, verifyRazorpayPayment);
router.post('/checkout/razorpay/failed',       isAuth, markRazorpayFailed);


router.get('/orders', isAuth, noCache, getOrders);
// orderNumber-based routes — specific sub-paths first, then the detail catch-all
router.get('/orders/:orderNumber/status-stream', isAuth, streamOrderStatus);
router.get('/orders/:orderNumber/invoice',       isAuth, downloadInvoice);
router.post('/orders/:orderNumber/cancel',       isAuth, cancelOrder);
router.post('/orders/:orderNumber/cancel-item',  isAuth, cancelItem);
router.post('/orders/:orderNumber/return',       isAuth, returnOrder);
router.post('/orders/:orderNumber/return-item',  isAuth, returnItem);
router.get('/orders/:orderNumber',               isAuth, getOrderDetail);


router.get('/wishlist', isAuth, getWishlist);
router.post('/wishlist/add', isAuth, addToWishlist);
router.delete('/wishlist/clear', isAuth, clearWishlist);
router.delete('/wishlist/remove/:itemId', isAuth, removeFromWishlist);
router.delete('/wishlist/remove-product/:productId', isAuth, removeFromWishlistByProduct);
router.get('/wishlist/check/:productId', isAuth, checkInWishlist);
router.post('/wishlist/move-to-cart', isAuth, moveToCart);
router.get('/api/wishlist/count', isAuth, getWishlistCount);
router.get('/wishlist/status/:productId', isAuth, getWishlistStatus);
router.post('/wishlist/toggle', isAuth, toggleWishlist);


router.get('/profile',   isAuth, profileController.getProfile);
router.post('/profile/update',  isAuth, profileController.updateProfile);
router.post('/change-password', isAuth, profileController.changePassword);
router.post(
  '/profile/upload-image',
  isAuth,
  upload.single('profileImage'),
  profileController.uploadProfileImage
);
router.post('/profile/request-email-change', isAuth, profileController.requestEmailChange);
router.post('/profile/verify-email-change',  isAuth, profileController.verifyEmailChange);
router.post('/profile/address', isAuth, profileController.addAddress);
router.put('/profile/address/:id', isAuth, profileController.updateAddress);
router.delete('/profile/address/:id', isAuth, profileController.deleteAddress);
router.patch('/profile/address/:id/default', isAuth, profileController.setDefaultAddress);


router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

export default router;