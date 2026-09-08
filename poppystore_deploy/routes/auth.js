const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// Register
router.post('/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร รหัสผ่าน 4 ตัวอักษรขึ้นไป' });
  }

  const existing = db.get('users').find({ username }).value();
  if (existing) {
    return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
  }

  const users = db.get('users').value();
  const nextId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
  const hash = bcrypt.hashSync(password, 10);

  const newUser = {
    id: nextId,
    username,
    password: hash,
    balance: 0.0,
    role: 'user',
    created_at: new Date().toISOString()
  };

  db.get('users').push(newUser).write();

  res.json({
    success: true,
    message: 'สมัครสมาชิกสำเร็จเรียบร้อยแล้ว!'
  });
});

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  db.read();
  const user = db.get('users').find({ username }).value();
  if (!user) {
    return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    message: 'เข้าสู่ระบบสำเร็จ!',
    token,
    user: {
      id: user.id,
      username: user.username,
      balance: user.balance,
      role: user.role
    }
  });
});

// Get profile
router.get('/me', authenticateToken, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) {
    return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้นี้' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      balance: user.balance,
      role: user.role,
      created_at: user.created_at
    }
  });
});

module.exports = router;
