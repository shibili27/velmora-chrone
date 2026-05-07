import Wishlist from '../../models/wishlist.js';
 import Cart     from '../../models/cart.js';   
import mongoose from 'mongoose';


const uid = (req) => req.session?.user || req.session?.userId || req.user?._id;



export const getWishlist = async (req, res) => {
  try {
    const userId = uid(req);

    
    const wishlist = await Wishlist.findOne({ user: userId })
      .populate('items.product');

    
    let cartProductIds = [];
    try {
      const cart = await Cart.findOne({ user: userId });
      if (cart && cart.items) {
        cartProductIds = cart.items.map(i => i.product.toString());
      }
    } catch (_) {
      
      cartProductIds = [];
    }

    const wishlistItems = wishlist ? wishlist.items.filter(i => i.product) : [];

    res.render('user/wishlist', {
      wishlistItems,
      cartProductIds,   
      title: 'My Wishlist — Velmora Chroné',
    });
  } catch (err) {
    console.error('getWishlist error:', err);
    res.status(500).send('Server error');
  }
};


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



export const moveToCart = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.status(400).json({ message: 'Invalid product ID' });

    
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



export const getWishlistCount = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: uid(req) }).select('items');
    res.json({ count: wishlist ? wishlist.items.length : 0 });
  } catch (err) {
    console.error('getWishlistCount error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};



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



export const toggleWishlist = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId || !mongoose.Types.ObjectId.isValid(productId))
      return res.status(400).json({ message: 'Invalid product ID' });

    
    let wishlist = await Wishlist.findOne({ user: uid(req) });
    if (!wishlist) {
      wishlist = new Wishlist({ user: uid(req), items: [] });
    }

    const idx = wishlist.items.findIndex(
      i => i.product.toString() === productId
    );

    let wishlisted;
    if (idx === -1) {
      
      wishlist.items.push({ product: productId });
      wishlisted = true;
    } else {
      
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