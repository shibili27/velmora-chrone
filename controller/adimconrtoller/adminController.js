import User     from '../../models/user.js';
import Category from '../../models/category.js';
import Product  from '../../models/product.js';
import Brand    from '../../models/brand.js';
import cloudinary from '../../config/cloudinary.js';


export const getDashboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 10;
    const skip   = (page - 1) * limit;

    const customerQuery = { role: 'user' };
    if (search) customerQuery.name = { $regex: search, $options: 'i' };

    const [
      totalUsers, blockedUsers, newUsersToday,
      totalProducts, totalCategories,
      customers, total,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ createdAt: { $gte: today } }),
      Product.countDocuments({ isDeleted: false }),
      Category.countDocuments({ isDeleted: false }),
      User.find(customerQuery).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(customerQuery),
    ]);

    res.render('admin/dashboard', {
      stats: { totalUsers, blockedUsers, newUsersToday, totalProducts, totalCategories },
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      customers,
      search,
      page,
      pages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard');
  }
};


export const getCategories = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;

    const query = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };

    const [categories, total] = await Promise.all([
      Category.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Category.countDocuments(query),
    ]);

    res.render('admin/categories', {
      title:      'Categories — Velmora Chroné',
      adminName:  req.session.adminName,
      categories,
      search,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   req.flash('error')[0]   || null,
      success: req.flash('success')[0] || null,
    });
  } catch (err) {
    console.error('Get categories error:', err);
    req.flash('error', 'Failed to load categories.');
    res.redirect('/admin/dashboard');
  }
};

export const addCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const exists = await Category.findOne({
      name:      { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false,
    });
    if (exists) {
      req.flash('error', 'Category with this name already exists.');
      return res.redirect('/admin/categories');
    }
    await Category.create({ name: name.trim(), description: description?.trim() });
    req.flash('success', 'Category added successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Add category error:', err);
    req.flash('error', 'Failed to add category.');
    res.redirect('/admin/categories');
  }
};

export const editCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const duplicate = await Category.findOne({
      name:      { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false,
      _id:       { $ne: req.params.id },
    });
    if (duplicate) {
      req.flash('error', 'Another category with this name already exists.');
      return res.redirect('/admin/categories');
    }
    await Category.findByIdAndUpdate(req.params.id, {
      name:        name.trim(),
      description: description?.trim(),
    });
    req.flash('success', 'Category updated successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Edit category error:', err);
    req.flash('error', 'Failed to update category.');
    res.redirect('/admin/categories');
  }
};

export const deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndUpdate(req.params.id, { isDeleted: true });
    req.flash('success', 'Category deleted.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error('Delete category error:', err);
    req.flash('error', 'Failed to delete category.');
    res.redirect('/admin/categories');
  }
};


export const getProducts = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;

    const query = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };

    const [products, total, categories, brands] = await Promise.all([
      Product.find(query)
        .populate('category')
        .populate('brand')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Product.countDocuments(query),
      Category.find({ isDeleted: false }).sort({ name: 1 }),
      Brand.find({ isDeleted: false }).sort({ name: 1 }),
    ]);

    res.render('admin/products', {
      title:      'Products — Velmora Chroné',
      adminName:  req.session.adminName,
      products,
      categories,
      brands,
      search,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   req.flash('error')[0]   || null,
      success: req.flash('success')[0] || null,
    });
  } catch (err) {
    console.error('Get products error:', err);
    req.flash('error', 'Failed to load products.');
    res.redirect('/admin/dashboard');
  }
};

async function uploadBase64(base64String, folder = 'velmora/products') {
  const result = await cloudinary.uploader.upload(base64String, {
    folder,
    transformation: [{ width: 800, height: 800, crop: 'fill' }],
  });
  return result.secure_url;
}

async function parseAndUploadVariants(raw) {
  if (!raw) return [];

  let variants;
  try {
    variants = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse colorVariants JSON:', e.message);
    return [];
  }

  if (!Array.isArray(variants) || variants.length === 0) return [];

  const result = [];

  for (const v of variants) {
    if (!v.name || !v.hex) {
      console.warn('Skipping variant — missing name or hex:', v);
      continue;
    }

    let rawImages = [];

    if (Array.isArray(v.images) && v.images.length > 0) {
      rawImages = v.images;
    } else {
      rawImages = [
        ...(Array.isArray(v.existingImages) ? v.existingImages : []),
        ...(Array.isArray(v.newImages)      ? v.newImages      : []),
      ];
    }

    const finalImages = [];

    for (const img of rawImages) {
      if (!img || typeof img !== 'string') continue;

      if (img.startsWith('data:image/')) {
        try {
          const url = await uploadBase64(img);
          finalImages.push(url);
        } catch (uploadErr) {
          console.error(`Cloudinary upload failed for variant "${v.name}":`, uploadErr.message);
        }
      } else if (img.startsWith('http://') || img.startsWith('https://')) {
        finalImages.push(img);
      }
    }

    if (finalImages.length < 3) {
      console.warn(`Variant "${v.name}" only has ${finalImages.length} valid image(s) — need at least 3. Skipping.`);
      continue;
    }

    result.push({
      name:   v.name.trim(),
      hex:    v.hex.trim(),
      stock:  Math.max(0, parseInt(v.stock) || 0),
      images: finalImages,
    });
  }

  return result;
}

export const addProduct = async (req, res) => {
  try {
    const { name, description, price, colorVariants: rawVariants } = req.body;
    const category = req.body.category || null;
    const brand    = req.body.brand    || null;

    if (!name || !price || !category) {
      req.flash('error', 'Name, price, and category are required.');
      return res.redirect('/admin/products');
    }

    const colorVariants = await parseAndUploadVariants(rawVariants);

    if (colorVariants.length === 0) {
      req.flash('error', 'Please add at least one colour variant with 3 or more images.');
      return res.redirect('/admin/products');
    }

    const totalStock = colorVariants.reduce((s, v) => s + v.stock, 0);
    const colors     = colorVariants.map(v => ({ name: v.name, hex: v.hex }));

    await Product.create({
      name:         name.trim(),
      description:  description?.trim() || '',
      price:        parseFloat(price),
      stock:        totalStock,
      category,
      brand:        brand || null,
      images:       colorVariants[0].images,   
      colorVariants,
      colors,
    });

    req.flash('success', 'Product added successfully.');
    res.redirect('/admin/products');

  } catch (err) {
    console.error('Add product error:', err);
    req.flash('error', `Failed to add product: ${err.message}`);
    res.redirect('/admin/products');
  }
};

export const editProduct = async (req, res) => {
  try {
    const { name, description, price, colorVariants: rawVariants } = req.body;
    const category = req.body.category || null;
    const brand    = req.body.brand    || null;

    if (!name || !price || !category) {
      req.flash('error', 'Name, price, and category are required.');
      return res.redirect('/admin/products');
    }


    const colorVariants = await parseAndUploadVariants(rawVariants);

    if (colorVariants.length === 0) {
      req.flash('error', 'Please add at least one colour variant with 3 or more images.');
      return res.redirect('/admin/products');
    }

    const totalStock = colorVariants.reduce((s, v) => s + v.stock, 0);
    const colors     = colorVariants.map(v => ({ name: v.name, hex: v.hex }));

    await Product.findByIdAndUpdate(
      req.params.id,
      {
        name:         name.trim(),
        description:  description?.trim() || '',
        price:        parseFloat(price),
        stock:        totalStock,
        category,
        brand:        brand || null,
        images:       colorVariants[0].images,
        colorVariants,
        colors,
      },
      { new: true, runValidators: true }
    );

    req.flash('success', 'Product updated successfully.');
    res.redirect('/admin/products');

  } catch (err) {
    console.error('Edit product error:', err);
    req.flash('error', `Failed to update product: ${err.message}`);
    res.redirect('/admin/products');
  }
};

export const deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isDeleted: true });
    req.flash('success', 'Product deleted.');
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Delete product error:', err);
    req.flash('error', 'Failed to delete product.');
    res.redirect('/admin/products');
  }
};


export const getBrands = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;

    const query = { isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };

    const [brands, total] = await Promise.all([
      Brand.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Brand.countDocuments(query),
    ]);

    res.render('admin/brands', {
      title:      'Brands — Velmora Chroné',
      adminName:  req.session.adminName,
      brands,
      search,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   req.flash('error')[0]   || null,
      success: req.flash('success')[0] || null,
    });
  } catch (err) {
    console.error('Get brands error:', err);
    req.flash('error', 'Failed to load brands.');
    res.redirect('/admin/dashboard');
  }
};

export const addBrand = async (req, res) => {
  try {
    const { name, description } = req.body;
    const exists = await Brand.findOne({
      name:      { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false,
    });
    if (exists) {
      req.flash('error', 'Brand with this name already exists.');
      return res.redirect('/admin/brands');
    }
    await Brand.create({ name: name.trim(), description: description?.trim() });
    req.flash('success', 'Brand added successfully.');
    res.redirect('/admin/brands');
  } catch (err) {
    console.error('Add brand error:', err);
    req.flash('error', 'Failed to add brand.');
    res.redirect('/admin/brands');
  }
};

export const editBrand = async (req, res) => {
  try {
    const { name, description } = req.body;
    const duplicate = await Brand.findOne({
      name:      { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false,
      _id:       { $ne: req.params.id },
    });
    if (duplicate) {
      req.flash('error', 'Another brand with this name already exists.');
      return res.redirect('/admin/brands');
    }
    await Brand.findByIdAndUpdate(req.params.id, {
      name:        name.trim(),
      description: description?.trim(),
    });
    req.flash('success', 'Brand updated successfully.');
    res.redirect('/admin/brands');
  } catch (err) {
    console.error('Edit brand error:', err);
    req.flash('error', 'Failed to update brand.');
    res.redirect('/admin/brands');
  }
};

export const deleteBrand = async (req, res) => {
  try {
    await Brand.findByIdAndUpdate(req.params.id, { isDeleted: true });
    req.flash('success', 'Brand deleted.');
    res.redirect('/admin/brands');
  } catch (err) {
    console.error('Delete brand error:', err);
    req.flash('error', 'Failed to delete brand.');
    res.redirect('/admin/brands');
  }
};