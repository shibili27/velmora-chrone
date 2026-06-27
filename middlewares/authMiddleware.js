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
    // AJAX request (axios) — return JSON, don't redirect
    if (req.xhr || req.headers['accept']?.includes('application/json') || req.headers['content-type']?.includes('application/json')) {
      return res.status(400).json({ success: false, message: 'Session expired. Please signup again.' });
    }
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


function isAjax(req) {
  return (
    req.xhr ||
    req.headers['accept']?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json') ||
    req.headers['x-requested-with'] === 'XMLHttpRequest'
  );
}


function clearUserSession(req) {
  return new Promise((resolve) => {
    delete req.session.user;
    delete req.session.signupOTP;
    delete req.session.signupEmail;
    delete req.session.resetOTP;
    delete req.session.resetEmail;
    delete req.session.otpVerified;
    req.session.save((err) => {
      if (err) console.error('clearUserSession save error:', err);
      resolve();
    });
  });
}


export const isAuth = async (req, res, next) => {


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

  const userId = req.session?.user || (req.user ? req.user._id : null);

  if (!userId) {
   
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
    const user = req.user || await User.findById(userId);

    if (!user) {
      console.log('  ❌ User not found in DB');
      await clearUserSession(req);
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
      console.log('  ❌ User is blocked');
      await clearUserSession(req);
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

    if (!req.session.user) {
      req.session.user = user._id;
      req.session.save((err) => {
        if (err) console.error('isAuth session save error:', err);
      });
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


export const isOptionalAuth = async (req, res, next) => {
  const userId = req.session?.user || (req.user ? req.user._id : null);

  if (!userId) {
    req.user = null;
    return next();
  }

  try {
    // Reuse passport's req.user if already loaded
    const user = req.user || await User.findById(userId);

    if (!user || user.isBlocked) {
      await clearUserSession(req);
      req.user = null;
      return next();
    }

    if (!req.session.user) {
      req.session.user = user._id;
      req.session.save((err) => {
        if (err) console.error('isOptionalAuth session save error:', err);
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('isOptionalAuth error:', error);
    req.user = null;
    next();
  }
};


export const isGuest = (req, res, next) => {
  const isLoggedIn = (req.session && req.session.user) || !!req.user;
  if (isLoggedIn) {
    return res.redirect('/');
  }
  next();
};


export const isNotBlocked = async (req, res, next) => {
  const userId = req.session?.user || (req.user ? req.user._id : null);
  if (userId) {
    try {
      const user = req.user || await User.findById(userId);
      if (user && user.isBlocked) {
        await clearUserSession(req);
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