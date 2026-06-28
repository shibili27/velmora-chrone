import { addOrderClient } from '../../public/utils/ssemanager.js';
import * as orderService  from '../../services/orderService.js';

export const streamOrderStatus = async (req, res) => {
  try {
    const order = await orderService.fetchOrderForSSE({
      orderNumber : req.params.orderNumber,
      userId      : req.user._id,
    });

    addOrderClient(order._id.toString(), res);
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
      orderNumber : req.params.orderNumber,
      userId      : req.user._id,
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
    const reason = (req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A cancellation reason is required.' });
    }

    await orderService.cancelEntireOrder({
      orderNumber : req.params.orderNumber,
      userId      : req.user._id,
      reason,
    });

    return res.json({ success: true, message: 'Order cancelled successfully.' });
  } catch (err) {
    console.error('[cancelOrder]', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
};

export const cancelItem = async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A cancellation reason is required.' });
    }

    const { allCancelled } = await orderService.cancelSingleItem({
      orderNumber : req.params.orderNumber,
      userId      : req.user._id,
      itemId      : req.body.itemId,
      reason,
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
      orderNumber : req.params.orderNumber,
      userId: req.user._id,
      reason: (req.body.reason || '').trim(),
    });
    console.log(req.body)

    return res.json({ success: true, message: 'Return request submitted successfully.' });
  } catch (err) {
    console.error('[returnOrder]', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
};

export const returnItem = async (req, res) => {
  try {
    await orderService.requestItemReturn({
      orderNumber : req.params.orderNumber,
      userId      : req.user._id,
      itemId      : req.body.itemId,
      reason      : (req.body.reason || '').trim(),
    });

    return res.json({ success: true, message: 'Item return request submitted successfully.' });
  } catch (err) {
    console.error('[returnItem]', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Server error.' });
  }
};

export const downloadInvoice = async (req, res) => {
  try {
    await orderService.generateInvoicePDF({
      orderNumber : req.params.orderNumber,
      userId      : req.user._id,
      res,
    });
  } catch (err) {
    console.error('[downloadInvoice]', err);
    if (!res.headersSent) {
      res.status(err.status || 500).send(err.message || 'Could not generate invoice.');
    }
  }
};