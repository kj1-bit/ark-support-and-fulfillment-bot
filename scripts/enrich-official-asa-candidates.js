const fs = require('fs');
const path = require('path');

const root = process.cwd();
const input = path.join(root, 'data', 'official-asa-reviewed-candidates.json');
const output = path.join(root, 'data', 'official-asa-enriched-candidates.json');
const unresolvedOutput = path.join(root, 'data', 'official-asa-unresolved-candidates.json');
const API = 'https://ark.wiki.gg/api.php';

const noSaddle = new Set([
  'armadoggo','astrocetus','astrodelphis','basilisk','bloodstalker','bulbdog','cat','cosmo','deinonychus',
  'dire-polar-bear','drakeling','dreadmare','elderclaw','featherlight','fenrir','ferox','fjordhawk','gacha',
  'gigadesmodus','gigantoraptor','gloon','glowtail','griffin','jerboa','liopleurodon','maewing','magmasaur',
  'mantis-shrimp','mudpuppy','noglin','oasisaur','parrot','phoenix','reaper-king','rhyniognatha','rock-drake',
  'shadowmane','shinehorn','sinomacrops','solwyn','veilwyn','voidwyrm','vulcanite','wyvern'
]);
const dlc = {
  armadoggo:["Bob's Tall Tales - Wasteland War","ARK: Bob's Tall Tales"],
  cosmo:["Bob's Tall Tales - Steampunk Ascent","ARK: Bob's Tall Tales"],
  oasisaur:["Bob's Tall Tales - Frontier Showdown","ARK: Bob's Tall Tales"],
  burrowbuck:['Fantastic Tames Season 1','ARK Fantastic Tames: Season 1'],
  cerberax:['Fantastic Tames Season 1','ARK Fantastic Tames: Season 1'],
  drakeling:['Fantastic Tames','ARK Fantastic Tames - Drakeling'],
  dreadmare:['Fantastic Tames','ARK Fantastic Tames - Dreadmare'],
  elderclaw:['Fantastic Tames','ARK Fantastic Tames - Elderclaw'],
  'grand-tortugar':['Astraeos','ARK: Astraeos'], boaratos:['Astraeos','ARK: Astraeos'], maeguana:['Astraeos','ARK: Astraeos'],
  aureliax:['Lost Colony','ARK: Lost Colony'], ossidon:['Lost Colony','ARK: Lost Colony'], cryolophosaurus:['Lost Colony','ARK: Lost Colony'],
  gloon:['Lost Colony','ARK: Lost Colony'], solwyn:['Lost Colony','ARK: Lost Colony'], veilwyn:['Lost Colony','ARK: Lost Colony'],
  palaeoctopus:["Bob's True Tales - Tides of Fortune","ARK: Bob's True Tales"],
  tidepup:["Bob's True Tales - Tides of Fortune","ARK: Bob's True Tales"], parrot:["Bob's True Tales - Tides of Fortune","ARK: Bob's True Tales"]
};
function slug(v=''){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function cleanPath(p=''){
  return p.replace(/&(?:#39|apos);/g,"'").replace(/^Blueprint['\"]?/i,'').replace(/['\"]$/,'').replace(/_C$/,'');
}
async function parsedHtml(page) {
  const q = new URLSearchParams({action:'parse',format:'json',page,prop:'text',origin:'*'});
  const r = await fetch(`${API}?${q}`, {headers:{'User-Agent':'ticketbot-catalog-enricher/1.0'}});
  if(!r.ok) throw new Error(`HTTP ${r.status} for ${page}`);
  const j = await r.json();
  if(j.error) throw new Error(`${page}: ${j.error.info || j.error.code}`);
  return j.parse?.text?.['*'] || '';
}
function extractBlueprint(html, entityId) {
  const decoded = html.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
  const paths = [...decoded.matchAll(/Blueprint['"](\/Game\/[^'"]+?)['"]/gi)].map(m=>cleanPath(m[1]));
  if (!paths.length) return null;
  const stem = String(entityId || '').replace(/_C$/,'').toLowerCase();
  return paths.find(p => p.toLowerCase().endsWith('.' + stem)) || paths.find(p => p.toLowerCase().includes('/dinos/')) || paths[0];
}
(async()=>{
  if(!fs.existsSync(input)) throw new Error('Missing data/official-asa-reviewed-candidates.json');
  const records=JSON.parse(fs.readFileSync(input,'utf8'));
  const enriched=[], unresolved=[];
  for(let i=0;i<records.length;i++){
    const r=records[i]; const id=slug(r.name); let blueprint=null; let error=null;
    try { blueprint=extractBlueprint(await parsedHtml(r.page || r.name), r.entityId); }
    catch(e){ error=e.message; }
    if(!blueprint){ unresolved.push({...r,id,error:error||'No blueprint path found'}); console.log(`[${i+1}/${records.length}] unresolved ${r.name}`); continue; }
    const special = r.tameable === '0' || ['oasisaur','fenrir','rhyniognatha'].includes(id);
    const source = dlc[id]?.[0] || 'Official ARK';
    const item={
      id,name:r.name,aliases:[],blueprint,tameable:true,
      supportsGender:r.breedable === '1' && !['oasisaur','fenrir','rhyniognatha','reaper-king'].includes(id),
      saddleApplicable:r.rideable === '1' && !noSaddle.has(id),
      sourceMod:source,
      requiresDlc:Boolean(dlc[id]),
      ...(dlc[id]?{dlcName:dlc[id][1]}:{}),
      deliveryMode:special ? 'single-random' : (r.breedable === '1' ? 'pair' : 'single-random'),
      entityId:r.entityId || null,
      acquisition:r.acquisition || (special?'special':'standard'),
      enabled:true
    };
    enriched.push(item); console.log(`[${i+1}/${records.length}] ${r.name}`);
  }
  fs.writeFileSync(output,JSON.stringify(enriched,null,2)+'\n');
  fs.writeFileSync(unresolvedOutput,JSON.stringify(unresolved,null,2)+'\n');
  console.log(`\nEnriched: ${enriched.length}`);
  console.log(`Unresolved: ${unresolved.length}`);
  console.log(`Wrote ${path.relative(root,output)}`);
  console.log(`Wrote ${path.relative(root,unresolvedOutput)}`);
  if(unresolved.length) process.exitCode=2;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
