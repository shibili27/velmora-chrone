// controller/usercontroller/productController.js
import Product  from '../../models/product.js';
import Category from '../../models/category.js';

export const getProducts = async (req, res) => {
  try {
    const search   = req.query.search?.trim()   || '';
    const sort     = req.query.sort             || 'newest';
    const category = req.query.category         || '';
    const minPrice = parseFloat(req.query.minPrice) || 0;
    const maxPrice = parseFloat(req.query.maxPrice) || 999999999;
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = 12;
    const skip     = (page - 1) * limit;

    // Only show listed, non-deleted products whose category is also listed
    const query = {
      isDeleted: false,
      isListed:  true,
      price:     { $gte: minPrice, $lte: maxPrice },
    };

    if (search)   query.name     = { $regex: search, $options: 'i' };
    if (category) query.category = category;

    // Sort options
    const sortMap = {
      newest:     { createdAt: -1 },
      oldest:     { createdAt:  1 },
      priceLow:   { price:      1 },
      priceHigh:  { price:     -1 },
      nameAZ:     { name:       1 },
      nameZA:     { name:      -1 },
    };
    const sortOption = sortMap[sort] || sortMap.newest;

    // Fetch only categories that are listed and not deleted
    const [products, total, categories] = await Promise.all([
      Product.find(query)
        .populate({
          path:  'category',
          match: { isDeleted: false, isListed: true },
        })
        .sort(sortOption)
        .skip(skip)
        .limit(limit),
      Product.countDocuments(query),
      Category.find({ isDeleted: false, isListed: true }).sort({ name: 1 }),
    ]);

    // Filter out products whose category didn't match (populate returns null)
    const visibleProducts = products.filter(p => p.category !== null);

    res.render('user/products', {
      products:   visibleProducts,
      categories,
      search,
      sort,
      category,
      minPrice:   minPrice === 0          ? '' : minPrice,
      maxPrice:   maxPrice === 999999999  ? '' : maxPrice,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).render('user/error', { message: 'Failed to load products.' });
  }
};