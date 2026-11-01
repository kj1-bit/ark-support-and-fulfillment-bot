const fs = require('fs');
const path = require('path');

const root = process.cwd();
const catalogPath = path.join(root, 'data', 'dino-catalog.json');
const outManifest = path.join(root, 'data', 'official-asa-tames-source.json');
const outMissing = path.join(root, 'data', 'official-asa-tames-missing.json');
const outRaw = path.join(root, 'data', 'official-asa-creatures-raw.json');
const API = 'https://ark.wiki.gg/api.php';
const blocked = /(?:^|[\s_\/-])(alpha|astral|boss|minion|mission|outpost|summoned|corrupt(?:ed)?|ghost|zombie|cave|test|brute|malfunctioned|enraged)(?:$|[\s_\/-])/i;

function normalize(value = '') { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function slug(value = '') { return normalize(value).replace(/ /g, '-'); }
function hasRelease(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v !== '' && !['0', 'no', 'false', 'n/a', 'unreleased', 'tba'].includes(v);
}
function isYes(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return ['1', 'yes', 'true', 'y'].includes(v);
}
async function cargo(fields, offset = 0) {
  const params = new URLSearchParams({
    action: 'cargoquery', format: 'json', tables: 'Creatures', fields,
    order_by: '_pageName', limit: '500', offset: String(offset), origin: '*'
  });
  const response = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'ticketbot-catalog-audit/2.0' } });
  if (!response.ok) throw new Error(`ARK Wiki request failed: HTTP ${response.status}`);
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`ARK Wiki returned non-JSON: ${text.slice(0, 300)}`); }
  if (json.error) throw new Error(`ARK Wiki Cargo error: ${json.error.info || json.error.code}`);
  return json.cargoquery || [];
}

(async () => {
  if (!fs.existsSync(catalogPath)) throw new Error('Run this from the ticketbot repository root.');
  const fields = '_pageName=page,Name=name,ReleasedASA=asa,Tameable=tameable,Rideable=rideable,Breedable=breedable,Saddle=saddle,EntityId=entityId';
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await cargo(fields, offset);
    all.push(...rows.map(x => x.title || {}));
    if (rows.length < 500) break;
  }
  if (!all.length) {
    const probe = await cargo('_pageName=page', 0);
    throw new Error(`Cargo table responded but returned no creature rows. Probe rows: ${probe.length}`);
  }
  fs.writeFileSync(outRaw, JSON.stringify(all, null, 2) + '\n');

  const releasedTameable = all.filter(r => hasRelease(r.asa) && isYes(r.tameable));
  if (!releasedTameable.length) {
    const sample = all.slice(0, 10).map(r => ({ page: r.page, asa: r.asa, tameable: r.tameable }));
    throw new Error(`Fetched ${all.length} rows, but local filtering found none. Sample: ${JSON.stringify(sample)}`);
  }

  const manifest = releasedTameable.map(row => {
    const name = row.name || row.page;
    const entityId = row.entityId || null;
    const excluded = blocked.test(`${name} ${entityId || ''}`);
    return {
      id: slug(name), name, releasedInAsa: true, tameable: true,
      rideable: isYes(row.rideable), breedable: isYes(row.breedable),
      saddle: row.saddle || null, entityId,
      decision: excluded ? 'excluded-variant' : 'required-base-candidate',
      reason: excluded ? 'Blocked variant or non-base form' : null,
      sourcePage: row.page || null
    };
  });

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const searchable = new Set();
  for (const c of catalog) for (const term of [c.id, c.name, ...(c.aliases || [])]) searchable.add(normalize(term));
  const missing = manifest.filter(x => x.decision === 'required-base-candidate' && !searchable.has(normalize(x.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(outManifest, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(outMissing, JSON.stringify(missing, null, 2) + '\n');
  console.log(`Raw creature rows fetched: ${all.length}`);
  console.log(`Official released tameable ASA rows: ${manifest.length}`);
  console.log(`Base candidates after blocked-variant filter: ${manifest.filter(x => x.decision === 'required-base-candidate').length}`);
  console.log(`Missing from Ticketbot by name/alias: ${missing.length}`);
  console.log(`Wrote ${path.relative(root, outRaw)}`);
  console.log(`Wrote ${path.relative(root, outManifest)}`);
  console.log(`Wrote ${path.relative(root, outMissing)}`);
  if (missing.length) console.log('\nMissing candidates:\n' + missing.map(x => `- ${x.name} | ${x.entityId || 'no entity ID'}`).join('\n'));
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
