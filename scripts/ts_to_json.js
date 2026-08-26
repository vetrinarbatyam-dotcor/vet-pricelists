// eval() is intentional: input is our own trusted TS catalog source files (object-literal arrays), run offline at build time only.
// Extract exported array literals from the canonical TS catalogs → JSON (eval of literals only).
const fs = require('fs'), path = require('path');
const C = path.join(__dirname, '..', '_canonical');
function arr(file, name) {
  const s = fs.readFileSync(path.join(C, file), 'utf8');
  const re = new RegExp(name + '[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];');
  const m = s.match(re);
  if (!m) throw new Error(name + ' not found in ' + file);
  return eval('[' + m[1] + ']');
}
const out = {
  beit_erez: arr('beitErezCatalog.ts', 'beitErezItems'),
  vetmarket: arr('vetmarketCatalog.ts', 'vetmarketItems'),
  medimarket_ts: arr('medimarketCatalog.ts', 'medimarketItems'),
  petvet: arr('medimarketCatalog.ts', 'petvetBiomedItems'),
};
for (const k in out) {
  fs.writeFileSync(path.join(C, k + '.json'), JSON.stringify(out[k]), 'utf8');
  console.log(k, out[k].length);
}
