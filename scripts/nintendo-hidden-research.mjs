// Read-only inspection for the owner's September Nintendo supplier batch.
// Only SELECT statements are sent; no supplier costs or private records are logged.
import { readFileSync, writeFileSync } from 'node:fs';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const db = process.env.CLOUDFLARE_D1_DATABASE_ID || /"database_id":\s*"([^"]+)"/.exec(readFileSync('wrangler.jsonc','utf8'))?.[1];
const report = { checkedAt: new Date().toISOString(), d1Accessible: false, r2Accessible: false, products: [] };
try {
  if (!account || !token || !db) throw new Error('Required Cloudflare connection is not configured');
  const call = async (suffix, body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${suffix}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000),
    });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(`Cloudflare request failed: HTTP ${response.status}; codes ${(result.errors || []).map(e=>e.code).join(',')}`);
    return result.result;
  };
  const stats=await call(`d1/database/${db}/query`,{sql:"SELECT count(*) AS row_count FROM store_kv"});
  report.storeKvRows=stats.flatMap(x=>x.results||[]);
  const schema=await call(`d1/database/${db}/query`,{sql:"SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%product%' OR name LIKE '%store%')"});
  report.productTableNames=schema.flatMap(x=>x.results||[]);
  const results = await call(`d1/database/${db}/query`, { sql: "SELECT key, value FROM store_kv WHERE key='store:products' OR key LIKE 'store:products#%' OR key LIKE 'store:product:%' ORDER BY key" });
  const rows = results.flatMap(x=>x.results || []);
  report.d1Accessible = true;
  const chunks = rows.filter(r=>/^store:products(?:#\d+)?$/.test(r.key)).sort((a,b)=>Number(a.key.split('#')[1]||-1)-Number(b.key.split('#')[1]||-1));
  const numbered = chunks.filter(r=>r.key.includes('#'));
  const aggregate = (numbered.length ? numbered : chunks).map(r=>r.value).join('');
  const live = new Map(JSON.parse(aggregate || '[]').filter(p=>p?.id).map(p=>[p.id,p]));
  for (const row of rows.filter(r=>r.key.startsWith('store:product:'))) {
    const p=JSON.parse(row.value);
    if (p._deleted) live.delete(p.id); else if(p.id) live.set(p.id,p);
  }
  report.catalogueRows=rows.length;
  report.liveProducts=live.size;
  if(report.productTableNames.some(x=>x.name==='product_index')){
    const idx=await call(`d1/database/${db}/query`,{sql:"SELECT count(*) AS row_count FROM product_index"});
    report.productIndexRows=idx.flatMap(x=>x.results||[]);
  }
  const pattern = /katana|shovel|tales.of.arise|rune.factory.4|vesperia|luminous.avenger|virche|fuyuzono|winter.*sacrifice|triangle.strategy|elliot|sky.*2nd|danganronpa.*2|nobunaga|star.fox|ryza|divinity|onimusha|crash.bandicoot|titans.of.the.tide|luigi.*mansion.2/i;
  for (const p of live.values()) {
    if (!pattern.test(`${p.title} ${p.titleEn} ${p.slug}`)) continue;
    report.products.push({ id:p.id,title:p.titleEn||p.title,slug:p.slug,platform:p.platform,isHidden:p.isHidden===true,nsuid:p.nsuid||'',frontCover:p.cartridgeImage||'',square:p.nintendoCardImage||'',cover:p.coverImage||'',banners:p.bannerImages||[],gallery:p.galleryImages||p.gallery||[],hasDescription:!!p.description,hasPerformance:!!p.devicePerformance });
  }
  try { await call('r2/buckets/bananto-private'); report.r2Accessible=true; } catch(e) { report.r2Error=e.message; }
  console.log(JSON.stringify({ ...report,products:report.products.map(p=>({id:p.id,title:p.title,platform:p.platform,isHidden:p.isHidden})),matchingProducts:report.products.length }));
} catch (e) {
  report.error = e.message;
  console.error(report.error);
  process.exitCode = 1;
} finally { writeFileSync('nintendo-hidden-access-audit.json',JSON.stringify(report,null,2)); }
