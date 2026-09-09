const fs = require('fs');
const path = require('path');

const files = [
  'middleware/auth.js',
  'routes/auth.js',
  'routes/products.js',
  'routes/topup.js',
  'routes/wheel.js',
  'routes/admin.js'
];

for (const f of files) {
  const p = path.join('d:/AiALL/6', f);
  console.log(f, fs.existsSync(p), fs.statSync(p).size);
}
