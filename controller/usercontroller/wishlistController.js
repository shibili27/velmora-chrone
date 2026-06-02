import Wishlist from '../../models/wishlist.js';
import Cart from '../../models/cart.js';
import Product from '../../models/product.js';

const POPULATE_ITEMS = {
  path    : 'items.product',
  populate: [
    { path: 'brand',    select: 'name' },
    { path: 'category', select: 'name' },
  ],
};

export const getWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id }).populate(POPULATE_ITEMS);
    const wishlistItems = wishlist ? wishlist.items : [];

    const cartDoc = await Cart.findOne({ user: req.user._id }).select('items.product');
    const cartProductIds = cartDoc ? cartDoc.items.map(i => i.product.toString()) : [];

    res.render('user/wishlist', { wishlistItems, cartProductIds });
  } catch (err) {
    console.error('[wishlist] getWishlist:', err);
    res.status(500).render('error', { message: 'Failed to load wishlist.' });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: 'productId is required.' });

    const product = await Product.findOne({ _id: productId, isDeleted: false, isListed: true });
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    let wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) wishlist = new Wishlist({ user: req.user._id, items: [] });

    const alreadyIn = wishlist.items.some(i => i.product.toString() === productId);
    if (!alreadyIn) {
      wishlist.items.push({ product: productId });
      await wishlist.save();
    }

    res.json({ message: 'Added to wishlist.', wishlisted: true, wishlistCount: wishlist.items.length });
  } catch (err) {
    console.error('[wishlist] addToWishlist:', err);
    res.status(500).json({ message: 'Failed to add to wishlist.' });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) return res.status(404).json({ message: 'Wishlist not found.' });

    const before = wishlist.items.length;
    wishlist.items = wishlist.items.filter(i => i._id.toString() !== req.params.itemId);
    if (wishlist.items.length === before) return res.status(404).json({ message: 'Item not found.' });

    await wishlist.save();
    res.json({ message: 'Removed from wishlist.', wishlistCount: wishlist.items.length });
  } catch (err) {
    console.error('[wishlist] removeFromWishlist:', err);
    res.status(500).json({ message: 'Failed to remove item.' });
  }
};

export const removeFromWishlistByProduct = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) return res.status(404).json({ message: 'Wishlist not found.' });

    const before = wishlist.items.length;
    wishlist.items = wishlist.items.filter(i => i.product.toString() !== req.params.productId);
    if (wishlist.items.length === before) return res.status(404).json({ message: 'Item not found.' });

    await wishlist.save();
    res.json({ message: 'Removed from wishlist.', wishlisted: false, wishlistCount: wishlist.items.length });
  } catch (err) {
    console.error('[wishlist] removeFromWishlistByProduct:', err);
    res.status(500).json({ message: 'Failed to remove item.' });
  }
};

export const checkInWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id }).select('items.product');
    const wishlisted = wishlist
      ? wishlist.items.some(i => i.product.toString() === req.params.productId)
      : false;
    res.json({ wishlisted });
  } catch (err) {
    console.error('[wishlist] checkInWishlist:', err);
    res.status(500).json({ wishlisted: false });
  }
};

export const getWishlistStatus = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id }).select('items.product');
    const wishlisted = wishlist
      ? wishlist.items.some(i => i.product.toString() === req.params.productId)
      : false;
    res.json({ wishlisted });
  } catch (err) {
    console.error('[wishlist] getWishlistStatus:', err);
    res.status(500).json({ wishlisted: false });
  }
};

export const getWishlistCount = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id }).select('items');
    res.json({ count: wishlist ? wishlist.items.length : 0 });
  } catch (err) {
    console.error('[wishlist] getWishlistCount:', err);
    res.status(500).json({ count: 0 });
  }
};

export const toggleWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: 'productId is required.' });

    let wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) wishlist = new Wishlist({ user: req.user._id, items: [] });

    const idx = wishlist.items.findIndex(i => i.product.toString() === productId);

    if (idx !== -1) {
      wishlist.items.splice(idx, 1);
      await wishlist.save();
      return res.json({ message: 'Removed from wishlist.', wishlisted: false, wishlistCount: wishlist.items.length });
    }

    const product = await Product.findOne({ _id: productId, isDeleted: false, isListed: true });
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    wishlist.items.push({ product: productId });
    await wishlist.save();
    return res.json({ message: 'Added to wishlist.', wishlisted: true, wishlistCount: wishlist.items.length });
  } catch (err) {
    console.error('[wishlist] toggleWishlist:', err);
    res.status(500).json({ message: 'Failed to update wishlist.' });
  }
};

export const moveToCart = async (req, res) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ message: 'itemId is required.' });

    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) return res.status(404).json({ message: 'Wishlist not found.' });

    const wishItem = wishlist.items.id(itemId);
    if (!wishItem) return res.status(404).json({ message: 'Wishlist item not found.' });

    const product = await Product.findById(wishItem.product).select('stock isDeleted isListed price');
    if (!product || product.isDeleted || !product.isListed) {
      return res.status(410).json({ message: 'This product is no longer available.' });
    }
    if (product.stock < 1) {
      return res.status(409).json({ message: 'This product is currently out of stock.' });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = new Cart({ user: req.user._id, items: [] });

    const alreadyInCart = cart.items.some(i => i.product.toString() === product._id.toString());
    if (!alreadyInCart) {
      cart.items.push({ product: product._id, quantity: 1, price: product.price });
      await cart.save();
    }

    wishlist.items = wishlist.items.filter(i => i._id.toString() !== itemId);
    await wishlist.save();

    res.json({
      message      : 'Moved to cart.',
      cartCount    : cart.items.length,
      wishlistCount: wishlist.items.length,
    });
  } catch (err) {
    console.error('[wishlist] moveToCart:', err);
    res.status(500).json({ message: 'Failed to move item to cart.' });
  }
};

export const clearWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id });
    if (!wishlist) return res.json({ message: 'Wishlist already empty.', wishlistCount: 0 });

    wishlist.items = [];
    await wishlist.save();

    res.json({ message: 'Wishlist cleared.', wishlistCount: 0 });
  } catch (err) {
    console.error('[wishlist] clearWishlist:', err);
    res.status(500).json({ message: 'Failed to clear wishlist.' });
  }
};