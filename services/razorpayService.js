import Razorpay  from 'razorpay';
import crypto    from 'crypto';

const razorpay = new Razorpay({
  key_id    : process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Creates a Razorpay order for the given amount (in rupees).
 * Razorpay expects amount in paise (smallest currency unit), hence * 100.
 */
export const createRazorpayOrder = async (amountInRupees, receipt) => {
  const options = {
    amount  : Math.round(amountInRupees * 100),
    currency: 'INR',
    receipt : receipt,
  };
  const order = await razorpay.orders.create(options);
  return order;
};

/**
 * Verifies the payment signature sent back by Razorpay checkout.js after payment.
 * This MUST be done server-side — never trust the client's "payment succeeded" claim alone.
 */
export const verifyPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
};

/**
 * Fetches a payment's details from Razorpay (useful for double-checking status,
 * e.g. on the failure-page "retry" flow or for refund handling later).
 */
export const fetchPayment = async (paymentId) => {
  return razorpay.payments.fetch(paymentId);
};

export default razorpay;