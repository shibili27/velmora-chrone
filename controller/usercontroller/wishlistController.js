import * as wishlistService from '../../services/wishlistService.js';

export const getWishlist = async (req, res) => {
  try {
    const { wishlistItems, cartProductIds } = await wishlistService.getWishlistWithCartStatus(req.user._id);
    res.render('user/wishlist', { wishlistItems, cartProductIds });
  } catch (err) {
    console.error('[wishlist] getWishlist:', err);
    res.status(500).render('error', { message: 'Failed to load wishlist.' });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const result = await wishlistService.addToWishlist(req.user._id, req.body.productId);
    res.json({ message: 'Added to wishlist.', ...result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const result = await wishlistService.removeByItemId(req.user._id, req.params.itemId);
    res.json({ message: 'Removed from wishlist.', ...result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const removeFromWishlistByProduct = async (req, res) => {
  try {
    const result = await wishlistService.removeByProductId(req.user._id, req.params.productId);
    res.json({ message: 'Removed from wishlist.', ...result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const checkInWishlist = async (req, res) => {
  try {
    const wishlisted = await wishlistService.checkWishlisted(req.user._id, req.params.productId);
    res.json({ wishlisted });
  } catch (err) {
    res.status(500).json({ wishlisted: false });
  }
};

export const getWishlistStatus = async (req, res) => {
  try {
    const wishlisted = await wishlistService.checkWishlisted(req.user._id, req.params.productId);
    res.json({ wishlisted });
  } catch (err) {
    res.status(500).json({ wishlisted: false });
  }
};

export const getWishlistCount = async (req, res) => {
  try {
    const count = await wishlistService.getWishlistCount(req.user._id);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ count: 0 });
  }
};

export const toggleWishlist = async (req, res) => {
  try {
    const result = await wishlistService.toggleWishlist(req.user._id, req.body.productId);
    res.json({ message: result.wishlisted ? 'Added to wishlist.' : 'Removed from wishlist.', ...result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const moveToCart = async (req, res) => {
  try {
    const result = await wishlistService.moveItemToCart(req.user._id, req.body.itemId);
    res.json({ message: 'Moved to cart.', ...result });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const clearWishlist = async (req, res) => {
  try {
    const result = await wishlistService.clearWishlist(req.user._id);
    res.json({ message: 'Wishlist cleared.', ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};