import * as checkoutService from '../../services/checkoutService.js';

export async function getCheckout(req, res) {
  try {
    const data = await checkoutService.buildCheckoutData(req.session.user, req.session);
    res.render('user/checkout', { ...data, paymentMethod: 'COD' });
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
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to place order. Please try again.' });
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

export async function applyCoupon(req, res) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Please enter a coupon code.' });
    // TODO: query Coupon model here
    return res.status(200).json({ success: false, message: 'Coupon feature coming soon.' });
  } catch (err) {
    console.error('[Checkout] applyCoupon error:', err);
    return res.status(500).json({ success: false, message: 'Could not apply coupon.' });
  }
}