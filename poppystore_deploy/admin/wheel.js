const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Default wheel prizes
const DEFAULT_PRIZES = [
  {
    id: 1,
    name: "ไอดีไก่ตัน Blox Fruits ผลโมจิตื่น",
    type: "item",
    icon: "⚡",
    color: "#ec4899",
    text_color: "#ffffff",
    chance: 8,
    reward_content: "poppy_blox_spin:GodHuman2550#Pass | KEY: POPPY-WHEEL-BLOX-99"
  },
  {
    id: 2,
    name: "เครดิต 10 ฿",
    type: "credit",
    amount: 10,
    icon: "💰",
    color: "#ffffff",
    text_color: "#ec4899",
    chance: 25,
    reward_content: "ได้รับเครดิต 10 ฿ เพิ่มเข้ากระเป๋าเรียบร้อย"
  },
  {
    id: 3,
    name: "เสียใจด้วยนะ (ไม่ได้รางวัล)",
    type: "empty",
    icon: "😢",
    color: "#fbcfe8",
    text_color: "#831843",
    chance: 30,
    reward_content: null
  },
  {
    id: 4,
    name: "ไอดี Valorant สุ่มสกินปืน",
    type: "item",
    icon: "🎯",
    color: "#e11d48",
    text_color: "#ffffff",
    chance: 7,
    reward_content: "poppy_val_vip:PrimeVandal2026 | KEY: POPPY-WHEEL-VAL-77"
  },
  {
    id: 5,
    name: "เครดิต 50 ฿",
    type: "credit",
    amount: 50,
    icon: "💎",
    color: "#ffffff",
    text_color: "#db2777",
    chance: 5,
    reward_content: "ได้รับเครดิต 50 ฿ เพิ่มเข้ากระเป๋าเรียบร้อย"
  },
  {
    id: 6,
    name: "ไอดี Netflix UltraHD 30 วัน",
    type: "item",
    icon: "🍿",
    color: "#db2777",
    text_color: "#ffffff",
    chance: 6,
    reward_content: "poppy_netflix@shop.com:PassUltra2026 | Profile: 1 (Pin: 9988)"
  },
  {
    id: 7,
    name: "เครดิต 20 ฿",
    type: "credit",
    amount: 20,
    icon: "🎁",
    color: "#ffffff",
    text_color: "#ec4899",
    chance: 15,
    reward_content: "ได้รับเครดิต 20 ฿ เพิ่มเข้ากระเป๋าเรียบร้อย"
  },
  {
    id: 8,
    name: "ไอดี Steam สุ่มเกมแท้",
    type: "item",
    icon: "🎮",
    color: "#be185d",
    text_color: "#ffffff",
    chance: 4,
    reward_content: "poppy_steam:GamerSteam2026 | CDKEY: POPPY-STEAM-4491-GAME"
  }
];

// Ensure wheel prizes exists in DB
function getPrizes() {
  db.read();
  let prizes = db.get('wheel_prizes').value();
  if (!prizes || prizes.length === 0) {
    db.set('wheel_prizes', DEFAULT_PRIZES).write();
    prizes = DEFAULT_PRIZES;
  }
  return prizes;
}

// Get wheel info (public)
router.get('/info', (req, res) => {
  db.read();
  const settings = db.get('settings').value() || {};
  const price = settings.wheel_price !== undefined ? settings.wheel_price : 25;
  const prizes = getPrizes().map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    amount: p.amount || 0,
    icon: p.icon,
    color: p.color,
    text_color: p.text_color
  }));

  res.json({
    success: true,
    price: price,
    prizes: prizes
  });
});

// Spin the wheel (authenticated user)
router.post('/spin', authenticateToken, (req, res) => {
  db.read();
  const userId = req.user.id;
  const user = db.get('users').find({ id: userId }).value();

  if (!user) {
    return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน' });
  }

  const settings = db.get('settings').value() || {};
  const spinPrice = settings.wheel_price !== undefined ? Number(settings.wheel_price) : 25;

  if (user.balance < spinPrice) {
    return res.status(400).json({
      success: false,
      message: `ยอดเงินคงเหลือไม่พอสำหรับการหมุนวงล้อ (ต้องการ ฿${spinPrice.toFixed(2)}) กรุณาเติมเงินก่อน`
    });
  }

  const prizes = getPrizes();
  if (!prizes || prizes.length === 0) {
    return res.status(500).json({ success: false, message: 'ระบบวงล้อยังไม่พร้อมใช้งาน' });
  }

  // Calculate weighted random selection
  const totalWeight = prizes.reduce((sum, p) => sum + (p.chance || 1), 0);
  let randomWeight = Math.random() * totalWeight;
  let winningIndex = 0;

  for (let i = 0; i < prizes.length; i++) {
    randomWeight -= (prizes[i].chance || 1);
    if (randomWeight <= 0) {
      winningIndex = i;
      break;
    }
  }

  const wonPrize = prizes[winningIndex];

  // Calculate balance: subtract spin cost first
  let updatedBalance = Math.round((user.balance - spinPrice) * 100) / 100;

  let orderRecord = null;
  const now = new Date().toISOString();

  if (wonPrize.type === 'credit') {
    // Add prize credit back
    const creditAmount = Number(wonPrize.amount) || 0;
    updatedBalance = Math.round((updatedBalance + creditAmount) * 100) / 100;
  } else if (wonPrize.type === 'item') {
    // Generate order record so user sees it in their purchase history
    const orders = db.get('orders').value() || [];
    const nextOrderId = orders.length > 0 ? Math.max(...orders.map(o => o.id || 0)) + 1 : 1;
    
    orderRecord = {
      id: nextOrderId,
      user_id: userId,
      product_id: 0,
      product_name: `[วงล้อสุ่ม] ${wonPrize.name}`,
      item_content: wonPrize.reward_content || 'ไอดีสุ่มจากวงล้อ Poppy',
      price: spinPrice,
      created_at: now
    };
    db.get('orders').push(orderRecord).write();
  }

  // Save new user balance
  db.get('users').find({ id: userId }).assign({ balance: updatedBalance }).write();

  // Record wheel spin history
  const wheelHistory = db.get('wheel_history').value() || [];
  const nextHistoryId = wheelHistory.length > 0 ? Math.max(...wheelHistory.map(h => h.id || 0)) + 1 : 1;
  const historyEntry = {
    id: nextHistoryId,
    user_id: userId,
    username: user.username,
    prize_id: wonPrize.id,
    prize_name: wonPrize.name,
    prize_type: wonPrize.type,
    amount: wonPrize.amount || 0,
    content: wonPrize.reward_content || null,
    cost: spinPrice,
    created_at: now
  };

  if (!db.get('wheel_history').value()) {
    db.set('wheel_history', [historyEntry]).write();
  } else {
    db.get('wheel_history').push(historyEntry).write();
  }

  res.json({
    success: true,
    winning_index: winningIndex,
    prize: {
      id: wonPrize.id,
      name: wonPrize.name,
      type: wonPrize.type,
      amount: wonPrize.amount || 0,
      reward_content: wonPrize.reward_content || null,
      icon: wonPrize.icon
    },
    order: orderRecord,
    new_balance: updatedBalance,
    balance: updatedBalance
  });
});

// Recent winners history (public for live feed)
router.get('/recent', (req, res) => {
  db.read();
  const history = db.get('wheel_history').value() || [];
  // Return last 15 winning spins (exclude empty ones for better hype ticker)
  const winners = history
    .filter(h => h.prize_type !== 'empty')
    .slice(-15)
    .reverse()
    .map(h => {
      // Mask username e.g. "poppy" -> "pop***"
      const u = h.username || 'ผู้เล่น';
      const masked = u.length > 2 ? u.substring(0, 3) + '***' : u + '***';
      return {
        id: h.id,
        username: masked,
        prize_name: h.prize_name,
        prize_type: h.prize_type,
        created_at: h.created_at
      };
    });

  res.json({ success: true, winners });
});

module.exports = router;
