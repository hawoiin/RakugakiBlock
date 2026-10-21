/**
 * らくがきブロック フェーズ2 サーバー
 * - 世界はサーバーが保持。全員が参加者として入る（ホスト役なし）
 * - 管理者合言葉は .env / 環境変数 ADMIN_PASSWORD（未設定なら管理者機能オフ）
 * - 偽の権限コマンドはサーバー側で拒否
 */
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fsEarly = require('fs');
const pathEarly = require('path');

// .env 読み込み（依存なし）。既に環境変数があれば優先
try {
  const envText = fsEarly.readFileSync(pathEarly.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch (e) { /* no .env */ }

// ===== 設定 =====
const PORT = process.env.PORT || 3040;
/** 未設定なら管理者機能オフ（ソースに既定合言葉は置かない） */
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || '').trim();
const MAX_PLAYERS = 32; // 単一部屋の人数上限
const VER = 15; // 胞子吐きの歩行状態を含むクライアント互換用プロトコル番号。洞窟バージョンは別管理
const NATURAL_CAVE_VERSION = 3;
/** クライアントのブロックIDに合わせる（0=空気、1..14=設置可能） */
const MAX_BLOCK_ID = Number(process.env.MAX_BLOCK_ID) || 14; // 1..13 + スライム=14
/** リバースプロキシの段数。直接公開なら 0（X-Forwarded-For を信じない） */
const TRUST_PROXY_HOPS = (() => {
  const v = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!v || v === '0' || v === 'false' || v === 'no') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5) : 0;
})();
const ALLOW_ANY_ORIGIN = process.env.ALLOW_ANY_ORIGIN === '1' || process.env.ALLOW_ANY_ORIGIN === 'true';
const EXTRA_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

// お題リスト（おえかき用・くすっと系）
const TOPICS = [
  'たぶん魚',
  '絶対に入りたくない家',
  '強そうだけど弱そう',
  'かわいいのに怖い',
  '怖いのにかわいい',
  '何をしているのか分からない人',
  '存在してはいけない家具',
  '怒っている野菜',
  '自信満々な石',
  '遅刻しそうな雲',
  '優しすぎるモンスター',
  '仕事をサボっているロボット',
  '夜中に運動している家具',
  '秘密を知っている猫',
  '世界一しょぼい勇者',
  '売れ残った魔法の杖',
  '人間に化けた椅子',
  '考えすぎている鳥',
  '道に迷った幽霊',
  'プロ意識の高いスライム',
  '貯金がない龍',
  '自分を過大評価している虫',
  '告白に失敗した花',
  '休憩中の死神',
  '今日は雨が嫌な傘',
  'まだ名前がない生き物',
  '誰かの夢に出てきた建物',
  '一口だけ食べられたケーキ',
  '筋トレしているパン',
  '電話に出たくない人型',
];
const TOPIC_INTERVAL_MS = 5 * 60 * 1000; // 5分で自動更新

function pickTopic(exclude) {
  let t;
  do {
    t = TOPICS[(Math.random() * TOPICS.length) | 0];
  } while (TOPICS.length > 1 && t === exclude);
  return t;
}


const JOIN_PASSWORD = process.env.JOIN_PASSWORD || ''; // 任意: 入場パスワード
const KICK_BAN_MS = 15 * 60 * 1000; // キック後の再入場禁止
const AUTH_LOCK_MS = 5 * 60 * 1000; // 合言葉失敗ロック
const AUTH_MAX_FAIL = 5;
const MAX_MSG_BYTES = 4 * 1024 * 1024; // ワールド読み込みを含む受信上限（4 MiB）
const MAX_PEN_BATCH = 400; // 1回の描画ピクセル数上限

// ===== 荒らし対策 =====
const ipBans = new Map(); // ip -> until timestamp
const authFails = new Map(); // ip -> { n, until }

/** 管理者合言葉の照合（未設定なら常に失敗。ハッシュ化してから定数時間比較） */
function passwordMatches(input) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function originHost(origin) {
  try { return new URL(origin).host.toLowerCase(); } catch (e) { return ''; }
}

/** ブラウザの Origin が自分のサーバ（または許可リスト）か */
function isAllowedOrigin(req) {
  if (ALLOW_ANY_ORIGIN) return true;
  const origin = req && req.headers && req.headers.origin;
  // 非ブラウザ等で Origin が無い場合は同一マシン用途として許可
  if (!origin) return true;
  if (EXTRA_ORIGINS.has(origin)) return true;
  try {
    const oh = originHost(origin);
    if (!oh) return false;
    if (oh === 'localhost' || oh.startsWith('localhost:') || oh === '127.0.0.1' || oh.startsWith('127.0.0.1:')) return true;
    const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim().toLowerCase();
    if (host && (oh === host || oh === host.replace(/:\d+$/, '') || host.startsWith(oh))) return true;
    // host にポート付き、origin にもポート付きの一致
    if (host && oh === host) return true;
  } catch (e) {}
  return false;
}

function clientIp(req) {
  const sock = String((req && req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') || 'unknown';
  // プロキシ経由のときだけ X-Forwarded-For を使う（直接公開では偽装防止のため無視）
  if (TRUST_PROXY_HOPS > 0) {
    const xf = req && req.headers && req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) {
      const list = xf.split(',').map((x) => x.trim()).filter(Boolean);
      // プロキシが後ろに付けた値だけ信頼（先頭はクライアントが偽れる）
      const ip = list[Math.max(0, list.length - TRUST_PROXY_HOPS)];
      if (ip) return ip.replace(/^::ffff:/, '');
    }
  }
  return sock;
}

function isBanned(ip) {
  const until = ipBans.get(ip);
  if (!until) return false;
  if (Date.now() >= until) { ipBans.delete(ip); return false; }
  return true;
}

function banIp(ip, ms, reason) {
  const until = Date.now() + ms;
  ipBans.set(ip, until);
  console.log(`[ban] ${ip} ${Math.round(ms / 1000)}s (${reason})`);
}

function authLocked(ip) {
  const e = authFails.get(ip);
  if (!e) return false;
  if (e.until && Date.now() < e.until) return true;
  if (e.until && Date.now() >= e.until) { authFails.delete(ip); return false; }
  return false;
}

function noteAuthFail(ip) {
  const e = authFails.get(ip) || { n: 0, until: 0 };
  e.n += 1;
  if (e.n >= AUTH_MAX_FAIL) {
    e.until = Date.now() + AUTH_LOCK_MS;
    e.n = 0;
    console.log(`[auth] lock ${ip} for ${AUTH_LOCK_MS / 1000}s`);
  }
  authFails.set(ip, e);
  return e.until && Date.now() < e.until;
}

function clearAuthFail(ip) {
  authFails.delete(ip);
}

/** 簡易レート制限: limit 回 / windowMs */
function rateOk(bucket, key, limit, windowMs) {
  const now = Date.now();
  let a = bucket.get(key);
  if (!a || now - a.t > windowMs) { a = { t: now, n: 0 }; bucket.set(key, a); }
  a.n += 1;
  return a.n <= limit;
}

const ratePen = new Map();
const rateBlk = new Map();
const rateChat = new Map();
const ratePos = new Map();
const rateAuth = new Map();
const rateWorld = new Map(); // 管理者ワールド読み込みの連続実行を抑制

// 古いレート記録の掃除
setInterval(() => {
  const now = Date.now();
  for (const map of [ratePen, rateBlk, rateChat, ratePos, rateAuth, rateWorld, ipBans, authFails]) {
    for (const [k, v] of map) {
      if (typeof v === 'number' && now >= v) map.delete(k);
      else if (v && v.t && now - v.t > 60000) map.delete(k);
      else if (v && v.until && now >= v.until && !v.n) map.delete(k);
    }
  }
}, 60000);

const W = 64, H = 32, D = 64;
const TS = 32, PX = TS * TS;
const WORLD_CELLS = W * H * D;
const MAX_WORLD_KEYS = 4096;
// サーバーのバックアップは最大4096面を保持できる。外部からの読み込みには別途2 MiB制限を適用。
const MAX_WORLD_SNAPSHOT_DATA_CHARS = Math.ceil(MAX_WORLD_KEYS * PX * 2 / 3) * 4;
const MAX_WORLD_UPLOAD_DATA_CHARS = 2 * 1024 * 1024;
const idx = (x, y, z) => x + z * W + y * W * D;

function validPaintKey(key) {
  if (typeof key !== 'string' || key.length > 32) return false;
  const m = /^(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*),([0-5])$/.exec(key);
  if (!m) return false;
  const x = Number(m[1]), y = Number(m[2]), z = Number(m[3]);
  return x < W && y < H && z < D;
}

/** Validate before mutating the live room; return a byte-aligned copy of paint data. */
function validateWorldSnapshot(m) {
  if (!m || !Array.isArray(m.rle) || !Array.isArray(m.keys) || typeof m.data !== 'string')
    throw new Error('必要なデータがありません');
  if (!m.rle.length || m.rle.length % 2 !== 0 || m.rle.length > WORLD_CELLS * 2)
    throw new Error('ブロックデータの形式が不正です');
  let cells = 0;
  for (let i = 0; i < m.rle.length; i += 2) {
    const block = m.rle[i], count = m.rle[i + 1];
    if (!Number.isInteger(block) || block < 0 || block > MAX_BLOCK_ID ||
        !Number.isInteger(count) || count < 1 || count > WORLD_CELLS)
      throw new Error('ブロックデータの値が不正です');
    cells += count;
    if (cells > WORLD_CELLS) throw new Error('ブロック数が上限を超えています');
  }
  if (cells !== WORLD_CELLS) throw new Error('ブロックデータの長さが一致しません');
  if (m.keys.length > MAX_WORLD_KEYS) throw new Error('落書き面の数が上限を超えています');
  if (m.data.length > MAX_WORLD_SNAPSHOT_DATA_CHARS || m.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(m.data))
    throw new Error('落書きデータの形式または容量が不正です');
  const seen = new Set();
  for (const key of m.keys) {
    if (!validPaintKey(key) || seen.has(key)) throw new Error('落書きの座標が不正です');
    seen.add(key);
  }
  const decoded = Buffer.from(m.data, 'base64');
  if (decoded.length !== m.keys.length * PX * 2) throw new Error('落書きデータの長さが一致しません');
  return Buffer.from(decoded);
}

// 簡易ノイズ（シードなし・決定的）
function noise2(x, z) {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
function fbm(x, z, oct) {
  let v = 0, a = 1, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    v += a * noise2(x * f, z * f);
    s += a;
    a *= 0.5;
    f *= 2.1;
  }
  return v / s;
}

/**
 * 地形生成（一から見直し版）
 * 方針: なめらかな丘陵 + 川1本 + おえかき広場中心 + 控えめな木
 * ブロック: 1草 2土 3石 4木 7砂 8水 9葉
 */
function genTerrain(theme, withCave = true) {
  theme = theme || 'nature';
  if (theme === 'paper') return genTerrainPaper();
  if (theme === 'toy') return genTerrainToy();
  return genTerrainNature(withCave);
}

// 洞窟はクライアント版と同じ座標・形状で生成し、同期ワールドの差異を防ぐ。
function makeNaturalCaveEdits(world){
  const edits=new Map();
  const inside=(x,y,z)=>x>=0&&x<W&&y>=0&&y<H&&z>=0&&z<D;
  const air=(x,y,z)=>{if(inside(x,y,z))edits.set(idx(x,y,z),0)};
  // 意図した装飾は、元の地形が空気の場所にも明示的に置ける。
  const put=(x,y,z,b)=>{if(inside(x,y,z))edits.set(idx(x,y,z),b)};

  // 西斜面から入る主通路。幅・天井高・中心線を少しずつ変えて四角い管に見せない。
  for(let x=2;x<=15;x++){
    const t=x-2;
    const centerZ=9+Math.round(Math.sin(t*.43)*.72+Math.sin(t*.91)*.28);
    const width=(x>4&&x<14&&noise2(x*2.1,9.7)>.68)?2:1;
    const roof=11+Math.floor((Math.sin(x*.79)+1)*.95);
    for(let z=centerZ-width;z<=centerZ+width;z++){
      const edge=Math.abs(z-centerZ)===width;
      const localRoof=Math.max(10,roof-(edge?1:0));
      for(let y=9;y<=localRoof;y++)air(x,y,z);
    }
  }

  // 北側の結晶室へ曲がって入る通路。
  for(let z=8;z>=5;z--){
    const centerX=10+Math.round(Math.sin(z*.72)*.55);
    const roof=11+(z%2);
    for(let x=centerX-1;x<=centerX+1;x++){
      const localRoof=roof-(Math.abs(x-centerX)===1?1:0);
      for(let y=9;y<=localRoof;y++)air(x,y,z);
    }
  }

  // 南東の低い脇道。中心線をずらし、天井の高さも交互に変える。
  for(let z=9;z<=14;z++){
    const centerX=13+Math.round(Math.sin(z*.72)*.65);
    const roof=10+((z%3)===0?2:1);
    for(let x=centerX-1;x<=centerX+1;x++){
      const localRoof=roof-(Math.abs(x-centerX)===1?1:0);
      for(let y=9;y<=localRoof;y++)air(x,y,z);
    }
  }

  // 中央広間。外周に小さな凹凸を加え、天井は中央ほど高くする。
  for(let x=10;x<=20;x++)for(let z=5;z<=13;z++){
    const r=((x-15)/4.8)**2+((z-9)/3.35)**2;
    const edgeWobble=(noise2(x*1.73+4.2,z*1.51+8.1)-.5)*.20;
    if(r>1+edgeWobble)continue;
    const roof=11+Math.floor(4*(1-Math.min(r,1)))+(noise2(x*1.37,z*1.61)>.82?1:0);
    for(let y=9;y<=roof;y++)air(x,y,z);
  }

  // 北の結晶室。壁際は曲線的にし、中央の通り抜け幅を残す。
  for(let x=7;x<=13;x++)for(let z=2;z<=7;z++){
    const r=((x-10)/3.35)**2+((z-4.3)/2.55)**2;
    const edgeWobble=(noise2(x*2.17+21,z*1.83+5)-.5)*.15;
    if(r>1+edgeWobble)continue;
    const roof=11+Math.floor(1.8*(1-Math.min(r,1)))+(noise2(x+32,z+11)>.86?1:0);
    for(let y=9;y<=roof;y++)air(x,y,z);
  }

  // 南の小部屋。低い天井とずれた輪郭で、広間との景色を変える。
  for(let x=11;x<=16;x++)for(let z=12;z<=17;z++){
    const r=((x-13.5)/2.45)**2+((z-14.5)/2.75)**2;
    const edgeWobble=(noise2(x*1.41+17,z*2.03+3)-.5)*.13;
    if(r>1+edgeWobble)continue;
    const roof=10+Math.floor(2*(1-Math.min(r,1)));
    for(let y=9;y<=roof;y++)air(x,y,z);
  }

  // 広間の東側に短い鉱脈の行き止まりを追加。主通路とは別の探索先になる。
  for(let x=18;x<=23;x++){
    const centerZ=9+Math.round(Math.sin(x*.47)*.45);
    const roof=11+((x%3)===0?1:0);
    for(let z=centerZ-1;z<=centerZ+1;z++){
      const localRoof=roof-(Math.abs(z-centerZ)===1?1:0);
      for(let y=9;y<=localRoof;y++)air(x,y,z);
    }
  }
  for(let x=21;x<=25;x++)for(let z=7;z<=11;z++){
    const r=((x-23)/2.15)**2+((z-9)/2.0)**2;
    const edgeWobble=(noise2(x*1.9+9,z*1.4+2)-.5)*.12;
    if(r>1+edgeWobble)continue;
    const roof=11+Math.floor(2*(1-Math.min(r,1)));
    for(let y=9;y<=roof;y++)air(x,y,z);
  }

  // 入口の赤レンガ枠。ID 6 がレンガ（ID 5 は白ブロック）。
  for(let y=9;y<=12;y++){put(2,y,7,6);put(2,y,11,6)}
  for(let z=8;z<=10;z++)put(2,12,z,6);

  // 天井につながる鍾乳石と、壁際の小さな岩。通路中央はふさがない。
  for(const [x,y,z] of [[14,12,7],[14,13,7],[17,12,10],[17,13,10],[12,9,7],[18,9,11]])put(x,y,z,3);

  // 壁に埋め込む金鉱脈。ID 12 が金、ID 11 は黒ブロック。
  for(const [x,y,z] of [[22,10,11],[22,11,11],[23,10,11],[15,10,5],[16,10,5],[15,11,5],[13,10,18],[14,10,18]])put(x,y,z,12);

  // 結晶室の壁際に氷の結晶群。ID 13 が氷、通路中央を避けて配置。
  for(const [x,y,z] of [[8,9,3],[8,10,3],[8,11,3],[8,9,4],[8,10,4],[9,9,3],[9,10,3],[12,9,5],[12,10,5]])put(x,y,z,13);

  return edits;
}
// v20.138 洞窟拡張。既存洞窟の東端(x=25)から接続する追加区画のみを編集する。
// 高さは地表から最低2ブロックを残すよう制限し、地表に穴が開かないようにする。
function makeNaturalCaveExtensionEdits(w){
 const edits=new Map();
 const inside=(x,y,z)=>x>=26&&x<W&&y>=0&&y<H&&z>=0&&z<D;
 const air=(x,y,z)=>{if(inside(x,y,z))edits.set(idx(x,y,z),0)};
 const put=(x,y,z,b)=>{if(inside(x,y,z))edits.set(idx(x,y,z),b)};
 const groundTop=(x,z)=>{
  for(let y=H-1;y>=0;y--){const b=w[idx(x,y,z)];if(b===1||b===2||b===3||b===7)return y;}
  return -1;
 };
 const carveColumn=(x,z,desiredRoof)=>{
  const top=groundTop(x,z);
  // 12未満では、床(y=8)の上にプレイヤーが通れる高さと天井の厚みを両立できない。
  if(top<12)return;
  const roof=Math.min(desiredRoof,top-2);
  if(roof<10)return;
  for(let y=9;y<=roof;y++)air(x,y,z);
 };

 // 既存の鉱脈行き止まり(x=25)から続く、わずかに曲がる3ブロック高の通路。
 for(let x=26;x<=31;x++){
  const t=x-26;
  const centerZ=9+Math.round(Math.sin(t*.58)*.55+Math.sin(t*.91)*.18);
  const wide=(x===29||x===30)?2:1;
  for(let z=centerZ-wide;z<=centerZ+wide;z++){
   const edge=Math.abs(z-centerZ);
   carveColumn(x,z,edge===wide?10:11);
  }
 }

 // 東側の主空洞。外周を不規則にし、天井高にも少し変化をつける。
 for(let x=30;x<=36;x++)for(let z=7;z<=12;z++){
  const r=((x-33.1)/3.25)**2+((z-9.25)/2.65)**2;
  const wobble=(noise2(x*1.91+37,z*1.47+11)-.5)*.16;
  if(r>1+wobble)continue;
  const roof=10+Math.floor(2*(1-Math.min(r,1))+(noise2(x*1.21,z*1.73)>.84?1:0));
  carveColumn(x,z,roof);
 }

 // 北側の分岐。中央広間から狭い曲がり道を抜けて、別の小部屋へつながる。
 for(let z=7;z>=4;z--){
  const centerX=33+Math.round(Math.sin(z*.68)*.58);
  for(let x=centerX-1;x<=centerX+1;x++){
   const edge=Math.abs(x-centerX);
   carveColumn(x,z,edge?10:11);
  }
 }
 for(let x=31;x<=35;x++)for(let z=3;z<=6;z++){
  const r=((x-33.0)/2.35)**2+((z-4.45)/1.75)**2;
  const wobble=(noise2(x*2.31+5,z*1.63+29)-.5)*.13;
  if(r>1+wobble)continue;
  const roof=11+Math.floor(1.5*(1-Math.min(r,1)));
  carveColumn(x,z,roof);
 }

 // 新しい小部屋の壁際にだけ、結晶と金鉱脈を少量配置。中央の通路は塞がない。
 for(const [x,y,z] of [[31,9,4],[31,10,4],[32,9,3],[32,10,3]])put(x,y,z,13);
 for(const [x,y,z] of [[37,10,9],[37,11,9],[37,10,10]])put(x,y,z,12);
 return edits;
}


function makeNaturalCaveEditsV1(world) {
  const edits = new Map();
  const air = (x, y, z) => { if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) edits.set(idx(x, y, z), 0); };
  const block = (x, y, z, b) => { if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D && world[idx(x, y, z)] !== 0) edits.set(idx(x, y, z), b); };
  for (let x = 2; x <= 14; x++) for (let z = 8; z <= 10; z++) for (let y = 9; y <= 11; y++) air(x, y, z);
  for (let z = 5; z <= 9; z++) for (let x = 9; x <= 11; x++) for (let y = 9; y <= 11; y++) air(x, y, z);
  for (let z = 9; z <= 13; z++) for (let x = 12; x <= 14; x++) for (let y = 9; y <= 11; y++) air(x, y, z);
  for (let x = 11; x <= 19; x++) for (let z = 6; z <= 12; z++) {
    const r = ((x - 15) / 4) ** 2 + ((z - 9) / 3) ** 2;
    if (r > 1) continue;
    const roof = 9 + 2 + Math.floor(3 * (1 - r));
    for (let y = 9; y <= roof; y++) air(x, y, z);
  }
  for (let x = 7; x <= 13; x++) for (let z = 2; z <= 6; z++) {
    const r = ((x - 10) / 3) ** 2 + ((z - 4) / 2) ** 2;
    if (r > 1) continue;
    const roof = 9 + 2 + Math.floor(1 * (1 - r));
    for (let y = 9; y <= roof; y++) air(x, y, z);
  }
  for (let x = 11; x <= 15; x++) for (let z = 12; z <= 16; z++) {
    const r = ((x - 13) / 2) ** 2 + ((z - 14) / 2) ** 2;
    if (r > 1) continue;
    const roof = 9 + 2 + Math.floor(1.5 * (1 - r));
    for (let y = 9; y <= roof; y++) air(x, y, z);
  }
  for (let y = 9; y <= 12; y++) { block(2, y, 7, 5); block(2, y, 11, 5); }
  for (let z = 8; z <= 10; z++) block(2, 12, z, 5);
  for (const [x, y, z] of [[20, 10, 9], [20, 11, 9], [21, 10, 9], [16, 11, 6], [13, 11, 16]]) block(x, y, z, 11);
  for (const [x, y, z] of [[8, 9, 4], [8, 10, 4], [8, 11, 4], [9, 9, 3], [9, 10, 3]]) {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) edits.set(idx(x, y, z), 12);
  }
  return edits;
}
function applyNaturalCave(world) {
  for (const [at, block] of makeNaturalCaveEdits(world)) world[at] = block;
  for (const [at, block] of makeNaturalCaveExtensionEdits(world)) world[at] = block;
}
function applyNaturalCaveSafely(world, baseline, previousVersion = 0) {
  const edits = makeNaturalCaveEdits(baseline);
  const extension = makeNaturalCaveExtensionEdits(baseline);

  // v2ワールドは既存洞窟を保持し、追加区画だけを未編集の場合に導入する。
  if (previousVersion >= 2) {
    for (const at of extension.keys()) if (world[at] !== baseline[at]) return false;
    for (const [at, block] of extension) if (baseline[at] !== block) world[at] = block;
    return true;
  }

  const allEdits = new Map([...edits, ...extension]);
  if (previousVersion === 1) {
    // v1洞窟のままかを確認してからだけ差し替える。洞窟内を誰かが編集していたら保持する。
    const oldEdits = makeNaturalCaveEditsV1(baseline);
    const expectedOld = new Uint8Array(baseline);
    for (const [at, block] of oldEdits) expectedOld[at] = block;
    for (const at of oldEdits.keys()) if (world[at] !== expectedOld[at]) return false;
    const oldKeys = new Set(oldEdits.keys());
    for (const at of allEdits.keys()) if (!oldKeys.has(at) && world[at] !== baseline[at]) return false;
    for (const at of oldEdits.keys()) world[at] = baseline[at];
    for (const [at, block] of allEdits) world[at] = block;
    return true;
  }
  // v0/未導入ワールドは既存洞窟と追加区画の全予定地に編集がない場合のみ追加する。
  for (const at of allEdits.keys()) if (world[at] !== baseline[at]) return false;
  for (const [at, block] of allEdits) if (baseline[at] !== block) world[at] = block;
  return true;
}
// Shared telephone-game terminal. Keep this voxel layout and candidate search in sync with game.js.
const PHONE_STATION_VERSION = 3;
function phoneSpawnForTheme(theme) {
  return theme === 'paper' ? { x: 30, z: 50 } : theme === 'toy' ? { x: 30, z: 52 } : { x: 28, z: 50 };
}
function phoneStationTarget(theme) {
  return theme === 'paper' ? { x: 41, z: 54 } : theme === 'toy' ? { x: 41, z: 56 } : { x: 39, z: 50 };
}
function phoneSurfaceY(world, x, z) {
  for (let y = H - 1; y >= 0; y--) {
    const b = world[idx(x, y, z)];
    if (b && b !== 8) return y;
  }
  return -1;
}
function legacyPhoneStationBlockId(dx, y, baseY) {
  const edge = Math.abs(dx) === 2 || y === baseY + 2 || y === baseY + 5;
  if (edge) return 11;
  if (y === baseY + 3) return Math.abs(dx) === 1 ? 4 : 5;
  if (y === baseY + 4) return Math.abs(dx) === 1 ? 4 : 10;
  return 10;
}
function phoneStationBlockId(dx, dzOffset, y, baseY) {
  // Simple machine cabinet: a gray stone footing and a uniform dark body.
  // The pixel-art screen is a separate overlay; avoid arbitrary gold accent blocks.
  if (y === baseY + 1) return 3;
  return 11;
}
function phoneStationPlan(world, cx, cz) {
  const baseY = phoneSurfaceY(world, cx, cz);
  if (baseY < 7 || baseY > 10 || baseY + 3 >= H) return null;
  for (let dx = -1; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
    const x = cx + dx, z = cz + dz;
    if (x < 1 || x >= W - 1 || z < 1 || z >= D - 1 || phoneSurfaceY(world, x, z) !== baseY) return null;
    const ground = world[idx(x, baseY, z)];
    if (!ground || ground === 8) return null;
    for (let y = baseY + 1; y <= baseY + 3; y++) if (world[idx(x, y, z)]) return null;
  }
  return { x: cx, z: cz, baseY, version: PHONE_STATION_VERSION };
}
function hasLegacyPhoneStation(world, station) {
  if (!station || !Number.isInteger(station.x) || !Number.isInteger(station.z) || !Number.isInteger(station.baseY) ||
      station.x < 2 || station.x > W - 3 || station.z < 0 || station.z >= D || station.baseY < 0 || station.baseY + 5 >= H) return false;
  for (let dx = -2; dx <= 2; dx++) {
    if (world[idx(station.x + dx, station.baseY + 1, station.z)] !== (Math.abs(dx) === 2 ? 11 : 10)) return false;
    for (let y = station.baseY + 2; y <= station.baseY + 5; y++) {
      if (world[idx(station.x + dx, y, station.z)] !== legacyPhoneStationBlockId(dx, y, station.baseY)) return false;
    }
  }
  return true;
}
function removeLegacyPhoneStation(world, station) {
  if (!hasLegacyPhoneStation(world, station)) return false;
  for (let dx = -2; dx <= 2; dx++) {
    for (let y = station.baseY + 1; y <= station.baseY + 5; y++) world[idx(station.x + dx, y, station.z)] = 0;
  }
  return true;
}
function phoneStationBlockIdV2(dx, dzOffset, y, baseY) {
  if (y === baseY + 1) return 3;
  if (y === baseY + 3 && Math.abs(dx) === 1) return 12;
  if (y === baseY + 2 && dx === 0 && dzOffset === 1) return 12;
  return 11;
}
function hasPhoneStationV2(world, station) {
  if (!station || !Number.isInteger(station.x) || !Number.isInteger(station.z) || !Number.isInteger(station.baseY) ||
      station.x < 2 || station.x > W - 3 || station.z < 1 || station.z >= D - 2 || station.baseY < 0 || station.baseY + 3 >= H) return false;
  for (let dx = -1; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
    for (let y = station.baseY + 1; y <= station.baseY + 3; y++) {
      if (world[idx(station.x + dx, y, station.z + dz)] !== phoneStationBlockIdV2(dx, dz, y, station.baseY)) return false;
    }
  }
  return true;
}
function hasPhoneStation(world, station) {
  if (!station) return false;
  const version = station.version || 1;
  if (version === 1) return hasLegacyPhoneStation(world, station);
  if (version === 2) return hasPhoneStationV2(world, station);
  if (version !== PHONE_STATION_VERSION) return false;
  if (!Number.isInteger(station.x) || !Number.isInteger(station.z) || !Number.isInteger(station.baseY) ||
      station.x < 2 || station.x > W - 3 || station.z < 1 || station.z >= D - 2 || station.baseY < 0 || station.baseY + 3 >= H) return false;
  for (let dx = -1; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
    for (let y = station.baseY + 1; y <= station.baseY + 3; y++) {
      if (world[idx(station.x + dx, y, station.z + dz)] !== phoneStationBlockId(dx, dz, y, station.baseY)) return false;
    }
  }
  return true;
}
function removePhoneStationV2(world, station) {
  if (!hasPhoneStationV2(world, station)) return false;
  for (let dx = -1; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
    for (let y = station.baseY + 1; y <= station.baseY + 3; y++) world[idx(station.x + dx, y, station.z + dz)] = 0;
  }
  return true;
}
function removeKnownPhoneStation(world, station) {
  const version = station && (station.version || 1);
  if (version === 1) return removeLegacyPhoneStation(world, station);
  if (version === 2) return removePhoneStationV2(world, station);
  return false;
}
function placePhoneStation(world, theme = 'nature') {
  const spawn = phoneSpawnForTheme(theme), target = phoneStationTarget(theme), candidates = [];
  // Stay on the central plaza while keeping about ten blocks between the station and respawn.
  for (let z = 40; z <= 61; z++) for (let x = 18; x <= 49; x++) {
    const spawnD = (x - spawn.x) ** 2 + (z - spawn.z) ** 2;
    if (Math.sqrt(spawnD) < 9.5) continue;
    candidates.push({ x, z, d: (x - target.x) ** 2 + (z - target.z) ** 2, spawnD });
  }
  candidates.sort((a, b) => a.d - b.d || b.spawnD - a.spawnD || a.z - b.z || a.x - b.x);
  for (const candidate of candidates) {
    const station = phoneStationPlan(world, candidate.x, candidate.z);
    if (!station) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      for (let y = station.baseY + 1; y <= station.baseY + 3; y++) {
        world[idx(station.x + dx, y, station.z + dz)] = phoneStationBlockId(dx, dz, y, station.baseY);
      }
    }
    return station;
  }
  return null;
}
function normalizePhoneStation(station) {
  if (!station || !Number.isInteger(station.x) || !Number.isInteger(station.z) || !Number.isInteger(station.baseY)) return null;
  const version = [1, 2, PHONE_STATION_VERSION].includes(station.version) ? station.version : 1;
  if (station.x < 2 || station.x > W - 3 || station.z < (version === 1 ? 0 : 1) ||
      station.z >= (version === 1 ? D : D - 2) || station.baseY < 0 ||
      station.baseY + (version === 1 ? 5 : 3) >= H) return null;
  return { x: station.x, z: station.z, baseY: station.baseY, version };
}
function ensurePhoneStation(world, station, theme = 'nature') {
  const normalized = normalizePhoneStation(station);
  if (normalized && normalized.version === PHONE_STATION_VERSION) return normalized;
  if (normalized) removeKnownPhoneStation(world, normalized);
  return placePhoneStation(world, theme);
}

// v20.109+: 初期地点の3枚のお絵かき壁を白ブロックに統一する。
// 古い保存ワールドにも一度だけ適用するため、スナップショットに材料バージョンを保持する。
const START_DRAWING_WALL_MATERIAL_VERSION = 1;
function migrateStarterDrawingWalls(world) {
  const positions = [];
  let oldStone = 0, white = 0;
  for (const [x0, len] of [[18, 6], [26, 8], [36, 6]]) {
    for (let i = 0; i < len; i++) for (let y = 9; y <= 13; y++) {
      const at = idx(x0 + i, y, 44), block = world[at];
      positions.push(at);
      if (block === 3) oldStone++;
      else if (block === 5) white++;
    }
  }
  // Migration is for the known old starter layout only; don't repaint arbitrary custom worlds.
  if (oldStone < 50 || oldStone + white < 70) return 0;
  let changed = 0;
  for (const at of positions) if (world[at] === 3) { world[at] = 5; changed++; }
  return changed;
}

function genTerrainNature(withCave = true) {
  const world = new Uint8Array(W * H * D);
  const sea = 6;
  const height = new Float32Array(W * D);
  const riverZ = (x) => 40 + Math.sin(x * 0.12) * 5.5 + Math.sin(x * 0.05) * 2;
  const riverDist = (x, z) => Math.abs(z - riverZ(x));
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let h = 8.2;
      const north = Math.max(0, (28 - z) / 28);
      h += north * north * 7.5;
      h += north * fbm(x * 0.05, z * 0.05, 3) * 5.5;
      const peak = Math.hypot((x - 14) / 11, (z - 9) / 9);
      if (peak < 1.2) h += (1.2 - peak) * (1.2 - peak) * 9;
      const hill = Math.hypot((x - 50) / 10, (z - 12) / 8);
      if (hill < 1.1) h += (1.1 - hill) * 5;
      if (z > 30) h = 8.0 + fbm(x * 0.03, z * 0.03, 2) * 1.2;
      const rd = riverDist(x, z);
      if (rd < 2.2) h = Math.min(h, sea - 1.2);
      else if (rd < 4.5) h = Math.min(h, sea + (rd - 2.2) * 0.85);
      const pond = Math.hypot((x - 48) / 5.5, (z - 52) / 4.5);
      if (pond < 1) h = Math.min(h, sea - 0.5 - (1 - pond) * 1.5);
      const edge = Math.min(x, z, W - 1 - x, D - 1 - z);
      if (edge < 2) h = Math.min(h, 7 + edge);
      height[x + z * W] = h;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(W * D);
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox, zz = z + oz;
            if (xx < 0 || zz < 0 || xx >= W || zz >= D) continue;
            const w = ox === 0 && oz === 0 ? 5 : 1;
            s += height[xx + zz * W] * w; n += w;
          }
        }
        next[x + z * W] = s / n;
      }
    }
    height.set(next);
  }
  const hi = new Int8Array(W * D);
  for (let i = 0; i < height.length; i++) hi[i] = Math.max(1, Math.min(H - 5, Math.round(height[i])));
  const pcx = 28, pcz = 50, prx = 14, prz = 9, floorY = 8;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const dx = (x - pcx) / prx, dz = (z - pcz) / prz;
    if (dx * dx + dz * dz <= 1) hi[x + z * W] = floorY;
  }
  const tcx = 36, tcz = 32, trx = 8, trz = 5, tFloor = 9;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const dx = (x - tcx) / trx, dz = (z - tcz) / trz;
    if (dx * dx + dz * dz <= 1 && riverDist(x, z) > 4) hi[x + z * W] = tFloor;
  }
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = hi[x + z * W], rd = riverDist(x, z);
    const pond = Math.hypot((x - 48) / 5.5, (z - 52) / 4.5);
    for (let y = 0; y <= h; y++) {
      let b;
      if (y === h) {
        if (rd < 4.5 || pond < 1.15) b = 7;
        else if (h >= 14) b = 3;
        else if (h >= 12 && noise2(x * 0.8, z * 0.8) > 0.3) b = 3;
        else b = 1;
      } else if (y > h - 3) b = 2;
      else b = 3;
      world[idx(x, y, z)] = b;
    }
    if (h < sea) for (let y = h + 1; y <= sea; y++) world[idx(x, y, z)] = 8;
  }
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const dx = (x - pcx) / prx, dz = (z - pcz) / prz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.88 && d <= 1.0 && world[idx(x, floorY, z)] === 1) world[idx(x, floorY, z)] = 5;
  }
  for (const [x0, len] of [[18, 6], [26, 8], [36, 6]]) {
    for (let i = 0; i < len; i++) for (let y = floorY + 1; y <= floorY + 5; y++) {
      const x = x0 + i; if (x > 0 && x < W - 1) world[idx(x, y, 44)] = 5; // 白ブロックのお絵かき壁
    }
  }
  for (let x = 30; x <= 42; x++) for (let y = tFloor + 1; y <= tFloor + 4; y++) world[idx(x, y, 28)] = 3;
  for (let z = 3; z < D - 3; z++) for (let x = 3; x < W - 3; x++) {
    const h = hi[x + z * W];
    if (h <= sea || world[idx(x, h, z)] !== 1 || riverDist(x, z) < 5) continue;
    const dx = (x - pcx) / (prx + 1.5), dz = (z - pcz) / (prz + 1.5);
    if (dx * dx + dz * dz < 1) continue;
    const dxt = (x - tcx) / (trx + 1), dzt = (z - tcz) / (trz + 1);
    if (dxt * dxt + dzt * dzt < 1) continue;
    let dens = 0.025;
    if (h >= 12) dens = 0.015;
    if (z > 45) dens = 0.012;
    if (riverDist(x, z) < 8 && z < 45) dens = 0.045;
    if (noise2(x * 1.6, z * 2.0) > dens) continue;
    const th = 3 + (noise2(x, z + 40) * 2.5 | 0);
    for (let ty = 1; ty <= th; ty++) if (h + ty < H) world[idx(x, h + ty, z)] = 4;
    const top = h + th;
    for (let ly = 0; ly <= 2; ly++) for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) {
      if (Math.abs(lx) + Math.abs(lz) > 2 + (ly === 0 ? 0 : -1)) continue;
      const y = top + ly, px = x + lx, pz = z + lz;
      if (px < 0 || pz < 0 || px >= W || pz >= D || y >= H) continue;
      if (!world[idx(px, y, pz)]) world[idx(px, y, pz)] = 9;
    }
  }
  if (withCave) applyNaturalCave(world);
  return world;
}

/** 紙とインク: 巨大な画用紙・インク川・折り紙の山・展示台 */
function genTerrainPaper() {
  const world = new Uint8Array(W * H * D);
  const sea = 5;
  const hi = new Int8Array(W * D);

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let h = 6;
      // 南〜中央: 広大な画用紙フロア
      if (z >= 30) h = 7;
      // 北: 折り紙の段丘（同心円の階段）
      else {
        const d = Math.hypot(x - 32, z - 12);
        if (d < 6) h = 16;
        else if (d < 10) h = 13;
        else if (d < 14) h = 11;
        else if (d < 18) h = 9;
        else h = 7;
      }
      // 東西にインクの川（二本の細流が合流）
      const r1 = Math.abs(z - (38 + Math.sin(x * 0.2) * 3));
      const r2 = Math.abs(z - (36 + Math.cos(x * 0.15) * 2.5));
      const river = Math.min(r1, r2);
      if (river < 1.8) h = 3;
      else if (river < 3.2) h = Math.min(h, 5);
      // 南西の大きなインク池
      if (Math.hypot(x - 14, z - 52) < 7) h = Math.min(h, 3);
      // 南東の小さな池
      if (Math.hypot(x - 52, z - 55) < 4.5) h = Math.min(h, 3);
      const edge = Math.min(x, z, W - 1 - x, D - 1 - z);
      if (edge < 2) h = Math.min(h, 6);
      hi[x + z * W] = Math.max(1, Math.min(H - 4, h));
    }
  }

  // 超大キャンバス（南）
  for (let z = 44; z < 62; z++) for (let x = 8; x < 56; x++) hi[x + z * W] = 7;
  // 中段の展示フロア
  for (let z = 24; z < 34; z++) for (let x = 18; x < 46; x++) {
    if (Math.min(Math.abs(z - 38 - Math.sin(x * 0.2) * 3), Math.abs(z - 36 - Math.cos(x * 0.15) * 2.5)) > 3.5)
      hi[x + z * W] = 9;
  }

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const h = hi[x + z * W];
      const r1 = Math.abs(z - (38 + Math.sin(x * 0.2) * 3));
      const r2 = Math.abs(z - (36 + Math.cos(x * 0.15) * 2.5));
      const river = Math.min(r1, r2);
      const nearInk = river < 3.5 || Math.hypot(x - 14, z - 52) < 7.5 || Math.hypot(x - 52, z - 55) < 5;
      for (let y = 0; y <= h; y++) {
        let b;
        if (y === h) {
          if (nearInk) b = 7;
          else if (z >= 44 && z < 62 && x >= 8 && x < 56) b = 5; // 画用紙
          else if (h >= 13) b = 3;
          else if (h >= 9) b = 1;
          else b = 1;
        } else if (y > h - 2) b = 2;
        else b = 3;
        world[idx(x, y, z)] = b;
      }
      if (h < sea) for (let y = h + 1; y <= sea; y++) world[idx(x, y, z)] = 8;
    }
  }

  // 画用紙の枠（レンガ→赤紙枠として）
  for (let z = 44; z < 62; z++) for (let x = 8; x < 56; x++) {
    if ((z === 44 || z === 61 || x === 8 || x === 55) && world[idx(x, 7, z)] === 5)
      world[idx(x, 7, z)] = 6;
  }
  // 大壁キャンバス（南向きに3枚）
  for (const x0 of [12, 26, 40]) {
    for (let i = 0; i < 10; i++) for (let y = 8; y <= 14; y++) {
      const x = x0 + i;
      if (x < W - 1) world[idx(x, y, 45)] = 5;
    }
  }
  // 折り紙の山に白い段差アクセント
  for (let z = 4; z < 22; z++) for (let x = 18; x < 46; x++) {
    const d = Math.hypot(x - 32, z - 12);
    const h = hi[x + z * W];
    if (d > 5.5 && d < 6.5 && h > 10) world[idx(x, h, z)] = 5;
  }
  // クラフト紙の柱（ギャラリー）
  for (const [tx, tz] of [[10, 48], [53, 48], [10, 58], [53, 58], [20, 50], [43, 50]]) {
    for (let y = 8; y <= 12; y++) world[idx(tx, y, tz)] = 4;
    world[idx(tx, 13, tz)] = 9;
  }
  return world;
}

/** おもちゃ箱: 色タイルの床・積み木の城・ビー玉の海・クレヨン壁 */
function genTerrainToy() {
  const world = new Uint8Array(W * H * D);
  const sea = 5;
  const hi = new Int8Array(W * D);

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let h = 7;
      // 南: プレイマット平坦
      if (z >= 42) h = 7;
      // 中央: ビー玉の湾
      else if (Math.hypot(x - 32, z - 30) < 9) h = 3;
      // 北: 積み木の城（グリッド状の塔）
      else if (z < 22) {
        const gx = Math.floor((x - 8) / 7);
        const gz = Math.floor(z / 7);
        const cx = 8 + gx * 7 + 3;
        const cz = gz * 7 + 3;
        const onTower = Math.abs(x - cx) <= 2 && Math.abs(z - cz) <= 2;
        h = onTower ? 10 + (gx + gz) % 4 + 2 : 8;
      } else {
        // 中腹: 段々のテラス
        h = 8 + Math.floor((30 - z) / 6);
      }
      const edge = Math.min(x, z, W - 1 - x, D - 1 - z);
      if (edge < 2) h = 6;
      hi[x + z * W] = Math.max(1, Math.min(H - 4, h));
    }
  }

  // 南の大マット
  for (let z = 44; z < 63; z++) for (let x = 6; x < 58; x++) hi[x + z * W] = 7;

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const h = hi[x + z * W];
      const pool = Math.hypot(x - 32, z - 30);
      for (let y = 0; y <= h; y++) {
        let b;
        if (y === h) {
          if (pool < 9.5) b = 7;
          else if (z >= 44) {
            // 4色市松マット
            const c = ((x >> 1) + (z >> 1)) % 4;
            b = c === 0 ? 1 : c === 1 ? 6 : c === 2 ? 5 : 7;
          } else if (h >= 12) b = (x + z) % 2 ? 3 : 6;
          else b = 1;
        } else if (y > h - 2) b = 2;
        else b = 3;
        world[idx(x, y, z)] = b;
      }
      if (h < sea) for (let y = h + 1; y <= sea; y++) world[idx(x, y, z)] = 8;
    }
  }

  // クレヨンの大壁（南マット北面）
  for (let x = 10; x < 54; x++) {
    for (let y = 8; y <= 13; y++) {
      const stripe = Math.floor(x / 4) % 3;
      world[idx(x, y, 45)] = stripe === 0 ? 6 : stripe === 1 ? 5 : 1;
    }
  }
  // 積み木の橋（池の上）
  for (let x = 28; x <= 36; x++) {
    world[idx(x, 6, 30)] = 5;
    world[idx(x, 6, 31)] = 5;
  }
  // 塔の旗（葉）
  for (let gx = 0; gx < 7; gx++) {
    for (let gz = 0; gz < 3; gz++) {
      const cx = 8 + gx * 7 + 3;
      const cz = gz * 7 + 3;
      if (cx >= W - 1 || cz >= D - 1) continue;
      const h = hi[cx + cz * W];
      if (h + 1 < H) world[idx(cx, h + 1, cz)] = 9;
    }
  }
  // おもちゃの木
  for (const [tx, tz] of [[12, 50], [20, 56], [44, 50], [52, 56], [16, 36], [48, 36]]) {
    const h = hi[tx + tz * W];
    if (h <= sea) continue;
    for (let ty = 1; ty <= 4; ty++) if (h + ty < H) world[idx(tx, h + ty, tz)] = 4;
    if (h + 5 < H) {
      for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) {
        const px = tx + lx, pz = tz + lz;
        if (px >= 0 && pz >= 0 && px < W && pz < D && !world[idx(px, h + 5, pz)])
          world[idx(px, h + 5, pz)] = 9;
      }
    }
  }
  return world;
}


function rle(world) {
  const r = [];
  let p = world[0], n = 1;
  for (let i = 1; i < world.length; i++) {
    if (world[i] === p && n < 65535) n++;
    else { r.push(p, n); p = world[i]; n = 1; }
  }
  r.push(p, n);
  return r;
}

function unrle(r, world) {
  let i = 0;
  for (let j = 0; j < r.length; j += 2) {
    world.fill(r[j], i, i + r[j + 1]);
    i += r[j + 1];
  }
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

// ===== 軽量なワールド生物（永続データには保存しない） =====
// 地面の上に2ブロック分の空間がある位置だけを歩行可能とする。
const AMBIENT_GROUND_BLOCKS = new Set([1, 2, 3, 5, 6, 7, 11, 12]);
function ambientGroundY(world, x, z) {
  const gx = Math.floor(x), gz = Math.floor(z);
  if (gx < 1 || gx >= W - 1 || gz < 1 || gz >= D - 1) return null;
  for (let y = H - 3; y >= 1; y--) {
    const b = world[idx(gx, y, gz)];
    if (!AMBIENT_GROUND_BLOCKS.has(b)) continue;
    if (world[idx(gx, y + 1, gz)] === 0 && world[idx(gx, y + 2, gz)] === 0) return y;
  }
  return null;
}

// キャラクターを初期スポーン周辺に集中させず、ワールド全域の歩ける地面から配置する。
// 建築・地形の違いを考慮し、空間のある地面だけを選び、必要なら制約を段階的に緩める。
function findWorldRoamSpot(room, options = {}) {
  const spawn = phoneSpawnForTheme(room.worldTheme);
  const avoids = Array.isArray(options.avoidPoints) ? options.avoidPoints : [];
  const rules = {
    spawnGap: Number.isFinite(options.minSpawnDistance) ? options.minSpawnDistance : 8.0,
    phoneGap: Number.isFinite(options.phoneGap) ? options.phoneGap : 4.0,
    creatureGap: Number.isFinite(options.creatureGap) ? options.creatureGap : 4.0,
    mischiefGap: Number.isFinite(options.mischiefGap) ? options.mischiefGap : 5.0,
    residentGap: Number.isFinite(options.residentGap) ? options.residentGap : 6.0,
    wiseGap: Number.isFinite(options.wiseGap) ? options.wiseGap : 6.0,
    pointGap: Number.isFinite(options.pointGap) ? options.pointGap : 0,
  };
  for (const factor of [1, 0.55, 0]) {
    const candidates = [];
    for (let gx = 1; gx < W - 1; gx++) for (let gz = 1; gz < D - 1; gz++) {
      const x = gx + 0.5, z = gz + 0.5;
      if (Math.hypot(x - (spawn.x + 0.5), z - (spawn.z + 0.5)) < rules.spawnGap * factor) continue;
      if (room.phoneStation && Math.hypot(x - (room.phoneStation.x + 0.5), z - (room.phoneStation.z + 0.5)) < rules.phoneGap * factor) continue;
      if (room.creatures && room.creatures.some(c => Math.hypot(x - c.x, z - c.z) < rules.creatureGap * factor)) continue;
      if (room.mischiefCreature && Math.hypot(x - room.mischiefCreature.x, z - room.mischiefCreature.z) < rules.mischiefGap * factor) continue;
      if (room.forestResident && Math.hypot(x - room.forestResident.x, z - room.forestResident.z) < rules.residentGap * factor) continue;
      if (room.wiseCharacter && Math.hypot(x - room.wiseCharacter.x, z - room.wiseCharacter.z) < rules.wiseGap * factor) continue;
      if (avoids.some(p => Math.hypot(x - p.x, z - p.z) < rules.pointGap * factor)) continue;
      const ground = ambientGroundY(room.world, x, z);
      if (ground === null) continue;
      candidates.push({ x, y: ground + 1, z });
    }
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return null;
}

function createAmbientCreatures(room) {
  const result = [];
  // 3匹をワールド全体へ分散して配置。互いに近すぎず、開始地点からも距離を取る。
  for (let i = 0; i < 3; i++) {
    const spot = findWorldRoamSpot(room, {
      minSpawnDistance: 8.5, phoneGap: 3.2, creatureGap: 0,
      avoidPoints: result.map(c => ({ x: c.x, z: c.z })), pointGap: 12.0,
    });
    if (!spot) break;
    result.push({
      id: `critter-${i + 1}`, type: i % 3, x: spot.x, y: spot.y, z: spot.z,
      homeX: spot.x, homeZ: spot.z,
      yaw: Math.random() * Math.PI * 2, mode: 'wander', targetX: null, targetY: null, targetZ: null,
      waitUntil: Date.now() + 400 + Math.random() * 1800, fleeUntil: 0,
    });
  }
  return result;
}
function chooseAmbientTarget(room, creature, baseAngle, baseDistance) {
  const tryAt = (angle, distance) => {
    const x = Math.max(1.5, Math.min(W - 1.5, Math.floor(creature.x + Math.sin(angle) * distance) + 0.5));
    const z = Math.max(1.5, Math.min(D - 1.5, Math.floor(creature.z + Math.cos(angle) * distance) + 0.5));
    if (Math.hypot(x - creature.x, z - creature.z) < 0.7) return null;
    const ground = ambientGroundY(room.world, x, z);
    if (ground === null || Math.abs((ground + 1) - creature.y) > 2.0) return null;
    return { x, y: ground + 1, z };
  };
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = baseAngle + (Math.random() - 0.5) * (baseDistance > 5 ? 0.8 : 2.0);
    const distance = Math.max(1.2, baseDistance * (0.55 + Math.random() * 0.55));
    const target = tryAt(angle, distance);
    if (target) return target;
  }
  // Trees, rivers or custom buildings may block the preferred direction. Try nearby cells before giving up.
  for (const distance of [2.2, 1.6, 1.1]) {
    for (let i = 0; i < 8; i++) {
      const target = tryAt(baseAngle + i * Math.PI / 4, distance);
      if (target) return target;
    }
  }
  return null;
}

function tickAmbientCreatures(room, dt, now) {
  if (!room.players.size || !room.creatures.length) return;
  const players = [...room.players.values()].filter(p => Array.isArray(p.pos) && p.pos.length >= 3 && p.pos.every(Number.isFinite));
  for (const c of room.creatures) {
    let nearest = null, nearestD = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z);
      if (d < nearestD) { nearestD = d; nearest = p; }
    }

    if (nearest && nearestD < 2.6 && (c.mode !== 'flee' || now >= c.fleeUntil)) {
      let dx = c.x - nearest.pos[0], dz = c.z - nearest.pos[2];
      if (Math.hypot(dx, dz) < 0.01) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
      c.mode = 'flee'; c.fleeUntil = now + 1700 + Math.random() * 700;
      const target = chooseAmbientTarget(room, c, Math.atan2(dx, dz), 4.2);
      if (target) { c.targetX = target.x; c.targetY = target.y; c.targetZ = target.z; }
      else { c.mode = 'wander'; c.fleeUntil = 0; c.waitUntil = now + 450; }
    } else if (nearest && nearestD < 5.4 && c.mode !== 'flee') {
      c.mode = 'look'; c.targetX = c.targetY = c.targetZ = null;
      c.yaw = Math.atan2(nearest.pos[0] - c.x, nearest.pos[2] - c.z);
      c.waitUntil = now + 450;
      continue;
    } else if (c.mode === 'look') {
      c.mode = 'wander'; c.waitUntil = now + 350 + Math.random() * 900;
      c.targetX = c.targetY = c.targetZ = null;
    }

    if (c.mode === 'flee' && now >= c.fleeUntil) {
      c.mode = 'wander'; c.targetX = c.targetY = c.targetZ = null; c.waitUntil = now + 400;
    }
    if (c.mode !== 'flee' && c.mode !== 'look') {
      const reached = c.targetX == null || Math.hypot(c.targetX - c.x, c.targetZ - c.z) < 0.28;
      if (reached && now >= c.waitUntil) {
        if (Math.random() < 0.34) {
          c.targetX = c.targetY = c.targetZ = null;
          c.waitUntil = now + 900 + Math.random() * 1800;
          c.mode = 'idle';
        } else {
          const angle = Math.random() * Math.PI * 2;
          const target = chooseAmbientTarget(room, c, angle, 4.0 + Math.random() * 5.0);
          if (target) {
            c.targetX = target.x; c.targetY = target.y; c.targetZ = target.z;
            c.mode = 'wander';
          } else c.waitUntil = now + 700;
        }
      }
    }
    if (c.mode === 'idle' && now >= c.waitUntil) c.mode = 'wander';
    if (c.targetX != null && (c.mode === 'wander' || c.mode === 'flee')) {
      const dx = c.targetX - c.x, dz = c.targetZ - c.z, distance = Math.hypot(dx, dz);
      if (distance < 0.12) {
        c.x = c.targetX; c.y = c.targetY; c.z = c.targetZ;
        c.targetX = c.targetY = c.targetZ = null;
        c.waitUntil = now + (c.mode === 'flee' ? 250 : 650 + Math.random() * 1300);
        if (c.mode === 'flee') c.mode = 'wander';
      } else {
        const step = Math.min(distance, (c.mode === 'flee' ? 1.6 : 0.72) * dt);
        const nx = c.x + dx / distance * step, nz = c.z + dz / distance * step;
        const ground = ambientGroundY(room.world, nx, nz);
        if (ground === null || Math.abs(ground + 1 - c.y) > 1.25) {
          c.targetX = c.targetY = c.targetZ = null;
          c.waitUntil = now + 500 + Math.random() * 900;
          if (c.mode === 'flee') c.mode = 'wander';
        } else {
          c.x = nx; c.z = nz; c.y = ground + 1;
          c.yaw = Math.atan2(dx, dz);
        }
      }
    }
  }
}

// ===== 個性を持つ別種「ひょっこりん」 =====
// 既存の3匹の環境生物とは別の状態・行動ループ。保存データは変更しない。
function findMischiefGroundSpot(room, cx, cz, minDistance, maxDistance, avoid = null) {
  const radius = Math.ceil(maxDistance + 1);
  const candidates = [];
  const minX = Math.max(1, Math.floor(cx - radius)), maxX = Math.min(W - 2, Math.floor(cx + radius));
  const minZ = Math.max(1, Math.floor(cz - radius)), maxZ = Math.min(D - 2, Math.floor(cz + radius));
  for (let gx = minX; gx <= maxX; gx++) {
    for (let gz = minZ; gz <= maxZ; gz++) {
      const x = gx + 0.5, z = gz + 0.5;
      const d = Math.hypot(x - cx, z - cz);
      if (d < minDistance || d > maxDistance) continue;
      const ground = ambientGroundY(room.world, x, z);
      if (ground === null) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < (avoid.minGap || 3.0)) continue;
      if (room.creatures.some(c => Math.hypot(x - c.x, z - c.z) < 2.5)) continue;
      candidates.push({ x, y: ground + 1, z });
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function createMischiefCreature(room) {
  const spot = findWorldRoamSpot(room, { minSpawnDistance: 8.0, phoneGap: 5.0, creatureGap: 5.0, mischiefGap: 0 });
  if (!spot) return null;
  const now = Date.now();
  return {
    id: 'mischief-1', x: spot.x, y: spot.y, z: spot.z, yaw: Math.random() * Math.PI * 2,
    mode: 'peek', targetX: null, targetY: null, targetZ: null,
    nextActionAt: now + 1800 + Math.random() * 2200,
    hiddenUntil: 0, ignoreLookUntil: now + 2800,
    // 声で存在に気づかせ、少し後に姿を見せる会話シーケンス。
    speech: '', speechId: 0, speechUntil: 0,
    nextSpeechAt: now + 6500 + Math.random() * 6500,
    revealAt: 0, greetUntil: 0, callTargetId: null,
  };
}

// ===== ポストン: ひらめき便を届ける、ちょっとドジな郵便生物 =====
// 操作するたびに、小さな創作お題を届ける。話す目的を「ただの挨拶」ではなく発想のきっかけにする。
// 接近時は短いひと言だけ。創作のお題や長い台詞は明示的に話しかけた時に届ける。
const FOREST_RESIDENT_GREETING = [
  'やあ！',
  'おっ！',
  '配達だよ！',
  'こんにちは！',
  'あ、いた！',
  'どうもー！',
  'お届け！',
  '受け取ってね！',
];
const FOREST_RESIDENT_DIALOGUE = [
  'ひらめき便！「食べたら一日だけ空を飛べるおにぎり」を描いてみて！',
  '今日のお題は「絶対に売れないけど、なぜか入りたくなるお店」！',
  '世界一ちいさい観光名所を作ろう！ ぼくなら見逃す自信ある！',
  '「開けるな」って書いてある箱を作って！ 中身は自由、責任も自由！',
  'この世界にしかいない生き物を考えて！ 足は何本でもいいよ！',
  'お題！ 役に立たないけど、めちゃくちゃかっこいい発明！',
  '三色だけで、すっごくおいしそうな食べ物を描けるかな？',
  'この世界の通貨を作るなら何の形？ ぼくはクッキーがいい！',
  '「見てるとちょっと笑っちゃう顔」をどこかに描いてみて！',
  '今日のひらめき便は「雨の日だけ開くアイス屋さん」！ 何味にする？',
  '誰も使い方を知らない道具を作って、ぼくを困らせて！',
  'この世界に祝日をひとつ増やすなら、何をお祝いする？',
  'お題は「世界一やさしい怪物」！ 怖い見た目でもいいんだよ！',
  '未来の自分が置いていったメモを、絵で表現してみて！',
  'この壁に、よく見ると変なところがある絵を描いてみない？',
  '絶対に乗りたくない乗り物、でも見た目は最高！ そんなの作って！',
  'この世界に新しい看板を出すなら、何て書く？ ぼくは「たぶん安全」！',
  'お題！ 「透明だけど、なぜか見えるもの」！ むずかしいねえ！',
  'ひとマスから物語が始まるとしたら、何を描く？',
  'この世界のマスコットを作って！ ……ぼくよりかわいくしないでね？',
  '「失敗じゃない、試作品だ！」って言い張れる発明を考えて！',
  'お題は「誰も知らない秘密の名所」。小さくても大丈夫！',
  'この世界だけで流行っている変なファッションを描いてみて！',
  '食べたら変な声になるジュースのラベル、どんなデザイン？',
  '空を泳ぐ魚を描こう！ 地面を泳いでても、まあ採用！',
  '世界で一番へんな形の家を作るなら、どんな形にする？',
  '誰かにプレゼントしたくなるものを、ブロックで作ってみて！',
  'お題！ 「ちょっとだけ未来っぽい日用品」！ ぼくも欲しい！',
  '落書きに小さな秘密をひとつ混ぜてみて。見つけた人はラッキー！',
  '「月曜日が楽しみになるもの」を何か作って！ ……あるかなあ？',
  'きみがこの世界の管理人なら、最初にどんなルールを作る？',
  'ひらめき便！ 「名前だけは強そうだけど、実は弱いヒーロー」を考えて！',
];
function createForestResident(room) {
  const spot = findWorldRoamSpot(room, { minSpawnDistance: 8.0, phoneGap: 5.0, creatureGap: 5.0, mischiefGap: 6.5, residentGap: 0 });
  if (!spot) return null;
  const now = Date.now();
  return {
    id: 'forest-resident-1', epoch: uid().slice(0, 8), x: spot.x, y: spot.y, z: spot.z, yaw: Math.random() * Math.PI * 2,
    // 初期地点の周囲に固定せず、地形を確かめながらワールド内を巡回する。
    homeX: spot.x, homeZ: spot.z, targetX: null, targetY: null, targetZ: null,
    mode: 'idle', nextMoveAt: now + 1200 + Math.random() * 1800, lastTickAt: now,
    speech: '', speechId: 0, speechUntil: 0,
    nearPlayers: new Set(), greetingCooldownBy: new Map(), recentLines: [],
  };
}
function chooseForestResidentLine(c, greeting = false) {
  const pool = greeting ? FOREST_RESIDENT_GREETING : FOREST_RESIDENT_DIALOGUE;
  const available = pool.filter(line => !c.recentLines.includes(line));
  const line = (available.length ? available : pool)[Math.floor(Math.random() * (available.length || pool.length))];
  c.recentLines.push(line);
  if (c.recentLines.length > 8) c.recentLines.shift();
  return line;
}
function startForestResidentSpeech(room, playerId, player, greeting, now = Date.now()) {
  const c = room.forestResident;
  if (!c || !player || !Array.isArray(player.pos)) return false;
  const line = chooseForestResidentLine(c, greeting);
  c.yaw = Math.atan2(player.pos[0] - c.x, player.pos[2] - c.z);
  c.speech = line;
  c.speechId = (c.speechId || 0) + 1;
  // 自動の接近挨拶は短く、手動で「話す」を押したときだけ本題のお題を話す。
  c.speechUntil = now + (greeting
    ? Math.max(850, Math.min(1750, line.length * 145))
    : Math.max(4200, Math.min(9000, line.length * 205)));
  // Stop and face the player for the entire delivery; do not wander away mid-sentence.
  c.targetX = c.targetY = c.targetZ = null;
  c.mode = 'talking';
  c.nextMoveAt = c.speechUntil + 1100;
  if (playerId) c.nearPlayers.add(playerId);
  return true;
}
function chooseForestResidentTarget(room, c) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 3.2 + Math.random() * 4.8;
    const target = chooseAmbientTarget(room, c, angle, distance);
    if (!target) continue;
    if (Math.hypot(target.x - c.x, target.z - c.z) < 0.85) continue;
    if (room.phoneStation && Math.hypot(target.x - (room.phoneStation.x + .5), target.z - (room.phoneStation.z + .5)) < 2.2) continue;
    if (room.creatures.some(a => Math.hypot(target.x - a.x, target.z - a.z) < 1.8)) continue;
    if (room.mischiefCreature && Math.hypot(target.x - room.mischiefCreature.x, target.z - room.mischiefCreature.z) < 2.1) continue;
    if (room.wiseCharacter && Math.hypot(target.x - room.wiseCharacter.x, target.z - room.wiseCharacter.z) < 2.3) continue;
    let pathOk = true;
    for (let step = 1; step <= 4; step++) {
      const t = step / 4, px = c.x + (target.x - c.x) * t, pz = c.z + (target.z - c.z) * t;
      const ground = ambientGroundY(room.world, px, pz);
      if (ground === null || Math.abs((ground + 1) - c.y) > 1.1) { pathOk = false; break; }
    }
    if (pathOk) return target;
  }
  return null;
}
function tickForestResident(room, now) {
  const c = room.forestResident;
  if (!c || !room.players.size) return;
  const dt = Math.max(0, Math.min(.35, (now - (c.lastTickAt || now)) / 1000));
  c.lastTickAt = now;
  if (c.speech && now >= c.speechUntil) {
    c.speech = ''; c.speechUntil = 0; c.mode = 'idle';
    c.targetX = c.targetY = c.targetZ = null;
    c.nextMoveAt = Math.max(c.nextMoveAt || 0, now + 800);
  }
  const activeIds = new Set(room.players.keys());
  for (const id of c.nearPlayers) if (!activeIds.has(id)) c.nearPlayers.delete(id);
  for (const id of c.greetingCooldownBy.keys()) if (!activeIds.has(id)) c.greetingCooldownBy.delete(id);
  let nearestD = Infinity, nearestPlayer = null;
  for (const [id, p] of room.players) {
    if (!p || !Array.isArray(p.pos) || p.pos.length < 3 || !p.pos.every(Number.isFinite)) continue;
    const d = Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z);
    if (d < nearestD) { nearestD = d; nearestPlayer = p; }
    if (d > 4.8) { c.nearPlayers.delete(id); continue; }
    if (d <= 3.6 && !c.nearPlayers.has(id)) {
      c.nearPlayers.add(id);
      const cooldown = c.greetingCooldownBy.get(id) || 0;
      if (now >= c.speechUntil && now >= cooldown) {
        if (startForestResidentSpeech(room, id, p, true, now)) c.greetingCooldownBy.set(id, now + 30000);
      }
    }
  }

  // Stop when someone is close enough to interact, and look toward them.
  const talking = !!c.speech && now < c.speechUntil;
  if (nearestPlayer && nearestD <= 4.5) {
    c.targetX = c.targetY = c.targetZ = null;
    if (!talking) {
      c.mode = 'idle';
      c.yaw = Math.atan2(nearestPlayer.pos[0] - c.x, nearestPlayer.pos[2] - c.z);
      c.nextMoveAt = Math.max(c.nextMoveAt || 0, now + 900);
    }
  } else if (!talking) {
    if (c.targetX == null && now >= (c.nextMoveAt || 0)) {
      const target = chooseForestResidentTarget(room, c);
      if (target) {
        c.targetX = target.x; c.targetY = target.y; c.targetZ = target.z;
        c.mode = 'walk';
      } else {
        c.mode = 'idle'; c.nextMoveAt = now + 900 + Math.random() * 1200;
      }
    }
    if (c.targetX != null) {
      const dx = c.targetX - c.x, dz = c.targetZ - c.z, distance = Math.hypot(dx, dz);
      if (distance < .13) {
        c.x = c.targetX; c.y = c.targetY; c.z = c.targetZ;
        c.targetX = c.targetY = c.targetZ = null;
        c.mode = 'idle'; c.nextMoveAt = now + 1100 + Math.random() * 2600;
      } else {
        const step = Math.min(distance, .48 * dt);
        const nx = c.x + dx / distance * step, nz = c.z + dz / distance * step;
        const ground = ambientGroundY(room.world, nx, nz);
        if (ground === null || Math.abs((ground + 1) - c.y) > 1.1) {
          c.targetX = c.targetY = c.targetZ = null;
          c.mode = 'idle'; c.nextMoveAt = now + 1000 + Math.random() * 1500;
        } else {
          c.x = nx; c.z = nz; c.y = ground + 1; c.yaw = Math.atan2(dx, dz); c.mode = 'walk';
        }
      }
    }
  }
  // 古い参加者IDを無制限に残さない。
  if (c.greetingCooldownBy.size > 64) {
    for (const [id, until] of c.greetingCooldownBy) if (until < now - 60000) c.greetingCooldownBy.delete(id);
  }
}

// ===== 物知りのホシヨミ：本を読むフクロウの賢者。既存キャラとは独立 =====
// 接近時や自然な独り言は短く。長い「物知り話」はプレイヤーが話しかけた時だけ。
const WISE_CHARACTER_GREETING = [
  'ほう？',
  'おや。',
  'ふむふむ。',
  '客人じゃな。',
  'むむ……。',
  'お主か。',
  'なるほどのう。',
  'よい観察じゃ。',
  'さて……。',
  'ん？ 今、何か。',
];
const WISE_CHARACTER_LINES = [
  '星が昼に見えないのは、太陽が話を独占しておるからじゃ。',
  '本を閉じると知識は消えるのではない。眠るんじゃ。',
  '雲の裏側には、裏側がある。これは重要な発見じゃ。',
  '落とし物を探す前に、手を見なさい。持っていることがある。',
  '未来は前にあるとは限らん。後ろから追いつくこともある。',
  '世界の端には壁がある。少なくとも、わしの本棚の端にはある。',
  '「何でも知っている人」はおらん。知らないことの一覧が長い人はおる。',
  '静けさとは音がないことではない。音たちが順番を守っている状態じゃ。',
  '月は大きな石じゃ。投げた者が誰かは、まだ調査中じゃ。',
  '同じ道を二度歩くと、二度目の道は少しだけ違う道になる。靴のせいかもしれん。',
  'きみは今、まばたきをした。……していなければ、今したことにしておこう。',
  '賢い者はすぐに答えぬ。まず質問が本当に質問か確かめるのじゃ。',
  '木は歩かぬが、年輪で何年も旅をしておる。わしより遠くへ行く木もおる。',
  '答えは三つある。どれも質問によっては間違いじゃ。',
  '本日わしが覚えたことは二つ。ひとつは……もうひとつを忘れたことじゃ。',
  '世界は丸いと言うが、ブロックは四角い。どちらも自信満々じゃな。',
  '知恵は重い。だからわしは本を積んで、重さを分散しておる。',
  '眠る前に数える羊は、数えられていることを知っているのじゃろうか。',
  '地図にない場所は存在しないのではない。地図がさぼっておるのじゃ。',
  '間違いも知識の一種じゃ。繰り返すと経験という名前に変わる。',
  '水は低い所へ流れる。わしのやる気も同じじゃ。朝は特に低い。',
  '答えを急ぐでない。急いだ答えは、たまに質問を置いてけぼりにする。',
  '一番長い旅は、自分の部屋から何を取りに来たか思い出す旅じゃ。',
  '星は遠くにあるから小さく見える。わしの悩みも遠くへ置けばよい。',
  '魚が水のことを考えるか？ 考えないかもしれん。考えていたら聞いてみたい。',
  '賢そうにうなずく技術を教えよう。まず、話を最後まで聞くのじゃ。',
  '世界は謎だらけじゃ。わしの引き出しも同じ。どこに何を入れたのやら。',
  '石は何も言わぬ。だからといって、話を聞いていないとは限らん。',
  '「あとでやる」は未来の自分への手紙じゃ。未来の自分はよく怒っておる。',
  '知識を増やすのはよい。だが、棚が傾く前に本を減らすのも知恵じゃ。',
  'わしは長年、答えを探しておる。最近は質問のほうが面白いと気づいた。',
  'きみの足音は四角くない。これは哲学ではなく、ただの観察じゃ。',
];
function createWiseCharacter(room) {
  const spot = findWorldRoamSpot(room, { minSpawnDistance: 8.0, phoneGap: 4.8, creatureGap: 4.0, mischiefGap: 5.5, residentGap: 8.0, wiseGap: 0 });
  if (!spot) return null;
  const now = Date.now();
  return {id:'wise-character-1',epoch:uid().slice(0,8),x:spot.x,y:spot.y,z:spot.z,homeX:spot.x,homeZ:spot.z,yaw:Math.random()*Math.PI*2,
    targetX:null,targetY:null,targetZ:null,mode:'rest',waitUntil:now+1800+Math.random()*2600,lastMoveAt:now,
    speech:'',speechId:0,speechUntil:0,nearPlayers:new Set(),greetingCooldownBy:new Map(),recentLines:[],nextMurmurAt:now+35000+Math.random()*25000};
}
function chooseWiseWanderTarget(room,c,players){
  for(let attempt=0;attempt<30;attempt++){
    const angle=Math.random()*Math.PI*2,dist=3.2+Math.random()*4.8;
    const target=chooseAmbientTarget(room,c,angle,dist);if(!target)continue;
    if(Math.hypot(target.x-c.x,target.z-c.z)<0.95)continue;
    if(room.phoneStation&&Math.hypot(target.x-(room.phoneStation.x+.5),target.z-(room.phoneStation.z+.5))<3.4)continue;
    if(room.creatures.some(a=>Math.hypot(target.x-a.x,target.z-a.z)<1.8))continue;
    if(room.mischiefCreature&&Math.hypot(target.x-room.mischiefCreature.x,target.z-room.mischiefCreature.z)<2.2)continue;
    if(room.forestResident&&Math.hypot(target.x-room.forestResident.x,target.z-room.forestResident.z)<2.5)continue;
    if(players.some(p=>Math.hypot(target.x-p.pos[0],target.z-p.pos[2])<1.55))continue;
    let pathOk=true;
    for(let step=1;step<=4;step++){
      const t=step/4,px=c.x+(target.x-c.x)*t,pz=c.z+(target.z-c.z)*t;
      const ground=ambientGroundY(room.world,px,pz);
      if(ground===null||Math.abs(ground+1-c.y)>1.25){pathOk=false;break;}
    }
    if(pathOk)return target;
  }
  return null;
}
function chooseWiseCharacterLine(c,greeting=false){
  const pool=greeting?WISE_CHARACTER_GREETING:WISE_CHARACTER_LINES;
  const choices=pool.filter(line=>!c.recentLines.includes(line));
  const line=(choices.length?choices:pool)[Math.floor(Math.random()*(choices.length||pool.length))];
  c.recentLines.push(line);if(c.recentLines.length>7)c.recentLines.shift();return line;
}
function startWiseCharacterSpeech(room,playerId,player,greeting=false,now=Date.now()){
  const c=room.wiseCharacter;if(!c||!player||!Array.isArray(player.pos)||!player.pos.every(Number.isFinite))return false;
  c.speech=chooseWiseCharacterLine(c,greeting);c.speechId=(c.speechId||0)+1;
  // 接近挨拶・独り言は短く、長い知恵話は明示的に「聞く」を押した時だけ。
  c.speechUntil=now+(greeting
    ? Math.max(1200,Math.min(2300,c.speech.length*190))
    : Math.max(3600,Math.min(9200,c.speech.length*188)));
  // 読み上げ中はその場で止まり、プレイヤーに体を向ける。
  c.targetX=c.targetY=c.targetZ=null;c.mode='reading';c.waitUntil=c.speechUntil+650;
  c.yaw=Math.atan2(player.pos[0]-c.x,player.pos[2]-c.z);if(playerId)c.nearPlayers.add(playerId);return true;
}
function tickWiseCharacter(room,dt,now){
  const c=room.wiseCharacter;if(!c||!room.players.size)return;
  dt=Math.max(0,Math.min(.3,Number(dt)||0));
  if(c.speech&&now>=c.speechUntil){c.speech='';c.speechUntil=0;}
  const active=new Set(room.players.keys());
  for(const id of c.nearPlayers)if(!active.has(id))c.nearPlayers.delete(id);
  for(const id of c.greetingCooldownBy.keys())if(!active.has(id))c.greetingCooldownBy.delete(id);
  let nearest=null,nearestDistance=Infinity;
  for(const [id,p] of room.players){
    if(!p||!Array.isArray(p.pos)||p.pos.length<3||!p.pos.every(Number.isFinite))continue;
    const d=Math.hypot(p.pos[0]-c.x,p.pos[2]-c.z);
    if(d<nearestDistance){nearestDistance=d;nearest={id,p,d}}
    if(d>5.1){c.nearPlayers.delete(id);continue;}
    if(d<=3.7&&!c.nearPlayers.has(id)){
      c.nearPlayers.add(id);const cooldown=c.greetingCooldownBy.get(id)||0;
      if(now>=c.speechUntil&&now>=cooldown){if(startWiseCharacterSpeech(room,id,p,true,now))c.greetingCooldownBy.set(id,now+45000);}
    }
  }
  // 近くに人がいる時だけ、ごくたまに短い独り言。長い知恵話は自発的には始めない。
  if(now>=c.nextMurmurAt){
    if(now>=c.speechUntil&&nearest&&nearestDistance<=9.5)startWiseCharacterSpeech(room,nearest.id,nearest.p,true,now);
    c.nextMurmurAt=now+45000+Math.random()*35000;
  }

  // 本を読んだり話したりしていない時だけ、ワールド内をゆっくり散歩する。
  // 目的地ごとの地面・段差検査は維持し、ホーム地点への固定はしない。
  const speaking=!!c.speech&&now<c.speechUntil;
  if(speaking){c.targetX=c.targetY=c.targetZ=null;c.mode='reading';c.waitUntil=Math.max(c.waitUntil||0,c.speechUntil+650);}
  else {
    if(nearest&&nearestDistance<=4.2){
      c.targetX=c.targetY=c.targetZ=null;c.mode='rest';c.waitUntil=now+900;
      c.yaw=Math.atan2(nearest.p.pos[0]-c.x,nearest.p.pos[2]-c.z);
    } else {
      if(c.targetX==null&&now>=c.waitUntil){
        const players=[...room.players.values()].filter(p=>p&&Array.isArray(p.pos)&&p.pos.length>=3&&p.pos.every(Number.isFinite));
        const target=chooseWiseWanderTarget(room,c,players);
        if(target){c.targetX=target.x;c.targetY=target.y;c.targetZ=target.z;c.mode='wander';}
        else {c.mode='rest';c.waitUntil=now+900+Math.random()*1200;}
      }
      if(c.targetX!=null){
        const dx=c.targetX-c.x,dz=c.targetZ-c.z,distance=Math.hypot(dx,dz);
        if(distance<.12){
          c.x=c.targetX;c.y=c.targetY;c.z=c.targetZ;c.targetX=c.targetY=c.targetZ=null;c.mode='rest';c.waitUntil=now+1800+Math.random()*3200;
        } else {
          const step=Math.min(distance,.48*dt),nx=c.x+dx/distance*step,nz=c.z+dz/distance*step;
          const ground=ambientGroundY(room.world,nx,nz);
          if(ground===null||Math.abs(ground+1-c.y)>1.25){
            c.targetX=c.targetY=c.targetZ=null;c.mode='rest';c.waitUntil=now+700+Math.random()*1100;
          } else {c.x=nx;c.z=nz;c.y=ground+1;c.yaw=Math.atan2(dx,dz);}
        }
      }
    }
  }
  c.lastMoveAt=now;
  if(c.greetingCooldownBy.size>64)for(const [id,until] of c.greetingCooldownBy)if(until<now-60000)c.greetingCooldownBy.delete(id);
}

function chooseMischiefTarget(room, creature, angle, distance, players, minPlayerGap = 3.4) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const target = chooseAmbientTarget(room, creature, angle + (Math.random() - 0.5) * 0.95, distance * (0.75 + Math.random() * 0.55));
    if (!target) continue;
    if (players.some(p => Math.hypot(p.pos[0] - target.x, p.pos[2] - target.z) < minPlayerGap)) continue;
    return target;
  }
  return null;
}

const MISCHIEF_DIALOGUE_GENERAL = [
  'あ、いた。ちょっと探してたんだ。',
  'この世界、歩くたびに違って見えるね。',
  'その絵、あとでもう一回見に来よう。',
  'ねえ、あのブロックって前からあった？',
  'ボクはここにいたよ。……たぶんね。',
  '今日は風が気持ちいいね。風、見えないけど。',
  'さっき誰かが通った気がするんだ。',
  '急がなくても、世界は逃げないよ。',
  'ここ、なんだか落ち着くなあ。',
  '見てない間に、ちょっとだけ移動してみた。',
  'ボクの話、聞いてた？ ならいいんだ。',
  'あそこまで行ったら、何かあるかな。',
  'この世界には、まだ知らない場所がありそう。',
  '今の音？ ボクじゃないよ。',
  'ねえ、たまには空も見てみて。',
  'ボク、さっき同じところを三回通ったよ。',
  'その建物、だれか住んでるのかな。',
  'ここで会ったこと、覚えててくれる？',
  'あれ、言おうとしたこと忘れちゃった。',
  '……ううん、なんでもない。'
];
const MISCHIEF_DIALOGUE_CLOSE = [
  'わっ、近い近い。',
  'そんなに見つめると、ちょっと照れるよ。',
  'こんにちは。……言ってみただけ。',
  'ボクのこと、見えてるんだね。',
  'ねえ、いっしょに歩いてもいい？',
  'あっちに行こうと思ってたんだけどな。',
  '驚かせるつもりじゃなかったんだ。たぶん。',
  '手、振ってくれた？ ボクも振るね。',
  'なに？ ……あ、呼んだわけじゃない？',
  'ここにいると、いろんなものが見えるんだ。'
];
function chooseMischiefDialogue(distance) {
  const pool = distance < 5.8 ? MISCHIEF_DIALOGUE_CLOSE : MISCHIEF_DIALOGUE_GENERAL;
  return pool[Math.floor(Math.random() * pool.length)];
}
const MISCHIEF_DIALOGUE_CALL = [
  'ねえ、こっち。', '聞こえてる？', 'こっちだよ。', 'あっちじゃないよ。',
  '見つけられるかな。', 'もう少し、こっち。', 'ねえ。', 'ここにいるよ。'
];
const MISCHIEF_DIALOGUE_FOUND = [
  'あ、見つかった。', 'こんにちは。やっと会えたね。', '来てくれたんだ。',
  'えへへ、気づいてくれた。', 'ちょっとだけ、ここにいてもいい？', 'そんなに探してくれたの？'
];
function playerLooksAtMischief(player, x, z, threshold = 0.34) {
  const dx = x - player.pos[0], dz = z - player.pos[2], d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  const yaw = Number(player.yaw) || 0;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return (fx * dx + fz * dz) / d > threshold;
}
function findMischiefCallSpot(room, player, creature) {
  const px = player.pos[0], pz = player.pos[2], yaw = Number(player.yaw) || 0;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const minX = Math.max(1, Math.floor(px - 8)), maxX = Math.min(W - 2, Math.floor(px + 8));
  const minZ = Math.max(1, Math.floor(pz - 8)), maxZ = Math.min(D - 2, Math.floor(pz + 8));
  const candidates = [];
  for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
    const x = gx + 0.5, z = gz + 0.5, dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    if (d < 3.5 || d > 7.2) continue;
    const forward = (fx * dx + fz * dz) / d;
    const side = (rx * dx + rz * dz) / d;
    // 正面ではなく、後ろ〜斜め後ろの左右から声の方向を探させる。
    if (forward > 0.18 || Math.abs(side) < 0.18) continue;
    if (Math.hypot(x - creature.x, z - creature.z) < 3.2) continue;
    if (room.creatures.some(c => Math.hypot(x - c.x, z - c.z) < 2.5)) continue;
    const ground = ambientGroundY(room.world, x, z);
    if (ground === null) continue;
    candidates.push({ x, y: ground + 1, z, score: Math.abs(side) * 0.6 + Math.max(0, -forward) * 0.25 + Math.random() * 0.25 });
  }
  if (!candidates.length) return findMischiefGroundSpot(room, px, pz, 3.5, 7.2, { x: creature.x, z: creature.z, minGap: 3.2 });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[Math.floor(Math.random() * Math.min(6, candidates.length))];
}

function tickMischiefCreature(room, dt, now) {
  const c = room.mischiefCreature;
  if (!c || !room.players.size) return;
  const playerEntries = [...room.players.entries()].filter(([, p]) => Array.isArray(p.pos) && p.pos.length >= 3 && p.pos.every(Number.isFinite));
  const players = playerEntries.map(([, p]) => p);
  if (!players.length) return;
  let nearest = null, nearestD = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z);
    if (d < nearestD) { nearest = p; nearestD = d; }
  }

  if (c.speech && now >= c.speechUntil) { c.speech = ''; c.speechUntil = 0; }

  // 声を先に聞かせるフェーズ。実体はまだ見えず、方向の手がかりから探す。
  if (c.mode === 'calling') {
    if (now < c.revealAt) return;
    const targetEntry = playerEntries.find(([id]) => id === c.callTargetId);
    const targetPlayer = targetEntry ? targetEntry[1] : nearest;
    c.mode = 'greet';
    c.greetUntil = now + 6500;
    c.ignoreLookUntil = c.greetUntil;
    c.targetX = c.targetY = c.targetZ = null;
    if (targetPlayer) c.yaw = Math.atan2(targetPlayer.pos[0] - c.x, targetPlayer.pos[2] - c.z);
    c.speech = MISCHIEF_DIALOGUE_FOUND[Math.floor(Math.random() * MISCHIEF_DIALOGUE_FOUND.length)];
    c.speechId = (c.speechId || 0) + 1;
    c.speechUntil = now + Math.max(2600, Math.min(3800, c.speech.length * 170));
    return;
  }

  // 見つけた後は少しだけ会話できる。見た瞬間に消えない時間を確保する。
  if (c.mode === 'greet') {
    const callerEntry = playerEntries.find(([id]) => id === c.callTargetId);
    const faceTarget = callerEntry ? callerEntry[1] : nearest;
    if (faceTarget) c.yaw = Math.atan2(faceTarget.pos[0] - c.x, faceTarget.pos[2] - c.z);
    if (now < c.greetUntil) return;
    c.mode = 'peek';
    c.callTargetId = null;
    c.nextActionAt = now + 750;
    c.ignoreLookUntil = now + 950;
    return;
  }

  // 見えない位置から短い声を出し、同じ位置に少し遅れて姿を現す。
  // 声の方向が分かるよう、対象プレイヤーの後ろ〜斜め後ろに出現位置を確保する。
  if (c.mode === 'peek' && c.targetX == null && now >= c.nextSpeechAt) {
    const eligible = playerEntries.map(([id, p]) => ({ id, p, d: Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z) }))
      .filter(v => v.d >= 4.5 && v.d <= 13 && !playerLooksAtMischief(v.p, c.x, c.z));
    if (eligible.length) {
      eligible.sort((a, b) => a.d - b.d);
      const caller = eligible[Math.floor(Math.random() * Math.min(3, eligible.length))];
      const spot = findMischiefCallSpot(room, caller.p, c);
      if (spot) {
        c.x = spot.x; c.y = spot.y; c.z = spot.z;
        c.yaw = Math.atan2(caller.p.pos[0] - c.x, caller.p.pos[2] - c.z);
        c.targetX = c.targetY = c.targetZ = null;
        c.mode = 'calling';
        c.callTargetId = caller.id;
        c.speech = MISCHIEF_DIALOGUE_CALL[Math.floor(Math.random() * MISCHIEF_DIALOGUE_CALL.length)];
        c.speechId = (c.speechId || 0) + 1;
        c.speechUntil = now + Math.max(1900, Math.min(3000, c.speech.length * 150));
        c.revealAt = c.speechUntil + 1050;
        c.greetUntil = c.revealAt + 6500;
        c.nextSpeechAt = now + 22000 + Math.random() * 18000;
        c.ignoreLookUntil = c.revealAt + 6500;
        return;
      }
    }
    // 見ている最中など条件が合わなければ、短時間後に再判定。長い空振りを避ける。
    c.nextSpeechAt = now + 2200;
  }

  if (c.mode === 'hidden') {
    c.speech = ''; c.speechUntil = 0;
    if (now < c.hiddenUntil) return;
    const ref = nearest ? nearest.pos : [c.x, c.y, c.z];
    let spot = findMischiefGroundSpot(room, ref[0], ref[2], 4, 8, { x: c.x, z: c.z, minGap: 3.2 });
    if (!spot) spot = findMischiefGroundSpot(room, c.x, c.z, 3.5, 7.5, { x: c.x, z: c.z, minGap: 3.0 });
    if (!spot) { c.hiddenUntil = now + 650; return; }
    c.x = spot.x; c.y = spot.y; c.z = spot.z;
    c.targetX = c.targetY = c.targetZ = null;
    c.mode = 'peek';
    c.yaw = Math.random() * Math.PI * 2;
    c.ignoreLookUntil = now + 1900;
    c.nextActionAt = now + 1200 + Math.random() * 1900;
    return;
  }

  // プレイヤーが正面から見つめたら一瞬だけ隠れ、別の場所からひょっこり現れる。
  if (now >= c.ignoreLookUntil) {
    for (const p of players) {
      const dx = c.x - p.pos[0], dz = c.z - p.pos[2], d = Math.hypot(dx, dz);
      if (d < 1.7 || d > 12.0) continue;
      if (playerLooksAtMischief(p, c.x, c.z, 0.76)) {
        c.mode = 'hidden';
        c.hiddenUntil = now + 850 + Math.random() * 850;
        c.targetX = c.targetY = c.targetZ = null;
        return;
      }
    }
  }

  if (nearest && nearestD < 3.6 && c.mode !== 'dash') {
    const away = Math.atan2(c.x - nearest.pos[0], c.z - nearest.pos[2]);
    const target = chooseMischiefTarget(room, c, away, 3.2, players, 2.8);
    if (target) {
      c.targetX = target.x; c.targetY = target.y; c.targetZ = target.z;
      c.mode = 'dash'; c.nextActionAt = now + 650;
    } else {
      c.mode = 'peek'; c.targetX = c.targetY = c.targetZ = null; c.nextActionAt = now + 900;
    }
  }

  if (c.mode !== 'dash' && c.targetX == null && now >= c.nextActionAt) {
    let angle = Math.random() * Math.PI * 2;
    let distance = 3.6 + Math.random() * 4.6;
    if (nearest && nearestD > 5.0 && nearestD < 12.0) {
      angle = Math.atan2(nearest.pos[0] - c.x, nearest.pos[2] - c.z);
      distance = 3.0 + Math.random() * 3.2;
    }
    const target = chooseMischiefTarget(room, c, angle, distance, players, 3.8);
    if (target) {
      c.targetX = target.x; c.targetY = target.y; c.targetZ = target.z;
      c.mode = 'sneak';
    } else {
      c.mode = 'peek'; c.nextActionAt = now + 900 + Math.random() * 1200;
    }
  }

  if (c.targetX != null && (c.mode === 'sneak' || c.mode === 'dash')) {
    const dx = c.targetX - c.x, dz = c.targetZ - c.z, distance = Math.hypot(dx, dz);
    if (distance < 0.16) {
      c.x = c.targetX; c.y = c.targetY; c.z = c.targetZ;
      c.targetX = c.targetY = c.targetZ = null;
      c.mode = 'peek'; c.nextActionAt = now + 1400 + Math.random() * 2400;
    } else {
      const step = Math.min(distance, (c.mode === 'dash' ? 2.5 : 0.62) * dt);
      const nx = c.x + dx / distance * step, nz = c.z + dz / distance * step;
      const ground = ambientGroundY(room.world, nx, nz);
      if (ground === null || Math.abs(ground + 1 - c.y) > 1.25) {
        c.targetX = c.targetY = c.targetZ = null;
        c.mode = 'peek'; c.nextActionAt = now + 900 + Math.random() * 1400;
      } else {
        c.x = nx; c.z = nz; c.y = ground + 1;
        c.yaw = Math.atan2(dx, dz);
      }
    }
  }
}

// ===== 洞窟限定の敵「胞子吐き」 =====
// 敵は自然テーマの v20.133 洞窟が実在するときだけ配置する。位置・AI・胞子判定はサーバー権威。
function sporeSolidBlock(b) { return b !== 0 && b !== 8; }
function hasNaturalCaveForSpore(room) {
  if (!room || room.worldTheme !== 'nature' || !room.world) return false;
  const samples = [[18, 9, 9], [22, 9, 9], [11, 9, 6], [14, 9, 14]];
  let valid = 0;
  for (const [x, y, z] of samples) {
    if (room.world[idx(x, 8, z)] > 0 && room.world[idx(x, 8, z)] !== 8 &&
        room.world[idx(x, y, z)] === 0 && room.world[idx(x, y + 1, z)] === 0) valid++;
  }
  return valid >= 3;
}
function createSporeShooter(room) {
  if (!hasNaturalCaveForSpore(room)) return null;
  // 東側の鉱脈通路。天井高と足場が足りる場所だけを候補にする。
  const spots = [{ x: 22.5, y: 9.02, z: 9.5 }, { x: 21.5, y: 9.02, z: 9.5 }, { x: 19.5, y: 9.02, z: 9.5 }];
  const spot = spots.find(p => {
    const x = Math.floor(p.x), z = Math.floor(p.z);
    return room.world[idx(x, 8, z)] > 0 && room.world[idx(x, 8, z)] !== 8 &&
      room.world[idx(x, 9, z)] === 0 && room.world[idx(x, 10, z)] === 0 && room.world[idx(x, 11, z)] === 0;
  });
  if (!spot) return null;
  const now = Date.now();
  return { id: 'spore-shooter-cave-1', ...spot, yaw: Math.PI / 2,
    mode: 'idle', hp: 3, maxHp: 3, modeUntil: 0, nextAttackAt: now + 5000,
    targetId: null, lastPokeAt: 0, defeatedUntil: 0,
    wanderPath: [], wanderIndex: 0, nextWanderAt: now + 1600 + Math.random() * 1200, lastWanderGoal: null };
}
// 胞子吐きの移動範囲は生成済み洞窟の座標内だけ。実際の床・天井・障害物を毎回検査する。
function sporeWalkCell(room, x, z) {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 2 || x > 37 || z < 2 || z > 17) return false;
  if (!sporeSolidBlock(room.world[idx(x, 8, z)]) || room.world[idx(x, 9, z)] !== 0 || room.world[idx(x, 10, z)] !== 0) return false;
  // 天井が近くにあるセルだけを洞窟として扱い、地上へ迷い出る経路を防ぐ。
  for (let y = 11; y <= 17; y++) if (sporeSolidBlock(room.world[idx(x, y, z)])) return true;
  return false;
}
function startSporeWander(room, c, now) {
  const sx = Math.floor(c.x), sz = Math.floor(c.z);
  if (!sporeWalkCell(room, sx, sz)) {
    c.wanderPath = []; c.wanderIndex = 0; c.mode = 'idle';
    c.nextWanderAt = now + 1200;
    return false;
  }
  // まず近距離の到達可能マスを列挙。障害物を貫通せず、通路をたどれる目的地だけ選ぶ。
  const reachable = [], queue = [[sx, sz]], distances = new Map([[`${sx},${sz}`, 0]]), previous = new Map([[`${sx},${sz}`, null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head], key = `${x},${z}`, distance = distances.get(key);
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz, nk = `${nx},${nz}`;
      if (distances.has(nk) || !sporeWalkCell(room, nx, nz)) continue;
      distances.set(nk, distance + 1); previous.set(nk, key); queue.push([nx, nz]);
    }
  }
  for (const [key, distance] of distances) {
    if (distance >= 4 && distance <= 13 && key !== c.lastWanderGoal) reachable.push(key);
  }
  // 曲がり角や分岐の多い洞窟でも止まり続けないよう、候補が少ない場合は距離制限を緩める。
  if (!reachable.length) {
    for (const [key, distance] of distances) if (distance >= 2 && key !== c.lastWanderGoal) reachable.push(key);
  }
  if (!reachable.length) {
    c.wanderPath = []; c.wanderIndex = 0; c.mode = 'idle'; c.nextWanderAt = now + 1800;
    return false;
  }
  const goal = reachable[Math.floor(Math.random() * reachable.length)];
  const reversed = [];
  for (let at = goal; at !== null; at = previous.get(at)) {
    const [x, z] = at.split(',').map(Number); reversed.push({ x: x + 0.5, z: z + 0.5 });
  }
  c.wanderPath = reversed.reverse(); c.wanderIndex = 1; c.lastWanderGoal = goal;
  if (c.wanderPath.length <= 1) {
    c.mode = 'idle'; c.nextWanderAt = now + 1500;
    return false;
  }
  c.mode = 'walk'; c.modeUntil = 0;
  return true;
}
function tickSporeWander(room, c, dt, now) {
  if (c.mode === 'idle') {
    if (now >= (c.nextWanderAt || 0)) startSporeWander(room, c, now);
    return;
  }
  if (c.mode !== 'walk') return;
  if (!Array.isArray(c.wanderPath) || c.wanderIndex >= c.wanderPath.length) {
    c.mode = 'idle'; c.wanderPath = []; c.wanderIndex = 0;
    c.nextWanderAt = now + 1100 + Math.random() * 1900;
    return;
  }
  const target = c.wanderPath[c.wanderIndex], gx = Math.floor(target.x), gz = Math.floor(target.z);
  if (!sporeWalkCell(room, gx, gz)) {
    // プレイヤーが通路を塞いだ場合は停止して再経路探索。壁をすり抜けない。
    c.mode = 'idle'; c.wanderPath = []; c.wanderIndex = 0; c.nextWanderAt = now + 500 + Math.random() * 500;
    return;
  }
  const dx = target.x - c.x, dz = target.z - c.z, distance = Math.hypot(dx, dz);
  if (distance < 0.035) {
    c.x = target.x; c.z = target.z; c.wanderIndex++;
    if (c.wanderIndex >= c.wanderPath.length) {
      c.mode = 'idle'; c.wanderPath = []; c.wanderIndex = 0;
      c.nextWanderAt = now + 1200 + Math.random() * 2200;
    }
    return;
  }
  const step = Math.min(distance, 0.68 * dt);
  c.x += dx / distance * step; c.z += dz / distance * step;
  c.y = 9.02;
  c.yaw = Math.atan2(-dx, -dz);
  if (step >= distance - 0.035) {
    c.x = target.x; c.z = target.z; c.wanderIndex++;
    if (c.wanderIndex >= c.wanderPath.length) {
      c.mode = 'idle'; c.wanderPath = []; c.wanderIndex = 0;
      c.nextWanderAt = now + 1200 + Math.random() * 2200;
    }
  }
}
function playerIsInNaturalCave(room, player) {
  if (!hasNaturalCaveForSpore(room) || !player || !Array.isArray(player.pos) || player.pos.length < 3 || !player.pos.every(Number.isFinite)) return false;
  const [px, py, pz] = player.pos;
  if (px < 1.5 || px > 37.5 || pz < 2.5 || pz > 18.5 || py < 8.65 || py > 11.85) return false;
  const x = Math.floor(px), z = Math.floor(pz), floorY = Math.floor(py - 0.08), bodyY = Math.floor(py + 0.25), headY = Math.floor(py + 1.15);
  if (x < 0 || z < 0 || floorY < 0 || headY >= H) return false;
  return sporeSolidBlock(room.world[idx(x, floorY, z)]) &&
    room.world[idx(x, bodyY, z)] === 0 && room.world[idx(x, headY, z)] === 0;
}
function sporeLineClear(room, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz), steps = Math.max(1, Math.ceil(length / 0.14));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = Math.floor(from.x + dx * t), y = Math.floor(from.y + dy * t), z = Math.floor(from.z + dz * t);
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return false;
    if (sporeSolidBlock(room.world[idx(x, y, z)])) return false;
  }
  return true;
}
function sporeStateForRoom(room) {
  const c = room.sporeShooter;
  return {
    creature: c ? { id: c.id, p: [c.x, c.y, c.z], yaw: c.yaw, mode: c.mode, hp: c.hp, maxHp: c.maxHp, modeUntil: c.modeUntil } : null,
    shots: room.sporeShots.map(s => ({ id: s.id, p: [s.x, s.y, s.z], bornAt: s.bornAt, expiresAt: s.expiresAt })),
    clouds: room.sporeClouds.map(s => ({ id: s.id, p: [s.x, s.y, s.z], radius: s.radius, bornAt: s.bornAt, expiresAt: s.expiresAt, toxic: s.toxic !== false }))
  };
}
function broadcastSporeState(room) { room.broadcast({ t: 'spore-state', ...sporeStateForRoom(room) }); }
function createSporeCloud(room, x, y, z, now, toxic = true) {
  room.sporeClouds.push({ id: `spore-cloud-${room.nextSporeId++}`, x, y, z, radius: 1.32, bornAt: now, expiresAt: now + 3900, toxic });
  // 同時に残る雲は少数に制限し、長時間の連射でも負荷と視界妨害を抑える。
  while (room.sporeClouds.length > 5) room.sporeClouds.shift();
}
function spawnSporeProjectile(room, creature, player, now) {
  const from = { x: creature.x, y: creature.y + 1.03, z: creature.z };
  const to = { x: player.pos[0], y: player.pos[1] + 1.0, z: player.pos[2] };
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.max(0.001, Math.hypot(dx, dy, dz));
  const speed = 6.0;
  room.sporeShots.push({ id: `spore-shot-${room.nextSporeId++}`, x: from.x, y: from.y, z: from.z,
    vx: dx / len * speed, vy: dy / len * speed, vz: dz / len * speed,
    bornAt: now, expiresAt: now + 2600, lastX: from.x, lastY: from.y, lastZ: from.z });
  while (room.sporeShots.length > 4) room.sporeShots.shift();
}
function tickSporeShooter(room, dt, now) {
  const c = room.sporeShooter;
  if (!c) return;
  room.sporeClouds = room.sporeClouds.filter(cloud => cloud.expiresAt > now);

  if (c.mode === 'defeated') {
    if (now >= c.defeatedUntil) {
      c.hp = c.maxHp; c.mode = 'idle'; c.targetId = null; c.nextAttackAt = now + 9000;
    } else return;
  }
  if (c.mode === 'hit' && now >= c.modeUntil) { c.mode = 'recover'; c.modeUntil = now + 420; }
  if (c.mode === 'spit' && now >= c.modeUntil) { c.mode = 'recover'; c.modeUntil = now + 500; }
  if (c.mode === 'recover' && now >= c.modeUntil) c.mode = 'idle';

  const entries = [...room.players.entries()].filter(([, p]) => playerIsInNaturalCave(room, p));
  let nearest = null, nearestD = Infinity;
  for (const [id, p] of entries) {
    const d = Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z);
    if (d < nearestD) { nearestD = d; nearest = { id, player: p, d }; }
  }
  if (c.mode === 'aim') {
    const target = entries.find(([id]) => id === c.targetId);
    if (!target || Math.hypot(target[1].pos[0] - c.x, target[1].pos[2] - c.z) > 9 ||
        !sporeLineClear(room, { x: c.x, y: c.y + 1.03, z: c.z }, { x: target[1].pos[0], y: target[1].pos[1] + 1.0, z: target[1].pos[2] })) {
      c.mode = 'idle'; c.targetId = null; c.nextAttackAt = now + 650;
      c.wanderPath = []; c.wanderIndex = 0; c.nextWanderAt = now + 700;
    } else {
      const dx = target[1].pos[0] - c.x, dz = target[1].pos[2] - c.z;
      c.yaw = Math.atan2(-dx, -dz);
      if (now >= c.modeUntil) {
        spawnSporeProjectile(room, c, target[1], now);
        c.mode = 'spit'; c.modeUntil = now + 360; c.nextAttackAt = now + 2900; c.targetId = null;
        c.wanderPath = []; c.wanderIndex = 0; c.nextWanderAt = now + 750;
      }
    }
  } else if ((c.mode === 'idle' || c.mode === 'walk') && nearest && nearestD <= 8.0 && now >= c.nextAttackAt &&
      sporeLineClear(room, { x: c.x, y: c.y + 1.03, z: c.z }, { x: nearest.player.pos[0], y: nearest.player.pos[1] + 1.0, z: nearest.player.pos[2] })) {
    const dx = nearest.player.pos[0] - c.x, dz = nearest.player.pos[2] - c.z;
    c.yaw = Math.atan2(-dx, -dz); c.targetId = nearest.id;
    c.mode = 'aim'; c.modeUntil = now + 1000;
    c.wanderPath = []; c.wanderIndex = 0;
  }
  // 洞窟内にプレイヤーがいる間だけゆっくり徘徊。壁・天井・床の現在の状態を見て経路を作る。
  if (entries.length && (c.mode === 'idle' || c.mode === 'walk')) tickSporeWander(room, c, dt, now);

  // サーバー上で胞子弾を進め、ブロック・プレイヤーへ触れたら胞子雲へ変える。
  const remainingShots = [];
  for (const shot of room.sporeShots) {
    const old = { x: shot.x, y: shot.y, z: shot.z };
    const nx = shot.x + shot.vx * dt, ny = shot.y + shot.vy * dt, nz = shot.z + shot.vz * dt;
    const travel = Math.hypot(nx - old.x, ny - old.y, nz - old.z), steps = Math.max(1, Math.ceil(travel / 0.12));
    let collided = false, cx = nx, cy = ny, cz = nz;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps, x = old.x + (nx - old.x) * u, y = old.y + (ny - old.y) * u, z = old.z + (nz - old.z) * u;
      const gx = Math.floor(x), gy = Math.floor(y), gz = Math.floor(z);
      if (gx < 0 || gx >= W || gy < 0 || gy >= H || gz < 0 || gz >= D || sporeSolidBlock(room.world[idx(gx, gy, gz)])) {
        collided = true; cx = x; cy = y; cz = z; break;
      }
      for (const [, player] of entries) {
        const dx = x - player.pos[0], dy = y - (player.pos[1] + 0.92), dz = z - player.pos[2];
        if (Math.hypot(dx, dz) < 0.48 && Math.abs(dy) < 0.8) { collided = true; cx = x; cy = y; cz = z; break; }
      }
      if (collided) break;
    }
    shot.x = cx; shot.y = cy; shot.z = cz;
    if (collided || now >= shot.expiresAt) createSporeCloud(room, shot.x, shot.y, shot.z, now, true);
    else remainingShots.push(shot);
  }
  room.sporeShots = remainingShots;

  // 雲の近くにいるプレイヤーは短時間だけ移動が鈍る。雲に留まると効果を更新する。
  for (const [id, player] of entries) {
    for (const cloud of room.sporeClouds) {
      if (cloud.toxic === false) continue;
      const dx = player.pos[0] - cloud.x, dz = player.pos[2] - cloud.z;
      if (Math.hypot(dx, dz) <= cloud.radius && Math.abs((player.pos[1] + 0.9) - cloud.y) <= 1.35) {
        if ((player.sporeSlowUntil || 0) < now + 400) {
          player.sporeSlowUntil = now + 1450;
          room.send(id, { t: 'spore-slow', ms: 1450 });
        }
        break;
      }
    }
  }
}

// ===== 単一の世界（部屋は1つだけ） =====
class Room {
  constructor() {
    this.code = 'main';
    this.worldTheme = 'nature';
    this.world = genTerrain(this.worldTheme);
    this.naturalCaveVersion = NATURAL_CAVE_VERSION;
    this.drawingWallMaterialVersion = START_DRAWING_WALL_MATERIAL_VERSION;
    this.phoneStation = placePhoneStation(this.world, this.worldTheme);
    this.paint = new Map(); // key "x,y,z,f" -> Uint16Array(PX)
    this.faceAuthor = new Map(); // key "x,y,z,f" -> name
    this.players = new Map(); // id -> { ws, name, col, sk, admin, pos, yaw }
    this.creatures = []; // ambient critters are ephemeral and never saved in world snapshots
    this.mischiefCreature = null; // 別種のいたずら精霊。既存3匹の行動とは独立
    this.forestResident = null; // ポストン。永続ワールドには保存しない
    this.wiseCharacter = null; // ホシヨミ。永続ワールドには保存しない
    this.sporeShooter = null; // 洞窟限定の敵。ワールド保存データには含めない
    this.sporeShots = [];
    this.sporeClouds = [];
    this.nextSporeId = 1;
    this.resetSporeShooter();
    this.perm = { blk: true, pen: true };
    this.topic = '';
    this.topicAt = Date.now();
    this.topicEnabled = false; // 初期はオフ。管理者がONにできる
    this.lastActive = Date.now();
  }

  snapshot() {
    const keys = [...this.paint.keys()];
    const u = new Uint16Array(keys.length * PX);
    keys.forEach((k, i) => {
      const d = this.paint.get(k);
      if (d) u.set(d, i * PX);
    });
    const authors = [];
    for (const k of keys) {
      const n = this.faceAuthor.get(k);
      if (n) authors.push([k, n]);
    }
    return {
      rle: rle(this.world),
      keys,
      data: Buffer.from(u.buffer).toString('base64'),
      authors,
      naturalCaveVersion: Number.isInteger(this.naturalCaveVersion) ? this.naturalCaveVersion : 0,
      drawingWallMaterialVersion: this.drawingWallMaterialVersion || 0,
    };
  }

  applySnapshot(m) {
    // 全件を検証してから現在のワールドを書き換える。
    const buf = validateWorldSnapshot(m);
    const d = new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    unrle(m.rle, this.world);
    this.naturalCaveVersion = Number.isInteger(m.naturalCaveVersion) ? m.naturalCaveVersion : 0;
    this.drawingWallMaterialVersion = Number.isInteger(m.drawingWallMaterialVersion) ? m.drawingWallMaterialVersion : 0;
    this.paint.clear();
    this.faceAuthor.clear();
    m.keys.forEach((k, i) => {
      const arr = new Uint16Array(PX);
      arr.set(d.subarray(i * PX, (i + 1) * PX));
      // 空でないスロットだけ保持
      let has = false;
      for (let p = 0; p < PX; p++) if (arr[p]) { has = true; break; }
      if (has) this.paint.set(k, arr);
    });
    if (Array.isArray(m.authors)) {
      const validKeys = new Set(m.keys);
      for (const a of m.authors) {
        if (Array.isArray(a) && validPaintKey(a[0]) && validKeys.has(a[0]) && typeof a[1] === 'string')
          this.faceAuthor.set(a[0], a[1].slice(0, 12));
      }
    }
  }

  resetCreatures() {
    this.creatures = createAmbientCreatures(this);
  }

  resetMischiefCreature() {
    this.mischiefCreature = createMischiefCreature(this);
  }

  resetForestResident() {
    this.forestResident = createForestResident(this);
  }

  resetWiseCharacter() {
    this.wiseCharacter = createWiseCharacter(this);
  }

  resetSporeShooter() {
    this.sporeShots = [];
    this.sporeClouds = [];
    this.nextSporeId = 1;
    this.sporeShooter = createSporeShooter(this);
  }

  sporeShooterState() {
    return sporeStateForRoom(this);
  }

  wiseCharacterState() {
    const c = this.wiseCharacter;
    if (!c) return null;
    const now = Date.now();
    const speaking = !!c.speech && now < c.speechUntil;
    return { id: c.id, epoch: c.epoch || '', p: [c.x, c.y, c.z], yaw: c.yaw, speech: speaking ? c.speech : '', speechId: c.speechId || 0, speechMs: speaking ? Math.max(0, Math.min(9500, c.speechUntil - now)) : 0 };
  }

  forestResidentState() {
    const c = this.forestResident;
    if (!c) return null;
    const now = Date.now();
    const speaking = !!c.speech && now < c.speechUntil;
    return { id: c.id, epoch: c.epoch || '', p: [c.x, c.y, c.z], yaw: c.yaw, mode: speaking ? 'talking' : (c.targetX != null ? 'walk' : 'idle'), speech: speaking ? c.speech : '', speechId: c.speechId || 0, speechMs: speaking ? Math.max(0, Math.min(9000, c.speechUntil - now)) : 0 };
  }

  mischiefCreatureState() {
    const c = this.mischiefCreature;
    if (!c) return null;
    const now = Date.now();
    const speaking = !!c.speech && now < c.speechUntil;
    return {
      id: c.id, p: [c.x, c.y, c.z], yaw: c.yaw, mode: c.mode,
      // ひょっこりんのセリフ文字列は配信せず、鳴き声トリガーだけを同期する。
      speech: '', voiceCue: speaking, speechId: c.speechId || 0,
      speechMs: speaking ? Math.max(0, Math.min(3800, c.speechUntil - now)) : 0,
    };
  }

  creaturesList() {
    return this.creatures.map(c => ({ id: c.id, type: c.type, p: [c.x, c.y, c.z], yaw: c.yaw, mode: c.mode }));
  }

  playersList() {
    return [...this.players.entries()].map(([id, p]) => ({
      id,
      name: p.name,
      col: p.col,
      sk: p.sk,
    }));
  }

  broadcast(msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const [id, p] of this.players) {
      if (id === exceptId) continue;
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  send(id, msg) {
    const p = this.players.get(id);
    if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  isAdmin(id) {
    const p = this.players.get(id);
    return p && p.admin;
  }

  touch() {
    this.lastActive = Date.now();
  }
}

const mainRoom = new Room();
let shuttingDown = false;
console.log('[world] 単一ワールドを生成しました');

// ===== ワールド内テレフォンゲーム（単一セッション） =====
// 文章・絵は進行中に担当者本人へだけ返し、結果フェーズで初めて全体公開する。
const PHONE_MAX_PLAYERS = 8;
let phoneGame = null;

// 怪異演出は管理者がワールド全体で有効化する。電話だけは端末付近の参加者1人へ個別配信し、ワールドデータは変更しない。
const horrorOptIns = new Set();
let horrorSystemEnabled = false; // 怪異イベントは管理者がワールド全体で有効化する
let horrorEventTimer = null;
let activeHorrorPhoneCall = null;
let horrorPhoneCallTimer = null;
// 初回はすぐ体験できるよう短くし、その後は待ちすぎない間隔にする。
const HORROR_EVENT_FIRST_MIN_MS = 20 * 1000;
const HORROR_EVENT_FIRST_MAX_MS = 35 * 1000;
const HORROR_EVENT_MIN_MS = 90 * 1000;
const HORROR_EVENT_MAX_MS = 180 * 1000;
let horrorEventHasFired = false;
// 端末の近くに参加者がいる場合に限って電話を抽選し、近くにいなければ足音／囁きへ回す。
// 初回の有効な電話は選ばれやすくし、その後も電話イベントが埋もれない程度の確率を保つ。
let horrorAutomaticPhoneHasFired = false;
let lastHorrorPhoneRecipientId = null;
const HORROR_PHONE_LINE_COUNT = 48;
// 直近の台詞を避け、全台詞を使い切るまでは重複しないシャッフルバッグ。
let horrorPhoneLineBag = [];
let lastHorrorPhoneVoiceId = -1;
function nextHorrorPhoneVoiceId() {
  if (horrorPhoneLineBag.length === 0) {
    horrorPhoneLineBag = Array.from({ length: HORROR_PHONE_LINE_COUNT }, (_, i) => i);
    for (let i = horrorPhoneLineBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [horrorPhoneLineBag[i], horrorPhoneLineBag[j]] = [horrorPhoneLineBag[j], horrorPhoneLineBag[i]];
    }
    // バッグの切り替わりでも同じ台詞が連続しないようにする。
    if (horrorPhoneLineBag.length > 1 && horrorPhoneLineBag[horrorPhoneLineBag.length - 1] === lastHorrorPhoneVoiceId) {
      const swapIndex = horrorPhoneLineBag.findIndex((id) => id !== lastHorrorPhoneVoiceId);
      const lastIndex = horrorPhoneLineBag.length - 1;
      [horrorPhoneLineBag[lastIndex], horrorPhoneLineBag[swapIndex]] = [horrorPhoneLineBag[swapIndex], horrorPhoneLineBag[lastIndex]];
    }
  }
  lastHorrorPhoneVoiceId = horrorPhoneLineBag.pop();
  return lastHorrorPhoneVoiceId;
}
function chooseHorrorEventKind(phoneAlreadyFired, hasNearbyPhoneRecipient) {
  // 電話は端末から14ブロック以内に有効参加者がいる場合だけ選択できる。
  if (hasNearbyPhoneRecipient && !phoneAlreadyFired) return 'phone-ring';
  if (hasNearbyPhoneRecipient && Math.random() < 0.42) return 'phone-ring';
  return Math.random() < 0.5 ? 'footsteps' : 'whisper';
}
function isPlayerNearPhoneStation(playerId, range = 14) {
  const player = mainRoom.players.get(playerId);
  const station = mainRoom.phoneStation;
  if (!player || !Array.isArray(player.pos) || player.pos.length < 3 || !station) return false;
  return Math.hypot(player.pos[0] - (station.x + 0.5), player.pos[2] - (station.z + 0.5)) <= range;
}

function chooseHorrorPhoneRecipient(recipients) {
  // 複数人いる場合は直前の着信対象を避け、特定の人に偏りにくくする。
  const alternatives = recipients.filter((id) => id !== lastHorrorPhoneRecipientId);
  const pool = alternatives.length ? alternatives : recipients;
  const targetId = pool[Math.floor(Math.random() * pool.length)] || null;
  if (targetId) lastHorrorPhoneRecipientId = targetId;
  return targetId;
}
function endActiveHorrorPhoneCall(callId, notify = true) {
  if (!activeHorrorPhoneCall || (callId && activeHorrorPhoneCall.id !== callId)) return;
  const old = activeHorrorPhoneCall;
  activeHorrorPhoneCall = null;
  if (horrorPhoneCallTimer) clearTimeout(horrorPhoneCallTimer);
  horrorPhoneCallTimer = null;
  // 着信の存在を知るのは対象者だけ。終了通知も対象のクライアントだけに送る。
  if (notify && old.targetId && mainRoom.players.has(old.targetId)) {
    mainRoom.send(old.targetId, { t: 'horror-phone-ended', callId: old.id });
  }
}
function scheduleHorrorEvent() {
  if (!horrorSystemEnabled || horrorEventTimer || horrorOptIns.size === 0) return;
  const firstEvent = !horrorEventHasFired;
  const minDelay = firstEvent ? HORROR_EVENT_FIRST_MIN_MS : HORROR_EVENT_MIN_MS;
  const maxDelay = firstEvent ? HORROR_EVENT_FIRST_MAX_MS : HORROR_EVENT_MAX_MS;
  const delay = minDelay + Math.random() * (maxDelay - minDelay);
  horrorEventTimer = setTimeout(() => {
    horrorEventTimer = null;
    if (!horrorSystemEnabled) return;
    horrorEventHasFired = true;
    const recipients = [...horrorOptIns].filter((id) => mainRoom.players.has(id));
    const nearbyPhoneRecipients = recipients.filter((id) => isPlayerNearPhoneStation(id, 14));
    if (recipients.length) {
      // 足音・囁きは有効参加者へ共有。電話だけは筐体の近くにいる参加者1人に限定。
      const kind = chooseHorrorEventKind(horrorAutomaticPhoneHasFired, nearbyPhoneRecipients.length > 0);
      if (kind === 'phone-ring') {
        const targetId = chooseHorrorPhoneRecipient(nearbyPhoneRecipients);
        if (targetId) {
          horrorAutomaticPhoneHasFired = true;
          endActiveHorrorPhoneCall(undefined, false);
          const callId = crypto.randomBytes(8).toString('hex');
          const at = Date.now();
          const expiresAt = at + 32000;
          activeHorrorPhoneCall = { id: callId, expiresAt, targetId };
          mainRoom.send(targetId, { t: 'horror-event', kind, at, callId, expiresAt });
          horrorPhoneCallTimer = setTimeout(() => endActiveHorrorPhoneCall(callId, true), 32000);
          if (horrorPhoneCallTimer && typeof horrorPhoneCallTimer.unref === 'function') horrorPhoneCallTimer.unref();
        } else {
          const fallbackKind = Math.random() < 0.5 ? 'footsteps' : 'whisper';
          const event = { t: 'horror-event', kind: fallbackKind, at: Date.now() };
          for (const id of recipients) mainRoom.send(id, event);
        }
      } else {
        const event = { t: 'horror-event', kind, at: Date.now() };
        for (const id of recipients) mainRoom.send(id, event);
      }
    }
    scheduleHorrorEvent();
  }, delay);
  if (horrorEventTimer && typeof horrorEventTimer.unref === 'function') horrorEventTimer.unref();
}
function setGlobalHorrorEnabled(enabled) {
  const next = enabled === true;
  if (horrorSystemEnabled === next) {
    mainRoom.broadcast({ t: 'horror-state', enabled: horrorSystemEnabled });
    return;
  }
  horrorSystemEnabled = next;
  if (horrorEventTimer) { clearTimeout(horrorEventTimer); horrorEventTimer = null; }
  if (!horrorSystemEnabled) {
    endActiveHorrorPhoneCall(undefined, true);
    horrorOptIns.clear();
    horrorEventHasFired = false;
    horrorAutomaticPhoneHasFired = false;
    lastHorrorPhoneRecipientId = null;
  } else {
    horrorOptIns.clear();
    for (const id of mainRoom.players.keys()) horrorOptIns.add(id);
    horrorEventHasFired = false;
    horrorAutomaticPhoneHasFired = false;
    lastHorrorPhoneRecipientId = null;
  }
  mainRoom.broadcast({ t: 'horror-state', enabled: horrorSystemEnabled });
  if (horrorSystemEnabled) scheduleHorrorEvent();
  console.log('[horror] global ' + (horrorSystemEnabled ? 'enabled' : 'disabled'));
}

// ===== 自然災害イベント（演出のみ。ワールド／落書きデータは変更しない） =====
const DISASTER_KINDS = ['storm', 'meteor-shower', 'meteor-impact', 'blizzard'];
const DISASTER_DURATIONS = { storm: 120000, 'meteor-shower': 19000, 'meteor-impact': 12500, blizzard: 90000 };
let naturalDisastersEnabled = true; // デフォルトで有効。管理者がいつでも切替可能
let naturalDisasterTimer = null;
let naturalDisasterEndTimer = null;
let activeNaturalDisaster = null;
let naturalDisasterHasFired = false;
let naturalDisasterBag = [];
let lastNaturalDisasterKind = null;

function nextNaturalDisasterKind() {
  if (!naturalDisasterBag.length) {
    naturalDisasterBag = DISASTER_KINDS.slice();
    for (let i = naturalDisasterBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [naturalDisasterBag[i], naturalDisasterBag[j]] = [naturalDisasterBag[j], naturalDisasterBag[i]];
    }
    if (naturalDisasterBag.length > 1 && naturalDisasterBag[naturalDisasterBag.length - 1] === lastNaturalDisasterKind) {
      const other = naturalDisasterBag.findIndex((kind) => kind !== lastNaturalDisasterKind);
      const last = naturalDisasterBag.length - 1;
      [naturalDisasterBag[last], naturalDisasterBag[other]] = [naturalDisasterBag[other], naturalDisasterBag[last]];
    }
  }
  lastNaturalDisasterKind = naturalDisasterBag.pop();
  return lastNaturalDisasterKind;
}

function getActiveNaturalDisaster() {
  if (!activeNaturalDisaster) return null;
  if (Date.now() >= activeNaturalDisaster.at + activeNaturalDisaster.durationMs) return null;
  return { ...activeNaturalDisaster };
}

function endNaturalDisaster(eventId) {
  if (!activeNaturalDisaster || (eventId && activeNaturalDisaster.id !== eventId)) return;
  const old = activeNaturalDisaster;
  activeNaturalDisaster = null;
  if (naturalDisasterEndTimer) clearTimeout(naturalDisasterEndTimer);
  naturalDisasterEndTimer = null;
  mainRoom.broadcast({ t: 'disaster-ended', id: old.id });
  // 次のイベントは現在の災害が終わってから、45〜90秒の休止を挟んで予約する。
  if (naturalDisastersEnabled) scheduleNaturalDisaster();
}

function scheduleNaturalDisaster() {
  if (!naturalDisastersEnabled || naturalDisasterTimer || activeNaturalDisaster || mainRoom.players.size === 0) return;
  // 初回は早めに発生。2回目以降は前の災害終了後に休止を挟む。
  const first = !naturalDisasterHasFired;
  const minDelay = first ? 15000 : 45000;
  const maxDelay = first ? 24000 : 90000;
  const delay = minDelay + Math.random() * (maxDelay - minDelay);
  naturalDisasterTimer = setTimeout(() => {
    naturalDisasterTimer = null;
    if (!naturalDisastersEnabled || mainRoom.players.size === 0) return;
    const kind = nextNaturalDisasterKind();
    const event = {
      id: crypto.randomBytes(8).toString('hex'),
      kind,
      at: Date.now(),
      durationMs: DISASTER_DURATIONS[kind],
      seed: crypto.randomInt(1, 0x7fffffff),
    };
    activeNaturalDisaster = event;
    naturalDisasterHasFired = true;
    mainRoom.broadcast({ t: 'disaster-event', ...event });
    if (naturalDisasterEndTimer) clearTimeout(naturalDisasterEndTimer);
    naturalDisasterEndTimer = setTimeout(() => endNaturalDisaster(event.id), event.durationMs);
    if (naturalDisasterEndTimer && typeof naturalDisasterEndTimer.unref === 'function') naturalDisasterEndTimer.unref();
  }, delay);
  if (naturalDisasterTimer && typeof naturalDisasterTimer.unref === 'function') naturalDisasterTimer.unref();
}

// ===== ケサランパサラン大量発生イベント（天候イベントとは別系統） =====
const KESARAN_EVENT_DURATION_MS = 48000;
let kesaranEventsEnabled = true; // デフォルトで有効。天候とは独立
let kesaranEventTimer = null;
let kesaranEventEndTimer = null;
let activeKesaranEvent = null;
let kesaranEventHasFired = false;
function getActiveKesaranEvent() {
  if (!activeKesaranEvent) return null;
  if (Date.now() >= activeKesaranEvent.at + activeKesaranEvent.durationMs) return null;
  return { ...activeKesaranEvent };
}
function endKesaranEvent(eventId) {
  if (!activeKesaranEvent || (eventId && activeKesaranEvent.id !== eventId)) return;
  const old = activeKesaranEvent;
  activeKesaranEvent = null;
  if (kesaranEventEndTimer) clearTimeout(kesaranEventEndTimer);
  kesaranEventEndTimer = null;
  mainRoom.broadcast({ t: 'kesaran-ended', id: old.id });
  if (kesaranEventsEnabled) scheduleKesaranEvent();
}
function scheduleKesaranEvent() {
  // 意図的に activeNaturalDisaster を確認しない。天候イベントと重なって発生できる。
  if (!kesaranEventsEnabled || kesaranEventTimer || activeKesaranEvent || mainRoom.players.size === 0) return;
  const first = !kesaranEventHasFired;
  const minDelay = first ? 25000 : 95000;
  const maxDelay = first ? 40000 : 175000;
  const delay = minDelay + Math.random() * (maxDelay - minDelay);
  kesaranEventTimer = setTimeout(() => {
    kesaranEventTimer = null;
    if (!kesaranEventsEnabled || mainRoom.players.size === 0) return;
    const event = {
      id: crypto.randomBytes(8).toString('hex'),
      kind: 'kesaranpasaran',
      at: Date.now(),
      durationMs: KESARAN_EVENT_DURATION_MS,
      seed: crypto.randomInt(1, 0x7fffffff),
    };
    activeKesaranEvent = event;
    kesaranEventHasFired = true;
    mainRoom.broadcast({ t: 'kesaran-event', ...event });
    if (kesaranEventEndTimer) clearTimeout(kesaranEventEndTimer);
    kesaranEventEndTimer = setTimeout(() => endKesaranEvent(event.id), event.durationMs);
    if (kesaranEventEndTimer && typeof kesaranEventEndTimer.unref === 'function') kesaranEventEndTimer.unref();
  }, delay);
  if (kesaranEventTimer && typeof kesaranEventTimer.unref === 'function') kesaranEventTimer.unref();
}
function setKesaranEventsEnabled(enabled) {
  const next = enabled === true;
  if (kesaranEventsEnabled === next) {
    mainRoom.broadcast({ t: 'kesaran-state', enabled: kesaranEventsEnabled, activeKesaranEvent: getActiveKesaranEvent() });
    return;
  }
  kesaranEventsEnabled = next;
  if (kesaranEventTimer) { clearTimeout(kesaranEventTimer); kesaranEventTimer = null; }
  if (kesaranEventEndTimer) { clearTimeout(kesaranEventEndTimer); kesaranEventEndTimer = null; }
  activeKesaranEvent = null;
  kesaranEventHasFired = false;
  mainRoom.broadcast({ t: 'kesaran-state', enabled: kesaranEventsEnabled, activeKesaranEvent: null });
  if (kesaranEventsEnabled) scheduleKesaranEvent();
  console.log('[kesaranpasaran] global ' + (kesaranEventsEnabled ? 'enabled' : 'disabled'));
}

function setNaturalDisastersEnabled(enabled) {
  const next = enabled === true;
  if (naturalDisastersEnabled === next) {
    mainRoom.broadcast({ t: 'disaster-state', enabled: naturalDisastersEnabled, activeDisaster: getActiveNaturalDisaster() });
    return;
  }
  naturalDisastersEnabled = next;
  if (naturalDisasterTimer) { clearTimeout(naturalDisasterTimer); naturalDisasterTimer = null; }
  if (naturalDisasterEndTimer) { clearTimeout(naturalDisasterEndTimer); naturalDisasterEndTimer = null; }
  activeNaturalDisaster = null;
  naturalDisasterHasFired = false;
  naturalDisasterBag = [];
  lastNaturalDisasterKind = null;
  mainRoom.broadcast({ t: 'disaster-state', enabled: naturalDisastersEnabled, activeDisaster: null });
  if (naturalDisastersEnabled) scheduleNaturalDisaster();
  console.log('[disaster] global ' + (naturalDisastersEnabled ? 'enabled' : 'disabled'));
}

function removeHorrorParticipant(playerId) {
  horrorOptIns.delete(playerId);
  if (activeHorrorPhoneCall && activeHorrorPhoneCall.targetId === playerId) {
    endActiveHorrorPhoneCall(activeHorrorPhoneCall.id, true);
  }
  if (horrorOptIns.size === 0) {
    if (horrorEventTimer) { clearTimeout(horrorEventTimer); horrorEventTimer = null; }
    horrorEventHasFired = false;
    horrorAutomaticPhoneHasFired = false;
    lastHorrorPhoneRecipientId = null;
    endActiveHorrorPhoneCall(undefined, false);
  }
}
function handleHorrorPhoneAnswer(playerId, room, me, m) {
  if (!rateOk(rateChat, playerId + ':horror-phone-answer', 2, 5000)) return false;
  const call = activeHorrorPhoneCall;
  if (!horrorSystemEnabled || !horrorOptIns.has(playerId) || !call || call.targetId !== playerId || String(m.callId || '') !== call.id || call.expiresAt <= Date.now() || !isPlayerNearPhoneStation(playerId, 14)) return false;
  // 対象者本人のみが応答でき、台詞も本人にだけ聞こえる。他プレイヤーには共有しない。
  const voiceId = nextHorrorPhoneVoiceId();
  endActiveHorrorPhoneCall(call.id, false);
  mainRoom.send(playerId, { t: 'horror-phone-answered', callId: call.id, voiceId, at: Date.now() });
  return true;
}


function phoneMemberIndex(game, id) {
  return game ? game.players.findIndex((p) => p.id === id) : -1;
}

function phoneBookIndex(game, playerId) {
  const i = phoneMemberIndex(game, playerId);
  const n = game && game.players.length;
  if (i < 0 || !n) return -1;
  if (game.phase === 'prompt') return i;
  return ((i - game.stage) % n + n) % n;
}

function phoneStateFor(playerId) {
  const g = phoneGame;
  if (!g) return { t: 'phone-state', state: null };
  const member = phoneMemberIndex(g, playerId) >= 0;
  const state = {
    id: g.id,
    phase: g.phase,
    serverNow: Date.now(),
    maxPlayers: PHONE_MAX_PLAYERS,
    ownerId: g.ownerId,
    ownerName: (mainRoom.players.get(g.ownerId) || {}).name || g.ownerName || '参加者',
    players: g.players.map((p) => ({ id: p.id, name: p.name })),
    stage: g.stage,
    totalStages: g.maxStages,
    horrorMode: g.horrorMode === true,
    deadline: g.deadline || null,
    submittedIds: member ? [...g.submitted] : [],
    isMember: member,
    mySubmitted: member && g.submitted.has(playerId),
  };

  if (member && (g.phase === 'prompt' || g.phase === 'draw' || g.phase === 'caption')) {
    const bi = phoneBookIndex(g, playerId);
    const book = bi >= 0 ? g.books[bi] : null;
    if (book) {
      const previous = book.entries.length ? book.entries[book.entries.length - 1] : null;
      state.myTask = g.phase === 'prompt'
        ? { type: 'prompt' }
        : previous
          ? { type: g.phase, sourceType: previous.type, sourceValue: previous.value, sourceName: previous.authorName }
          : null;
    }
  }

  // 回答内容は結果発表までメンバーにも他人の分を送らない。
  if (g.phase === 'results' && member) {
    state.books = g.books.map((book) => ({
      authorName: book.authorName,
      entries: book.entries.map((entry) => ({
        type: entry.type,
        authorName: entry.authorName,
        value: entry.value,
      })),
    }));
  }
  return { t: 'phone-state', state };
}

function phoneSendState(playerId) {
  const p = mainRoom.players.get(playerId);
  if (!p || p.ws.readyState !== 1) return;
  p.ws.send(JSON.stringify(phoneStateFor(playerId)));
}

function phoneBroadcastState() {
  for (const id of mainRoom.players.keys()) phoneSendState(id);
}

function phoneError(playerId, message) {
  mainRoom.send(playerId, { t: 'phone-error', message: String(message || '操作できません') });
}

const PHONE_PROMPT_MS = 60 * 1000;
const PHONE_DRAW_MS = 90 * 1000;
const PHONE_BLANK_DRAW = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC';
function phoneDuration(phase) {
  return phase === 'draw' ? PHONE_DRAW_MS : PHONE_PROMPT_MS;
}
function phoneSetPhase(game, phase, stage) {
  game.phase = phase;
  if (typeof stage === 'number') game.stage = stage;
  game.submitted = new Set();
  game.deadline = ['prompt', 'draw', 'caption'].includes(phase) ? Date.now() + phoneDuration(phase) : null;
}
function phoneAdvanceIfComplete(game) {
  if (!game || game.submitted.size < game.players.length) return false;
  if (game.phase === 'prompt') {
    phoneSetPhase(game, 'draw', 1);
  } else if (game.stage >= game.maxStages) {
    phoneSetPhase(game, 'results', game.stage);
  } else {
    const nextStage = game.stage + 1;
    phoneSetPhase(game, nextStage % 2 === 1 ? 'draw' : 'caption', nextStage);
  }
  phoneBroadcastState();
  return true;
}

function phoneCancel(message) {
  const old = phoneGame;
  phoneGame = null;
  if (!old) return;
  for (const p of old.players) {
    if (mainRoom.players.has(p.id)) {
      mainRoom.send(p.id, { t: 'phone-state', state: null, notice: message || 'ゲームが終了しました' });
    }
  }
  // 画面を開いていた非参加者にも終了状態を通知
  for (const id of mainRoom.players.keys()) {
    if (!old.players.some((p) => p.id === id)) {
      mainRoom.send(id, { t: 'phone-state', state: null, notice: message || 'ゲームが終了しました' });
    }
  }
}

function phoneHandleDisconnect(playerId) {
  if (!phoneGame) return;
  const i = phoneMemberIndex(phoneGame, playerId);
  if (i < 0) return;
  if (phoneGame.phase !== 'lobby' && phoneGame.phase !== 'results') {
    phoneCancel('参加者が退出したため、テレフォンゲームを中止しました。もう一度ロビーを作成できます。');
    return;
  }
  phoneGame.players.splice(i, 1);
  if (!phoneGame.players.length) {
    phoneGame = null;
    return;
  }
  if (phoneGame.ownerId === playerId) {
    phoneGame.ownerId = phoneGame.players[0].id;
    phoneGame.ownerName = phoneGame.players[0].name;
  }
  phoneBroadcastState();
}

function phoneHandleMessage(playerId, m) {
  const me = mainRoom.players.get(playerId);
  if (!me) return;
  if (!rateOk(rateChat, playerId + ':phone', 10, 1000)) {
    phoneError(playerId, '操作が早すぎます。少し待ってから試してください');
    return;
  }

  if (m.t === 'phone-state') {
    phoneSendState(playerId);
    return;
  }

  if (m.t === 'phone-join') {
    if (!phoneGame) {
      phoneGame = {
        id: crypto.randomBytes(8).toString('hex'),
        phase: 'lobby',
        ownerId: playerId,
        ownerName: me.name,
        players: [{ id: playerId, name: me.name }],
        books: [],
        stage: 0,
        maxStages: 0,
        deadline: null,
        horrorMode: false,
        submitted: new Set(),
      };
      phoneBroadcastState();
      return;
    }
    if (phoneGame.phase !== 'lobby') {
      phoneSendState(playerId);
      if (phoneMemberIndex(phoneGame, playerId) < 0) phoneError(playerId, 'ゲーム進行中は参加できません。結果発表後に参加してください');
      return;
    }
    if (phoneMemberIndex(phoneGame, playerId) >= 0) {
      phoneSendState(playerId);
      return;
    }
    if (phoneGame.players.length >= PHONE_MAX_PLAYERS) {
      phoneError(playerId, `参加できるのは最大${PHONE_MAX_PLAYERS}人です`);
      phoneSendState(playerId);
      return;
    }
    phoneGame.players.push({ id: playerId, name: me.name });
    phoneBroadcastState();
    return;
  }

  if (m.t === 'phone-leave') {
    if (!phoneGame || phoneMemberIndex(phoneGame, playerId) < 0) {
      phoneSendState(playerId);
      return;
    }
    if (phoneGame.phase !== 'lobby' && phoneGame.phase !== 'results') {
      phoneCancel('参加者が退出したため、テレフォンゲームを中止しました。もう一度ロビーを作成できます。');
      return;
    }
    phoneHandleDisconnect(playerId);
    phoneSendState(playerId);
    return;
  }

  if (m.t === 'phone-horror-toggle') {
    if (!phoneGame || phoneGame.phase !== 'lobby') { phoneError(playerId, '怪談モードを変更できるのは開始前だけです'); return; }
    if (phoneGame.ownerId !== playerId) { phoneError(playerId, '怪談モードを変更できるのはロビー主催者だけです'); return; }
    phoneGame.horrorMode = m.enabled === true;
    phoneBroadcastState();
    return;
  }

  if (m.t === 'phone-start') {
    if (!phoneGame || phoneGame.phase !== 'lobby') { phoneError(playerId, '開始できるロビーがありません'); return; }
    if (phoneGame.ownerId !== playerId) { phoneError(playerId, '開始できるのはロビー主催者だけです'); return; }
    phoneGame.players = phoneGame.players.filter((p) => mainRoom.players.has(p.id));
    if (phoneGame.players.length < 2) { phoneError(playerId, '開始には2人以上の参加が必要です'); phoneBroadcastState(); return; }
    phoneGame.books = phoneGame.players.map((p, i) => ({
      id: `book-${i}`,
      authorId: p.id,
      authorName: p.name,
      entries: [],
    }));
    phoneGame.maxStages = Math.max(2, phoneGame.players.length - 1);
    phoneSetPhase(phoneGame, 'prompt', 0);
    phoneBroadcastState();
    return;
  }

  if (m.t === 'phone-again') {
    if (!phoneGame || phoneGame.phase !== 'results') { phoneError(playerId, '再開できる結果がありません'); return; }
    if (phoneGame.ownerId !== playerId) { phoneError(playerId, '次のゲームを始められるのは主催者だけです'); return; }
    phoneGame.players = phoneGame.players.filter((p) => mainRoom.players.has(p.id));
    phoneGame.id = crypto.randomBytes(8).toString('hex');
    phoneGame.phase = 'lobby';
    phoneGame.books = [];
    phoneGame.stage = 0;
    phoneGame.maxStages = 0;
    phoneGame.deadline = null;
    phoneGame.submitted = new Set();
    phoneBroadcastState();
    return;
  }

  if (m.t !== 'phone-submit') return;
  const g = phoneGame;
  if (!g || phoneMemberIndex(g, playerId) < 0) { phoneError(playerId, 'ゲームに参加していません'); return; }
  if (!['prompt', 'draw', 'caption'].includes(g.phase) || m.phase !== g.phase) { phoneError(playerId, '現在の段階では提出できません'); return; }
  if (g.submitted.has(playerId)) { phoneError(playerId, 'すでに提出済みです。次の段階を待ってください'); return; }

  let value = '';
  if (g.phase === 'draw') {
    value = typeof m.value === 'string' ? m.value : '';
    // Canvas からの PNG data URL のみ受け付け、巨大データや任意URLを拒否。
    if (value.length > 150000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) {
      phoneError(playerId, '絵のデータが大きすぎるか、形式が正しくありません。描き直して再提出してください');
      return;
    }
    const encoded = value.slice('data:image/png;base64,'.length);
    const png = Buffer.from(encoded, 'base64');
    const validPng = png.length >= 24
      && png.toString('hex', 0, 8) === '89504e470d0a1a0a'
      && png.readUInt32BE(16) === 480
      && png.readUInt32BE(20) === 300
      && png.toString('base64') === encoded;
    if (!validPng) {
      phoneError(playerId, '絵の画像が破損しているか、サイズが正しくありません。キャンバスから再提出してください');
      return;
    }
  } else {
    value = String(m.value || '').trim().slice(0, 120);
    if (!value) { phoneError(playerId, g.phase === 'prompt' ? '最初のお題を入力してください' : '絵の説明を入力してください'); return; }
  }

  const bi = phoneBookIndex(g, playerId);
  const book = bi >= 0 ? g.books[bi] : null;
  if (!book) { phoneError(playerId, '担当するページを確認できませんでした'); return; }
  book.entries.push({ type: g.phase, authorId: playerId, authorName: me.name, value });
  g.submitted.add(playerId);

  if (!phoneAdvanceIfComplete(g)) phoneBroadcastState();
}

// 無操作で止まらないよう、時間切れの未提出分をサーバー側で補完する。
setInterval(() => {
  const g = phoneGame;
  if (!g || !['prompt', 'draw', 'caption'].includes(g.phase) || !g.deadline || Date.now() < g.deadline) return;
  for (const p of g.players) {
    if (g.submitted.has(p.id)) continue;
    const bi = phoneBookIndex(g, p.id);
    const book = bi >= 0 ? g.books[bi] : null;
    if (!book) continue;
    const value = g.phase === 'draw' ? PHONE_BLANK_DRAW : '（時間切れ）';
    book.entries.push({ type: g.phase, authorId: p.id, authorName: p.name, value, timedOut: true });
    g.submitted.add(p.id);
  }
  if (!phoneAdvanceIfComplete(g)) phoneBroadcastState();
}, 1000).unref();


// ===== HTTP + WS（同一ポートで index.html も配信） =====
const path = require('path');
const fs = require('fs');
const ROOT = __dirname;

/* ---- 定期スナップショット（障害時の復旧用） ---- */
// Render の永続ディスクなど、環境変数でスナップショット保存先を変更可能。未指定時は従来どおり ./snapshots。
const SNAP_DIR = process.env.SNAPSHOT_DIR ? path.resolve(process.env.SNAPSHOT_DIR) : path.join(ROOT, 'snapshots');
const SNAP_INTERVAL_MS = Number(process.env.SNAP_INTERVAL_MS) || 5 * 60 * 1000;
const SNAP_KEEP = Number(process.env.SNAP_KEEP) || 12;
function ensureSnapDir() {
  try { fs.mkdirSync(SNAP_DIR, { recursive: true }); } catch (e) {}
}
function pruneSnaps() {
  try {
    const files = fs.readdirSync(SNAP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(SNAP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files.slice(SNAP_KEEP)) {
      try { fs.unlinkSync(path.join(SNAP_DIR, x.f)); } catch (e) {}
    }
  } catch (e) {}
}
function saveWorldSnap(reason) {
  try {
    ensureSnapDir();
    const snap = mainRoom.snapshot();
    const payload = {
      savedAt: new Date().toISOString(),
      reason: reason || 'auto',
      ver: VER,
      topic: mainRoom.topic,
      topicEnabled: mainRoom.topicEnabled,
      topicAt: mainRoom.topicAt,
      worldTheme: mainRoom.worldTheme || 'nature',
      naturalCaveVersion: Number.isInteger(mainRoom.naturalCaveVersion) ? mainRoom.naturalCaveVersion : 0,
      drawingWallMaterialVersion: mainRoom.drawingWallMaterialVersion || 0,
      phoneStation: mainRoom.phoneStation || null,
      players: mainRoom.players.size,
      rle: snap.rle,
      keys: snap.keys,
      data: snap.data,
      authors: snap.authors || [],
    };
    // 完成前のJSONがバックアップとして選ばれないよう、一時ファイルから置き換える。
    const name = 'world_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    const file = path.join(SNAP_DIR, name);
    const tempFile = file + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(payload));
    fs.renameSync(tempFile, file);
    pruneSnaps();
    console.log(`[snap] ${name} (${reason || 'auto'}) players=${mainRoom.players.size}`);
  } catch (e) {
    console.error('[snap] failed', e && e.message ? e.message : e);
  }
}

/** バックアップを読み込む前に、ワールドサイズ・面キー・描画データを検証する。 */
function isValidWorldSnap(payload) {
  if (!payload || !Array.isArray(payload.rle) || payload.rle.length < 2 || payload.rle.length % 2 !== 0) return false;
  const worldSize = W * H * D;
  let filled = 0;
  for (let i = 0; i < payload.rle.length; i += 2) {
    const block = payload.rle[i];
    const count = payload.rle[i + 1];
    if (!Number.isInteger(block) || block < 0 || block > 255) return false;
    if (!Number.isInteger(count) || count < 1 || count > 65535) return false;
    filled += count;
    if (filled > worldSize) return false;
  }
  if (filled !== worldSize) return false;
  if (!Array.isArray(payload.keys) || typeof payload.data !== 'string') return false;
  if (payload.keys.length > worldSize * 6) return false;
  if (!/^(?:[A-Za-z0-9+/]*={0,2})$/.test(payload.data)) return false;

  const seen = new Set();
  for (const key of payload.keys) {
    if (typeof key !== 'string' || key.length > 32 || seen.has(key)) return false;
    const match = /^([0-9]+),([0-9]+),([0-9]+),([0-5])$/.exec(key);
    if (!match) return false;
    const x = Number(match[1]), y = Number(match[2]), z = Number(match[3]);
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return false;
    seen.add(key);
  }
  const drawingData = Buffer.from(payload.data, 'base64');
  if (drawingData.byteLength !== payload.keys.length * PX * 2) return false;
  if (drawingData.toString('base64') !== payload.data) return false;
  return true;
}

/** 旧版のバックアップにテーマ情報がない場合、生成地形との一致率から推定する。 */
function inferLegacyWorldTheme(world) {
  const scores = ['nature', 'paper', 'toy'].map((theme) => {
    const base = genTerrain(theme);
    let matches = 0;
    for (let i = 0; i < world.length; i++) if (world[i] === base[i]) matches++;
    return { theme, matches };
  }).sort((a, b) => b.matches - a.matches);
  const best = scores[0], next = scores[1];
  // 大幅に改造されたワールドを誤判定しないよう、一定の一致率と差がある場合だけ採用。
  if (best.matches / world.length < 0.5 || best.matches - next.matches < world.length * 0.01) return null;
  return best.theme;
}

/** 最新の正常なスナップショットを復元。破損ファイルは飛ばして、古い正常版を探す。 */
function loadLatestWorldSnap() {
  let files;
  try {
    files = fs.readdirSync(SNAP_DIR)
      .filter((f) => /^world_.*\.json$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(SNAP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch (e) {
    console.log('[snap] 保存済みワールドなし。新しいワールドで開始します');
    return false;
  }

  for (const entry of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, entry.f), 'utf8'));
      if (!isValidWorldSnap(payload)) {
        console.warn(`[snap] invalid snapshot skipped: ${entry.f}`);
        continue;
      }
      mainRoom.applySnapshot(payload);
      const savedTheme = ['nature', 'paper', 'toy'].includes(payload.worldTheme) ? payload.worldTheme : null;
      const inferredTheme = savedTheme || inferLegacyWorldTheme(mainRoom.world);
      mainRoom.worldTheme = inferredTheme || 'nature';
      let caveMigrationChanged = false;
      if ((mainRoom.naturalCaveVersion || 0) < NATURAL_CAVE_VERSION) {
        if (mainRoom.worldTheme === 'nature') {
          const caveBaseline = genTerrainNature(false);
          caveMigrationChanged = applyNaturalCaveSafely(mainRoom.world, caveBaseline, mainRoom.naturalCaveVersion || 0);
          if (caveMigrationChanged) console.log('[cave] 既存の自然ワールドへ洞窟を追加しました');
          else console.warn('[cave] 洞窟予定地に既存の変更があるため、建築を保護して洞窟追加を見送りました');
        }
        mainRoom.naturalCaveVersion = NATURAL_CAVE_VERSION;
      }
      if ((mainRoom.drawingWallMaterialVersion || 0) < START_DRAWING_WALL_MATERIAL_VERSION) {
        const wallChanges = mainRoom.worldTheme === 'nature' ? migrateStarterDrawingWalls(mainRoom.world) : 0;
        mainRoom.drawingWallMaterialVersion = START_DRAWING_WALL_MATERIAL_VERSION;
        if (wallChanges) console.log(`[world] migrated ${wallChanges} starter drawing-wall blocks to white`);
      }
      const savedStation = normalizePhoneStation(payload.phoneStation);
      if (savedStation && savedStation.version === PHONE_STATION_VERSION) {
        // Current terminal coordinates are retained even if its visible blocks were deliberately customized.
        mainRoom.phoneStation = savedStation;
      } else {
        // Migrate the known old 5x5 slab, if present, and put the compact terminal away from respawn.
        if (savedStation) removeKnownPhoneStation(mainRoom.world, savedStation);
        mainRoom.phoneStation = placePhoneStation(mainRoom.world, mainRoom.worldTheme);
        if (!mainRoom.phoneStation) console.warn('[phone] no clear central spot available for terminal');
      }
      if (!savedTheme && !inferredTheme) {
        console.warn('[snap] 旧バックアップのテーマを特定できないため nature として扱います');
      }
      mainRoom.topic = typeof payload.topic === 'string' ? payload.topic.slice(0, 40) : '';
      mainRoom.topicEnabled = payload.topicEnabled === true;
      mainRoom.topicAt = Number.isFinite(payload.topicAt) ? payload.topicAt : Date.now();
      mainRoom.touch();
      console.log(`[snap] restored ${entry.f} savedAt=${payload.savedAt || 'unknown'} theme=${mainRoom.worldTheme}`);
      if (!Number.isInteger(payload.naturalCaveVersion) || payload.naturalCaveVersion < NATURAL_CAVE_VERSION) {
        saveWorldSnap(caveMigrationChanged ? 'natural cave migration' : 'natural cave migration checked');
      }
      return true;
    } catch (e) {
      console.warn(`[snap] read failed, skipped: ${entry.f} (${e && e.message ? e.message : e})`);
    }
  }
  console.log('[snap] 使用可能なバックアップなし。新しいワールドで開始します');
  return false;
}

// listen 前に復元し、最初に参加した人へ保存済みワールドを送る。
loadLatestWorldSnap();
// 保存ワールドを復元した後に再判定し、洞窟のない独自ワールドへ敵が残らないようにする。
mainRoom.resetSporeShooter();
mainRoom.resetCreatures();
mainRoom.resetMischiefCreature();
mainRoom.resetForestResident();
mainRoom.resetWiseCharacter();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: mainRoom.players.size, ver: VER }));
    return;
  }
  // 静的ファイル（index.html など）
  let rel = url === '/' ? '/index.html' : url;
  if (rel.includes('..')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found\nらくがきブロック: index.html を同じフォルダに置いてください\n');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache', 'Expires': '0' });
    res.end(data);
  });
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MSG_BYTES,
  verifyClient(info, cb) {
    if (!isAllowedOrigin(info.req)) {
      console.log('[ws] origin rejected:', (info.req.headers && info.req.headers.origin) || '(none)');
      if (typeof cb === 'function') return cb(false, 403, 'Forbidden origin');
      return false;
    }
    if (typeof cb === 'function') return cb(true);
    return true;
  },
});

wss.on('connection', (ws, req) => {
  let playerId = null;
  let room = null;
  const ip = clientIp(req);
  ws._ip = ip;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // 接続時にBANチェック
  if (isBanned(ip)) {
    ws.close(4001, 'banned');
    return;
  }

  const send = (m) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  };

  ws.on('message', (raw) => {
    if (shuttingDown) return;
    // メッセージサイズ制限
    if (raw.length > MAX_MSG_BYTES) {
      console.log(`[drop] oversized from ${ip} (${raw.length} bytes)`);
      return;
    }
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    // 生存確認用
    if (playerId && room) {
      const pp = room.players.get(playerId);
      if (pp) pp.lastSeen = Date.now();
    }

    // ---- 未参加時 ----
    if (!playerId) {
      if (m.t === 'join') {
        if (isBanned(ip)) {
          send({ t: 'err', type: 'banned', msg: '接続が切れました' });
          ws.close(4001, 'banned');
          return;
        }
        // 任意の入場パスワード
        if (JOIN_PASSWORD) {
          const jp = String(m.joinPw || '');
          if (jp !== JOIN_PASSWORD) {
            send({ t: 'err', type: 'join-pw', msg: '入場パスワードが違います' });
            return;
          }
        }
        const name = String(m.name || '').trim().slice(0, 12);
        if (!name) {
          send({ t: 'err', type: 'name', msg: 'なまえを入力してください' });
          return;
        }
        const col = typeof m.col === 'number' ? m.col : 0x888888;
        const sk = m.sk || null;

        room = mainRoom;
        if (room.players.size >= MAX_PLAYERS) {
          send({ t: 'err', type: 'full', msg: 'サーバーが満員です' });
          return;
        }

        playerId = uid();
        room.players.set(playerId, {
          ws,
          name,
          col,
          sk,
          admin: false,
          pos: [32.5, 10, 24.5],
          yaw: 0,
          ip,
          lastSeen: Date.now(),
        });
        room.touch();
        if (horrorSystemEnabled) { horrorOptIns.add(playerId); scheduleHorrorEvent(); }
        if (naturalDisastersEnabled) scheduleNaturalDisaster();
        if (kesaranEventsEnabled) scheduleKesaranEvent();

        send({
          t: 'init',
          ver: VER,
          id: playerId,
          room: 'main',
          perm: room.perm,
          topic: room.topicEnabled ? room.topic : '',
          topicEnabled: room.topicEnabled,
          worldTheme: room.worldTheme || 'nature',
          phoneStation: room.phoneStation || null,
          topicAt: room.topicAt,
          topicInterval: TOPIC_INTERVAL_MS,
          ...room.snapshot(),
          players: room.playersList(),
          creatures: room.creaturesList(),
          mischiefCreature: room.mischiefCreatureState(),
          forestResident: room.forestResidentState(),
          wiseCharacter: room.wiseCharacterState(),
          sporeState: room.sporeShooterState(),
          horrorEnabled: horrorSystemEnabled,
          disastersEnabled: naturalDisastersEnabled,
          activeDisaster: getActiveNaturalDisaster(),
          kesaranEventsEnabled,
          activeKesaranEvent: getActiveKesaranEvent(),
        });

        room.broadcast(
          { t: 'hello', id: playerId, name, col, sk },
          playerId
        );
        console.log(`[join] ${name} (${playerId.slice(0, 6)}) ip=${ip} 人数=${room.players.size}`);
        return;
      }
      return;
    }

    if (!room || !room.players.has(playerId)) return;
    room.touch();
    const me = room.players.get(playerId);

    if (m.t.startsWith('phone-')) {
      phoneHandleMessage(playerId, m);
      return;
    }

    if (m.t === 'horror-opt') {
      // 旧クライアント向けの個別参加メッセージは受け付けない。
      return;
    }
    if (m.t === 'horror-admin-toggle') {
      if (!me.admin || !rateOk(rateChat, playerId + ':horror-admin-toggle', 3, 5000)) return;
      setGlobalHorrorEnabled(m.enabled === true);
      return;
    }
    if (m.t === 'disaster-admin-toggle') {
      if (!me.admin || !rateOk(rateChat, playerId + ':disaster-admin-toggle', 3, 5000)) return;
      setNaturalDisastersEnabled(m.enabled === true);
      return;
    }
    if (m.t === 'kesaran-admin-toggle') {
      if (!me.admin || !rateOk(rateChat, playerId + ':kesaran-admin-toggle', 3, 5000)) return;
      setKesaranEventsEnabled(m.enabled === true);
      return;
    }

    if (m.t === 'horror-phone-answer') {
      handleHorrorPhoneAnswer(playerId, room, me, m);
      return;
    }

    switch (m.t) {
      case 'wise-talk': {
        const c = room.wiseCharacter, now = Date.now();
        if (!c || !Array.isArray(me.pos) || me.pos.length < 3 || !me.pos.every(Number.isFinite)) {
          send({ t: 'wise-talk-result', ok: false, reason: 'unavailable' }); break;
        }
        const distance = Math.hypot(me.pos[0] - c.x, me.pos[2] - c.z);
        if (distance > 4.5) { send({ t: 'wise-talk-result', ok: false, reason: 'far' }); break; }
        if (!rateOk(rateChat, playerId + ':wise-talk', 2, 2500)) break;
        if (now < c.speechUntil) { send({ t: 'wise-talk-result', ok: false, reason: 'busy' }); break; }
        if (startWiseCharacterSpeech(room, playerId, me, false, now)) {
          room.broadcast({ t: 'critters', creatures: room.creaturesList(), mischiefCreature: room.mischiefCreatureState(), forestResident: room.forestResidentState(), wiseCharacter: room.wiseCharacterState() });
          send({ t: 'wise-talk-result', ok: true });
        }
        break;
      }
      case 'forest-talk': {
        const c = room.forestResident;
        const now = Date.now();
        if (!c || !Array.isArray(me.pos) || me.pos.length < 3 || !me.pos.every(Number.isFinite)) {
          send({ t: 'forest-talk-result', ok: false, reason: 'unavailable' });
          break;
        }
        const distance = Math.hypot(me.pos[0] - c.x, me.pos[2] - c.z);
        if (distance > 4.25) { send({ t: 'forest-talk-result', ok: false, reason: 'far' }); break; }
        if (!rateOk(rateChat, playerId + ':forest-talk', 2, 2500)) break;
        if (now < c.speechUntil) { send({ t: 'forest-talk-result', ok: false, reason: 'busy' }); break; }
        if (startForestResidentSpeech(room, playerId, me, false, now)) {
          room.broadcast({ t: 'critters', creatures: room.creaturesList(), mischiefCreature: room.mischiefCreatureState(), forestResident: room.forestResidentState(), wiseCharacter: room.wiseCharacterState() });
          send({ t: 'forest-talk-result', ok: true });
        }
        break;
      }
      case 'spore-poke': {
        if (!rateOk(rateChat, playerId + ':spore-poke', 3, 1000)) break;
        const c = room.sporeShooter, now = Date.now();
        // 武器・ブロックでの攻撃は受け付けない。実際に色付きペンを使っている要求だけを許可する。
        if (m.tool !== 'pen' || !Number.isInteger(m.color) || m.color <= 0) {
          send({ t: 'spore-poke-result', hit: false, reason: 'tool' }); break;
        }
        if (!c || c.hp <= 0 || c.mode === 'defeated' || !Array.isArray(me.pos) || me.pos.length < 3 || !me.pos.every(Number.isFinite)) {
          send({ t: 'spore-poke-result', hit: false, reason: 'unavailable' }); break;
        }
        const dx = c.x - me.pos[0], dz = c.z - me.pos[2];
        const horizontal = Math.hypot(dx, dz);
        const vertical = Math.abs((me.pos[1] + 1.0) - (c.y + 0.8));
        const targetYaw = Math.atan2(-dx, -dz);
        const aimYaw = typeof m.aimYaw === 'number' && Number.isFinite(m.aimYaw) ? m.aimYaw : (Number(me.yaw) || 0);
        const yawDiff = Math.atan2(Math.sin(targetYaw - aimYaw), Math.cos(targetYaw - aimYaw));
        const inCave = playerIsInNaturalCave(room, me);
        const clearShot = sporeLineClear(room,
          { x: me.pos[0], y: me.pos[1] + 1.48, z: me.pos[2] },
          { x: c.x, y: c.y + 0.96, z: c.z });
        const valid = horizontal <= 2.8 && vertical <= 1.8 && Math.abs(yawDiff) <= 0.72 && clearShot && inCave;
        if (!valid) {
          const reason = !inCave ? 'cave' : horizontal > 2.8 ? 'far' : !clearShot ? 'blocked' : 'aim';
          send({ t: 'spore-poke-result', hit: false, reason }); break;
        }
        // ペン突きはダメージを与えず、短いひるみだけを発生させる。連打で永久停止しないよう敵側に間隔を設ける。
        if (now - (c.lastPokeAt || 0) < 1100) {
          send({ t: 'spore-poke-result', hit: false, reason: 'recovering' }); break;
        }
        c.lastPokeAt = now;
        c.mode = 'hit'; c.modeUntil = now + 760; c.targetId = null; c.nextAttackAt = now + 1700;
        c.wanderPath = []; c.wanderIndex = 0; c.nextWanderAt = now + 1500;
        send({ t: 'spore-poke-result', hit: true, stunned: true });
        room.broadcast({ t: 'spore-poke-action', id: playerId });
        broadcastSporeState(room);
        break;
      }
      case 'pos': {
        // 約15回/秒まで
        if (!rateOk(ratePos, playerId, 20, 1000)) break;
        if (Array.isArray(m.p) && m.p.length >= 3) {
          me.pos = [+m.p[0], +m.p[1], +m.p[2]];
          me.yaw = +m.y || 0;
          const bodyYaw = Number.isFinite(m.by) ? m.by : me.yaw;
          const headYaw = Number.isFinite(m.hy) ? Math.max(-0.48, Math.min(0.48, m.hy)) : null;
          const viewPitch = Number.isFinite(m.pitch) ? Math.max(-1.5, Math.min(1.5, m.pitch)) : 0;
          room.broadcast({ t: 'pos', id: playerId, p: me.pos, y: me.yaw, by: bodyYaw, ...(headYaw === null ? {} : { hy: headYaw }), pitch: viewPitch, crouch: m.crouch === true, heldPen: m.heldPen === true }, playerId);
        }
        break;
      }
      case 'blk': {
        if (!room.perm.blk && !me.admin) break;
        // 8回/秒まで（管理者は緩和）
        if (!me.admin && !rateOk(rateBlk, playerId, 8, 1000)) break;
        const x = m.x | 0, y = m.y | 0, z = m.z | 0, b = m.b | 0;
        if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) break;
        // 0=破壊, 1..MAX_BLOCK_ID=設置（クライアントのブロック種類と一致させる）
        if (b < 0 || b > MAX_BLOCK_ID) break;
        if (!b) {
          for (let f = 0; f < 6; f++) {
            const fk = `${x},${y},${z},${f}`;
            room.paint.delete(fk);
            room.faceAuthor.delete(fk);
          }
        }
        room.world[idx(x, y, z)] = b;
        room.broadcast({ t: 'blk', x, y, z, b }, playerId);
        break;
      }
      case 'pen': {
        if (!room.perm.pen && !me.admin) break;
        if (!Array.isArray(m.s)) break;
        // バッチサイズ制限
        if (m.s.length > MAX_PEN_BATCH) m.s = m.s.slice(0, MAX_PEN_BATCH);
        // 30バッチ/秒、合計ピクセルもざっくり制限
        if (!me.admin && !rateOk(ratePen, playerId, 30, 1000)) break;
        const out = [];
        for (const item of m.s) {
          if (!Array.isArray(item) || item.length < 4) continue;
          const [k, px, py, c] = item;
          if (!validPaintKey(k)) continue;
          const x = px | 0, y = py | 0, col = c | 0;
          if (x < 0 || y < 0 || x >= TS || y >= TS) continue;
          if (col < 0 || col > 0xffff) continue;
          let arr = room.paint.get(k);
          if (!arr) {
            if (!col) continue;
            arr = new Uint16Array(PX);
            room.paint.set(k, arr);
          }
          arr[y * TS + x] = col;
          out.push([k, x, y, col]);
        }
        if (out.length) {
          const faces = new Set(out.map((it) => it[0]));
          for (const k of faces) room.faceAuthor.set(k, me.name);
          room.broadcast({ t: 'pen', id: playerId, name: me.name, s: out }, playerId);
        }
        break;
      }
      case 'chat': {
        // 2通/2秒
        if (!rateOk(rateChat, playerId, 2, 2000)) {
          send({ t: 'err', type: 'rate', msg: 'チャットが早すぎます' });
          break;
        }
        const text = String(m.text || '').slice(0, 60);
        if (!text) break;
        room.broadcast({ t: 'chat', id: playerId, name: me.name, text });
        break;
      }
      case 'emo': {
        if (!rateOk(rateChat, playerId + ':emo', 4, 2000)) break;
        room.broadcast({ t: 'emo', id: playerId, k: m.k | 0 }, playerId);
        break;
      }
      case 'skin': {
        if (!rateOk(rateChat, playerId + ':skin', 2, 5000)) break;
        me.sk = m.sk || null;
        room.broadcast({ t: 'skin', id: playerId, sk: me.sk }, playerId);
        break;
      }
      case 'col': {
        if (!rateOk(rateChat, playerId + ':col', 2, 2000)) break;
        const c = typeof m.col === 'number' ? (m.col >>> 0) & 0xffffff : null;
        if (c == null) break;
        me.col = c;
        room.broadcast({ t: 'col', id: playerId, col: c }, playerId);
        break;
      }
      case 'auth': {
        if (authLocked(ip)) {
          send({ t: 'auth', ok: false, msg: '試行回数超過。しばらく待ってください' });
          break;
        }
        if (!rateOk(rateAuth, ip, 5, 60000)) {
          send({ t: 'auth', ok: false, msg: '試行が多すぎます' });
          break;
        }
        if (!ADMIN_PASSWORD) {
          send({ t: 'auth', ok: false, msg: '管理者機能は無効です（.env で ADMIN_PASSWORD を設定）' });
          break;
        }
        const pw = String(m.pw || '');
        if (passwordMatches(pw)) {
          me.admin = true;
          clearAuthFail(ip);
          send({ t: 'auth', ok: true, msg: '管理者になりました' });
          console.log(`[admin] ${me.name} ip=${ip}`);
        } else {
          const locked = noteAuthFail(ip);
          send({
            t: 'auth',
            ok: false,
            msg: locked ? '試行回数超過。しばらく待ってください' : '合言葉が違います',
          });
        }
        break;
      }
      case 'perm': {
        if (!me.admin) break;
        if (typeof m.blk === 'boolean') room.perm.blk = m.blk;
        if (typeof m.pen === 'boolean') room.perm.pen = m.pen;
        room.broadcast({ t: 'perm', blk: room.perm.blk, pen: room.perm.pen });
        break;
      }
      case 'clear': {
        if (!me.admin) break;
        if (m.what === 'world') {
          const th = (m.theme === 'paper' || m.theme === 'toy' || m.theme === 'nature') ? m.theme : (room.worldTheme || 'nature');
          room.worldTheme = th;
          room.world = genTerrain(th);
          room.naturalCaveVersion = NATURAL_CAVE_VERSION;
          room.drawingWallMaterialVersion = START_DRAWING_WALL_MATERIAL_VERSION;
          room.phoneStation = placePhoneStation(room.world, th);
          room.paint.clear();
          room.faceAuthor.clear();
          room.resetCreatures();
          room.resetMischiefCreature();
          room.resetForestResident();
          room.resetWiseCharacter();
          room.resetSporeShooter();
          console.log(`[world] regenerate theme=${th} by ${me.name}`);
        } else {
          room.paint.clear();
          room.faceAuthor.clear();
        }
        room.broadcast({ t: 'clear', what: m.what || 'paint', theme: room.worldTheme || 'nature', phoneStation: room.phoneStation || null, creatures: room.creaturesList(), mischiefCreature: room.mischiefCreatureState(), forestResident: room.forestResidentState(), wiseCharacter: room.wiseCharacterState(), sporeState: room.sporeShooterState() });
        break;
      }
      case 'world': {
        if (!me.admin) break;
        if (!rateOk(rateWorld, playerId, 1, 3000)) {
          send({ t: 'err', type: 'world', msg: '世界の読み込みは少し時間を空けてから行ってください' });
          break;
        }
        try {
          if (typeof m.data !== 'string' || m.data.length > MAX_WORLD_UPLOAD_DATA_CHARS)
            throw new Error('落書きデータの容量が2 MiBの上限を超えています');
          // applySnapshot はデータ全体の検証を完了してからライブ状態を変更する。
          room.applySnapshot({ rle: m.rle, keys: m.keys, data: m.data, drawingWallMaterialVersion: m.drawingWallMaterialVersion });
          room.naturalCaveVersion = NATURAL_CAVE_VERSION; // ユーザーが読み込んだワールドを勝手に掘らない
          if ((room.drawingWallMaterialVersion || 0) < START_DRAWING_WALL_MATERIAL_VERSION) {
            if ((room.worldTheme || 'nature') === 'nature') migrateStarterDrawingWalls(room.world);
            room.drawingWallMaterialVersion = START_DRAWING_WALL_MATERIAL_VERSION;
          }
          const requestedStation = normalizePhoneStation(m.phoneStation);
          if (requestedStation && requestedStation.version === PHONE_STATION_VERSION) room.phoneStation = requestedStation;
          else {
            if (requestedStation) removeKnownPhoneStation(room.world, requestedStation);
            room.phoneStation = placePhoneStation(room.world, room.worldTheme);
          }
          // Recreate ambient critters on valid ground after a world import; they are not saved into the world file.
          room.resetCreatures();
          room.resetMischiefCreature();
          room.resetForestResident();
          room.resetWiseCharacter();
          room.resetSporeShooter();
          // 正規化されたサーバー側スナップショットを、読み込み元を含む全員へ配信する。
          // クライアントはこの通知を受け取るまで現在のワールドを変更しない。
          const saved = room.snapshot();
          room.broadcast({ t: 'world', ...saved, phoneStation: room.phoneStation || null, creatures: room.creaturesList(), mischiefCreature: room.mischiefCreatureState(), forestResident: room.forestResidentState(), wiseCharacter: room.wiseCharacterState(), sporeState: room.sporeShooterState() });
          console.log(`[world] snapshot loaded by ${me.name}: ${saved.keys.length} painted faces`);
        } catch (e) {
          console.warn(`[world] snapshot rejected from ${me.name}: ${e.message}`);
          send({ t: 'err', type: 'world', msg: `世界を読み込めませんでした：${e.message || 'データが不正です'}` });
        }
        break;
      }
      case 'topic': {
        // 管理者のみ。enable でON/OFF、text で指定、それ以外は次のお題
        if (!me.admin) break;
        if (typeof m.enable === 'boolean') {
          room.topicEnabled = m.enable;
          if (room.topicEnabled) {
            room.topic = pickTopic(room.topic);
            room.topicAt = Date.now();
          }
          room.broadcast({
            t: 'topic',
            topic: room.topicEnabled ? room.topic : '',
            by: me.name,
            topicEnabled: room.topicEnabled,
            topicAt: room.topicAt,
            topicInterval: TOPIC_INTERVAL_MS,
          });
          console.log(`[topic] enabled=${room.topicEnabled} by ${me.name}`);
          break;
        }
        if (!room.topicEnabled) break;
        if (typeof m.text === 'string' && m.text.trim()) {
          room.topic = String(m.text).trim().slice(0, 40);
        } else {
          room.topic = pickTopic(room.topic);
        }
        room.topicAt = Date.now();
        room.broadcast({
          t: 'topic',
          topic: room.topic,
          by: me.name,
          topicEnabled: true,
          topicAt: room.topicAt,
          topicInterval: TOPIC_INTERVAL_MS,
        });
        console.log(`[topic] ${room.topic} by ${me.name}`);
        break;
      }
      case 'kick': {
        if (!me.admin) break;
        const target = room.players.get(m.id);
        if (target && m.id !== playerId) {
          const tip = target.ip || (target.ws && target.ws._ip);
          if (tip) banIp(tip, KICK_BAN_MS, 'kick by ' + me.name);
          target.ws.close(4000, 'kicked');
        }
        break;
      }
      case 'ban': {
        // 管理者が明示BAN（分指定、最大24h）
        if (!me.admin) break;
        const target = room.players.get(m.id);
        if (target && m.id !== playerId) {
          const mins = Math.min(24 * 60, Math.max(1, m.mins | 0 || 15));
          const tip = target.ip || (target.ws && target.ws._ip);
          if (tip) banIp(tip, mins * 60 * 1000, 'ban by ' + me.name);
          target.ws.close(4001, 'banned');
        }
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (playerId) removeHorrorParticipant(playerId);
    if (playerId && room) {
      const p = room.players.get(playerId);
      if (p) {
        room.players.delete(playerId);
        phoneHandleDisconnect(playerId);
        room.broadcast({ t: 'bye', id: playerId });
        console.log(`[leave] ${p.name} 人数=${room.players.size}`);
        room.touch();
        if (room.players.size === 0 && !shuttingDown) saveWorldSnap('last-player-left');
      }
    }
  });

  ws.on('error', () => {});
});

/* WebSocket 生存確認（Quick Tunnel 等で close が届かない対策） */
const WS_ALIVE_MS = Number(process.env.WS_ALIVE_MS) || 25000;
const PLAYER_STALE_MS = Number(process.env.PLAYER_STALE_MS) || 90000;
setInterval(() => {
  // プロトコルレベルの ping
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch (e) {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
  // メッセージが長時間無いプレイヤーを除去（トンネルの半開き接続）
  if (!mainRoom) return;
  const now = Date.now();
  for (const [id, p] of [...mainRoom.players]) {
    const last = p.lastSeen || 0;
    if (now - last < PLAYER_STALE_MS) continue;
    console.log(`[stale] ${p.name} (${id.slice(0, 6)}) 無通信 ${Math.round((now - last) / 1000)}s`);
    try { if (p.ws) p.ws.terminate(); } catch (e) {}
    // terminate で close が来ない場合の保険
    if (mainRoom.players.has(id)) {
      mainRoom.players.delete(id);
      phoneHandleDisconnect(id);
      mainRoom.broadcast({ t: 'bye', id });
      mainRoom.touch();
      if (mainRoom.players.size === 0 && !shuttingDown) saveWorldSnap('last-player-left');
    }
  }
}, WS_ALIVE_MS);

// Ambient creatures think at 4 Hz and broadcast a tiny state packet at 2 Hz.
// When nobody is connected, the simulation sleeps so it adds no idle CPU load.
let lastCreatureBroadcast = 0;
let lastCreatureTick = Date.now();
setInterval(() => {
  if (!mainRoom || mainRoom.players.size === 0 || (!mainRoom.creatures.length && !mainRoom.mischiefCreature && !mainRoom.forestResident && !mainRoom.wiseCharacter)) return;
  const now = Date.now();
  const dt = Math.max(0.01, Math.min(0.3, (now - lastCreatureTick) / 1000));
  lastCreatureTick = now;
  tickAmbientCreatures(mainRoom, dt, now);
  tickMischiefCreature(mainRoom, dt, now);
  tickForestResident(mainRoom, now);
  tickWiseCharacter(mainRoom, dt, now);
  if (now - lastCreatureBroadcast >= 500) {
    lastCreatureBroadcast = now;
    mainRoom.broadcast({ t: 'critters', creatures: mainRoom.creaturesList(), mischiefCreature: mainRoom.mischiefCreatureState(), forestResident: mainRoom.forestResidentState(), wiseCharacter: mainRoom.wiseCharacterState() });
  }
}, 250);

// 胞子吐きは洞窟にプレイヤーがいる間だけシミュレーションし、弾の同期は約8 Hzに抑える。
let lastSporeTick = Date.now(), lastSporeBroadcast = 0;
setInterval(() => {
  if (!mainRoom || mainRoom.players.size === 0 || !mainRoom.sporeShooter) return;
  const now = Date.now();
  const dt = Math.max(0.01, Math.min(0.12, (now - lastSporeTick) / 1000));
  lastSporeTick = now;
  tickSporeShooter(mainRoom, dt, now);
  if (now - lastSporeBroadcast >= 125) {
    lastSporeBroadcast = now;
    broadcastSporeState(mainRoom);
  }
}, 100);

setInterval(() => {
  if (!mainRoom || mainRoom.players.size === 0) return;
  if (!mainRoom.topicEnabled) return;
  if (Date.now() - (mainRoom.topicAt || 0) < TOPIC_INTERVAL_MS) return;
  mainRoom.topic = pickTopic(mainRoom.topic);
  mainRoom.topicAt = Date.now();
  mainRoom.broadcast({
    t: 'topic',
    topic: mainRoom.topic,
    by: null,
    topicEnabled: true,
    topicAt: mainRoom.topicAt,
    topicInterval: TOPIC_INTERVAL_MS,
  });
  console.log(`[topic:auto] ${mainRoom.topic}`);
}, 30000);

// 定期スナップショット（誰かいるときだけ）
setInterval(() => {
  if (!mainRoom || mainRoom.players.size === 0) return;
  saveWorldSnap('auto');
}, SNAP_INTERVAL_MS);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}: ワールドを保存して終了します`);
  saveWorldSnap('shutdown');
  for (const ws of wss.clients) {
    try { ws.close(1001, 'server shutting down'); } catch (e) {}
  }
  server.close(() => process.exit(0));
  // クライアントが切断処理に応答しない場合でも、保存後に終了できるようにする。
  const forceExit = setTimeout(() => process.exit(0), 2000);
  forceExit.unref();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, () => {
  ensureSnapDir();
  console.log(`らくがきブロック サーバー 起動 :${PORT}`);
  console.log(`スナップショット: ${SNAP_DIR} 毎${Math.round(SNAP_INTERVAL_MS / 60000)}分・直近${SNAP_KEEP}件`);
  console.log(`管理者: ${ADMIN_PASSWORD ? '有効（.env / 環境変数）' : '無効（ADMIN_PASSWORD 未設定）'}`);
  if (JOIN_PASSWORD) console.log('入場パスワード: 設定済み');
  console.log(`TRUST_PROXY=${TRUST_PROXY_HOPS || 0}  MAX_BLOCK_ID=${MAX_BLOCK_ID}  Origin制限=${ALLOW_ANY_ORIGIN ? 'オフ' : 'オン'}`);
  console.log('荒らし対策: レート制限 / キック後BAN / 合言葉ロック');
  console.log('設定: .env.example を .env にコピーして編集');
});
