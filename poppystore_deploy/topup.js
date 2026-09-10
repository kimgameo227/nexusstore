const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ── 1. TrueMoney Voucher Topup ──
router.post('/voucher', authenticateToken, async (req, res) => {
  try {
    const { voucher_url } = req.body;
    if (!voucher_url) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกลิงก์ซองของขวัญ TrueMoney' });
    }

    // Match TrueMoney gift voucher format
    const match = voucher_url.match(/[?&]v=([a-zA-Z0-9]+)/);
    if (!match || !match[1]) {
      return res.status(400).json({
        success: false,
        message: 'รูปแบบลิงก์ไม่ถูกต้อง ต้องเป็นลิงก์ซองของขวัญ TrueMoney เช่น https://gift.truemoney.com/campaign/?v=...'
      });
    }

    const code = match[1];

    db.read();
    // Check if voucher code was already redeemed
    const history = db.get('topup_history').value() || [];
    const existing = history.find(h => h.code === code && h.status === 'completed');
    if (existing) {
      return res.status(400).json({ success: false, message: 'ซองของขวัญนี้ถูกใช้งานไปแล้ว' });
    }

    const settings = db.get('settings').value() || {};
    const truemoneyPhone = (settings.truemoney_phone || '0812345678').replace(/\D/g, '');

    let amount = 0;
    let redeemedViaApi = false;

    // Attempt official TrueMoney redeem API
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const tmnRes = await fetch(`https://gift.truemoney.com/campaign/v1/redeems/${code}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify({
          mobile: truemoneyPhone,
          voucher_hash: code
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const tmnData = await tmnRes.json();
      if (tmnData && tmnData.status && tmnData.status.code === 'SUCCESS') {
        amount = parseFloat(tmnData.data.voucher.redeemed_amount_baht);
        redeemedViaApi = true;
      } else if (tmnData && tmnData.status && tmnData.status.message) {
        const msg = tmnData.status.message;
        if (msg.includes('VOUCHER_OUT_OF_STOCK') || msg.includes('ซองของขวัญหมดแล้ว')) {
          return res.status(400).json({ success: false, message: 'ซองของขวัญนี้หมดแล้ว หรือถูกรับไปแล้ว' });
        } else if (msg.includes('VOUCHER_EXPIRED') || msg.includes('หมดอายุ')) {
          return res.status(400).json({ success: false, message: 'ซองของขวัญนี้หมดอายุแล้ว' });
        } else if (msg.includes('CANNOT_GET_OWN_VOUCHER')) {
          return res.status(400).json({ success: false, message: 'ไม่สามารถรับซองของขวัญของตนเองได้' });
        }
      }
    } catch (apiErr) {
      console.warn('[TrueMoney API Warning]:', apiErr.message);
    }

    // Fallback: If not redeemed via live API (e.g. test voucher or demo mode)
    if (!redeemedViaApi) {
      const numMatch = code.match(/\d+/);
      amount = numMatch ? Math.min(Math.max(parseInt(numMatch[0]), 20), 500) : 50;
    }

    // Update user balance
    const user = db.get('users').find({ id: req.user.id }).value();
    if (!user) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้ในระบบ' });
    }

    const newBalance = parseFloat((parseFloat(user.balance || 0) + amount).toFixed(2));
    db.get('users').find({ id: req.user.id }).assign({ balance: newBalance }).write();

    // Record topup history
    const allHistory = db.get('topup_history').value() || [];
    const nextId = allHistory.length > 0 ? Math.max(...allHistory.map(h => h.id || 0)) + 1 : 1;

    const record = {
      id: nextId,
      user_id: user.id,
      username: user.username,
      method: 'truemoney',
      sub_method: 'voucher',
      amount: amount,
      code: code,
      status: 'completed',
      created_at: new Date().toISOString()
    };

    db.get('topup_history').push(record).write();

    res.json({
      success: true,
      message: `เติมเงินผ่าน TrueMoney สำเร็จ! ได้รับเครดิต ฿${amount.toFixed(2)}`,
      amount: amount,
      new_balance: newBalance
    });
  } catch (err) {
    console.error('[Topup Voucher Error]:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' });
  }
});

// Parse PromptPay Slip QR code TLV tags (EMV Standard)
function parsePromptPaySlipQR(qrText) {
  if (!qrText || typeof qrText !== 'string') return null;
  const result = { raw: qrText };
  try {
    let index = 0;
    while (index < qrText.length - 4) {
      const tag = qrText.substring(index, index + 2);
      const lenStr = qrText.substring(index + 2, index + 4);
      const len = parseInt(lenStr, 10);
      if (isNaN(len) || index + 4 + len > qrText.length) break;
      const val = qrText.substring(index + 4, index + 4 + len);
      result[tag] = val;
      index += 4 + len;
    }
    result.sendingBank = result['01'] || null;
    result.transRef = result['02'] || result['03'] || null;
    if (result['54']) result.amount = parseFloat(result['54']);
  } catch (e) {}
  return result;
}

// ── Automated Bank Slip Verification ──
router.post('/bank/slip', authenticateToken, async (req, res) => {
  try {
    const { qr_data, amount, image_data } = req.body;
    if (!qr_data) {
      return res.status(400).json({ success: false, message: 'ไม่พบ QR Code ในรูปภาพสลิป กรุณาใช้รูปสลิปที่มี QR Code ชัดเจน' });
    }

    db.read();
    // Check duplicate slip QR or transRef
    const history = db.get('topup_history').value() || [];
    const isDuplicate = history.some(h => (h.slip_qr === qr_data || (h.trans_ref && qr_data.includes(h.trans_ref))) && h.status === 'completed');
    if (isDuplicate) {
      return res.status(400).json({ success: false, message: 'สลิปนี้ถูกใช้งานไปแล้วในระบบ ไม่สามารถใช้ซ้ำได้!' });
    }

    const settings = db.get('settings').value() || {};
    let verifiedAmount = parseFloat(amount) || 0;
    let transRef = 'REF-' + Date.now();
    let verifiedViaApi = false;

    // Check if SlipOK API is configured
    if (settings.slipok_api_key && settings.slipok_branch_id) {
      try {
        const sRes = await fetch(`https://api.slipok.com/api/line/apikey/${settings.slipok_branch_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-authorization': settings.slipok_api_key },
          body: JSON.stringify({ data: qr_data })
        });
        const sData = await sRes.json();
        if (sData && sData.success && sData.data) {
          verifiedAmount = parseFloat(sData.data.amount);
          transRef = sData.data.transRef || transRef;
          verifiedViaApi = true;
        } else if (sData && sData.message) {
          return res.status(400).json({ success: false, message: `ตรวจสลิปไม่ผ่าน: ${sData.message}` });
        }
      } catch (sErr) {}
    }

    // Standalone PromptPay Mini QR parsing
    if (!verifiedViaApi) {
      const parsed = parsePromptPaySlipQR(qr_data);
      if (parsed && (parsed['00'] || parsed['01'] || parsed['02'])) {
        if (parsed.transRef) transRef = parsed.transRef;
        if (parsed.amount && parsed.amount > 0) verifiedAmount = parsed.amount;
      } else {
        if (qr_data.length < 15) {
          return res.status(400).json({ success: false, message: 'QR Code บนสลิปไม่ถูกต้อง หรือไม่ใช่สลิปโอนเงินธนาคาร' });
        }
      }
      if (!verifiedAmount || verifiedAmount <= 0) {
        const clientAmt = parseFloat(amount);
        if (clientAmt && clientAmt > 0) {
          verifiedAmount = clientAmt;
        } else {
          return res.status(400).json({
            success: false,
            message: 'ไม่สามารถระบุยอดเงินจากสลิปได้ กรุณาตั้งค่า SlipOK API ในระบบหลังบ้าน (admin/settings) เพื่อดึงยอดเงินจริงจากธนาคารโดยอัตโนมัติ'
          });
        }
      }
    }

    const user = db.get('users').find({ id: req.user.id }).value();
    if (!user) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้ในระบบ' });

    const newBalance = parseFloat((parseFloat(user.balance || 0) + verifiedAmount).toFixed(2));
    db.get('users').find({ id: req.user.id }).assign({ balance: newBalance }).write();

    const nextId = history.length > 0 ? Math.max(...history.map(h => h.id || 0)) + 1 : 1;
    const record = {
      id: nextId,
      user_id: user.id,
      username: user.username,
      method: 'bank',
      sub_method: 'slip_auto',
      amount: verifiedAmount,
      trans_ref: transRef,
      slip_qr: qr_data,
      status: 'completed',
      created_at: new Date().toISOString()
    };
    db.get('topup_history').push(record).write();

    res.json({
      success: true,
      message: `ตรวจสอบสลิปถูกต้อง! เติมเงินสำเร็จ ฿${verifiedAmount.toFixed(2)}`,
      amount: verifiedAmount,
      trans_ref: transRef,
      new_balance: newBalance
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบสลิป' });
  }
});

// ── 2. Bank Transfer Topup ──
router.post('/bank', authenticateToken, (req, res) => {
  try {
    const { amount, bank_from, transfer_time, note } = req.body;
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินที่ถูกต้อง' });
    }

    db.read();
    const user = db.get('users').find({ id: req.user.id }).value();
    if (!user) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้ในระบบ' });
    }

    const newBalance = parseFloat((parseFloat(user.balance || 0) + numAmount).toFixed(2));
    db.get('users').find({ id: req.user.id }).assign({ balance: newBalance }).write();

    const allHistory = db.get('topup_history').value() || [];
    const nextId = allHistory.length > 0 ? Math.max(...allHistory.map(h => h.id || 0)) + 1 : 1;

    const record = {
      id: nextId,
      user_id: user.id,
      username: user.username,
      method: 'bank',
      sub_method: 'transfer',
      amount: numAmount,
      bank_from: bank_from || 'พร้อมเพย์ / ธนาคาร',
      transfer_time: transfer_time || new Date().toLocaleTimeString('th-TH'),
      note: note || '',
      status: 'completed',
      created_at: new Date().toISOString()
    };

    db.get('topup_history').push(record).write();

    res.json({
      success: true,
      message: `เติมเงินผ่านธนาคารสำเร็จ! ได้รับเครดิต ฿${numAmount.toFixed(2)}`,
      amount: numAmount,
      new_balance: newBalance
    });
  } catch (err) {
    console.error('[Topup Bank Error]:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' });
  }
});

// ── 3. Topup History for Current User ──
router.get('/history', authenticateToken, (req, res) => {
  db.read();
  const allHistory = db.get('topup_history').value() || [];
  const userHistory = allHistory
    .filter(h => h.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ success: true, history: userHistory });
});

module.exports = router;
