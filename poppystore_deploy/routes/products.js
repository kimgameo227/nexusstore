const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get all active products with stock count
router.get('/', (req, res) => {
  const products = db.get('products').filter({ status: 'active' }).value();
  const items = db.get('product_items').value();
  const categories = db.get('categories').value();

  const enriched = products.map(p => {
    const stock = items.filter(i => i.product_id === p.id && !i.is_sold).length;
    const cat = categories.find(c => c.id === p.category_id);
    return {
      ...p,
      stock,
      category_name: cat ? cat.name : 'ทั่วไป'
    };
  });

  res.json({ success: true, products: enriched });
});

// Get single product
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.get('products').find({ id }).value();
  if (!product) {
    return res.status(404).json({ success: false, message: 'ไม่พบสินค้านี้' });
  }

  const stock = db.get('product_items').filter({ product_id: id, is_sold: 0 }).value().length;
  res.json({ success: true, product: { ...product, stock } });
});

// Buy product
router.post('/:id/buy', authenticateToken, (req, res) => {
  db.read();
  const productId = parseInt(req.params.id);
  const userId = req.user.id;

  const product = db.get('products').find({ id: productId, status: 'active' }).value();
  if (!product) {
    return res.status(404).json({ success: false, message: 'ไม่พบสินค้าหรือสินค้านี้ถูกปิดการขาย' });
  }

  // Check user balance
  const user = db.get('users').find({ id: userId }).value();
  if (!user || user.balance < product.price) {
    return res.status(400).json({ success: false, message: 'ยอดเงินคงเหลือไม่เพียงพอ กรุณาเติมเงินก่อนทำรายการ' });
  }

  // Find available stock item
  const item = db.get('product_items').find({ product_id: productId, is_sold: 0 }).value();
  if (!item) {
    return res.status(400).json({ success: false, message: 'ขออภัย สินค้านี้หมดแล้ว' });
  }

  // Deduct balance
  const newBalance = Math.round((user.balance - product.price) * 100) / 100;
  db.get('users').find({ id: userId }).assign({ balance: newBalance }).write();

  // Mark item as sold
  const soldTime = new Date().toISOString();
  db.get('product_items').find({ id: item.id }).assign({
    is_sold: 1,
    sold_to: userId,
    sold_at: soldTime
  }).write();

  // Record Order
  const orders = db.get('orders').value();
  const nextOrderId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 1;

  const newOrder = {
    id: nextOrderId,
    user_id: userId,
    product_id: productId,
    product_name: product.name,
    item_content: item.content,
    price: product.price,
    created_at: soldTime
  };
  db.get('orders').push(newOrder).write();

  res.json({
    success: true,
    message: 'สั่งซื้อสำเร็จ!',
    order: newOrder,
    item: { content: item.content },
    balance: newBalance,
    new_balance: newBalance
  });
});

// User orders history
router.get('/my/orders', authenticateToken, (req, res) => {
  const myOrders = db.get('orders').filter({ user_id: req.user.id }).sortBy('id').reverse().value();
  res.json({ success: true, orders: myOrders });
});

module.exports = router;
