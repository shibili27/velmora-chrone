import Wishlist from '../models/wishlist.js';
import Cart     from '../models/cart.js';
import Product  from '../models/product.js';

const POPULATE_ITEMS = {
  path    : 'items.product',
  populate: [
    { path: 'brand',    select: 'name' },
    { path: 'category', select: 'name' },
  ],
};

export const getWishlistWithCartStatus = async (userId) => {
  const [wishlist, cartDoc] = await Promise.all([
    Wishlist.findOne({ user: userId }).populate(POPULATE_ITEMS),
    Cart.findOne({ user: userId }).select('items.product'),
  ]);

  return {
    wishlistItems  : wishlist ? wishlist.items : [],
    cartProductIds : cartDoc ? cartDoc.items.map(i => i.product.toString()) : [],
  };
};

export const addToWishlist = async (userId, productId) => {
  if (!productId) throw Object.assign(new Error('productId is required.'), { status: 400 });

  const product = await Product.findOne({ _id: productId, isDeleted: false, isListed: true });
  if (!product) throw Object.assign(new Error('Product not found.'), { status: 404 });

  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) wishlist = new Wishlist({ user: userId, items: [] });

  if (!wishlist.items.some(i => i.product.toString() === productId)) {
    wishlist.items.push({ product: productId });
    await wishlist.save();
  }

  return { wishlisted: true, wishlistCount: wishlist.items.length };
};

export const removeByItemId = async (userId, itemId) => {
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) throw Object.assign(new Error('Wishlist not found.'), { status: 404 });

  const before = wishlist.items.length;
  wishlist.items = wishlist.items.filter(i => i._id.toString() !== itemId);
  if (wishlist.items.length === before) throw Object.assign(new Error('Item not found.'), { status: 404 });

  await wishlist.save();
  return { wishlistCount: wishlist.items.length };
};

export const removeByProductId = async (userId, productId) => {
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) throw Object.assign(new Error('Wishlist not found.'), { status: 404 });

  const before = wishlist.items.length;
  wishlist.items = wishlist.items.filter(i => i.product.toString() !== productId);
  if (wishlist.items.length === before) throw Object.assign(new Error('Item not found.'), { status: 404 });

  await wishlist.save();
  return { wishlisted: false, wishlistCount: wishlist.items.length };
};

export const checkWishlisted = async (userId, productId) => {
  const wishlist = await Wishlist.findOne({ user: userId }).select('items.product');
  return wishlist ? wishlist.items.some(i => i.product.toString() === productId) : false;
};

export const getWishlistCount = async (userId) => {
  const wishlist = await Wishlist.findOne({ user: userId }).select('items');
  return wishlist ? wishlist.items.length : 0;
};

export const toggleWishlist = async (userId, productId) => {
  if (!productId) throw Object.assign(new Error('productId is required.'), { status: 400 });

  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) wishlist = new Wishlist({ user: userId, items: [] });

  const idx = wishlist.items.findIndex(i => i.product.toString() === productId);

  if (idx !== -1) {
    wishlist.items.splice(idx, 1);
    await wishlist.save();
    return { wishlisted: false, wishlistCount: wishlist.items.length };
  }

  const product = await Product.findOne({ _id: productId, isDeleted: false, isListed: true });
  if (!product) throw Object.assign(new Error('Product not found.'), { status: 404 });

  wishlist.items.push({ product: productId });
  await wishlist.save();
  return { wishlisted: true, wishlistCount: wishlist.items.length };
};

export const moveItemToCart = async (userId, itemId) => {
  if (!itemId) throw Object.assign(new Error('itemId is required.'), { status: 400 });

  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) throw Object.assign(new Error('Wishlist not found.'), { status: 404 });

  const wishItem = wishlist.items.id(itemId);
  if (!wishItem) throw Object.assign(new Error('Wishlist item not found.'), { status: 404 });

  const product = await Product.findById(wishItem.product).select('stock isDeleted isListed price');
  if (!product || product.isDeleted || !product.isListed) throw Object.assign(new Error('This product is no longer available.'), { status: 410 });
  if (product.stock < 1) throw Object.assign(new Error('This product is currently out of stock.'), { status: 409 });

  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });

  if (!cart.items.some(i => i.product.toString() === product._id.toString())) {
    cart.items.push({ product: product._id, quantity: 1, price: product.price });
    await cart.save();
  }

  wishlist.items = wishlist.items.filter(i => i._id.toString() !== itemId);
  await wishlist.save();

  return { cartCount: cart.items.length, wishlistCount: wishlist.items.length };
};

export const clearWishlist = async (userId) => {
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) return { wishlistCount: 0 };
  wishlist.items = [];
  await wishlist.save();
  return { wishlistCount: 0 };
};