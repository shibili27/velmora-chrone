// middlewares/auth.js  — ADMIN-ONLY middleware
// Admin session key: req.session.adminId
// User  session key: req.session.user
// These are COMPLETELY SEPARATE — no cross-access allowed.

// ─── ADMIN: Requires admin to be logged in ────────────────────────────────────
export const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }
  req.flash('error', 'Please sign in to access the admin panel.');
  res.redirect('/admin/login');
};

// ─── ADMIN GUEST: Blocks logged-in admins from the login page ────────────────
// Does NOT check req.session.user — admin and user sessions are independent
export const isGuest = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin/dashboard');
  }
  next();
};