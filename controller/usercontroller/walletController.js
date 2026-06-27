import * as orderService from '../../services/orderService.js';

export const getWallet = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.session.user;
    console.log('[getWallet] userId:', userId);

    const { balance, transactions } = await orderService.fetchWallet(userId);
    res.render('user/wallet', { balance, transactions });
  } catch (err) {
    console.error('[getWallet]', err);
    res.status(500).send('Something went wrong.');
  }
};