import { addOrderClient } from '../../public/utils/ssemanager.js';
import * as orderService  from '../../services/orderService.js';

export const streamOrderStatus = async (req, res) => {
  try {
    const order = await orderService.fetchOrderForSSE({
      orderId : req.params.id,
      userId  : req.user._id,
    });

    addOrderClient(req.params.id, res);
    res.write(`event: orderStatus\ndata: ${JSON.stringify({ orderStatus: order.orderStatus })}\n\n`);
  } catch (err) {
    console.error('[streamOrderStatus]', err);
    res.status(err.status || 500).end();
  }
};

export const getOrders = async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const { orders, total, page, totalPages } = await orderService.fetchOrders({
      userId : req.user._id,
      search,
      page   : req.query.page,
    });

    res.render('user/orders', { orders, search, total, page, totalPages });
  } catch (err) {
    console.error('[getOrders]', err);
    res.status(500).render('500', { message: 'Something went wrong' });
  }
};

export const getOrderDetail = async (req, res) => {
  try {
    const order = await orderService.fetchOrderDetail({
      orderId : req.params.id,
      userId  : req.user._id,
    });

    res.render('user/orderDetail', { order });
  } catch (err) {
    console.error('[getOrderDetail]', err);
    const status = err.status || 500;
    res.status(status).render(status === 404 ? '404' : '500', { message: err.message });
  }
};


export const cancelOrder = async (req, res) => {
  try {
    await orderService.cancelEntireOrder({
      orderId : req.params.id,
      userId  : req.user._id,
      reason  : req.body.reason,
    });

    return res.json({ success: true, message: 'Order cancelled successfully.' });
  } catch (err) {
    console.error('[cancelOrder]', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
};


export const cancelItem = async (req, res) => {
  try {
    const { allCancelled } = await orderService.cancelSingleItem({
      orderId : req.params.id,
      userId  : req.user._id,
      itemId  : req.body.itemId,
      reason  : req.body.reason,
    });

    return res.json({ success: true, message: 'Item cancelled.', allCancelled });
  } catch (err) {
    console.error('[cancelItem]', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
};


export const returnOrder = async (req, res) => {
  try {
    await orderService.requestReturn({
      orderId : req.params.id,
      userId  : req.user._id,
      reason  : (req.body.reason || '').trim(),
    });

    return res.json({ success: true, message: 'Return request submitted successfully.' });
  } catch (err) {
    console.error('[returnOrder]', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
};


export const downloadInvoice = async (req, res) => {
  try {
    await orderService.generateInvoicePDF({
      orderId : req.params.id,
      userId  : req.user._id,
      res,
    });
  } catch (err) {
    console.error('[downloadInvoice]', err);
    if (!res.headersSent) {
      res.status(err.status || 500).send(err.message || 'Could not generate invoice.');
    }
  }
};