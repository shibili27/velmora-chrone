import Cart    from '../models/cart.js';
import Order   from '../models/order.js';
import User    from '../models/user.js';
import Product from '../models/product.js';
import Coupon  from '../models/coupon.js';
import Wallet  from '../models/wallet.js';
import { broadcast } from '../public/utils/ssemanager.js';
import { getIO } from '../utils/socket.js';
import { createRazorpayOrder, verifyPaymentSignature } from './razorpayService.js';
import { rewardReferralIfEligible } from './referralService.js';

const TAX_RATE            = 0.18;
export const SHIPPING_THRESHOLD = 50000;

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
  return cart.items.every(({ product: p, quantity, variantName }) => {
    if (!p || p.isDeleted || p.isListed === false || p.category?.isBlocked) return false;

    let availableStock;
    if (p.colorVariants?.length > 0 && variantName) {
      const variant  = p.colorVariants.find(v => v.name === variantName);
      availableStock = variant ? variant.stock : 0;
    } else {
      availableStock = p.stock;
    }

    return availableStock > 0 && quantity <= availableStock;
  });
};

export const buildPriceSummary = (cart, couponDiscount = 0) => {
  let subtotal = 0, totalDiscount = 0;

  for (const item of cart.items) {
    const mrp = item.product.mrp || item.product.price || item.price;
    subtotal  += item.price * item.quantity;
    if (mrp > item.price) totalDiscount += (mrp - item.price) * item.quantity;
  }

  const cappedCouponDiscount = Math.min(Math.round(couponDiscount), Math.round(subtotal));

  const afterDiscount = subtotal - cappedCouponDiscount;
  const tax           = Math.round(afterDiscount * TAX_RATE);
  const shipping      = afterDiscount >= SHIPPING_THRESHOLD ? 0 : 99;
  const grandTotal    = Math.max(Math.round(afterDiscount + tax + shipping), 0);

  return {
    subtotal       : Math.round(subtotal),
    itemDiscount   : Math.round(totalDiscount),
    couponDiscount : cappedCouponDiscount,
    totalDiscount  : Math.round(totalDiscount + cappedCouponDiscount),
    tax,
    taxRate        : TAX_RATE * 100,
    shipping,
    grandTotal,
    isFreeShipping : shipping === 0,
  };
};

export const clearCouponIfCartChanged = (session) => {
  if (session.couponCode) {
    delete session.couponCode;
    delete session.couponDiscount;
  }
};

// FIXED: this is now the single source of truth for "can this cart be
// ordered right now" — it checks availability (deleted/unlisted/category
// blocked) AND stock, and produces a specific message per item. Previously,
// callers ran the generic cartIsValid() check FIRST, which threw a vague
// "some items are unavailable" error before this function (and its detailed
// stockErrors array) ever got a chance to run — so the frontend's stock
// error banner never received anything useful.
export const validateStockBeforeOrder = async (cartItems) => {
  const errors = [];

  for (const cartItem of cartItems) {
    const product     = await Product.findById(cartItem.product._id)
      .select('name stock colorVariants isDeleted isListed category')
      .populate('category', 'isBlocked');
    const variantName = cartItem.variantName || null;

    if (!product || product.isDeleted || product.isListed === false) {
      errors.push(`"${cartItem.product.name}" is no longer available.`);
      continue;
    }

    if (product.category?.isBlocked) {
      errors.push(`"${cartItem.product.name}" is currently unavailable.`);
      continue;
    }

    let availableStock = 0;
    if (product.colorVariants?.length > 0 && variantName) {
      const variant  = product.colorVariants.find(v => v.name === variantName);
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

  const userUsageCount     = coupon.getUserUsageCount(userId);
  const { valid, message } = coupon.validateFor(subtotal, userUsageCount);
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
    couponDiscount: pricing.couponDiscount,
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

export const getAvailableCoupons = async (userId, subtotal) => {
  const now = new Date();

  const coupons = await Coupon.find({
    isActive  : true,
    isDeleted : false,
    expiryDate: { $gt: now },
  }).sort({ createdAt: -1 });

  return coupons
    .filter(coupon => {
      const userUsageCount = coupon.getUserUsageCount(userId);
      const { valid }      = coupon.validateFor(subtotal, userUsageCount);
      return valid;
    })
    .map(coupon => ({
      code          : coupon.code,
      description   : coupon.description,
      discountType  : coupon.discountType,
      discountValue : coupon.discountValue,
      minOrderValue : coupon.minOrderValue,
      maxDiscountCap: coupon.maxDiscountCap,
      expiryDate    : coupon.expiryDate,
    }));
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


export const buildCheckoutData = async (userId, session) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('EMPTY_CART'), { status: 302 });

  // NOTE: still using cartIsValid here (page load, not order placement) —
  // if this throws, getCheckout redirects to /cart with a flash message.
  // Worth double-checking your cart.ejs actually renders `cartError` from
  // req.flash — if connect-flash isn't wired up, that redirect silently
  // shows nothing, which would also explain "no warning shown" for the
  // case where stock runs out BEFORE the user even reaches checkout.
  if (!cartIsValid(cart)) throw Object.assign(new Error('INVALID_CART'), { status: 302 });

  const user           = await User.findById(userId).select('name email phone addresses');
  const couponDiscount = session.couponDiscount || 0;
  const couponCode     = session.couponCode     || null;
  const pricing        = buildPriceSummary(cart, couponDiscount);

  const wallet        = await Wallet.getOrCreate(userId);
  const walletBalance = wallet.balance;

  const availableCoupons = await getAvailableCoupons(userId, pricing.subtotal);
  const filteredCoupons  = couponCode
    ? availableCoupons.filter(c => c.code !== couponCode)
    : availableCoupons;

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

  return {
    user,
    addresses     : user.addresses || [],
    items,
    pricing,
    couponCode,
    walletBalance,
    availableCoupons: filteredCoupons,
  };
};


// FIXED: this is now the ONLY availability/stock check before order
// placement — cartIsValid() is no longer called first, so its generic
// error can't shadow this function's detailed stockErrors[] anymore.
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


export const placeOrder = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'), { status: 400 });

  // REMOVED: the old `if (!cartIsValid(cart)) throw ...` generic check that
  // used to run here. It's gone — buildOrderItemsAndValidate below now
  // handles ALL availability/stock validation and returns a real
  // stockErrors[] array your frontend can actually display.
  const orderItems      = await buildOrderItemsAndValidate(cart);
  const user            = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = resolveShippingAddress(user, addressId);
  const couponDiscount  = session.couponDiscount || 0;
  const couponCode      = session.couponCode     || null;
  const pricing         = buildPriceSummary(cart, couponDiscount);

  for (const item of cart.items) await decrementStockAndBroadcast(item);

  const order = await Order.create({
    user           : userId,
    items          : orderItems,
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
  await rewardReferralIfEligible(userId);
  await clearCartAndCoupon(cart, session);

  return { orderId: order._id, orderNumber: order.orderNumber };
};


export const placeOrderWithWallet = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'), { status: 400 });

  // REMOVED: same generic cartIsValid() shadow-check as placeOrder above.
  const orderItems      = await buildOrderItemsAndValidate(cart);
  const user            = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = resolveShippingAddress(user, addressId);
  const couponDiscount  = session.couponDiscount || 0;
  const couponCode      = session.couponCode     || null;
  const pricing         = buildPriceSummary(cart, couponDiscount);

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

  for (const item of cart.items) await decrementStockAndBroadcast(item);

  const order = await Order.create({
    user           : userId,
    items          : orderItems,
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

  await wallet.debit(
    pricing.grandTotal,
    `Payment for order ${order.orderNumber}`,
    'order_payment',
    order
  );

  if (couponCode) await recordCouponUsage(couponCode, userId);
  await rewardReferralIfEligible(userId);
  await clearCartAndCoupon(cart, session);

  return { orderId: order._id, orderNumber: order.orderNumber };
};


export const createRazorpayCheckoutOrder = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'), { status: 400 });

  // REMOVED: same generic cartIsValid() shadow-check as placeOrder above.
  const orderItems      = await buildOrderItemsAndValidate(cart);
  const user            = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = resolveShippingAddress(user, addressId);
  const couponDiscount  = session.couponDiscount || 0;
  const couponCode      = session.couponCode     || null;
  const pricing         = buildPriceSummary(cart, couponDiscount);

  const shippingAddressPayload = {
    fullName: shippingAddress.fullName || user.name,
    phone   : shippingAddress.phone    || user.phone || '',
    line1   : shippingAddress.line1    || 'N/A',
    city    : shippingAddress.city     || '',
    state   : shippingAddress.state    || '',
    pincode : shippingAddress.pincode  || '',
  };

  const pricingPayload = {
    subtotal      : pricing.subtotal,
    itemDiscount  : pricing.itemDiscount,
    couponDiscount: pricing.couponDiscount,
    tax           : pricing.tax,
    shipping      : pricing.shipping,
    grandTotal    : pricing.grandTotal,
  };

  // Reuse an existing unpaid Razorpay order for this user instead of creating
  // a brand new Order document every time checkout/pay is retried, the page
  // is reloaded, or the popup is reopened. Without this, every retry spawns
  // a duplicate order — and each one gets marked 'confirmed' at creation.
  let order = await Order.findOne({
    user         : userId,
    paymentMethod: 'Razorpay',
    orderStatus  : 'payment_pending',
    paymentStatus: 'pending',
  }).sort({ createdAt: -1 });

  if (order) {
    order.items           = orderItems;
    order.shippingAddress = shippingAddressPayload;
    order.pricing         = pricingPayload;
    order.couponCode      = couponCode;
  } else {
    order = new Order({
      user           : userId,
      items          : orderItems,
      shippingAddress: shippingAddressPayload,
      pricing        : pricingPayload,
      couponCode,
      paymentMethod: 'Razorpay',
      paymentStatus: 'pending',
      orderStatus  : 'payment_pending', // not 'confirmed' until payment is verified
    });
  }

  // Save first so a new order gets its orderNumber assigned (pre-save hook),
  // which we then use as the Razorpay receipt.
  await order.save();

  const razorpayOrder   = await createRazorpayOrder(pricing.grandTotal, order.orderNumber);
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
    order.orderStatus          = 'payment_failed';
    order.paymentFailureReason = 'Signature verification failed.';
    await order.save();
    throw Object.assign(new Error('Payment verification failed.'), {
      status: 400, orderId: order._id, orderNumber: order.orderNumber,
    });
  }

  order.paymentStatus     = 'paid';
  order.orderStatus       = 'confirmed'; // only confirmed now, after real verification
  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpaySignature = razorpaySignature;
  await order.save();

  // Notify admin dashboard now that the order is genuinely confirmed, since
  // the model's post('save') hook intentionally skips this for Razorpay
  // orders created as 'payment_pending'.
  const io = getIO();
  if (io) {
    io.to('admin-room').emit('new-order', {
      _id          : order._id,
      orderNumber  : order.orderNumber,
      grandTotal   : order.pricing.grandTotal,
      itemCount    : order.items.length,
      paymentMethod: order.paymentMethod,
      createdAt    : order.createdAt,
    });
  }

  const cart = await getPopulatedCart(userId);
  if (cart && cart.items.length) {
    for (const item of cart.items) await decrementStockAndBroadcast(item);
    await clearCartAndCoupon(cart, session);
  }

  if (order.couponCode) await recordCouponUsage(order.couponCode, userId);
  await rewardReferralIfEligible(userId);

  return { orderId: order._id, orderNumber: order.orderNumber };
};

export const markRazorpayPaymentFailed = async (userId, { orderId, reason }) => {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  order.paymentStatus        = 'failed';
  order.orderStatus          = 'payment_failed';
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
  order.orderStatus          = 'payment_pending';
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