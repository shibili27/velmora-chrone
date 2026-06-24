import Cart    from '../models/cart.js';
import Order   from '../models/order.js';
import User    from '../models/user.js';
import Product from '../models/product.js';
import Coupon  from '../models/coupon.js';
import Wallet  from '../models/wallet.js';
import { broadcast } from '../public/utils/ssemanager.js';
import { createRazorpayOrder, verifyPaymentSignature } from './razorpayService.js';

const TAX_RATE           = 0.18;
const SHIPPING_THRESHOLD = 50000;

export const getPopulatedCart = async (userId) => {
  return Cart.findOne({ user: userId }).populate({
    path    : 'items.product',
    populate: [
      { path: 'brand',    select: 'name' },
      { path: 'category', select: 'name isBlocked' },
    ],
  });
};

export const cartIsValid = (cart) => {
  if (!cart || !cart.items.length) return false;
  return cart.items.every(({ product: p, quantity }) =>
    p && !p.isDeleted && p.isListed !== false && !p.category?.isBlocked && p.stock > 0 && quantity <= p.stock
  );
};

export const buildPriceSummary = (cart, couponDiscount = 0) => {
  let subtotal = 0, totalDiscount = 0;

  for (const item of cart.items) {
    const mrp    = item.product.mrp || item.product.price || item.price;
    subtotal    += item.price * item.quantity;
    if (mrp > item.price) totalDiscount += (mrp - item.price) * item.quantity;
  }

  const afterDiscount = subtotal - couponDiscount;
  const tax           = Math.round(afterDiscount * TAX_RATE);
  const shipping      = afterDiscount >= SHIPPING_THRESHOLD ? 0 : 99;

  return {
    subtotal       : Math.round(subtotal),
    itemDiscount   : Math.round(totalDiscount),
    couponDiscount : Math.round(couponDiscount),
    totalDiscount  : Math.round(totalDiscount + couponDiscount),
    tax,
    taxRate        : TAX_RATE * 100,
    shipping,
    grandTotal     : Math.round(afterDiscount + tax + shipping),
    isFreeShipping : shipping === 0,
  };
};

export const validateStockBeforeOrder = async (cartItems) => {
  const errors = [];

  for (const cartItem of cartItems) {
    const product     = await Product.findById(cartItem.product._id).select('name stock colorVariants isDeleted isListed');
    const variantName = cartItem.variantName || null;

    if (!product || product.isDeleted || product.isListed === false) {
      errors.push(`"${cartItem.product.name}" is no longer available.`);
      continue;
    }

    let availableStock = 0;
    if (product.colorVariants?.length > 0 && variantName) {
      const variant = product.colorVariants.find(v => v.name === variantName);
      availableStock = variant ? variant.stock : 0;
    } else {
      availableStock = product.stock;
    }

    if (availableStock < cartItem.quantity) {
      if (availableStock === 0) {
        errors.push(`"${product.name}" is out of stock.`);
      } else {
        errors.push(`"${product.name}" — only ${availableStock} unit(s) available, you requested ${cartItem.quantity}.`);
      }
    }
  }

  return errors;
};

export const decrementStockAndBroadcast = async (cartItem) => {
  const productId   = cartItem.product._id;
  const qty         = cartItem.quantity;
  const variantName = cartItem.variantName || null;

  const product = await Product.findById(productId).select('stock colorVariants isListed isDeleted price');
  if (!product) return;

  let broadcastStock = 0;

  if (product.colorVariants?.length > 0) {
    product.colorVariants.forEach(v => {
      if (!variantName || v.name === variantName) v.stock = Math.max(0, (v.stock || 0) - qty);
    });
    product.stock  = product.colorVariants.reduce((s, v) => s + (v.stock || 0), 0);
    await product.save();
    broadcastStock = product.stock;
  } else {
    let updated = await Product.findByIdAndUpdate(productId, { $inc: { stock: -qty } }, { new: true, select: 'stock colorVariants isListed isDeleted price' });
    if (updated?.stock < 0) updated = await Product.findByIdAndUpdate(productId, { $set: { stock: 0 } }, { new: true, select: 'stock colorVariants isListed isDeleted price' });
    broadcastStock = updated ? updated.stock : 0;
  }

  broadcast('productUpdate', {
    productId    : String(productId),
    stock        : broadcastStock,
    price        : product.price,
    isListed     : product.isListed !== false,
    isDeleted    : product.isDeleted || false,
    colorVariants: (product.colorVariants || []).map(v => ({ name: v.name, hex: v.hex, stock: v.stock })),
  });
};

export const restoreStockAndBroadcast = async (productId, qty, variantName = null) => {
  const product = await Product.findById(productId).select('stock colorVariants isListed isDeleted price');
  if (!product) return;

  let broadcastStock = 0;

  if (product.colorVariants?.length > 0) {
    product.colorVariants.forEach(v => {
      if (!variantName || v.name === variantName) v.stock = (v.stock || 0) + qty;
    });
    product.stock  = product.colorVariants.reduce((s, v) => s + (v.stock || 0), 0);
    await product.save();
    broadcastStock = product.stock;
  } else {
    const updated  = await Product.findByIdAndUpdate(productId, { $inc: { stock: qty } }, { new: true, select: 'stock colorVariants isListed isDeleted price' });
    broadcastStock = updated ? updated.stock : 0;
  }

  broadcast('productUpdate', {
    productId    : String(productId),
    stock        : broadcastStock,
    price        : product.price,
    isListed     : product.isListed !== false,
    isDeleted    : product.isDeleted || false,
    colorVariants: (product.colorVariants || []).map(v => ({ name: v.name, hex: v.hex, stock: v.stock })),
  });
};

// ── Coupons ───────────────────────────────────────────────────────────────

export const applyCouponToSession = async (userId, code, session) => {
  if (session.couponCode) {
    throw Object.assign(
      new Error('A coupon is already applied. Remove it before applying another.'),
      { status: 400 }
    );
  }

  const normalizedCode = (code || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw Object.assign(new Error('Please enter a coupon code.'), { status: 400 });
  }

  const coupon = await Coupon.findOne({ code: normalizedCode });
  if (!coupon) {
    throw Object.assign(new Error('Invalid coupon code.'), { status: 404 });
  }

  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) {
    throw Object.assign(new Error('Your cart is empty.'), { status: 400 });
  }

  const { subtotal } = buildPriceSummary(cart, 0);

  const { valid, message } = coupon.validateFor(userId, subtotal);
  if (!valid) {
    throw Object.assign(new Error(message), { status: 400 });
  }

  const discount = coupon.calculateDiscount(subtotal);
  const pricing  = buildPriceSummary(cart, discount);

  session.couponCode     = coupon.code;
  session.couponDiscount = discount;

  return {
    message       : `Coupon "${coupon.code}" applied successfully.`,
    couponCode    : coupon.code,
    couponDiscount: discount,
    pricing,
  };
};

export const removeCouponFromSession = async (userId, session) => {
  if (!session.couponCode) {
    throw Object.assign(new Error('No coupon is currently applied.'), { status: 400 });
  }

  delete session.couponCode;
  delete session.couponDiscount;

  const cart    = await getPopulatedCart(userId);
  const pricing = cart && cart.items.length ? buildPriceSummary(cart, 0) : null;

  return { message: 'Coupon removed.', pricing };
};

const recordCouponUsage = async (couponCode, userId) => {
  if (!couponCode) return;
  const coupon = await Coupon.findOne({ code: couponCode });
  if (!coupon) return;

  const existing = coupon.usedBy.find(u => String(u.user) === String(userId));
  if (existing) {
    existing.count += 1;
  } else {
    coupon.usedBy.push({ user: userId, count: 1 });
  }
  coupon.usedCount += 1;
  await coupon.save();
};

// ── Checkout page data ────────────────────────────────────────────────────

export const buildCheckoutData = async (userId, session) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('EMPTY_CART'),   { status: 302 });
  if (!cartIsValid(cart))          throw Object.assign(new Error('INVALID_CART'), { status: 302 });

  const user           = await User.findById(userId).select('name email phone addresses');
  const couponDiscount = session.couponDiscount || 0;
  const couponCode     = session.couponCode     || null;
  const pricing        = buildPriceSummary(cart, couponDiscount);

  // Fetch wallet balance to display "Pay from Wallet" option
  const wallet         = await Wallet.getOrCreate(userId);
  const walletBalance  = wallet.balance;

  const items = cart.items.map(item => {
    const p               = item.product;
    const mrp             = p.mrp || p.price || item.price;
    const discountPercent = mrp > item.price ? Math.round(((mrp - item.price) / mrp) * 100) : 0;
    return {
      _id            : item._id,
      productId      : p._id,
      name           : p.name,
      brand          : p.brand?.name || null,
      category       : p.category?.name || null,
      image          : p.images?.[0] || null,
      quantity       : item.quantity,
      unitPrice      : item.price,
      mrp,
      discountPercent,
      itemTotal      : item.price * item.quantity,
      taxAmount      : Math.round(item.price * item.quantity * TAX_RATE),
    };
  });

  return { user, addresses: user.addresses || [], items, pricing, couponCode, walletBalance };
};

// ── Shared order-building helpers ─────────────────────────────────────────

const buildOrderItemsAndValidate = async (cart) => {
  const stockErrors = await validateStockBeforeOrder(cart.items);
  if (stockErrors.length > 0) {
    throw Object.assign(new Error(stockErrors[0]), { status: 400, stockErrors });
  }

  return cart.items.map(item => ({
    product    : item.product._id,
    name       : item.product.name,
    brand      : item.product.brand?.name || '',
    image      : item.product.images?.[0] || '',
    variantName: item.variantName || null,
    quantity   : item.quantity,
    price      : item.price,
    totalPrice : item.price * item.quantity,
  }));
};

const resolveShippingAddress = (user, addressId) => {
  const shippingAddress = addressId
    ? user.addresses?.id(addressId)
    : user.addresses?.find(a => a.isDefault) || user.addresses?.[0];

  if (!shippingAddress) throw Object.assign(new Error('Please select a delivery address.'), { status: 400 });
  return shippingAddress;
};

const clearCartAndCoupon = async (cart, session) => {
  cart.items = [];
  await cart.save();
  delete session.couponDiscount;
  delete session.couponCode;
};

// ── COD ───────────────────────────────────────────────────────────────────

export const placeOrder = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'),                                                        { status: 400 });
  if (!cartIsValid(cart))          throw Object.assign(new Error('Some items are no longer available. Please review your cart.'),               { status: 400 });

  const orderItems      = await buildOrderItemsAndValidate(cart);
  const user            = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = resolveShippingAddress(user, addressId);
  const couponDiscount  = session.couponDiscount || 0;
  const couponCode      = session.couponCode     || null;
  const pricing         = buildPriceSummary(cart, couponDiscount);

  for (const item of cart.items) await decrementStockAndBroadcast(item);

  const order = await Order.create({
    user        : userId,
    items       : orderItems,
    shippingAddress: {
      fullName: shippingAddress.fullName || user.name,
      phone   : shippingAddress.phone    || user.phone || '',
      line1   : shippingAddress.line1    || 'N/A',
      city    : shippingAddress.city     || '',
      state   : shippingAddress.state    || '',
      pincode : shippingAddress.pincode  || '',
    },
    pricing: {
      subtotal      : pricing.subtotal,
      itemDiscount  : pricing.itemDiscount,
      couponDiscount: pricing.couponDiscount,
      tax           : pricing.tax,
      shipping      : pricing.shipping,
      grandTotal    : pricing.grandTotal,
    },
    couponCode,
    paymentMethod: 'COD',
    paymentStatus: 'pending',
    orderStatus  : 'confirmed',
  });

  if (couponCode) await recordCouponUsage(couponCode, userId);
  await clearCartAndCoupon(cart, session);

  return { orderId: order._id, orderNumber: order.orderNumber };
};

// ── Wallet payment ────────────────────────────────────────────────────────

export const placeOrderWithWallet = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'),                                                        { status: 400 });
  if (!cartIsValid(cart))          throw Object.assign(new Error('Some items are no longer available. Please review your cart.'),               { status: 400 });

  const orderItems      = await buildOrderItemsAndValidate(cart);
  const user            = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = resolveShippingAddress(user, addressId);
  const couponDiscount  = session.couponDiscount || 0;
  const couponCode      = session.couponCode     || null;
  const pricing         = buildPriceSummary(cart, couponDiscount);

  // Check wallet balance BEFORE doing anything irreversible
  const wallet = await Wallet.getOrCreate(userId);
  if (wallet.balance < pricing.grandTotal) {
    throw Object.assign(
      new Error(
        `Insufficient wallet balance. ` +
        `Available: ₹${wallet.balance.toLocaleString('en-IN')}, ` +
        `Required: ₹${pricing.grandTotal.toLocaleString('en-IN')}.`
      ),
      { status: 400 }
    );
  }

  // Decrement stock
  for (const item of cart.items) await decrementStockAndBroadcast(item);

  // Create order
  const order = await Order.create({
    user        : userId,
    items       : orderItems,
    shippingAddress: {
      fullName: shippingAddress.fullName || user.name,
      phone   : shippingAddress.phone    || user.phone || '',
      line1   : shippingAddress.line1    || 'N/A',
      city    : shippingAddress.city     || '',
      state   : shippingAddress.state    || '',
      pincode : shippingAddress.pincode  || '',
    },
    pricing: {
      subtotal      : pricing.subtotal,
      itemDiscount  : pricing.itemDiscount,
      couponDiscount: pricing.couponDiscount,
      tax           : pricing.tax,
      shipping      : pricing.shipping,
      grandTotal    : pricing.grandTotal,
    },
    couponCode,
    paymentMethod: 'Wallet',
    paymentStatus: 'paid',
    orderStatus  : 'confirmed',
  });

  // Debit wallet
  await wallet.debit(
    pricing.grandTotal,
    `Payment for order ${order.orderNumber}`,
    'order_payment',
    order
  );

  if (couponCode) await recordCouponUsage(couponCode, userId);
  await clearCartAndCoupon(cart, session);

  return { orderId: order._id, orderNumber: order.orderNumber };
};

// ── Razorpay ──────────────────────────────────────────────────────────────

export const createRazorpayCheckoutOrder = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'),                                                        { status: 400 });
  if (!cartIsValid(cart))          throw Object.assign(new Error('Some items are no longer available. Please review your cart.'),               { status: 400 });

  const orderItems      = await buildOrderItemsAndValidate(cart);
  const user            = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = resolveShippingAddress(user, addressId);
  const couponDiscount  = session.couponDiscount || 0;
  const couponCode      = session.couponCode     || null;
  const pricing         = buildPriceSummary(cart, couponDiscount);

  const order = await Order.create({
    user        : userId,
    items       : orderItems,
    shippingAddress: {
      fullName: shippingAddress.fullName || user.name,
      phone   : shippingAddress.phone    || user.phone || '',
      line1   : shippingAddress.line1    || 'N/A',
      city    : shippingAddress.city     || '',
      state   : shippingAddress.state    || '',
      pincode : shippingAddress.pincode  || '',
    },
    pricing: {
      subtotal      : pricing.subtotal,
      itemDiscount  : pricing.itemDiscount,
      couponDiscount: pricing.couponDiscount,
      tax           : pricing.tax,
      shipping      : pricing.shipping,
      grandTotal    : pricing.grandTotal,
    },
    couponCode,
    paymentMethod: 'Razorpay',
    paymentStatus: 'pending',
    orderStatus  : 'confirmed',
  });

  const razorpayOrder = await createRazorpayOrder(pricing.grandTotal, order.orderNumber);

  order.razorpayOrderId = razorpayOrder.id;
  await order.save();

  return {
    orderId        : order._id,
    orderNumber    : order.orderNumber,
    razorpayOrderId: razorpayOrder.id,
    amount         : razorpayOrder.amount,
    currency       : razorpayOrder.currency,
    keyId          : process.env.RAZORPAY_KEY_ID,
    prefill        : { name: user.name, email: user.email, contact: user.phone || '' },
  };
};

export const verifyRazorpayCheckoutPayment = async (userId, {
  orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature, session,
}) => {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const isValid = verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });

  if (!isValid) {
    order.paymentStatus        = 'failed';
    order.paymentFailureReason = 'Signature verification failed.';
    await order.save();
    throw Object.assign(new Error('Payment verification failed.'), {
      status: 400, orderId: order._id, orderNumber: order.orderNumber,
    });
  }

  order.paymentStatus     = 'paid';
  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpaySignature = razorpaySignature;
  await order.save();

  const cart = await getPopulatedCart(userId);
  if (cart && cart.items.length) {
    for (const item of cart.items) await decrementStockAndBroadcast(item);
    await clearCartAndCoupon(cart, session);
  }

  if (order.couponCode) await recordCouponUsage(order.couponCode, userId);

  return { orderId: order._id, orderNumber: order.orderNumber };
};

export const markRazorpayPaymentFailed = async (userId, { orderId, reason }) => {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  order.paymentStatus        = 'failed';
  order.paymentFailureReason = reason || 'Payment was not completed.';
  await order.save();

  return { orderId: order._id, orderNumber: order.orderNumber };
};

export const retryRazorpayPayment = async (userId, { orderId }) => {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (order.paymentStatus !== 'failed') {
    throw Object.assign(new Error('Only failed payments can be retried.'), { status: 400 });
  }

  const user          = await User.findById(userId).select('name email phone');
  const razorpayOrder = await createRazorpayOrder(order.pricing.grandTotal, order.orderNumber);

  order.razorpayOrderId      = razorpayOrder.id;
  order.paymentStatus        = 'pending';
  order.paymentFailureReason = '';
  await order.save();

  return {
    orderId        : order._id,
    orderNumber    : order.orderNumber,
    razorpayOrderId: razorpayOrder.id,
    amount         : razorpayOrder.amount,
    currency       : razorpayOrder.currency,
    keyId          : process.env.RAZORPAY_KEY_ID,
    prefill        : { name: user.name, email: user.email, contact: user.phone || '' },
  };
};

// ── Success / Failure page data ───────────────────────────────────────────

export const getOrderSuccess = async (orderId, userId) => {
  const order = await Order.findById(orderId)
    .select('user orderNumber orderStatus paymentMethod paymentStatus createdAt pricing shippingAddress items couponCode')
    .lean();

  if (!order || String(order.user) !== String(userId))
    throw Object.assign(new Error('Not found'), { status: 302 });

  return order;
};

export const getOrderFailure = async (orderId, userId) => {
  const order = await Order.findById(orderId)
    .select('user orderNumber orderStatus paymentMethod paymentStatus paymentFailureReason createdAt pricing razorpayOrderId')
    .lean();

  if (!order || String(order.user) !== String(userId))
    throw Object.assign(new Error('Not found'), { status: 302 });

  return order;
};