// controller/usercontroller/productController.js
import Product  from '../../models/product.js';
import Category from '../../models/category.js';

export const getProducts = async (req, res) => {
  try {
    const search   = req.query.search?.trim()       || '';
    const sort     = req.query.sort                 || 'newest';
    const category = req.query.category             || '';
    const brand    = req.query.brand?.trim()        || '';
    const minPrice = parseFloat(req.query.minPrice) || 0;
    const maxPrice = parseFloat(req.query.maxPrice) || 999999999;
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = 12;
    const skip     = (page - 1) * limit;

    const query = {
      isDeleted: false,
      isListed:  { $ne: false },
      price:     { $gte: minPrice, $lte: maxPrice },
    };

    if (search)   query.name     = { $regex: search, $options: 'i' };
    if (category) query.category = category;

    const sortMap = {
      newest:    { createdAt: -1 },
      oldest:    { createdAt:  1 },
      priceLow:  { price:      1 },
      priceHigh: { price:     -1 },
      nameAZ:    { name:       1 },
      nameZA:    { name:      -1 },
    };
    const sortOption = sortMap[sort] || sortMap.newest;

    const [allProducts, categories] = await Promise.all([
      Product.find(query)
        .populate({
          path:  'category',
          match: { isDeleted: false, isListed: { $ne: false } },
        })
        .populate('brand')   // brand is now ObjectId ref — get brand.name
        .sort(sortOption),
      Category.find({ isDeleted: false, isListed: { $ne: false } }).sort({ name: 1 }),
    ]);

    // filter out products whose category was soft-deleted
    let visibleProducts = allProducts.filter(p => p.category !== null);

    // collect unique brand names from visible products for the filter sidebar
    const brandNames = [
      ...new Set(
        visibleProducts
          .map(p => p.brand?.name)
          .filter(Boolean)
      ),
    ].sort();

    // apply brand filter by name
    if (brand) {
      visibleProducts = visibleProducts.filter(
        p => p.brand?.name?.toLowerCase() === brand.toLowerCase()
      );
    }

    const total      = visibleProducts.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedProducts = visibleProducts.slice(skip, skip + limit);

    res.render('user/products', {
      title:     'Collection — Velmora Chroné',
      products:   paginatedProducts,
      categories,
      brands:     brandNames,
      search,
      sort,
      category,
      brand,
      minPrice:  minPrice === 0         ? '' : minPrice,
      maxPrice:  maxPrice === 999999999 ? '' : maxPrice,
      page,
      totalPages,
      total,
    });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).render('user/error', { message: 'Failed to load products.' });
  }
};


export const getProductDetail = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id:       req.params.id,
      isDeleted: false,
      isListed:  { $ne: false },
    })
    .populate({
      path:  'category',
      match: { isDeleted: false, isListed: { $ne: false } },
    })
    .populate('brand');

    if (!product || !product.category) {
      return res.status(404).render('user/error', { message: 'Product not found.' });
    }

    const related = await Product.find({
      _id:       { $ne: product._id },
      category:  product.category._id,
      isDeleted: false,
      isListed:  { $ne: false },
    })
      .populate('category')
      .populate('brand')
      .limit(4);

    res.render('user/productDetail', {
      title:   product.name + ' — Velmora Chroné',
      product,
      related,
    });
  } catch (err) {
    console.error('Get product detail error:', err);
    res.status(500).render('user/error', { message: 'Failed to load product.' });
  }
};