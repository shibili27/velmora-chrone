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

export const isAuth = async (req, res, next) => {
  if (!req.session || !req.session.user) {
    req.flash('authError', 'Please login to access this page');
    return res.redirect('/login');
  }

  try {
    const user = await User.findById(req.session.user);

    if (!user) {
      req.session.destroy();
      req.flash('authError', 'Session expired. Please login again');
      return res.redirect('/login');
    }

    if (user.isBlocked) {
      req.session.destroy();
      req.flash('authError', 'Your account has been blocked. Contact admin for assistance');
      return res.redirect('/login');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.redirect('/login');
  }
};

export const isGuest = (req, res, next) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  next();
};

export const isAdmin = async (req, res, next) => {
  if (!req.session || !req.session.user) {
    req.flash('authError', 'Please login to access admin panel');
    return res.redirect('/admin/login');
  }

  try {
    const user = await User.findById(req.session.user);

    if (!user || user.role !== 'admin') {
      req.flash('authError', 'Access denied. Admin privileges required.');
      return res.redirect('/admin/login');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    return res.redirect('/admin/login');
  }
};

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