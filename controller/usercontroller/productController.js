import * as productService from '../../services/productService.js';

export const getHomePage = async (req, res) => {
  try {
    const featuredProducts = await productService.getFeaturedProducts();
    res.render('user/home', { featuredProducts });
  } catch (err) {
    console.error('[getHomePage]', err);
    res.render('user/home', { featuredProducts: [] });
  }
};

export const getAboutPage = (req, res) => {
  res.render('user/about');
};

export const getProducts = async (req, res) => {
  try {
    const filters = {
      search  : req.query.search?.trim()       || '',
      sort    : req.query.sort                 || 'newest',
      category: req.query.category             || '',
      brand   : req.query.brand?.trim()        || '',
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      page    : req.query.page,
    };

    const data = await productService.getFilteredProducts(filters);

    res.render('user/products', {
      title: 'Collection — Velmora Chroné',
      ...data,
      search  : filters.search,
      sort    : filters.sort,
      category: filters.category,
      brand   : filters.brand,
    });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).render('user/error', { message: 'Failed to load products.' });
  }
};

export const getProductDetail = async (req, res) => {
  try {
    const { product, related } = await productService.getProductById(req.params.id);
    res.render('user/productDetail', {
      title      : product.name + ' — Velmora Chroné',
      product,
      related,
      currentUser: req.user || req.session?.user || null,
    });
  } catch (err) {
    const reason = err.message; 
    const status = err.status || 500;
    if (status === 404) return res.status(404).render('user/productUnavailable', { title: 'Product Not Found — Velmora Chroné', reason });
    if (status === 410) return res.status(410).render('user/productUnavailable', { title: 'Product Unavailable — Velmora Chroné', reason, product: err.product });
    console.error('Get product detail error:', err);
    res.status(500).render('user/error', { message: 'Failed to load product.' });
  }
};

export const getProductStatus = async (req, res) => {
  try {
    const status = await productService.getProductStatus(req.params.id);
    res.json({ status });
  } catch (err) {
    console.error('[getProductStatus]', err);
    res.status(500).json({ status: 'error' });
  }
};

export const getProductStock = async (req, res) => {
  try {
    const data = await productService.getProductStock(req.params.id);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};