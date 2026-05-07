import Wishlist from '../../models/wishlist.js';
import Product  from '../../models/product.js';   // adjust path if needed
import Cart     from '../../models/cart.js';       // adjust path if needed
import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────
//  Helper — get user ID from session (matches your auth pattern)
// ─────────────────────────────────────────────────────────────────
const uid = (req) => req.session?.user || req.session?.userId || req.user?._id;


// ─────────────────────────────────────────────────────────────────
//  GET /wishlist  — render wishlist page
// ─────────────────────────────────────────────────────────────────
export const getWishlist = async (req, res) => {
  try {
    const userId = uid(req);

    // Fetch wishlist with populated products
    const wishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product');

    // Fetch cart so the view knows which products are already in cart
    let cartProductIds = [];
    try {
      const cart = await Cart.findOne({ user: userId });
      if (cart && cart.items) {
        cartProductIds = cart.items.map(i => i.product.toString());
      }
    } catch (_) {
      // Cart model might be named differently — cartProductIds stays []
      cartProductIds = [];
    }

    const wishlistItems = wishlist ? wishlist.items.filter(i => i.product) : [];

    res.render('user/wishlist', {
      wishlistItems,
      cartProductIds,   // ← this is what the template needs
      title: 'My Wishlist — Velmora Chroné',
    });
  } catch (err) {
    console.error('getWishlist error:', err);
    res.status(500).send('Server error');
  }
};


// ─────────────────────────────────────────────────────────────────
//  POST /wishlist/add  — add single product
// ─────────────────────────────────────────────────────────────────
export const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.status(400).json({ message: 'Invalid product ID' });

    let wishlist = await Wishlist.findOne({ user: uid(req) });
    if (!wishlist) {
      wishlist = new Wishlist({ user: uid(req), items: [] });
    }

    const alreadyIn = wishlist.items.some(i => i.product.toString() === productId);
    if (!alreadyIn) {
      wishlist.items.push({ product: productId });
      await wishlist.save();
    }

    res.json({ success: true, count: wishlist.items.length });
  } catch (err) {
    console.error('addToWishlist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  DELETE /wishlist/remove/:itemId  — remove by wishlist item _id
// ─────────────────────────────────────────────────────────────────
export const removeFromWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: uid(req) });
    if (!wishlist) return res.status(404).json({ message: 'Wishlist not found' });

    wishlist.items = wishlist.items.filter(
      i => i._id.toString() !== req.params.itemId
    );
    await wishlist.save();

    res.json({ success: true, count: wishlist.items.length });
  } catch (err) {
    console.error('removeFromWishlist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  DELETE /wishlist/remove-product/:productId  — remove by product ID
// ─────────────────────────────────────────────────────────────────
export const removeFromWishlistByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.status(400).json({ message: 'Invalid product ID' });

    const wishlist = await Wishlist.findOne({ user: uid(req) });
    if (!wishlist) return res.status(404).json({ message: 'Wishlist not found' });

    wishlist.items = wishlist.items.filter(
      i => i.product.toString() !== productId
    );
    await wishlist.save();

    res.json({ success: true, count: wishlist.items.length });
  } catch (err) {
    console.error('removeFromWishlistByProduct error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  GET /wishlist/check/:productId  — check if product is in wishlist
// ─────────────────────────────────────────────────────────────────
export const checkInWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.json({ inWishlist: false });

    const wishlist = await Wishlist.findOne({ user: uid(req) });
    const inWishlist = wishlist
      ? wishlist.items.some(i => i.product.toString() === productId)
      : false;

    res.json({ inWishlist, count: wishlist ? wishlist.items.length : 0 });
  } catch (err) {
    console.error('checkInWishlist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  POST /wishlist/move-to-cart  — move item to cart
// ─────────────────────────────────────────────────────────────────
export const moveToCart = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.status(400).json({ message: 'Invalid product ID' });

    // Remove from wishlist
    const wishlist = await Wishlist.findOne({ user: uid(req) });
    if (wishlist) {
      wishlist.items = wishlist.items.filter(
        i => i.product.toString() !== productId
      );
      await wishlist.save();
    }

    res.json({ success: true, message: 'Moved to cart' });
  } catch (err) {
    console.error('moveToCart error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  GET /api/wishlist/count  — get total wishlist item count
// ─────────────────────────────────────────────────────────────────
export const getWishlistCount = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: uid(req) }).select('items');
    res.json({ count: wishlist ? wishlist.items.length : 0 });
  } catch (err) {
    console.error('getWishlistCount error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  GET /wishlist/status/:productId
//  Called on product page load — returns wishlist state + count
//  This is what the product detail page calls on load
// ─────────────────────────────────────────────────────────────────
export const getWishlistStatus = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.json({ wishlisted: false, count: 0 });

    const wishlist = await Wishlist.findOne({ user: uid(req) }).select('items');
    const wishlisted = wishlist
      ? wishlist.items.some(i => i.product.toString() === productId)
      : false;

    res.json({ wishlisted, count: wishlist ? wishlist.items.length : 0 });
  } catch (err) {
    console.error('getWishlistStatus error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────
//  POST /wishlist/toggle
//  Adds if not present, removes if already there
//  This is what the heart button on the product detail page calls
// ─────────────────────────────────────────────────────────────────
export const toggleWishlist = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId || !mongoose.Types.ObjectId.isValid(productId))
      return res.status(400).json({ message: 'Invalid product ID' });

    // Find or create the wishlist document for this user
    let wishlist = await Wishlist.findOne({ user: uid(req) });
    if (!wishlist) {
      wishlist = new Wishlist({ user: uid(req), items: [] });
    }

    const idx = wishlist.items.findIndex(
      i => i.product.toString() === productId
    );

    let wishlisted;
    if (idx === -1) {
      // Not in wishlist — add it
      wishlist.items.push({ product: productId });
      wishlisted = true;
    } else {
      // Already in wishlist — remove it
      wishlist.items.splice(idx, 1);
      wishlisted = false;
    }

    await wishlist.save();

    res.json({
      wishlisted,
      count: wishlist.items.length,
    });
  } catch (err) {
    console.error('toggleWishlist error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};