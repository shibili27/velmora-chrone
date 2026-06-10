import Cart    from '../models/cart.js';
import Product from '../models/product.js';

export const MAX_QTY = 5;

export const getValidProduct = async (productId) => {
  const product = await Product.findById(productId)
    .populate('category', 'name isBlocked')
    .populate('brand', 'name')
    .lean();

  if (!product)                    throw Object.assign(new Error('Product not found'), { status: 404 });
  if (product.isDeleted)           throw Object.assign(new Error('This product is no longer available'), { status: 403 });
  if (!product.isListed)           throw Object.assign(new Error('This product is currently unavailable'), { status: 403 });
  if (product.category?.isBlocked) throw Object.assign(new Error('This category is no longer available'), { status: 403 });
  if (product.stock === 0)         throw Object.assign(new Error('This product is out of stock'), { status: 400 });
  return product;
};

export const getCleanCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId }).populate({
    path   : 'items.product',
    populate: [
      { path: 'category', select: 'name isBlocked' },
      { path: 'brand',    select: 'name' },
    ],
  });

  if (!cart) return null;

  const validItems = cart.items.filter(item => {
    const p = item.product;
    return p && !p.isDeleted && p.isListed && !p.category?.isBlocked && p.stock > 0;
  });

  let modified = validItems.length !== cart.items.length;
  cart.items   = validItems;

  for (const item of cart.items) {
    if (item.quantity > item.product.stock) { item.quantity = item.product.stock; modified = true; }
    if (item.quantity > MAX_QTY)            { item.quantity = MAX_QTY;            modified = true; }
  }

  if (modified) await cart.save();
  return cart;
};

export const addItemToCart = async (userId, productId, quantity) => {
  const qty     = Math.max(1, parseInt(quantity, 10) || 1);
  const product = await getValidProduct(productId);

  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });

  const existingIndex = cart.items.findIndex(i => i.product.toString() === productId);

  if (existingIndex > -1) {
    const newQty = cart.items[existingIndex].quantity + qty;
    if (newQty > product.stock) throw Object.assign(new Error(`Only ${product.stock} unit(s) available. You already have ${cart.items[existingIndex].quantity} in your cart.`), { status: 400 });
    if (newQty > MAX_QTY)       throw Object.assign(new Error(`Maximum ${MAX_QTY} units allowed per item.`), { status: 400 });
    cart.items[existingIndex].quantity = newQty;
    cart.items[existingIndex].price    = product.price;
  } else {
    if (qty > product.stock) throw Object.assign(new Error(`Only ${product.stock} unit(s) in stock.`), { status: 400 });
    if (qty > MAX_QTY)       throw Object.assign(new Error(`Maximum ${MAX_QTY} units allowed per item.`), { status: 400 });
    cart.items.push({ product: productId, quantity: qty, price: product.price });
  }

  await cart.save();
  return cart.items.reduce((s, i) => s + i.quantity, 0);
};

export const updateItem = async (userId, itemId, action) => {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) throw Object.assign(new Error('Cart not found'), { status: 404 });

  const itemIndex = cart.items.findIndex(i => i._id.toString() === itemId);
  if (itemIndex === -1) throw Object.assign(new Error('Item not found in cart'), { status: 404 });

  const item    = cart.items[itemIndex];
  const product = item.product;

  if (!product || product.isDeleted || !product.isListed) {
    cart.items.splice(itemIndex, 1);
    await cart.save();
    throw Object.assign(new Error('Product is no longer available and has been removed from your cart.'), { status: 403, removed: true });
  }

  let newQty = item.quantity;
  if (action === 'inc') newQty += 1;
  if (action === 'dec') newQty -= 1;

  if (newQty <= 0) {
    cart.items.splice(itemIndex, 1);
    await cart.save();
    return {
      removed  : true,
      cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
      subtotal : cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
    };
  }

  if (newQty > product.stock) throw Object.assign(new Error(`Only ${product.stock} unit(s) available.`), { status: 400, maxStock: product.stock });
  if (newQty > MAX_QTY)       throw Object.assign(new Error(`Maximum ${MAX_QTY} units allowed per item.`), { status: 400, maxQty: MAX_QTY });

  cart.items[itemIndex].quantity = newQty;
  await cart.save();

  return {
    removed  : false,
    quantity : newQty,
    itemTotal: item.price * newQty,
    subtotal : cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
    cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
  };
};

export const removeItem = async (userId, itemId) => {
  const cart = await Cart.findOne({ user: userId });
  if (!cart) throw Object.assign(new Error('Cart not found'), { status: 404 });

  const before = cart.items.length;
  cart.items   = cart.items.filter(i => i._id.toString() !== itemId);
  if (cart.items.length === before) throw Object.assign(new Error('Item not found'), { status: 404 });

  await cart.save();
  return {
    subtotal : cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
    cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
  };
};

export const clearUserCart = async (userId) => {
  await Cart.findOneAndUpdate({ user: userId }, { items: [] });
};

export const getCartCount = async (userId) => {
  if (!userId) return 0;
  const cart = await Cart.findOne({ user: userId }).select('items');
  return cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
};