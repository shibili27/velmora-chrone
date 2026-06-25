import Offer    from '../../models/offer.js';
import Product  from '../../models/product.js';
import Category from '../../models/category.js';

// ── List + search + paginate ────────────────────────────────────────────────
export const getOffers = async (req, res) => {
  try {
    const search = req.query.search?.trim() || '';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 8;
    const skip   = (page - 1) * limit;

    const query = { isDeleted: false };
    if (search) query.title = { $regex: search, $options: 'i' };

    const [offersRaw, total, products, categories] = await Promise.all([
      Offer.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Offer.countDocuments(query),
      Product.find({ isDeleted: false }).select('name price').sort({ name: 1 }).lean(),
      Category.find({ isDeleted: false }).select('name').sort({ name: 1 }).lean(),
    ]);

    // Resolve each offer's target name (product or category) for display,
    // since targetId is a bare ObjectId with no built-in populate path.
    const productMap  = new Map(products.map(p => [String(p._id), p.name]));
    const categoryMap = new Map(categories.map(c => [String(c._id), c.name]));

    const now = new Date();
    const offers = offersRaw.map(o => ({
      ...o,
      targetName: o.appliesTo === 'product'
        ? (productMap.get(String(o.targetId))  || 'Deleted product')
        : (categoryMap.get(String(o.targetId)) || 'Deleted category'),
      isLive: o.isActive && new Date(o.startDate) <= now && new Date(o.endDate) >= now,
      isExpired: new Date(o.endDate) < now,
      isUpcoming: new Date(o.startDate) > now,
    }));

    res.render('admin/offers', {
      title: 'Offers — Velmora Chroné',
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      offers, products, categories, search, page,
      totalPages: Math.ceil(total / limit),
      total,
      error:   res.locals.error   || [],
      success: res.locals.success || [],
    });
  } catch (err) {
    console.error('Get offers error:', err);
    req.flash('error', 'Failed to load offers.');
    res.redirect('/admin/dashboard');
  }
};

// ── Shared validation for add/edit ──────────────────────────────────────────
function validateOfferInput(body) {
  const { title, appliesTo, targetId, discountType, discountValue, startDate, endDate } = body;

  if (!title?.trim())              return 'Offer title is required.';
  if (!['product', 'category'].includes(appliesTo)) return 'Offer must apply to a product or category.';
  if (!targetId)                   return 'Please select a target product or category.';
  if (!['percentage', 'flat'].includes(discountType)) return 'Invalid discount type.';

  const value = parseFloat(discountValue);
  if (isNaN(value) || value <= 0) return 'Discount value must be a positive number.';
  if (discountType === 'percentage' && value > 100) return 'Percentage discount cannot exceed 100.';

  if (!startDate || !endDate)      return 'Start and end dates are required.';
  if (new Date(endDate) < new Date(startDate)) return 'End date cannot be before start date.';

  return null;
}

// ── Add ──────────────────────────────────────────────────────────────────-
export const addOffer = async (req, res) => {
  try {
    const validationError = validateOfferInput(req.body);
    if (validationError) {
      req.flash('error', validationError);
      return res.redirect('/admin/offers');
    }

    const { title, description, appliesTo, targetId, discountType, discountValue, startDate, endDate, isActive } = req.body;

    // Confirm the target actually exists, to avoid dangling offers.
    const targetExists = appliesTo === 'product'
      ? await Product.exists({ _id: targetId, isDeleted: false })
      : await Category.exists({ _id: targetId, isDeleted: false });

    if (!targetExists) {
      req.flash('error', `Selected ${appliesTo} no longer exists.`);
      return res.redirect('/admin/offers');
    }

    // Enforce "one active offer per target" — if an active, non-deleted
    // offer already exists for this exact target, block creating another.
    const duplicate = await Offer.findOne({
      appliesTo, targetId, isDeleted: false, isActive: true,
    });
    if (duplicate) {
      req.flash('error', `An active offer already exists for this ${appliesTo}. Deactivate or delete it first.`);
      return res.redirect('/admin/offers');
    }

    await Offer.create({
      title: title.trim(),
      description: description?.trim() || '',
      appliesTo,
      targetId,
      discountType,
      discountValue: parseFloat(discountValue),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      isActive: isActive === 'on' || isActive === 'true' || isActive === true,
    });

    req.flash('success', 'Offer created successfully.');
    res.redirect('/admin/offers');
  } catch (err) {
    console.error('Add offer error:', err);
    req.flash('error', `Failed to create offer: ${err.message}`);
    res.redirect('/admin/offers');
  }
};

// ── Edit ─────────────────────────────────────────────────────────────────-
export const editOffer = async (req, res) => {
  try {
    const validationError = validateOfferInput(req.body);
    if (validationError) {
      req.flash('error', validationError);
      return res.redirect('/admin/offers');
    }

    const { title, description, appliesTo, targetId, discountType, discountValue, startDate, endDate, isActive } = req.body;

    const targetExists = appliesTo === 'product'
      ? await Product.exists({ _id: targetId, isDeleted: false })
      : await Category.exists({ _id: targetId, isDeleted: false });

    if (!targetExists) {
      req.flash('error', `Selected ${appliesTo} no longer exists.`);
      return res.redirect('/admin/offers');
    }

    const wantsActive = isActive === 'on' || isActive === 'true' || isActive === true;

    // Only block on duplicate-active-offer if THIS edit would make it active
    // for a target that already has a different active offer.
    if (wantsActive) {
      const duplicate = await Offer.findOne({
        appliesTo, targetId, isDeleted: false, isActive: true,
        _id: { $ne: req.params.id },
      });
      if (duplicate) {
        req.flash('error', `An active offer already exists for this ${appliesTo}. Deactivate or delete it first.`);
        return res.redirect('/admin/offers');
      }
    }

    await Offer.findByIdAndUpdate(req.params.id, {
      title: title.trim(),
      description: description?.trim() || '',
      appliesTo,
      targetId,
      discountType,
      discountValue: parseFloat(discountValue),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      isActive: wantsActive,
    }, { runValidators: true });

    req.flash('success', 'Offer updated successfully.');
    res.redirect('/admin/offers');
  } catch (err) {
    console.error('Edit offer error:', err);
    req.flash('error', `Failed to update offer: ${err.message}`);
    res.redirect('/admin/offers');
  }
};

// ── Toggle active/inactive (quick switch from the list, no full edit) ──────
export const toggleOfferActive = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      req.flash('error', 'Offer not found.');
      return res.redirect('/admin/offers');
    }

    const turningOn = !offer.isActive;

    if (turningOn) {
      const duplicate = await Offer.findOne({
        appliesTo: offer.appliesTo,
        targetId: offer.targetId,
        isDeleted: false,
        isActive: true,
        _id: { $ne: offer._id },
      });
      if (duplicate) {
        req.flash('error', `An active offer already exists for this ${offer.appliesTo}. Deactivate it first.`);
        return res.redirect('/admin/offers');
      }
    }

    offer.isActive = turningOn;
    await offer.save();

    req.flash('success', `Offer ${turningOn ? 'activated' : 'deactivated'}.`);
    res.redirect('/admin/offers');
  } catch (err) {
    console.error('Toggle offer error:', err);
    req.flash('error', 'Failed to update offer status.');
    res.redirect('/admin/offers');
  }
};

// ── Delete (soft) ────────────────────────────────────────────────────────-
export const deleteOffer = async (req, res) => {
  try {
    await Offer.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false });
    req.flash('success', 'Offer deleted.');
    res.redirect('/admin/offers');
  } catch (err) {
    console.error('Delete offer error:', err);
    req.flash('error', 'Failed to delete offer.');
    res.redirect('/admin/offers');
  }
};