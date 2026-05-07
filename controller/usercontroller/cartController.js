// controller/usercontroller/cartController.js
import Cart    from '../../models/cart.js';
import Product from '../../models/product.js';

const MAX_QTY = 5;

async function getValidProduct(productId) {
  const product = await Product.findById(productId)
    .populate('category', 'name isBlocked')
    .lean();

  if (!product)          return { error: 'Product not found',                     code: 404 };
  if (product.isDeleted) return { error: 'This product is no longer available',   code: 403 };
  if (!product.isListed) return { error: 'This product is currently unavailable', code: 403 };
  if (product.category?.isBlocked) return { error: 'This category is no longer available', code: 403 };
  if (product.stock === 0)         return { error: 'This product is out of stock',          code: 400 };

  return { product };
}

export const getCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;

    let cart = await Cart.findOne({ user: userId }).populate({
      path: 'items.product',
      populate: { path: 'category', select: 'name isBlocked' },
    });

    if (!cart) {
      cart = { items: [], totalItems: 0, subtotal: 0 };
    } else {
      // ✅ FIX 1: use isDeleted & isListed instead of isBlocked & status
      const validItems = cart.items.filter(item => {
        const p = item.product;
        return (
          p &&
          !p.isDeleted &&
          p.isListed &&
          !p.category?.isBlocked &&
          p.stock > 0
        );
      });

      if (validItems.length !== cart.items.length) {
        cart.items = validItems;
        await cart.save();
      }

      let modified = false;
      for (const item of cart.items) {
        if (item.quantity > item.product.stock) { item.quantity = item.product.stock; modified = true; }
        if (item.quantity > MAX_QTY)            { item.quantity = MAX_QTY;            modified = true; }
      }
      if (modified) await cart.save();
    }

    const canCheckout =
      cart.items?.length > 0 &&
      cart.items.every(i => i.product.stock > 0 && i.quantity <= i.product.stock);

    res.render('user/cart', { cart, canCheckout, MAX_QTY });
  } catch (err) {
    console.error('[getCart]', err);
    res.status(500).render('error', { message: 'Failed to load cart.' });
  }
};

export const addToCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    const { productId, quantity = 1 } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    const { product, error, code } = await getValidProduct(productId);
    if (error) return res.status(code).json({ success: false, message: error, blocked: code === 403 });

    let cart = await Cart.findOne({ user: userId });
    if (!cart) cart = new Cart({ user: userId, items: [] });

    const existingIndex = cart.items.findIndex(i => i.product.toString() === productId);

    if (existingIndex > -1) {
      const newQty = cart.items[existingIndex].quantity + qty;

      if (newQty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} unit(s) available. You already have ${cart.items[existingIndex].quantity} in your cart.`,
        });
      }
      if (newQty > MAX_QTY) {
        return res.status(400).json({ success: false, message: `Maximum ${MAX_QTY} units allowed per item.` });
      }

      cart.items[existingIndex].quantity = newQty;
      cart.items[existingIndex].price    = product.price;
    } else {
      if (qty > product.stock) {
        return res.status(400).json({ success: false, message: `Only ${product.stock} unit(s) in stock.` });
      }
      if (qty > MAX_QTY) {
        return res.status(400).json({ success: false, message: `Maximum ${MAX_QTY} units allowed per item.` });
      }
      cart.items.push({ product: productId, quantity: qty, price: product.price });
    }

    await cart.save();

    const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);
    res.json({ success: true, message: 'Added to cart', cartCount });
  } catch (err) {
    console.error('[addToCart]', err);
    res.status(500).json({ success: false, message: 'Failed to add to cart' });
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const userId     = req.session.user || req.user?._id;
    const { itemId } = req.params;
    const { action } = req.body;

    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    const itemIndex = cart.items.findIndex(i => i._id.toString() === itemId);
    if (itemIndex === -1) return res.status(404).json({ success: false, message: 'Item not found in cart' });

    const item    = cart.items[itemIndex];
    const product = item.product;

    // ✅ FIX 2: use isDeleted & isListed instead of isBlocked & status
    if (!product || product.isDeleted || !product.isListed) {
      cart.items.splice(itemIndex, 1);
      await cart.save();
      return res.status(403).json({
        success: false,
        message: 'Product is no longer available and has been removed from your cart.',
        removed: true,
      });
    }

    let newQty = item.quantity;
    if (action === 'inc') newQty += 1;
    if (action === 'dec') newQty -= 1;

    if (newQty <= 0) {
      cart.items.splice(itemIndex, 1);
      await cart.save();
      return res.json({
        success:   true,
        removed:   true,
        cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
        subtotal:  cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
      });
    }

    if (newQty > product.stock) {
      return res.status(400).json({ success: false, message: `Only ${product.stock} unit(s) available.`, maxStock: product.stock });
    }
    if (newQty > MAX_QTY) {
      return res.status(400).json({ success: false, message: `Maximum ${MAX_QTY} units allowed per item.`, maxQty: MAX_QTY });
    }

    cart.items[itemIndex].quantity = newQty;
    await cart.save();

    const itemTotal = item.price * newQty;
    const subtotal  = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);

    res.json({ success: true, quantity: newQty, itemTotal, subtotal, cartCount });
  } catch (err) {
    console.error('[updateCartItem]', err);
    res.status(500).json({ success: false, message: 'Failed to update cart' });
  }
};

export const removeFromCart = async (req, res) => {
  try {
    const userId     = req.session.user || req.user?._id;
    const { itemId } = req.params;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    const before = cart.items.length;
    cart.items   = cart.items.filter(i => i._id.toString() !== itemId);

    if (cart.items.length === before) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    await cart.save();

    const subtotal  = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);

    res.json({ success: true, subtotal, cartCount });
  } catch (err) {
    console.error('[removeFromCart]', err);
    res.status(500).json({ success: false, message: 'Failed to remove item' });
  }
};

export const clearCart = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    await Cart.findOneAndUpdate({ user: userId }, { items: [] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear cart' });
  }
};

export const getCartCount = async (req, res) => {
  try {
    const userId = req.session.user || req.user?._id;
    if (!userId) return res.json({ count: 0 });

    const cart  = await Cart.findOne({ user: userId }).select('items');
    const count = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;

    res.json({ count });
  } catch (_) {
    res.json({ count: 0 });
  }
};