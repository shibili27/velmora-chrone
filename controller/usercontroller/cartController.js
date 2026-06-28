import * as cartService from '../../services/cartService.js';
import { clearCouponIfCartChanged, SHIPPING_THRESHOLD } from '../../services/checkoutService.js';

export const getCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    const cart   = await cartService.getCleanCart(userId);
    const empty  = { items: [], totalItems: 0, subtotal: 0 };

    const finalCart = cart || empty;

    const subtotal = finalCart.items?.reduce((s, i) => s + i.price * i.quantity, 0) || 0;
    const isFreeShipping = subtotal >= SHIPPING_THRESHOLD;
    const shipping       = isFreeShipping ? 0 : 99;

    const canCheckout = finalCart.items?.length > 0 &&
      finalCart.items.every(i => {
        const p            = i.product;
        const variantStock = i.variantName
          ? p.colorVariants?.find(v => v.name === i.variantName)?.stock ?? p.stock
          : p.stock;
        return !p.isDeleted && p.isListed && !p.category?.isBlocked &&
               variantStock > 0 && i.quantity <= variantStock;
      });

    res.render('user/cart', {
      cart: finalCart,
      canCheckout,
      MAX_QTY: cartService.MAX_QTY,
      isFreeShipping,
      shipping,
      SHIPPING_THRESHOLD,
    });
  } catch (err) {
    console.error('[getCart]', err);
    res.status(500).render('error', { message: 'Failed to load cart.' });
  }
};

export const addToCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Please login to continue', redirectUrl: '/login' });

    const cartCount = await cartService.addItemToCart(userId, req.body.productId, req.body.quantity, req.body.variantName || null);

    clearCouponIfCartChanged(req.session);

    res.json({ success: true, message: 'Added to cart', cartCount });
  } catch (err) {
    console.error('[addToCart]', err);
    res.status(err.status || 500).json({ success: false, message: err.message, blocked: err.status === 403 });
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    const result = await cartService.updateItem(userId, req.params.itemId, req.body.action);

    clearCouponIfCartChanged(req.session);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[updateCartItem]', err);
    res.status(err.status || 500).json({ success: false, message: err.message, removed: err.removed, maxStock: err.maxStock, maxQty: err.maxQty });
  }
};

export const removeFromCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    const result = await cartService.removeItem(userId, req.params.itemId);

    clearCouponIfCartChanged(req.session);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[removeFromCart]', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

export const clearCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    await cartService.clearUserCart(userId);

    clearCouponIfCartChanged(req.session);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear cart' });
  }
};

export const getCartCount = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    const count  = await cartService.getCartCount(userId);
    res.json({ count });
  } catch (_) {
    res.json({ count: 0 });
  }
};