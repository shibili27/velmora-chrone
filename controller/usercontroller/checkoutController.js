import Cart    from '../../models/cart.js';
import Order   from '../../models/order.js';
import User    from '../../models/user.js';
import Product from '../../models/product.js';
import { broadcast } from '../../public/utils/ssemanager.js';


async function getPopulatedCart(userId) {
  return Cart.findOne({ user: userId }).populate({
    path: 'items.product',
    populate: [
      { path: 'brand',    select: 'name' },
      { path: 'category', select: 'name isBlocked' },
    ],
  });
}

function cartIsValid(cart) {
  if (!cart || !cart.items.length) return false;
  return cart.items.every((item) => {
    const p = item.product;
    return (
      p &&
      !p.isDeleted &&
      p.isListed !== false &&
      !p.category?.isBlocked &&
      p.stock > 0 &&
      item.quantity <= p.stock
    );
  });
}

function buildPriceSummary(cart, couponDiscount = 0) {
  let subtotal      = 0;
  let totalDiscount = 0;
  const TAX_RATE           = 0.18;
  const SHIPPING_THRESHOLD = 50000;

  for (const item of cart.items) {
    const p         = item.product;
    const unitPrice = item.price;
    const mrp       = p.mrp || p.price || unitPrice;
    subtotal       += unitPrice * item.quantity;
    if (mrp > unitPrice) {
      totalDiscount += (mrp - unitPrice) * item.quantity;
    }
  }

  const afterDiscount = subtotal - couponDiscount;
  const tax           = Math.round(afterDiscount * TAX_RATE);
  const shipping      = afterDiscount >= SHIPPING_THRESHOLD ? 0 : 99;
  const grandTotal    = afterDiscount + tax + shipping;

  return {
    subtotal:       Math.round(subtotal),
    itemDiscount:   Math.round(totalDiscount),
    couponDiscount: Math.round(couponDiscount),
    totalDiscount:  Math.round(totalDiscount + couponDiscount),
    tax,
    taxRate:        TAX_RATE * 100,
    shipping,
    grandTotal:     Math.round(grandTotal),
    isFreeShipping: shipping === 0,
  };
}


async function decrementStockAndBroadcast(cartItem) {
  const productId   = cartItem.product._id;
  const qty         = cartItem.quantity;
  const variantName = cartItem.variantName || null;

  const product = await Product.findById(productId).select(
    'stock colorVariants isListed isDeleted price'
  );
  if (!product) return;

  let broadcastStock = 0;

  if (product.colorVariants && product.colorVariants.length > 0) {
  
    product.colorVariants.forEach((v) => {
      if (!variantName || v.name === variantName) {
        v.stock = Math.max(0, (v.stock || 0) - qty);
      }
    });
    product.stock = product.colorVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
    await product.save();
    broadcastStock = product.stock;

  } else {
  
    let updated = await Product.findByIdAndUpdate(
      productId,
      { $inc: { stock: -qty } },
      { new: true, select: 'stock colorVariants isListed isDeleted price' }
    );

    if (updated && updated.stock < 0) {
      updated = await Product.findByIdAndUpdate(
        productId,
        { $set: { stock: 0 } },
        { new: true, select: 'stock colorVariants isListed isDeleted price' }
      );
    }

    broadcastStock    = updated ? updated.stock : 0;
    if (updated) product.stock = updated.stock;
  }

  broadcast('productUpdate', {
    productId    : String(productId),
    stock        : broadcastStock,
    price        : product.price,
    isListed     : product.isListed  !== false,
    isDeleted    : product.isDeleted || false,
    colorVariants: (product.colorVariants || []).map((v) => ({
      name : v.name,
      hex  : v.hex,
      stock: v.stock,
    })),
  });
}


export async function restoreStockAndBroadcast(productId, qty, variantName = null) {
  const product = await Product.findById(productId).select(
    'stock colorVariants isListed isDeleted price'
  );
  if (!product) return;

  let broadcastStock = 0;

  if (product.colorVariants && product.colorVariants.length > 0) {
    product.colorVariants.forEach((v) => {
      if (!variantName || v.name === variantName) {
        v.stock = (v.stock || 0) + qty;
      }
    });
    product.stock = product.colorVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
    await product.save();
    broadcastStock = product.stock;

  } else {
    const updated = await Product.findByIdAndUpdate(
      productId,
      { $inc: { stock: qty } },
      { new: true, select: 'stock colorVariants isListed isDeleted price' }
    );
    broadcastStock    = updated ? updated.stock : 0;
    if (updated) product.stock = updated.stock;
  }

  broadcast('productUpdate', {
    productId    : String(productId),
    stock        : broadcastStock,
    price        : product.price,
    isListed     : product.isListed  !== false,
    isDeleted    : product.isDeleted || false,
    colorVariants: (product.colorVariants || []).map((v) => ({
      name : v.name,
      hex  : v.hex,
      stock: v.stock,
    })),
  });
}


export async function getCheckout(req, res) {
  try {
    const userId = req.session.user;

    const cart = await getPopulatedCart(userId);
    if (!cart || !cart.items.length) return res.redirect('/cart');

    if (!cartIsValid(cart)) {
      req.flash?.('cartError', 'Some items in your cart are unavailable. Please review your cart.');
      return res.redirect('/cart');
    }

    const user           = await User.findById(userId).select('name email phone addresses');
    const couponDiscount = req.session.couponDiscount || 0;
    const couponCode     = req.session.couponCode     || null;
    const pricing        = buildPriceSummary(cart, couponDiscount);

    const items = cart.items.map((item) => {
      const p               = item.product;
      const mrp             = p.mrp || p.price || item.price;
      const discountPercent = mrp > item.price
        ? Math.round(((mrp - item.price) / mrp) * 100)
        : 0;
      return {
        _id:             item._id,
        productId:       p._id,
        name:            p.name,
        brand:           p.brand?.name || null,
        category:        p.category?.name || null,
        image:           p.images?.[0] || null,
        quantity:        item.quantity,
        unitPrice:       item.price,
        mrp,
        discountPercent,
        itemTotal:       item.price * item.quantity,
        taxAmount:       Math.round(item.price * item.quantity * 0.18),
      };
    });

    return res.render('user/checkout', {
      user,
      addresses:     user.addresses || [],
      items,
      pricing,
      couponCode,
      paymentMethod: 'COD',
    });
  } catch (err) {
    console.error('[Checkout] getCheckout error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
}

export async function placeOrder(req, res) {
  try {
    const userId        = req.session.user;
    const { addressId } = req.body;

    const cart = await getPopulatedCart(userId);
    if (!cart || !cart.items.length) {
      return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    if (!cartIsValid(cart)) {
      return res.status(400).json({
        success: false,
        message: 'Some items are no longer available. Please review your cart.',
      });
    }

    const user = await User.findById(userId).select('name email phone addresses');
    let shippingAddress;

    if (addressId) {
      shippingAddress = user.addresses?.id(addressId);
    } else {
      shippingAddress = user.addresses?.find((a) => a.isDefault) || user.addresses?.[0];
    }

    if (!shippingAddress) {
      return res.status(400).json({ success: false, message: 'Please select a delivery address.' });
    }

    const couponDiscount = req.session.couponDiscount || 0;
    const pricing        = buildPriceSummary(cart, couponDiscount);

    const orderItems = cart.items.map((item) => ({
      product:     item.product._id,
      name:        item.product.name,
      brand:       item.product.brand?.name || '',
      image:       item.product.images?.[0] || '',
      variantName: item.variantName || null,
      quantity:    item.quantity,
      price:       item.price,
      totalPrice:  item.price * item.quantity,
    }));

   
    for (const item of cart.items) {
      await decrementStockAndBroadcast(item);
    }

    const orderNumber = `VC-${Date.now().toString().slice(-8)}`;

    const order = await Order.create({
      user:            userId,
      orderNumber,
      items:           orderItems,
      shippingAddress: {
        fullName: shippingAddress.fullName || shippingAddress.name || user.name,
        phone:    shippingAddress.phone    || user.phone || '',
        line1:    shippingAddress.line1    || shippingAddress.street || shippingAddress.addressLine || 'N/A',
        city:     shippingAddress.city     || '',
        state:    shippingAddress.state    || '',
        pincode:  shippingAddress.pincode  || shippingAddress.pin || '',
      },
      pricing: {
        subtotal:       pricing.subtotal,
        itemDiscount:   pricing.itemDiscount,
        couponDiscount: pricing.couponDiscount,
        tax:            pricing.tax,
        shipping:       pricing.shipping,
        grandTotal:     pricing.grandTotal,
      },
      paymentMethod: 'COD',
      orderStatus:   'confirmed',
    });

    cart.items = [];
    await cart.save();
    delete req.session.couponDiscount;
    delete req.session.couponCode;

    return res.status(201).json({
      success:     true,
      orderId:     order._id,
      orderNumber: order.orderNumber,
    });
  } catch (err) {
    console.error('[Checkout] placeOrder error:', err);
    return res.status(500).json({ success: false, message: 'Failed to place order. Please try again.' });
  }
}


export async function getOrderSuccess(req, res) {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.redirect('/');

    const order = await Order.findById(orderId)
      .select('user orderNumber orderStatus paymentMethod createdAt pricing shippingAddress items')
      .lean();

    if (!order || String(order.user) !== String(req.session.user)) {
      return res.redirect('/');
    }

    return res.render('user/orderSuccess', { order });
  } catch (err) {
    console.error('[Checkout] getOrderSuccess error:', err);
    res.redirect('/');
  }
}


export async function applyCoupon(req, res) {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Please enter a coupon code.' });
    }
    // TODO: query your Coupon model here
    return res.status(200).json({
      success: false,
      message: 'Coupon feature coming soon.',
    });
  } catch (err) {
    console.error('[Checkout] applyCoupon error:', err);
    return res.status(500).json({ success: false, message: 'Could not apply coupon.' });
  }
}