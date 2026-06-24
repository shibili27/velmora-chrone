import * as checkoutService from '../../services/checkoutService.js';

export async function getCheckout(req, res) {
  try {
    const data = await checkoutService.buildCheckoutData(req.session.user, req.session);
    res.render('user/checkout', { ...data, paymentMethod: req.session.paymentMethod || 'COD' });
  } catch (err) {
    if (err.message === 'EMPTY_CART' || err.message === 'INVALID_CART') {
      if (err.message === 'INVALID_CART') req.flash?.('cartError', 'Some items in your cart are unavailable. Please review your cart.');
      return res.redirect('/cart');
    }
    console.error('[Checkout] getCheckout error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
}

export async function placeOrder(req, res) {
  try {
    const result = await checkoutService.placeOrder(req.session.user, { addressId: req.body.addressId, session: req.session });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('[Checkout] placeOrder error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to place order. Please try again.', stockErrors: err.stockErrors });
  }
}

// --- Wallet ---------------------------------------------------------------

export async function placeOrderWithWallet(req, res) {
  try {
    const result = await checkoutService.placeOrderWithWallet(req.session.user, {
      addressId: req.body.addressId,
      session  : req.session,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('[Checkout] placeOrderWithWallet error:', err);
    return res.status(err.status || 500).json({
      success    : false,
      message    : err.message || 'Failed to place order. Please try again.',
      stockErrors: err.stockErrors,
    });
  }
}

// --- Razorpay -------------------------------------------------------------

export async function createRazorpayOrder(req, res) {
  try {
    const result = await checkoutService.createRazorpayCheckoutOrder(req.session.user, {
      addressId: req.body.addressId,
      session  : req.session,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('[Checkout] createRazorpayOrder error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Could not initiate payment. Please try again.', stockErrors: err.stockErrors });
  }
}

export async function verifyRazorpayPayment(req, res) {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const result = await checkoutService.verifyRazorpayCheckoutPayment(req.session.user, {
      orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature, session: req.session,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[Checkout] verifyRazorpayPayment error:', err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Payment verification failed.',
      orderId: err.orderId, orderNumber: err.orderNumber,
    });
  }
}

export async function markRazorpayFailed(req, res) {
  try {
    const result = await checkoutService.markRazorpayPaymentFailed(req.session.user, {
      orderId: req.body.orderId,
      reason : req.body.reason,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[Checkout] markRazorpayFailed error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
}

export async function retryRazorpayPayment(req, res) {
  try {
    const result = await checkoutService.retryRazorpayPayment(req.session.user, {
      orderId: req.params.orderId || req.body.orderId,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[Checkout] retryRazorpayPayment error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
}

export async function getOrderSuccess(req, res) {
  try {
    const order = await checkoutService.getOrderSuccess(req.query.orderId, req.session.user);
    return res.render('user/orderSuccess', { order });
  } catch (err) {
    res.redirect('/');
  }
}

export async function getOrderFailure(req, res) {
  try {
    const order = await checkoutService.getOrderFailure(req.query.orderId, req.session.user);
    return res.render('user/orderFailure', { order });
  } catch (err) {
    res.redirect('/checkout');
  }
}

// --- Coupons ---------------------------------------------------------------

export async function applyCoupon(req, res) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Please enter a coupon code.' });

    const result = await checkoutService.applyCouponToSession(req.session.user, code, req.session);
    return res.status(200).json({
      success       : true,
      message       : result.message,
      couponCode    : result.couponCode,
      couponDiscount: result.couponDiscount,
      pricing       : result.pricing,
      newTotal      : result.pricing.grandTotal,
    });
  } catch (err) {
    console.error('[Checkout] applyCoupon error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Could not apply coupon.' });
  }
}

export async function removeCoupon(req, res) {
  try {
    const result = await checkoutService.removeCouponFromSession(req.session.user, req.session);
    return res.status(200).json({
      success : true,
      message : result.message,
      pricing : result.pricing,
      newTotal: result.pricing ? result.pricing.grandTotal : null,
    });
  } catch (err) {
    console.error('[Checkout] removeCoupon error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Could not remove coupon.' });
  }
}