import Razorpay  from 'razorpay';
import crypto    from 'crypto';

const razorpay = new Razorpay({
  key_id    : process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


export const createRazorpayOrder = async (amountInRupees, receipt) => {
  const options = {
    amount  : Math.round(amountInRupees * 100),
    currency: 'INR',
    receipt : receipt,
  };
  const order = await razorpay.orders.create(options);
  return order;
};


export const verifyPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
};


export const fetchPayment = async (paymentId) => {
  return razorpay.payments.fetch(paymentId);
};

export default razorpay;