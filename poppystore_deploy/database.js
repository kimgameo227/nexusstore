const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt = require('bcryptjs');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'nexus_data.json'));
const db = low(adapter);

// Initialize default state
db.defaults({
  users: [],
  categories: [],
  products: [],
  product_items: [],
  orders: [],
  topup_history: [],
  wheel_history: [],
  wheel_prizes: [],
  stats: {
    total_visits: 1,
    today_visits: 1,
    last_date: new Date().toDateString()
  },
  settings: {
    site_name: 'Poppy',
    announcement: 'ยินดีต้อนรับสู่ร้านค้า Poppy ศูนย์รวมไอดีและสินค้าดิจิทัลราคาถูก!',
    truemoney_phone: '0812345678',
    promptpay_number: '0812345678',
    bank_name: 'ธนาคารกสิกรไทย (KBANK)',
    bank_account_number: '123-4-56789-0',
    bank_account_name: 'นาย ป๊อปปี้ สโตร์',
    wheel_price: 25
  }
}).write();

// Seed initial Admin user
const admin = db.get('users').find({ username: 'admin' }).value();
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.get('users').push({
    id: 1,
    username: 'admin',
    password: hash,
    balance: 99999,
    role: 'admin',
    created_at: new Date().toISOString()
  }).write();
  console.log('[DB] Seeded admin user: admin / admin123');
}

// Seed initial category & product
const categories = db.get('categories').value();
if (categories.length === 0) {
  db.get('categories').push({
    id: 1,
    name: 'ไอดีไก่ตัน Blox Fruits',
    description: 'ไอดีพร้อมเวลตัน หมัดครบ ผลตื่น',
    created_at: new Date().toISOString()
  }).write();

  db.get('products').push({
    id: 1,
    category_id: 1,
    name: 'ไอดีไก่ตัน หมัดก็อด + ผลโมจิตื่น 100%',
    description: 'ไอดีเลเวล 2550 สุ่มดาบ มีผลโมจิตื่นครบทุกสกิล รับประกันปลอดภัย',
    price: 150.0,
    image: 'logo.jpg',
    status: 'active',
    created_at: new Date().toISOString()
  }).write();

  db.get('product_items').push(
    { id: 1, product_id: 1, content: 'nexus_user1:Passw0rd123! | Key: NEXUS-8891', is_sold: 0, sold_to: null, sold_at: null },
    { id: 2, product_id: 1, content: 'nexus_user2:Passw0rd456! | Key: NEXUS-8892', is_sold: 0, sold_to: null, sold_at: null },
    { id: 3, product_id: 1, content: 'nexus_user3:Passw0rd789! | Key: NEXUS-8893', is_sold: 0, sold_to: null, sold_at: null }
  ).write();
  console.log('[DB] Seeded category, product & stock');
}

const fs = require('fs');

const VAULT_FILE = path.join(__dirname, 'users_vault.json');
const ARCHIVE_LOG = path.join(__dirname, 'users_archive.log');

// Helper to save user to persistent vault & append-only log
db.saveUserToVault = function(user) {
  try {
    let vaultData = [];
    if (fs.existsSync(VAULT_FILE)) {
      try {
        vaultData = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
      } catch (e) { vaultData = []; }
    }
    const idx = vaultData.findIndex(u => u.username === user.username);
    if (idx >= 0) {
      vaultData[idx] = { ...vaultData[idx], ...user };
    } else {
      vaultData.push(user);
    }
    fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2), 'utf8');

    const logLine = `[${new Date().toISOString()}] USER: ${user.username} | PASS: ${user.plain_password || 'ENCRYPTED'} | ROLE: ${user.role} | BALANCE: ${user.balance}\n`;
    fs.appendFileSync(ARCHIVE_LOG, logLine, 'utf8');
  } catch (err) {
    console.error('[Save Vault Error]:', err.message);
  }
};

// Auto-sync users from vault on startup to prevent data loss across redeploys
try {
  if (fs.existsSync(VAULT_FILE)) {
    const vaultData = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    if (Array.isArray(vaultData) && vaultData.length > 0) {
      const currentUsers = db.get('users').value() || [];
      let updated = false;
      for (const u of vaultData) {
        const existing = currentUsers.find(x => x.username === u.username);
        if (!existing) {
          currentUsers.push(u);
          updated = true;
        } else if (u.plain_password && !existing.plain_password) {
          existing.plain_password = u.plain_password;
          updated = true;
        }
      }
      if (updated) {
        db.set('users', currentUsers).write();
        console.log(`[Vault] Restored ${vaultData.length} users from vault backup.`);
      }
    }
  } else {
    // Initial export current users into vault
    const currentUsers = db.get('users').value() || [];
    if (currentUsers.length > 0) {
      fs.writeFileSync(VAULT_FILE, JSON.stringify(currentUsers, null, 2), 'utf8');
    }
  }
} catch (e) {
  console.error('[Vault Sync Error]:', e.message);
}

module.exports = db;
