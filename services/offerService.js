import Offer           from '../models/offer.js';
import ReferralSettings from '../models/referral.js';


/**

 * @param {(string|ObjectId)[]} productIds
 * @param {(string|ObjectId)[]} categoryIds
 * @returns {Promise<{productOffers: Map, categoryOffers: Map}>}
 
 */
const fetchActiveOffers = async (productIds = [], categoryIds = []) => {
  const now = new Date();

  const offers = await Offer.find({
    isActive : true,
    isDeleted: false,
    startDate: { $lte: now },
    endDate  : { $gte: now },
    $or: [
      { appliesTo: 'product',  targetId: { $in: productIds  } },
      { appliesTo: 'category', targetId: { $in: categoryIds } },
    ],
  })
    .select('appliesTo targetId discountType discountValue')
    .lean();

  
  const productOffers  = new Map();
  const categoryOffers = new Map();

  for (const offer of offers) {
    if (offer.appliesTo === 'product' && offer.targetId) {
      const key = offer.targetId.toString();
      
      const existing = productOffers.get(key);
      if (!existing || isBetterOffer(offer, existing)) productOffers.set(key, offer);
    } else if (offer.appliesTo === 'category' && offer.targetId) {
      const key = offer.targetId.toString();
      const existing = categoryOffers.get(key);
      if (!existing || isBetterOffer(offer, existing)) categoryOffers.set(key, offer);
    }
  }

  return { productOffers, categoryOffers };
};


const isBetterOffer = (a, b) => {
  if (a.discountType === 'percentage' && b.discountType === 'percentage') {
    return a.discountValue > b.discountValue;
  }
  return false; 
};

const calcDiscountAmount = (offer, basePrice) => {
  if (!offer) return 0;
  if (offer.discountType === 'percentage') {
    return Math.round((basePrice * offer.discountValue) / 100);
  }
  return Math.min(offer.discountValue, basePrice);
};

/**

 *
 * @param {object} product  
 * @param {Map}    productOffers
 * @param {Map}    categoryOffers
 * @returns {{
 *   effectivePrice : number,
 *   discountPct    : number,
 *   offerType      : 'product'|'category'|null,
 *   offerLabel     : string|null,
 * }}
 */
const resolvePrice = (product, productOffers, categoryOffers) => {
  const base = product.price;

  const categoryId   = product.category?._id ?? product.category;
  const productOffer  = productOffers.get(product._id.toString());
  const categoryOffer = categoryId ? categoryOffers.get(categoryId.toString()) : null;

  const productAmount  = calcDiscountAmount(productOffer,  base);
  const categoryAmount = calcDiscountAmount(categoryOffer, base);

  let winningOffer  = null;
  let winningAmount = 0;

  if (productAmount >= categoryAmount && productAmount > 0) {
    winningOffer  = productOffer;
    winningAmount = productAmount;
  } else if (categoryAmount > 0) {
    winningOffer  = categoryOffer;
    winningAmount = categoryAmount;
  }

  const effectivePrice = winningOffer ? Math.max(0, base - winningAmount) : base;


  const discountPct = winningOffer
    ? Math.round((winningAmount / base) * 100)
    : 0;

  const offerType = winningOffer
    ? (winningOffer === productOffer ? 'product' : 'category')
    : null;

  return {
    effectivePrice,
    discountPct,
    offerType,
    offerLabel: discountPct > 0 ? `${discountPct}% off` : null,
  };
};



/**

 * @param {object[]} products
 * @returns {Promise<object[]>}
 */
export const attachOffers = async (products) => {
  if (!products?.length) return products;

  const productIds  = products.map(p => p._id);
  const categoryIds = products
    .map(p => p.category?._id ?? p.category)
    .filter(Boolean);

  const { productOffers, categoryOffers } = await fetchActiveOffers(productIds, categoryIds);

  for (const product of products) {
    const resolved = resolvePrice(product, productOffers, categoryOffers);
    Object.assign(product, resolved, { hasOffer: resolved.discountPct > 0 });
  }

  return products;
};

/**
 
 * @param {object} product
 * @returns {Promise<object>}
 */
export const attachOffer = async (product) => {
  const [result] = await attachOffers([product]);
  return result;
};

/**
 
 * @returns {Promise<number>}
 */
export const getReferralDiscountPct = async () => {
  const settings = await ReferralSettings.getOrCreate();
  if (!settings.isEnabled) return 0;
  return settings.refereeDiscountPercentage ?? 0;
};

/**
 
 * @returns {Promise<number>}
 */
export const getReferralRewardAmount = async () => {
  const settings = await ReferralSettings.getOrCreate();
  if (!settings.isEnabled) return 0;
  return settings.referrerRewardAmount ?? 0;
};