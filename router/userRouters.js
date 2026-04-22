import express from 'express';
const router = express.Router();

import passport from '../config/passport.js';
import { isAuth, isGuest, noCache, hasOtpSession, hasOtpVerified } from '../middlewares/authMiddleware.js';
import authController from '../controller/usercontroller/authController.js';
import profileController, { upload } from '../controller/usercontroller/profileController.js';
import { getProducts } from '../controller/usercontroller/productController.js';



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

// Google OAuth
router.get('/auth/google',
  isGuest,
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    failureFlash:    false
  }),
  async (req, res) => {
    try {
      req.session.user = req.user._id;
      await new Promise((resolve, reject) => {
        req.session.save(err => err ? reject(err) : resolve());
      });
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
router.post('/verify-otp', noCache, hasOtpSession, authController.verifySignupOTP);
router.post('/resend-otp', hasOtpSession, authController.resendOTP);

router.get('/forget-password', isGuest, noCache, (req, res) => res.render('user/forgot'));
router.post('/forget-password', authController.forgotPassword);
router.post('/verify-reset-otp', noCache, authController.verifyResetOTP);

router.get('/reset-password',  isGuest, noCache, hasOtpVerified, (req, res) => res.render('user/newPassword'));
router.post('/reset-password', authController.resetPassword);

router.get('/',    isAuth, (req, res) => res.render('user/home'));
router.get('/home', isAuth, (req, res) => res.render('user/home'));


router.get('/products', isAuth, getProducts);
// ─────────────────────────────────────────
// Profile routes
// ─────────────────────────────────────────
router.get('/profile',          isAuth, profileController.getProfile);
router.post('/profile/update',  isAuth, profileController.updateProfile);
router.post('/change-password', isAuth, profileController.changePassword);

// ── Image upload (permanent via Cloudinary) ──
router.post(
  '/profile/upload-image',
  isAuth,
  upload.single('profileImage'),   // multer middleware — field name must match your form
  profileController.uploadProfileImage
);

// ── Email change with OTP ──
router.post('/profile/request-email-change', isAuth, profileController.requestEmailChange);
router.post('/profile/verify-email-change',  isAuth, profileController.verifyEmailChange);

// ─────────────────────────────────────────
// Address routes
// ─────────────────────────────────────────
router.post('/profile/address',              isAuth, profileController.addAddress);
router.put('/profile/address/:id',           isAuth, profileController.updateAddress);
router.delete('/profile/address/:id',        isAuth, profileController.deleteAddress);
router.patch('/profile/address/:id/default', isAuth, profileController.setDefaultAddress);

// ─────────────────────────────────────────
// Logout
// ─────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

export default router;