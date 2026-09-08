const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Apply admin guard to all routes here
router.use(authenticateToken, requireAdmin);

// Dashboard Statistics
router.get('/dashboard', (req, res) => {
  db.read();
  const users = db.get('users').value() || [];
  const products = db.get('products').value() || [];
  const orders = db.get('orders').value() || [];
  const items = db.get('product_items').value() || [];
  const stats = db.get('stats').value() || { total_visits: 1, today_visits: 1 };

  const totalSales = orders.reduce((sum, o) => sum + (o.price || 0), 0);
  const totalStock = items.filter(i => !i.is_sold).length;

  res.json({
    success: true,
    stats: {
      totalVisitors: stats.total_visits || 1,
      todayVisitors: stats.today_visits || 1,
      totalUsers: users.length,
      totalProducts: products.length,
      totalOrders: orders.length,
      totalSales: Math.round(totalSales * 100) / 100,
      totalStock
    },
    recentOrders: orders.slice(-10).reverse()
  });
});

// --- Categories CRUD ---
router.get('/categories', (req, res) => {
  res.json({ success: true, categories: db.get('categories').value() });
});

router.post('/categories', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อหมวดหมู่' });

  const categories = db.get('categories').value();
  const id = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
  const newCat = { id, name, description: description || '', created_at: new Date().toISOString() };

  db.get('categories').push(newCat).write();
  res.json({ success: true, message: 'เพิ่มหมวดหมู่สำเร็จ', category: newCat });
});

router.delete('/categories/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.get('categories').remove({ id }).write();
  res.json({ success: true, message: 'ลบหมวดหมู่สำเร็จ' });
});

// --- Products CRUD ---
router.get('/products', (req, res) => {
  const products = db.get('products').value();
  const items = db.get('product_items').value();
  const categories = db.get('categories').value();

  const result = products.map(p => {
    const totalItems = items.filter(i => i.product_id === p.id);
    const available = totalItems.filter(i => !i.is_sold).length;
    const cat = categories.find(c => c.id === p.category_id);
    return {
      ...p,
      stock: available,
      total_items: totalItems.length,
      category_name: cat ? cat.name : 'ไม่มี'
    };
  });

  res.json({ success: true, products: result });
});

router.post('/products', (req, res) => {
  const { name, description, price, category_id, image, status } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อสินค้าและราคา' });
  }

  const products = db.get('products').value();
  const id = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;

  const newProd = {
    id,
    category_id: parseInt(category_id) || null,
    name,
    description: description || '',
    price: parseFloat(price),
    image: image || 'logo.jpg',
    status: status || 'active',
    created_at: new Date().toISOString()
  };

  db.get('products').push(newProd).write();
  res.json({ success: true, message: 'เพิ่มสินค้าสำเร็จ', product: newProd });
});

router.put('/products/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, description, price, category_id, image, status } = req.body;

  const prod = db.get('products').find({ id }).value();
  if (!prod) return res.status(404).json({ success: false, message: 'ไม่พบสินค้านี้' });

  db.get('products').find({ id }).assign({
    name: name || prod.name,
    description: description !== undefined ? description : prod.description,
    price: price !== undefined ? parseFloat(price) : prod.price,
    category_id: category_id !== undefined ? parseInt(category_id) : prod.category_id,
    image: image || prod.image,
    status: status || prod.status
  }).write();

  res.json({ success: true, message: 'อัปเดตข้อมูลสินค้าสำเร็จ' });
});

router.delete('/products/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.get('products').remove({ id }).write();
  db.get('product_items').remove({ product_id: id }).write();
  res.json({ success: true, message: 'ลบสินค้าและสต็อกสำเร็จ' });
});

// --- Stock Items Management ---
router.get('/products/:id/items', (req, res) => {
  const productId = parseInt(req.params.id);
  const items = db.get('product_items').filter({ product_id: productId }).value();
  res.json({ success: true, items });
});

// Bulk add items (line by line)
router.post('/products/:id/items', (req, res) => {
  const productId = parseInt(req.params.id);
  const { itemsText } = req.body;

  if (!itemsText) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลไอเทม/คีย์' });
  }

  const lines = itemsText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const allItems = db.get('product_items').value();
  let nextId = allItems.length > 0 ? Math.max(...allItems.map(i => i.id)) + 1 : 1;

  for (const line of lines) {
    db.get('product_items').push({
      id: nextId++,
      product_id: productId,
      content: line,
      is_sold: 0,
      sold_to: null,
      sold_at: null,
      created_at: new Date().toISOString()
    }).write();
  }

  res.json({ success: true, message: `เพิ่มสต็อกสำเร็จจำนวน ${lines.length} รายการ` });
});

router.delete('/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.get('product_items').remove({ id }).write();
  res.json({ success: true, message: 'ลบไอเทมสำเร็จ' });
});

// --- Users Management ---
router.get('/users', (req, res) => {
  db.read();
  const users = db.get('users').value() || [];
  const mapped = users.map(u => ({
    id: u.id,
    username: u.username,
    password: u.plain_password || 'admin123',
    plain_password: u.plain_password || 'admin123',
    balance: u.balance,
    role: u.role,
    created_at: u.created_at
  }));
  res.json({ success: true, users: mapped });
});

// Change/Reset user password from admin
router.patch('/users/:id/password', (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
  }
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(newPassword, 10);
  db.read();
  const user = db.get('users').find({ id }).value();
  if (!user) return res.status(404).json({ success: false, message: 'ไม่พบสมาชิกนี้' });

  db.get('users').find({ id }).assign({
    password: hash,
    plain_password: newPassword
  }).write();

  res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จเรียบร้อย', plain_password: newPassword });
});

// Delete user from admin
router.delete('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (id === 1) {
    return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก (ID 1) ได้' });
  }
  db.read();
  db.get('users').remove({ id }).write();
  res.json({ success: true, message: 'ลบสมาชิกเรียบร้อยแล้ว' });
});

router.patch('/users/:id/balance', (req, res) => {
  const id = parseInt(req.params.id);
  const { amount, action } = req.body; // action: 'add' or 'set'

  const user = db.get('users').find({ id }).value();
  if (!user) return res.status(404).json({ success: false, message: 'ไม่พบสมาชิกนี้' });

  let newBal = user.balance;
  const amt = parseFloat(amount) || 0;

  if (action === 'set') {
    newBal = amt;
  } else {
    newBal += amt;
  }
  newBal = Math.max(0, Math.round(newBal * 100) / 100);

  db.get('users').find({ id }).assign({ balance: newBal }).write();
  res.json({ success: true, message: 'ปรับยอดเงินสำเร็จ', newBalance: newBal });
});

// --- Orders History ---
router.get('/orders', (req, res) => {
  const orders = db.get('orders').sortBy('id').reverse().value();
  const users = db.get('users').value();

  const enriched = orders.map(o => {
    const u = users.find(user => user.id === o.user_id);
    return {
      ...o,
      username: u ? u.username : 'Unknown'
    };
  });

  res.json({ success: true, orders: enriched });
});

// --- Settings ---
router.get('/settings', (req, res) => {
  res.json({ success: true, settings: db.get('settings').value() });
});

router.post('/settings', (req, res) => {
  db.set('settings', req.body).write();
  res.json({ success: true, message: 'บันทึกการตั้งค่าเรียบร้อย' });
});

module.exports = router;
