require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const adminRoutes = require('./routes/admin');
const wheelRoutes = require('./routes/wheel');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Track website visitors
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html' || req.path === '/register.html')) {
    try {
      db.read();
      let stats = db.get('stats').value();
      if (!stats) {
        stats = { total_visits: 0, today_visits: 0, last_date: new Date().toDateString() };
      }
      const today = new Date().toDateString();
      if (stats.last_date !== today) {
        stats.today_visits = 0;
        stats.last_date = today;
      }
      stats.total_visits = (stats.total_visits || 0) + 1;
      stats.today_visits = (stats.today_visits || 0) + 1;
      db.set('stats', stats).write();
    } catch (e) {}
  }
  next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wheel', wheelRoutes);

// General shop settings public endpoint
app.get('/api/settings', (req, res) => {
  const settings = db.get('settings').value();
  res.json({ success: true, settings });
});

// Fallback to index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin panel route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===========================================`);
  console.log(`🚀 Poppy Shop Server running at:`);
  console.log(`   👉 Local:   http://localhost:${PORT}`);
  console.log(`   👉 LAN IP:  http://192.168.1.155:${PORT}`);
  console.log(`   👉 Admin:   http://localhost:${PORT}/admin`);
  console.log(`   🔑 Default Admin: admin / admin123`);
  console.log(`===========================================`);
});
