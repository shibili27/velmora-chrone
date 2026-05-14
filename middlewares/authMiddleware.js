import User from '../models/user.js';

export const noCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

export const hasOtpSession = (req, res, next) => {
  const hasSignupOtp = req.session.signupOTP && req.session.signupEmail;
  const hasResetOtp  = req.session.resetOTP  && req.session.resetEmail;

  if (!hasSignupOtp && !hasResetOtp) {
    console.log('hasOtpSession: BLOCKED → redirecting to /signup');
    return res.redirect('/signup');
  }
  next();
};

export const hasOtpVerified = (req, res, next) => {
  if (!req.session.otpVerified) {
    return res.redirect('/forget-password');
  }
  next();
};

// ─── Helper: detect AJAX / JSON requests ─────────────────────────────────────
function isAjax(req) {
  return (
    req.xhr ||
    req.headers['accept']?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json') ||
    req.headers['x-requested-with'] === 'XMLHttpRequest'
  );
}

// ─── USER AUTH: Requires user login — AJAX-aware ──────────────────────────────
// Uses req.session.user (set on user login)
// Admin session (req.session.adminId) is completely separate — no cross-access
export const isAuth = async (req, res, next) => {
  // Explicitly block admin sessions from accessing user routes
  if (req.session && req.session.adminId && !req.session.user) {
    if (isAjax(req)) {
      return res.status(401).json({
        success:     false,
        message:     'Please login to continue',
        redirectUrl: '/login',
      });
    }
    req.flash('authError', 'Please login to access this page');
    return res.redirect('/login');
  }

  if (!req.session || !req.session.user) {
    if (isAjax(req)) {
      return res.status(401).json({
        success:     false,
        message:     'Please login to continue',
        redirectUrl: '/login',
      });
    }
    req.flash('authError', 'Please login to access this page');
    return res.redirect('/login');
  }

  try {
    const user = await User.findById(req.session.user);

    if (!user) {
      req.session.destroy();
      if (isAjax(req)) {
        return res.status(401).json({
          success:     false,
          message:     'Session expired. Please login again',
          redirectUrl: '/login',
        });
      }
      req.flash('authError', 'Session expired. Please login again');
      return res.redirect('/login');
    }

    if (user.isBlocked) {
      req.session.destroy();
      if (isAjax(req)) {
        return res.status(403).json({
          success:     false,
          message:     'Your account has been blocked. Contact admin for assistance',
          redirectUrl: '/login',
        });
      }
      req.flash('authError', 'Your account has been blocked. Contact admin for assistance');
      return res.redirect('/login');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (isAjax(req)) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    return res.redirect('/login');
  }
};

// ─── Loads user if logged in — never blocks guests ───────────────────────────
// req.user = User object if logged in, null if guest
// Use on: home, products, product detail pages
export const isOptionalAuth = async (req, res, next) => {
  if (!req.session || !req.session.user) {
    req.user = null;
    return next();
  }

  try {
    const user = await User.findById(req.session.user);

    if (!user || user.isBlocked) {
      req.session.destroy();
      req.user = null;
      return next();
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('isOptionalAuth error:', error);
    req.user = null;
    next();
  }
};

// ─── USER GUEST: Blocks logged-in USERS from auth pages ──────────────────────
// Only checks req.session.user — does NOT block admins
export const isGuest = (req, res, next) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  next();
};

// ─── Checks if a logged-in user is blocked (global use) ──────────────────────
export const isNotBlocked = async (req, res, next) => {
  if (req.session && req.session.user) {
    try {
      const user = await User.findById(req.session.user);
      if (user && user.isBlocked) {
        req.session.destroy();
        req.flash('authError', 'Your account has been blocked');
        return res.redirect('/login');
      }
    } catch (error) {
      console.error('isNotBlocked middleware error:', error);
      return res.redirect('/login');
    }
  }
  next();
};