import Product  from '../models/product.js';
import Category from '../models/category.js';
import Brand    from '../models/brand.js';

export const getFeaturedProducts = async () => {
  const products = await Product.find({
    isDeleted: false,
    isListed : { $ne: false },
    stock    : { $gt: 0 },
  })
    .populate({ path: 'category', match: { isDeleted: false, isListed: { $ne: false } } })
    .populate('brand')
    .sort({ createdAt: -1 })
    .limit(12)
    .skip(1)
    .lean();

  return products.filter(p => p.category !== null);
};

export const getFilteredProducts = async ({ search, sort, category, brand, minPrice, maxPrice, page }) => {
  const limit    = 12;
  const safePage = Math.max(1, parseInt(page) || 1);
  const skip     = (safePage - 1) * limit;

  const min = parseFloat(minPrice) || 0;
  const max = parseFloat(maxPrice) || 999999999;

  const query = {
    isDeleted: false,
    isListed : { $ne: false },
    price    : { $gte: min, $lte: max },
  };

  if (search)   query.name     = { $regex: search, $options: 'i' };
  if (category) query.category = category;

  let brandNotFound = false;
  if (brand) {
    const brandDoc = await Brand.findOne({
      name     : { $regex: `^${brand}$`, $options: 'i' },
      isDeleted: false,
    }).lean();

    if (!brandDoc) { brandNotFound = true; }
    else           { query.brand = brandDoc._id; }
  }

  const sortMap = {
    newest   : { createdAt: -1 },
    oldest   : { createdAt:  1 },
    priceLow : { price:      1 },
    priceHigh: { price:     -1 },
    nameAZ   : { name:       1 },
    nameZA   : { name:      -1 },
  };
  const sortOption = sortMap[sort] || sortMap.newest;

  const categoryFilter = { isDeleted: false, isListed: { $ne: false } };

  const [categories, brands, total, products] = await Promise.all([
    Category.find(categoryFilter).sort({ name: 1 }).lean(),
    Product.distinct('brand',query)
    .then(brandIds => Brand.find({_id:{$in: brandIds}, isDeleted:false}).sort({name:1}).lean()),

    brandNotFound ? 0 : Product.aggregate([
      { $match: query },
      { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'categoryDoc' } },
      { $unwind: '$categoryDoc' },
      { $match: { 'categoryDoc.isDeleted': false, 'categoryDoc.isListed': { $ne: false } } },
      { $count: 'total' },
    ]).then(r => r[0]?.total ?? 0),

    brandNotFound ? [] : Product.aggregate([
      { $match: query },
      { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'categoryDoc' } },
      { $unwind: '$categoryDoc' },
      { $match: { 'categoryDoc.isDeleted': false, 'categoryDoc.isListed': { $ne: false } } },
      { $lookup: { from: 'brands', localField: 'brand', foreignField: '_id', as: 'brandDoc' } },
      { $addFields: { brand: { $arrayElemAt: ['$brandDoc', 0] }, category: '$categoryDoc' } },
      { $sort: sortOption },
      { $skip: skip },
      { $limit: limit },
      { $project: { categoryDoc: 0, brandDoc: 0 } },
    ]),
  ]);

  return {
    products,
    categories,
    brands    : brands.map(b => b.name),
    total,
    totalPages: Math.ceil(total / limit),
    page      : safePage,
    minPrice  : min === 0         ? '' : min,
    maxPrice  : max === 999999999 ? '' : max,
  };
};

export const getProductById = async (productId) => {
  const product = await Product.findOne({ _id: productId, isDeleted: false })
    .populate('category')
    .lean();

  if (!product) throw Object.assign(new Error('notfound'), { status: 404 });
  if (product.isListed === false) throw Object.assign(new Error('blocked'), { status: 410, product });
  if (!product.category || product.category.isDeleted || product.category.isListed === false)
    throw Object.assign(new Error('category'), { status: 410, product });

  // brand sp
  const [brand, related] = await Promise.all([
    Brand.findById(product.brand).lean(),

    Product.find({
      _id      : { $ne: product._id },
      category : product.category._id,
      isDeleted: false,
      isListed : { $ne: false },
    })
      .populate('category')
      .populate('brand')
      .limit(4)
      .lean(),
  ]);

  product.brand = brand;

  return { product, related };
};

export const getProductStatus = async (productId) => {
  const product = await Product.findOne({ _id: productId, isDeleted: false })
    .populate('category')
    .lean();

  if (!product) return 'notfound';
  if (product.isListed === false) return 'blocked';
  if (!product.category || product.category.isDeleted || product.category.isListed === false) return 'category';
  return 'available';
};

export const getProductStock = async (productId) => {
  const product = await Product.findOne({ _id: productId, isDeleted: false })
    .select('stock colorVariants isListed price')
    .lean();

  if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });

  return {
    stock        : product.stock,
    isListed     : product.isListed !== false,
    price        : product.price,
    colorVariants: (product.colorVariants || []).map(v => ({ name: v.name, stock: v.stock })),
  };
};