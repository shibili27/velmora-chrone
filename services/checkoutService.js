import Cart    from '../models/cart.js';
import Order   from '../models/order.js';
import User    from '../models/user.js';
import Product from '../models/product.js';
import { broadcast } from '../public/utils/ssemanager.js';

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

// restock
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
    stock: broadcastStock,
    price: product.price,
    isListed: product.isListed !== false,
    isDeleted: product.isDeleted || false,
    colorVariants: (product.colorVariants || []).map(v => ({ name: v.name, hex: v.hex, stock: v.stock })),
  });
};

export const buildCheckoutData = async (userId, session) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('EMPTY_CART'), { status: 302 });
  if (!cartIsValid(cart))          throw Object.assign(new Error('INVALID_CART'), { status: 302 });

  const user           = await User.findById(userId).select('name email phone addresses');
  const couponDiscount = session.couponDiscount || 0;
  const couponCode     = session.couponCode     || null;
  const pricing        = buildPriceSummary(cart, couponDiscount);

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

  return { user, addresses: user.addresses || [], items, pricing, couponCode };
};

export const placeOrder = async (userId, { addressId, session }) => {
  const cart = await getPopulatedCart(userId);
  if (!cart || !cart.items.length) throw Object.assign(new Error('Your cart is empty.'), { status: 400 });
  if (!cartIsValid(cart))          throw Object.assign(new Error('Some items are no longer available. Please review your cart.'), { status: 400 });

  const user = await User.findById(userId).select('name email phone addresses');
  const shippingAddress = addressId
    ? user.addresses?.id(addressId)
    : user.addresses?.find(a => a.isDefault) || user.addresses?.[0];

  if (!shippingAddress) throw Object.assign(new Error('Please select a delivery address.'), { status: 400 });

  const couponDiscount = session.couponDiscount || 0;
  const pricing        = buildPriceSummary(cart, couponDiscount);

  const orderItems = cart.items.map(item => ({
    product    : item.product._id,
    name       : item.product.name,
    brand      : item.product.brand?.name || '',
    image      : item.product.images?.[0] || '',
    variantName: item.variantName || null,
    quantity   : item.quantity,
    price      : item.price,
    totalPrice : item.price * item.quantity,
  }));

  for (const item of cart.items) await decrementStockAndBroadcast(item);

  const order = await Order.create({
    user        : userId,
    orderNumber : `VC-${Date.now().toString().slice(-8)}`,
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
    paymentMethod: 'COD',
    orderStatus  : 'confirmed',
  });

  cart.items = [];
  await cart.save();
  delete session.couponDiscount;
  delete session.couponCode;

  return { orderId: order._id, orderNumber: order.orderNumber };
};

export const getOrderSuccess = async (orderId, userId) => {
  const order = await Order.findById(orderId)
    .select('user orderNumber orderStatus paymentMethod createdAt pricing shippingAddress items')
    .lean();

  if (!order || String(order.user) !== String(userId))
    throw Object.assign(new Error('Not found'), { status: 302 });

  return order;
};