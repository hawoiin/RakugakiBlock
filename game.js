/* フェーズ2: WebSocketサーバー方式。PeerJSは不要 */
(()=>{
const $=id=>document.getElementById(id);
const W=64,H=32,D=64,AT=1024,TS=32,PER=AT/TS,PAINT_PAGE_COUNT=4,PAINT_SLOTS_PER_PAGE=PER*PER,MAX_PAINT_SLOTS=PAINT_PAGE_COUNT*PAINT_SLOTS_PER_PAGE,VER=15,WORLD_FORMAT_VER=7;
const WORLD_CELLS=W*H*D,MAX_WORLD_KEYS=4096,MAX_WORLD_DATA_CHARS=2*1024*1024,MAX_WORLD_MESSAGE_BYTES=4*1024*1024;
let BN=['草','土','石','木','白','レンガ','砂','水','葉','ガラス','黒','金','氷','スライム'],BH=[0x6aa84f,0x866043,0x828286,0xa07846,0xf0f0ec,0xb2483c,0xe2d096,0x3a8fd0,0x3d8b40,0xa8d4e8,0x2c2c2c,0xd4a017,0x9fd9ef,0x8bcf4a];
const PAL=['#e53935','#fb8c00','#fdd835','#7cb342','#2e7d32','#00acc1','#1e88e5','#3949ab','#8e24aa','#d81b60','#6d4c41','#ffffff','#bdbdbd','#757575','#212121','#ffccbc'];
const SLIME_SWATCH='radial-gradient(circle at 28% 23%,rgba(239,255,225,.96) 0 5%,transparent 8%),radial-gradient(ellipse at 70% 68%,rgba(67,159,77,.82) 0 13%,transparent 21%),linear-gradient(135deg,rgba(200,245,168,.78) 0%,rgba(143,223,112,.62) 48%,rgba(89,185,84,.72) 100%),conic-gradient(#d5e4ce 25%,#eff6eb 0 50%,#d5e4ce 0 75%,#eff6eb 0) 0 0/8px 8px';
const BC=[null,...BH.map(h=>new THREE.Color(h))];
let worldTheme='nature';
const THEMES={
 nature:{
  BN:['草','土','石','木','白','レンガ','砂','水','葉','ガラス','黒','金','氷','スライム'],
  BH:[0x6aa84f,0x866043,0x828286,0xa07846,0xf0f0ec,0xb2483c,0xe2d096,0x3a8fd0,0x3d8b40,0xa8d4e8,0x2c2c2c,0xd4a017,0x9fd9ef,0x8bcf4a],
  skyTop:'#1a3a6e',skyMid:'#5ba3d9',skyBot:'#b8dcf0',fog:0xbfe3f2
 },
 paper:{
  BN:['和紙','段ボール','鉛筆灰','クラフト','画用紙','朱紙','キラ紙','インク','苔紙','ガラス','墨','金箔','氷','ゼリー'],
  BH:[0xf5ecd8,0xc9a06a,0x8a8580,0xb07d4f,0xfffbf2,0xc62828,0xe8dcc8,0x1a237e,0x558b2f,0xc5dce8,0x212121,0xc9a227,0xb3e5fc,0xa5d66a],
  skyTop:'#a89070',skyMid:'#e8dcc8',skyBot:'#fff8f0',fog:0xe8dcc8
 },
 toy:{
  BN:['緑マット','木床','グレー積み木','オレンジ棒','白積み木','赤積み木','黄マット','ビー玉','葉っぱ','ガラス','黒積み木','金積み木','水色積み木','スライム'],
  BH:[0x43a047,0xe0a86c,0x78909c,0xffa726,0xfafafa,0xe53935,0xffee58,0x039be5,0x66bb6a,0xb3e5fc,0x37474f,0xffc107,0x81d4fa,0x9ccc65],
  skyTop:'#5e35b1',skyMid:'#ce93d8',skyBot:'#fce4ec',fog:0xf8bbd0
 }
};
function applyWorldTheme(th){
 const T=THEMES[th]||THEMES.nature;
 worldTheme=th in THEMES?th:'nature';
 BN=T.BN.slice();BH=T.BH.slice();
 for(let i=0;i<BH.length;i++){if(BC[i+1])BC[i+1].setHex(BH[i]);else BC[i+1]=new THREE.Color(BH[i])}
 try{
  if(window._skyGrad&&window._skyCan&&window._skyTex){
   const x=window._skyGrad;
   const gd=x.createLinearGradient(0,0,0,64);
   gd.addColorStop(0,T.skyTop);gd.addColorStop(.4,T.skyMid);gd.addColorStop(1,T.skyBot);
   x.fillStyle=gd;x.fillRect(0,0,2,64);window._skyTex.needsUpdate=true;
  }
 }catch(e){}
 try{
  // scene / wDirty は後で宣言されるため、存在するときだけ更新
  if(typeof scene!=='undefined'&&scene&&scene.fog){
   const f=new THREE.Color(T.fog);scene.background.copy(f);scene.fog.color.copy(f);
  }
 }catch(e){}
 try{if(typeof wDirty!=='undefined'){wDirty=true;oDirty=true}}catch(e){}
 try{if(typeof setCaveAmbienceTheme==='function')setCaveAmbienceTheme(worldTheme)}catch(e){}
 try{if(typeof rebuildBar==='function')rebuildBar();if(typeof refresh==='function')refresh()}catch(e){}
}

const toC=hex=>{const n=parseInt(hex.slice(1),16);return 0x8000|(n>>19&31)<<10|(n>>11&31)<<5|(n>>3&31)};
const toCss=c=>'rgb('+((c>>10&31)*255/31|0)+','+((c>>5&31)*255/31|0)+','+((c&31)*255/31|0)+')';
const world=new Uint8Array(W*H*D);
const idx=(x,y,z)=>x+z*W+y*W*D;
const get=(x,y,z)=>x<0||y<0||z<0||x>=W||y>=H||z>=D?0:world[idx(x,y,z)];
// 自然テーマの洞窟壁だけを少し暗く見せるためのセル集合。地形リセット時に再計算する。
const naturalCaveWallCells=new Set();
const naturalCaveAccentCells=new Set();
// ワールド中央広場の電話ゲーム端末。配置・形状バージョンはサーバーと一致させる。
const PHONE_STATION_VERSION=3;
let phoneStation=null;
function phoneSpawnForTheme(theme){return theme==='paper'?{x:30,z:50}:theme==='toy'?{x:30,z:52}:{x:28,z:50}}
function phoneStationTarget(theme){return theme==='paper'?{x:41,z:54}:theme==='toy'?{x:41,z:56}:{x:39,z:50}}
function phoneSurfaceY(w,x,z){for(let y=H-1;y>=0;y--){const b=w[idx(x,y,z)];if(b&&b!==8)return y}return -1}
function legacyPhoneStationBlockId(dx,y,baseY){const edge=Math.abs(dx)===2||y===baseY+2||y===baseY+5;if(edge)return 11;if(y===baseY+3)return Math.abs(dx)===1?4:5;if(y===baseY+4)return Math.abs(dx)===1?4:10;return 10}
function phoneStationBlockId(dx,dzOffset,y,baseY){
 // シンプルな機械本体。灰色の石台＋均一な黒い筐体。画面はドット絵を別表示する。
 if(y===baseY+1)return 3;
 return 11;
}
function phoneStationPlan(w,cx,cz){
 const baseY=phoneSurfaceY(w,cx,cz);
 if(baseY<7||baseY>10||baseY+3>=H)return null;
 for(let dx=-1;dx<=1;dx++)for(let dz=0;dz<=1;dz++){
  const x=cx+dx,z=cz+dz;
  if(x<1||x>=W-1||z<1||z>=D-1||phoneSurfaceY(w,x,z)!==baseY)return null;
  if(!w[idx(x,baseY,z)]||w[idx(x,baseY,z)]===8)return null;
  for(let y=baseY+1;y<=baseY+3;y++)if(w[idx(x,y,z)])return null;
 }
 return{x:cx,z:cz,baseY,version:PHONE_STATION_VERSION};
}
function hasLegacyPhoneStation(w,s){
 if(!s||!Number.isInteger(s.x)||!Number.isInteger(s.z)||!Number.isInteger(s.baseY)||s.x<2||s.x>W-3||s.z<0||s.z>=D||s.baseY<0||s.baseY+5>=H)return false;
 for(let dx=-2;dx<=2;dx++){if(w[idx(s.x+dx,s.baseY+1,s.z)]!==(Math.abs(dx)===2?11:10))return false;for(let y=s.baseY+2;y<=s.baseY+5;y++)if(w[idx(s.x+dx,y,s.z)]!==legacyPhoneStationBlockId(dx,y,s.baseY))return false}
 return true;
}
function removeLegacyPhoneStation(w,s){
 if(!hasLegacyPhoneStation(w,s))return false;
 for(let dx=-2;dx<=2;dx++)for(let y=s.baseY+1;y<=s.baseY+5;y++)w[idx(s.x+dx,y,s.z)]=0;
 return true;
}
function phoneStationBlockIdV2(dx,dzOffset,y,baseY){
 if(y===baseY+1)return 3;
 if(y===baseY+3&&Math.abs(dx)===1)return 12;
 if(y===baseY+2&&dx===0&&dzOffset===1)return 12;
 return 11;
}
function hasPhoneStationV2(w,s){
 if(!s||!Number.isInteger(s.x)||!Number.isInteger(s.z)||!Number.isInteger(s.baseY)||s.x<2||s.x>W-3||s.z<1||s.z>=D-2||s.baseY<0||s.baseY+3>=H)return false;
 for(let dx=-1;dx<=1;dx++)for(let dz=0;dz<=1;dz++)for(let y=s.baseY+1;y<=s.baseY+3;y++)if(w[idx(s.x+dx,y,s.z+dz)]!==phoneStationBlockIdV2(dx,dz,y,s.baseY))return false;
 return true;
}
function hasPhoneStation(w,s){
 if(!s)return false;
 const version=s.version||1;
 if(version===1)return hasLegacyPhoneStation(w,s);
 if(version===2)return hasPhoneStationV2(w,s);
 if(version!==PHONE_STATION_VERSION||!Number.isInteger(s.x)||!Number.isInteger(s.z)||!Number.isInteger(s.baseY)||s.x<2||s.x>W-3||s.z<1||s.z>=D-2||s.baseY<0||s.baseY+3>=H)return false;
 for(let dx=-1;dx<=1;dx++)for(let dz=0;dz<=1;dz++)for(let y=s.baseY+1;y<=s.baseY+3;y++)if(w[idx(s.x+dx,y,s.z+dz)]!==phoneStationBlockId(dx,dz,y,s.baseY))return false;
 return true;
}
function removePhoneStationV2(w,s){
 if(!hasPhoneStationV2(w,s))return false;
 for(let dx=-1;dx<=1;dx++)for(let dz=0;dz<=1;dz++)for(let y=s.baseY+1;y<=s.baseY+3;y++)w[idx(s.x+dx,y,s.z+dz)]=0;
 return true;
}
function removeKnownPhoneStation(w,s){const version=s&&(s.version||1);if(version===1)return removeLegacyPhoneStation(w,s);if(version===2)return removePhoneStationV2(w,s);return false}
function placePhoneStation(w,theme=worldTheme){
 const spawn=phoneSpawnForTheme(theme),target=phoneStationTarget(theme),candidates=[];
 // 広場の中から探すが、リスポーン地点から約10ブロック以内は候補にしない。
 for(let z=40;z<=61;z++)for(let x=18;x<=49;x++){
  if(Math.hypot(x-spawn.x,z-spawn.z)<9.5)continue;
  candidates.push({x,z,d:(x-target.x)**2+(z-target.z)**2,spawnD:(x-spawn.x)**2+(z-spawn.z)**2});
 }
 candidates.sort((a,b)=>a.d-b.d||b.spawnD-a.spawnD||a.z-b.z||a.x-b.x);
 for(const c of candidates){const st=phoneStationPlan(w,c.x,c.z);if(!st)continue;
  for(let dx=-1;dx<=1;dx++)for(let dz=0;dz<=1;dz++)for(let y=st.baseY+1;y<=st.baseY+3;y++)w[idx(st.x+dx,y,st.z+dz)]=phoneStationBlockId(dx,dz,y,st.baseY);
  return st;
 }
 return null;
}
function normalizePhoneStation(s){
 if(!s||!Number.isInteger(s.x)||!Number.isInteger(s.z)||!Number.isInteger(s.baseY))return null;
 const version=[1,2,PHONE_STATION_VERSION].includes(s.version)?s.version:1;
 if(s.x<2||s.x>W-3||s.z<(version===1?0:1)||s.z>=(version===1?D:D-2)||s.baseY<0||s.baseY+(version===1?5:3)>=H)return null;
 return{x:s.x,z:s.z,baseY:s.baseY,version};
}
function ensurePhoneStation(w,s,theme=worldTheme){
 const station=normalizePhoneStation(s);
 if(station&&station.version===PHONE_STATION_VERSION)return station; // 現行位置は建築後に見た目を変えていても保持
 if(station)removeKnownPhoneStation(w,station); // 旧端末は既知の配置と完全一致する場合のみ撤去
 return placePhoneStation(w,theme);
}
function isPhoneStationBlock(x,y,z){
 const s=phoneStation;if(!s)return false;
 if(s.version===PHONE_STATION_VERSION)return x>=s.x-1&&x<=s.x+1&&z>=s.z&&z<=s.z+1&&y>=s.baseY+1&&y<=s.baseY+3;
 return z===s.z&&x>=s.x-2&&x<=s.x+2&&y>=s.baseY+1&&y<=s.baseY+5;
}
function openPhoneGameAtStation(){
 if(!hit||!isPhoneStationBlock(hit.x,hit.y,hit.z))return false;
 // 着信中は通常のミニゲーム起動より受話を優先する。
 if(phoneHauntCall&&Date.now()<phoneHauntCall.expiresAt){answerPhoneHaunt();return true}
 if(window.PhoneGame){window.PhoneGame.open();return true}
 return false;
}
function updatePhoneStationHint(){
 const targeted=!!(started&&!phonePanelOpen&&hit&&isPhoneStationBlock(hit.x,hit.y,hit.z));
 const ringing=!!(phoneHauntCall&&Date.now()<phoneHauntCall.expiresAt&&!phoneHauntCall.answerPending);
 const pending=!!(phoneHauntCall&&phoneHauntCall.answerPending&&Date.now()<phoneHauntCall.expiresAt);
 const el=$('phoneStationHint');if(el){el.style.display=targeted?'block':'none';el.textContent=targeted?(pending?'☎ 受話中……':ringing?(TOUCH?'☎ 着信中 — 「使う」で受話':'☎ 着信中 — Fキー / 右クリックで受話'):(TOUCH?'☎ テレフォンゲーム — 「使う」をタップ':'☎ テレフォンゲーム — Fキー / 右クリックで開く')):''}
 const b=$('bAct');if(b){b.classList.toggle('phone-use',!!(targeted&&TOUCH));if(targeted&&TOUCH)b.textContent=ringing?'受話':'遊ぶ';else if(!targeted&&TOUCH&&typeof forestResidentCanTalk==='function'&&forestResidentCanTalk())b.textContent='話す';else if(!targeted)b.textContent=isPen()?'描く':'置く'}
}
const isSolid=b=>b&&b!==8;
let underWater=false;
function eyeInWater(){
 // 視点付近が水ブロックか
 const eyeY=me.p.y+(me.crouch?1.2:1.55);
 const b=get(Math.floor(me.p.x),Math.floor(eyeY),Math.floor(me.p.z));
 return b===8;
}
function applyUnderwaterFX(){
 const uw=eyeInWater();
 const el=$('uw');
 if(el)el.classList.toggle('on',uw);
 if(uw){
  // 青みの短距離フォグ
  scene.background.setRGB(0.08,0.22,0.35);
  scene.fog.color.setRGB(0.08,0.22,0.35);
  scene.fog.near=1.5;
  scene.fog.far=22;
 }else if(underWater){
  // 水から出た直後: 通常のフォグ距離に戻す（色は updateSky / テーマが上書き）
  scene.fog.near=50;
  scene.fog.far=130;
 }
 underWater=uw;
}
function noise2(x,z){const n=Math.sin(x*12.9898+z*78.233)*43758.5453;return n-Math.floor(n)}
function fbm(x,z,oct){let v=0,a=1,f=1,s=0;for(let i=0;i<oct;i++){v+=a*noise2(x*f,z*f);s+=a;a*=.5;f*=2.1}return v/s}
function genTerrain(theme,withCave=true){
 theme=theme||worldTheme||'nature';
 world.fill(0);
 if(theme==='paper'){genTerrainPaper();phoneStation=placePhoneStation(world,theme);naturalCaveWallCells.clear();naturalCaveAccentCells.clear();return}
 if(theme==='toy'){genTerrainToy();phoneStation=placePhoneStation(world,theme);naturalCaveWallCells.clear();naturalCaveAccentCells.clear();return}
 genTerrainNature(withCave);phoneStation=placePhoneStation(world,theme);
}
// 洞窟の空間・装飾を座標で決定する。サーバー版と同じ座標・規則で生成する。
function makeNaturalCaveEdits(w){
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

// v20.141 洞窟の下層。既存洞窟の床下を通る下り階段と地下広間を追加する。
// 編集対象の床・天井も guard に記録し、保存済みワールドの建築があれば移行を中止できる。
function makeNaturalCaveDeepPlan(w){
 const edits=new Map(),guards=new Set();
 const inside=(x,y,z)=>x>=0&&x<W&&y>=0&&y<H&&z>=0&&z<D;
 const guard=(x,y,z)=>{if(inside(x,y,z))guards.add(idx(x,y,z))};
 const air=(x,y,z)=>{if(inside(x,y,z))edits.set(idx(x,y,z),0)};
 const put=(x,y,z,b)=>{if(inside(x,y,z))edits.set(idx(x,y,z),b)};
 const groundTop=(x,z)=>{for(let y=H-1;y>=0;y--){const b=w[idx(x,y,z)];if(b===1||b===2||b===3||b===7)return y}return -1};
 const carveRampCell=(x,z,floorY)=>{
  const top=groundTop(x,z);if(top<floorY+3)return false;
  const roof=Math.min(11,top-2);if(roof<floorY+2)return false;
  guard(x,floorY,z);
  for(let y=roof+1;y<=top;y++)guard(x,y,z);
  for(let y=floorY+1;y<=roof;y++)air(x,y,z);
  return true;
 };
 const carveDeepCell=(x,z)=>{
  const top=groundTop(x,z);if(top<12)return false;
  // 下層天井(y=8)、地表までの岩盤、床(y=3)を移行前に検査する。
  guard(x,3,z);for(let y=8;y<=top;y++)guard(x,y,z);
  for(let y=4;y<=7;y++)air(x,y,z);
  return true;
 };

 // 上層の南東端(x=35,z=11)から一度南へ折れて、2セル幅の階段へ接続。
 // x=35..37 は上層床(y=8)、その先は1セルずつ低くなる。
 for(let x=35;x<=41;x++){
  const floorY=x<=37?8:8-(x-37);
  for(const z of [12,13])carveRampCell(x,z,floorY);
 }

 // 地下主広間。床はy=3、天井はy=8。上層とは階段だけでつながる。
 for(let x=42;x<=49;x++)for(let z=7;z<=15;z++){
  const r=((x-45.2)/4.1)**2+((z-11)/4.15)**2;
  const wobble=(noise2(x*1.67+41,z*1.29+23)-.5)*.14;
  if(r>1+wobble)continue;
  carveDeepCell(x,z);
 }

 // 北へ折れる下層の通路と小部屋。主広間を見渡せない位置に隠れた横穴を作る。
 for(let z=7;z>=5;z--)for(let x=44;x<=46;x++)carveDeepCell(x,z);
 for(let x=42;x<=48;x++)for(let z=2;z<=6;z++){
  const r=((x-45)/2.7)**2+((z-4)/2.15)**2;
  const wobble=(noise2(x*2.07+13,z*1.51+37)-.5)*.14;
  if(r>1+wobble)continue;
  carveDeepCell(x,z);
 }

 // 壁際の結晶と金鉱脈、天井の低い岩。通路の中央と階段は塞がない。
 for(const [x,y,z] of [[43,4,14],[43,5,14],[44,4,14]])put(x,y,z,13);
 for(const [x,y,z] of [[49,4,11],[49,5,11],[49,4,12]])put(x,y,z,12);
 for(const [x,y,z] of [[45,7,10],[46,7,9]])put(x,y,z,3);
 return {edits,guards};
}
function makeNaturalCaveDeepEdits(w){return makeNaturalCaveDeepPlan(w).edits;}

function refreshNaturalCaveWallCells(w=world){
  naturalCaveWallCells.clear();naturalCaveAccentCells.clear();const planned=new Map([...makeNaturalCaveEdits(w),...makeNaturalCaveExtensionEdits(w),...makeNaturalCaveDeepEdits(w)]);for(const group of makeNaturalCaveVoxelDetailGroups())for(const [x,y,z,b] of group.edits)planned.set(idx(x,y,z),b);
  for(const [at,b] of planned){
   if((b===6||b===12||b===13)&&w[at]===b)naturalCaveAccentCells.add(at);
   if(b!==0||w[at]!==0)continue;
   const y=Math.floor(at/(W*D)),rem=at-y*W*D,z=Math.floor(rem/W),x=rem%W;
   for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
    const xx=x+dx,yy=y+dy,zz=z+dz;if(xx<0||xx>=W||yy<0||yy>=H||zz<0||zz>=D)continue;
    const ni=idx(xx,yy,zz);if(w[ni])naturalCaveWallCells.add(ni);
   }
  }
}
/* ---- 洞窟の環境要素は飾りメッシュではなく編集可能なボクセルとして配置 ---- */
function makeNaturalCaveVoxelDetailGroups(){
 const groups=[];
 const add=(name,edits,guards)=>groups.push({name,edits,guards});
 const nearby=(x,y,z,rx=1,ry=1,rz=1)=>{
  const a=[];
  for(let xx=x-rx;xx<=x+rx;xx++)for(let yy=y-ry;yy<=y+ry;yy++)for(let zz=z-rz;zz<=z+rz;zz++)
   if(xx>=0&&xx<W&&yy>=0&&yy<H&&zz>=0&&zz<D)a.push(idx(xx,yy,zz));
  return a;
 };
 // 上層の小さな水たまり。床セル自体を通常の水ブロック(ID 8)に置き換える。
 const upperEdits=[],upperGuards=new Set();
 for(const x of [14,15])for(const z of [10,11]){
  upperEdits.push([x,8,z,8]);
  for(const at of nearby(x,8,z,1,2,1))upperGuards.add(at);
 }
 add('upper-water-pool',upperEdits,[...upperGuards]);
 // 下層の水たまり。水滴の着地点(x=47,z=13)は避ける。
 const deepEdits=[],deepGuards=new Set();
 for(const x of [45,46])for(const z of [12,13]){
  deepEdits.push([x,3,z,8]);
  for(const at of nearby(x,3,z,1,2,1))deepGuards.add(at);
 }
 add('deep-water-pool',deepEdits,[...deepGuards]);
 // 天井に接続する石ブロック。独立した三角錐メッシュではなく、通常の破壊可能ブロック。
 for(const [name,x,z] of [['deep-stalactite-east',48,13],['deep-stalactite-west',43,8]])
  add(name,[[x,7,z,3]],nearby(x,7,z,1,1,1));
 // 落石は通路の縁にある通常の石ブロック。中央の通路は塞がない位置。
 for(const [name,x,z] of [['deep-rubble-west',42,9],['deep-rubble-east',48,9],['deep-rubble-south',47,14]])
  add(name,[[x,4,z,3]],nearby(x,4,z,1,1,1));
 return groups;
}
function applyNaturalCaveVoxelDetails(w){
 for(const group of makeNaturalCaveVoxelDetailGroups())for(const [x,y,z,b] of group.edits)w[idx(x,y,z)]=b;
}

function applyNaturalCave(w,trackVisual=(w===world),includeVoxelDetails=true){
 const deep=makeNaturalCaveDeepPlan(w);
 const edits=makeNaturalCaveEdits(w);for(const [at,b] of edits)w[at]=b;
 const extension=makeNaturalCaveExtensionEdits(w);for(const [at,b] of extension)w[at]=b;
 for(const [at,b] of deep.edits)w[at]=b;
 if(includeVoxelDetails)applyNaturalCaveVoxelDetails(w);
 if(trackVisual)refreshNaturalCaveWallCells(w);
 return edits;
}
function applyNaturalCaveSafely(w,baseline){
 const edits=makeNaturalCaveEdits(baseline),extension=makeNaturalCaveExtensionEdits(baseline),deep=makeNaturalCaveDeepPlan(baseline);
 const all=new Map([...edits,...extension,...deep.edits]);
 for(const at of deep.guards)if(w[at]!==baseline[at])return false;
 for(const at of all.keys())if(w[at]!==baseline[at])return false;
 for(const [at,b] of all)if(baseline[at]!==b)w[at]=b;
 return true;
}
function genTerrainNature(withCave=true){
 const sea=6,height=new Float32Array(W*D);
 const riverZ=x=>40+Math.sin(x*.12)*5.5+Math.sin(x*.05)*2;
 const riverDist=(x,z)=>Math.abs(z-riverZ(x));
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  let h=8.2;const north=Math.max(0,(28-z)/28);
  h+=north*north*7.5;h+=north*fbm(x*.05,z*.05,3)*5.5;
  const peak=Math.hypot((x-14)/11,(z-9)/9);if(peak<1.2)h+=(1.2-peak)*(1.2-peak)*9;
  const hill=Math.hypot((x-50)/10,(z-12)/8);if(hill<1.1)h+=(1.1-hill)*5;
  if(z>30)h=8+fbm(x*.03,z*.03,2)*1.2;
  const rd=riverDist(x,z);if(rd<2.2)h=Math.min(h,sea-1.2);else if(rd<4.5)h=Math.min(h,sea+(rd-2.2)*.85);
  const pond=Math.hypot((x-48)/5.5,(z-52)/4.5);if(pond<1)h=Math.min(h,sea-.5-(1-pond)*1.5);
  const edge=Math.min(x,z,W-1-x,D-1-z);if(edge<2)h=Math.min(h,7+edge);
  height[x+z*W]=h;
 }
 for(let pass=0;pass<2;pass++){const next=new Float32Array(W*D);
  for(let z=0;z<D;z++)for(let x=0;x<W;x++){let s=0,n=0;for(let oz=-1;oz<=1;oz++)for(let ox=-1;ox<=1;ox++){const xx=x+ox,zz=z+oz;if(xx<0||zz<0||xx>=W||zz>=D)continue;const w=(!ox&&!oz)?5:1;s+=height[xx+zz*W]*w;n+=w}next[x+z*W]=s/n}
  height.set(next)}
 const hi=new Int8Array(W*D);for(let i=0;i<height.length;i++)hi[i]=Math.max(1,Math.min(H-5,Math.round(height[i])));
 const pcx=28,pcz=50,prx=14,prz=9,floorY=8;
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){const dx=(x-pcx)/prx,dz=(z-pcz)/prz;if(dx*dx+dz*dz<=1)hi[x+z*W]=floorY}
 const tcx=36,tcz=32,trx=8,trz=5,tFloor=9;
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){const dx=(x-tcx)/trx,dz=(z-tcz)/trz;if(dx*dx+dz*dz<=1&&riverDist(x,z)>4)hi[x+z*W]=tFloor}
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  const h=hi[x+z*W],rd=riverDist(x,z),pond=Math.hypot((x-48)/5.5,(z-52)/4.5);
  for(let y=0;y<=h;y++){let b;if(y===h){if(rd<4.5||pond<1.15)b=7;else if(h>=14)b=3;else if(h>=12&&noise2(x*.8,z*.8)>.3)b=3;else b=1}else if(y>h-3)b=2;else b=3;world[idx(x,y,z)]=b}
  if(h<sea)for(let y=h+1;y<=sea;y++)world[idx(x,y,z)]=8;
 }
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){const dx=(x-pcx)/prx,dz=(z-pcz)/prz,d=Math.sqrt(dx*dx+dz*dz);if(d>.88&&d<=1&&world[idx(x,floorY,z)]===1)world[idx(x,floorY,z)]=5}
 for(const[x0,len]of[[18,6],[26,8],[36,6]])for(let i=0;i<len;i++)for(let y=floorY+1;y<=floorY+5;y++){const x=x0+i;if(x>0&&x<W-1)world[idx(x,y,44)]=3}
 for(let x=30;x<=42;x++)for(let y=tFloor+1;y<=tFloor+4;y++)world[idx(x,y,28)]=3;
 for(let z=3;z<D-3;z++)for(let x=3;x<W-3;x++){
  const h=hi[x+z*W];if(h<=sea||world[idx(x,h,z)]!==1||riverDist(x,z)<5)continue;
  const dx=(x-pcx)/(prx+1.5),dz=(z-pcz)/(prz+1.5);if(dx*dx+dz*dz<1)continue;
  const dxt=(x-tcx)/(trx+1),dzt=(z-tcz)/(trz+1);if(dxt*dxt+dzt*dzt<1)continue;
  let dens=.025;if(h>=12)dens=.015;if(z>45)dens=.012;if(riverDist(x,z)<8&&z<45)dens=.045;
  if(noise2(x*1.6,z*2)>dens)continue;
  const th=3+(noise2(x,z+40)*2.5|0);for(let ty=1;ty<=th;ty++)if(h+ty<H)world[idx(x,h+ty,z)]=4;
  const top=h+th;for(let ly=0;ly<=2;ly++)for(let lx=-2;lx<=2;lx++)for(let lz=-2;lz<=2;lz++){
   if(Math.abs(lx)+Math.abs(lz)>2+(ly===0?0:-1))continue;
   const y=top+ly,px=x+lx,pz=z+lz;if(px<0||pz<0||px>=W||pz>=D||y>=H)continue;
   if(!world[idx(px,y,pz)])world[idx(px,y,pz)]=9;
  }
 }
 if(withCave)applyNaturalCave(world);else{naturalCaveWallCells.clear();naturalCaveAccentCells.clear();}
}
function genTerrainPaper(){
 const sea=5,hi=new Int8Array(W*D);
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  let h=6;
  if(z>=30)h=7;
  else{const d=Math.hypot(x-32,z-12);if(d<6)h=16;else if(d<10)h=13;else if(d<14)h=11;else if(d<18)h=9;else h=7}
  const r1=Math.abs(z-(38+Math.sin(x*.2)*3)),r2=Math.abs(z-(36+Math.cos(x*.15)*2.5)),river=Math.min(r1,r2);
  if(river<1.8)h=3;else if(river<3.2)h=Math.min(h,5);
  if(Math.hypot(x-14,z-52)<7)h=Math.min(h,3);
  if(Math.hypot(x-52,z-55)<4.5)h=Math.min(h,3);
  const edge=Math.min(x,z,W-1-x,D-1-z);if(edge<2)h=Math.min(h,6);
  hi[x+z*W]=Math.max(1,Math.min(H-4,h));
 }
 for(let z=44;z<62;z++)for(let x=8;x<56;x++)hi[x+z*W]=7;
 for(let z=24;z<34;z++)for(let x=18;x<46;x++){
  if(Math.min(Math.abs(z-38-Math.sin(x*.2)*3),Math.abs(z-36-Math.cos(x*.15)*2.5))>3.5)hi[x+z*W]=9;
 }
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  const h=hi[x+z*W];
  const r1=Math.abs(z-(38+Math.sin(x*.2)*3)),r2=Math.abs(z-(36+Math.cos(x*.15)*2.5)),river=Math.min(r1,r2);
  const nearInk=river<3.5||Math.hypot(x-14,z-52)<7.5||Math.hypot(x-52,z-55)<5;
  for(let y=0;y<=h;y++){
   let b;if(y===h){if(nearInk)b=7;else if(z>=44&&z<62&&x>=8&&x<56)b=5;else if(h>=13)b=3;else b=1}else if(y>h-2)b=2;else b=3;
   world[idx(x,y,z)]=b;
  }
  if(h<sea)for(let y=h+1;y<=sea;y++)world[idx(x,y,z)]=8;
 }
 for(let z=44;z<62;z++)for(let x=8;x<56;x++)if((z===44||z===61||x===8||x===55)&&world[idx(x,7,z)]===5)world[idx(x,7,z)]=6;
 for(const x0 of[12,26,40])for(let i=0;i<10;i++)for(let y=8;y<=14;y++){const x=x0+i;if(x<W-1)world[idx(x,y,45)]=5}
 for(let z=4;z<22;z++)for(let x=18;x<46;x++){const d=Math.hypot(x-32,z-12),h=hi[x+z*W];if(d>5.5&&d<6.5&&h>10)world[idx(x,h,z)]=5}
 for(const[tx,tz]of[[10,48],[53,48],[10,58],[53,58],[20,50],[43,50]]){for(let y=8;y<=12;y++)world[idx(tx,y,tz)]=4;world[idx(tx,13,tz)]=9}
}
function genTerrainToy(){
 const sea=5,hi=new Int8Array(W*D);
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  let h=7;
  if(z>=42)h=7;
  else if(Math.hypot(x-32,z-30)<9)h=3;
  else if(z<22){
   const gx=Math.floor((x-8)/7),gz=Math.floor(z/7),cx=8+gx*7+3,cz=gz*7+3;
   h=(Math.abs(x-cx)<=2&&Math.abs(z-cz)<=2)?10+(gx+gz)%4+2:8;
  }else h=8+Math.floor((30-z)/6);
  const edge=Math.min(x,z,W-1-x,D-1-z);if(edge<2)h=6;
  hi[x+z*W]=Math.max(1,Math.min(H-4,h));
 }
 for(let z=44;z<63;z++)for(let x=6;x<58;x++)hi[x+z*W]=7;
 for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  const h=hi[x+z*W],pool=Math.hypot(x-32,z-30);
  for(let y=0;y<=h;y++){
   let b;if(y===h){
    if(pool<9.5)b=7;
    else if(z>=44){const c=((x>>1)+(z>>1))%4;b=c===0?1:c===1?6:c===2?5:7}
    else if(h>=12)b=(x+z)%2?3:6;else b=1;
   }else if(y>h-2)b=2;else b=3;
   world[idx(x,y,z)]=b;
  }
  if(h<sea)for(let y=h+1;y<=sea;y++)world[idx(x,y,z)]=8;
 }
 for(let x=10;x<54;x++)for(let y=8;y<=13;y++){const stripe=Math.floor(x/4)%3;world[idx(x,y,45)]=stripe===0?6:stripe===1?5:1}
 for(let x=28;x<=36;x++){world[idx(x,6,30)]=5;world[idx(x,6,31)]=5}
 for(let gx=0;gx<7;gx++)for(let gz=0;gz<3;gz++){
  const cx=8+gx*7+3,cz=gz*7+3;if(cx>=W-1||cz>=D-1)continue;const h=hi[cx+cz*W];if(h+1<H)world[idx(cx,h+1,cz)]=9;
 }
 for(const[tx,tz]of[[12,50],[20,56],[44,50],[52,56],[16,36],[48,36]]){
  const h=hi[tx+tz*W];if(h<=sea)continue;
  for(let ty=1;ty<=4;ty++)if(h+ty<H)world[idx(tx,h+ty,tz)]=4;
  if(h+5<H)for(let lx=-1;lx<=1;lx++)for(let lz=-1;lz<=1;lz++){const px=tx+lx,pz=tz+lz;if(px>=0&&pz>=0&&px<W&&pz<D&&!world[idx(px,h+5,pz)])world[idx(px,h+5,pz)]=9}
 }
}

genTerrain('nature');

/* ---- 面の定義: n=法線 o=面の左上 a=横方向 b=縦方向 ---- */
const FACES=[
{n:[1,0,0],o:[1,1,1],a:[0,0,-1],b:[0,-1,0]},{n:[-1,0,0],o:[0,1,0],a:[0,0,1],b:[0,-1,0]},
{n:[0,1,0],o:[0,1,0],a:[1,0,0],b:[0,0,1]},{n:[0,-1,0],o:[0,0,0],a:[1,0,0],b:[0,0,1]},
{n:[0,0,1],o:[0,1,1],a:[1,0,0],b:[0,-1,0]},{n:[0,0,-1],o:[1,1,0],a:[-1,0,0],b:[0,-1,0]}];
const OPPOSITE_FACE=[1,0,3,2,5,4];
const SH=[.8,.8,1,.55,.9,.7];
FACES.forEach(F=>{const a=F.a,b=F.b,c=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];F.flip=c[0]*F.n[0]+c[1]*F.n[1]+c[2]*F.n[2]<0;});

/* ---- Three.js ---- */
const R=new THREE.WebGLRenderer({antialias:false});R.setPixelRatio(Math.min(devicePixelRatio,2));R.setSize(innerWidth,innerHeight);document.body.appendChild(R.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xbfe3f2);scene.fog=new THREE.Fog(0xbfe3f2,50,130);
const cam=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,250);cam.rotation.order='YXZ';
addEventListener('resize',()=>{R.setSize(innerWidth,innerHeight);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix()});

// 低コストの接地影。影マップやリアルタイムシャドウを使わず、柔らかい円形テクスチャを共有する。
const contactShadowCanvas=document.createElement('canvas');contactShadowCanvas.width=contactShadowCanvas.height=64;
const contactShadowCtx=contactShadowCanvas.getContext('2d');
const contactShadowGradient=contactShadowCtx.createRadialGradient(32,32,2,32,32,31);
contactShadowGradient.addColorStop(0,'rgba(15,22,29,0.30)');
contactShadowGradient.addColorStop(.42,'rgba(15,22,29,0.19)');
contactShadowGradient.addColorStop(.72,'rgba(15,22,29,0.07)');
contactShadowGradient.addColorStop(1,'rgba(15,22,29,0)');
contactShadowCtx.fillStyle=contactShadowGradient;contactShadowCtx.fillRect(0,0,64,64);
const contactShadowTexture=new THREE.CanvasTexture(contactShadowCanvas);
contactShadowTexture.magFilter=contactShadowTexture.minFilter=THREE.LinearFilter;contactShadowTexture.generateMipmaps=false;
const contactShadowGeometry=new THREE.CircleGeometry(1,16);
const contactShadowMaterial=new THREE.MeshBasicMaterial({map:contactShadowTexture,transparent:true,opacity:.82,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
function addContactShadow(root,rx=.36,rz=.4,opacity=.82){
 const material=opacity===.82?contactShadowMaterial:contactShadowMaterial.clone();material.opacity=opacity;
 const shadow=new THREE.Mesh(contactShadowGeometry,material);shadow.rotation.x=-Math.PI/2;shadow.position.y=.018;shadow.scale.set(rx,rz,1);shadow.renderOrder=1;shadow.name='contact-shadow';root.add(shadow);root.userData.contactShadow=shadow;return shadow;
}
// 落書きテクスチャを4枚に分け、描画時に更新する転送量を抑える。
// 1面32x32px、1ページ1024x1024px（最大1024面）。既存の最大4096面は4ページで維持。
const paintAtlases=Array.from({length:PAINT_PAGE_COUNT},()=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=AT;
 const context=canvas.getContext('2d');
 const texture=new THREE.CanvasTexture(canvas);texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;
 return{canvas,context,texture};
});
// 共有テクスチャアトラスで、単色ブロックに控えめなピクセル質感を加える。
// 1ブロック面につき32x32px。ブロック・面ごとに別タイルを使い、追加マテリアルやドローコールを増やさない。
function makeBlockTextureAtlas(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=AT;const ctx=canvas.getContext('2d');
 const tileStep=34,tileInset=1,cols=Math.floor(AT/tileStep);
 const randFor=seed=>{let st=(seed*9301+49297)%233280;return()=>{st=(st*9301+49297)%233280;return st/233280}};
 for(let block=1;block<=14;block++)for(let face=0;face<6;face++){
  const tile=(block-1)*6+face,col=tile%cols,row=Math.floor(tile/cols),ox=col*tileStep+tileInset,oy=row*tileStep+tileInset,rnd=randFor(block*71+face*997);
  ctx.fillStyle='#ffffff';ctx.fillRect(ox,oy,TS,TS);
  // 模様は素材の個性が明確な草・砂・レンガだけに限定。ほかは無地を維持する。
  if(block!==1&&block!==6&&block!==7)continue;
  const dot=(x,y,w,h,a,light=false)=>{ctx.fillStyle=light?`rgba(255,255,255,${a})`:`rgba(20,25,30,${a})`;ctx.fillRect(ox+x,oy+y,w,h)};
  if(block===1){ // 草：粒感は上面だけ。側面は土と草の境目を形状で表現
   if(face===2){for(let i=0;i<25;i++)dot(rnd()*30|0,rnd()*30|0,1+(rnd()*2|0),1,.07+rnd()*.06,rnd()>.62)}
   else continue; // 側面・底面はブツブツ模様を付けない
  }else if(block===7){ // 砂：小さな粒
   for(let i=0;i<34;i++)dot(rnd()*31|0,rnd()*31|0,1+(rnd()*2|0),1+(rnd()*2|0),.045+rnd()*.08,rnd()>.55)
  }else if(block===3){ // 石：薄い鉱物片とごく短い亀裂
   for(let i=0;i<10;i++)dot(rnd()*29|0,rnd()*29|0,2+(rnd()*3|0),1,.07+rnd()*.04,rnd()>.6);
   for(let i=0;i<3;i++){const x=3+(rnd()*23|0),y=4+(rnd()*22|0);dot(x,y,3,1,.11);dot(x+2,y+1,1,2,.09)}
  }else if(block===4){ // 木材・クラフト・棒：木目。上下面は年輪風
   if(face===2||face===3){for(let r=5;r<29;r+=7){ctx.strokeStyle='rgba(35,25,15,.10)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(16+(rnd()-.5)*3,16+(rnd()-.5)*3,r*.34,r*.46,0,0,Math.PI*2);ctx.stroke()}}
   else {for(let i=0;i<5;i++){const x=3+(rnd()*26|0);dot(x,2,1,28,.045+rnd()*.055,rnd()>.5);if(i%2===0)dot(x+1,8+(rnd()*16|0),2,1,.05)}}
  }else if(block===5){ // 白・画用紙：紙繊維
   for(let i=0;i<23;i++)dot(rnd()*30|0,rnd()*30|0,1+(rnd()*4|0),1,.025+rnd()*.04,rnd()>.4)
  }else if(block===6){ // レンガ：細い目地を規則的に
   for(const y of [0,10,21,31])dot(0,y,32,1,.18);
   for(let y=0;y<32;y+=10){const offset=(Math.floor(y/10)%2)*8;for(let x=offset;x<32;x+=16)dot(x,y,1,10,.15);}
   for(let i=0;i<8;i++)dot(rnd()*29|0,rnd()*29|0,2,1,.035,rnd()>.5)
  }else if(block===9){ // 葉：小さな葉の斑点
   for(let i=0;i<14;i++){const x=2+(rnd()*27|0),y=2+(rnd()*27|0);dot(x,y,2,2,.095,rnd()>.55);dot(x+1,y-1,1,1,.08,true)}
  }else if(block===11){ // 黒い積み木：ほぼ目立たない微粒子
   for(let i=0;i<9;i++)dot(rnd()*31|0,rnd()*31|0,1,1,.055,rnd()>.55)
  }else if(block===12){ // 金：短い控えめな反射
   for(let i=0;i<5;i++){const x=3+(rnd()*26|0),y=3+(rnd()*26|0);dot(x,y,2,1,.11,true);dot(x,y+1,1,2,.07)}
  }else if(block===13){ // 氷：かすかな斜めの筋
   for(let i=-24;i<32;i+=8){ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(ox+i,oy+31);ctx.lineTo(ox+i+14,oy);ctx.stroke()}
  }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 return{canvas,texture};
}
const blockTextureAtlas=makeBlockTextureAtlas();
function blockFaceUV(block,face){const tile=(block-1)*6+face,cols=Math.floor(AT/34),x=(tile%cols)*34+1,y=Math.floor(tile/cols)*34+1;return[(x+.0)/AT,1-y/AT]}
// スライム専用の16種類のピクセル調テクスチャ。通常ブロックの描画経路には影響させない。
const slimeCanvas=document.createElement('canvas');slimeCanvas.width=slimeCanvas.height=128;
const slimeCtx=slimeCanvas.getContext('2d');
const slimeTex=new THREE.CanvasTexture(slimeCanvas);slimeTex.magFilter=slimeTex.minFilter=THREE.NearestFilter;slimeTex.generateMipmaps=false;
function refreshSlimeTexture(hex=BH[13]){
 const color=new THREE.Color(hex),hsl={h:0,s:0,l:0};color.getHSL(hsl);
 const shade=(dl,ds=0,dh=0)=>'#'+new THREE.Color().setHSL((hsl.h+dh+1)%1,Math.max(.22,Math.min(.96,hsl.s+ds)),Math.max(.12,Math.min(.94,hsl.l+dl))).getHexString();
 for(let v=0;v<16;v++){
  const ox=(v%4)*32,oy=Math.floor(v/4)*32;let seed=(v+1)*9871;
  const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280};
  slimeCtx.save();slimeCtx.beginPath();slimeCtx.rect(ox,oy,32,32);slimeCtx.clip();
  const grad=slimeCtx.createLinearGradient(ox+2,oy+1,ox+30,oy+31);
  grad.addColorStop(0,shade(.20,.04));grad.addColorStop(.48,shade(.03));grad.addColorStop(1,shade(-.17,-.03));
  slimeCtx.fillStyle=grad;slimeCtx.fillRect(ox,oy,32,32);
  const glow=slimeCtx.createRadialGradient(ox+9,oy+7,1,ox+13,oy+13,24);
  glow.addColorStop(0,'rgba(242,255,222,0.24)');glow.addColorStop(1,'rgba(236,255,220,0)');slimeCtx.fillStyle=glow;slimeCtx.fillRect(ox,oy,32,32);
  for(let j=0,n=4+(v%4);j<n;j++){
   const bx=ox+3+rnd()*26,by=oy+4+rnd()*24,r=1+rnd()*3.2;
   slimeCtx.globalAlpha=.18+rnd()*.2;slimeCtx.fillStyle=j%3===0?shade(-.20,-.06):shade(.27,.03);
   slimeCtx.beginPath();slimeCtx.ellipse(bx,by,r*(.7+rnd()*.6),r,0,0,Math.PI*2);slimeCtx.fill();
   if(j%2===0){slimeCtx.globalAlpha=.5;slimeCtx.strokeStyle=shade(.32,.02);slimeCtx.lineWidth=.65;slimeCtx.beginPath();slimeCtx.arc(bx-.35,by-.35,r*.65,Math.PI*1.05,Math.PI*1.85);slimeCtx.stroke()}
  }
  // 左上のぬめった反射と右下の厚みで、単色の立方体に見えないようにする。
  slimeCtx.globalAlpha=.75;slimeCtx.strokeStyle=shade(.38,.02);slimeCtx.lineWidth=1.2;
  slimeCtx.beginPath();slimeCtx.moveTo(ox+4,oy+7);slimeCtx.quadraticCurveTo(ox+5,oy+3,ox+11,oy+4);slimeCtx.quadraticCurveTo(ox+15,oy+4,ox+18,oy+6);slimeCtx.stroke();
  slimeCtx.globalAlpha=.62;slimeCtx.fillStyle='#f6ffe7';slimeCtx.fillRect(ox+5,oy+5,3,1);slimeCtx.fillRect(ox+4,oy+6,1,2);slimeCtx.fillRect(ox+12,oy+4,2,1);
  slimeCtx.globalAlpha=.2;slimeCtx.fillStyle=shade(-.28,-.02);slimeCtx.fillRect(ox,oy+30,32,2);
  slimeCtx.restore();
 }
 slimeTex.needsUpdate=true;
}
refreshSlimeTexture(BH[13]);
// 透明感を出すためスライムのみアルファ合成。depthWriteを切り、背後のワールドを見せる。
// FrontSideのままにして裏面が重なって濁るのを抑える。
const slimeMaterial=new THREE.MeshBasicMaterial({map:slimeTex,vertexColors:true,transparent:true,opacity:.62,depthWrite:false});
const sm=new THREE.Mesh(new THREE.BufferGeometry(),slimeMaterial);
const wm=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({map:blockTextureAtlas.texture,vertexColors:true}));
const wtm=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.4,depthWrite:false,side:THREE.DoubleSide}));
const omPages=paintAtlases.map(({texture})=>new THREE.Mesh(
 new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({map:texture,vertexColors:true,transparent:true,alphaTest:.5,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2})
));
wm.frustumCulled=wtm.frustumCulled=sm.frustumCulled=false;
scene.add(wm,wtm);
omPages.forEach(om=>{om.frustumCulled=false;scene.add(om)});
scene.add(sm);

/* ---- 自然洞窟の環境要素 v20.149（水たまり・落石・鍾乳石は編集可能なブロック） ---- */
const caveAmbienceGroup=new THREE.Group();caveAmbienceGroup.name='natural-cave-ambience';scene.add(caveAmbienceGroup);
const caveAmbienceSites=[];let caveSiteCheckAt=0;
const caveDrips=[];
const caveBats=[];
const caveDropMaterial=new THREE.MeshBasicMaterial({color:0x93cbd2,transparent:true,opacity:.82,depthWrite:false});
function registerCaveSite(object,valid){caveAmbienceGroup.add(object);caveAmbienceSites.push({object,valid});return object}
function addCaveDrip(def){
 const root=new THREE.Group();root.name='cave-water-drip';
 const drop=new THREE.Mesh(new THREE.SphereGeometry(.044,7,5),caveDropMaterial);drop.scale.set(.82,1.35,.82);drop.visible=false;drop.renderOrder=4;root.add(drop);
 const rippleMat=new THREE.MeshBasicMaterial({color:0xb7dedf,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
 const ripple=new THREE.Mesh(new THREE.RingGeometry(.045,.07,12),rippleMat);ripple.rotation.x=-Math.PI/2;ripple.position.set(def.x,def.bottom+.014,def.z);ripple.visible=false;ripple.renderOrder=4;root.add(ripple);
 registerCaveSite(root,()=>{const x=Math.floor(def.x),z=Math.floor(def.z),floor=get(x,def.floorY,z);if(floor===0||floor===8||get(x,def.ceilingY,z)===0)return false;for(let y=def.airY;y<def.ceilingY;y++)if(get(x,y,z)!==0)return false;return true});
 caveDrips.push({...def,root,drop,ripple,rippleMat});
}
// コウモリは非敵対の環境生物。天井に休み、プレイヤーが近くを通ると一時的に飛び立つ。
const caveBatBodyMaterial=new THREE.MeshBasicMaterial({color:0x302f32});
const caveBatWingMaterial=new THREE.MeshBasicMaterial({color:0x3e3b3c,side:THREE.DoubleSide});
const caveBatBellyMaterial=new THREE.MeshBasicMaterial({color:0x5a504b});
const caveBatEyeMaterial=new THREE.MeshBasicMaterial({color:0xb88768});
const caveBatEarGeometry=new THREE.ConeGeometry(.022,.072,4,1);
const caveBatWingShape=new THREE.Shape();caveBatWingShape.moveTo(0,.025);caveBatWingShape.lineTo(-.15,.035);caveBatWingShape.lineTo(-.29,-.025);caveBatWingShape.lineTo(-.245,-.11);caveBatWingShape.lineTo(-.16,-.088);caveBatWingShape.lineTo(-.085,-.16);caveBatWingShape.lineTo(0,-.105);caveBatWingShape.closePath();
const caveBatWingGeometry=new THREE.ShapeGeometry(caveBatWingShape,2);
function makeCaveBat(def){
 const root=new THREE.Group();root.name='cave-bat';
 const body=new THREE.Mesh(new THREE.SphereGeometry(.105,7,5),caveBatBodyMaterial);body.scale.set(.82,1.15,.9);root.add(body);
 const belly=new THREE.Mesh(new THREE.SphereGeometry(.066,6,4),caveBatBellyMaterial);belly.position.set(0,-.018,.055);belly.scale.set(.88,1.1,.55);root.add(belly);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.071,7,5),caveBatBodyMaterial);head.position.set(0,-.12,.012);root.add(head);
 const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.025,5,4),caveBatBellyMaterial);muzzle.position.set(0,-.173,.055);root.add(muzzle);
 for(const side of [-1,1]){
  const ear=new THREE.Mesh(caveBatEarGeometry,caveBatBodyMaterial);ear.position.set(side*.042,-.115,.01);ear.rotation.z=Math.PI;root.add(ear);
  const eye=new THREE.Mesh(new THREE.SphereGeometry(.012,5,4),caveBatEyeMaterial);eye.position.set(side*.035,-.12,.072);root.add(eye);
 }
 const left=new THREE.Group();left.position.set(-.055,.025,0);root.add(left);const lw=new THREE.Mesh(caveBatWingGeometry,caveBatWingMaterial);lw.position.z=.012;left.add(lw);
 const right=new THREE.Group();right.position.set(.055,.025,0);right.scale.x=-1;root.add(right);const rw=new THREE.Mesh(caveBatWingGeometry,caveBatWingMaterial);rw.position.z=.012;right.add(rw);
 root.position.set(def.x,def.y,def.z);root.userData.wings=[left,right];
 const bat={root,wings:[left,right],home:new THREE.Vector3(def.x,def.y,def.z),phase:def.phase,fleeAt:0,cooldownUntil:0,valid:()=>get(def.xCell,def.floorY,def.zCell)!==0&&get(def.xCell,def.airY,def.zCell)===0&&get(def.xCell,def.ceilingY,def.zCell)!==0};
 registerCaveSite(root,bat.valid);caveBats.push(bat);return bat;
}
// 水滴は天井のブロックから落ち、床に触れると波紋が出る。ブロック変更時は天井・床を再確認する。
addCaveDrip({x:47.05,z:13.0,top:7.73,bottom:4.04,floorY:3,airY:4,ceilingY:8,phase:.4,period:3.9});
addCaveDrip({x:45.35,z:4.45,top:7.73,bottom:4.04,floorY:3,airY:4,ceilingY:8,phase:2.1,period:4.65});
[
 {x:15.1,y:15.55,z:9.2,xCell:15,zCell:9,floorY:8,airY:15,ceilingY:16,phase:.4},
 {x:11.1,y:13.48,z:4.5,xCell:11,zCell:4,floorY:8,airY:13,ceilingY:14,phase:1.4},
 {x:33.1,y:11.52,z:9.4,xCell:33,zCell:9,floorY:8,airY:11,ceilingY:12,phase:2.6},
 {x:45.1,y:7.52,z:11.2,xCell:45,zCell:11,floorY:3,airY:7,ceilingY:8,phase:3.5},
 {x:45.25,y:7.52,z:4.3,xCell:45,zCell:4,floorY:3,airY:7,ceilingY:8,phase:4.4}
].forEach(makeCaveBat);
function setCaveAmbienceTheme(theme){caveAmbienceGroup.visible=theme==='nature';caveSiteCheckAt=0}
setCaveAmbienceTheme(worldTheme);
function updateCaveAmbience(dt,now){
 if(!caveAmbienceGroup.visible)return;
 if(now>=caveSiteCheckAt){caveSiteCheckAt=now+1200;for(const site of caveAmbienceSites)site.object.visible=!!site.valid()}
 const t=now*.001;
 for(const d of caveDrips){
  if(!d.root.visible)continue;
  const p=((t+d.phase)%d.period)/d.period,fallPart=.13,ripplePart=.21;
  if(p<fallPart){d.drop.visible=true;d.drop.position.set(d.x,d.top-(d.top-d.bottom)*(p/fallPart),d.z)}else d.drop.visible=false;
  const q=(p-fallPart)/ripplePart,active=q>=0&&q<1;d.ripple.visible=active;
  if(active){d.ripple.scale.setScalar(.5+q*1.35);d.rippleMat.opacity=.22*(1-q)}else d.rippleMat.opacity=0;
 }
 const playerPoints=[];
 if(started)playerPoints.push(me.p);
 for(const o of others.values())if(o.g&&o.g.visible&&!o.fresh)playerPoints.push(o.g.position);
 for(const bat of caveBats){
  if(!bat.root.visible)continue;
  if(!bat.fleeAt&&now>=bat.cooldownUntil){
   let disturb=false;
   for(const p of playerPoints){const dx=p.x-bat.home.x,dz=p.z-bat.home.z,dy=bat.home.y-(p.y+1.1);if(dx*dx+dz*dz<3.0*3.0&&Math.abs(dy)<6.2){disturb=true;break}}
   if(disturb)bat.fleeAt=now;
  }
  let flight=0;
  if(bat.fleeAt){flight=(now-bat.fleeAt)/3200;if(flight>=1){bat.fleeAt=0;bat.cooldownUntil=now+9500;bat.root.position.copy(bat.home);flight=0}else{
    const envelope=Math.sin(Math.PI*flight);bat.root.position.set(bat.home.x+Math.sin(flight*7+bat.phase)*.42*envelope,bat.home.y+.68*envelope,bat.home.z+Math.cos(flight*6+bat.phase)*.38*envelope);
   }}
  const flap=flight?Math.sin(t*36+bat.phase)*.62:Math.sin(t*2.5+bat.phase)*.06;
  bat.wings[0].rotation.z=flap;bat.wings[1].rotation.z=-flap;
 }
}

// The voxel cabinet remains part of the shared world; this small textured screen makes its purpose obvious.
let phoneStationVisual=null,phoneStationVisualKey='';
function phoneScreenTexture(){
 // Draw on a deliberately tiny canvas and use nearest-neighbour filtering for a crisp voxel-era pixel-art look.
 const c=document.createElement('canvas');c.width=64;c.height=68;const x=c.getContext('2d');
 const px=(a,b,w,h,color)=>{x.fillStyle=color;x.fillRect(a,b,w,h)};
 // Limited palette: dark green glass, cool gray, pale mint and muted slate.
 px(0,0,64,68,'#101b1a');
 px(2,2,60,64,'#58645f');
 px(3,3,58,62,'#263b34');
 px(5,5,54,58,'#122b27');
 px(5,5,54,2,'#92a39a');px(5,61,54,2,'#394943');
 // A few square pixels give the screen a restrained retro-game backdrop.
 for(const [a,b,col] of [[9,9,'#45614b'],[52,10,'#45614b'],[9,41,'#45614b'],[52,37,'#45614b'],[13,28,'#7ca477'],[48,25,'#7ca477']])px(a,b,2,2,col);
 // Pixel telephone receiver: stepped blocks with a one-pixel shadow, not a smooth vector curve.
 const receiver=[[13,14,7,7],[17,11,6,5],[22,8,7,5],[29,7,7,5],[36,8,7,5],[41,11,6,5],[44,14,7,7]];
 for(const [a,b,w,h] of receiver)px(a+1,b+1,w,h,'#091614');
 for(const [a,b,w,h] of receiver)px(a,b,w,h,'#cbd8d0');
 // Telephone base, built from hard-edged rectangular pixels.
 px(19,29,27,21,'#091614');
 px(18,28,27,21,'#9aa69e');
 px(20,30,23,17,'#52685b');
 px(23,32,17,5,'#122b27');
 px(25,33,4,2,'#91d2a1');px(31,33,3,2,'#91d2a1');px(36,33,2,2,'#91d2a1');
 for(const [a,b] of [[23,39],[30,39],[37,39],[23,44],[30,44],[37,44]]){
  px(a,b,4,3,'#263b34');px(a,b,3,2,'#aebdb4');
 }
 // Tiny bitmap font (3x5) keeps the label pixelated as well.
 const glyph={
  T:['111','010','010','010','010'],
  E:['111','100','110','100','111'],
  L:['100','100','100','100','111'],
  G:['111','100','101','101','111'],
  A:['010','101','111','101','101'],
  M:['101','111','111','101','101']
 };
 const label=(word,left,top,color)=>{
  let cursor=left;
  for(const ch of word){
   if(ch===' '){cursor+=2;continue}
   const rows=glyph[ch];if(!rows)continue;
   rows.forEach((row,ry)=>{for(let rx=0;rx<row.length;rx++)if(row[rx]==='1')px(cursor+rx,top+ry,1,1,color)});
   cursor+=4;
  }
 };
 label('TEL',26,50,'#f1e8bd');
 label('GAME',24,56,'#a7d8a6');
 const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;return t;
}
function syncPhoneStationVisual(){
 const s=phoneStation;
 const key=s?`${s.x},${s.z},${s.baseY},${s.version||1}`:'';
 if(key===phoneStationVisualKey)return;
 phoneStationVisualKey=key;
 if(phoneStationVisual){
  scene.remove(phoneStationVisual.group);phoneStationVisual.group.traverse(o=>{if(o.geometry)o.geometry.dispose()});
  phoneStationVisual.material.dispose();phoneStationVisual.texture.dispose();phoneStationVisual=null;
 }
 if(!s||s.version!==PHONE_STATION_VERSION)return;
 const texture=phoneScreenTexture();
 const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false});
 const group=new THREE.Group();
 const screen=new THREE.Mesh(new THREE.PlaneGeometry(1.3,1.3),material);
 // A centered pixel display on the plain dark cabinet; no decorative gold blocks around it.
 screen.position.set(s.x-1.018,s.baseY+2.95,s.z+1);
 screen.rotation.y=-Math.PI/2;group.add(screen);scene.add(group);
 phoneStationVisual={group,texture,material};
}
const sel=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01,1.01,1.01)),new THREE.LineBasicMaterial({color:0x000000}));sel.visible=false;scene.add(sel);

/* ---- ワールド生物: 3匹の小さな生き物。動きはサーバー同期、描画は軽量な低ポリモデル ---- */
const ambientCritters = new Map();
let ambientCritterLastCallAt = -Infinity;
const critterGeometries = {
 body: new THREE.SphereGeometry(.31, 8, 6),
 belly: new THREE.SphereGeometry(.145, 7, 5),
 eye: new THREE.SphereGeometry(.045, 6, 4),
 glint: new THREE.SphereGeometry(.014, 5, 4),
 ear: new THREE.ConeGeometry(.072, .22, 5),
 foot: new THREE.BoxGeometry(.105, .14, .12),
 tail: new THREE.SphereGeometry(.095, 6, 4),
 muzzle: new THREE.SphereGeometry(.095, 7, 5),
 nose: new THREE.SphereGeometry(.035, 5, 4),
};
const critterMaterials = [
 { body:new THREE.MeshBasicMaterial({color:0x88bd91}), belly:new THREE.MeshBasicMaterial({color:0xf0e6c9}), muzzle:new THREE.MeshBasicMaterial({color:0xf8f1df}), inner:new THREE.MeshBasicMaterial({color:0xdba4a0}) },
 { body:new THREE.MeshBasicMaterial({color:0xc89b62}), belly:new THREE.MeshBasicMaterial({color:0xf4e2bf}), muzzle:new THREE.MeshBasicMaterial({color:0xfff1d9}), inner:new THREE.MeshBasicMaterial({color:0xb96e61}) },
 { body:new THREE.MeshBasicMaterial({color:0x969bd4}), belly:new THREE.MeshBasicMaterial({color:0xe1dff7}), muzzle:new THREE.MeshBasicMaterial({color:0xf1efff}), inner:new THREE.MeshBasicMaterial({color:0xc5a7dd}) },
];
const critterEyeMaterial = new THREE.MeshBasicMaterial({color:0x171a20});
const critterGlintMaterial = new THREE.MeshBasicMaterial({color:0xffffff});
const critterNoseMaterial = new THREE.MeshBasicMaterial({color:0x493e42});
function makeAmbientCritter(type){
 const variant=((Number(type)||0)%critterMaterials.length+critterMaterials.length)%critterMaterials.length;
 const mats=critterMaterials[variant],root=new THREE.Group(),body=new THREE.Group();root.add(body);addContactShadow(root,.34,.42,.76);
 const add=(geo,mat,pos,scale,rot)=>{const m=new THREE.Mesh(geo,mat);m.position.set(pos[0],pos[1],pos[2]);if(scale)m.scale.set(scale[0],scale[1],scale[2]);if(rot)m.rotation.set(rot[0],rot[1],rot[2]);body.add(m);return m};
 add(critterGeometries.body,mats.body,[0,.38,0],[1,.88,1.12]);
 add(critterGeometries.belly,mats.belly,[0,.31,.275],[.72,.7,.28]);
 add(critterGeometries.tail,mats.body,[0,.35,-.34],[.75,.78,.82]);
 const ears=[];
 for(const side of [-1,1]){
  const ear=add(critterGeometries.ear,mats.body,[side*.17,.67,.015],[variant===1?.88:1,variant===2?1.18:1,1],[0,0,side*-.16]);ears.push(ear);
  add(critterGeometries.ear,mats.inner,[side*.17,.675,.064],[.47,.6,.56],[0,0,side*-.16]);
  add(critterGeometries.eye,critterEyeMaterial,[side*.105,.47,.285],[1,1,1]);
  add(critterGeometries.glint,critterGlintMaterial,[side*.105-.012,.486,.322],[1,1,1]);
 }
 // 鼻の周りに柔らかなマズル（顔のふくらみ）を作り、その表面に元の大きさの鼻を載せる。
 // ふくらみは体に大部分を埋め込んで前面だけを見せ、鼻はふくらみに半分ほど埋めて接続感を出す。
 add(critterGeometries.muzzle,mats.muzzle,[0,.405,.319],[.88,.62,.82]);
 add(critterGeometries.nose,critterNoseMaterial,[0,.405,.389],[1,1,1]);
 const legs=[];
 for(const x of [-1,1])for(const z of [-1,1])legs.push(add(critterGeometries.foot,mats.body,[x*.18,.115,z*.17],[1,1,1]));
 root.userData.body=body;root.userData.legs=legs;root.userData.ears=ears;root.userData.phase=Math.random()*Math.PI*2;root.userData.mode='wander';root.userData.critterType=variant;
 return root;
}
function syncAmbientCreatures(list){
 const items=Array.isArray(list)?list.slice(0,6):[],seen=new Set();
 for(const item of items){
  if(!item||typeof item.id!=='string'||item.id.length>24||!Array.isArray(item.p)||item.p.length<3)continue;
  const vals=item.p.map(Number);if(!vals.every(Number.isFinite))continue;
  const pos=new THREE.Vector3(Math.max(.5,Math.min(W-.5,vals[0])),Math.max(1,Math.min(H,vals[1])),Math.max(.5,Math.min(D-.5,vals[2])));
  const yaw=Number.isFinite(Number(item.yaw))?Number(item.yaw):0;
  let c=ambientCritters.get(item.id);
  if(!c){
   const group=makeAmbientCritter(item.type);group.position.copy(pos);group.rotation.y=yaw;scene.add(group);
   c={group,target:pos.clone(),targetYaw:yaw,mode:'wander',fresh:true,nextCallAt:performance.now()+2600+Math.random()*6200,callPulseUntil:0};ambientCritters.set(item.id,c);
  }
  c.target.copy(pos);c.targetYaw=yaw;
  c.mode=['wander','idle','look','flee'].includes(item.mode)?item.mode:'wander';c.group.userData.mode=c.mode;
  if(c.fresh){c.group.position.copy(c.target);c.group.rotation.y=c.targetYaw;c.fresh=false}
  seen.add(item.id);
 }
 for(const [id,c] of ambientCritters){if(!seen.has(id)){scene.remove(c.group);ambientCritters.delete(id)}}
}
function updateAmbientCritters(dt,now){
 for(const c of ambientCritters.values()){
  const k=1-Math.exp(-dt*(c.mode==='flee'?8:4.4));
  c.group.position.lerp(c.target,k);
  let da=Math.atan2(Math.sin(c.targetYaw-c.group.rotation.y),Math.cos(c.targetYaw-c.group.rotation.y));
  c.group.rotation.y+=da*(1-Math.exp(-dt*7));
  const phase=c.group.userData.phase,body=c.group.userData.body,legs=c.group.userData.legs,ears=c.group.userData.ears;
  const calling=now<(c.callPulseUntil||0);
  body.position.y=Math.sin(now*.0052+phase)*(c.mode==='flee'?.055:c.mode==='look'?.009:.022)+(calling?Math.sin((now-(c.callPulseUntil-430))*.025)*.045:0);
  body.rotation.z=c.mode==='flee'?Math.sin(now*.017+phase)*.075:Math.sin(now*.002+phase)*.018;
  for(let i=0;i<legs.length;i++)legs[i].rotation.x=c.mode==='flee'?Math.sin(now*.022+phase+i*Math.PI*.5)*.32:Math.sin(now*.005+phase+i*Math.PI*.5)*.06;
  if(ears){for(let i=0;i<ears.length;i++){const earTarget=calling?Math.sin((now-(c.callPulseUntil-430))*.032+i*Math.PI)*.10:0;ears[i].rotation.x+=(earTarget-ears[i].rotation.x)*(1-Math.exp(-dt*12))}}
  // 各個体がばらばらの間隔で鳴く。近くにいるときだけ、3D定位付きの短い固有コールを再生する。
  if(now>=(c.nextCallAt||0)){
   const distance=cam.position.distanceTo(c.group.position);
   if(distance<=20&&Snd.vol>.005&&now-ambientCritterLastCallAt>=1650){
    const played=Snd.playAmbientCritterCall(c.group.userData.critterType,misCreatureAudioPosition(c.group.position),c.mode==='flee');
    if(played){ambientCritterLastCallAt=now;c.callPulseUntil=now+480;c.nextCallAt=now+9800+Math.random()*10500}
    else c.nextCallAt=now+2300+Math.random()*2800;
   }else if(distance<=20&&now-ambientCritterLastCallAt<1650){
    c.nextCallAt=now+500+Math.random()*800;
   }else{
    // 遠くにいる個体は低負荷の間隔で再判定し、近づいた瞬間に連続で鳴かないようにする。
    c.nextCallAt=now+(distance>17?2400+Math.random()*3400:1800+Math.random()*2500);
   }
  }
 }
}

/* ---- 洞窟限定の敵「胞子吐き」 ---- */
const sporeFx={creature:null,shots:new Map(),clouds:new Map(),slowUntil:0,lastPokeAt:-Infinity,lastSlowToastAt:0,lastPokeToastAt:0};
function disposeSporeObject(obj){
 if(!obj)return;const geos=new Set(),mats=new Set();obj.traverse(n=>{if(n.geometry)geos.add(n.geometry);if(n.material){if(Array.isArray(n.material))n.material.forEach(m=>mats.add(m));else mats.add(n.material)}});
 geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());if(obj.parent)obj.parent.remove(obj);
}
function sporeMat(color,opts={}){return new THREE.MeshBasicMaterial({color,transparent:!!opts.transparent,opacity:opts.opacity==null?1:opts.opacity,depthWrite:opts.depthWrite!==false,side:opts.side||THREE.FrontSide});}
function makeSporeShooterModel(){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);
 const mats={body:sporeMat(0x85836f),bodyLight:sporeMat(0xa5a087),root:sporeMat(0x625f4d),cap:sporeMat(0x68764a,{side:THREE.DoubleSide}),under:sporeMat(0x3b4430),spot:sporeMat(0xc2b88e),eye:sporeMat(0xc9ff83),pupil:sporeMat(0x20291c),sac:sporeMat(0x526a3c)};
 const mesh=(geo,mat,pos,scale,rot)=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);if(scale)m.scale.set(...scale);if(rot)m.rotation.set(...rot);body.add(m);return m};
 const base=mesh(new THREE.DodecahedronGeometry(.32,0),mats.body,[0,.31,0],[1,.78,1.05]);
 const trunk=mesh(new THREE.CylinderGeometry(.20,.29,.56,7,1),mats.bodyLight,[0,.66,.015],[1,1,1],[0,0,-.07]);
 const legs=[];
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2+.25,x=Math.sin(a)*.23,z=Math.cos(a)*.23;
  const leg=mesh(new THREE.ConeGeometry(.12,.27,5),mats.root,[x,.12,z],[1,.72,1],[Math.cos(a)*.1,0,-Math.sin(a)*.42]);
  leg.userData.baseRotation={x:leg.rotation.x,y:leg.rotation.y,z:leg.rotation.z};legs.push(leg);
 }
 mesh(new THREE.DodecahedronGeometry(.13,0),mats.sac,[0,.69,.24],[1.15,.86,1]);
 // 低ポリで左右非対称な傘。上半球と厚みのある裏側を分け、横から見てもキノコの傘に見えるようにする。
 const cap=mesh(new THREE.SphereGeometry(.62,9,5,0,Math.PI*2,0,Math.PI*.59),mats.cap,[0,1.16,0],[1.12,.62,1],[0,0,-.12]);
 // 傘の縁まで届く薄い裏面を作り、下から見た際に外周が抜けないようにする。
 // 上面はドームに少し重ね、側面に細い厚みを残す。外形のシルエットは変えない。
 mesh(new THREE.CylinderGeometry(.62,.65,.07,9,1),mats.under,[0,1.075,.005],[1.02,1,.94],[0,0,-.12]);
 // 裏面の放射状のひだ。単一 LineSegments にまとめて描画負荷を抑える。
 const gillPoints=[];
 for(let i=0;i<12;i++){
  const a=i*Math.PI*2/12,ca=Math.cos(a),sa=Math.sin(a);
  gillPoints.push(ca*.12,0,sa*.12,ca*.585,0,sa*.585);
 }
 const gillGeo=new THREE.BufferGeometry();gillGeo.setAttribute('position',new THREE.Float32BufferAttribute(gillPoints,3));
 const gills=new THREE.LineSegments(gillGeo,new THREE.LineBasicMaterial({color:0x566345}));
 gills.position.set(0,1.038,.005);gills.rotation.z=-.12;body.add(gills);
 // 傘の斑点は上側に沈め、平面ステッカーのように浮かせない。
 const spots=[[-.27,1.39,-.12,.075],[.13,1.48,-.04,.065],[.35,1.34,-.08,.055],[-.02,1.35,.24,.048],[-.36,1.29,.12,.05]];
 for(const [x,y,z,r] of spots)mesh(new THREE.DodecahedronGeometry(r,0),mats.spot,[x,y,z],[1,.46,1],[.1,.2,.1]);
 // 正面(-Z)の小さな目。緑の光点は控えめで、体全体が蛍光色にならないようにする。
 for(const side of [-1,1]){
  mesh(new THREE.SphereGeometry(.061,7,5),mats.under,[side*.13,.79,-.276],[1,.78,.45]);
  mesh(new THREE.SphereGeometry(.027,7,5),mats.eye,[side*.13,.795,-.304],[1,.9,.4]);
  mesh(new THREE.SphereGeometry(.012,6,4),mats.pupil,[side*.134,.795,-.311],[1,1,.5]);
 }
 mesh(new THREE.BoxGeometry(.12,.025,.024),mats.under,[0,.68,-.29],[1,1,1],[0,0,.02]);
 root.userData.body=body;root.userData.cap=cap;root.userData.trunk=trunk;root.userData.base=base;root.userData.legs=legs;root.userData.phase=Math.random()*Math.PI*2;
 return root;
}
function makeSporeProjectile(){
 const root=new THREE.Group();
 const halo=new THREE.Mesh(new THREE.SphereGeometry(.19,8,5),sporeMat(0x93d65e,{transparent:true,opacity:.28,depthWrite:false}));root.add(halo);
 const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.105,1),sporeMat(0xc5f17a));root.add(core);
 const fleck=new THREE.Mesh(new THREE.OctahedronGeometry(.045,0),sporeMat(0x4d722b));fleck.position.set(.08,.06,.03);root.add(fleck);
 root.userData.halo=halo;return root;
}
function makeSporeCloud(){
 const root=new THREE.Group(),puffMat=sporeMat(0x9bbd5a,{transparent:true,opacity:.22,depthWrite:false}),darkMat=sporeMat(0x657d3e,{transparent:true,opacity:.19,depthWrite:false});
 const puff=(x,y,z,s)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.42,7,5),puffMat);m.position.set(x,y,z);m.scale.set(s[0],s[1],s[2]);root.add(m)};
 puff(0,0,0,[1.12,1.15,1.08]);puff(.45,.10,.02,[.8,.85,.82]);puff(-.43,-.05,.08,[.78,.9,.82]);puff(.02,.32,-.1,[.88,.78,.9]);puff(.12,-.25,-.06,[.82,.8,.84]);
 const core=new THREE.Mesh(new THREE.SphereGeometry(.34,7,5),darkMat);core.scale.set(1,.9,1);root.add(core);
 const motes=[];for(let i=0;i<7;i++){const m=new THREE.Mesh(new THREE.OctahedronGeometry(.035,0),sporeMat(i%2?0xc9e88c:0x68843b,{transparent:true,opacity:.68,depthWrite:false}));m.userData.phase=i*1.71;m.userData.r=.38+(i%3)*.11;root.add(m);motes.push(m)}
 root.userData.motes=motes;return root;
}
function syncSporeState(m){
 m=m&&typeof m==='object'?m:{};const item=m.creature&&typeof m.creature.id==='string'?m.creature:null;
 if(item){
  const p=Array.isArray(item.p)?item.p.map(Number):[];
  if(p.length>=3&&p.every(Number.isFinite)){
   if(!sporeFx.creature){const group=makeSporeShooterModel();scene.add(group);sporeFx.creature={group,target:new THREE.Vector3(...p),targetYaw:Number(item.yaw)||0,hp:Number(item.hp)||0,maxHp:Number(item.maxHp)||3,mode:item.mode||'idle',modeUntil:Number(item.modeUntil)||0,fresh:true};}
   const c=sporeFx.creature;c.target.set(...p);c.targetYaw=Number(item.yaw)||0;c.hp=Math.max(0,Number(item.hp)||0);c.maxHp=Math.max(1,Number(item.maxHp)||3);c.mode=typeof item.mode==='string'?item.mode:'idle';c.modeUntil=Number(item.modeUntil)||0;
   if(c.fresh){c.group.position.copy(c.target);c.group.rotation.y=c.targetYaw;c.fresh=false}
  }
 }else if(sporeFx.creature){disposeSporeObject(sporeFx.creature.group);sporeFx.creature=null;}
 const incomingShots=new Set();
 for(const item of Array.isArray(m.shots)?m.shots.slice(0,4):[]){
  if(!item||typeof item.id!=='string'||!Array.isArray(item.p)||!item.p.map(Number).every(Number.isFinite))continue;
  incomingShots.add(item.id);const p=item.p.map(Number);let s=sporeFx.shots.get(item.id);
  if(!s){const group=makeSporeProjectile();scene.add(group);s={group,target:new THREE.Vector3(...p),bornAt:Number(item.bornAt)||Date.now(),expiresAt:Number(item.expiresAt)||Date.now()+2000};sporeFx.shots.set(item.id,s)}
  s.target.set(...p);s.expiresAt=Number(item.expiresAt)||s.expiresAt;
 }
 for(const [id,s] of sporeFx.shots)if(!incomingShots.has(id)){disposeSporeObject(s.group);sporeFx.shots.delete(id)}
 const incomingClouds=new Set();
 for(const item of Array.isArray(m.clouds)?m.clouds.slice(0,5):[]){
  if(!item||typeof item.id!=='string'||!Array.isArray(item.p)||!item.p.map(Number).every(Number.isFinite))continue;
  incomingClouds.add(item.id);const p=item.p.map(Number);let cloud=sporeFx.clouds.get(item.id);
  if(!cloud){const group=makeSporeCloud();scene.add(group);cloud={group,target:new THREE.Vector3(...p),radius:1.32,bornAt:Number(item.bornAt)||Date.now(),expiresAt:Number(item.expiresAt)||Date.now()+3000,toxic:item.toxic!==false};sporeFx.clouds.set(item.id,cloud)}
  cloud.target.set(...p);cloud.radius=Math.max(.6,Math.min(1.8,Number(item.radius)||1.32));cloud.bornAt=Number(item.bornAt)||cloud.bornAt;cloud.expiresAt=Number(item.expiresAt)||cloud.expiresAt;cloud.toxic=item.toxic!==false;
 }
 for(const [id,c] of sporeFx.clouds)if(!incomingClouds.has(id)){disposeSporeObject(c.group);sporeFx.clouds.delete(id)}
}
function updateSporeShooter(dt,now){
 const c=sporeFx.creature;
 if(c){
  c.group.position.lerp(c.target,1-Math.exp(-dt*13));
  c.group.rotation.y+=Math.atan2(Math.sin(c.targetYaw-c.group.rotation.y),Math.cos(c.targetYaw-c.group.rotation.y))*(1-Math.exp(-dt*12));
  const body=c.group.userData.body,cap=c.group.userData.cap,trunk=c.group.userData.trunk,base=c.group.userData.base,legs=c.group.userData.legs||[],phase=c.group.userData.phase;
  const time=now*.001+phase,aim=c.mode==='aim',spit=c.mode==='spit',hurt=c.mode==='hit',walking=c.mode==='walk';
  const stepWave=Math.sin(time*8.2),walkBob=walking?Math.abs(stepWave)*.035:0;
  body.position.y=Math.sin(time*2.1)*.025+walkBob+(aim?Math.sin(time*10)*.035:0);
  body.rotation.z=(aim?-.06:0)+(walking?stepWave*.035:0)+Math.sin(time*1.3)*.018;
  const pulse=aim?.08*Math.sin(time*11):spit?.20*Math.sin(time*24):0;
  cap.scale.set(1.12*(1+pulse),.62*(1+pulse*.75),1*(1+pulse));
  cap.rotation.z=-.12+(aim?-.05:walking?stepWave*.025:0)+Math.sin(time*1.7)*.025;
  trunk.rotation.x=aim?-.12:spit?.16:walking?Math.sin(time*8.2+1)*.045:0;
  base.rotation.z=hurt?Math.sin(time*25)*.18:walking?stepWave*.055:0;
  for(let i=0;i<legs.length;i++){
   const baseRot=legs[i].userData.baseRotation||{x:0,y:0,z:0},legWave=walking?Math.sin(time*8.2+i*Math.PI*.5)*.075:0;
   legs[i].rotation.set(baseRot.x+legWave,baseRot.y,baseRot.z+legWave*.55);
  }
  c.group.visible=c.mode!=='defeated';
  if(hurt){c.group.scale.setScalar(.96+Math.sin(time*28)*.04)}else c.group.scale.setScalar(1);
 }
 for(const s of sporeFx.shots.values()){
  s.group.position.lerp(s.target,1-Math.exp(-dt*20));
  const t=now*.006;s.group.rotation.set(t*.7,t*1.3,t*.45);
  s.group.userData.halo.scale.setScalar(1+.13*Math.sin(t*2));
 }
 for(const c of sporeFx.clouds.values()){
  c.group.position.lerp(c.target,1-Math.exp(-dt*16));
  const age=Math.max(0,Date.now()-c.bornAt),life=Math.max(1,c.expiresAt-c.bornAt),u=Math.max(0,Math.min(1,age/life));
  const envelope=Math.min(1,u*7,(1-u)*5.5);c.group.scale.setScalar(c.radius*(.72+.28*Math.min(1,u*3)));c.group.visible=envelope>.01;
  const updatedMaterials=new Set();c.group.children.forEach((child,i)=>{if(child.material&&child.material.transparent){const mat=child.material;if(!updatedMaterials.has(mat)){if(mat.userData.baseOpacity==null)mat.userData.baseOpacity=mat.opacity;mat.opacity=mat.userData.baseOpacity*envelope;updatedMaterials.add(mat)}}});
  const motes=c.group.userData.motes||[];for(const mote of motes){const ph=now*.0011+mote.userData.phase;mote.position.set(Math.cos(ph)*mote.userData.r,.22+Math.sin(ph*1.25)*.24,Math.sin(ph)*mote.userData.r);mote.visible=envelope>.18&&c.toxic}
 }
}
function tryPokeSporeShooter(){
 const c=sporeFx.creature;if(!isPen()||cur===0||!c||c.hp<=0||c.mode==='defeated'||!act())return false;
 // 傘・胴体・根元を別々の球として照準判定し、モデルの見えている部分を狙えば攻撃できるようにする。
 // 近接攻撃のクールダウン中も通常の描画／ブロック操作へフォールスルーさせない。
 const base=c.group.position,parts=[
  {y:.34,r:.39},{y:.73,r:.49},{y:1.12,r:.76},{y:1.41,r:.57}
 ];
 let bestEntry=Infinity,found=false;
 for(const part of parts){
  const target=new THREE.Vector3(base.x,base.y+part.y,base.z);
  const along=target.clone().sub(cam.position).dot(rd);
  if(along<=0||along>3.05)continue;
  const closest=cam.position.clone().addScaledVector(rd,along);
  const perp=closest.distanceTo(target);
  if(perp>part.r)continue;
  const entry=along-Math.sqrt(Math.max(0,part.r*part.r-perp*perp));
  // 先にブロックへ当たる場合だけ攻撃対象から除外する。
  if(hit&&hit.t<entry-.10)continue;
  if(entry<bestEntry){bestEntry=entry;found=true;}
 }
 if(!found)return false;
 const now=performance.now();
 if(now-sporeFx.lastPokeAt<1050)return true;
 sporeFx.lastPokeAt=now;
 // ペンで突く行為だけを送る。消しゴム(cur===0)とブロック選択時はここへ入らない。
 // カーソル描画モードでも、実際の照準レイの方向をサーバーへ伝える。
 const aimYaw=Math.atan2(-rd.x,-rd.z);
 Net.send({t:'spore-poke',aimYaw,tool:'pen',color:cur});
 return true;
}

/* ---- 個性を持つ別種「ひょっこりん」: 既存の3匹とは別モデル・別アニメーション ---- */
let mischiefCreature = null;
const mischiefGeo = {
 core: new THREE.DodecahedronGeometry(.255, 0),
 aura: new THREE.SphereGeometry(.315, 8, 6),
 belly: new THREE.SphereGeometry(.105, 7, 5),
 eye: new THREE.SphereGeometry(.037, 6, 4),
 pupil: new THREE.SphereGeometry(.019, 5, 4),
 mouth: new THREE.SphereGeometry(.032, 6, 4),
 antenna: new THREE.CylinderGeometry(.022, .032, .19, 5),
 tip: new THREE.OctahedronGeometry(.065, 0),
 ring: new THREE.TorusGeometry(.31, .014, 4, 16),
 sparkle: new THREE.OctahedronGeometry(.075, 0),
};
const mischiefMat = {
 core: new THREE.MeshBasicMaterial({color:0x54d9ce}),
 aura: new THREE.MeshBasicMaterial({color:0x6df5df,transparent:true,opacity:.2,depthWrite:false}),
 belly: new THREE.MeshBasicMaterial({color:0xe6fff0}),
 eye: new THREE.MeshBasicMaterial({color:0x162a3d}),
 pupil: new THREE.MeshBasicMaterial({color:0xffffff}),
 mouth: new THREE.MeshBasicMaterial({color:0x15303a}),
 antenna: new THREE.MeshBasicMaterial({color:0x247b91}),
 tip: new THREE.MeshBasicMaterial({color:0xffd96a}),
 ring: new THREE.MeshBasicMaterial({color:0x80f7e8,transparent:true,opacity:.72}),
 sparkle: new THREE.MeshBasicMaterial({color:0xffe58a}),
};
function makeMischiefCreatureModel(){
 const root=new THREE.Group(),bob=new THREE.Group();root.add(bob);addContactShadow(root,.29,.34,.48);
 const mesh=(geo,mat,parent,pos,scale,rot)=>{const m=new THREE.Mesh(geo,mat);m.position.set(pos[0],pos[1],pos[2]);if(scale)m.scale.set(scale[0],scale[1],scale[2]);if(rot)m.rotation.set(rot[0],rot[1],rot[2]);parent.add(m);return m};
 mesh(mischiefGeo.aura,mischiefMat.aura,bob,[0,.47,0],[1,1.02,1],[0,0,0]);
 const core=mesh(mischiefGeo.core,mischiefMat.core,bob,[0,.47,0],[.92,1.08,.9],[0,0,.15]);
 mesh(mischiefGeo.belly,mischiefMat.belly,bob,[0,.405,.205],[1,.92,.35],[0,0,0]);
 // 口はお腹の中央ではなく、両目のすぐ下に配置。瞳よりわずかに奥にして顔になじませる。
 const mouth=mesh(mischiefGeo.mouth,mischiefMat.mouth,bob,[0,.486,.253],[.9,.34,.42],[0,0,0]);
 for(const side of [-1,1]){
  mesh(mischiefGeo.eye,mischiefMat.eye,bob,[side*.077,.535,.22],[1,1,1],[0,0,0]);
  mesh(mischiefGeo.pupil,mischiefMat.pupil,bob,[side*.077-.008,.542,.25],[1,1,1],[0,0,0]);
 }
 mesh(mischiefGeo.antenna,mischiefMat.antenna,bob,[0,.72,0],[1,1,1],[0,0,-.16]);
 const tip=mesh(mischiefGeo.tip,mischiefMat.tip,bob,[.03,.83,0],[1,1,1],[0,0,.1]);
 const orbit=new THREE.Group();root.add(orbit);
 const ring=mesh(mischiefGeo.ring,mischiefMat.ring,orbit,[0,.26,0],[1,1,1],[Math.PI/2,0,0]);
 const sparkle=mesh(mischiefGeo.sparkle,mischiefMat.sparkle,root,[.36,.62,0],[1,1,1],[0,0,0]);
 root.userData.bob=bob;root.userData.core=core;root.userData.tip=tip;root.userData.ring=ring;root.userData.orbit=orbit;root.userData.sparkle=sparkle;root.userData.mouth=mouth;root.userData.phase=Math.random()*Math.PI*2;
 return root;
}
function misCreatureAudioPosition(pos){
 // Web AudioのPannerNodeに渡すワールド座標。AudioListenerはメインループでカメラへ追従する。
 try{const rel=pos.clone().sub(cam.position),local=rel.clone().applyQuaternion(cam.quaternion.clone().invert());return {x:pos.x,y:pos.y,z:pos.z,distance:rel.length(),pan:local.x/Math.max(1,Math.hypot(local.x,local.z))}}
 catch(e){return {x:cam.position.x,y:cam.position.y,z:cam.position.z-3,distance:3,pan:0}}
}
function syncMischiefCreature(item){
 if(!item||item.id!=='mischief-1'||!Array.isArray(item.p)||item.p.length<3){
  if(mischiefCreature){scene.remove(mischiefCreature.group);mischiefCreature=null}return;
 }
 const vals=item.p.map(Number);if(!vals.every(Number.isFinite))return;
 const pos=new THREE.Vector3(Math.max(.5,Math.min(W-.5,vals[0])),Math.max(1,Math.min(H,vals[1])),Math.max(.5,Math.min(D-.5,vals[2])));
 const yaw=Number.isFinite(Number(item.yaw))?Number(item.yaw):0;
 if(!mischiefCreature){
  const group=makeMischiefCreatureModel();group.position.copy(pos);group.rotation.y=yaw;scene.add(group);
  mischiefCreature={group,target:pos.clone(),targetYaw:yaw,mode:'peek',fresh:true,speech:'',speechId:0,speechUntil:0,vocalUntil:0};
 }
 const wasNotVisible=['hidden','calling'].includes(mischiefCreature.mode);
 mischiefCreature.target.copy(pos);mischiefCreature.targetYaw=yaw;
 const nextMode=['peek','sneak','dash','hidden','calling','greet'].includes(item.mode)?item.mode:'peek';
 const incomingSpeechId=Number.isSafeInteger(Number(item.speechId))?Number(item.speechId):0;
 const hasVocalCue=item.voiceCue===true || (typeof item.speech==='string' && !!item.speech);
 if(incomingSpeechId!==mischiefCreature.speechId && hasVocalCue){
  mischiefCreature.speechId=incomingSpeechId;
  // セリフ本文は使わず、鳴き声の再生中だけ口と体を動かす。吹き出しは出さない。
  mischiefCreature.speech='';mischiefCreature.speechUntil=0;
  mischiefCreature.vocalUntil=performance.now()+(nextMode==='calling'?760:690);
  if(started && cam.position.distanceTo(pos)<=22) Snd.playMischiefVocalization(misCreatureAudioPosition(pos),nextMode==='calling',nextMode==='dash');
 }else if(!item.speech && performance.now()>=mischiefCreature.speechUntil){mischiefCreature.speech=''}
 if(wasNotVisible && !['hidden','calling'].includes(nextMode)){mischiefCreature.group.position.copy(pos);mischiefCreature.group.rotation.y=yaw}
 mischiefCreature.mode=nextMode;
 mischiefCreature.group.visible=!['hidden','calling'].includes(mischiefCreature.mode);
 if(mischiefCreature.fresh){mischiefCreature.group.position.copy(pos);mischiefCreature.group.rotation.y=yaw;mischiefCreature.fresh=false}
}
function updateMischiefSpeech(now){
 // ひょっこりんは言葉・吹き出しを使わず、鳴き声と短い口の動きで気持ちを表す。
 const el=document.getElementById('creatureSpeech');if(el)el.hidden=true;
}

function updateMischiefCreature(dt,now){
 const c=mischiefCreature;if(!c)return;
 const root=c.group,k=1-Math.exp(-dt*(c.mode==='dash'?9:c.mode==='sneak'?3.4:2.8));
 root.position.lerp(c.target,k);
 const da=Math.atan2(Math.sin(c.targetYaw-root.rotation.y),Math.cos(c.targetYaw-root.rotation.y));root.rotation.y+=da*(1-Math.exp(-dt*5.5));
 const phase=root.userData.phase,bob=root.userData.bob;
 const vocalizing=now<(c.vocalUntil||0);
 bob.position.y=Math.sin(now*.0042+phase)*(c.mode==='dash'?.15:.075)+(vocalizing?Math.abs(Math.sin(now*.022+phase))*.055:0);
 bob.rotation.y+=dt*(c.mode==='dash'?5.4:c.mode==='sneak'?1.4:.42);
 root.userData.core.rotation.y+=dt*(c.mode==='dash'?3.2:.7);
 root.userData.tip.rotation.z=Math.sin(now*.006+phase)*.22;
 root.userData.mouth.scale.y=vocalizing?0.45+Math.abs(Math.sin(now*.025))*.5:.34;
 root.userData.orbit.rotation.y+=dt*(c.mode==='dash'?3.8:1.15);
 const a=now*.0018+phase;root.userData.sparkle.position.set(Math.cos(a)*.36,.55+Math.sin(a*1.35)*.09,Math.sin(a)*.36);
 root.userData.sparkle.rotation.x+=dt*2.3;root.userData.sparkle.rotation.y+=dt*3.1;
}

/* ---- ポストン: ひらめき便を届ける、ちょっとドジな郵便生物 ---- */
let forestResident=null;
const forestResidentGeo={
 body:new THREE.DodecahedronGeometry(.255,0),head:new THREE.SphereGeometry(.27,9,7),face:new THREE.SphereGeometry(.205,9,6),
 ear:new THREE.ConeGeometry(.078,.29,5),cap:new THREE.SphereGeometry(.225,8,5),bill:new THREE.BoxGeometry(.31,.055,.16),badge:new THREE.OctahedronGeometry(.065,0),
 eyeWhite:new THREE.SphereGeometry(.061,7,5),pupil:new THREE.SphereGeometry(.032,6,4),spark:new THREE.SphereGeometry(.012,5,3),
 snout:new THREE.SphereGeometry(.065,6,5),mouth:new THREE.SphereGeometry(.034,6,4),cheek:new THREE.SphereGeometry(.035,6,4),
 arm:new THREE.CylinderGeometry(.047,.055,.26,5),mitten:new THREE.SphereGeometry(.065,6,4),foot:new THREE.BoxGeometry(.13,.105,.2),
 belly:new THREE.SphereGeometry(.18,8,6),bag:new THREE.BoxGeometry(.27,.29,.16),bagFlap:new THREE.BoxGeometry(.29,.075,.18),letter:new THREE.BoxGeometry(.145,.18,.025),stamp:new THREE.BoxGeometry(.045,.045,.013),
 tail:new THREE.SphereGeometry(.105,7,5),leg:new THREE.CylinderGeometry(.04,.045,.12,5)
};
const forestResidentMat={
 body:new THREE.MeshBasicMaterial({color:0xef8b4c}),head:new THREE.MeshBasicMaterial({color:0xffd9a0}),face:new THREE.MeshBasicMaterial({color:0xfff0d0}),
 ear:new THREE.MeshBasicMaterial({color:0xef8b4c}),earInner:new THREE.MeshBasicMaterial({color:0xe96d78}),cap:new THREE.MeshBasicMaterial({color:0x2b7895}),bill:new THREE.MeshBasicMaterial({color:0x225d78}),badge:new THREE.MeshBasicMaterial({color:0xffd34f}),
 eyeWhite:new THREE.MeshBasicMaterial({color:0xffffff}),pupil:new THREE.MeshBasicMaterial({color:0x26333c}),spark:new THREE.MeshBasicMaterial({color:0xffffff}),
 snout:new THREE.MeshBasicMaterial({color:0xf5a66d}),mouth:new THREE.MeshBasicMaterial({color:0x663c40}),cheek:new THREE.MeshBasicMaterial({color:0xf58b91}),
 arm:new THREE.MeshBasicMaterial({color:0xef8b4c}),mitten:new THREE.MeshBasicMaterial({color:0xffd9a0}),foot:new THREE.MeshBasicMaterial({color:0x2c4e61}),
 belly:new THREE.MeshBasicMaterial({color:0xffe9c5}),bag:new THREE.MeshBasicMaterial({color:0x277f78}),bagFlap:new THREE.MeshBasicMaterial({color:0x3a9b90}),letter:new THREE.MeshBasicMaterial({color:0xfff5d9}),stamp:new THREE.MeshBasicMaterial({color:0xdf5d65}),tail:new THREE.MeshBasicMaterial({color:0xffd9a0}),leg:new THREE.MeshBasicMaterial({color:0xb86442})
};
function makeForestResidentModel(){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);addContactShadow(root,.43,.37,.80);
 const mesh=(geo,mat,pos,scale,rot,parent=body)=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);if(scale)m.scale.set(...scale);if(rot)m.rotation.set(...rot);parent.add(m);return m};
 // くすんだ人型ではなく、手紙袋を背負った明るいオレンジ色の小さな配達生物。
 const torso=mesh(forestResidentGeo.body,forestResidentMat.body,[0,.39,0],[1,1.05,.92]);
 const belly=mesh(forestResidentGeo.belly,forestResidentMat.belly,[0,.39,.193],[1,.95,.34]);
 const tail=mesh(forestResidentGeo.tail,forestResidentMat.tail,[0,.36,-.25],[1,.88,1]);
 const head=mesh(forestResidentGeo.head,forestResidentMat.head,[0,.75,.045],[1.02,1,.92]);
 mesh(forestResidentGeo.face,forestResidentMat.face,[0,.715,.25],[1,.79,.3]);
 // 片耳はピンと立ち、もう片耳は横へ垂れる。遠目でも分かるシルエット。
 const earL=mesh(forestResidentGeo.ear,forestResidentMat.ear,[-.17,1.015,.015],[1,1,1],[0,0,.23]);
 const earR=mesh(forestResidentGeo.ear,forestResidentMat.ear,[.18,.99,.015],[1,.78,1],[0,0,-.72]);
 mesh(forestResidentGeo.ear,forestResidentMat.earInner,[-.17,1.01,.067],[.48,.7,.35],[0,0,.23]);
 mesh(forestResidentGeo.ear,forestResidentMat.earInner,[.18,.99,.067],[.48,.58,.35],[0,0,-.72]);
 // 郵便帽子と金色の八面体バッジ。
 mesh(forestResidentGeo.cap,forestResidentMat.cap,[0,1.005,.025],[1,.43,.9]);
 mesh(forestResidentGeo.bill,forestResidentMat.bill,[0,.984,.18]);
 mesh(forestResidentGeo.badge,forestResidentMat.badge,[0,1.015,.275],[.92,1.12,.6],[0,0,Math.PI/4]);
 // 大きく表情の分かる目、ハイライト、ほっぺ。
 for(const side of [-1,1]){
  mesh(forestResidentGeo.eyeWhite,forestResidentMat.eyeWhite,[side*.098,.755,.291],[1.03,1.15,.5]);
  mesh(forestResidentGeo.pupil,forestResidentMat.pupil,[side*.09+.012,.751,.322],[1,1.08,.5]);
  mesh(forestResidentGeo.spark,forestResidentMat.spark,[side*.09+.004,.773,.34]);
  mesh(forestResidentGeo.cheek,forestResidentMat.cheek,[side*.157,.674,.285],[1.15,.72,.35]);
 }
 mesh(forestResidentGeo.snout,forestResidentMat.snout,[0,.682,.314],[.82,.65,.55]);
 const mouth=mesh(forestResidentGeo.mouth,forestResidentMat.mouth,[0,.619,.316],[.7,.32,.3]);
 // 大きな配達バッグ。前の封筒と赤い消印がキャラクターの役割を伝える。
 const bag=mesh(forestResidentGeo.bag,forestResidentMat.bag,[-.225,.435,.018],[1,1,1],[0,0,.08]);
 mesh(forestResidentGeo.bagFlap,forestResidentMat.bagFlap,[-.225,.57,.047],[1,1,1],[0,0,.08]);
 mesh(forestResidentGeo.letter,forestResidentMat.letter,[-.225,.435,.155],[1,1,1],[0,0,.08]);
 mesh(forestResidentGeo.stamp,forestResidentMat.stamp,[-.184,.466,.177]);
 // 肩の付け根を中心に腕と手袋を親子付けし、手が腕から離れないようにする。
 // 配達バッグ側の腕は少し前へ出して、手袋がバッグに埋もれないようにする。
 const arms=[];for(const side of [-1,1]){
  const pivot=new THREE.Group();pivot.position.set(side*.225,.56,side<0?.10:.04);pivot.rotation.z=side*.38;body.add(pivot);
  mesh(forestResidentGeo.arm,forestResidentMat.arm,[0,-.13,0],[1,1,1],null,pivot);
  mesh(forestResidentGeo.mitten,forestResidentMat.mitten,[0,-.267,.006],[1,1,1],null,pivot);
  pivot.userData.baseZ=side*.38;arms.push(pivot);
 }
 const legs=[];for(const side of [-1,1]){const legPivot=new THREE.Group();legPivot.position.set(side*.105,.135,.015);body.add(legPivot);mesh(forestResidentGeo.leg,forestResidentMat.leg,[0,0,0],null,null,legPivot);legs.push(legPivot)}
 const feet=[];for(const side of [-1,1]){const footPivot=new THREE.Group();footPivot.position.set(side*.12,.075,.06);body.add(footPivot);mesh(forestResidentGeo.foot,forestResidentMat.foot,[0,0,0],null,null,footPivot);feet.push(footPivot)}
 root.userData.body=body;root.userData.head=head;root.userData.mouth=mouth;root.userData.arms=arms;root.userData.legs=legs;root.userData.feet=feet;root.userData.tail=tail;root.userData.bag=bag;root.userData.ears=[earL,earR];root.userData.phase=Math.random()*Math.PI*2;root.userData.mode='idle';
 return root;
}
function syncForestResident(item){
 if(!item||item.id!=='forest-resident-1'||!Array.isArray(item.p)||item.p.length<3){if(forestResident){scene.remove(forestResident.group);forestResident=null}return}
 const vals=item.p.map(Number);if(!vals.every(Number.isFinite))return;
 const pos=new THREE.Vector3(Math.max(.5,Math.min(W-.5,vals[0])),Math.max(1,Math.min(H,vals[1])),Math.max(.5,Math.min(D-.5,vals[2])));
 const yaw=Number.isFinite(Number(item.yaw))?Number(item.yaw):0,epoch=String(item.epoch||'legacy');
 if(forestResident&&forestResident.epoch!==epoch){scene.remove(forestResident.group);forestResident=null}
 const isNew=!forestResident;
 if(isNew){const group=makeForestResidentModel();group.position.copy(pos);group.rotation.y=yaw;scene.add(group);forestResident={group,target:pos.clone(),targetYaw:yaw,epoch,fresh:true,speech:'',speechId:Number(item.speechId)||0,speechUntil:0}}
 const c=forestResident;c.target.copy(pos);c.targetYaw=yaw;c.mode=typeof item.mode==='string'?item.mode:(item.speech?'talking':'idle');
 const incomingSpeechId=Number.isSafeInteger(Number(item.speechId))?Number(item.speechId):0;
 if(!isNew&&incomingSpeechId!==c.speechId&&typeof item.speech==='string'&&item.speech){
  c.speechId=incomingSpeechId;c.speech=item.speech.slice(0,180);c.speechUntil=performance.now()+Math.max(800,Math.min(9000,Number(item.speechMs)||6000));
  const distance=cam.position.distanceTo(pos);if(started&&distance<=13)Snd.speakForestResident(c.speech,misCreatureAudioPosition(pos));
 }else if(!item.speech&&performance.now()>=c.speechUntil)c.speech='';
 if(c.fresh){c.group.position.copy(pos);c.group.rotation.y=yaw;c.fresh=false}
}
function forestResidentDistance(){return forestResident?Math.hypot(me.p.x-forestResident.group.position.x,me.p.z-forestResident.group.position.z):Infinity}
function forestResidentCanTalk(){return !!(started&&!menu&&!typing&&!phonePanelOpen&&forestResident&&forestResidentDistance()<=4.25)}
function requestForestResidentTalk(){
 if(!forestResidentCanTalk())return false;
 if(forestResident.speech&&performance.now()<forestResident.speechUntil){toast('ポストンが次のひらめきを考えてるよ');return true}
 Snd.init();if(!Net.send({t:'forest-talk'}))toast('今はポストンに話しかけられません');return true;
}
function updateForestResidentHint(){
 const el=$('forestResidentHint'),near=forestResidentCanTalk(),busy=!!(forestResident&&forestResident.speech&&performance.now()<forestResident.speechUntil);
 if(el){el.style.display=near&&!phonePanelOpen?'block':'none';el.textContent=near?(busy?'ポストン — 手紙を読んでるよ':(TOUCH?'ポストン — 「話す」をタップ':'ポストン — Fキーで話す')):''}
 const b=$('bAct');if(b&&!($('phoneStationHint')&&$('phoneStationHint').style.display==='block')){if(TOUCH&&near)b.textContent=busy?'話し中':'話す';else if(TOUCH)b.textContent=isPen()?'描く':'置く'}
}
function updateForestResident(dt,now){
 const c=forestResident;if(!c)return;
 c.group.position.lerp(c.target,1-Math.exp(-dt*4.8));
 const da=Math.atan2(Math.sin(c.targetYaw-c.group.rotation.y),Math.cos(c.targetYaw-c.group.rotation.y));c.group.rotation.y+=da*(1-Math.exp(-dt*5.5));
 const phase=c.group.userData.phase,body=c.group.userData.body,head=c.group.userData.head;
 const talking=!!c.speech&&now<c.speechUntil;
 const walking=!talking&&c.mode==='walk';
 const stride=walking?Math.sin(now*.015+phase):0;
 body.position.y=Math.sin(now*.0021+phase)*.018+(talking?Math.sin(now*.018)*.025:0)+(walking?Math.abs(stride)*.024:0);
 head.rotation.z=Math.sin(now*.0017+phase)*.035+(walking?Math.sin(now*.015+phase)*.025:0);
 c.group.userData.mouth.scale.y=talking?.42+Math.abs(Math.sin(now*.025))*1.25:.34;
 const arms=c.group.userData.arms||[];arms.forEach((a,i)=>{a.rotation.x=talking?Math.sin(now*.012+i*1.2)*.10:(walking?Math.sin(now*.015+phase+i*Math.PI)*.09:0);a.rotation.z=(a.userData.baseZ||0)+(talking?Math.sin(now*.012+i*1.2)*.14:(walking?Math.sin(now*.015+phase+i*Math.PI)*.12:Math.sin(now*.002+phase+i)*.035))});
 (c.group.userData.legs||[]).forEach((leg,i)=>{leg.rotation.x=walking?Math.sin(now*.015+phase+i*Math.PI)*.48:Math.sin(now*.0017+phase+i)*.015});
 (c.group.userData.feet||[]).forEach((foot,i)=>{foot.rotation.x=walking?Math.sin(now*.015+phase+i*Math.PI)*.36:0});
 const tail=c.group.userData.tail;if(tail)tail.rotation.x=Math.sin(now*.008+phase)*.35;
 const ears=c.group.userData.ears||[];if(ears.length){ears[0].rotation.z=.23+Math.sin(now*.003+phase)*.04;ears[1].rotation.z=-.72+Math.sin(now*.004+phase)*.08}
 const bag=c.group.userData.bag;if(bag)bag.rotation.z=Math.sin(now*.004+phase)*.025;
}
function placeProjectedSpeechBubble(el,anchor){
 // left/top を投影座標へ直置きすると、画面右端で fixed 要素の shrink-to-fit 幅が残り領域に引っ張られて極端に細くなる。
 // 先に要素を表示して幅・高さを測り、画面内に収まる中心座標へクランプする。
 const rawX=(anchor.x*.5+.5)*innerWidth,rawY=(-anchor.y*.5+.5)*innerHeight,margin=12;
 el.hidden=false;el.style.left=`${rawX}px`;el.style.top=`${rawY}px`;
 const r=el.getBoundingClientRect(),halfW=r.width/2;
 const minX=Math.min(innerWidth/2,margin+halfW),maxX=Math.max(innerWidth/2,innerWidth-margin-halfW);
 const x=Math.max(minX,Math.min(maxX,rawX));
 const minY=Math.min(innerHeight-margin,margin+r.height),y=Math.max(minY,Math.min(innerHeight-margin,rawY));
 el.style.left=`${x}px`;el.style.top=`${y}px`;
}
function updateForestResidentSpeech(now){
 const el=$('forestResidentSpeech'),c=forestResident;if(!el)return;
 if(!started||!c||!c.speech||now>c.speechUntil||cam.position.distanceTo(c.group.position)>13){el.hidden=true;return}
 const anchor=c.group.position.clone();anchor.y+=1.57;anchor.project(cam);
 if(anchor.z< -1||anchor.z>1||Math.abs(anchor.x)>1||Math.abs(anchor.y)>1){el.hidden=true;return}
 el.classList.toggle('is-short',Array.from(c.speech.trim()).length<=9);el.textContent=c.speech;placeProjectedSpeechBubble(el,anchor);
}

/* ---- ホシヨミ：何でも知っていそうで、少し変な物知りフクロウ ---- */
let wiseCharacter=null;
const wiseGeo={
 body:new THREE.SphereGeometry(.31,9,7),head:new THREE.SphereGeometry(.35,10,8),belly:new THREE.SphereGeometry(.235,8,6),
 eye:new THREE.SphereGeometry(.092,8,6),pupil:new THREE.SphereGeometry(.044,7,5),glint:new THREE.SphereGeometry(.016,5,4),
 glasses:new THREE.TorusGeometry(.105,.014,5,16),bridge:new THREE.CylinderGeometry(.012,.012,.085,6),beak:new THREE.ConeGeometry(.052,.105,4),
 brow:new THREE.BoxGeometry(.13,.025,.025),tuft:new THREE.ConeGeometry(.07,.16,5),
 robe:new THREE.SphereGeometry(.27,8,6),wing:new THREE.SphereGeometry(.11,7,5),foot:new THREE.BoxGeometry(.105,.055,.13),
 bookCover:new THREE.BoxGeometry(.205,.035,.235),bookPage:new THREE.BoxGeometry(.186,.016,.215),bookLine:new THREE.BoxGeometry(.115,.004,.008),
 star:new THREE.OctahedronGeometry(.07,0),beard:new THREE.ConeGeometry(.085,.15,5)
};
const wiseMat={
 body:new THREE.MeshBasicMaterial({color:0x625c91}),head:new THREE.MeshBasicMaterial({color:0x9a92c6}),belly:new THREE.MeshBasicMaterial({color:0xe8dfc6}),
 eye:new THREE.MeshBasicMaterial({color:0xfffbf0}),pupil:new THREE.MeshBasicMaterial({color:0x22243c}),glint:new THREE.MeshBasicMaterial({color:0xffffff}),
 glasses:new THREE.MeshBasicMaterial({color:0xe5b85d}),bridge:new THREE.MeshBasicMaterial({color:0xe5b85d}),beak:new THREE.MeshBasicMaterial({color:0xf0a34e}),
 brow:new THREE.MeshBasicMaterial({color:0x454363}),tuft:new THREE.MeshBasicMaterial({color:0x454363}),robe:new THREE.MeshBasicMaterial({color:0x454363}),
 wing:new THREE.MeshBasicMaterial({color:0x8179ad}),foot:new THREE.MeshBasicMaterial({color:0xd18b50}),
 bookCover:new THREE.MeshBasicMaterial({color:0x3c7f7c}),bookPage:new THREE.MeshBasicMaterial({color:0xfff0c9}),bookLine:new THREE.MeshBasicMaterial({color:0xb68b54}),
 star:new THREE.MeshBasicMaterial({color:0xffd85c}),beard:new THREE.MeshBasicMaterial({color:0xd7d7e7})
};
function makeWiseCharacterModel(){
 const root=new THREE.Group(),bodyGroup=new THREE.Group();root.add(bodyGroup);addContactShadow(root,.40,.43,.78);
 const mesh=(geo,mat,pos,scale,rot,parent=bodyGroup)=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);if(scale)m.scale.set(...scale);if(rot)m.rotation.set(...rot);parent.add(m);return m};
 // 本の上にちょこんと座った、丸眼鏡の小さなフクロウ学者。配達員とは明確に異なる紫系シルエット。
 const bottomBook=mesh(wiseGeo.bookCover,wiseMat.bookCover,[0,.075,-.015],[1.55,1,1.14],[0,.04,0]);
 mesh(wiseGeo.bookPage,wiseMat.bookPage,[0,.096,-.004],[1.46,1,1.09]);
 mesh(wiseGeo.bookCover,wiseMat.bookCover,[.02,.132,.005],[1.32,1,.94],[0,-.06,.015]);
 mesh(wiseGeo.bookPage,wiseMat.bookPage,[.02,.151,.018],[1.24,1,.89]);
 mesh(wiseGeo.robe,wiseMat.robe,[0,.45,0],[1.12,1.05,.94]);
 mesh(wiseGeo.body,wiseMat.body,[0,.47,.055],[1.04,1.02,.9]);
 mesh(wiseGeo.belly,wiseMat.belly,[0,.45,.245],[1,.9,.36]);
 const head=mesh(wiseGeo.head,wiseMat.head,[0,.84,.055],[1.06,.96,.92]);
 // 小さな角羽と金色の星。表情は目と丸眼鏡で読み取りやすくする。
 const tuftL=mesh(wiseGeo.tuft,wiseMat.tuft,[-.22,1.145,.025],[.84,1,.9],[0,0,.18]);
 const tuftR=mesh(wiseGeo.tuft,wiseMat.tuft,[.22,1.145,.025],[.84,1,.9],[0,0,-.18]);
 mesh(wiseGeo.beard,wiseMat.beard,[0,.635,.31],[.8,.62,.52],[Math.PI,0,0]);
 const eyes=[],glasses=[];
 for(const side of [-1,1]){
  mesh(wiseGeo.eye,wiseMat.eye,[side*.12,.86,.335],[1,1,.48]);
  mesh(wiseGeo.pupil,wiseMat.pupil,[side*.12,.862,.373],[1,1,.44]);
  mesh(wiseGeo.glint,wiseMat.glint,[side*.105,.882,.392]);
  const ring=mesh(wiseGeo.glasses,wiseMat.glasses,[side*.12,.86,.354],[1,1,1]);glasses.push(ring);
  mesh(wiseGeo.brow,wiseMat.brow,[side*.12,.982,.344],[1,1,1],[0,0,side*.11]);
 }
 mesh(wiseGeo.bridge,wiseMat.bridge,[0,.862,.36],[1,1,1],[0,0,Math.PI/2]);
 const beak=mesh(wiseGeo.beak,wiseMat.beak,[0,.79,.394],[1,1,1],[Math.PI/2,0,0]);
 // 膝の上に開いた本。ページの細線を付けて、遠目でも「本を読む人」と分かるようにする。
 const book=new THREE.Group();bodyGroup.add(book);book.position.set(0,.305,.415);book.rotation.x=-.12;book.rotation.z=.035;book.scale.set(.94,.94,.94);
 mesh(wiseGeo.bookCover,wiseMat.bookCover,[-.105,0,0],[1,1,1],[0,0,-.045],book);
 mesh(wiseGeo.bookCover,wiseMat.bookCover,[.105,0,0],[1,1,1],[0,0,.045],book);
 mesh(wiseGeo.bookPage,wiseMat.bookPage,[-.105,.024,.002],[1,1,1],[0,0,-.045],book);
 mesh(wiseGeo.bookPage,wiseMat.bookPage,[.105,.024,.002],[1,1,1],[0,0,.045],book);
 for(let i=0;i<3;i++){mesh(wiseGeo.bookLine,wiseMat.bookLine,[-.11,.034,.055-i*.045],[1,1,1],[0,0,-.045],book);mesh(wiseGeo.bookLine,wiseMat.bookLine,[.10,.034,.055-i*.045],[1,1,1],[0,0,.045],book)}
 const wings=[];for(const side of [-1,1])wings.push(mesh(wiseGeo.wing,wiseMat.wing,[side*.30,.45,.12],[.6,1.1,.72],[0,0,side*.18]));
 const feet=[];for(const side of [-1,1]){const leg=new THREE.Group();leg.position.set(side*.13,.305,.13);bodyGroup.add(leg);mesh(wiseGeo.foot,wiseMat.foot,[0,-.035,0],null,null,leg);feet.push(leg);}
 const star=mesh(wiseGeo.star,wiseMat.star,[0,1.33,.02]);
 root.userData.bodyGroup=bodyGroup;root.userData.head=head;root.userData.book=book;root.userData.star=star;root.userData.wings=wings;root.userData.feet=feet;root.userData.tufts=[tuftL,tuftR];root.userData.phase=Math.random()*Math.PI*2;root.userData.beak=beak;root.userData.eyes=eyes;root.userData.bottomBook=bottomBook;
 return root;
}
function syncWiseCharacter(item){
 if(!item||item.id!=='wise-character-1'||!Array.isArray(item.p)||item.p.length<3){if(wiseCharacter){scene.remove(wiseCharacter.group);wiseCharacter=null}return}
 const vals=item.p.map(Number);if(!vals.every(Number.isFinite))return;
 const pos=new THREE.Vector3(Math.max(.5,Math.min(W-.5,vals[0])),Math.max(1,Math.min(H,vals[1])),Math.max(.5,Math.min(D-.5,vals[2])));
 const yaw=Number.isFinite(Number(item.yaw))?Number(item.yaw):0,epoch=String(item.epoch||'legacy');
 if(wiseCharacter&&wiseCharacter.epoch!==epoch){scene.remove(wiseCharacter.group);wiseCharacter=null}
 const isNew=!wiseCharacter;
 if(isNew){const group=makeWiseCharacterModel();group.position.copy(pos);group.rotation.y=yaw;scene.add(group);const initialSpeech=typeof item.speech==='string'?item.speech.slice(0,180):'';wiseCharacter={group,target:pos.clone(),targetYaw:yaw,epoch,fresh:true,speech:initialSpeech,speechId:Number(item.speechId)||0,speechUntil:initialSpeech?performance.now()+Math.max(800,Math.min(9500,Number(item.speechMs)||5000)):0}}
 const c=wiseCharacter;c.target.copy(pos);c.targetYaw=yaw;
 const incomingSpeechId=Number.isSafeInteger(Number(item.speechId))?Number(item.speechId):0;
 if(!isNew&&incomingSpeechId!==c.speechId&&typeof item.speech==='string'&&item.speech){
  c.speechId=incomingSpeechId;c.speech=item.speech.slice(0,180);c.speechUntil=performance.now()+Math.max(800,Math.min(9500,Number(item.speechMs)||5000));
  const distance=cam.position.distanceTo(pos);if(started&&distance<=14)Snd.speakWiseCharacter(c.speech,misCreatureAudioPosition(pos));
 }else if(!item.speech&&performance.now()>=c.speechUntil)c.speech='';
 if(c.fresh){c.group.position.copy(pos);c.group.rotation.y=yaw;c.fresh=false}
}
function wiseCharacterDistance(){return wiseCharacter?Math.hypot(me.p.x-wiseCharacter.group.position.x,me.p.z-wiseCharacter.group.position.z):Infinity}
function wiseCharacterCanTalk(){return !!(started&&!menu&&!typing&&!phonePanelOpen&&wiseCharacter&&wiseCharacterDistance()<=4.5)}
function requestWiseCharacterTalk(){
 if(!wiseCharacterCanTalk())return false;
 if(wiseCharacter.speech&&performance.now()<wiseCharacter.speechUntil){toast('ホシヨミはまだ考え中じゃ');return true}
 Snd.init();if(!Net.send({t:'wise-talk'}))toast('接続中は話しかけられません');return true;
}
function updateWiseCharacterHint(){
 const el=$('wiseCharacterHint'),near=wiseCharacterCanTalk(),busy=!!(wiseCharacter&&wiseCharacter.speech&&performance.now()<wiseCharacter.speechUntil);
 if(el){el.style.display=near&&!phonePanelOpen?'block':'none';el.textContent=near?(busy?'ホシヨミ — 考え中……':(TOUCH?'ホシヨミ — 「聞く」をタップ':'ホシヨミ — Fキーで話す')):''}
 const phone=$('phoneStationHint'),postonNear=typeof forestResidentCanTalk==='function'&&forestResidentCanTalk();
 const b=$('bAct');if(b&&!(phone&&phone.style.display==='block')&&!postonNear&&TOUCH&&near)b.textContent=busy?'考え中':'聞く';
}
// v20.86: Show exactly one compact prompt on desktop. Touch devices keep their contextual action button.
function updateInteractPrompt(){
 const el=$('interactPrompt'),label=$('interactPromptAction');if(!el||!label)return;
 let action='';
 const activeCall=!!(phoneHauntCall&&Date.now()<phoneHauntCall.expiresAt&&!phoneHauntCall.answerPending);
 const canShow=started&&!TOUCH&&!menu&&!typing&&!phonePanelOpen&&!isBlkPickOpen()&&!activeCall;
 if(canShow){
  if(hit&&isPhoneStationBlock(hit.x,hit.y,hit.z)){
   const ringing=!!(phoneHauntCall&&Date.now()<phoneHauntCall.expiresAt&&!phoneHauntCall.answerPending);
   const pending=!!(phoneHauntCall&&phoneHauntCall.answerPending&&Date.now()<phoneHauntCall.expiresAt);
   if(!pending)action=ringing?'受話':'遊ぶ';
  }else if(forestResidentCanTalk()){
   const busy=!!(forestResident&&forestResident.speech&&performance.now()<forestResident.speechUntil);
   if(!busy)action='話す';
  }else if(wiseCharacterCanTalk()){
   const busy=!!(wiseCharacter&&wiseCharacter.speech&&performance.now()<wiseCharacter.speechUntil);
   if(!busy)action='聞く';
  }
 }
 label.textContent=action;el.hidden=!action;
}
function updateWiseCharacter(dt,now){
 const c=wiseCharacter;if(!c)return;
 c.group.position.lerp(c.target,1-Math.exp(-dt*4.8));
 const da=Math.atan2(Math.sin(c.targetYaw-c.group.rotation.y),Math.cos(c.targetYaw-c.group.rotation.y));c.group.rotation.y+=da*(1-Math.exp(-dt*5.2));
 const phase=c.group.userData.phase,talking=!!c.speech&&now<c.speechUntil;
 const walking=!talking&&Math.hypot(c.target.x-c.group.position.x,c.target.z-c.group.position.z)>.13;
 c.group.userData.bodyGroup.position.y=Math.sin(now*.0017+phase)*.012+(talking?Math.sin(now*.014)*.009:(walking?Math.abs(Math.sin(now*.012+phase))*.018:0));
 c.group.userData.head.rotation.z=Math.sin(now*.0011+phase)*.025+(talking?Math.sin(now*.013)*.025:0);
 c.group.userData.book.rotation.z=Math.sin(now*.0013+phase)*.012+(walking?Math.sin(now*.012+phase)*.025:0);
 c.group.userData.star.rotation.y+=dt*(talking?1.5:(walking?.65:.42));c.group.userData.star.rotation.z=Math.sin(now*.0019+phase)*.2;
 c.group.userData.wings.forEach((w,i)=>{w.rotation.z=(i===0?-.18:.18)+(talking?Math.sin(now*.009+i)*.12:(walking?Math.sin(now*.012+phase+i*Math.PI)*.09:Math.sin(now*.0016+phase+i)*.025))});
 c.group.userData.feet.forEach((foot,i)=>{foot.rotation.x=walking?Math.sin(now*.012+phase+i*Math.PI)*.32:Math.sin(now*.0015+phase+i)*.015});
 c.group.userData.beak.scale.y=talking?.8+Math.abs(Math.sin(now*.024))*.8:1;
 c.group.userData.tufts.forEach((t,i)=>{t.rotation.z=(i===0?.18:-.18)+Math.sin(now*.0018+phase+i)*.035});
}
function updateWiseCharacterSpeech(now){
 const el=$('wiseCharacterSpeech'),c=wiseCharacter;if(!el)return;
 if(!started||!c||!c.speech||now>c.speechUntil||cam.position.distanceTo(c.group.position)>14){el.hidden=true;return}
 const anchor=c.group.position.clone();anchor.y+=1.64;anchor.project(cam);
 if(anchor.z< -1||anchor.z>1||Math.abs(anchor.x)>1||Math.abs(anchor.y)>1){el.hidden=true;return}
 el.classList.toggle('is-short',Array.from(c.speech.trim()).length<=9);el.textContent=c.speech;placeProjectedSpeechBubble(el,anchor);
}

/* 空・雲 */
(function makeSky(){
 const g=new THREE.SphereGeometry(180,24,16);
 const c=document.createElement('canvas');c.width=2;c.height=64;const x=c.getContext('2d');
 const gd=x.createLinearGradient(0,0,0,64);gd.addColorStop(0,'#1a3a6e');gd.addColorStop(.35,'#5ba3d9');gd.addColorStop(.55,'#b8dcf0');gd.addColorStop(1,'#e8f4fc');
 x.fillStyle=gd;x.fillRect(0,0,2,64);
 const skyTex=new THREE.CanvasTexture(c);skyTex.magFilter=THREE.LinearFilter;
 const sky=new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,fog:false,depthWrite:false}));
 sky.name='sky';scene.add(sky);
 window._skyMat=sky.material;window._skyGrad=x;window._skyCan=c;window._skyTex=skyTex;
})();
const clouds=new THREE.Group();scene.add(clouds);
(function makeClouds(){
 // 透けた平面にランダムな丸を描く方式をやめ、低ポリゴンの立体的な雲へ。
 // 1つの雲を複数のパフ球で構成し、形状は1メッシュにまとめてドローコールを増やさない。
 const unitSphere=new THREE.SphereGeometry(1,10,7);
 const spherePos=unitSphere.attributes.position;
 const sphereIndex=unitSphere.index.array;
 const cloudBottom=new THREE.Color(0xb9cbd9),cloudMid=new THREE.Color(0xf0f6fb),cloudTop=new THREE.Color(0xffffff);
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function makeCloudGeometry(seed){
  let state=(seed*9301+49297)%233280;
  const rand=()=>{state=(state*9301+49297)%233280;return state/233280};
  const jitter=(v,amount)=>v+(rand()-.5)*amount;
  const puffs=[
   // 横長の下層と、上に重なる大小の雲で、丸い輪郭に段差をつける。
   {x:0,y:-.18,z:0,sx:4.25,sy:.58,sz:1.48},
   {x:-3.02,y:.02,z:-.02,sx:1.48,sy:.83,sz:1.22},
   {x:-1.78,y:.54,z:-.12,sx:1.55,sy:1.08,sz:1.22},
   {x:.12,y:.72,z:.04,sx:1.72,sy:1.22,sz:1.34},
   {x:2.12,y:.42,z:-.04,sx:1.58,sy:.96,sz:1.22},
   {x:3.18,y:.08,z:.08,sx:1.02,sy:.69,sz:1.04},
   {x:-1.65,y:-.13,z:.83,sx:1.72,sy:.67,sz:.76},
   {x:1.03,y:-.13,z:.92,sx:1.78,sy:.68,sz:.73},
   {x:.10,y:.06,z:-.85,sx:1.88,sy:.72,sz:.72}
  ];
  const positions=[],colors=[],indices=[];
  for(let pi=0;pi<puffs.length;pi++){
   const p=puffs[pi],start=positions.length/3;
   const ox=jitter(p.x,.22),oy=jitter(p.y,.12),oz=jitter(p.z,.18);
   const sx=p.sx*(.94+rand()*.12),sy=p.sy*(.93+rand()*.14),sz=p.sz*(.94+rand()*.12);
   const puffShade=.975+rand()*.045;
   for(let i=0;i<spherePos.count;i++){
    const lx=spherePos.getX(i),ly=spherePos.getY(i),lz=spherePos.getZ(i);
    const px=ox+lx*sx,py=oy+ly*sy,pz=oz+lz*sz;
    positions.push(px,py,pz);
    const h=clamp((py+.5)/1.9,0,1),color=new THREE.Color();
    if(h<.58)color.lerpColors(cloudBottom,cloudMid,h/.58);else color.lerpColors(cloudMid,cloudTop,(h-.58)/.42);
    // 頂部は白く、下面は青灰色。照明を追加せず形状の丸みを読めるようにする。
    colors.push(color.r*puffShade,color.g*puffShade,color.b*puffShade);
   }
   for(let i=0;i<sphereIndex.length;i++)indices.push(start+sphereIndex[i]);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  return geo;
 }
 for(let i=0;i<12;i++){
  const geo=makeCloudGeometry(i+1);
  const mat=new THREE.MeshBasicMaterial({vertexColors:true,fog:true});
  const m=new THREE.Mesh(geo,mat);
  const size=1.32+Math.random()*.92;
  m.scale.set(size,size*(.88+Math.random()*.18),size*(.92+Math.random()*.16));
  m.position.set((Math.random()-.5)*100,28+Math.random()*10,(Math.random()-.5)*100);
  m.rotation.y=(Math.random()-.5)*.85;
  m.userData.spd=.15+Math.random()*.25;
  m.userData.baseY=m.position.y;m.userData.baseZ=m.position.z;m.userData.phase=Math.random()*Math.PI*2;
  clouds.add(m);
 }
 unitSphere.dispose();
})();

/* 昼夜 */
const cloudNightTint=new THREE.Color(0x7185a7),cloudDawnTint=new THREE.Color(0xffd8bd),cloudDayTint=new THREE.Color(0xffffff),cloudDuskTint=new THREE.Color(0xffc28d),cloudTint=new THREE.Color();
let dayT=0.35; // 0〜1、0.25=朝,0.5=昼,0.75=夜
function updateSky(dt){
 dayT=(dayT+dt/480)%1; // 約8分で1日
 const t=dayT;
 // 空の色を時間で補間
 const skyCols=[
  [0.00,[8,10,30],[20,25,50]],   // 深夜
  [0.20,[40,50,90],[180,140,100]], // 夜明け
  [0.30,[90,160,220],[200,220,240]], // 朝
  [0.50,[90,170,230],[210,230,250]], // 昼
  [0.70,[100,140,200],[255,160,80]], // 夕
  [0.82,[30,35,70],[80,50,40]], // 宵
  [1.00,[8,10,30],[20,25,50]]
 ];
 let a=skyCols[0],b=skyCols[1];
 for(let i=0;i<skyCols.length-1;i++)if(t>=skyCols[i][0]&&t<=skyCols[i+1][0]){a=skyCols[i];b=skyCols[i+1];break}
 const u=(t-a[0])/(b[0]-a[0]||1);
 const mix=(p,q,u)=>p.map((v,i)=>v+(q[i]-v)*u);
 const top=mix(a[1],b[1],u),bot=mix(a[2],b[2],u);
 const x=window._skyGrad,c=window._skyCan;
 const gd=x.createLinearGradient(0,0,0,64);
 gd.addColorStop(0,'rgb('+top.map(v=>v|0).join(',')+')');
 gd.addColorStop(.45,'rgb('+mix(top,bot,.5).map(v=>v|0).join(',')+')');
 gd.addColorStop(1,'rgb('+bot.map(v=>v|0).join(',')+')');
 x.fillStyle=gd;x.fillRect(0,0,2,64);window._skyTex.needsUpdate=true;
 const fogC=new THREE.Color(bot[0]/255,bot[1]/255,bot[2]/255);
 scene.background.copy(fogC);scene.fog.color.copy(fogC);
 // 雲は時刻に応じて色調を変える。日中は明るく、朝夕は暖色、夜は青灰色。
 if(t<.20||t>.92)cloudTint.copy(cloudNightTint);
 else if(t<.30)cloudTint.lerpColors(cloudNightTint,cloudDawnTint,(t-.20)/.10);
 else if(t<.36)cloudTint.lerpColors(cloudDawnTint,cloudDayTint,(t-.30)/.06);
 else if(t<.68)cloudTint.copy(cloudDayTint);
 else if(t<.82)cloudTint.lerpColors(cloudDayTint,cloudDuskTint,(t-.68)/.14);
 else cloudTint.lerpColors(cloudDuskTint,cloudNightTint,(t-.82)/.10);
 const cloudNow=performance.now()*.00018;
 clouds.children.forEach(m=>{
  m.material.color.copy(cloudTint);
  m.position.x+=m.userData.spd*dt;
  m.position.y=m.userData.baseY+Math.sin(cloudNow+m.userData.phase)*.12;
  m.position.z=m.userData.baseZ+Math.sin(cloudNow*.72+m.userData.phase)*.22;
  if(m.position.x>60){m.position.x=-60;m.userData.baseZ=(Math.random()-.5)*100;m.position.z=m.userData.baseZ}
 });
}

function quad(P,C,U,I,x,y,z,f,col,sh,uv,eps){
 const F=FACES[f],base=P.length/3;
 for(const[a,b]of[[0,0],[1,0],[1,1],[0,1]]){
  P.push(x+F.o[0]+a*F.a[0]+b*F.b[0]+F.n[0]*eps,y+F.o[1]+a*F.a[1]+b*F.b[1]+F.n[1]*eps,z+F.o[2]+a*F.a[2]+b*F.b[2]+F.n[2]*eps);
  C.push(col.r*sh,col.g*sh,col.b*sh);
  if(uv)U.push(uv[0]+a*TS/AT,uv[1]-b*TS/AT);
 }
 if(F.flip)I.push(base,base+2,base+1,base,base+3,base+2);else I.push(base,base+1,base+2,base,base+2,base+3);
}
// 縦面の一部だけを別色で描く。草ブロック側面の芝帯に使用し、ドローコールは増やさない。
function quadVerticalRange(P,C,U,I,x,y,z,f,col,sh,uv,t0,t1,eps=0){
 const F=FACES[f],base=P.length/3;
 for(const[a,b]of[[0,t0],[1,t0],[1,t1],[0,t1]]){
  P.push(x+F.o[0]+a*F.a[0]+b*F.b[0]+F.n[0]*eps,y+F.o[1]+a*F.a[1]+b*F.b[1]+F.n[1]*eps,z+F.o[2]+a*F.a[2]+b*F.b[2]+F.n[2]*eps);
  C.push(col.r*sh,col.g*sh,col.b*sh);
  if(uv)U.push(uv[0]+a*TS/AT,uv[1]-b*TS/AT);
 }
 if(F.flip)I.push(base,base+2,base+1,base,base+3,base+2);else I.push(base,base+1,base+2,base,base+2,base+3);
}
function quadSlime(P,C,U,I,x,y,z,f,sh,variant){
 const F=FACES[f],base=P.length/3,tx=variant%4,ty=(variant/4)|0;
 const u0=(tx*32+.5)/128,u1=((tx+1)*32-.5)/128;
 const v0=1-(ty*32+.5)/128,v1=1-((ty+1)*32-.5)/128;
 for(const[a,b]of[[0,0],[1,0],[1,1],[0,1]]){
  P.push(x+F.o[0]+a*F.a[0]+b*F.b[0]+F.n[0]*.001,y+F.o[1]+a*F.a[1]+b*F.b[1]+F.n[1]*.001,z+F.o[2]+a*F.a[2]+b*F.b[2]+F.n[2]*.001);
  C.push(sh,sh,sh);U.push(u0+a*(u1-u0),v0+b*(v1-v0));
 }
 if(F.flip)I.push(base,base+2,base+1,base,base+3,base+2);else I.push(base,base+1,base+2,base,base+2,base+3);
}
function setGeo(m,P,C,U,I){m.geometry.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));if(U)g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));g.setIndex(I);m.geometry=g}
let wDirty=true,oDirty=true,tDirty=false;const dirtyPaintPages=new Set();const dirtyOverlayPages=new Set(Array.from({length:PAINT_PAGE_COUNT},(_,i)=>i));
applyWorldTheme(worldTheme||'nature');
function isGlass(b){return b===10}
function isSlime(b){return b===14} // BN「スライム」
function rebuildWorld(){
 const P=[],C=[],U=[],I=[],Pw=[],Cw=[],Iw=[],Ps=[],Cs=[],Us=[],Is=[];
 for(let y=0;y<H;y++)for(let z=0;z<D;z++)for(let x=0;x<W;x++){
  const b=world[idx(x,y,z)];if(!b)continue;
  const water=b===8,glass=isGlass(b),slime=isSlime(b),trans=water||glass;
  for(let f=0;f<6;f++){
   const n=FACES[f].n,nb=get(x+n[0],y+n[1],z+n[2]);
   if(water){if(nb===8)continue}
   else if(glass){if(isGlass(nb))continue}
   // スライムは半透明なので、隣接する通常ブロックの面を隠さない。
   // スライム同士や通常ブロック同士の内部面は、従来どおり描画しない。
   else if(isSolid(nb)&&!isGlass(nb)&&(slime||!isSlime(nb)))continue;
   const baseCol=BC[b===1&&f!==2?2:b]||BC[3];
   const caveIndex=idx(x,y,z);const caveShade=naturalCaveAccentCells.has(caveIndex)?1:(naturalCaveWallCells.has(caveIndex)?0.42:1);
   const col=caveShade===1?baseCol:{r:baseCol.r*caveShade,g:baseCol.g*caveShade,b:baseCol.b*caveShade};
   if(trans)quad(Pw,Cw,null,Iw,x,y,z,f,col,SH[f],null,0);
   else if(slime)quadSlime(Ps,Cs,Us,Is,x,y,z,f,SH[f],(x*7+y*13+z*17+f*3)&15);
   else if(b===1&&(f===0||f===1||f===4||f===5)){
    // 草ブロックの側面：上端16%だけ草色、残りは土色。側面テクスチャは無地。
    const uv=blockFaceUV(b,f);
    quadVerticalRange(P,C,U,I,x,y,z,f,BC[1],SH[f],uv,0,.16,0);
    quadVerticalRange(P,C,U,I,x,y,z,f,BC[2],SH[f],uv,.16,1,0);
   }else quad(P,C,U,I,x,y,z,f,col,SH[f],blockFaceUV(b,f),0);
  }
 }
 setGeo(wm,P,C,U,I);setGeo(wtm,Pw,Cw,null,Iw);setGeo(sm,Ps,Cs,Us,Is);
}

/* ---- 落書き: 描かれた面だけ32x32で保持し、アトラスに描く ---- */
const paint=new Map(),paintByPage=Array.from({length:PAINT_PAGE_COUNT},()=>new Map());let freeSlots=[],nextSlot=0;
const faceAuthor=new Map();
function authorAtHit(h){return h?faceAuthor.get(pkey(h.x,h.y,h.z,h.face))||null:null}

const WHITE=new THREE.Color(1,1,1),PX=TS*TS;
const pkey=(x,y,z,f)=>x+','+y+','+z+','+f;
const slotPage=s=>Math.floor(s/PAINT_SLOTS_PER_PAGE);
const slotXY=s=>{const q=s%PAINT_SLOTS_PER_PAGE;return[(q%PER)*TS,Math.floor(q/PER)*TS]};
function drawPix(s,px,py,c){const[cx,cy]=slotXY(s),page=slotPage(s),ctx=paintAtlases[page].context;if(c){ctx.fillStyle=toCss(c);ctx.fillRect(cx+px,cy+py,1,1)}else ctx.clearRect(cx+px,cy+py,1,1);dirtyPaintPages.add(page);tDirty=true}
function getPix(k,px,py){const e=paint.get(k);return e?e.d[py*TS+px]:0}
function setPix(k,px,py,c){
 let e=paint.get(k);
 if(!e){
  if(!c)return false;
  const s=freeSlots.length?freeSlots.pop():nextSlot++;
  if(s>=MAX_PAINT_SLOTS)return false;
  const q=k.split(',').map(Number),page=slotPage(s);
  e={s,d:new Uint16Array(PX),x:q[0],y:q[1],z:q[2],f:q[3]};
  paint.set(k,e);paintByPage[page].set(k,e);dirtyOverlayPages.add(page);oDirty=true;
 }
 if(e.d[py*TS+px]===c)return false;
 e.d[py*TS+px]=c;drawPix(e.s,px,py,c);saveDirty=true;return true;
}
function clearBlockPaint(x,y,z){
 for(let f=0;f<6;f++){
  const k=pkey(x,y,z,f),e=paint.get(k);if(!e)continue;
  const[cx,cy]=slotXY(e.s),page=slotPage(e.s);
  paintAtlases[page].context.clearRect(cx,cy,TS,TS);dirtyPaintPages.add(page);
  freeSlots.push(e.s);paint.delete(k);paintByPage[page].delete(k);dirtyOverlayPages.add(page);oDirty=tDirty=true;
 }
}
/** そのセルのいずれかの面に落書きがあるか */
function blockHasPaint(x,y,z){
 for(let f=0;f<6;f++)if(paint.has(pkey(x,y,z,f)))return true;
 return false;
}
function rebuildOverlay(){
 // 面を追加・削除したページだけ形状を再構築。各ページ内の面一覧も分離して走査量を抑える。
 for(const i of dirtyOverlayPages){
  const P=[],C=[],U=[],I=[];
  for(const e of paintByPage[i].values()){
   const n=FACES[e.f].n,nb=get(e.x+n[0],e.y+n[1],e.z+n[2]);
   // 不透明ブロックに隠れる落書きは省略するが、半透明スライム・ガラス越しの落書きは残す。
   if(nb&&!isSlime(nb)&&!isGlass(nb))continue;
   const[cx,cy]=slotXY(e.s);
   quad(P,C,U,I,e.x,e.y,e.z,e.f,WHITE,SH[e.f],[cx/AT,1-cy/AT],.004);
  }
  setGeo(omPages[i],P,C,U,I);
 }
 dirtyOverlayPages.clear();
}
function resetPaint(){
 paint.clear();paintByPage.forEach(page=>page.clear());faceAuthor.clear();freeSlots=[];nextSlot=0;
 for(let i=0;i<paintAtlases.length;i++){paintAtlases[i].context.clearRect(0,0,AT,AT);dirtyPaintPages.add(i);dirtyOverlayPages.add(i)}
 oDirty=tDirty=saveDirty=true;
}
function setBlock(x,y,z,b,local){
 if(x<0||y<0||z<0||x>=W||y>=H||z>=D)return;
 if(local&&!canBlk())return;
 if(!b)clearBlockPaint(x,y,z);
 world[idx(x,y,z)]=b;
 wDirty=true;saveDirty=true;
 if(x<=50&&y>=3&&y<=18&&z>=1&&z<=17)refreshNaturalCaveWallCells(world);
 // ブロックの変更で表示状態が変わり得る、隣接する落書き面だけ再構築対象にする。
 if(paint.size){
  for(let f=0;f<6;f++){
   const n=FACES[f].n;
   const e=paint.get(pkey(x+n[0],y+n[1],z+n[2],OPPOSITE_FACE[f]));
   if(e)dirtyOverlayPages.add(slotPage(e.s));
  }
  if(dirtyOverlayPages.size)oDirty=true;
 }
 Snd.play(b?'place':'break');
 if(local)Net.send({t:'blk',x,y,z,b});
}


/* ---- 通信: WebSocketサーバー方式（フェーズ2） ---- */
/* サーバーURL: 同じオリジンなら自動、または ?ws=wss://example.com で指定 */
const WS_URL=(()=>{const q=new URLSearchParams(location.search).get('ws');if(q)return q;
  if(location.protocol==='file:'||!location.hostname)return 'ws://127.0.0.1:3040';
  const p=location.protocol==='https:'?'wss:':'ws:';
  return p+'//'+location.host;})();
const Net={
 id:null,isHost:false,ws:null,admin:false,
 onMsg(){},onJoin(){},onLeave(){},onReady(){},onError(){},
 connect(code,name,col,sk,joinPw){
  if(this.ws){try{this.ws.close()}catch(e){}}
  this.id=null;this.admin=false;this.isHost=false;
  let url=WS_URL;
  try{
   this.ws=new WebSocket(url);
  }catch(e){this.onError({type:'lib',msg:'WebSocketを開けません'});return}
  this.ws.onopen=()=>{
   const msg={t:'join',name,col,sk};
   if(joinPw)msg.joinPw=joinPw;
   this.ws.send(JSON.stringify(msg));
  };
  this.ws.onmessage=ev=>{
   let m;try{m=JSON.parse(ev.data)}catch(e){return}
   if(m.t==='init'){
    this.id=m.id;this.isHost=false;
    if(m.room)room=m.room;
    this.onReady(m.id);
    this.onMsg(m);
   }else if(m.t==='err'){
    if(m.type==='rate'&&started){toast(m.msg||'操作が早すぎます');return}
    if(m.type==='world'&&started){worldLoadPending=false;const msg=m.msg||'世界を読み込めませんでした';toast(msg);addLog('システム',msg);return}
    this.onError({type:m.type||'error',msg:m.msg});
   }else if(m.t==='auth'){
    if(m.ok){this.admin=true;admAuthOpen=false;if($('pw'))$('pw').value='';toast(m.msg||'管理者になりました');paintAdmin()}
    else toast(m.msg||'合言葉が違います');
   }else{
    this.onMsg(m);
   }
  };
  this.ws.onclose=ev=>{
   if(leaveIntent){leaveIntent=false;return}
   // キック/BAN でも理由は出さず、通常切断と同じ表示
   if(this.id||ev.code===4000||ev.code===4001)this.onError({type:'closed'});
  };
  this.ws.onerror=()=>this.onError({type:'lib',msg:'サーバーに接続できません（URLや起動を確認してください）'});
 },
 send(m){if(this.ws&&this.ws.readyState===1){this.ws.send(JSON.stringify(m));return true}return false},
 kick(id){this.send({t:'kick',id})},
 auth(pw){this.send({t:'auth',pw})},
 leave(){
  leaveIntent=true;
  const w=this.ws;
  this.ws=null;this.id=null;this.admin=false;this.isHost=false;
  if(w){try{w.close(1000,'leave')}catch(e){}}
 }
};

/* ---- プレイヤー ---- */
const me={p:new THREE.Vector3(32,20,32),v:new THREE.Vector3(),yaw:0,pitch:0,ground:false,crouch:false,peakY:20};
let wantSprint=false,wReleaseAt=0;
const keys={};const ls=(k,d)=>{try{return localStorage.getItem(k)||d}catch(e){return d}},lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};

/* ---- 音: WebAudioで合成(効果音とBGM) ---- */
const Snd=(()=>{
 let ac,gm,bgmGm,vol=+ls('rkb_vol','.5'),bgm=ls('rkb_bgm','1')==='1',timer=0,nt=0,n=0,lastPen=0,phoneRingTimer=0,phoneRingLevel=.5,speechToken=0,phoneVoiceStartTimer=0,creatureVoiceStartTimer=0,forestVoiceStartTimer=0,forestVoiceToken=0,wiseVoiceStartTimer=0,wiseVoiceToken=0,phoneBedNodes=[],disasterAmbienceBeds=[];
 // BGMだけを独立したゲインに通し、標準音量を従来の18%に抑える。効果音・着信音は従来どおりマスターへ出力。
 const BGM_DEFAULT_GAIN=.18;
 const chooseJapaneseVoice=synth=>{
  try{
   const voices=synth.getVoices().filter(v=>/^ja([_-]|$)/i.test(v.lang||''));
   if(!voices.length)return null;
   const score=v=>{const n=String(v.name||'').toLowerCase();let q=0;if(/natural|neural/.test(n))q+=100;if(/online/.test(n))q+=25;if(/google/.test(n))q+=18;if(/microsoft/.test(n))q+=16;if(/espeak|festival|robot|compact/.test(n))q-=100;if(v.default)q+=3;return q};
   voices.sort((a,b)=>score(b)-score(a)||String(a.name||'').localeCompare(String(b.name||'')));return voices[0];
  }catch(e){return null}
 };
 // ひょっこりん専用の声選択。電話・囁きとは別に、明るく高めの日本語音声を優先する。
 const chooseCreatureVoice=synth=>{
  try{
   const voices=synth.getVoices().filter(v=>/^ja([_-]|$)/i.test(v.lang||''));
   if(!voices.length)return null;
   const score=v=>{
    const n=String(v.name||'').toLowerCase();let q=0;
    // 環境により名前は異なるが、比較的高め・柔らかめの声に使われる名前を優先。
    if(/nanami|haruka|ayumi|kyoko|sayaka|sakura|misaki|aoi|hina|yui|mio|mei|female|woman|girl|child|kid|samantha|aria|luna|anna|zira|karen|moira|tessa/.test(n))q+=140;
    if(/natural|neural/.test(n))q+=18;
    if(/online/.test(n))q+=8;
    if(/google/.test(n))q+=8;
    if(/microsoft/.test(n))q+=3;
    if(/ichiro|keita|david|male|man|boy/.test(n))q-=70;
    if(/espeak|festival|robot|compact/.test(n))q-=100;
    if(v.default)q+=1;
    return q;
   };
   // 電話が使う既定の日本語ボイスと別の、高めの候補があるならそちらを優先する。
   const phoneVoice=chooseJapaneseVoice(synth);
   const distinct=voices.filter(v=>phoneVoice && (v.voiceURI||v.name)!==(phoneVoice.voiceURI||phoneVoice.name) && score(v)>=100);
   const candidates=distinct.length?distinct:voices;
   candidates.sort((a,b)=>score(b)-score(a)||String(a.name||'').localeCompare(String(b.name||'')));
   return candidates[0];
  }catch(e){return null}
 };
 // ポストン専用の声選択。別声を優先して低い声になる問題を避け、まず明るく高めの日本語音声を選ぶ。
 // 電話やホシヨミと声源が同じ環境でも、ポストン専用の高めのピッチ・軽快な話速で差を付ける。
 const chooseForestResidentVoice=synth=>{
  try{
   const voices=synth.getVoices().filter(v=>/^ja([_-]|$)/i.test(v.lang||''));if(!voices.length)return null;
   const score=v=>{
    const n=String(v.name||'').toLowerCase();let q=0;
    if(/nanami|haruka|ayumi|kyoko|sayaka|sakura|misaki|aoi|hina|yui|mio|mei|female|woman|girl|child|kid|aria|luna|anna|zira|moira|tessa/.test(n))q+=150;
    if(/natural|neural/.test(n))q+=35;
    if(/online/.test(n))q+=15;
    if(/google|microsoft/.test(n))q+=8;
    if(/ichiro|keita|takumi|male|man|david|daniel|jun/.test(n))q-=90;
    if(/espeak|festival|robot|compact/.test(n))q-=120;
    if(v.default)q+=1;
    return q;
   };
   voices.sort((a,b)=>score(b)-score(a)||String(a.name||'').localeCompare(String(b.name||'')));return voices[0];
  }catch(e){return null}
 };
 const chooseWiseCharacterVoice=synth=>{
  try{
   const voices=synth.getVoices().filter(v=>/^ja([_-]|$)/i.test(v.lang||''));if(!voices.length)return null;
   const poston=chooseForestResidentVoice(synth),creature=chooseCreatureVoice(synth),phone=chooseJapaneseVoice(synth);
   const distinct=voices.filter(v=>[poston,creature,phone].filter(Boolean).every(o=>(v.voiceURI||v.name)!==(o.voiceURI||o.name)));
   const pool=distinct.length?distinct:voices;
   const score=v=>{const n=String(v.name||'').toLowerCase();let q=0;if(/natural|neural/.test(n))q+=40;if(/ichiro|keita|takumi|hiro|male|man|david|daniel|jun/.test(n))q+=20;if(/compact|robot|espeak|festival/.test(n))q-=100;if(v.default)q+=1;return q};
   pool.sort((a,b)=>score(b)-score(a)||String(a.name||'').localeCompare(String(b.name||'')));return pool[0];
  }catch(e){return null}
 };
 const clearPhoneBed=()=>{for(const n of phoneBedNodes){try{n.stop()}catch(e){}try{n.disconnect()}catch(e){}}phoneBedNodes=[]};
 const tone=(f,t,d,ty,v,out=gm)=>{const o=ac.createOscillator(),g=ac.createGain();o.type=ty;o.frequency.value=f;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(out);o.start(t);o.stop(t+d)};
 const noise=(t,d,v)=>{const b=ac.createBuffer(1,ac.sampleRate*d|0,ac.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(1-i/a.length);const s=ac.createBufferSource(),g=ac.createGain();s.buffer=b;g.gain.value=v;s.connect(g);g.connect(gm);s.start(t)};
 // 囁き演出専用の短い息音。低負荷で、左右どちらかからかすかに聞こえる。
 const breath=(t,d,v,pan=0)=>{try{const len=Math.max(1,Math.floor(ac.sampleRate*d)),b=ac.createBuffer(1,len,ac.sampleRate),a=b.getChannelData(0);for(let i=0;i<len;i++){const env=Math.pow(Math.max(0,Math.sin(Math.PI*i/Math.max(1,len-1))),.72);a[i]=(Math.random()*2-1)*env}const src=ac.createBufferSource(),hp=ac.createBiquadFilter(),lp=ac.createBiquadFilter(),g=ac.createGain(),p=ac.createStereoPanner?ac.createStereoPanner():null;src.buffer=b;hp.type='highpass';hp.frequency.value=420;lp.type='lowpass';lp.frequency.value=2500;g.gain.value=v;src.connect(hp);hp.connect(lp);if(p){p.pan.value=pan;lp.connect(g);g.connect(p);p.connect(gm)}else{lp.connect(g);g.connect(gm)}src.start(t);src.stop(t+d)}catch(e){}};
 // ひょっこりんの音だけを空間定位させる。SpeechSynthesis自体はWeb Audioへ出力できないため、
 // 声の直前と発話中に、同じ位置から聞こえる息・空気音をHRTFで鳴らして方向を伝える。
 const connectSpatial=(node,location)=>{
  const loc=location&&typeof location==='object'?location:{x:Number(location)||0,y:0,z:-3,distance:3};
  const nx=Number(loc.x),ny=Number(loc.y),nz=Number(loc.z);
  const x=Math.max(-256,Math.min(256,Number.isFinite(nx)?nx:0)),y=Math.max(-256,Math.min(256,Number.isFinite(ny)?ny:0)),z=Math.max(-256,Math.min(256,Number.isFinite(nz)?nz:-3));
  try{
   if(ac.createPanner){
    const p=ac.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=3;p.maxDistance=20;p.rolloffFactor=.24;p.coneInnerAngle=360;p.coneOuterAngle=360;p.coneOuterGain=1;
    if(p.positionX&&typeof p.positionX.setValueAtTime==='function'){p.positionX.setValueAtTime(x,ac.currentTime);p.positionY.setValueAtTime(y,ac.currentTime);p.positionZ.setValueAtTime(z,ac.currentTime)}else p.setPosition(x,y,z);
    node.connect(p);p.connect(gm);return p;
   }
  }catch(e){}
  try{if(ac.createStereoPanner){const p=ac.createStereoPanner(),fallbackPan=Number.isFinite(Number(loc.pan))?Number(loc.pan):x/Math.max(2,Math.hypot(x,z));p.pan.value=Math.max(-.94,Math.min(.94,fallbackPan));node.connect(p);p.connect(gm);return p}}catch(e){}
  node.connect(gm);return null;
 };
 const spatialAir=(location,duration=1.8,level=.055)=>{
  if(!ac||vol<=0)return;
  const seconds=Math.max(.25,Math.min(4.8,duration)),count=Math.max(1,Math.min(6,Math.ceil(seconds/.72))),now=ac.currentTime;
  for(let i=0;i<count;i++){
   try{
    const start=now+.025+i*(seconds/(count+.35)),d=.15+Math.random()*.12,len=Math.max(1,Math.floor(ac.sampleRate*d));
    const b=ac.createBuffer(1,len,ac.sampleRate),a=b.getChannelData(0);
    const tilt=.9+Math.random()*.45;
    for(let j=0;j<len;j++){const u=j/Math.max(1,len-1),env=Math.pow(Math.max(0,Math.sin(Math.PI*u)),tilt);a[j]=(Math.random()*2-1)*env}
    const src=ac.createBufferSource(),hp=ac.createBiquadFilter(),bp=ac.createBiquadFilter(),lp=ac.createBiquadFilter(),g=ac.createGain();
    src.buffer=b;hp.type='highpass';hp.frequency.value=750;bp.type='bandpass';bp.frequency.value=1850+Math.random()*500;bp.Q.value=.55;lp.type='lowpass';lp.frequency.value=5600;g.gain.value=Math.max(.0001,Math.min(.085,vol*level));
    src.connect(hp);hp.connect(bp);bp.connect(lp);lp.connect(g);connectSpatial(g,location);
    src.onended=()=>{try{src.disconnect();hp.disconnect();bp.disconnect();lp.disconnect();g.disconnect()}catch(e){}};
    src.start(start);src.stop(start+d+.015);
   }catch(e){}
  }
 };
 const FX={place:t=>tone(260,t,.09,'square',.12),break:t=>noise(t,.18,.25),pen:t=>tone(700+Math.random()*200,t,.04,'sine',.08),
  emote:t=>{tone(660,t,.12,'triangle',.15);tone(880,t+.1,.15,'triangle',.15)},chat:t=>tone(880,t,.1,'triangle',.12),
  join:t=>[523,659,784].forEach((f,i)=>tone(f,t+i*.08,.15,'triangle',.12)),leave:t=>[784,523].forEach((f,i)=>tone(f,t+i*.1,.15,'triangle',.1))};
 const CH=[[0,4,7],[9,12,16],[5,9,12],[7,11,14]];
 // Natural-disaster ambience is generated from noise and filters; no audio assets are loaded.
 const endDisasterAmbience=()=>{
  if(!disasterAmbienceBeds.length)return;
  const beds=disasterAmbienceBeds.splice(0),t=ac?ac.currentTime:0;
  for(const b of beds){
   try{b.mod.gain.cancelScheduledValues(t);b.mod.gain.setTargetAtTime(0,t,.16)}catch(e){}
   try{b.gain.gain.cancelScheduledValues(t);b.gain.gain.setTargetAtTime(.0001,t,.32)}catch(e){}
   try{b.source.stop(t+1.45)}catch(e){}
   try{b.lfo.stop(t+1.5)}catch(e){}
  }
 };
 const beginDisasterAmbience=(kind,initialIntensity=1)=>{
  endDisasterAmbience();if(!ac||vol<=0)return;
  const startIntensity=Math.max(0,Math.min(1,Number(initialIntensity)||0));
  const makeBed=(opts)=>{
   try{
    const t=ac.currentTime,sr=ac.sampleRate,len=Math.max(1,Math.floor(sr*14)),buffer=ac.createBuffer(1,len,sr),data=buffer.getChannelData(0);
    // 環境音は14秒の連続ノイズをループする。バッファ両端をフェードすると
    // 周回のたびに雨や風が一瞬弱まり、途切れて聞こえるため、周期的な無音を作らない。
    // 白色ノイズ自体がランダムなため、接続点を窓関数で暗くする必要はない。
    let brown=0;
    for(let i=0;i<len;i++){
     const white=Math.random()*2-1;
     brown=brown*.965+white*.035;
     data[i]=white*.74+brown*.26;
    }
    const source=ac.createBufferSource(),hp=ac.createBiquadFilter(),lp=ac.createBiquadFilter(),gain=ac.createGain(),lfo=ac.createOscillator(),mod=ac.createGain();
    source.buffer=buffer;source.loop=true;hp.type='highpass';hp.frequency.value=opts.hp;lp.type='lowpass';lp.frequency.value=opts.lp;lp.Q.value=.55;
    gain.gain.value=opts.level*startIntensity;lfo.type='sine';lfo.frequency.value=opts.rate;mod.gain.value=opts.depth*startIntensity;
    source.connect(hp);hp.connect(lp);lp.connect(gain);gain.connect(gm);lfo.connect(mod);mod.connect(gain.gain);
    const bed={source,hp,lp,gain,lfo,mod,baseLevel:opts.level,baseDepth:opts.depth};disasterAmbienceBeds.push(bed);
    source.onended=()=>{try{source.disconnect();hp.disconnect();lp.disconnect();gain.disconnect();lfo.disconnect();mod.disconnect()}catch(e){}};
    source.start(t);lfo.start(t);
   }catch(e){}
  };
  if(kind==='storm'){
   makeBed({hp:520,lp:8800,level:.027,rate:.17,depth:.0055}); // dense, soft rain
   makeBed({hp:55,lp:620,level:.027,rate:.075,depth:.015});  // wide low storm wind
  }else if(kind==='blizzard'){
   makeBed({hp:45,lp:760,level:.043,rate:.085,depth:.023});  // body of the wind
   makeBed({hp:530,lp:2700,level:.009,rate:.19,depth:.006}); // distant icy whistle
  }
 };
 const sched=()=>{while(nt<ac.currentTime+.6){const i=n++,c=CH[(i>>3)&3],q=i&7,f=261.63*2**((c[[0,1,2,1,0,2,1,2][q]]+(q?12:0))/12);tone(f,nt,.9,'triangle',.05,bgmGm);if(!q)tone(f/2,nt,2.4,'sine',.07,bgmGm);nt+=.375}};
 const run=()=>{clearInterval(timer);if(ac&&bgm){nt=ac.currentTime+.1;timer=setInterval(sched,200)}};
 return{
  get vol(){return vol},get bgm(){return bgm},
  init(){if(!ac){ac=new(window.AudioContext||window.webkitAudioContext)();gm=ac.createGain();gm.gain.value=vol;gm.connect(ac.destination);bgmGm=ac.createGain();bgmGm.gain.value=BGM_DEFAULT_GAIN;bgmGm.connect(gm);run()}if(ac.state==='suspended')ac.resume()},
  updateListener(position,quaternion){
   if(!ac||!position||!quaternion)return;
   try{
    const l=ac.listener,q=quaternion,x=q.x,y=q.y,z=q.z,w=q.w;
    // カメラの前方向(-Z)と上方向(+Y)をクォータニオンから算出。
    const fx=-2*(w*y+x*z),fy=2*(w*x-y*z),fz=2*(x*x+y*y)-1;
    const ux=2*(x*y-w*z),uy=1-2*(x*x+z*z),uz=2*(y*z+w*x);
    if(l.positionX){l.positionX.value=position.x;l.positionY.value=position.y;l.positionZ.value=position.z;l.forwardX.value=fx;l.forwardY.value=fy;l.forwardZ.value=fz;l.upX.value=ux;l.upY.value=uy;l.upZ.value=uz}
    else if(l.setPosition&&l.setOrientation){l.setPosition(position.x,position.y,position.z);l.setOrientation(fx,fy,fz,ux,uy,uz)}
   }catch(e){}
  },
  play(k){if(!ac)return;const t=ac.currentTime;if(k==='pen'){if(t-lastPen<.08)return;lastPen=t}if(FX[k])FX[k](t)},
  playMischiefCue(location=0){
   // 先に短い、定位の分かりやすい息音を鳴らす。単純な電子音ではなくASMR寄りの空気音。
   if(!ac||vol<=0)return false;
   spatialAir(location,.56,.07);
   // 息音の直後に、ごく小さなきらめき音を同じ位置へ置いて気づくきっかけにする。
   try{
    const t=ac.currentTime+.14;
    [[820,0,.095],[1040,.085,.12]].forEach(([freq,delay,dur],i)=>{
     const o=ac.createOscillator(),f=ac.createBiquadFilter(),g=ac.createGain();
     o.type='sine';o.frequency.setValueAtTime(freq,t+delay);o.frequency.exponentialRampToValueAtTime(freq*(i?.82:.9),t+delay+dur);
     f.type='lowpass';f.frequency.value=2200;g.gain.setValueAtTime(.0001,t+delay);g.gain.exponentialRampToValueAtTime(Math.max(.0001,Math.min(.012,vol*.018)),t+delay+.012);g.gain.exponentialRampToValueAtTime(.0001,t+delay+dur);
     o.connect(f);f.connect(g);connectSpatial(g,location);o.start(t+delay);o.stop(t+delay+dur+.01);
     o.onended=()=>{try{o.disconnect();f.disconnect();g.disconnect()}catch(e){}};
    });
    return true;
   }catch(e){return false}
  },
  playAmbientCritterCall(type,location=0,startled=false){
   // ワールドの小さな3匹に、それぞれ異なる音程・リズムのオリジナル鳴き声を与える。
   // 既存作品の音声を流用せずWeb Audioで合成し、発生源をクリッターの位置に3D定位させる。
   if(!ac||vol<=0)return false;
   const variant=((Number(type)||0)%3+3)%3;
   const patterns=[
    [ // 緑: まるい、小鳥のような「ぴるる」
     [[0,.16,590,860,'triangle',.085,2900],[.145,.13,875,760,'sine',.064,3400],[.33,.20,690,1030,'triangle',.082,3200]],
     [[0,.12,680,980,'sine',.078,3500],[.12,.12,920,745,'triangle',.067,3000],[.27,.20,720,900,'sine',.083,3200]]
    ],
    [ // 琥珀色: 低く、少し丸い「ぽぷ・ぷい」
     [[0,.13,320,390,'triangle',.088,1550],[.16,.12,390,300,'square',.038,1050],[.33,.18,450,560,'triangle',.080,1950]],
     [[0,.10,360,320,'triangle',.078,1650],[.12,.12,330,420,'triangle',.083,1750],[.30,.18,510,390,'sine',.072,2050]]
    ],
    [ // 藤色: 高く、きらきらした「ぴりりっ」
     [[0,.10,1020,1380,'sine',.076,4800],[.09,.10,1390,1170,'triangle',.064,4400],[.22,.10,1260,1660,'sine',.074,5200],[.34,.15,1550,1840,'sine',.078,5000]],
     [[0,.12,900,1240,'triangle',.073,4200],[.12,.09,1280,1620,'sine',.068,5300],[.24,.14,1600,1350,'sine',.078,4800],[.40,.10,1190,1550,'triangle',.069,5000]]
    ]
   ];
   const phrase=patterns[variant][Math.floor(Math.random()*patterns[variant].length)];
   const loc=location&&typeof location==='object'?location:{x:0,y:0,z:-3,distance:3};
   const distance=Number.isFinite(Number(loc.distance))?Math.max(0,Number(loc.distance)):3;
   if(distance>22)return false;
   const distanceGain=1-.28*Math.max(0,Math.min(1,(distance-2)/(20-2)));
   const bus=ac.createGain();bus.gain.value=1.05*distanceGain;
   const spatial=connectSpatial(bus,loc),t=ac.currentTime+.012,pitch=(.96+Math.random()*.08)*(startled?1.075:1);
   try{
    phrase.forEach(note=>{
     const [offset,duration,from,to,wave,level,cutoff]=note;
     const at=t+offset*(startled?.84:1),d=duration*(startled?.88:1),o=ac.createOscillator(),filter=ac.createBiquadFilter(),gain=ac.createGain();
     o.type=wave;filter.type='lowpass';filter.frequency.value=cutoff;filter.Q.value=.7;
     o.frequency.setValueAtTime(Math.max(40,from*pitch),at);o.frequency.exponentialRampToValueAtTime(Math.max(40,to*pitch),at+d);
     const peak=Math.min(.18,level*(startled?1.16:1)*1.55);
     gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(peak,at+Math.min(.025,d*.22));
     gain.gain.setValueAtTime(peak*.62,at+d*.48);gain.gain.exponentialRampToValueAtTime(.0001,at+d);
     o.connect(filter);filter.connect(gain);gain.connect(bus);
     o.onended=()=>{try{o.disconnect();filter.disconnect();gain.disconnect()}catch(e){}};
     o.start(at);o.stop(at+d+.018);
    });
    // 短い鳴き声が終わったら空間ノードも破棄する。
    setTimeout(()=>{try{bus.disconnect();if(spatial)spatial.disconnect()}catch(e){}},850);
    return true;
   }catch(e){try{bus.disconnect();if(spatial)spatial.disconnect()}catch(e){}return false}
  },
  playMischiefVocalization(location=0,calling=false,startled=false){
   // ひょっこりんは言葉を話さず、短い生き物らしい鳴き声だけで反応する。
   // Web Audioで独自合成し、発生位置へ3D定位。callingは姿を見せる前の呼びかけ、
   // greetは姿を現した後の明るい返事。文字列・音声合成APIには依存しない。
   if(!ac||vol<=0)return false;
   const patterns=calling?[
    [[0,.17,560,980,'sine',.20,3000],[.15,.16,1040,770,'triangle',.17,3100],[.37,.23,720,1320,'sine',.21,3700]],
    [[0,.14,680,1120,'triangle',.19,3400],[.18,.12,950,870,'sine',.18,3000],[.35,.25,780,1460,'sine',.22,3900]]
   ]:[
    [[0,.13,900,1250,'sine',.19,3900],[.12,.15,1240,1020,'triangle',.18,3600],[.30,.18,1060,1510,'sine',.21,4200]],
    [[0,.12,760,1060,'triangle',.18,3400],[.12,.13,1080,1440,'sine',.20,4200],[.27,.13,1400,1160,'sine',.17,3900],[.43,.18,1040,1620,'triangle',.21,4200]]
   ];
   const phrase=(startled?[[0,.105,920,1600,'sine',.22,4400],[.12,.13,1450,1120,'triangle',.18,3800]]:patterns[Math.floor(Math.random()*patterns.length)]);
   const loc=location&&typeof location==='object'?location:{x:0,y:0,z:-3,distance:3};
   const distance=Number.isFinite(Number(loc.distance))?Math.max(0,Number(loc.distance)):3;
   if(distance>22)return false;
   const distanceGain=1-.25*Math.max(0,Math.min(1,(distance-2)/(20-2)));
   const bus=ac.createGain();bus.gain.value=1.12*distanceGain;
   const spatial=connectSpatial(bus,loc),t=ac.currentTime+.012,pitch=(.97+Math.random()*.07)*(startled?1.10:1);
   try{
    phrase.forEach(note=>{
     const [offset,duration,from,to,wave,level,cutoff]=note;
     const at=t+offset,d=duration*(startled?.88:1),o=ac.createOscillator(),filter=ac.createBiquadFilter(),gain=ac.createGain();
     o.type=wave;filter.type='lowpass';filter.frequency.value=cutoff;filter.Q.value=.65;
     o.frequency.setValueAtTime(Math.max(40,from*pitch),at);o.frequency.exponentialRampToValueAtTime(Math.max(40,to*pitch),at+d);
     const peak=Math.min(.24,level*(vol>.65?1.12:1));
     gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(peak,at+Math.min(.022,d*.2));
     gain.gain.setValueAtTime(peak*.58,at+d*.47);gain.gain.exponentialRampToValueAtTime(.0001,at+d);
     o.connect(filter);filter.connect(gain);gain.connect(bus);
     o.onended=()=>{try{o.disconnect();filter.disconnect();gain.disconnect()}catch(e){}};
     o.start(at);o.stop(at+d+.018);
    });
    setTimeout(()=>{try{bus.disconnect();if(spatial)spatial.disconnect()}catch(e){}},900);
    return true;
   }catch(e){try{bus.disconnect();if(spatial)spatial.disconnect()}catch(e){}return false}
  },
  speakCreature(text,location=0,directionCue=false){
   // 呼びかけ(calling)だけ方向ヒント音を先に鳴らす。姿を見せた後の挨拶には付けない。
   if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'||vol<=0)return false;
   const synth=window.speechSynthesis;
   if(synth.speaking||synth.pending)return false;
   try{
    if(creatureVoiceStartTimer){clearTimeout(creatureVoiceStartTimer);creatureVoiceStartTimer=0}
    const token=++speechToken;
    const u=new SpeechSynthesisUtterance(String(text||''));
    // ひょっこりんは「馬鹿みたいに高くて軽快」を狙う。pitchはWeb Speech APIの上限値。
    // pitch指定だけでは差が出にくい音声エンジンもあるため、話速も大きく上げる。
    // voice一覧がまだ読み込まれていない初回は、読み込みを少し待ってから高めの日本語音声を選ぶ。
    u.lang='ja-JP';u.rate=1.58;u.pitch=2.0;
    // 発話開始時点の距離から音量を決める。近距離は明瞭、遠距離は小さめだが聞こえる下限を残す。
    // SpeechSynthesisの声はWeb Audioへ直接接続できないため、距離が変わっても発話中は再起動せず、台詞ごとに計算する。
    const rawDistance=location&&typeof location==='object'?Number(location.distance):3;
    const distance=Number.isFinite(rawDistance)?Math.max(0,rawDistance):3;
    const t=Math.max(0,Math.min(1,(distance-2.5)/(18-2.5)));
    const smooth=t*t*(3-2*t);
    const distanceGain=1-.76*smooth; // 0〜2.5ブロック: 1.0、18ブロック以上: 0.24
    u.volume=Math.max(0,Math.min(.9,vol*.86*distanceGain));
    if(directionCue)this.playMischiefCue(location);
    // 単語そのものはブラウザの音声合成で中央から出るが、同じ位置に定位した微かな息音を重ねて、
    // ヘッドホンではキャラクターの方向を感じ取りやすくする。発話が終わるまで最大4.8秒だけ動作。
    const estimateMs=Math.max(700,Math.min(4800,String(text||'').length*135));
    u.onstart=()=>{if(token===speechToken)spatialAir(location,estimateMs/1000,.045)};
    const speakNow=()=>{
     creatureVoiceStartTimer=0;
     if(token!==speechToken||vol<=0||synth.speaking||synth.pending)return;
     try{const voice=chooseCreatureVoice(synth);if(voice)u.voice=voice;synth.speak(u)}catch(e){}
    };
    const knownVoices=synth.getVoices();
    if(knownVoices&&knownVoices.length){
     creatureVoiceStartTimer=setTimeout(speakNow,directionCue?260:0);
    }else{
     let finished=false;const finish=()=>{
      if(finished)return;finished=true;
      try{synth.removeEventListener('voiceschanged',onVoicesChanged)}catch(e){}
      if(creatureVoiceStartTimer)clearTimeout(creatureVoiceStartTimer);
      creatureVoiceStartTimer=setTimeout(speakNow,directionCue?260:0);
     };
     const onVoicesChanged=()=>finish();
     try{synth.addEventListener('voiceschanged',onVoicesChanged,{once:true})}catch(e){}
     creatureVoiceStartTimer=setTimeout(()=>{
      try{synth.removeEventListener('voiceschanged',onVoicesChanged)}catch(e){}
      finish();
     },900);
    }
    return true;
   }catch(e){return false}
  },
  speakForestResident(text,location=0){
   if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'||vol<=0)return false;
   const synth=window.speechSynthesis;if(synth.speaking||synth.pending)return false;
   try{
    if(forestVoiceStartTimer){clearTimeout(forestVoiceStartTimer);forestVoiceStartTimer=0}
    const token=++forestVoiceToken,u=new SpeechSynthesisUtterance(String(text||''));u.lang='ja-JP';u.rate=1.22;u.pitch=1.72;
    const raw=location&&typeof location==='object'?Number(location.distance):4,distance=Number.isFinite(raw)?Math.max(0,raw):4;
    const d=Math.max(0,Math.min(1,(distance-1.8)/(13-1.8))),smooth=d*d*(3-2*d),gain=1-.78*smooth;
    u.volume=Math.max(0,Math.min(.88,vol*.82*gain));
    const speakNow=()=>{forestVoiceStartTimer=0;if(token!==forestVoiceToken||vol<=0||synth.speaking||synth.pending)return;try{const voice=chooseForestResidentVoice(synth);if(voice)u.voice=voice;synth.speak(u)}catch(e){}};
    const voices=synth.getVoices();
    if(voices&&voices.length)forestVoiceStartTimer=setTimeout(speakNow,0);
    else{let done=false;const finish=()=>{if(done)return;done=true;try{synth.removeEventListener('voiceschanged',onVoicesChanged)}catch(e){}if(forestVoiceStartTimer)clearTimeout(forestVoiceStartTimer);forestVoiceStartTimer=setTimeout(speakNow,0)};const onVoicesChanged=()=>finish();try{synth.addEventListener('voiceschanged',onVoicesChanged,{once:true})}catch(e){}forestVoiceStartTimer=setTimeout(()=>{try{synth.removeEventListener('voiceschanged',onVoicesChanged)}catch(e){}finish()},650)}
    return true;
   }catch(e){return false}
  },
  speakWiseCharacter(text,location=0){
   if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'||vol<=0)return false;
   const synth=window.speechSynthesis;if(synth.speaking||synth.pending)return false;
   try{
    if(wiseVoiceStartTimer){clearTimeout(wiseVoiceStartTimer);wiseVoiceStartTimer=0}
    const token=++wiseVoiceToken,u=new SpeechSynthesisUtterance(String(text||''));u.lang='ja-JP';u.rate=.86;u.pitch=.94;
    const raw=location&&typeof location==='object'?Number(location.distance):5,distance=Number.isFinite(raw)?Math.max(0,raw):5;
    const d=Math.max(0,Math.min(1,(distance-1.5)/(14-1.5))),smooth=d*d*(3-2*d),gain=1-.72*smooth;
    u.volume=Math.max(0,Math.min(.84,vol*.8*gain));
    const speakNow=()=>{wiseVoiceStartTimer=0;if(token!==wiseVoiceToken||vol<=0||synth.speaking||synth.pending)return;try{const voice=chooseWiseCharacterVoice(synth);if(voice)u.voice=voice;synth.speak(u)}catch(e){}};
    const voices=synth.getVoices();
    if(voices&&voices.length)wiseVoiceStartTimer=setTimeout(speakNow,0);
    else{let done=false;const finish=()=>{if(done)return;done=true;try{synth.removeEventListener('voiceschanged',onVoicesChanged)}catch(e){}if(wiseVoiceStartTimer)clearTimeout(wiseVoiceStartTimer);wiseVoiceStartTimer=setTimeout(speakNow,0)};const onVoicesChanged=()=>finish();try{synth.addEventListener('voiceschanged',onVoicesChanged,{once:true})}catch(e){}wiseVoiceStartTimer=setTimeout(()=>{try{synth.removeEventListener('voiceschanged',onVoicesChanged)}catch(e){}finish()},700)}
    return true;
   }catch(e){return false}
  },
  startPhoneRing(level=.5){
   if(!ac)return;phoneRingLevel=Math.max(0,Math.min(1,level));if(phoneRingTimer)return;
   const burst=()=>{if(!ac||!phoneRingTimer)return;const t=ac.currentTime,v=.28*phoneRingLevel;tone(1320,t,.16,'sine',v);tone(880,t+.19,.19,'sine',v*.92);tone(1320,t+.58,.16,'sine',v);tone(880,t+.77,.19,'sine',v*.92)};
   // 聞き取りやすい短い二連ベル。音量設定に従い、近くにいる間だけ反復する。
   phoneRingTimer=-1;burst();phoneRingTimer=setInterval(burst,2500);
  },
  stopPhoneRing(){if(phoneRingTimer&&phoneRingTimer!==-1)clearInterval(phoneRingTimer);phoneRingTimer=0},
  startDisasterAmbience(kind,initialIntensity=1){beginDisasterAmbience(kind,initialIntensity)},
  setDisasterAmbienceIntensity(intensity){
   if(!ac||!disasterAmbienceBeds.length)return;const value=Math.max(0,Math.min(1,Number(intensity)||0)),t=ac.currentTime;
   for(const b of disasterAmbienceBeds){try{b.gain.gain.setTargetAtTime(Math.max(.0001,b.baseLevel*value),t,.8);b.mod.gain.setTargetAtTime(b.baseDepth*value,t,.8)}catch(e){}}
  },
  stopDisasterAmbience(){endDisasterAmbience()},
  playDisasterSound(kind, cue='start', location=null){
   if(!ac||vol<=0)return;
   const t=ac.currentTime;
   // Source coordinates are THREE.js world coordinates, matching updateListener(cam.position, cam.quaternion).
   const makeOutput=(node)=>{
    if(location&&ac.createPanner){
     try{
      const p=ac.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=6;p.maxDistance=110;p.rolloffFactor=.58;p.coneInnerAngle=360;p.coneOuterAngle=360;p.coneOuterGain=1;
      const x=Math.max(-256,Math.min(256,Number(location.x)||0)),y=Math.max(-256,Math.min(256,Number(location.y)||0)),z=Math.max(-256,Math.min(256,Number(location.z)||0));
      if(p.positionX&&typeof p.positionX.setValueAtTime==='function'){p.positionX.setValueAtTime(x,t);p.positionY.setValueAtTime(y,t);p.positionZ.setValueAtTime(z,t)}else p.setPosition(x,y,z);
      node.connect(p);p.connect(gm);return p;
     }catch(e){}
    }
    node.connect(gm);return null;
   };
   const makeNoise=(delay,duration,cutoff,peak,highpass=70)=>{
    let src,hp,lp,gain,panner;
    try{
     const d=Math.max(.12,Math.min(3,duration)),len=Math.max(1,Math.floor(ac.sampleRate*d));
     const buffer=ac.createBuffer(1,len,ac.sampleRate),data=buffer.getChannelData(0);
     for(let i=0;i<len;i++){
      const x=i/Math.max(1,len-1),env=Math.pow(Math.max(0,Math.sin(Math.PI*x)),.36)*(1-.22*x);
      data[i]=(Math.random()*2-1)*env;
     }
     src=ac.createBufferSource();hp=ac.createBiquadFilter();lp=ac.createBiquadFilter();gain=ac.createGain();src.buffer=buffer;hp.type='highpass';hp.frequency.value=highpass;lp.type='lowpass';lp.frequency.value=cutoff;
     gain.gain.setValueAtTime(.0001,t+delay);gain.gain.linearRampToValueAtTime(Math.max(.0001,peak),t+delay+Math.min(.18,d*.22));gain.gain.exponentialRampToValueAtTime(.0001,t+delay+d);
     src.connect(hp);hp.connect(lp);lp.connect(gain);panner=makeOutput(gain);src.start(t+delay);src.stop(t+delay+d+.025);
     src.onended=()=>{try{src.disconnect();hp.disconnect();lp.disconnect();gain.disconnect();if(panner)panner.disconnect()}catch(e){}};
    }catch(e){}
   };
   const sweep=(delay,duration,startFreq,endFreq,peak,wave='sine')=>{
    let o,lp,gain,panner;
    try{
     const d=Math.max(.12,Math.min(2,duration));o=ac.createOscillator();lp=ac.createBiquadFilter();gain=ac.createGain();
     o.type=wave;o.frequency.setValueAtTime(startFreq,t+delay);o.frequency.exponentialRampToValueAtTime(Math.max(25,endFreq),t+delay+d);lp.type='lowpass';lp.frequency.value=1800;
     gain.gain.setValueAtTime(.0001,t+delay);gain.gain.linearRampToValueAtTime(Math.max(.0001,peak),t+delay+.025);gain.gain.exponentialRampToValueAtTime(.0001,t+delay+d);
     o.connect(lp);lp.connect(gain);panner=makeOutput(gain);o.start(t+delay);o.stop(t+delay+d+.025);
     o.onended=()=>{try{o.disconnect();lp.disconnect();gain.disconnect();if(panner)panner.disconnect()}catch(e){}};
    }catch(e){}
   };
   if(kind==='storm'){
    if(cue==='start')makeNoise(0,1.9,780,.035,80);
    else if(cue==='thunder'){
     // One localized crack followed by a deeper, longer rumble; distance controls attenuation and direction.
     makeNoise(0,2.4,330,.15,34);sweep(.02,1.8,76,34,.10,'sine');makeNoise(.08,1.4,760,.035,120);
    }else if(cue==='gust')makeNoise(0,1.8,580,.032,78);
   }else if(kind==='meteor-shower'){
    if(cue==='start')sweep(0,.75,900,210,.025,'triangle');
    else if(cue==='whoosh'){makeNoise(0,.72,1500,.028,230);sweep(0,.67,920,125,.035,'sine');}
   }else if(kind==='meteor-impact'){
    if(cue==='start'){makeNoise(0,.9,2100,.022,360);sweep(0,1.0,1200,320,.026,'sine')}
    else if(cue==='impact'){
     // Separate low-end impact, deep decaying body and a short bright debris crack.
     makeNoise(0,2.7,420,.22,30);sweep(.01,1.9,124,27,.15,'sine');makeNoise(.012,.42,3600,.065,620);makeNoise(.09,1.55,900,.048,95);
    }
   }else if(kind==='blizzard'){
    if(cue==='start')makeNoise(0,2.5,1050,.042,85);
    else if(cue==='gust'){makeNoise(0,2.4,980,.055,75);sweep(.04,1.9,260,110,.025,'triangle')}
   }
  },
  playFootstep(pan=0,strength=.16){
   // 音声素材なしで作る、短く湿った足音。イベント時だけバッファを生成する。
   if(!ac||vol<=0)return;
   try{
    const t=ac.currentTime,d=.19,len=Math.max(1,Math.floor(ac.sampleRate*d));
    const b=ac.createBuffer(1,len,ac.sampleRate),a=b.getChannelData(0);
    for(let i=0;i<len;i++){
     const u=i/len,env=Math.pow(Math.max(0,1-u),3.4);
     a[i]=(Math.random()*2-1)*env;
    }
    const src=ac.createBufferSource(),lp=ac.createBiquadFilter(),g=ac.createGain(),panNode=ac.createStereoPanner?ac.createStereoPanner():null;
    src.buffer=b;lp.type='lowpass';lp.frequency.value=680;lp.Q.value=.65;
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.001,strength),t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+d);
    src.connect(lp);lp.connect(g);
    if(panNode){panNode.pan.setValueAtTime(Math.max(-.92,Math.min(.92,pan)),t);g.connect(panNode);panNode.connect(gm)}else g.connect(gm);
    src.start(t);src.stop(t+d);
    // 靴底の低い接地音を重ね、単なるホワイトノイズに聞こえないようにする。
    const thud=ac.createOscillator(),tg=ac.createGain();thud.type='sine';thud.frequency.setValueAtTime(105,t);thud.frequency.exponentialRampToValueAtTime(58,t+.085);tg.gain.setValueAtTime(Math.max(.0001,strength*.34),t);tg.gain.exponentialRampToValueAtTime(.0001,t+.11);thud.connect(tg);tg.connect(gm);thud.start(t);thud.stop(t+.12);
   }catch(e){}
  },
  playWhisperVoice(text){
   if(!ac||vol<=0)return;
   // 音声合成の声を毎回ランダムに選んだり、極端に低いピッチにしない。
   // 乾いた短い息音を先に置き、声は小さめ・一定の設定で少し遅れて始める。
   const token=++speechToken;const bt=ac.currentTime,side=Math.random()<.5?-1:1;
   if(creatureVoiceStartTimer){clearTimeout(creatureVoiceStartTimer);creatureVoiceStartTimer=0}
   breath(bt,.72,Math.min(.028,vol*.045),side*.82);breath(bt+.25,.62,Math.min(.018,vol*.029),side*-.5);
   if(phoneVoiceStartTimer){clearTimeout(phoneVoiceStartTimer);phoneVoiceStartTimer=0}
   let spoke=false;
   try{
    if('speechSynthesis' in window && typeof SpeechSynthesisUtterance!=='undefined'){
     const synth=window.speechSynthesis;
     synth.cancel();
     const u=new SpeechSynthesisUtterance(String(text||'……'));
     u.lang='ja-JP';u.rate=.82;u.pitch=.82;u.volume=Math.max(0,Math.min(.34,vol*.32));
     const voice=chooseJapaneseVoice(synth);if(voice)u.voice=voice;
     phoneVoiceStartTimer=setTimeout(()=>{
      phoneVoiceStartTimer=0;if(token!==speechToken||vol<=0)return;
      try{synth.speak(u);spoke=true}catch(e){}
     },420);
     // TTS unavailable: leave only the breath sound. No captions are shown.
     spoke=true;
    }
   }catch(e){}
   if(!spoke){try{const t=ac.currentTime;noise(t+.4,.55,Math.max(.001,vol*.016));noise(t+.82,.62,Math.max(.001,vol*.012))}catch(e){}}
  },
  playPhoneVoice(text){
   if(!ac||vol<=0)return;
   const token=++speechToken;
   if(creatureVoiceStartTimer){clearTimeout(creatureVoiceStartTimer);creatureVoiceStartTimer=0}
   if(phoneVoiceStartTimer){clearTimeout(phoneVoiceStartTimer);phoneVoiceStartTimer=0}
   // 音声ファイル不要の受話クリック＋通話中の細い帯域ノイズ。
   // SpeechSynthesisの声自体はOSミキサーから直接出力されるためフィルターを直結できない。
   // 代わりに通話中だけ帯域制限ノイズと微かな回線ハムを重ね、電話らしい質感を補う。
   clearPhoneBed();
   try{
    const t=ac.currentTime;
    tone(980,t,.035,'square',Math.min(.075,vol*.13));
    tone(430,t+.045,.075,'sine',Math.min(.055,vol*.095));
    const textLength=String(text||'').length,bedDuration=Math.max(2.8,Math.min(5.6,textLength*.15));
    const d=bedDuration,len=Math.max(1,Math.floor(ac.sampleRate*d)),buf=ac.createBuffer(1,len,ac.sampleRate),arr=buf.getChannelData(0);
    for(let i=0;i<len;i++){
     const u=i/len,fade=Math.min(1,i/(ac.sampleRate*.08))*Math.min(1,(len-i)/(ac.sampleRate*.42));
     const flutter=1-(Math.sin(u*17*Math.PI)*.5+.5)*.16;
     arr[i]=(Math.random()*2-1)*fade*flutter;
    }
    const src=ac.createBufferSource(),hp=ac.createBiquadFilter(),bp=ac.createBiquadFilter(),lp=ac.createBiquadFilter(),g=ac.createGain();
    src.buffer=buf;hp.type='highpass';hp.frequency.value=260;bp.type='bandpass';bp.frequency.value=1450;bp.Q.value=.62;lp.type='lowpass';lp.frequency.value=2600;
    g.gain.setValueAtTime(.0001,t+.12);g.gain.linearRampToValueAtTime(Math.min(.016,vol*.025),t+.32);g.gain.setValueAtTime(Math.min(.009,vol*.014),t+1.1);g.gain.setValueAtTime(Math.min(.013,vol*.020),t+2.2);g.gain.exponentialRampToValueAtTime(.0001,t+d);
    src.connect(hp);hp.connect(bp);bp.connect(lp);lp.connect(g);g.connect(gm);src.start(t+.12);src.stop(t+d+.02);phoneBedNodes.push(src);
    const hum=ac.createOscillator(),hf=ac.createBiquadFilter(),hg=ac.createGain();hum.type='sawtooth';hum.frequency.value=92;hf.type='bandpass';hf.frequency.value=390;hf.Q.value=1.1;hg.gain.setValueAtTime(.0001,t+.14);hg.gain.linearRampToValueAtTime(Math.min(.003,vol*.0045),t+.4);hg.gain.exponentialRampToValueAtTime(.0001,t+d);hum.connect(hf);hf.connect(hg);hg.connect(gm);hum.start(t+.14);hum.stop(t+d+.02);phoneBedNodes.push(hum);
   }catch(e){}
   const fallback=()=>{
    // 音声合成が使えない環境では、字幕を出さずに低い回線音で代替する。
    try{const t=ac.currentTime,o=ac.createOscillator(),f=ac.createBiquadFilter(),g=ac.createGain();o.type='sawtooth';o.frequency.setValueAtTime(155,t);o.frequency.exponentialRampToValueAtTime(72,t+2.5);f.type='bandpass';f.frequency.value=460;f.Q.value=2.2;g.gain.setValueAtTime(Math.max(.0001,vol*.045),t);g.gain.exponentialRampToValueAtTime(.0001,t+2.5);o.connect(f);f.connect(g);g.connect(gm);o.start(t);o.stop(t+2.55)}catch(e){}
   };
   // 接続音のあとに一拍空け、毎回同じ声・同じ読み上げ設定を使う。
   // ランダムな低ピッチ／低速読み上げが、コミカルで過度に機械的になるのを避ける。
   phoneVoiceStartTimer=setTimeout(()=>{
    phoneVoiceStartTimer=0;
    if(token!==speechToken)return;
    let spoke=false;
    try{
     if('speechSynthesis' in window && typeof SpeechSynthesisUtterance!=='undefined'){
      const synth=window.speechSynthesis;
      synth.cancel();
      const u=new SpeechSynthesisUtterance(String(text||'……もしもし。'));
      u.lang='ja-JP';u.rate=.88;u.pitch=.9;u.volume=Math.max(0,Math.min(.76,vol*.76));
      // 電話と囁きは可能な範囲で同じ日本語音声を固定して使う。
      const voice=chooseJapaneseVoice(synth);if(voice)u.voice=voice;
      u.onerror=()=>{if(token===speechToken&&vol>0)fallback()};
      synth.speak(u);spoke=true;
     }
    }catch(e){}
    if(!spoke&&vol>0)fallback();
   },290);
  },
  stopPhoneVoice(){speechToken++;forestVoiceToken++;wiseVoiceToken++;if(wiseVoiceStartTimer){clearTimeout(wiseVoiceStartTimer);wiseVoiceStartTimer=0}if(phoneVoiceStartTimer){clearTimeout(phoneVoiceStartTimer);phoneVoiceStartTimer=0}if(creatureVoiceStartTimer){clearTimeout(creatureVoiceStartTimer);creatureVoiceStartTimer=0}if(forestVoiceStartTimer){clearTimeout(forestVoiceStartTimer);forestVoiceStartTimer=0}clearPhoneBed();try{if('speechSynthesis' in window)window.speechSynthesis.cancel()}catch(e){}},
  setVol(v){vol=v;lsSet('rkb_vol',v);if(gm)gm.gain.value=v},
  setBgm(b){bgm=b;lsSet('rkb_bgm',b?'1':'0');run()}
 };
})();
['pointerdown','keydown'].forEach(t=>addEventListener(t,()=>Snd.init(),{passive:true}));
let tool=11,cur=toC('#212121'),sz=1,locked=false,typing=false,started=false,drawing=null,lastPix=null,hit=null,room='-',myName='';
const penTool=()=>BN.length;
const isPen=()=>tool>=penTool();
let placeHeld=false,placeAcc=0;
/** 連置間隔（秒）。マイクラの約4tick=0.2s。初回は押した瞬間に即置き */
const PLACE_REPEAT_SEC=0.2;
let placeLockAxis=null,placeLockU=0,placeLockV=0,placeOkCount=0,placeDenyAt=0; // 連置: 2個目以降は同じ一直線のみ
let breakHeld=false,breakAcc=0,breakTarget=null;
const BREAK_SEC=0.45; // 落書き付きブロックのみ長押しで破壊
function ensureBreakBar(){
 let el=$('breakBar');
 if(!el){
  el=document.createElement('div');el.id='breakBar';
  el.innerHTML='<div class="bb-label">落書き付き — 長押しで壊す</div><div class="bb-track"><div class="bb-fill"></div></div>';
  document.body.appendChild(el);
 }
 return el;
}
function showBreakProg(p){
 const el=ensureBreakBar();
 el.classList.add('on');
 const fill=el.querySelector('.bb-fill');
 if(fill)fill.style.width=Math.max(0,Math.min(1,p))*100+'%';
}
function hideBreakProg(){
 const el=$('breakBar');if(el){el.classList.remove('on');const f=el.querySelector('.bb-fill');if(f)f.style.width='0%'}
}
/** 無地は即破壊、落書き付きは長押し開始。true=処理した */
function tryStartBreak(x,y,z){
 if(isPhoneStationBlock(x,y,z)){toast('電話ゲーム端末は壊せません');return true}
 if(!canBlk())return false;
 if(!get(x,y,z))return false;
 if(!blockHasPaint(x,y,z)){
  setBlock(x,y,z,0,true);
  breakHeld=false;breakAcc=0;breakTarget=null;hideBreakProg();
  return true;
 }
 breakHeld=true;breakAcc=0;breakTarget={x,y,z};
 showBreakProg(0);
 return true;
}

let penMode=ls('rkb_pen','aim')==='cursor'?'cursor':'aim',sens=Math.min(2,Math.max(.3,parseFloat(ls('rkb_sens','1'))||1)),menu=false,menuAt=0,skipMenu=false,panning=false,phonePanelOpen=false,mx=innerWidth/2,my=innerHeight/2;
const TOUCH=matchMedia('(pointer:coarse)').matches,stick={x:0,y:0},tp=new Map();
let usePress=ls('rkb_press','1')==='1',penDev=false,pressure=.5,picking=false,pickReq=false,viewMode=0,emoOpen=false,shotReq=false,saveDirty=false,saveT=0;
const DISASTER_DURATION_MS={storm:120000,'meteor-shower':19000,'meteor-impact':12500,blizzard:90000};
const DISASTER_LABELS={storm:'雷雨・暴風雨','meteor-shower':'流星群','meteor-impact':'隕石落下',blizzard:'吹雪'};
let disastersEnabled=true,activeDisasterFx=null;
function disasterRandom(seed){let x=(Number(seed)>>>0)||0x6d2b79f5;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}
const DISASTER_UP=new THREE.Vector3(0,1,0);
function disasterClamp(v,a,b){return Math.max(a,Math.min(b,v))}
function disasterSmoothstep(v){const t=disasterClamp(v,0,1);return t*t*(3-2*t)}
function disasterWeatherIntensity(kind,elapsedMs,durationMs){
 if(kind!=='storm'&&kind!=='blizzard')return 1;
 const elapsedSec=Math.max(0,elapsedMs)/1000,durationSec=Math.max(1,durationMs/1000);
 const rampInSec=kind==='storm'?12:13,rampOutSec=kind==='storm'?24:20;
 const inGain=disasterSmoothstep(elapsedSec/rampInSec),outGain=disasterSmoothstep((durationSec-elapsedSec)/rampOutSec);
 const wave=kind==='storm'?.91+.06*Math.sin(elapsedSec*.19)+.03*Math.sin(elapsedSec*.47):.84+.11*Math.sin(elapsedSec*.16)+.05*Math.sin(elapsedSec*.39);
 return disasterClamp(Math.min(inGain,outGain)*wave,0,1);
}
function disasterGroundY(x,z){
 const gx=disasterClamp(Math.floor(x),0,W-1),gz=disasterClamp(Math.floor(z),0,D-1);
 for(let y=H-1;y>=0;y--)if(get(gx,y,gz))return y+1;
 return 1;
}
function disasterGroundPoint(distance,lateral){
 const forward=cam.getWorldDirection(new THREE.Vector3());forward.y=0;
 if(forward.lengthSq()<.001)forward.set(0,0,-1);forward.normalize();
 const right=new THREE.Vector3(-forward.z,0,forward.x);
 const x=disasterClamp(cam.position.x+forward.x*distance+right.x*lateral,2,W-3);
 const z=disasterClamp(cam.position.z+forward.z*distance+right.z*lateral,2,D-3);
 return new THREE.Vector3(x,disasterGroundY(x,z)+.04,z);
}
function disasterWorldGroundPoint(rand){
 // 各イベントのseedでワールド全域から選ぶ。中央の32x32だけに偏らせず、毎回違う場所に分散させる。
 const x=disasterClamp(3+rand()*(W-6),2,W-3),z=disasterClamp(3+rand()*(D-6),2,D-3);
 return new THREE.Vector3(x,disasterGroundY(x,z)+.04,z);
}
function chooseDisasterTarget(rand,localView,distance,lateral){
 if(!localView)return disasterWorldGroundPoint(rand);
 // 管理者のローカル試験は前方だけに偏らせず、周囲360度の地形から選ぶ。
 const angle=rand()*Math.PI*2,r=Math.max(4,distance),side=Number(lateral)||0;
 const x=disasterClamp(cam.position.x+Math.cos(angle)*r-Math.sin(angle)*side,2,W-3);
 const z=disasterClamp(cam.position.z+Math.sin(angle)*r+Math.cos(angle)*side,2,D-3);
 return new THREE.Vector3(x,disasterGroundY(x,z)+.04,z);
}
function setDisasterSegment(mesh,a,b){
 const dir=new THREE.Vector3().subVectors(b,a),len=dir.length();
 if(len<.001){mesh.visible=false;return}
 mesh.visible=true;mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(DISASTER_UP,dir.normalize());mesh.scale.set(1,len,1);
}
function disasterMesh(geometry,material,group){const m=new THREE.Mesh(geometry,material);group.add(m);return m}
function disasterMaterial(color,opacity=1,opts={}){
 return new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthTest:true,depthWrite:false,fog:true,side:opts.side||THREE.FrontSide,blending:opts.additive?THREE.AdditiveBlending:THREE.NormalBlending});
}
function addBoltPath(group,points,glowMat,coreMat,glowGeo,coreGeo,glowScale=1){
 const segs=[];
 for(let i=1;i<points.length;i++){
  const glow=disasterMesh(glowGeo,glowMat,group),core=disasterMesh(coreGeo,coreMat,group);
  setDisasterSegment(glow,points[i-1],points[i]);setDisasterSegment(core,points[i-1],points[i]);
  glow.scale.x=glow.scale.z=glowScale;core.scale.x=core.scale.z=glowScale;segs.push({glow,core});
 }
 return segs;
}
function createLightningStrike(parent,rand,at,target){
 const group=new THREE.Group();parent.add(group);group.visible=false;
 const glowMat=disasterMaterial(0x3b8dff,.72,{additive:true}),coreMat=disasterMaterial(0xeaf7ff,.98,{additive:true});
 const glowGeo=new THREE.CylinderGeometry(.15,.20,1,5,1),coreGeo=new THREE.CylinderGeometry(.035,.055,1,5,1);
 const start=new THREE.Vector3(target.x+(rand()-.5)*5,Math.min(30,target.y+19+rand()*3),target.z+(rand()-.5)*5);
 const main=[],steps=18;
 for(let i=0;i<=steps;i++){
  const t=i/steps,fade=1-t;
  main.push(new THREE.Vector3(
   start.x+(target.x-start.x)*t+(i===steps?0:(rand()-.5)*(3.4*fade+.1)),
   start.y+(target.y-start.y)*t,
   start.z+(target.z-start.z)*t+(i===steps?0:(rand()-.5)*(3.4*fade+.1))
  ));
 }
 const paths=[main];
 for(let b=0,n=3+Math.floor(rand()*3);b<n;b++){
  const idx=3+Math.floor(rand()*10),base=main[idx],dir=rand()<.5?-1:1,pts=[base.clone()];let last=base.clone();
  const count=3+Math.floor(rand()*3);
  for(let j=0;j<count;j++){
   last=new THREE.Vector3(last.x+dir*(.6+rand()*1.25),Math.max(target.y+.2,last.y-(.65+rand()*1.35)),last.z+(rand()-.5)*1.6);pts.push(last.clone());
  }
  paths.push(pts);
 }
 const allSegs=[];
 for(let i=0;i<paths.length;i++)allSegs.push(...addBoltPath(group,paths[i],glowMat,coreMat,glowGeo,coreGeo,i===0?1:.55));
 // 落雷地点も立体オブジェクトにする。地面に沿ったリングと、低い発光だまり。
 const ringGeo=new THREE.TorusGeometry(1,.045,5,32);const ringMat=disasterMaterial(0xb8dcff,.9,{additive:true});
 const ring=disasterMesh(ringGeo,ringMat,group);ring.rotation.x=Math.PI/2;ring.position.copy(target);ring.position.y+=.08;ring.scale.set(.9,.9,.9);
 const impactGeo=new THREE.SphereGeometry(1,10,7),impactMat=disasterMaterial(0x91c9ff,.43,{additive:true});
 const impact=disasterMesh(impactGeo,impactMat,group);impact.position.copy(target);impact.position.y+=.18;impact.scale.set(1.8,.14,1.8);
 return{at,target,group,allSegs,glowMat,coreMat,ring,ringMat,impact,impactMat,thundered:false};
}
function makeWeatherField(parent,rand,kind,count){
 const snow=kind==='blizzard',geo=new THREE.BoxGeometry(snow?.025:.018,1,snow?.025:.018);
 const mat=disasterMaterial(snow?0xf1f7ff:0xb4d5ee,snow?.68:.45);
 const mesh=new THREE.InstancedMesh(geo,mat,count);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;parent.add(mesh);
 const particles=Array.from({length:count},()=>({
  x:(rand()-.5)*48,y:rand()*24-5,z:(rand()-.5)*48,
  vx:snow?-7-rand()*8:-5-rand()*9,vy:snow?-.8-rand()*3:-17-rand()*12,vz:snow?-2.8+rand()*5.6:-1.5+rand()*3,
  len:snow?.22+rand()*.7:.75+rand()*1.4,phase:rand()*Math.PI*2,gx:-1,gz:-1,ground:1
 }));
 return{mesh,particles,weatherKind:kind,baseOpacity:mat.opacity,dummy:new THREE.Object3D(),up:new THREE.Vector3(0,1,0),dir:new THREE.Vector3(),rand};
}
function updateWeatherField(state,dt,elapsedSec){
 const field=state.weather,center=state.weatherRoot;
 if(!field||!center)return;
 const isSnow=state.kind==='blizzard',intensity=disasterClamp(state.intensity??1,0,1),gust=1+(isSnow?.34:.24)*Math.sin(elapsedSec*(isSnow?.86:1.25)+.8);
 field.mesh.material.opacity=field.baseOpacity*(.12+.88*intensity);
 const flowScale=.70+.30*intensity;
 for(let i=0;i<field.particles.length;i++){
  const p=field.particles[i];p.x+=p.vx*gust*flowScale*dt;p.y+=p.vy*gust*flowScale*dt;p.z+=p.vz*gust*flowScale*dt;
  let wx=center.position.x+p.x,wz=center.position.z+p.z;
  // 粒子はワールドに置いたまま流し、視界から十分離れた粒子だけをプレイヤー周辺へ再投入する。
  // 雨雪の群れ自体を毎フレームカメラへ貼り付けない。
  if(Math.hypot(wx-cam.position.x,wz-cam.position.z)>35){p.x=cam.position.x-center.position.x+(field.rand()-.5)*48;p.z=cam.position.z-center.position.z+(field.rand()-.5)*48;p.gx=-1;p.gz=-1;wx=center.position.x+p.x;wz=center.position.z+p.z}
  const gx=disasterClamp(Math.floor(wx),0,W-1),gz=disasterClamp(Math.floor(wz),0,D-1);
  if(gx!==p.gx||gz!==p.gz){p.gx=gx;p.gz=gz;p.ground=disasterGroundY(gx,gz)}
  if(center.position.y+p.y<p.ground+.25||p.y< -12){p.y=Math.max(9,p.ground+8-center.position.y)+Math.random()*8;p.x=(Math.random()-.5)*48;p.z=(Math.random()-.5)*48;p.gx=-1}
  const d=field.dummy;d.position.set(p.x,p.y,p.z);field.dir.set(p.vx,p.vy,p.vz).normalize();d.quaternion.setFromUnitVectors(field.up,field.dir);d.scale.set(1,p.len*(.38+.62*intensity)*(.86+.14*Math.sin(elapsedSec*3+p.phase)),1);d.updateMatrix();field.mesh.setMatrixAt(i,d.matrix);
 }
 field.mesh.instanceMatrix.needsUpdate=true;
}
function createStormClouds(parent,rand){
 // 暗い青灰色の雲は雷雨・暴風雨イベント専用。色は #334257。雲の形・高さ・配置は維持する。
 const root=new THREE.Group();parent.add(root);
 const mat=disasterMaterial(0x334257,.82),geo=new THREE.SphereGeometry(1,9,6);
 const count=9; // 雨雲の覆いを増やし、青空が抜ける隙間を減らす。雲の色・高度・形状は維持。
 for(let i=0;i<count;i++){
  const bank=new THREE.Group();root.add(bank);bank.position.set((rand()-.5)*43,13+rand()*7,(rand()-.5)*43);bank.userData.phase=rand()*Math.PI*2;bank.userData.baseX=bank.position.x;
  const puffs=5;
  for(let j=0;j<puffs;j++){
   const m=disasterMesh(geo,mat,bank);m.position.set((rand()-.5)*7,(rand()-.5)*1.8,(rand()-.5)*4.5);m.scale.set(2.2+rand()*3.2,1.2+rand()*1.9,2+rand()*2.4);
  }
 }
 return root;
}
function createBlizzardCloudDeck(parent,rand){
 // 吹雪は明るい灰色の雲層を使用。黒い雲色は使わず、山頂より上に置いて地表の雪煙と混同させない。
 const root=new THREE.Group();parent.add(root);
 const mat=disasterMaterial(0xaab6c1,.84),geo=new THREE.SphereGeometry(1,12,8),dummy=new THREE.Object3D();
 const cols=5,rows=5;
 for(let i=0;i<cols*rows;i++){
  const gx=i%cols,gz=Math.floor(i/cols),bank=new THREE.Group();root.add(bank);
  bank.position.set((gx-(cols-1)/2)*14.5+(rand()-.5)*2.5,35+rand()*2.6,(gz-(rows-1)/2)*14.5+(rand()-.5)*2.5);
  bank.userData.phase=rand()*Math.PI*2;bank.userData.baseX=bank.position.x;
  const puffs=6+Math.floor(rand()*3),mesh=new THREE.InstancedMesh(geo,mat,puffs);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);mesh.frustumCulled=false;bank.add(mesh);
  for(let j=0;j<puffs;j++){
   const px=(rand()-.5)*10.5,py=(rand()-.5)*1.4,pz=(rand()-.5)*10.5;
   dummy.position.set(px,py,pz);dummy.scale.set(4.8+rand()*3.0,2.0+rand()*1.25,4.8+rand()*3.0);
   dummy.rotation.set((rand()-.5)*.06,rand()*Math.PI,(rand()-.5)*.06);dummy.updateMatrix();mesh.setMatrixAt(j,dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;
 }
 return root;
}

function createMeteorTrailBatch(parent,count){
 const glowGeo=new THREE.CylinderGeometry(.14,.20,1,6,1),coreGeo=new THREE.CylinderGeometry(.04,.06,1,5,1);
 const glowMat=disasterMaterial(0xff8c47,.56,{additive:true}),coreMat=disasterMaterial(0xffe9ba,.92,{additive:true});
 const glow=new THREE.InstancedMesh(glowGeo,glowMat,count*6),core=new THREE.InstancedMesh(coreGeo,coreMat,count*6);
 glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);glow.frustumCulled=false;core.frustumCulled=false;
 parent.add(glow,core);const dummy=new THREE.Object3D();dummy.scale.set(0,0,0);dummy.updateMatrix();
 for(let i=0;i<count*6;i++){glow.setMatrixAt(i,dummy.matrix);core.setMatrixAt(i,dummy.matrix)}
 glow.instanceMatrix.needsUpdate=true;core.instanceMatrix.needsUpdate=true;
 return{glow,core,glowGeo,coreGeo,glowMat,coreMat,dummy,dir:new THREE.Vector3(),count};
}
function setDisasterInstanceSegment(batch,layer,index,a,b,widthScale){
 const d=batch.dummy;
 if(widthScale<=.001){d.scale.set(0,0,0);d.position.set(0,0,0);d.updateMatrix();batch[layer].setMatrixAt(index,d.matrix);return}
 const dir=batch.dir.subVectors(b,a),len=dir.length();if(len<.001){d.scale.set(0,0,0);d.position.set(0,0,0);d.updateMatrix();batch[layer].setMatrixAt(index,d.matrix);return}
 d.position.copy(a).add(b).multiplyScalar(.5);d.quaternion.setFromUnitVectors(DISASTER_UP,dir.normalize());d.scale.set(widthScale,len,widthScale);d.updateMatrix();batch[layer].setMatrixAt(index,d.matrix);
}
function createMeteor(parent,rand,startMs,kind,target,trailBatch=null,trailOffset=0){
 const group=new THREE.Group();parent.add(group);group.visible=false;
 let start,end,control;
 if(kind==='meteor-impact'){
  start=new THREE.Vector3(target.x+(rand()-.5)*8,Math.min(30,target.y+22),target.z+(rand()-.5)*8);
  end=target.clone();
  control=new THREE.Vector3((start.x+end.x)*.5+(rand()-.5)*3,(start.y+end.y)*.5+5,(start.z+end.z)*.5+(rand()-.5)*3);
 }else{
  start=new THREE.Vector3(target.x+(rand()-.5)*12,Math.min(30,target.y+16+rand()*6),target.z+(rand()-.5)*12);
  end=new THREE.Vector3(disasterClamp(target.x+(rand()-.5)*7,2,W-3),target.y+3+rand()*5,disasterClamp(target.z+(rand()-.5)*7,2,D-3));
  control=new THREE.Vector3((start.x+end.x)*.5+(rand()-.5)*3,(start.y+end.y)*.5+rand()*3,(start.z+end.z)*.5+(rand()-.5)*3);
 }
 const curve=new THREE.QuadraticBezierCurve3(start,control,end),depth=.3+rand()*.7;
 const outerGeo=new THREE.IcosahedronGeometry(kind==='meteor-impact'?.48:.15+depth*.16,1),innerGeo=new THREE.SphereGeometry(kind==='meteor-impact'?.19:.065+depth*.055,9,7);
 const outerMat=disasterMaterial(kind==='meteor-impact'?0xff5e23:0xff8f48,kind==='meteor-impact'?.84:.65,{additive:true});
 const innerMat=disasterMaterial(kind==='meteor-impact'?0xfff0b6:0xffeac5,.98,{additive:true});
 const outer=disasterMesh(outerGeo,outerMat,group),inner=disasterMesh(innerGeo,innerMat,group);
 let trail=[],trailGlowGeo=null,trailCoreGeo=null,trailGlowMat=null,trailCoreMat=null;
 if(trailBatch){for(let i=0;i<6;i++)trail.push({batch:trailBatch,index:trailOffset+i})}
 else{
  trailGlowGeo=new THREE.CylinderGeometry(kind==='meteor-impact'?.32:.075+depth*.06,kind==='meteor-impact'?.48:.13+depth*.09,1,6,1);
  trailCoreGeo=new THREE.CylinderGeometry(kind==='meteor-impact'?.11:.026+depth*.022,kind==='meteor-impact'?.18:.05+depth*.035,1,5,1);
  trailGlowMat=disasterMaterial(kind==='meteor-impact'?0xff4a1e:0xff8c47,kind==='meteor-impact'?.67:.55,{additive:true});
  trailCoreMat=disasterMaterial(0xffe8b3,.91,{additive:true});
  for(let i=0;i<6;i++)trail.push({glow:disasterMesh(trailGlowGeo,trailGlowMat,group),core:disasterMesh(trailCoreGeo,trailCoreMat,group)});
 }
 return{group,startMs,lifeMs:kind==='meteor-impact'?4040:1050+depth*620,curve,outer,inner,outerMat,innerMat,trail,trailBatch,trailGlowMat:trailBatch?trailBatch.glowMat:trailGlowMat,trailCoreMat:trailBatch?trailBatch.coreMat:trailCoreMat,kind,depth,impactDone:false};
}
function createMeteorImpactBurst(parent,rand,target){
 const root=new THREE.Group();parent.add(root);root.position.copy(target);root.visible=false;
 const ringGeo=new THREE.TorusGeometry(1,.035,5,40),ringMats=[disasterMaterial(0xffae58,.92,{additive:true}),disasterMaterial(0xff6f35,.72,{additive:true})];
 const rings=ringMats.map((mat,i)=>{const r=disasterMesh(ringGeo,mat,root);r.rotation.x=Math.PI/2;r.position.y=.13+i*.035;return r});
 const flashGeo=new THREE.SphereGeometry(1,10,7),flashMat=disasterMaterial(0xff9b45,.72,{additive:true});
 const flash=disasterMesh(flashGeo,flashMat,root);flash.position.y=.55;flash.scale.set(.5,.5,.5);
 const dummy=new THREE.Object3D();
 const smokeMat=disasterMaterial(0x89909a,.26),smokeGeo=new THREE.SphereGeometry(1,8,6),smokeMesh=new THREE.InstancedMesh(smokeGeo,smokeMat,25);smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);smokeMesh.frustumCulled=false;root.add(smokeMesh);
 const smoke=Array.from({length:25},(_,index)=>({index,angle:rand()*Math.PI*2,speed:1.2+rand()*5.2,up:1.5+rand()*5.5,size:.45+rand()*1.6,phase:rand()*Math.PI*2}));
 const sparkMat=disasterMaterial(0xffb85c,.98,{additive:true}),sparkGeo=new THREE.IcosahedronGeometry(.09,0),sparkMesh=new THREE.InstancedMesh(sparkGeo,sparkMat,38);sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);sparkMesh.frustumCulled=false;root.add(sparkMesh);
 const sparks=Array.from({length:38},(_,index)=>{const a=rand()*Math.PI*2,s=3+rand()*11;return{index,vx:Math.cos(a)*s,vz:Math.sin(a)*s,vy:2+rand()*8,size:.45+rand()*1.3,phase:rand()*Math.PI*2}});
 const debrisMat=disasterMaterial(0x454b51,.93),debrisGeo=new THREE.IcosahedronGeometry(.19,0),debrisMesh=new THREE.InstancedMesh(debrisGeo,debrisMat,10);debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);debrisMesh.frustumCulled=false;root.add(debrisMesh);
 const debris=Array.from({length:10},(_,index)=>{const a=rand()*Math.PI*2,s=2+rand()*5;return{index,vx:Math.cos(a)*s,vz:Math.sin(a)*s,vy:1+rand()*4,spin:(rand()-.5)*4}});
 return{root,target,rings,ringMats,flash,flashMat,smoke,smokeMesh,smokeMat,sparks,sparkMesh,sparkMat,debris,debrisMesh,debrisMat,dummy};
}
// ===== ケサランパサラン大量発生（天候イベントとは独立した3Dイベント） =====
const KESARAN_DURATION_MS=48000;
let kesaranEventsEnabled=true,activeKesaranFx=null;
function stopKesaranEffect(id=null){
 const state=activeKesaranFx;if(!state|| (id&&state.id!==id))return;
 activeKesaranFx=null;
 if(state.group){scene.remove(state.group);state.group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}})}
}
function startKesaranEffect(message,force=false){
 if(!message||message.kind!=='kesaranpasaran')return false;
 if(!force&&!kesaranEventsEnabled)return false;
 const now=Date.now(),at=Number(message.at)||now,durationMs=Math.max(8000,Math.min(90000,Number(message.durationMs)||KESARAN_DURATION_MS));
 const elapsed=Math.max(0,now-at);if(elapsed>=durationMs)return false;
 stopKesaranEffect();
 const rand=disasterRandom(Number(message.seed)||((Math.random()*0x7fffffff)|0));
 const reducedMotion=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 const group=new THREE.Group();group.name='kesaranpasaran-mass-event';scene.add(group);
 const count=reducedMotion?42:88,coreGeo=new THREE.SphereGeometry(1,8,6),fluffGeo=new THREE.SphereGeometry(1,7,5);
 const coreMat=disasterMaterial(0xf7f4e8,.94),fluffMat=disasterMaterial(0xffffff,.90);
 const coreMesh=new THREE.InstancedMesh(coreGeo,coreMat,count),fluffMesh=new THREE.InstancedMesh(fluffGeo,fluffMat,count*6);
 coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);fluffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 coreMesh.frustumCulled=false;fluffMesh.frustumCulled=false;group.add(coreMesh,fluffMesh);
 const dummy=new THREE.Object3D(),particles=[];
 const localView=message.localView===true;
 for(let i=0;i<count;i++){
  let x=rand()*W,z=rand()*D;
  if(localView){x=disasterClamp(cam.position.x+(rand()-.5)*46,1,W-2);z=disasterClamp(cam.position.z+(rand()-.5)*46,1,D-2)}
  const floor=disasterGroundY(x,z);
  particles.push({x,z,y:floor+2.4+rand()*12.5,vx:(rand()-.5)*.95,vy:.10+rand()*.30,vz:(rand()-.5)*.95,phase:rand()*Math.PI*2,spin:(rand()-.5)*1.8,size:.28+rand()*.19,fluffs:Array.from({length:6},(_,j)=>({angle:j*Math.PI/3+rand()*.35,vertical:(rand()-.5)*.9,scale:.43+rand()*.20,phase:rand()*Math.PI*2}))});
 }
 const state={id:String(message.id||('kesaran-local-'+now)),kind:'kesaranpasaran',startPerf:performance.now()-elapsed,durationMs,group,coreGeo,fluffGeo,coreMat,fluffMat,coreMesh,fluffMesh,dummy,particles,localView,reducedMotion,lastElapsedMs:elapsed};
 activeKesaranFx=state;
 updateKesaranVisual(state,elapsed/1000);
 if(!force&&elapsed<2600)toast('ケサランパサランが大量発生！');
 return true;
}
function updateKesaranVisual(state,elapsedSec){
 const dummy=state.dummy,WORLD_W=W,WORLD_D=D;
 for(let i=0;i<state.particles.length;i++){
  const p=state.particles[i];
  const x=(((p.x+p.vx*elapsedSec+2)%(WORLD_W+4)+(WORLD_W+4))%(WORLD_W+4))-2;
  const z=(((p.z+p.vz*elapsedSec+2)%(WORLD_D+4)+(WORLD_D+4))%(WORLD_D+4))-2;
  const floor=disasterGroundY(disasterClamp(Math.floor(x),0,W-1),disasterClamp(Math.floor(z),0,D-1));
  const y=Math.max(floor+1.7,p.y+p.vy*elapsedSec+Math.sin(elapsedSec*1.05+p.phase)*.52);
  const size=p.size*(.92+.08*Math.sin(elapsedSec*1.8+p.phase));
  dummy.position.set(x,y,z);dummy.rotation.set(Math.sin(elapsedSec*.8+p.phase)*.35,elapsedSec*p.spin+p.phase,Math.cos(elapsedSec*.7+p.phase)*.3);dummy.scale.set(size*.66,size*.62,size*.66);dummy.updateMatrix();state.coreMesh.setMatrixAt(i,dummy.matrix);
  for(let j=0;j<p.fluffs.length;j++){
   const f=p.fluffs[j],angle=f.angle+elapsedSec*(p.spin*.34)+Math.sin(elapsedSec*.9+f.phase)*.12;
   const spread=size*.72;
   dummy.position.set(x+Math.cos(angle)*spread,y+f.vertical*size*.58+Math.sin(elapsedSec*1.25+f.phase)*size*.14,z+Math.sin(angle)*spread);
   dummy.rotation.set(Math.sin(elapsedSec+f.phase)*.4,angle,Math.cos(elapsedSec*.8+f.phase)*.4);
   const fs=size*f.scale;dummy.scale.set(fs,fs*(.88+.12*Math.sin(elapsedSec+f.phase)),fs);dummy.updateMatrix();state.fluffMesh.setMatrixAt(i*6+j,dummy.matrix);
  }
 }
 state.coreMesh.instanceMatrix.needsUpdate=true;state.fluffMesh.instanceMatrix.needsUpdate=true;
}
function renderKesaranEffect(now){
 const state=activeKesaranFx;if(!state)return;
 const elapsed=Math.max(0,performance.now()-state.startPerf);
 if(elapsed>=state.durationMs){stopKesaranEffect(state.id);return}
 updateKesaranVisual(state,elapsed/1000);state.lastElapsedMs=elapsed;
}
function applyKesaranEventsEnabled(enabled,fromServer=false,activeEvent=null){
 kesaranEventsEnabled=enabled===true;paintAdmin();
 if(!kesaranEventsEnabled)stopKesaranEffect();
 else if(activeEvent)startKesaranEffect(activeEvent);
 if(!fromServer)toast(kesaranEventsEnabled?'ケサランパサラン大量発生イベントをオンにしました':'ケサランパサラン大量発生イベントをオフにしました');
}
function setKesaranEventsEnabled(enabled){
 if(!isAdmin()){toast('イベント設定を変更できるのは管理者だけです');return}
 if(!Net.send({t:'kesaran-admin-toggle',enabled:!!enabled})){toast('サーバーに接続していません');return}
}
function previewKesaranEvent(){
 if(!isAdmin()){toast('イベントのテストは管理者専用です');return}
 closeMenu();setTimeout(()=>{
  const id='local-kesaran-test-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const ok=startKesaranEffect({id,kind:'kesaranpasaran',at:Date.now(),durationMs:KESARAN_DURATION_MS,seed:Math.floor(Math.random()*0x7fffffff),localView:true},true);
  if(ok)toast('ケサランパサラン大量発生（この画面だけのテスト）');
 },90);
}

function clearDisasterResources(state){
 if(!state||!state.group)return;
 scene.remove(state.group);const geometries=new Set(),materials=new Set();
 state.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>materials.add(m));else materials.add(o.material)}});
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
function restoreDisasterAtmosphere(){
 scene.fog.near=50;scene.fog.far=130;
 if(window._skyMat&&window._skyMat.color)window._skyMat.color.setRGB(1,1,1);
 const mats=[wm.material,sm.material,wtm.material,...omPages.map(m=>m.material)];
 for(const m of mats)if(m&&m.color)m.color.setRGB(1,1,1);
}
function stopDisasterEffect(id=null){
 if(id&&activeDisasterFx&&activeDisasterFx.id!==id)return;
 Snd.stopDisasterAmbience();clearDisasterResources(activeDisasterFx);activeDisasterFx=null;restoreDisasterAtmosphere();
}
function startDisasterEffect(message,force=false){
 if(!message||!['storm','meteor-shower','meteor-impact','blizzard'].includes(message.kind))return false;
 if(!force&&!disastersEnabled)return false;
 const now=Date.now(),at=Number(message.at)||now,durationMs=Math.max(5000,Math.min(180000,Number(message.durationMs)||DISASTER_DURATION_MS[message.kind]));
 const elapsed=Math.max(0,now-at);if(elapsed>=durationMs)return false;
 stopDisasterEffect();const rand=disasterRandom(Number(message.seed)||((Math.random()*0x7fffffff)|0)),kind=message.kind;
 const reducedMotion=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches),group=new THREE.Group();group.name='natural-disaster-world-space';scene.add(group);
 const localView=message.localView===true;
 const state={id:String(message.id||('local-'+now)),kind,startPerf:performance.now()-elapsed,durationMs,group,rand,localView,reducedMotion,lastElapsedMs:elapsed,sounds:{gust:false,whoosh1:false,whoosh2:false,impact:false},lightning:[],meteors:[],weather:null,weatherRoot:null,cloudRoot:null,impactBurst:null,intensity:disasterWeatherIntensity(kind,elapsed,durationMs),lastAmbienceIntensity:disasterWeatherIntensity(kind,elapsed,durationMs),lastAmbienceUpdateSec:0,weatherGusts:[]};
 const weatherRoot=new THREE.Group();weatherRoot.position.copy(cam.position);group.add(weatherRoot);state.weatherRoot=weatherRoot;
 if(kind==='storm'||kind==='blizzard'){
  const count=kind==='storm'?(reducedMotion?130:240):(reducedMotion?150:310);
  state.weather=makeWeatherField(weatherRoot,rand,kind,count);
  state.cloudRoot=kind==='storm'?createStormClouds(group,rand):createBlizzardCloudDeck(group,rand);
  // 雷雨の雲は従来の高さとローカルテスト時の配置を維持。吹雪だけは山頂より高い雲層を使う。
  if(kind==='storm'&&localView)state.cloudRoot.position.copy(cam.position);
  else state.cloudRoot.position.set(W/2,kind==='storm'?5:0,D/2);
  state.cloudMaterial=state.cloudRoot.children[0]&&state.cloudRoot.children[0].children[0]?state.cloudRoot.children[0].children[0].material:null;state.cloudBaseOpacity=state.cloudMaterial?state.cloudMaterial.opacity:1;
  const gustRatios=kind==='storm'?[.23,.48,.72]:[.18,.40,.63,.82];state.weatherGusts=gustRatios.map(r=>({at:Math.round(durationMs*r),played:false}));
 }
 if(kind==='storm'){
  // 雷は120秒に4回ばらばらに置くのではなく、発生しにくい一つの雷雲セルから短い連続雷として落とす。
  // 近い一帯へ5〜7発、2.6〜6.4秒ほどの揺らぎを付けて集中させ、雷雨らしいまとまりを作る。
  const clusterStart=24000+Math.round(rand()*18000),strikeCount=5+Math.floor(rand()*3);
  const anchor=chooseDisasterTarget(rand,localView,19+rand()*12,(rand()-.5)*9);let strikeAt=clusterStart;
  for(let i=0;i<strikeCount;i++){
   const tx=disasterClamp(anchor.x+(rand()-.5)*(i===0?0:13),2,W-3),tz=disasterClamp(anchor.z+(rand()-.5)*(i===0?0:13),2,D-3);
   const target=new THREE.Vector3(tx,disasterGroundY(tx,tz)+.04,tz);
   const strike=createLightningStrike(group,rand,strikeAt,target);
   // カメラから遠い雷ほど、光ってから雷鳴が届くまでの遅れを長くする。
   const dx=cam.position.x-target.x,dy=cam.position.y-target.y,dz=cam.position.z-target.z;
   strike.thunderAt=strikeAt+Math.max(110,Math.min(820,Math.hypot(dx,dy,dz)*13));
   state.lightning.push(strike);strikeAt+=2600+Math.round(rand()*3800);
  }
 }
 if(kind==='meteor-shower'){
  const n=reducedMotion?8:13;state.meteorTrail=createMeteorTrailBatch(group,n);
  for(let i=0;i<n;i++){const target=chooseDisasterTarget(rand,localView,7+rand()*21,(rand()-.5)*20);state.meteors.push(createMeteor(group,rand,600+i*(15500/n)+rand()*370,'meteor-shower',target,state.meteorTrail,i*6))}
 }
 if(kind==='meteor-impact'){
  const target=chooseDisasterTarget(rand,localView,12+rand()*9,(rand()-.5)*9);
  state.impactMeteor=createMeteor(group,rand,320,'meteor-impact',target);
  state.impactBurst=createMeteorImpactBurst(group,rand,target);
  state.impactAt=4360;
 }
 activeDisasterFx=state;
 Snd.startDisasterAmbience(kind,state.intensity);
 if(state.cloudMaterial)state.cloudMaterial.opacity=state.cloudBaseOpacity*(.12+.88*state.intensity);
 const openingSoundPosition=kind==='meteor-impact'&&state.impactMeteor?state.impactMeteor.curve.getPoint(0):kind==='meteor-shower'&&state.meteors.length?state.meteors[0].curve.getPoint(0):null;
 Snd.playDisasterSound(kind,'start',openingSoundPosition);return true;
}
function applyDisastersEnabled(enabled,fromServer=false){
 disastersEnabled=enabled===true;paintAdmin();
 if(!disastersEnabled)stopDisasterEffect();
 if(!fromServer)toast(disastersEnabled?'自然災害を有効にしました':'自然災害をオフにしました');
}
function setDisastersEnabled(enabled){
 if(!isAdmin()){toast('自然災害を変更できるのは管理者だけです');return}
 if(!Net.send({t:'disaster-admin-toggle',enabled:!!enabled})){toast('サーバーに接続していません');return}
}
function previewDisaster(kind){
 if(!isAdmin()){toast('自然災害のテストは管理者専用です');return}
 Snd.init();closeMenu();setTimeout(()=>{
  const id='local-test-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const ok=startDisasterEffect({id,kind,at:Date.now(),durationMs:DISASTER_DURATION_MS[kind],seed:Math.floor(Math.random()*0x7fffffff),localView:true},true);
  if(ok)toast((DISASTER_LABELS[kind]||'自然災害')+'（3D空間内のこの画面だけのテスト）');
 },90);
}
function hideMeteorTrail(m){
 for(const seg of m.trail){if(seg.batch){setDisasterInstanceSegment(seg.batch,'glow',seg.index,new THREE.Vector3(),new THREE.Vector3(),0);setDisasterInstanceSegment(seg.batch,'core',seg.index,new THREE.Vector3(),new THREE.Vector3(),0)}else{seg.glow.visible=false;seg.core.visible=false}}
}
function updateMeteorVisual(m,elapsed,flightStart=0){
 const age=elapsed-m.startMs;if(age<0||age>m.lifeMs){m.group.visible=false;hideMeteorTrail(m);return}
 m.group.visible=true;const p=disasterClamp(age/m.lifeMs,0,1),fade=Math.min(1,p*7,(1-p)*8),pos=m.curve.getPoint(p);m.outer.position.copy(pos);m.inner.position.copy(pos);
 const grow=m.kind==='meteor-impact'?1:0.72+m.depth*.55;m.outer.scale.setScalar(grow);m.inner.scale.setScalar(grow*.48);
 m.outerMat.opacity=(m.kind==='meteor-impact'?.84:.68)*fade;m.innerMat.opacity=.98*fade;
 const tailFrac=m.kind==='meteor-impact'?.28:.36;
 for(let i=0;i<m.trail.length;i++){
  const a=Math.max(0,p-tailFrac*(i+1)/m.trail.length),b=Math.max(0,p-tailFrac*i/m.trail.length),seg=m.trail[i];
  if(b-a<.001||fade<=.005){if(seg.batch){setDisasterInstanceSegment(seg.batch,'glow',seg.index,new THREE.Vector3(),new THREE.Vector3(),0);setDisasterInstanceSegment(seg.batch,'core',seg.index,new THREE.Vector3(),new THREE.Vector3(),0)}else{seg.glow.visible=false;seg.core.visible=false}continue}
  const pa=m.curve.getPoint(a),pb=m.curve.getPoint(b),taper=(1-i/m.trail.length)*fade;
  if(seg.batch){setDisasterInstanceSegment(seg.batch,'glow',seg.index,pa,pb,taper*(.55+m.depth*.6));setDisasterInstanceSegment(seg.batch,'core',seg.index,pa,pb,taper*(.42+m.depth*.35))}
  else{
   setDisasterSegment(seg.glow,pa,pb);setDisasterSegment(seg.core,pa,pb);seg.glow.scale.x=seg.glow.scale.z=taper;seg.core.scale.x=seg.core.scale.z=taper;
   m.trailGlowMat.opacity=(m.kind==='meteor-impact'?.72:.62)*fade;m.trailCoreMat.opacity=.92*fade;
  }
 }
}
function setImpactInstance(mesh,index,x,y,z,rx,ry,rz,sx,sy,sz,dummy){
 dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
}
function hideImpactInstance(mesh,index,dummy){dummy.position.set(0,0,0);dummy.rotation.set(0,0,0);dummy.scale.set(0,0,0);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix)}
function updateImpactBurst(burst,ageSec){
 if(!burst)return;const active=ageSec>=0;burst.root.visible=active;if(!active)return;
 const t=ageSec;burst.flash.visible=t<.25;burst.flashMat.opacity=Math.max(0,.8*(1-t/.25));const flashScale=.55+t*7;burst.flash.scale.set(flashScale,flashScale*.36,flashScale);
 burst.rings.forEach((r,i)=>{const rt=Math.max(0,t-i*.15),scale=.6+rt*(i===0?5.5:4.1);r.scale.set(scale,scale,scale);burst.ringMats[i].opacity=Math.max(0,(i===0?.85:.62)*(1-rt/1.8));r.visible=rt<1.8});
 burst.smokeMat.opacity=.25*Math.max(0,1-t/4);
 for(const p of burst.smoke){const age=t-p.phase*.05;if(age<0||age>4){hideImpactInstance(burst.smokeMesh,p.index,burst.dummy);continue}const x=Math.cos(p.angle)*p.speed*age,y=1+p.up*age,z=Math.sin(p.angle)*p.speed*age*.72,s=p.size*(.6+age*.8);setImpactInstance(burst.smokeMesh,p.index,x,y,z,0,0,0,s,s*.85,s,burst.dummy)}
 for(const p of burst.sparks){if(t>1.7){hideImpactInstance(burst.sparkMesh,p.index,burst.dummy);continue}const d=t*(1.7-t*.35),x=p.vx*d,y=.4+p.vy*t-3.8*t*t,z=p.vz*d,s=p.size*Math.max(.05,1-t/1.7);setImpactInstance(burst.sparkMesh,p.index,x,y,z,t*3,t*p.size*2,t*p.size,s,s,s,burst.dummy)}
 for(const p of burst.debris){if(t>2.4){hideImpactInstance(burst.debrisMesh,p.index,burst.dummy);continue}const d=t*(1.6-t*.28),x=p.vx*d,y=.35+p.vy*t-4.2*t*t,z=p.vz*d;setImpactInstance(burst.debrisMesh,p.index,x,y,z,t*p.spin,t*p.spin*.8,t*p.spin*1.2,1,1,1,burst.dummy)}
 burst.smokeMesh.instanceMatrix.needsUpdate=true;burst.sparkMesh.instanceMatrix.needsUpdate=true;burst.debrisMesh.instanceMatrix.needsUpdate=true;
}
function applyDisasterAtmosphere(state,flash=0){
 if(!state){restoreDisasterAtmosphere();return}
 const kind=state.kind,intensity=disasterClamp(state.intensity??1,0,1);
 const targetNear=kind==='blizzard'?12:kind==='storm'?21:50,targetFar=kind==='blizzard'?63:kind==='storm'?88:130;
 scene.fog.near=50+(targetNear-50)*intensity;scene.fog.far=130+(targetFar-130)*intensity;
 let targetTint=[1,1,1];if(kind==='storm')targetTint=[.63,.70,.82];else if(kind==='blizzard')targetTint=[.79,.83,.87];else if(kind==='meteor-shower')targetTint=[.34,.42,.62];
 const tint=targetTint.map(v=>1+(v-1)*intensity);
 if(window._skyMat&&window._skyMat.color)window._skyMat.color.setRGB(tint[0]+flash*.34,tint[1]+flash*.42,tint[2]+flash*.62);
 if(kind==='blizzard'){
  // 昼夜の青い空色も吹雪の間は冷たい鉛色に沈め、雲が疎に見える状態を避ける。
  const fogTint=new THREE.Color(0xb4bec8);scene.fog.color.lerp(fogTint,.58*intensity);
 }
 // 雷光はスクリーンを白く塗るのではなく、実際のブロック面・落書き面と空の材質を一瞬だけ照らす。
 const f=1+flash*.72,mats=[wm.material,sm.material,wtm.material,...omPages.map(m=>m.material)];
 for(const m of mats)if(m&&m.color)m.color.setRGB(f,f*(1+flash*.035),f*(1+flash*.12));
}

function disasterMeteorNearElapsed(state,elapsed){
 if(!state||!state.meteors||!state.meteors.length)return null;
 let best=null,bestScore=Infinity;
 for(const m of state.meteors){
  const end=m.startMs+m.lifeMs;
  if(elapsed>=m.startMs&&elapsed<=end)return m;
  const midpoint=m.startMs+m.lifeMs*.5,score=Math.abs(elapsed-midpoint);
  if(score<bestScore){bestScore=score;best=m}
 }
 return best;
}
function renderDisasterEffect(now){
 const state=activeDisasterFx;if(!state){return}
 const elapsed=Math.max(0,performance.now()-state.startPerf),elapsedSec=elapsed/1000;
 if(elapsed>=state.durationMs){stopDisasterEffect(state.id);return}
 const dt=Math.min(.05,Math.max(0,(elapsed-state.lastElapsedMs)/1000));
 state.intensity=disasterWeatherIntensity(state.kind,elapsed,state.durationMs);
 if((state.kind==='storm'||state.kind==='blizzard')&&elapsedSec-state.lastAmbienceUpdateSec>.45&&Math.abs(state.intensity-state.lastAmbienceIntensity)>.025){
  if(Snd.setDisasterAmbienceIntensity)Snd.setDisasterAmbienceIntensity(state.intensity);
  state.lastAmbienceIntensity=state.intensity;state.lastAmbienceUpdateSec=elapsedSec;
 }
 if(state.cloudMaterial)state.cloudMaterial.opacity=state.cloudBaseOpacity*(.12+.88*state.intensity);
 let flash=0;
 if(state.kind==='storm'){
  updateWeatherField(state,dt,elapsedSec);
  if(state.cloudRoot){state.cloudRoot.children.forEach(c=>{c.position.x=c.userData.baseX+Math.sin(elapsedSec*.11+c.userData.phase)*(.14+.4*state.intensity)})}
  for(const strike of state.lightning){
   const age=elapsed-strike.at;let power=age<0||age>340?0:age<45?1:age<72?.025:age<138?.8*(1-(age-72)/66):Math.max(0,.12*(1-(age-138)/202));
   strike.group.visible=power>.015;strike.glowMat.opacity=.72*power;strike.coreMat.opacity=.98*power;strike.ringMat.opacity=.9*power;strike.impactMat.opacity=.43*power;
   strike.ring.scale.set(.9+Math.max(0,age)*.009,.9+Math.max(0,age)*.009,.9+Math.max(0,age)*.009);
   strike.impact.scale.set(1.8+Math.max(0,age)*.006,.14,1.8+Math.max(0,age)*.006);
   flash=Math.max(flash,power);
   const thunderAt=strike.thunderAt??(strike.at+720);
   if(elapsed>=thunderAt&&state.lastElapsedMs<thunderAt&&!strike.thundered){Snd.playDisasterSound('storm','thunder',strike.target);strike.thundered=true}
  }
  for(const gust of state.weatherGusts){if(!gust.played&&elapsed>=gust.at&&state.lastElapsedMs<gust.at){Snd.playDisasterSound('storm','gust');gust.played=true}}
 }else if(state.kind==='blizzard'){
  updateWeatherField(state,dt,elapsedSec);
  if(state.cloudRoot){state.cloudRoot.children.forEach(c=>{c.position.x=c.userData.baseX+Math.sin(elapsedSec*.16+c.userData.phase)*(.18+.67*state.intensity)})}
  for(const gust of state.weatherGusts){if(!gust.played&&elapsed>=gust.at&&state.lastElapsedMs<gust.at){Snd.playDisasterSound('blizzard','gust');gust.played=true}}
 }else if(state.kind==='meteor-shower'){
  for(const m of state.meteors)updateMeteorVisual(m,elapsed);
  if(state.meteorTrail){const any=state.meteors.some(m=>m.group.visible);state.meteorTrail.glow.visible=any;state.meteorTrail.core.visible=any;state.meteorTrail.glow.instanceMatrix.needsUpdate=true;state.meteorTrail.core.instanceMatrix.needsUpdate=true}
  if(elapsed>=3800&&state.lastElapsedMs<3800&&!state.sounds.whoosh1){const m=disasterMeteorNearElapsed(state,elapsed);Snd.playDisasterSound('meteor-shower','whoosh',m?m.curve.getPoint(disasterClamp((elapsed-m.startMs)/m.lifeMs,0,1)):null);state.sounds.whoosh1=true}
  if(elapsed>=11200&&state.lastElapsedMs<11200&&!state.sounds.whoosh2){const m=disasterMeteorNearElapsed(state,elapsed);Snd.playDisasterSound('meteor-shower','whoosh',m?m.curve.getPoint(disasterClamp((elapsed-m.startMs)/m.lifeMs,0,1)):null);state.sounds.whoosh2=true}
 }else if(state.kind==='meteor-impact'){
  updateMeteorVisual(state.impactMeteor,elapsed);
  if(elapsed>=state.impactAt){
   state.impactMeteor.group.visible=false;updateImpactBurst(state.impactBurst,(elapsed-state.impactAt)/1000);
   if(elapsed>=state.impactAt&&state.lastElapsedMs<state.impactAt&&!state.sounds.impact){Snd.playDisasterSound('meteor-impact','impact',state.impactBurst.target);state.sounds.impact=true}
  }
 }
 applyDisasterAtmosphere(state,flash);
 state.lastElapsedMs=elapsed;
}

let horrorEnabled=ls('rkb_horror','0')==='1',horrorFxTimer=0;
let footstepsEventWatch=0,footstepsEventTimeouts=[],footstepsEventToken=0;
let phoneHauntCall=null,phoneHauntRinging=false,phoneHauntVoiceTimer=0,phoneHauntPendingTimer=0;
const HORROR_PHONE_LINES=[
 // 呼びかけ
 '……もしもし。聞こえていますか。',
 'まだ、電話を切らないで。',
 'やっと、つながった。',
 'ずっと呼んでいたんです。',
 'あなたが出るのを、待っていました。',
 'ねえ、そこにいるんでしょう。',
 'もう一度だけ、名前を呼んで。',
 'この声、初めて聞きますか。',
 // 警告
 'うしろに、だれかいます。',
 'そこから、動かないで。',
 '返事をしないでください。',
 'そのまま、後ろを見ないで。',
 '電話の下を、見てはいけません。',
 '受話器を置いても、聞こえますよ。',
 '切れたら、思い出さないで。',
 'もう切れているのに。',
 // 周囲を知っているような声
 'その絵、誰が描いたんですか。',
 'さっきまで、あなたの隣にいました。',
 'あなたの声、よく知っています。',
 'ずっと、同じ場所にいますね。',
 'まだ帰っていないんですね。',
 'あなたの後ろに、もう一人いる。',
 'その落書き、消さないで。',
 'きみ、前にもここに来たよね。',
 // 電話の向こうの異常
 '壁の向こうから、音がする。',
 '聞こえるのに、声が届かない。',
 '電話の向こうが、静かすぎる。',
 'いま、声が二重に聞こえませんか。',
 '誰かが代わりに話しています。',
 'それは、あなたの声じゃない。',
 'ここから先は、話せません。',
 '……違う。あなたじゃない。',
 // 意味の分からない質問
 '今、何人で遊んでいますか。',
 'ここは、何階ですか。',
 '今日は何日ですか。',
 'この番号、どこで知りましたか。',
 'そちらの時計は、進んでいますか。',
 'ここは、あなたの世界ですか。',
 // 不穏な締めくくり
 'あなたの番は、まだ終わっていません。',
 '何かが、こちらを見ています。',
 'やめて。近づいてきてる。',
 '……あれ、もう一人いる。',
 'まちがい電話です。……そうでしょう？',
 '何も起きていません。何も。',
 'もう一度かけます。出ないでください。',
 'いまの返事は、誰の声ですか。',
 'いま、声が聞こえましたか。',
 '……もしもし？ 今度こそ、あなた？'
];
const cm=()=>isPen()&&penMode==='cursor',act=()=>started&&!menu&&!typing&&!phonePanelOpen&&(locked||cm()||TOUCH);
window.RakugakiPhoneBridge={
 send:m=>Net.send(m),
 get id(){return Net.id},
 get active(){return started},
 get isOpen(){return phonePanelOpen},
 setOpen(value){
  phonePanelOpen=!!value;
  if(phonePanelOpen){
   Object.keys(keys).forEach(k=>keys[k]=false);
   if(typing)closeChat();
   if(locked){skipMenu=true;try{document.exitPointerLock()}catch(e){}}
  }else if(!menu&&!typing){sync()}
 },
 setMessageHandler(fn){this.onMessage=fn},
 dispatch(m){if(typeof this.onMessage==='function')this.onMessage(m)},
 notify:t=>toast(t)
};
let myCol=(()=>{
 const s=ls('rkb_col','');
 if(s&&/^#[0-9a-fA-F]{6}$/.test(s))return parseInt(s.slice(1),16);
 return new THREE.Color().setHSL(Math.random(),.65,.55).getHex();
})();// ペン用の共有ジオメトリとマテリアルは、一人称リグの生成より先に初期化する。
// makePencilProp() は関数宣言のため先に呼べるが、参照する const は先に初期化済みである必要がある。
const pokePenShaftGeo=new THREE.CylinderGeometry(.012,.016,.29,5);
const pokePenTipGeo=new THREE.ConeGeometry(.019,.065,5);
const pokePenGripGeo=new THREE.BoxGeometry(.068,.042,.038);
const pokePenBodyMat=new THREE.MeshBasicMaterial({color:0xd2b366});
const pokePenTipMat=new THREE.MeshBasicMaterial({color:0x35322b});

// Minecraft風の一人称表示：画面右下から腕が入り、手に持ったペンが前方へ伸びる。
// 三人称の関節グループを無理に流用せず、同じ寸法・角丸・色の一人称用前腕と手を
// カメラ前に配置する。空の手も表示し、ペン選択時だけ手持ちペンを重ねる。
const firstPersonPenRig=new THREE.Group();firstPersonPenRig.visible=false;firstPersonPenRig.renderOrder=997;scene.add(firstPersonPenRig);
const firstPersonPose=new THREE.Group();firstPersonPenRig.add(firstPersonPose);
const firstPersonLimbMat=new THREE.MeshBasicMaterial({color:myCol,depthTest:false,depthWrite:false});
const firstPersonPenBodyMat=pokePenBodyMat.clone();firstPersonPenBodyMat.depthTest=false;firstPersonPenBodyMat.depthWrite=false;
const firstPersonPenTipMat=pokePenTipMat.clone();firstPersonPenTipMat.depthTest=false;firstPersonPenTipMat.depthWrite=false;
const firstPersonRoundedBox=(w,h,d,r)=>{
 const g=new THREE.BoxGeometry(w,h,d,4,4,4),a=g.attributes.position;
 const rr=Math.max(.012,Math.min(r,w*.28,h*.28,d*.28));
 for(let i=0;i<a.count;i++){
  const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
  const cx=Math.max(-w/2+rr,Math.min(w/2-rr,x));
  const cy=Math.max(-h/2+rr,Math.min(h/2-rr,y));
  const cz=Math.max(-d/2+rr,Math.min(d/2-rr,z));
  const dx=x-cx,dy=y-cy,dz=z-cz,len=Math.hypot(dx,dy,dz);
  if(len>1e-6)a.setXYZ(i,cx+dx/len*rr,cy+dy/len*rr,cz+dz/len*rr);
 }
 a.needsUpdate=true;g.computeVertexNormals();return g;
};
// アバター本体と同じ .18×.47×.18 の腕、同じ .145×.11×.14 の手のひらを使用。
// 肩を画面外の右下へ逃がし、手が腕の上端につながって見えるように斜めに構える。
const firstPersonArm=new THREE.Mesh(firstPersonRoundedBox(.18,.47,.18,.045),firstPersonLimbMat);
firstPersonArm.position.set(.52,-.49,-.72);firstPersonArm.rotation.z=.48;firstPersonArm.renderOrder=997;firstPersonPose.add(firstPersonArm);
const firstPersonHand=new THREE.Mesh(firstPersonRoundedBox(.145,.11,.14,.03),firstPersonLimbMat);
firstPersonHand.position.set(.411,-.283,-.68);firstPersonHand.rotation.z=.48;firstPersonHand.renderOrder=998;firstPersonPose.add(firstPersonHand);
// ペンは手の手前に配置し、軸を画面中央寄りへ斜めに伸ばす。アイテム表示はMinecraft風に前景へ重ねる。
const firstPersonPen=makePencilProp(.8,.55,firstPersonLimbMat);
firstPersonPen.position.set(.395,-.283,-.59);firstPersonPen.rotation.z=-2.2;firstPersonPen.visible=false;
firstPersonPen.traverse(o=>{if(!o.isMesh)return;if(o.material===pokePenBodyMat)o.material=firstPersonPenBodyMat;else if(o.material===pokePenTipMat)o.material=firstPersonPenTipMat;o.material.depthTest=false;o.material.depthWrite=false;o.material.needsUpdate=true;o.renderOrder=999;});
firstPersonPose.add(firstPersonPen);
function updateFirstPersonPenColor(){
 firstPersonLimbMat.color.setHex((mySkin&&Number.isFinite(mySkin.limb))?mySkin.limb:myCol);
}
function updateFirstPersonPenView(){
 const held=isPen()&&cur!==0&&canPen();
 if(selfAv)selfAv.holdingPen=held;
 const elapsed=selfAv&&selfAv.pokeAt?(performance.now()-selfAv.pokeAt)/360:2;
 const pokeMix=elapsed>=0&&elapsed<1?Math.sin(Math.PI*elapsed):0;
 const visible=started&&viewMode===0&&!menu&&!typing&&!phonePanelOpen;
 firstPersonPenRig.visible=visible;
 firstPersonPen.visible=visible&&(held||pokeMix>.12);
 if(visible){
  // Scene内のカメラ位置・回転へ追従。腕は画面右下から入り、歩行では小さく揺れ、突くと前へ出る。
  firstPersonPenRig.position.copy(cam.position);
  firstPersonPenRig.quaternion.copy(cam.quaternion);
  const speed=Math.hypot(me.v.x,me.v.z),moveBlend=clamp(speed/2.5,0,1);
  const phase=(selfAv?selfAv.t:performance.now()*.001)*6;
  const stride=Math.sin(phase);
  firstPersonPose.position.set(stride*.010*moveBlend-.035*pokeMix,-Math.abs(stride)*.014*moveBlend+.010*pokeMix,-.12*pokeMix);
  firstPersonPose.rotation.set(.075*pokeMix,0,stride*.012*moveBlend-.055*pokeMix);
 }
}

function setMyCol(c,sync){
 c=(c>>>0)&0xffffff;
 if(c===myCol&&!sync)return;
 myCol=c;updateFirstPersonPenColor();
 lsSet('rkb_col','#'+c.toString(16).padStart(6,'0'));
 if($('myColPick'))$('myColPick').value='#'+c.toString(16).padStart(6,'0');
 rebuildSelf();
 paintPlayers();
 if(lastJoin)lastJoin.col=myCol;
 if(sync&&Net.id){Net.send({t:'col',col:myCol});toast('自分の色を変更しました')}
}

const playerH=()=>me.crouch?1.45:1.79;
const hits=(x,y,z,h)=>{
 h=h==null?playerH():h;
 for(let i=Math.floor(x-.3);i<=Math.floor(x+.3);i++)
  for(let j=Math.floor(y);j<=Math.floor(y+h);j++)
   for(let k=Math.floor(z-.3);k<=Math.floor(z+.3);k++){
    const b=get(i,j,k);if(!b||b===8)continue;
    if(isSolid(b))return true;
   }
 return false;
};
/** 足元に足場があるか（しゃがみ時の落下防止用） */
function hasFootSupport(x,y,z){
 const fy=Math.floor(y-0.05);
 const r=.28;
 const pts=[[x,z],[x-r,z-r],[x+r,z-r],[x-r,z+r],[x+r,z+r],[x-r,z],[x+r,z],[x,z-r],[x,z+r]];
 for(const[px,pz]of pts){
  const b=get(Math.floor(px),fy,Math.floor(pz));
  if(!b||b===8)continue;
  if(isSolid(b))return true;
 }
 return false;
}
/** 足元がスライムか（バウンド用） */
function footIsSlime(x,y,z){
 const fy=Math.floor(y-0.05);
 const r=.28;
 const pts=[[x,z],[x-r,z],[x+r,z],[x,z-r],[x,z+r]];
 for(const[px,pz]of pts){
  if(isSlime(get(Math.floor(px),fy,Math.floor(pz))))return true;
 }
 return false;
}

function spawn(){
 let sx=28,sz=50;
 if(worldTheme==='paper'){sx=30;sz=50}
 else if(worldTheme==='toy'){sx=30;sz=52}
 let y=H-1;while(y>0&&!isSolid(get(sx,y,sz)))y--;
 me.p.set(sx+.5,y+1.01,sz+.5);me.v.set(0,0,0);me.peakY=me.p.y;
}

function physics(dt){
 const a=act();
 // 接地中は次の落下・ジャンプの頂点を現在位置から計測し直す
 if(me.ground)me.peakY=me.p.y;
 // C / スマホ「しゃがむ」= しゃがみ。W を短く2回 → ダッシュ（押しっぱなしで維持）
 me.crouch=!!(a&&(keys.KeyC||keys.crouchTouch));
 const f=a?Math.max(-1,Math.min(1,(keys.KeyW?1:0)-(keys.KeyS?1:0)-stick.y)):0;
 const s=a?Math.max(-1,Math.min(1,(keys.KeyD?1:0)-(keys.KeyA?1:0)+stick.x)):0;
 // スマホ: 仮想スティックをほぼ最大まで前に倒すとダッシュ（PCは従来どおりW二度押し）
 if(me.crouch||f<=0)wantSprint=false;
 else if(-stick.y>=0.88)wantSprint=true;
 const sporeSlow = Date.now() < sporeFx.slowUntil ? 0.56 : 1;
 const sp=(me.crouch?2.0:((wantSprint&&f>0)?7:4.5))*sporeSlow;
 const sn=Math.sin(me.yaw),cs=Math.cos(me.yaw);
 me.v.x=-sn*f*sp+cs*s*sp;me.v.z=-cs*f*sp-sn*s*sp;
 // しゃがみ中はジャンプ不可。スライム上でも立ちジャンプは通常の高さ
 if(a&&keys.Space&&me.ground&&!me.crouch){
  me.v.y=8.5;
 }
 me.v.y=Math.max(me.v.y-28*dt,-40);
 const ph=playerH();
 const wasGround=me.ground;
 for(const ax of['x','y','z']){
  const o=me.p[ax];me.p[ax]+=me.v[ax]*dt;
  if(hits(me.p.x,me.p.y,me.p.z,ph)){
   if(ax==='y'){
    if(me.v.y<0){
     const by=Math.floor(me.p.y);
     const landingY=by+1;
     const fallDistance=Math.max(0,me.peakY-landingY);
     me.p.y=landingY+0.0001;
     me.ground=true;
     // スライム着地: 落下距離に応じて跳ね返る。高さは最大約57.6ブロック。
     // Minecraftの「高く落ちるほど大きく跳ね、連続バウンドで減衰する」挙動に寄せる。
     if(!me.crouch&&footIsSlime(me.p.x,me.p.y,me.p.z)){
      const bounceHeight=Math.min(57.625,fallDistance*0.44);
      const bounce=Math.sqrt(2*28*bounceHeight);
      if(bounce>2.2){me.v.y=bounce;me.ground=false;me.peakY=me.p.y}
      else me.v.y=0;
     }else me.v.y=0;
    }else{
     me.p.y=Math.floor(me.p.y+ph)-(ph+0.01);
     me.ground=false;
     me.v.y=0;
    }
   }else{me.p[ax]=o;me.v[ax]=0}
  }else if(ax==='y')me.ground=false;
  // しゃがみ中: 水平移動で足場を失うなら戻す（端から落ちない）
  if(me.crouch&&wasGround&&(ax==='x'||ax==='z')){
   if(!hasFootSupport(me.p.x,me.p.y,me.p.z)){
    me.p[ax]=o;me.v[ax]=0;
   }
  }
 }
 if(!me.ground)me.peakY=Math.max(me.peakY,me.p.y);
 me.p.x=Math.min(W-.3,Math.max(.3,me.p.x));me.p.z=Math.min(D-.3,Math.max(.3,me.p.z));
 if(me.p.y<-10)spawn();
}
const ro=new THREE.Vector3(),rd=new THREE.Vector3();
function cast(){
 let x=Math.floor(ro.x),y=Math.floor(ro.y),z=Math.floor(ro.z);
 const sx=Math.sign(rd.x),sy=Math.sign(rd.y),sz2=Math.sign(rd.z),tdx=sx?Math.abs(1/rd.x):1e9,tdy=sy?Math.abs(1/rd.y):1e9,tdz=sz2?Math.abs(1/rd.z):1e9;
 let tx=sx?(sx>0?x+1-ro.x:ro.x-x)*tdx:1e9,ty=sy?(sy>0?y+1-ro.y:ro.y-y)*tdy:1e9,tz=sz2?(sz2>0?z+1-ro.z:ro.z-z)*tdz:1e9,t=0,face=0;
 for(let i=0;i<40;i++){
  if(tx<ty&&tx<tz){t=tx;x+=sx;tx+=tdx;face=sx>0?1:0}
  else if(ty<tz){t=ty;y+=sy;ty+=tdy;face=sy>0?3:2}
  else{t=tz;z+=sz2;tz+=tdz;face=sz2>0?5:4}
  if(t>7)return null;
  if(get(x,y,z))return{x,y,z,face,t};
 }
 return null;
}
const pix=v=>Math.min(TS-1,Math.max(0,v*TS|0));
function pixAt(h){
 const F=FACES[h.face],lx=ro.x+rd.x*h.t-h.x-F.o[0],ly=ro.y+rd.y*h.t-h.y-F.o[1],lz=ro.z+rd.z*h.t-h.z-F.o[2];
 return[pix(lx*F.a[0]+ly*F.a[1]+lz*F.a[2]),pix(lx*F.b[0]+ly*F.b[1]+lz*F.b[2])];
}
function line(x0,y0,x1,y1,fn){const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let e=dx+dy;for(;;){fn(x0,y0);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx}if(e2<=dx){e+=dx;y0+=sy}}}
let out=[],stroke=null;                         // out=送信待ち / stroke=今の一筆の変更履歴
const undoS=[],redoS=[];
const brushSize=()=>usePress&&penDev?Math.max(1,Math.round(pressure*sz)):sz;
/* ブラシが面の外にはみ出したとき、隣接ブロックの同じ向きの面へ継続する */
function resolveCoplanar(x,y,z,f,px,py){
 const F=FACES[f];
 for(let guard=0;guard<10;guard++){
  if(px>=0&&py>=0&&px<TS&&py<TS){
   if(!get(x,y,z))return null;
   return{k:pkey(x,y,z,f),px:px|0,py:py|0};
  }
  if(px<0){
   const mx=Math.round(-F.a[0]),my=Math.round(-F.a[1]),mz=Math.round(-F.a[2]);
   if(!mx&&!my&&!mz)return null;
   x+=mx;y+=my;z+=mz;px+=TS;continue;
  }
  if(px>=TS){
   const mx=Math.round(F.a[0]),my=Math.round(F.a[1]),mz=Math.round(F.a[2]);
   if(!mx&&!my&&!mz)return null;
   x+=mx;y+=my;z+=mz;px-=TS;continue;
  }
  if(py<0){
   const mx=Math.round(-F.b[0]),my=Math.round(-F.b[1]),mz=Math.round(-F.b[2]);
   if(!mx&&!my&&!mz)return null;
   x+=mx;y+=my;z+=mz;py+=TS;continue;
  }
  if(py>=TS){
   const mx=Math.round(F.b[0]),my=Math.round(F.b[1]),mz=Math.round(F.b[2]);
   if(!mx&&!my&&!mz)return null;
   x+=mx;y+=my;z+=mz;py-=TS;continue;
  }
  return null;
 }
 return null;
}
function stamp(k,x,y,c,n){
 const r=n/2;
 const parts=k.split(',').map(Number);
 const bx=parts[0],by=parts[1],bz=parts[2],bf=parts[3];
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  const ox=i-(n-1)/2,oy=j-(n-1)/2;if(ox*ox+oy*oy>r*r+.25)continue;
  const q=resolveCoplanar(bx,by,bz,bf,x+Math.round(ox),y+Math.round(oy));
  if(!q)continue;
  const old=getPix(q.k,q.px,q.py);
  if(setPix(q.k,q.px,q.py,c)){Snd.play('pen');out.push([q.k,q.px,q.py,c]);if(stroke)stroke.push([q.k,q.px,q.py,old,c])}
 }
}
function doDraw(){
 if(drawing===null||!act()||!canPen()||!isPen()){endStroke();return}
 if(!hit){lastPix=null;return}
 if(isPhoneStationBlock(hit.x,hit.y,hit.z)){lastPix=null;return}
 if(!stroke)stroke=[];
 const k=pkey(hit.x,hit.y,hit.z,hit.face),[px,py]=pixAt(hit),n=brushSize();
 let joined=false;
 if(lastPix&&lastPix.f===hit.face){
  // 同じ平面上の隣接ブロックへ移ったときも、前の点を現在の面座標へ移して線を補間する。
  // ブロックをまたぐ際の線切れを減らす。長距離の飛び越しは補間せず、1フレームの負荷を制限。
  const F=FACES[hit.face],dx=lastPix.bx-hit.x,dy=lastPix.by-hit.y,dz=lastPix.bz-hit.z;
  const normalStep=dx*F.n[0]+dy*F.n[1]+dz*F.n[2];
  const sx=lastPix.x+(dx*F.a[0]+dy*F.a[1]+dz*F.a[2])*TS;
  const sy=lastPix.y+(dx*F.b[0]+dy*F.b[1]+dz*F.b[2])*TS;
  if(normalStep===0&&Math.abs(sx-px)+Math.abs(sy-py)<=TS*2){
   line(sx,sy,px,py,(x,y)=>stamp(k,x,y,drawing,n));joined=true;
  }
 }
 if(!joined)stamp(k,px,py,drawing,n);
 lastPix={k,x:px,y:py,bx:hit.x,by:hit.y,bz:hit.z,f:hit.face};
}
function endStroke(){if(stroke&&stroke.length){undoS.push(stroke);if(undoS.length>50)undoS.shift();redoS.length=0}stroke=null}
function applyStroke(st,back){if(!canPen())return;for(const[k,x,y,o,n]of(back?[...st].reverse():st)){const c=back?o:n;if(setPix(k,x,y,c))out.push([k,x,y,c])}}
function undo(){endStroke();const st=undoS.pop();if(st){applyStroke(st,true);redoS.push(st)}}
function redo(){const st=redoS.pop();if(st){applyStroke(st,false);undoS.push(st)}}
function pick(){if(!hit)return;const k=pkey(hit.x,hit.y,hit.z,hit.face),[px,py]=pixAt(hit),c=getPix(k,px,py);if(c){setColor(c);const an=faceAuthor.get(k);toast(an?an+' が描いた色を採取':'色を採取')}else toast('色なし')}
function armPick(e){if(!picking)return false;pickReq=true;mx=e.clientX;my=e.clientY;return true}
function trackPen(e){penDev=e.pointerType==='pen';if(penDev)pressure=e.pressure}
addEventListener('pointerdown',trackPen,true);addEventListener('pointermove',trackPen,true);
function placeAxisOfFace(f){
 const n=FACES[f].n;
 if(n[0])return 0;if(n[1])return 1;return 2;
}
function resetPlaceHold(){
 placeHeld=false;placeAcc=0;placeLockAxis=null;placeOkCount=0;
}
/** 設置。成功で true。長押し2個目以降は「同じ一直線」上だけ許可 */
function place(){
 if(isPen()||!hit||!canBlk()||isPhoneStationBlock(hit.x,hit.y,hit.z))return false;
 const n=FACES[hit.face].n,ax=placeAxisOfFace(hit.face);
 const x=hit.x+n[0],y=hit.y+n[1],z=hit.z+n[2];
 // 2個置いたあと: 同じ軸 かつ 固定した2座標が一致する一直線のみ
 if(placeHeld&&placeLockAxis!=null){
  let deny=false;
  if(ax!==placeLockAxis)deny=true;
  else if(placeLockAxis===0){if(y!==placeLockU||z!==placeLockV)deny=true}
  else if(placeLockAxis===1){if(x!==placeLockU||z!==placeLockV)deny=true}
  else{if(x!==placeLockU||y!==placeLockV)deny=true}
  if(deny)return false;
 }
 if(x<0||y<0||z<0||x>=W||y>=H||z>=D||get(x,y,z))return false;
 const bid=tool+1;
 world[idx(x,y,z)]=bid;const bad=hits(me.p.x,me.p.y,me.p.z);world[idx(x,y,z)]=0;if(bad)return false;
 setBlock(x,y,z,bid,true);
 if(placeHeld){
  placeOkCount++;
  // 2個目の位置で一直線を確定（軸 + 残り2座標）
  if(placeOkCount>=2&&placeLockAxis==null){
   placeLockAxis=ax;
   if(ax===0){placeLockU=y;placeLockV=z}
   else if(ax===1){placeLockU=x;placeLockV=z}
   else{placeLockU=x;placeLockV=y}
   setInfo();
  }
 }
 return true;
}

/* ---- アバター: 頭・胴・両腕・両脚。顔と服は自分で描いた絵 ---- */
const HAIR0=0x5a3a22,hx=n=>'#'+n.toString(16).padStart(6,'0');
// 胴体は幅・高さがほぼ同じ角丸ブロックなので、服キャンバスも16×16に統一する。
// 旧版の16×24データは行方向を縮小して移行し、既存の落書きを可能な限り維持する。
function normalizeBodyPixels(pixels){
 if(!pixels)return new Uint16Array(256);
 const src=pixels instanceof Uint16Array?pixels:Uint16Array.from(pixels);
 if(src.length===256)return src;
 const out=new Uint16Array(256);
 if(src.length===384){
  for(let y=0;y<16;y++){
   const y0=Math.floor(y*24/16),y1=Math.max(y0,Math.ceil((y+1)*24/16)-1);
   for(let x=0;x<16;x++){
    const a=src[y0*16+x]||0,b=src[Math.min(23,y1)*16+x]||0;
    // 複数行が1行へまとまるときは、透明より描画色を優先して細い線を残す。
    out[y*16+x]=b||a;
   }
  }
  return out;
 }
 // 不明な旧サイズも16×16へ最近傍変換する。
 const srcW=16,srcH=Math.max(1,Math.floor(src.length/16));
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const sy=Math.min(srcH-1,Math.floor((y+.5)*srcH/16));out[y*16+x]=src[sy*srcW+x]||0;
 }
 return out;
}
const packSkin=k=>{
 if(!k||!k.face||!k.body)return null;
 const body=normalizeBodyPixels(k.body),bodyB=normalizeBodyPixels(k.bodyB||k.body);
 const out={
  f:Array.from(new Uint8Array(k.face.buffer,k.face.byteOffset,k.face.byteLength)),
  b:Array.from(new Uint8Array(body.buffer,body.byteOffset,body.byteLength)),
  h:k.hair|0,l:k.limb|0,p:k.headPart|0
 };
 // 新旧保存データとも正規化して送信。背面データがない場合は前面を引き継ぐ。
 if(bodyB)out.bb=Array.from(new Uint8Array(bodyB.buffer,bodyB.byteOffset,bodyB.byteLength));
 return out;
};
const unpackSkin=m=>{
 if(!m||!m.f||!m.b)return null;
 const fb=Uint8Array.from(m.f),bb=Uint8Array.from(m.b);
 const body=normalizeBodyPixels(new Uint16Array(bb.buffer,bb.byteOffset,bb.byteLength/2));
 let bodyB=null;
 if(m.bb){
  const bbb=Uint8Array.from(m.bb);
  bodyB=normalizeBodyPixels(new Uint16Array(bbb.buffer,bbb.byteOffset,bbb.byteLength/2));
 }
 return{face:new Uint16Array(fb.buffer,fb.byteOffset,fb.byteLength/2),body,bodyB,hair:m.h|0,limb:m.l|0,headPart:m.p|0};
};
function loadSkin(){
 try{
  const o=JSON.parse(ls('rkb_skin','null'));
  if(!o)return null;
  const sk={face:Uint16Array.from(o.face),body:normalizeBodyPixels(Uint16Array.from(o.body)),hair:o.hair,limb:o.limb,headPart:o.headPart|0};
  if(o.bodyB)sk.bodyB=normalizeBodyPixels(Uint16Array.from(o.bodyB));
  return sk;
 }catch(e){return null}
}
let mySkin=loadSkin();
// Apply saved avatar limb color only after mySkin has been initialized.
updateFirstPersonPenColor();
function skinTex(a,w,h,base,eyes){
 const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=hx(base);x.fillRect(0,0,w,h);
 if(a){for(let i=0;i<a.length;i++)if(a[i]){x.fillStyle=toCss(a[i]);x.fillRect(i%w,(i/w)|0,1,1)}}
 else if(eyes){x.fillStyle='#333';eyes.forEach(r=>x.fillRect(...r))}
 const t=new THREE.CanvasTexture(c);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;return t;
}
// 手持ちペン用の共有ジオメトリ。選択中は手に持ち、攻撃時は腕と一緒に前へ出る。
function makePencilProp(scale=.8,tilt=.55,gripMat=null){
 const prop=new THREE.Group();prop.rotation.x=tilt;prop.scale.setScalar(scale);
 const shaft=new THREE.Mesh(pokePenShaftGeo,pokePenBodyMat);shaft.position.set(0,0,0);prop.add(shaft);
 const tip=new THREE.Mesh(pokePenTipGeo,pokePenTipMat);tip.position.set(0,-.1725,0);tip.rotation.z=Math.PI;prop.add(tip);
 // ペンを横切る小さな色付きグリップで、棒が手に貼り付いて見えないようにする。
 if(gripMat){const grip=new THREE.Mesh(pokePenGripGeo,gripMat);grip.position.set(0,-.025,-.03);prop.add(grip)}
 return prop;
}
function makeAvatar(sk,col){
 const M=c=>new THREE.MeshBasicMaterial({color:c}),T=t=>new THREE.MeshBasicMaterial({map:t,transparent:false});
 const limb=sk?sk.limb:col,headPart=sk?(sk.headPart|0):0,root=new THREE.Group();
 const ft=T(skinTex(sk&&sk.face,16,16,0xffe0c0,[[4,6,2,3],[10,6,2,3]]));
 const bodyF=normalizeBodyPixels(sk&&sk.body),bodyB=normalizeBodyPixels((sk&&sk.bodyB)||bodyF);
 // 角を少し丸めたブロック形状。立方体そのもののシルエットから外し、独自の柔らかな輪郭にする。
 const roundedBoxGeometry=(w,h,d,r)=>{
  const g=new THREE.BoxGeometry(w,h,d,4,4,4),a=g.attributes.position;
  const rr=Math.max(.012,Math.min(r,w*.28,h*.28,d*.28));
  for(let i=0;i<a.count;i++){
   const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
   const cx=Math.max(-w/2+rr,Math.min(w/2-rr,x));
   const cy=Math.max(-h/2+rr,Math.min(h/2-rr,y));
   const cz=Math.max(-d/2+rr,Math.min(d/2-rr,z));
   const dx=x-cx,dy=y-cy,dz=z-cz,len=Math.hypot(dx,dy,dz);
   if(len>1e-6){a.setXYZ(i,cx+dx/len*rr,cy+dy/len*rr,cz+dz/len*rr)}
  }
  a.needsUpdate=true;g.computeVertexNormals();return g;
 };
 const box=(w,h,d,m,y,r=.045)=>{const o=new THREE.Mesh(roundedBoxGeometry(w,h,d,r),m);o.position.y=y;return o};
 const joint=(x,y,w,h,d,parent=root)=>{const j=new THREE.Group();j.position.set(x,y,0);j.add(box(w,h,d,M(limb),-h/2,.045));parent.add(j);return j};
 // 胴体は生成り色。前後の面は従来のスキン模様を引き継ぎ、手描きの個性を保つ。
 const bodySide=M(0xf2ead7),bodyTop=M(0xf9f4e7),bodyBottom=M(0xded3bd);
 const btF=T(skinTex(bodyF,16,16,0xf4ecd9)),btB=T(skinTex(bodyB,16,16,0xf4ecd9));
 // Three.jsのBoxGeometry面順は +X, -X, +Y, -Y, +Z, -Z。
 // このゲームの前方は yaw=0 で -Z なので、前面テクスチャは最後から2番目ではなく最後の面（-Z）へ割り当てる。
 const torsoPivot=new THREE.Group();torsoPivot.position.y=.955;root.add(torsoPivot);
 // 胴体は頭に近い幅の角丸ブロック。編集時の服模様はこの前面へ貼り、体型は縦長にしすぎず安定感を優先する。
 const torso=new THREE.Mesh(roundedBoxGeometry(.58,.57,.40,.075),[bodySide,bodySide,bodyTop,bodyBottom,btB,btF]);
 torsoPivot.add(torso);
 // 頭は大きめの角丸ブロック形。顔パネルもゲームの前方（-Z）に置き、裏面からも描画して反転を防ぐ。
 const head=new THREE.Group();head.position.set(0,.575,0);head.rotation.order='YXZ';torsoPivot.add(head); // 頭の下面を胴体上面へぴったり合わせ、首の隙間を作らない
 const headBase=M(0xf8f0dc);
 head.add(new THREE.Mesh(roundedBoxGeometry(.60,.58,.56,.085),[headBase,headBase,headBase,M(0xe4d9c3),headBase,headBase]));
 ft.side=THREE.DoubleSide;
 const face=new THREE.Mesh(new THREE.PlaneGeometry(.42,.42),ft);face.position.set(0,0,-.282);face.renderOrder=2;head.add(face);
 // パンダ着ぐるみ装着時は通常の顔板を隠し、開口部に沿う専用の曲面顔パネルだけを表示する。
 if(headPart===6)face.visible=false;
 // 頭部アクセサリーは「シルエットが先、装飾は少なめ」を基準に設計。
 // ファッション誌の帽子写真に見られる、輪郭・クラウン・つば・ワンポイントの関係を参考にし、特定製品は複製しない。
 if(headPart===1){ // 布帽子：丸みのあるフェルト・クローシュ／バケットの中間形
  const brimMat=M(0x5d7772),crownMat=M(0x78928b),bandMat=M(0x405d58),badgeMat=M(0xd8bd8e);
  const brim=new THREE.Mesh(new THREE.CylinderGeometry(.322,.307,.034,24),brimMat);
  brim.position.set(0,.305,0);head.add(brim);
  const profile=[
   new THREE.Vector2(0,.303),new THREE.Vector2(.194,.303),new THREE.Vector2(.202,.326),
   new THREE.Vector2(.191,.36),new THREE.Vector2(.176,.405),new THREE.Vector2(.155,.452),
   new THREE.Vector2(.125,.483),new THREE.Vector2(.082,.495),new THREE.Vector2(0,.495)
  ];
  const crown=new THREE.Mesh(new THREE.LatheGeometry(profile,24),crownMat);head.add(crown);
  const band=new THREE.Mesh(new THREE.CylinderGeometry(.201,.201,.026,24),bandMat);
  band.position.y=.344;head.add(band);
  const badge=new THREE.Mesh(new THREE.SphereGeometry(.014,10,8),badgeMat);
  badge.position.set(0,.365,-.198);head.add(badge);
 }else if(headPart===2){ // 葉っぱ飾り：以前の楕円形状と角度へ戻す（不要な再設計をしない）
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.009,.012,.09,5),M(0x6e8c45));stem.position.set(0,.32,0);stem.rotation.z=-.12;head.add(stem);
  const leafA=new THREE.Mesh(new THREE.SphereGeometry(1,10,7),M(0x769d51));
  leafA.scale.set(.19,.045,.085);leafA.position.set(-.09,.355,-.005);leafA.rotation.z=-.42;head.add(leafA);
  const leafB=new THREE.Mesh(new THREE.SphereGeometry(1,10,7),M(0x91b965));
  leafB.scale.set(.17,.043,.08);leafB.position.set(.09,.365,.015);leafB.rotation.z=.38;head.add(leafB);
 }else if(headPart===3){ // きのこ帽子：幅広の丸い傘、裏からも不透明に見える両面材質、表面へ沿う斑点
  const capRadius=.35,capY=.315,capScaleY=.55;
  const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.057,.073,.22,12),M(0xe0d2b5));
  stalk.position.set(0,.397,0);head.add(stalk);
  const underside=new THREE.Mesh(
   new THREE.CylinderGeometry(.323,.323,.014,24),
   new THREE.MeshBasicMaterial({color:0xd8c4a5,side:THREE.DoubleSide})
  );
  underside.position.y=capY-.002;head.add(underside);
  const capMat=new THREE.MeshBasicMaterial({color:0xb96850,side:THREE.DoubleSide});
  const cap=new THREE.Mesh(new THREE.SphereGeometry(capRadius,24,14,0,Math.PI*2,0,Math.PI/2),capMat);
  cap.scale.y=capScaleY;cap.position.set(0,capY,0);head.add(cap);
  const spotMat=M(0xf3e3c7);
  [[-.18,-.08],[-.055,-.205],[.115,-.16],[.215,.025],[-.075,.12],[.145,.15]].forEach(([x,z])=>{
   const under=capRadius*capRadius-x*x-z*z;if(under<=0)return;
   const spot=new THREE.Mesh(new THREE.SphereGeometry(.023,10,7),spotMat);
   spot.position.set(x,capY+capScaleY*Math.sqrt(under)+.003,z);head.add(spot);
  });
  }else if(headPart===4){ // 猫フード：顔の開口部を連続した丸いフレームにし、猫らしい刺繍を前面へ追加。
  const hoodMat=M(0x77746f),innerMat=new THREE.MeshBasicMaterial({color:0xd8919b,side:THREE.DoubleSide});
  const liningMat=new THREE.MeshBasicMaterial({color:0xcac0b5,side:THREE.DoubleSide});
  const whiskerMat=M(0xe6ded3),cheekMat=M(0xbab0a7),noseMat=M(0xd98591),mouthMat=M(0x514b49);
  // 後頭部・頭頂・側面の外殻は維持し、頭部が被り物へ食い込まないよう外側へ配置。
  const hoodBack=new THREE.Mesh(roundedBoxGeometry(.646,.594,.105,.075),hoodMat);
  hoodBack.position.set(0,0,.326);head.add(hoodBack);
  const hoodTop=new THREE.Mesh(roundedBoxGeometry(.668,.105,.665,.045),hoodMat);
  hoodTop.position.set(0,.292,.012);head.add(hoodTop);
  [-1,1].forEach(side=>{
   const hoodSide=new THREE.Mesh(roundedBoxGeometry(.105,.555,.615,.042),hoodMat);
   hoodSide.position.set(side*.318,-.005,.008);head.add(hoodSide);
  });
  // 角張った眉・縦棒・あごの寄せ集めをやめ、穴あきの一体型フレームにする。
  const roundedPath=(w,h,r,reverse=false)=>{
   const path=reverse?new THREE.Path():new THREE.Shape();
   if(!reverse){
    path.moveTo(-w/2+r,-h/2);path.lineTo(w/2-r,-h/2);
    path.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);path.lineTo(w/2,h/2-r);
    path.quadraticCurveTo(w/2,h/2,w/2-r,h/2);path.lineTo(-w/2+r,h/2);
    path.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);path.lineTo(-w/2,-h/2+r);
    path.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
   }else{
    path.moveTo(-w/2+r,-h/2);path.quadraticCurveTo(-w/2,-h/2,-w/2,-h/2+r);
    path.lineTo(-w/2,h/2-r);path.quadraticCurveTo(-w/2,h/2,-w/2+r,h/2);
    path.lineTo(w/2-r,h/2);path.quadraticCurveTo(w/2,h/2,w/2,h/2-r);
    path.lineTo(w/2,-h/2+r);path.quadraticCurveTo(w/2,-h/2,w/2-r,-h/2);
    path.lineTo(-w/2+r,-h/2);
   }
   path.closePath();return path;
  };
  const frameShape=roundedPath(.648,.60,.085,false);
  frameShape.holes.push(roundedPath(.492,.472,.06,true));
  const frameGeo=new THREE.ExtrudeGeometry(frameShape,{depth:.055,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:.006,bevelThickness:.008,curveSegments:10});
  const frame=new THREE.Mesh(frameGeo,new THREE.MeshBasicMaterial({color:0x77746f,side:THREE.DoubleSide}));
  frame.position.set(0,0,-.338);head.add(frame);
  // 開口部の縁に明るい薄い裏地を置き、顔とフードの境界を分かりやすくする。
  const liningShape=roundedPath(.504,.484,.062,false);
  liningShape.holes.push(roundedPath(.476,.456,.052,true));
  const liningGeo=new THREE.ExtrudeGeometry(liningShape,{depth:.006,steps:1,bevelEnabled:false,curveSegments:10});
  const lining=new THREE.Mesh(liningGeo,liningMat);lining.position.set(0,0,-.355);head.add(lining);
  // 前面の小さな猫鼻と口。着用者の顔の領域には入れず、額パネルの中へ収める。
  const noseShape=new THREE.Shape();
  noseShape.moveTo(-.018,.012);noseShape.quadraticCurveTo(0,.016,.018,.012);
  noseShape.quadraticCurveTo(.011,-.002,0,-.012);noseShape.quadraticCurveTo(-.011,-.002,-.018,.012);noseShape.closePath();
  const nose=new THREE.Mesh(new THREE.ShapeGeometry(noseShape,10),new THREE.MeshBasicMaterial({color:0xd98591,side:THREE.DoubleSide}));
  nose.position.set(0,.267,-.363);head.add(nose);
  const makeMouth=(side)=>{
   const curve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,.246,-.364),new THREE.Vector3(side*.009,.237,-.364),new THREE.Vector3(side*.021,.245,-.364)
   ]);
   return new THREE.Mesh(new THREE.TubeGeometry(curve,8,.0023,5,false),mouthMat);
  };
  head.add(makeMouth(-1),makeMouth(1));
  // 耳は左右対称の丸みある三角形。内耳を外耳の前面へ出して、正面から確実に見えるようにする。
  const makeOuterEar=()=>{
   const sh=new THREE.Shape();
   sh.moveTo(-.092,.006);sh.quadraticCurveTo(-.112,.031,-.091,.068);
   sh.lineTo(-.036,.188);sh.quadraticCurveTo(-.019,.226,0,.222);
   sh.quadraticCurveTo(.019,.226,.036,.188);sh.lineTo(.091,.068);
   sh.quadraticCurveTo(.112,.031,.092,.006);sh.quadraticCurveTo(0,-.008,-.092,.006);sh.closePath();return sh;
  };
  const makeInnerEar=()=>{
   const sh=new THREE.Shape();
   sh.moveTo(-.057,.034);sh.quadraticCurveTo(-.069,.052,-.052,.081);
   sh.lineTo(-.028,.153);sh.quadraticCurveTo(-.017,.181,0,.179);
   sh.quadraticCurveTo(.017,.181,.028,.153);sh.lineTo(.052,.081);
   sh.quadraticCurveTo(.069,.052,.057,.034);sh.quadraticCurveTo(0,.023,-.057,.034);sh.closePath();return sh;
  };
  const earGeo=new THREE.ExtrudeGeometry(makeOuterEar(),{depth:.072,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:.008,bevelThickness:.008,curveSegments:10});
  const innerGeo=new THREE.ShapeGeometry(makeInnerEar(),10);
  [-1,1].forEach(side=>{
   const ear=new THREE.Group();ear.position.set(side*.244,.263,-.333);ear.scale.x=side;head.add(ear);
   const outer=new THREE.Mesh(earGeo,hoodMat);outer.material.side=THREE.DoubleSide;ear.add(outer);
   const inner=new THREE.Mesh(innerGeo,innerMat);inner.position.set(0,.002,-.024);inner.renderOrder=5;ear.add(inner);
  });
  // 頬の小さな毛色パッチと左右各3本の細いひげ。ひげは顔の開口部に入らない位置へ。
  [-1,1].forEach(side=>{
   const cheek=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),cheekMat);
   cheek.scale.set(.026,.019,.008);cheek.position.set(side*.285,-.137,-.361);head.add(cheek);
   [[.055,.014],[.005,0],[-.045,-.014]].forEach(([y,dy])=>{
    const curve=new THREE.CatmullRomCurve3([
     new THREE.Vector3(side*.255,y,-.358),
     new THREE.Vector3(side*.283,y+dy*.45,-.359),
     new THREE.Vector3(side*.316,y+dy,-.358)
    ]);
    const whisker=new THREE.Mesh(new THREE.TubeGeometry(curve,10,.0025,5,false),whiskerMat);
    head.add(whisker);
   });
  });
 }else if(headPart===5){ // 郵便帽子：低いクラウン、はっきりした前ひさし、控えめな真鍮バッジ
  const capColor=M(0x52766e),bandColor=M(0x3c5f59),badgeColor=M(0xd7bb83);
  const band=new THREE.Mesh(new THREE.CylinderGeometry(.247,.253,.04,24),bandColor);
  band.position.y=.315;head.add(band);
  const capProfile=[
   new THREE.Vector2(0,.326),new THREE.Vector2(.235,.326),new THREE.Vector2(.238,.35),
   new THREE.Vector2(.224,.386),new THREE.Vector2(.195,.417),new THREE.Vector2(.151,.438),
   new THREE.Vector2(.08,.444),new THREE.Vector2(0,.444)
  ];
  const crown=new THREE.Mesh(new THREE.LatheGeometry(capProfile,24),capColor);head.add(crown);
  const billShape=new THREE.Shape();billShape.moveTo(-.225,0);billShape.quadraticCurveTo(0,-.025,.225,0);billShape.quadraticCurveTo(.205,.09,0,.125);billShape.quadraticCurveTo(-.205,.09,-.225,0);billShape.closePath();
  const bill=new THREE.Mesh(new THREE.ExtrudeGeometry(billShape,{depth:.012,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.004,bevelThickness:.003}),new THREE.MeshBasicMaterial({color:0x3c5f59,side:THREE.DoubleSide}));
  bill.rotation.x=-Math.PI/2;bill.position.set(0,.322,-.19);head.add(bill);
  const badge=new THREE.Mesh(new THREE.SphereGeometry(.019,10,8),badgeColor);badge.position.set(0,.378,-.221);head.add(badge);
   }else if(headPart===6){ // パンダの被り物：v20.128で旧モデルを使わず新規に構成（外殻＋顔窓＋大きな丸耳＋目の斑点・鼻・マズル）
  // ---- 寸法。頭部の標準寸法(幅.91/高.95/奥.86の外殻)は変えない。形はこの定数と顔窓の範囲だけで決まる。
  const rx=.455,ry=.475,rz=.430,cy=.015,wall=.034;
  const AROUND=48,VERT=36;                                   // 経度7.5度・緯度5度の格子
  // 顔窓は通常の顔板(約.42四方)と同等の大きさ：前方±30度・緯度80〜130度(下端は頭ブロックの下端)。格子線上に置く。
  const winTheta=Math.PI*30/180,winTop=Math.PI*80/180,winBottom=Math.PI*130/180;
  const V3=(x,y,z)=>new THREE.Vector3(x,y,z),qI=new THREE.Quaternion();
  const LIGHT=V3(-.30,.82,-.48).normalize();                 // 前上方からの擬似光源(頭部座標)
  const vcMat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  const WHT0=[.83,.82,.80],WHT1=[1,1,1],CRM0=[.88,.86,.80],CRM1=[.99,.97,.92];
  const BLK0=[.085,.088,.095],BLK1=[.21,.215,.225],INN0=[.72,.70,.66],INN1=[.86,.84,.80];

  // 面ごとの陰影を頂点色へ焼き込む。unlit材質でも低ポリの面が立体として読める。
  const shadeFacets=(g,c0,c1)=>{
   const p=g.attributes.position,col=new Float32Array(p.count*3);
   for(let i=0;i+2<p.count;i+=3){
    const ax=p.getX(i),ay=p.getY(i),az=p.getZ(i);
    const ux=p.getX(i+1)-ax,uy=p.getY(i+1)-ay,uz=p.getZ(i+1)-az;
    const wx=p.getX(i+2)-ax,wy=p.getY(i+2)-ay,wz=p.getZ(i+2)-az;
    const nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx,len=Math.hypot(nx,ny,nz)||1;
    const lit=Math.max(0,(nx*LIGHT.x+ny*LIGHT.y+nz*LIGHT.z)/len);
    for(let n=0;n<3;n++){const q=(i+n)*3;for(let c=0;c<3;c++)col[q+c]=c0[c]+(c1[c]-c0[c])*lit;}
   }
   g.setAttribute('color',new THREE.BufferAttribute(col,3));return g;
  };
  const matrixOf=(pos,quat,scale)=>new THREE.Matrix4().compose(pos,quat,scale);
  // 形状を頭部座標へ焼き込み、陰影をつけて head へ追加する。
  const put=(geom,m,c0,c1)=>{
   if(m)geom.applyMatrix4(m);
   const g=geom.index?geom.toNonIndexed():geom;
   const mesh=new THREE.Mesh(shadeFacets(g,c0,c1),vcMat);head.add(mesh);return mesh;
  };
  // ローカルz軸を法線nへ、y軸をupに近い向きへ合わせる回転。
  const frameQuat=(n,up)=>{
   const y=up.clone().addScaledVector(n,-up.dot(n)).normalize();
   const x=new THREE.Vector3().crossVectors(y,n);
   return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,n));
  };
  const nrm=p=>V3(p.x/(rx*rx),(p.y-cy)/(ry*ry),p.z/(rz*rz)).normalize();   // 外殻の外向き法線
  const surf=(x,y)=>{                                                         // 外殻前面(-Z側)の点と法線
   const z=-rz*Math.sqrt(Math.max(.0004,1-(x/rx)**2-((y-cy)/ry)**2)),p=V3(x,y,z);
   return{p,n:nrm(p)};
  };

  // ---- 外殻と内殻：楕円球面の三角形。顔窓に当たる格子だけを取り除く。
  const shellGeom=(ax,ay,az,c0,c1)=>{
   const P=(j,k)=>{const phi=Math.PI*j/VERT,th=-Math.PI+2*Math.PI*k/AROUND;return[ax*Math.sin(phi)*Math.sin(th),cy+ay*Math.cos(phi),-az*Math.sin(phi)*Math.cos(th)]};
   const pos=[];
   for(let j=0;j<VERT;j++){
    const phiMid=Math.PI*(j+.5)/VERT;
    for(let k=0;k<AROUND;k++){
     const thMid=-Math.PI+2*Math.PI*(k+.5)/AROUND,ang=Math.atan2(Math.sin(thMid),Math.cos(thMid));
     if(Math.abs(ang)<winTheta&&phiMid>winTop&&phiMid<winBottom)continue;
     const a=P(j,k),b=P(j,(k+1)%AROUND),c=P(j+1,k),d=P(j+1,(k+1)%AROUND);
     pos.push(...a,...b,...c,...b,...d,...c);   // θ→φ の順で外向き
    }
   }
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
   const mesh=new THREE.Mesh(shadeFacets(g,c0,c1),vcMat);head.add(mesh);return mesh;
  };
  shellGeom(rx,ry,rz,WHT0,WHT1);
  const iRx=rx-wall,iRy=ry-wall,iRz=rz-wall-.004;
  shellGeom(iRx,iRy,iRz,INN0,INN1);

  // ---- 顔窓の縁：窓の矩形に沿う角丸の白い枠。
  const rimPts=[],A=winTheta,rT=.08,rP=.08;
  const rimAt=(th,ph)=>V3((rx-.004)*Math.sin(ph)*Math.sin(th),cy+(ry-.004)*Math.cos(ph),-(rz-.004)*Math.sin(ph)*Math.cos(th));
  const seg=(t0,p0,t1,p1,n)=>{for(let i=0;i<n;i++){const u=i/n;rimPts.push(rimAt(t0+(t1-t0)*u,p0+(p1-p0)*u))}};
  const arc=(ct,cp,a0,a1,n)=>{for(let i=0;i<n;i++){const a=a0+(a1-a0)*i/n;rimPts.push(rimAt(ct+rT*Math.cos(a),cp+rP*Math.sin(a)))}};
  seg(-A+rT,winTop,A-rT,winTop,5);
  arc(A-rT,winTop+rP,-Math.PI/2,0,4);
  seg(A,winTop+rP,A,winBottom-rP,4);
  arc(A-rT,winBottom-rP,0,Math.PI/2,4);
  seg(A-rT,winBottom,-A+rT,winBottom,5);
  arc(-A+rT,winBottom-rP,Math.PI/2,Math.PI,4);
  seg(-A,winBottom-rP,-A,winTop+rP,4);
  arc(-A+rT,winTop+rP,Math.PI,Math.PI*1.5,4);
  put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts,true,'centripetal'),96,.015,6,true),null,[.88,.86,.82],[1,.99,.96]);

  // ---- 顔パネル：内殻と同じ曲面に張り、窓と同じ範囲へ揃える。元の頭ブロックと顔板は隠す。
  const faceMat=new THREE.MeshBasicMaterial({map:skinTex(sk&&sk.face,16,16,0xffe0c0),transparent:false,side:THREE.DoubleSide,depthWrite:true});
  {
   const across=12,rows=10,vs=[],uvs=[],ix=[];
   for(let j=0;j<=rows;j++){
    const v=j/rows,phi=winTop+(winBottom-winTop)*v;
    for(let i=0;i<=across;i++){
     const u=i/across,th=-winTheta+2*winTheta*u;
     vs.push(iRx*Math.sin(phi)*Math.sin(th),cy+iRy*Math.cos(phi),-iRz*Math.sin(phi)*Math.cos(th));
     uvs.push(u,1-v);
    }
   }
   for(let j=0;j<rows;j++)for(let i=0;i<across;i++){const a=j*(across+1)+i,b=a+1,c=a+across+1,d=c+1;ix.push(a,b,c,b,d,c);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vs,3));
   g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(ix);
   const panel=new THREE.Mesh(g,faceMat);panel.renderOrder=5;head.add(panel);
  }
  const headBaseMesh=head.children.find(o=>o.isMesh&&o.geometry&&o.geometry.type==='BoxGeometry');
  if(headBaseMesh)headBaseMesh.visible=false;

  [-1,1].forEach(side=>{
   // 耳：頭頂の左右に置く大きな黒い半球。下側を殻へ沈め、外へ出た丸みだけを見せる。
   const ep=V3(side*.33,0,0);ep.y=cy+ry*Math.sqrt(1-(ep.x/rx)**2-(ep.z/rz)**2);
   const en=nrm(ep),earGeom=new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2);earGeom.rotateX(Math.PI/2);
   put(earGeom,matrixOf(ep.clone().addScaledVector(en,-.018),frameQuat(en,V3(0,0,-1)),V3(.125,.125,.085)),BLK0,BLK1);

   // 目の斑点：内側の上端が中心へ傾く縦長の黒い楕円。白目・黒目・ハイライトを重ねる。
   const s=surf(side*.14,.29),t=.45;
   const parent=matrixOf(s.p.clone().addScaledVector(s.n,-.012),frameQuat(s.n,V3(-side*Math.sin(t),Math.cos(t),0)),V3(1,1,1));
   const part=(geom,lp,ls,c0,c1)=>put(geom,parent.clone().multiply(matrixOf(lp,qI,ls)),c0,c1);
   part(new THREE.SphereGeometry(1,12,8),V3(0,0,0),V3(.060,.092,.032),BLK0,BLK1);
   // 白目・黒目・ハイライトは殻の傾きに合わせず、正面(-Z)を向けて貼る。黒目は少しだけ鼻側へ寄せ、外向き(ロンパリ)に見えないようにする。
   const eyeAt=(dx,dy,dz)=>{const e=s.p.clone().addScaledVector(s.n,.020);return V3(e.x+dx,e.y+dy,e.z+dz)};  // 斑点の頂点が基準
   const inward=-side*.005;
   put(new THREE.SphereGeometry(1,10,8),matrixOf(eyeAt(0,-.002,-.004),qI,V3(.028,.032,.014)),WHT0,WHT1);
   put(new THREE.SphereGeometry(1,8,6),matrixOf(eyeAt(inward,-.002,-.012),qI,V3(.016,.019,.011)),BLK0,BLK1);
   put(new THREE.SphereGeometry(1,6,4),matrixOf(eyeAt(inward,.008,-.020),qI,V3(.0055,.006,.004)),WHT0,WHT1);
  });

  // マズルと鼻：顔窓のすぐ上の前面。
  const mu=surf(0,.155);
  put(new THREE.SphereGeometry(1,14,8),matrixOf(mu.p.clone().addScaledVector(mu.n,-.012),frameQuat(mu.n,V3(0,1,0)),V3(.080,.036,.032)),CRM0,CRM1);
  const no=surf(0,.176);
  put(new THREE.SphereGeometry(1,10,7),matrixOf(no.p.clone().addScaledVector(no.n,.004),frameQuat(no.n,V3(0,1,0)),V3(.030,.021,.019)),BLK0,BLK1);
  // 口：鼻の下の縦線と左右の短い笑い線。
  // 口線はマズルの曲面に沿わせる(マズルの高さ＝半球の盛り上がり−沈め量)。
  const mouthMat=M(0x292929),mzH=(x,y)=>Math.max(0,.032*Math.sqrt(Math.max(0,1-(x/.080)**2-((y-.155)/.036)**2))-.012)+.002;
  const mk=(x,y)=>{const s=surf(x,y);return s.p.addScaledVector(s.n,mzH(x,y))};
  [-1,1].forEach(side=>{
   const curve=new THREE.CatmullRomCurve3([mk(0,.152),mk(0,.141),mk(side*.010,.132),mk(side*.026,.136)]);
   head.add(new THREE.Mesh(new THREE.TubeGeometry(curve,10,.002,5,false),mouthMat));
  });
 }

 const armLen=.47,legLen=.47;
 // 手足の付け根は胴体へ少し重ねて、隙間や浮いた見え方を防止する。
 const armL=joint(-.32,1.12-torsoPivot.position.y,.20,armLen,.18,torsoPivot),armR=joint(.32,1.12-torsoPivot.position.y,.20,armLen,.18,torsoPivot);
 const legL=joint(-.145,.66-torsoPivot.position.y,.17,legLen,.17,torsoPivot),legR=joint(.145,.66-torsoPivot.position.y,.17,legLen,.17,torsoPivot);
 // 足は脚幅に近いサイズへ抑え、脚の下に別の足が浮いて見えないよう上端と接続する。
 const shoeMat=M(0x82796a),footH=.18,footY=-(legLen+footH/2);
 const footL=box(.185,footH,.22,shoeMat,footY,.035),footR=box(.185,footH,.22,shoeMat,footY,.035);
 footL.position.z=-.05;footR.position.z=-.05;legL.add(footL);legR.add(footR);
 // 右手の先に手のひらを重ね、ペンの持ち位置が腕の中に埋もれないようにする。
 const handPalm=new THREE.Mesh(roundedBoxGeometry(.145,.11,.14,.03),M(limb));handPalm.position.set(0,-.435,-.015);armR.add(handPalm);
 // ペンは右手の握り位置に常時装着。軸を下向き＋前向きに傾け、突くときは腕の回転で前方を向く。
 const pokePen=makePencilProp(.8,.55,M(limb));pokePen.name='pokePenProp';pokePen.position.set(0,-.405,-.115);pokePen.visible=false;armR.add(pokePen);
 return{root,head,torso:torsoPivot,armL,armR,legL,legR,footL,footR,pokePen,holdingPen:false,pokeAt:0,t:0,crouchMix:0,emo:null,heart:null,g:null};
}
const HEAD_YAW_LIMIT=.48;       // 左右約27.5度
const HEAD_PITCH_UP=.34;        // 上向き約19.5度
const HEAD_PITCH_DOWN=.42;      // 下向き約24度
const angleDelta=(target,current)=>Math.atan2(Math.sin(target-current),Math.cos(target-current));
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function headYawFor(viewYaw,bodyYaw,speed){
 // 歩行・走行中は頭の横振りを控え、胴体が進行方向へ向くのを優先する。
 const moveBlend=clamp((Math.max(0,speed)-.12)/1.8,0,1);
 const limit=HEAD_YAW_LIMIT*(1-.82*moveBlend);
 return clamp(angleDelta(viewYaw,bodyYaw),-limit,limit);
}
function animAv(a,dt,speed,crouching=false,lookYaw=0,lookPitch=0){
 // しゃがみの切替は約0.15秒で収束させ、カメラと同じ補間値を共有する。
 const targetCrouch=crouching===true?1:(Number.isFinite(crouching)?Math.max(0,Math.min(1,crouching)):0);
 a.crouchMix=(a.crouchMix||0)+(targetCrouch-(a.crouchMix||0))*(1-Math.exp(-dt*22));
 const crouch=a.crouchMix;
 // 首は視点へ追従するが、解剖学的な範囲を超えず、急なマウス操作も滑らかに吸収する。
 const targetHeadYaw=clamp(Number.isFinite(lookYaw)?lookYaw:0,-HEAD_YAW_LIMIT,HEAD_YAW_LIMIT);
 const targetHeadPitch=clamp(Number.isFinite(lookPitch)?lookPitch:0,-HEAD_PITCH_DOWN,HEAD_PITCH_UP);
 a.lookYaw=(a.lookYaw||0)+(targetHeadYaw-(a.lookYaw||0))*(1-Math.exp(-dt*12));
 a.lookPitch=(a.lookPitch||0)+(targetHeadPitch-(a.lookPitch||0))*(1-Math.exp(-dt*12));
 const moving=speed>.12,baseGait=moving?Math.min(1,Math.max(0,(speed-.12)/1.8)):0;
 const gait=baseGait*(1-crouch*.72);
 a.t+=dt*(1+Math.min(speed,6)*.8);
 const phase=a.t*7.5,stride=Math.sin(phase)*gait;
 let aL=-stride*.62,aR=stride*.62,up=moving?Math.abs(Math.sin(phase*2))*.028:Math.sin(a.t*1.2)*.004,nod=moving?Math.sin(phase*2)*.025:0,legLA=stride*.68,legRA=-stride*.68;
 if(!moving){aL=Math.sin(a.t*1.35)*.025;aR=-aL;legLA=Math.sin(a.t*1.1)*.012;legRA=-legLA}
 if(a.emo){
  const k=a.emo.k,dur=k===4?2800:1500;
  const u=(performance.now()-a.emo.at)/dur;
  if(u>=1){a.emo=null;if(a.heart){a.g.remove(a.heart);a.heart=null}}
  else{
   if(k===0)aR=2.8+Math.sin(u*45)*.4;
   else if(k===1){aL=aR=3;up=Math.abs(Math.sin(u*Math.PI*3))*.5}
   else if(k===2)nod=Math.sin(u*Math.PI*6)*.35;
   else if(k===4){
    // ダンス: 腕と脚を左右交互、軽く上下
    const w=u*Math.PI*10;
    aL=Math.sin(w)*1.4+.2;aR=Math.sin(w+Math.PI)*1.4+.2;
    legLA=Math.sin(w)*.7;legRA=Math.sin(w+Math.PI)*.7;
    up=Math.abs(Math.sin(w*2))*.18;
    nod=Math.sin(w)*.2;
   }
   if(a.heart)a.heart.position.y=2.4+u*.8;
  }
 }
 // 胴体と頭を連動させ、頭は前を向いたまま、上半身を前傾させて腰を下げる。
 const torsoTilt=(moving?Math.abs(stride)*.012:0)-crouch*.20;
 if(a.torso){
  a.torso.position.y=.955-crouch*.34;
  a.torso.rotation.z=moving?-stride*.035:Math.sin(a.t*1.1)*.004;
  a.torso.rotation.x=torsoTilt;
 }
 a.head.rotation.y=a.lookYaw;
 a.head.rotation.x=clamp(nod+crouch*.20+a.lookPitch,-.50,.50);
 const pokeElapsed=a.pokeAt?((performance.now()-a.pokeAt)/360):2;
 const pokeMix=pokeElapsed>=0&&pokeElapsed<1?Math.sin(Math.PI*pokeElapsed):0;
 a.armL.rotation.x=aL+crouch*.36-pokeMix*.12;a.armR.rotation.x=aR+crouch*.36+pokeMix*1.28;
 a.armL.rotation.z=-crouch*.055;a.armR.rotation.z=crouch*.055;
 if(a.pokePen)a.pokePen.visible=a.holdingPen===true||pokeMix>.12;
 const crouchLeg=crouch*.28,hipY=.66-crouch*.04;
 const settleFoot=(leg,foot,legSwing)=>{
  // 脚の付け根は胴体のローカル座標で設定し、ワールド上の高さをhipYに保つ。
  leg.position.y=(hipY-a.torso.position.y)/Math.max(.8,Math.cos(a.torso.rotation.x));
  leg.rotation.x=legSwing+crouchLeg;
  leg.rotation.z=(leg===a.legL?-1:1)*crouch*.025;
  // 靴の中心を地面から0.10m、前後位置-0.05mに保つ静止姿勢を逆変換で求める。
  // 歩行分(legSwing)は残し、しゃがみ姿勢だけで靴が傾いたり地面へ沈んだりしないようにする。
  const tx=a.torso.rotation.x, legY=leg.position.y;
  const hipWorldY=a.torso.position.y+legY*Math.cos(tx);
  const hipWorldZ=legY*Math.sin(tx);
  const poseAngle=tx+crouchLeg;
  const dy=.10-hipWorldY,dz=-.05-hipWorldZ;
  const targetY=dy*Math.cos(poseAngle)+dz*Math.sin(poseAngle);
  const targetZ=-dy*Math.sin(poseAngle)+dz*Math.cos(poseAngle);
  foot.position.y=THREE.MathUtils.lerp(-.56,targetY,crouch);
  foot.position.z=THREE.MathUtils.lerp(-.05,targetZ,crouch);
  foot.rotation.x=-crouch*poseAngle;
 };
 settleFoot(a.legL,a.footL,legLA);settleFoot(a.legR,a.footR,legRA);
 a.root.position.y=up*(1-crouch*.85);
}
function playEmote(a,k){
 Snd.play('emote');a.emo={k,at:performance.now()};if(a.heart){a.g.remove(a.heart);a.heart=null}
 if(k===3){a.heart=lbl('♥',64,64,56,'rgba(0,0,0,0)','#e53935');a.heart.scale.set(.6,.6,1);a.heart.position.y=2.4;a.g.add(a.heart)}
}
const selfG=new THREE.Group();let selfAv,selfBodyYaw=0;
function rebuildSelf(){
 if(selfAv)selfG.remove(selfAv.root);
 selfAv=makeAvatar(mySkin,myCol);selfAv.g=selfG;selfG.add(selfAv.root);
 updateFirstPersonPenColor();
}
rebuildSelf();selfG.visible=false;scene.add(selfG);
function toggleEmo(v){emoOpen=v===undefined?!emoOpen:v;$('emo').style.display=emoOpen?'flex':'none'}
function emote(k){toggleEmo(false);playEmote(selfAv,k);Net.send({t:'emo',id:Net.id,k})}
document.querySelectorAll('#emo button').forEach((b,i)=>b.onclick=()=>emote(i));

/* ---- 他のプレイヤー ---- */
const others=new Map();
const colCss=c=>'#'+(((c>>>0)&0xffffff).toString(16).padStart(6,'0'));
function nameColFor(name,id){
 if(id&&id===Net.id)return myCol;
 if(id&&others.has(id))return others.get(id).col;
 if(name&&name===myName)return myCol;
 for(const o of others.values())if(o.name===name)return o.col;
 return null;
}
function lbl(text,w,h,fs,bg,fg){
 const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
 x.fillStyle=bg;x.beginPath();if(x.roundRect)x.roundRect(0,0,w,h,h/4);else x.rect(0,0,w,h);x.fill();
 // 名前色: 枠線＋文字
 if(fg&&fg!=='#fff'&&fg!=='#ffffff'){x.strokeStyle=fg;x.lineWidth=4;x.stroke();x.fillStyle=fg}
 else x.fillStyle=fg||'#fff';
 x.font='bold '+fs+'px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(text,w/2,h/2+2);
 const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true}));s.scale.set(w/h*.32,.32,1);return s;
}
function addPlayer(m){
 if(m.id===Net.id||others.has(m.id))return;Snd.play('join');
 const g=new THREE.Group(),av=makeAvatar(unpackSkin(m.sk),m.col);av.g=g;g.add(av.root);
 const nm=lbl(m.name,256,64,32,'rgba(0,0,0,.55)',colCss(m.col));nm.position.y=2.2;g.add(nm);g.visible=false;scene.add(g);
 others.set(m.id,{g,av,name:m.name,col:m.col,sk:m.sk,tp:new THREE.Vector3(),ty:0,viewYaw:0,lookYaw:null,lookPitch:0,crouch:false,heldPen:m.heldPen===true,fresh:true,bub:null,until:0});av.holdingPen=m.heldPen===true;setInfo();
}
function removePlayer(id){const o=others.get(id);if(!o)return;Snd.play('leave');scene.remove(o.g);others.delete(id);setInfo();paintPlayers()}
function showBubble(id,text){
 const o=others.get(id);if(!o)return;
 if(o.bub){o.g.remove(o.bub);o.bub.material.map.dispose();o.bub.material.dispose()}
 o.bub=lbl(text.length>26?text.slice(0,26)+'…':text,512,64,30,'rgba(255,255,255,.92)','#222');o.bub.position.y=2.75;o.g.add(o.bub);o.until=performance.now()+5000;
}
const escHtml=s=>String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const chatHist=[]; // {name,text,at,sys}
const CHAT_HIST_MAX=120;
function addLog(name,text){
 const sys=name==='システム'||name==='お題';
 if(!sys)Snd.play('chat');
 chatHist.push({name:String(name||''),text:String(text||''),at:Date.now(),sys});
 while(chatHist.length>CHAT_HIST_MAX)chatHist.shift();
 const d=document.createElement('div');
 d.innerHTML='<span class="nm">'+escHtml(name)+'</span>: '+escHtml(text);
 const l=$('log');if(l){l.appendChild(d);while(l.children.length>8)l.removeChild(l.firstChild);setTimeout(()=>{if(d.parentNode)d.remove()},30000)}
 if(typing)renderChatHist(true);
}
function fmtChatTime(at){
 const d=new Date(at),p=n=>String(n).padStart(2,'0');
 return p(d.getHours())+':'+p(d.getMinutes());
}
function renderChatHist(stickBottom){
 const box=$('chatHistBox');if(!box)return;
 const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<48;
 box.innerHTML=chatHist.map(h=>{
  const cls=h.sys?'ch-row ch-sys':'ch-row';
  return '<div class="'+cls+'"><span class="ch-time">'+fmtChatTime(h.at)+'</span><span class="ch-nm">'+escHtml(h.name)+'</span>: '+escHtml(h.text)+'</div>';
 }).join('')||'<div class="ch-row" style="opacity:.6">まだメッセージはありません</div>';
 if(stickBottom||nearBottom)requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight});
}

/* ---- 同期 ---- */
function rle(){const r=[];let p=world[0],n=1;for(let i=1;i<world.length;i++){if(world[i]===p&&n<65535)n++;else{r.push(p,n);p=world[i];n=1}}r.push(p,n);return r}
function unrle(r){let i=0;for(let j=0;j<r.length;j+=2){world.fill(r[j],i,i+r[j+1]);i+=r[j+1]}}
function snapshot(){const keys=[...paint.keys()],u=new Uint16Array(keys.length*PX);keys.forEach((k,i)=>u.set(paint.get(k).d,i*PX));return{rle:rle(),keys,data:new Uint8Array(u.buffer)}}
function applySnapshot(m){
 unrle(m.rle);refreshNaturalCaveWallCells(world);resetPaint();
 const incomingStation=normalizePhoneStation(m.phoneStation);phoneStation=incomingStation;
 let d;
 if(typeof m.data==='string'){const buf=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));d=new Uint16Array(buf.buffer,buf.byteOffset,buf.byteLength/2)}
 else d=new Uint16Array(new Uint8Array(m.data).slice().buffer);
 m.keys.forEach((k,i)=>{for(let p=0;p<PX;p++){const c=d[i*PX+p];if(c)setPix(k,p%TS,(p/TS)|0,c)}});
 faceAuthor.clear();
 if(Array.isArray(m.authors))for(const a of m.authors){if(a&&a[0]&&a[1])faceAuthor.set(a[0],String(a[1]).slice(0,12))}
 wDirty=oDirty=true;undoS.length=redoS.length=0;
}
let worldLoadPending=false;
Net.onLeave=id=>removePlayer(id);
Net.onReady=id=>{}; // サーバー方式では init で開始
let lastJoin=null,discShown=false,leaveIntent=false;
function showDisc(msg){
 const d=$('disc');if(!d)return;
 discShown=true;
 d.style.display='block';
 const m=$('discMsg');if(m)m.textContent=msg||'接続が切れました';
 if($('info'))setInfo();
}
function hideDisc(){const d=$('disc');if(d)d.style.display='none';discShown=false}
Net.onError=e=>{
 if(e.type==='world')worldLoadPending=false;
 if(e.type==='disconnected')return;
 // キック/BAN理由はユーザーに出さない
 const forceGeneric=e.type==='closed'||e.type==='banned';
 const msg=forceGeneric?'接続が切れました':(e.msg||({
  closed:'接続が切れました',
  banned:'接続が切れました',
  'join-pw':'入場パスワードが違います',
  name:'なまえを入力してください',
  version:'バージョンが違います（同じ版のHTMLを使ってください）',
  full:'サーバーが満員です',
  lib:'サーバーに接続できません（サーバー起動とURLを確認してください）',
  rate:'操作が早すぎます'
 }[e.type]||('接続エラー（'+e.type+'）')));
 $('st').textContent=msg;
 if(started){addLog('システム',msg);showDisc(msg);toast(msg)}
 else if($('lobby'))$('lobby').style.display='flex';
};
Net.onMsg=m=>{
 if(m.t&&m.t.startsWith('phone-')){if(window.RakugakiPhoneBridge)window.RakugakiPhoneBridge.dispatch(m);return}
 switch(m.t){
  case'spore-state':syncSporeState(m);break;
  case'spore-slow':{
   const ms=Math.max(500,Math.min(2400,Number(m.ms)||1450)),wasSlow=Date.now()<sporeFx.slowUntil;
   sporeFx.slowUntil=Math.max(sporeFx.slowUntil,Date.now()+ms);
   if(!wasSlow&&Date.now()-sporeFx.lastSlowToastAt>2500){toast('胞子を浴びて動きが鈍くなった');sporeFx.lastSlowToastAt=Date.now()}
   break}
  case'spore-poke-result':
   if(m.hit){if(selfAv)selfAv.pokeAt=performance.now();toast('ペンで突いて胞子吐きがひるんだ！')}
   else if(Date.now()-sporeFx.lastPokeToastAt>1400){
    const msg=m.reason==='tool'?'ペンを選んでいるときだけ使えます':m.reason==='far'?'もう少し近づいてください':m.reason==='blocked'?'障害物があって届きません':m.reason==='recovering'?'胞子吐きはまだひるんでいます':m.reason==='cave'?'洞窟の中でだけ使えます':'胞子吐きに照準を合わせてください';
    toast(msg);sporeFx.lastPokeToastAt=Date.now();
   }
   break;
  case'spore-poke-action':{
   if(m.id!==Net.id){const o=others.get(m.id);if(o&&o.av)o.av.pokeAt=performance.now()}
   break;
  }
  case'disaster-state':applyDisastersEnabled(m.enabled===true,true);if(m.activeDisaster)startDisasterEffect(m.activeDisaster);else if(!m.enabled)stopDisasterEffect();break;
  case'disaster-event':if(disastersEnabled)startDisasterEffect(m);break;
  case'disaster-ended':stopDisasterEffect(m.id);break;
  case'kesaran-state':applyKesaranEventsEnabled(m.enabled===true,true,m.activeKesaranEvent||null);break;
  case'kesaran-event':if(kesaranEventsEnabled)startKesaranEffect(m);break;
  case'kesaran-ended':stopKesaranEffect(m.id);break;
  case'horror-state':applyHorrorEnabled(m.enabled===true,true);break;
  case'horror-event':if(m.kind==='phone-ring')receivePhoneHauntRing(m);else showHorrorEvent(m);break;
  case'horror-phone-answered':showPhoneHauntVoice(m);break;
  case'horror-phone-ended':endPhoneHaunt(m);break;
  case'critters':syncAmbientCreatures(m.creatures||[]);syncMischiefCreature(m.mischiefCreature||null);syncForestResident(m.forestResident||null);syncWiseCharacter(m.wiseCharacter||null);break;
  case'init':{worldLoadPending=false;if(m.ver!==VER){Net.onError({type:'version'});break}
   if(m.room)room=m.room;
   const wasDisc=discShown;
   hideDisc();
   // 再接続時は他プレイヤーを一旦クリア
   for(const id of[...others.keys()])removePlayer(id);
   Object.assign(perm,m.perm||{});
   if(typeof m.topicEnabled==='boolean')topicEnabled=m.topicEnabled;
   if(m.topicAt)topicAt=+m.topicAt;
   if(m.topicInterval)topicInterval=+m.topicInterval;
   applySnapshot(m);(m.players||[]).forEach(addPlayer);
   if(m.worldTheme)applyWorldTheme(m.worldTheme);syncAmbientCreatures(m.creatures||[]);syncMischiefCreature(m.mischiefCreature||null);syncForestResident(m.forestResident||null);syncWiseCharacter(m.wiseCharacter||null);syncSporeState(m.sporeState||{});showTopic(m.topic||'',null);
   if(typeof m.horrorEnabled==='boolean')applyHorrorEnabled(m.horrorEnabled,true);
   if(typeof m.disastersEnabled==='boolean')applyDisastersEnabled(m.disastersEnabled,true);
   if(m.activeDisaster&&m.disastersEnabled)startDisasterEffect(m.activeDisaster);
   if(typeof m.kesaranEventsEnabled==='boolean')applyKesaranEventsEnabled(m.kesaranEventsEnabled,true,m.activeKesaranEvent||null);
   start();paintPlayers();
   if(wasDisc)toast('再接続しました');
   break}
  case'forest-talk-result':if(!m.ok){if(m.reason==='busy')toast('ポストンが次のひらめきを考えてるよ');else if(m.reason==='far')toast('もう少し近づいてね')}break;
  case'wise-talk-result':if(!m.ok){if(m.reason==='busy')toast('ホシヨミは考え中じゃ');else if(m.reason==='far')toast('もう少し近づいてね')}break;
  case'hello':addPlayer(m);paintPlayers();break;
  case'pos':{const o=others.get(m.id);if(o){o.tp.set(m.p[0],m.p[1],m.p[2]);o.viewYaw=Number.isFinite(m.y)?m.y:0;o.ty=Number.isFinite(m.by)?m.by:o.viewYaw;o.lookYaw=Number.isFinite(m.hy)?clamp(m.hy,-HEAD_YAW_LIMIT,HEAD_YAW_LIMIT):null;o.lookPitch=Number.isFinite(m.pitch)?clamp(m.pitch,-1.5,1.5):0;o.crouch=m.crouch===true;o.heldPen=m.heldPen===true;if(o.av)o.av.holdingPen=o.heldPen;if(o.fresh){o.g.position.copy(o.tp);o.g.rotation.y=o.ty;o.g.visible=true;o.fresh=false}}break}
  case'blk':setBlock(m.x,m.y,m.z,m.b,false);break;
  case'pen':{
  if(!m.s)break;
  for(const[k,x,y,c]of m.s)setPix(k,x,y,c);
  if(m.name&&m.s.length){for(const it of m.s)if(it&&it[0])faceAuthor.set(it[0],m.name)}
  break;
 }
  case'chat':if(m.id===Net.id)break;addLog(m.name,m.text);showBubble(m.id,m.text);break;
  case'topic':{
   if(typeof m.topicEnabled==='boolean')topicEnabled=m.topicEnabled;
   if(m.topicAt)topicAt=+m.topicAt;
   if(m.topicInterval)topicInterval=+m.topicInterval;
   showTopic(m.topic||'',m.by||null);
   if(topicEnabled&&m.topic){addLog('お題',m.topic);toast('お題: '+m.topic)}
   else if(!topicEnabled){addLog('システム','お題がオフになりました');toast('お題オフ')}
   paintAdmin();
   break}
  case'perm':perm.blk=m.blk;perm.pen=m.pen;paintAdmin();break;
  case'clear':applyClear(m.what,m.theme,m.phoneStation);if(Array.isArray(m.creatures))syncAmbientCreatures(m.creatures);if('mischiefCreature' in m)syncMischiefCreature(m.mischiefCreature);if('forestResident' in m)syncForestResident(m.forestResident);if('wiseCharacter' in m)syncWiseCharacter(m.wiseCharacter);if(m.sporeState)syncSporeState(m.sporeState);break;
  case'world':applySnapshot(m);if(Array.isArray(m.creatures))syncAmbientCreatures(m.creatures);if('mischiefCreature' in m)syncMischiefCreature(m.mischiefCreature);if('forestResident' in m)syncForestResident(m.forestResident);if('wiseCharacter' in m)syncWiseCharacter(m.wiseCharacter);if(m.sporeState)syncSporeState(m.sporeState);if(worldLoadPending){worldLoadPending=false;toast('世界を読み込みました')}break;
  case'emo':{const o=others.get(m.id);if(o)playEmote(o.av,m.k);break}
  case'skin':{const o=others.get(m.id);if(o){o.sk=m.sk;o.g.remove(o.av.root);o.av=makeAvatar(unpackSkin(m.sk),o.col);o.av.g=o.g;o.g.add(o.av.root)}break}
  case'col':{
   const o=others.get(m.id);if(!o)break;
   o.col=m.col;
   o.g.remove(o.av.root);o.av=makeAvatar(unpackSkin(o.sk),o.col);o.av.g=o.g;o.g.add(o.av.root);
   for(let i=o.g.children.length-1;i>=0;i--){
    const ch=o.g.children[i];
    if(ch.isSprite&&ch!==o.bub){o.g.remove(ch);if(ch.material){if(ch.material.map)ch.material.map.dispose();ch.material.dispose()}}
   }
   const nm=lbl(o.name,256,64,32,'rgba(0,0,0,.55)',colCss(o.col));nm.position.y=2.2;o.g.add(nm);
   paintPlayers();break}

  case'bye':removePlayer(m.id);paintPlayers();break;
 }
};

/* ---- 管理者権限: サーバーが合言葉で判定（クライアントは Net.admin） ---- */
const perm={blk:true,pen:true};
const isAdmin=()=>Net.admin,canBlk=()=>isAdmin()||perm.blk,canPen=()=>isAdmin()||perm.pen;
let currentTopic='';
let topicEnabled=false,topicAt=0,topicInterval=5*60*1000,topicBy=null;
function topicRemainLabel(){
 if(!topicEnabled||!currentTopic||!topicAt)return '';
 const left=Math.max(0,topicInterval-(Date.now()-topicAt));
 const m=Math.floor(left/60000),sec=Math.floor((left%60000)/1000);
 return '次のお題まで '+m+':'+String(sec).padStart(2,'0');
}
function showTopic(topic,by){
 currentTopic=topic||'';
 if(by!==undefined)topicBy=by;
 const el=$('topic');if(!el)return;
 if(!topicEnabled||!currentTopic){el.style.display='none';return}
 el.style.display='block';
 const sub=topicBy?escHtml(topicBy)+' が更新':'みんなで描いてみよう';
 const rem=topicRemainLabel();
 el.innerHTML='お題: <b>'+escHtml(currentTopic)+'</b><small>'+sub+'</small>'+(rem?'<span class="tleft">'+rem+'</span>':'');
}
function refreshTopicTimer(){if(topicEnabled&&currentTopic)showTopic(currentTopic,topicBy)}
setInterval(refreshTopicTimer,1000);

function applyClear(w,theme,station){if(w==='world'){const th=theme||worldTheme||'nature';applyWorldTheme(th);genTerrain(th);const incomingStation=normalizePhoneStation(station);if(incomingStation)phoneStation=incomingStation;wDirty=true;spawn()}resetPaint();undoS.length=redoS.length=0}
function adminClear(w,theme){
 const msg=w==='world'?('世界を「'+({nature:'自然',paper:'紙とインク',toy:'おもちゃ箱'}[theme]||theme)+'」で生成しますか？（今のブロックと落書きは消えます）'):'落書きをすべて消しますか？';
 if(!confirm(msg))return;
 Net.send({t:'clear',what:w,theme:theme||worldTheme});
}

function adminNextTopic(){if(!isAdmin())return;Net.send({t:'topic'})}
function adminToggleTopic(){if(!isAdmin())return;Net.send({t:'topic',enable:!topicEnabled})}

function setPerm(k,v){if(!isAdmin())return;perm[k]=v;Net.send({t:'perm',blk:perm.blk,pen:perm.pen});paintAdmin()}

/* ---- 世界の保存・読み込み・スクリーンショット ---- */
const ts=()=>new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');
const b64=u=>{let t='';for(let i=0;i<u.length;i+=8192)t+=String.fromCharCode(...u.subarray(i,i+8192));return btoa(t)};
const unb64=t=>Uint8Array.from(atob(t),c=>c.charCodeAt(0));
const gz=async(u,S)=>new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new S('gzip'))).arrayBuffer());
async function packWorld(){const m=snapshot(),j=new TextEncoder().encode(JSON.stringify({ver:WORLD_FORMAT_VER,rle:m.rle,keys:m.keys,data:b64(m.data),phoneStation}));return window.CompressionStream?gz(j,CompressionStream):j}
async function unpackWorld(u){
 if(u[0]===0x1f&&u[1]===0x8b)u=await gz(u,DecompressionStream);
 const o=JSON.parse(new TextDecoder().decode(u));if(o.ver!==WORLD_FORMAT_VER)throw new Error('ワールドデータの形式が違います');
 // Base64を展開する前に、巨大・不正なペイロードを弾く。
 if(!Array.isArray(o.rle)||o.rle.length===0||o.rle.length%2!==0||o.rle.length>WORLD_CELLS*2)throw new Error('ブロックデータの形式が不正です');
 if(!Array.isArray(o.keys)||o.keys.length>MAX_WORLD_KEYS)throw new Error('落書き面の数が上限を超えています');
 if(typeof o.data!=='string'||o.data.length>MAX_WORLD_DATA_CHARS||o.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(o.data))throw new Error('落書きデータの形式または容量が不正です');
 return{rle:o.rle,keys:o.keys,data:unb64(o.data),phoneStation:normalizePhoneStation(o.phoneStation)};
}
function validateWorldImport(snap){
 if(!snap||!Array.isArray(snap.rle)||!Array.isArray(snap.keys)||!(snap.data instanceof Uint8Array))throw new Error('ファイルの構造が不正です');
 if(!snap.rle.length||snap.rle.length%2!==0||snap.rle.length>WORLD_CELLS*2)throw new Error('ブロックデータの形式が不正です');
 let cells=0;
 for(let i=0;i<snap.rle.length;i+=2){const b=snap.rle[i],n=snap.rle[i+1];if(!Number.isInteger(b)||b<0||b>14||!Number.isInteger(n)||n<1||n>WORLD_CELLS)throw new Error('ブロックデータの値が不正です');cells+=n;if(cells>WORLD_CELLS)throw new Error('ブロック数が上限を超えています')}
 if(cells!==WORLD_CELLS)throw new Error('ブロックデータの長さが一致しません');
 if(snap.keys.length>MAX_WORLD_KEYS)throw new Error('落書き面の数が上限を超えています');
 const seen=new Set();
 for(const k of snap.keys){if(typeof k!=='string'||k.length>32||!/^(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*),([0-5])$/.test(k)||seen.has(k))throw new Error('落書きの座標が不正です');const q=k.split(',').map(Number);if(q[0]>=W||q[1]>=H||q[2]>=D)throw new Error('落書きの座標が範囲外です');seen.add(k)}
 const expected=snap.keys.length*PX*2;
 if(snap.data.byteLength!==expected||Math.ceil(expected/3)*4>MAX_WORLD_DATA_CHARS)throw new Error('落書きデータが大きすぎるか、長さが一致しません');
}
const idb=(mode,fn)=>new Promise((res,rej)=>{const r=indexedDB.open('rkb',1);r.onupgradeneeded=()=>r.result.createObjectStore('w');r.onerror=()=>rej(r.error);
 r.onsuccess=()=>{const t=r.result.transaction('w',mode),q=fn(t.objectStore('w'));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)}});
async function saveWorld(){try{const d=await packWorld();await idb('readwrite',st=>st.put(d,'main'))}catch(e){saveDirty=true}}
function dl(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
/* サーバー方式では世界はサーバーが保持。ローカル保存はバックアップ用 */

/* ---- UI ---- */
function setInfo(){
 const n=(discShown?'【切断中】 ':'')+'人数: '+(others.size+1);
 if($('info'))$('info').textContent=n;
}
const bar=$('bar'),pal=$('pal'),slots=[],sws=[];
/* ホットバー9枠: 0-7=ブロック（中身入替可） 8=ペン固定。マイクラのクリエイティブに近い */
const HOTBAR_N=9;
let hbSlot=8; // 選択中スロット（初期はペン）
let hotbar=[0,1,2,3,4,5,6,9]; // 枠0-7に入っている BN インデックス（デフォルトから水・葉を外す）
function loadHotbar(){
 try{
  const a=JSON.parse(ls('rkb_hotbar','null'));
  if(Array.isArray(a)&&a.length===8&&a.every(x=>Number.isInteger(x)&&x>=0)){
   hotbar=a.map(x=>Math.min(x,Math.max(0,BN.length-1)));
  }
 }catch(e){}
}
function saveHotbar(){lsSet('rkb_hotbar',JSON.stringify(hotbar))}
function toolFromHb(){
 if(hbSlot>=8)return penTool();
 const bi=hotbar[hbSlot];
 return (bi>=0&&bi<BN.length)?bi:0;
}
function syncToolFromHb(){tool=toolFromHb()}
function isBlkPickOpen(){const p=$('blkPick');return !!(p&&p.style.display==='flex')}
function rebuildBar(){
 loadHotbar();
 while(slots.length){const d=slots.pop();if(d.parentNode)d.parentNode.removeChild(d)}
 for(let i=0;i<HOTBAR_N;i++){
  const d=document.createElement('div');d.className='slot';
  d.dataset.slot=i;
  // クリック＝選択。すでに選択中のブロック枠をもう一度クリック＝中身の入れ替え
  d.onclick=()=>{
   if(i<8&&hbSlot===i){openBlkPick(i);return}
   selectHb(i);
  };
  // タッチ: 長押しでも入れ替え（選択中でなくても可）
  let lpTimer=null,lpOpened=false;
  d.addEventListener('pointerdown',e=>{
   if(i>=8||e.pointerType==='mouse')return;
   lpOpened=false;
   lpTimer=setTimeout(()=>{lpTimer=null;lpOpened=true;openBlkPick(i)},420);
  });
  const clearLp=e=>{
   if(lpTimer){clearTimeout(lpTimer);lpTimer=null}
   if(lpOpened&&e&&e.type==='pointerup'){/* 長押し成功後の click は select に任せる */}
  };
  d.addEventListener('pointerup',clearLp);
  d.addEventListener('pointercancel',clearLp);
  d.addEventListener('pointerleave',()=>{if(lpTimer){clearTimeout(lpTimer);lpTimer=null}});
  bar.appendChild(d);slots.push(d);
 }
 // ブロック選択中は背面への操作を防ぎ、外側のクリック／タップで閉じる透明な幕を置く。
 let backdrop=$('blkPickBackdrop');
 if(!backdrop){
  backdrop=document.createElement('div');backdrop.id='blkPickBackdrop';backdrop.setAttribute('aria-hidden','true');
  // pointerdown は背面のゲーム操作に通さず、実際の click で閉じる。
  backdrop.addEventListener('pointerdown',e=>e.stopPropagation());
  backdrop.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(isBlkPickOpen())closeBlkPick()});
  document.body.appendChild(backdrop);
 }
 // ピック用パネル
 let panel=$('blkPick');
 if(!panel){
  panel=document.createElement('div');panel.id='blkPick';
  panel.innerHTML='<div class="bp-head"><span>ブロックを選ぶ（枠に入れる）</span><button type="button" id="bpClose">×</button></div><div id="bpGrid"></div><p class="bp-hint">選択中の枠をもう一度クリック、または E で開けます（タッチは長押し）</p>';
  document.body.appendChild(panel);
  panel.querySelector('#bpClose').onclick=()=>closeBlkPick();
  panel.addEventListener('pointerdown',e=>e.stopPropagation());
 }
 paintBarSlots();
 syncToolFromHb();
}
let bpTarget=0;
function openBlkPick(slot){
 bpTarget=slot|0;
 const panel=$('blkPick'),grid=$('bpGrid');if(!panel||!grid)return;
 // ポインターロック中はパネルを操作できないため解除（ポーズは開かない）
 if(locked){skipMenu=true;try{document.exitPointerLock()}catch(e){}}
 drawing=null;lastPix=null;placeHeld=false;placeAcc=0;placeLockAxis=null;placeOkCount=0;panning=false;breakHeld=false;breakAcc=0;breakTarget=null;hideBreakProg();
 grid.innerHTML='';
 for(let i=0;i<BN.length;i++){
  const b=document.createElement('button');
  b.type='button';b.className='bp-item';
  b.textContent=BN[i];
  b.style.background=i===13?SLIME_SWATCH:'#'+(BH[i]!=null?BH[i].toString(16).padStart(6,'0'):'888');
  b.onclick=e=>{
   e.preventDefault();e.stopPropagation();
   hotbar[bpTarget]=i;saveHotbar();
   selectHb(bpTarget);closeBlkPick();paintBarSlots();refresh();
   toast(BN[i]+' を枠'+(bpTarget+1)+'にセット');
  };
  grid.appendChild(b);
 }
 const backdrop=$('blkPickBackdrop');if(backdrop)backdrop.style.display='block';
 panel.style.display='flex';
}
function closeBlkPick(){
 const p=$('blkPick');if(p)p.style.display='none';
 const backdrop=$('blkPickBackdrop');if(backdrop)backdrop.style.display='none';
 // 閉じたらゲーム操作に戻す（照準モードなら再ロック）
 if(started&&!menu&&!typing)sync();
}
function selectHb(i){
 const prev=hbSlot;
 hbSlot=Math.max(0,Math.min(HOTBAR_N-1,i|0));
 syncToolFromHb();
 // 枠が変わったら描画・連続置きを打ち切り、ロック状態を描き方に合わせる
 if(prev!==hbSlot){
  drawing=null;lastPix=null;placeHeld=false;placeAcc=0;placeLockAxis=null;placeOkCount=0;panning=false;breakHeld=false;breakAcc=0;breakTarget=null;hideBreakProg();
  // ブロック選択中はパネル操作を邪魔しない（閉じたあとに closeBlkPick が sync）
  if(!isBlkPickOpen())sync();
 }
 paintBarSlots();refresh();hint();setInfo();
}
function paintBarSlots(){
 slots.forEach((d,i)=>{
  d.classList.toggle('on',i===hbSlot);
  if(i>=8){
   d.textContent='ペン';d.style.background=cur?toCss(cur):'#555';
  }else{
   const bi=hotbar[i];
   d.textContent=(i+1)+(BN[bi]||'?');
   d.style.background=bi===13?SLIME_SWATCH:'#'+(BH[bi]!=null?BH[bi].toString(16).padStart(6,'0'):'888');
  }
 });
}
rebuildBar();
const recent=(()=>{try{return JSON.parse(ls('rkb_recent','[]')).filter(Number.isInteger).slice(0,8)}catch(e){return[]}})();
const colorList=()=>[0,...PAL.map(toC),...recent];
function swatches(box){
 box.innerHTML='';
 colorList().forEach(c=>{const d=document.createElement('div');d.className='sw';d.dataset.c=c;d.title=c?'':'消しゴム';d.style.background=c?toCss(c):'repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/10px 10px';d.onclick=()=>{cur=c;if(box===pal)selectHb(8);refresh()};box.appendChild(d)});
}
function buildPal(){
 swatches(pal);swatches($('edpal'));
 [['＋','色を追加',()=>$('cp').click()],['⌖','スポイト(I)',()=>{picking=!picking;if(picking)toast('色を拾う場所をタップ')}],['↩','元に戻す(Ctrl+Z)',undo],['↪','やり直し(Ctrl+Y)',redo],['太'+sz,'ペンの太さ（スライダー）',toggleSzPanel]].forEach(([lab,ti,f])=>{const d=document.createElement('div');d.className='sw tl';d.textContent=lab;d.title=ti;if(String(lab).startsWith('太'))d.id='szBtn';d.onclick=f;pal.appendChild(d)});
 refresh();
}
function addRecent(c){if(!c||PAL.some(p=>toC(p)===c)||recent.includes(c))return;recent.unshift(c);recent.length=Math.min(recent.length,8);lsSet('rkb_recent',JSON.stringify(recent));buildPal()}
function setColor(c){cur=c;addRecent(c);refresh()}
function refresh(){
 if(typeof paintBarSlots==='function')paintBarSlots();
 document.querySelectorAll('.sw[data-c]').forEach(d=>d.classList.toggle('on',d.dataset.c!==undefined&&+d.dataset.c===cur));
 $('bAct').textContent=isPen()?'描く':'置く';$('bDel').textContent=isPen()?'消す':'壊す';
 if($('szBtn'))$('szBtn').textContent='太'+sz;setInfo();
}
$('cp').onchange=e=>setColor(toC(e.target.value));
const inp=$('in');
let lockFailAt=0;
const lock=()=>{
 try{
  const p=R.domElement.requestPointerLock&&R.domElement.requestPointerLock();
  if(p&&p.catch)p.catch(()=>{
   const now=performance.now();
   if(now-lockFailAt>2500){lockFailAt=now;toast('画面をクリックして視点操作を有効にしてください')}
  });
 }catch(e){
  const now=performance.now();
  if(now-lockFailAt>2500){lockFailAt=now;toast('画面をクリックして視点操作を有効にしてください')}
 }
};
function hint(){
 $('tc').classList.toggle('cur',cm());
 const needClick=started&&!locked&&!typing&&!menu&&!cm()&&!TOUCH;
 $('hint').style.display=needClick?'block':'none';
 if(needClick)$('hint').textContent='画面をクリックして操作開始（Escで設定）';
 $('cross').style.display=cm()?'none':'block';
 R.domElement.style.cursor=cm()?'crosshair':'default';
 document.body.classList.toggle('need-lock',!!needClick);
}
function openChat(){
 typing=true;Object.keys(keys).forEach(k=>keys[k]=false);
 const h=$('chatHist');if(h)h.style.display='flex';
 renderChatHist(true);
 inp.style.display='block';inp.value='';inp.focus();
 document.exitPointerLock();hint();
}
let ignoreEscMenuUntil=0;
function closeChat(){
 typing=false;inp.style.display='none';inp.blur();
 const h=$('chatHist');if(h)h.style.display='none';
 // Esc で閉じた直後にポーズが開かないようにする
 ignoreEscMenuUntil=performance.now()+200;
 sync();hint();
}
if($('chatHistClose'))$('chatHistClose').onclick=()=>closeChat();

inp.addEventListener('keydown',e=>{
 if(e.isComposing||e.keyCode===229)return;
 if(e.key==='Enter'){
  e.preventDefault();e.stopPropagation();
  const t=inp.value.trim().slice(0,60);
  if(t){addLog(myName,t);Net.send({t:'chat',id:Net.id,name:myName,text:t})}
  closeChat();
  return;
 }
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeChat();return}
});
R.domElement.addEventListener('click',()=>{if(started&&!locked&&!typing&&!menu&&!isBlkPickOpen()&&!cm()&&!TOUCH)lock()});
document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===R.domElement;if(!locked){drawing=null;lastPix=null;if(skipMenu)skipMenu=false;else if(started&&!typing&&!menu&&!cm()&&!phonePanelOpen)openMenu()}hint()});
addEventListener('mousemove',e=>{if(!locked)return;const dx=e.movementX,dy=e.movementY;if(Math.abs(dx)>250||Math.abs(dy)>250)return;me.yaw-=dx*.0025*sens;me.pitch=Math.max(-1.5,Math.min(1.5,me.pitch-dy*.0025*sens))});
addEventListener('pointermove',e=>{if(e.pointerType==='touch'){touchMove(e);return}mx=e.clientX;my=e.clientY;if(panning&&Math.abs(e.movementX)<250&&Math.abs(e.movementY)<250){me.yaw-=e.movementX*.0025*sens;me.pitch=Math.max(-1.5,Math.min(1.5,me.pitch-e.movementY*.0025*sens))}});
const onUI=e=>e.target.closest&&e.target.closest('#bar,#pal,#menu,#in,#pm,#phoneOpen,#phoneModal,#tc,#emo,#lobby,#szPanel,#disc,#chatHist,#chat,#blkPick');
addEventListener('pointerdown',e=>{
 if(e.pointerType==='touch'){touchDown(e);return}
 if(menu||typing||isBlkPickOpen())return; // メニュー・ブロック選択中はゲーム操作しない
 if(!act()||onUI(e))return;
 if(armPick(e))return;
 if(e.button===2&&hit&&isPhoneStationBlock(hit.x,hit.y,hit.z)){e.preventDefault();openPhoneGameAtStation();return}
 // 敵を照準で捉えた近距離クリックだけ攻撃に変え、それ以外の設置・描画操作は維持する。
 if(e.button===0&&tryPokeSporeShooter()){e.preventDefault();return}
 // カーソル描き: 右クリック／Alt+ドラッグで視点移動。消しは Shift+左 or 中ボタン
 if((e.button===2||e.altKey)&&cm()){panning=true;e.preventDefault();return}
 if(e.altKey&&!cm()){panning=true;return}
 const er=e.button===5||(e.buttons&32)>0;
 if(isPen()){
  if(e.button===2&&!cm()){drawing=0;lastPix=null}
  else if(e.button===0){drawing=e.shiftKey||er?0:cur;lastPix=null}
  else if(er){drawing=0;lastPix=null}
 }else{
  if(e.button===0){placeHeld=true;placeAcc=0;placeLockAxis=null;placeOkCount=0;place()}
  else if(e.button===2&&hit)tryStartBreak(hit.x,hit.y,hit.z);
 }

});
const upAll=e=>{if(e.pointerType==='touch'){touchUp(e);return}drawing=null;lastPix=null;panning=false;placeHeld=false;placeAcc=0;placeLockAxis=null;placeOkCount=0;breakHeld=false;breakAcc=0;breakTarget=null;hideBreakProg();setInfo()};
addEventListener('pointerup',upAll);addEventListener('pointercancel',upAll);
addEventListener('contextmenu',e=>{if(started&&!menu&&!isBlkPickOpen())e.preventDefault()});
addEventListener('wheel',e=>{if(!act()||isBlkPickOpen())return;selectHb((hbSlot+(e.deltaY>0?1:HOTBAR_N-1))%HOTBAR_N)});
addEventListener('blur',()=>Object.keys(keys).forEach(k=>keys[k]=false));
addEventListener('keydown',e=>{
 if(phonePanelOpen){if(e.key==='Escape'||e.code==='Escape'){e.preventDefault();e.stopPropagation();if(window.PhoneGame)window.PhoneGame.close()}return}
 if(started&&!typing&&(e.key==='Alt'||e.key.startsWith('Arrow')))e.preventDefault();
 if(e.code==='Escape'||e.key==='Escape'){
  if(isBlkPickOpen()){e.preventDefault();closeBlkPick();return}
  // チャット中は閉じるだけ（ポーズは開かない）
  if(typing){e.preventDefault();closeChat();return}
  if(performance.now()<ignoreEscMenuUntil){e.preventDefault();return}
  if(started&&document.activeElement!==inp){
   if(menu){if(performance.now()-menuAt>200)closeMenu()}
   else openMenu();
   return;
  }
 }
 if(typing||!started||menu||isBlkPickOpen())return;
 if(e.code==='KeyF'&&!e.ctrlKey&&!e.metaKey&&!e.repeat){if(phoneHauntCall&&Date.now()<phoneHauntCall.expiresAt){if(answerPhoneHaunt())e.preventDefault();return}if(openPhoneGameAtStation()){e.preventDefault();return}if(requestForestResidentTalk()){e.preventDefault();return}if(requestWiseCharacterTalk()){e.preventDefault();return}}
 if(e.code==='KeyT'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();if(window.PhoneGame)window.PhoneGame.open();return}
 if(e.code==='Enter'){e.preventDefault();openChat();return}
 if(e.code==='Space')e.preventDefault();
 if((e.ctrlKey||e.metaKey)&&(e.code==='KeyZ'||e.code==='KeyY')){e.preventDefault();e.code==='KeyY'||e.shiftKey?redo():undo();return}
 if(e.code==='KeyZ'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();cycleSz();return}
 // W ダブルタップでダッシュ
 if(e.code==='KeyW'&&!e.repeat){
  const now=performance.now();
  if(now-wReleaseAt<280)wantSprint=true;
 }
 keys[e.code]=true;
 const m=/^Digit([1-9])$/.exec(e.code);if(m){if(emoOpen&&+m[1]<=5)emote(+m[1]-1);else selectHb(+m[1]-1)}
 if(e.code==='KeyQ'){const L=colorList(),i=L.indexOf(cur);cur=L[(i+L.length-1)%L.length];refresh()}
 if(e.code==='KeyE'&&!e.ctrlKey){if(hbSlot<8)openBlkPick(hbSlot);else openBlkPick(0);return}
 if(e.code==='KeyI')pick();
 if(e.code==='KeyB')toggleEmo();
 if(e.code==='KeyV'){viewMode=(viewMode+1)%3;toast(['一人称','背後から','正面から'][viewMode])}
 if(e.code==='KeyP')shotReq=true;
 if(e.code==='KeyX')setPen(penMode==='aim'?'cursor':'aim');
});
addEventListener('keyup',e=>{
 if(e.key==='Alt')e.preventDefault();
 if(e.code==='KeyW'){wReleaseAt=performance.now();wantSprint=false}
 keys[e.code]=false;
});


/* 誤操作でタブを閉じないようにする（ブラウザによっては無効化不可） */
function shouldGuardBrowserKeys(){
 return started&&!typing&&!menu&&!phonePanelOpen&&document.activeElement!==inp;
}
addEventListener('keydown',e=>{
 if(!shouldGuardBrowserKeys())return;
 const k=e.code,ctrl=e.ctrlKey||e.metaKey;
 // Ctrl/Cmd + W/T/N/R など（タブ操作・更新）
 if(ctrl&&(k==='KeyW'||k==='KeyT'||k==='KeyN'||k==='KeyR'||k==='KeyQ')){
  e.preventDefault();e.stopPropagation();
  return;
 }
 if(ctrl&&e.shiftKey&&(k==='KeyT'||k==='KeyN'||k==='KeyW')){
  e.preventDefault();e.stopPropagation();return;
 }
 // F5 / Ctrl+F5 の誤更新もゲーム中は止める
 if(k==='F5'){e.preventDefault();return}
},true);
addEventListener('beforeunload',e=>{
 if(!started)return;
 // 再接続中や切断表示中もプレイ中扱い
 e.preventDefault();
 e.returnValue='';
});


buildPal();
/* ---- アバターエディタ(設定メニュー内) ---- */
let ed=null,edHist=[],edBodyMode='front'; // front | both | back
function edGetBodyMode(){
 const r=document.querySelector('input[name="edBodyMode"]:checked');
 return (r&&r.value)||edBodyMode||'front';
}
function openEd(){
 const k=mySkin;
 const body=normalizeBodyPixels(k&&k.body);
 const bodyB=normalizeBodyPixels(k&&k.bodyB?k.bodyB:body);
 ed={face:k?k.face.slice():new Uint16Array(256),body,bodyB,hair:k?k.hair:HAIR0,limb:k?k.limb:myCol,headPart:k?(k.headPart|0):0};
 edHist=[];
 edBodyMode=edGetBodyMode();
 $('limbC').value=hx(ed.limb);if($('headPart'))$('headPart').value=String(ed.headPart);
 $('mc').style.display='none';if($('guide'))$('guide').style.display='none';$('edc').style.display='flex';
 edRender();
}
// 編集プレビューはゲーム内と同じ makeAvatar() を使って3D描画する。
// 旧版は別の2Dイラストを手描きしていたため、体型・帽子・葉っぱの向きが実モデルと食い違っていた。
let edPreviewRenderer=null,edPreviewScene=null,edPreviewCamera=null,edPreviewRoot=null,edPreviewFloor=null;
let edPreviewYaw=0.10,edPreviewDrag=null,edPreviewFailed=false;
function ensureEdPreview(){
 const mount=$('cvP');if(!mount||edPreviewFailed)return false;
 if(!edPreviewRenderer){
  try{
   edPreviewRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
   edPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
   if('outputEncoding' in edPreviewRenderer)edPreviewRenderer.outputEncoding=THREE.sRGBEncoding;
   mount.replaceChildren(edPreviewRenderer.domElement);
   edPreviewScene=new THREE.Scene();edPreviewScene.background=new THREE.Color(0xf4f0e7);
   edPreviewCamera=new THREE.PerspectiveCamera(31,136/184,.1,30);
   edPreviewCamera.position.set(.72,1.72,-4.65);edPreviewCamera.lookAt(0,1.0,0);
   // 足の接地位置が確認しやすい薄い床と柔らかい影。
   edPreviewFloor=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.MeshBasicMaterial({color:0xe7e1d5,side:THREE.DoubleSide}));
   edPreviewFloor.rotation.x=-Math.PI/2;edPreviewFloor.position.y=-.012;edPreviewScene.add(edPreviewFloor);
   const shadow=new THREE.Mesh(new THREE.CircleGeometry(.34,32),new THREE.MeshBasicMaterial({color:0x8d887e,transparent:true,opacity:.17,depthWrite:false}));
   shadow.rotation.x=-Math.PI/2;shadow.position.set(0,.001,0);shadow.scale.set(1.0,.62,1);shadow.renderOrder=1;edPreviewScene.add(shadow);
   mount.addEventListener('pointerdown',e=>{if(!edPreviewRoot)return;edPreviewDrag={x:e.clientX,y:e.clientY,yaw:edPreviewYaw};mount.setPointerCapture(e.pointerId);e.preventDefault()});
   mount.addEventListener('pointermove',e=>{if(!edPreviewDrag||!edPreviewRoot)return;edPreviewYaw=edPreviewDrag.yaw+(e.clientX-edPreviewDrag.x)*.012;edPreviewRoot.rotation.y=edPreviewYaw;renderEdPreviewFrame()});
   const endDrag=()=>{edPreviewDrag=null};mount.addEventListener('pointerup',endDrag);mount.addEventListener('pointercancel',endDrag);
   addEventListener('resize',resizeEdPreview);
  }catch(err){
   edPreviewFailed=true;mount.textContent='3Dプレビューを初期化できませんでした';
   console.warn('Avatar preview could not initialize',err);return false;
  }
 }
 resizeEdPreview();return true;
}
function resizeEdPreview(){
 if(!edPreviewRenderer||!edPreviewCamera)return;
 const mount=$('cvP');if(!mount)return;const r=mount.getBoundingClientRect();
 const w=Math.max(1,Math.floor(r.width)),h=Math.max(1,Math.floor(r.height));
 edPreviewRenderer.setSize(w,h,false);edPreviewCamera.aspect=w/h;edPreviewCamera.updateProjectionMatrix();renderEdPreviewFrame();
}
function disposeEdPreviewModel(root){
 if(!root)return;
 root.traverse(o=>{
  if(o.geometry)o.geometry.dispose();
  if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{if(m.map)m.map.dispose();if(m.dispose)m.dispose()})}
 });
}
function renderEdPreviewFrame(){
 if(!edPreviewRenderer||!edPreviewScene||!edPreviewCamera)return;
 edPreviewRenderer.render(edPreviewScene,edPreviewCamera);
}
function renderAvatarPreview(){
 if(!ed||!ensureEdPreview())return;
 if(edPreviewRoot){edPreviewScene.remove(edPreviewRoot);disposeEdPreviewModel(edPreviewRoot);edPreviewRoot=null}
 const skin={face:ed.face,body:ed.body,bodyB:ed.bodyB,hair:ed.hair,limb:ed.limb,headPart:ed.headPart|0};
 const avatar=makeAvatar(skin,ed.limb);
 edPreviewRoot=avatar.root;edPreviewRoot.rotation.y=edPreviewYaw;edPreviewScene.add(edPreviewRoot);
 renderEdPreviewFrame();
}
function edRender(){
 if(!ed)return;
 const mode=edGetBodyMode();
 const show=mode==='back'?ed.bodyB:ed.body;
 const dr=(id,a,w,h)=>{const c=$(id).getContext('2d');c.clearRect(0,0,w,h);for(let i=0;i<a.length;i++)if(a[i]){c.fillStyle=toCss(a[i]);c.fillRect(i%w,(i/w)|0,1,1)}};
 dr('cvF',ed.face,16,16);dr('cvB',show,16,16);
 renderAvatarPreview();
}
// 服キャンバス：モードに応じて前面 / 背面 / 両方へ描画
(function setupEdBody(){
 const cv=$('cvB');if(!cv)return;
 let last=null;const w=16,h=16;
 const at=e=>{const r=cv.getBoundingClientRect();return[Math.max(0,Math.min(w-1,(e.clientX-r.left)/r.width*w|0)),Math.max(0,Math.min(h-1,(e.clientY-r.top)/r.height*h|0))]};
 const put=(x,y)=>{
  if(!ed)return;
  const mode=edGetBodyMode();
  const i=y*w+x;
  if(mode==='front'||mode==='both')ed.body[i]=cur;
  if(mode==='back'||mode==='both')ed.bodyB[i]=cur;
 };
 cv.addEventListener('pointerdown',e=>{
  if(!ed)return;
  cv.setPointerCapture(e.pointerId);
  edHist.push({f:ed.face.slice(),b:ed.body.slice(),bb:ed.bodyB.slice()});
  if(edHist.length>30)edHist.shift();
  last=at(e);put(...last);edRender();
 });
 cv.addEventListener('pointermove',e=>{if(!last||!ed)return;const q=at(e);line(last[0],last[1],q[0],q[1],put);last=q;edRender()});
 const up=()=>{last=null};cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
})();
(function setupEdFace(){
 const cv=$('cvF');if(!cv)return;
 let last=null;const w=16,h=16;
 const at=e=>{const r=cv.getBoundingClientRect();return[Math.max(0,Math.min(w-1,(e.clientX-r.left)/r.width*w|0)),Math.max(0,Math.min(h-1,(e.clientY-r.top)/r.height*h|0))]};
 const put=(x,y)=>{if(ed)ed.face[y*w+x]=cur};
 cv.addEventListener('pointerdown',e=>{
  if(!ed)return;
  cv.setPointerCapture(e.pointerId);
  edHist.push({f:ed.face.slice(),b:ed.body.slice(),bb:ed.bodyB.slice()});
  if(edHist.length>30)edHist.shift();
  last=at(e);put(...last);edRender();
 });
 cv.addEventListener('pointermove',e=>{if(!last||!ed)return;const q=at(e);line(last[0],last[1],q[0],q[1],put);last=q;edRender()});
 const up=()=>{last=null};cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
})();
document.querySelectorAll('input[name="edBodyMode"]').forEach(r=>{
 r.addEventListener('change',()=>{edBodyMode=edGetBodyMode();edRender()});
});
$('edUndo').onclick=()=>{const h=edHist.pop();if(h){ed.face=h.f;ed.body=h.b;if(h.bb)ed.bodyB=h.bb;edRender()}};
$('edPlus').onclick=()=>$('cp').click();
if($('headPart'))$('headPart').onchange=e=>{ed.headPart=Math.max(0,Math.min(6,Number(e.target.value)||0));edRender()};
$('limbC').oninput=e=>{ed.limb=parseInt(e.target.value.slice(1),16);edRender()};
$('edOk').onclick=()=>{
 mySkin={face:ed.face,body:ed.body,bodyB:ed.bodyB,hair:ed.hair,limb:ed.limb,headPart:ed.headPart|0};
 lsSet('rkb_skin',JSON.stringify({face:[...mySkin.face],body:[...mySkin.body],bodyB:[...mySkin.bodyB],hair:mySkin.hair,limb:mySkin.limb,headPart:mySkin.headPart|0}));
 rebuildSelf();updateFirstPersonPenColor();Net.send({t:'skin',id:Net.id,sk:packSkin(mySkin)});toast('アバターを保存・同期しました');paintMenu();
};
let admAuthOpen=false,mTitleClicks=0,mTitleT=0;
function showAdmAuth(v){
 admAuthOpen=!!v;
 if($('admAuth'))$('admAuth').style.display=admAuthOpen&&!isAdmin()?'flex':'none';
}
function paintPlayers(){
 const el=$('plist');if(!el)return;
 const lines=[];
 lines.push('<div class="me"><span class="dot" style="background:'+colCss(myCol)+'"></span>'+escHtml(myName||'あなた')+'（自分）</div>');
 for(const o of others.values()){
  lines.push('<div><span class="dot" style="background:'+colCss(o.col)+'"></span>'+escHtml(o.name)+'</div>');
 }
 el.innerHTML=lines.join('')||'<div>（なし）</div>';
}
function paintAdmin(){
 const a=isAdmin();$('adm').style.display=a?'flex':'none';
 if($('admAuth'))$('admAuth').style.display=(!a&&admAuthOpen)?'flex':'none';
 $('aBlk').textContent='ブロック: '+(perm.blk?'許可':'禁止');$('aPen').textContent='落書き: '+(perm.pen?'許可':'禁止');
 if($('mTopicOn'))$('mTopicOn').textContent='お題 '+(topicEnabled?'ON':'OFF');
 if($('mDisaster')){$('mDisaster').textContent='🌦 自然災害: '+(disastersEnabled?'オン':'オフ');$('mDisaster').classList.toggle('off',!disastersEnabled)}
 if($('mKesaran')){$('mKesaran').textContent='ケサランパサラン: '+(kesaranEventsEnabled?'オン':'オフ');$('mKesaran').classList.toggle('off',!kesaranEventsEnabled)}
 $('mBon').classList.toggle('off',!Snd.bgm);$('mBoff').classList.toggle('off',Snd.bgm);$('vol').value=Snd.vol;
 paintPlayers();
 const kl=$('kl');if(!kl)return;kl.innerHTML='';
 if(!others.size){kl.innerHTML='<p class="adm-hint">他の参加者はいません</p>';return}
 for(const[id,o]of others){
  const row=document.createElement('div');row.className='row adm-kick-row';
  const name=document.createElement('span');name.className='adm-name';name.textContent=o.name;
  const b=document.createElement('button');b.type='button';b.className='sub';b.textContent='キック';b.title='15分再入場禁止';
  b.onclick=()=>{if(confirm(o.name+' をキックしますか？（15分再入場禁止）'))Net.kick(id)};
  const b2=document.createElement('button');b2.type='button';b2.className='sub';b2.textContent='BAN 1時間';
  b2.onclick=()=>{if(confirm(o.name+' を1時間BANしますか？'))Net.send({t:'ban',id,mins:60})};
  row.appendChild(name);row.appendChild(b);row.appendChild(b2);kl.appendChild(row);
 }
}
$('vol').oninput=e=>Snd.setVol(+e.target.value);
$('mBon').onclick=()=>{Snd.setBgm(true);paintAdmin()};$('mBoff').onclick=()=>{Snd.setBgm(false);paintAdmin()};
$('aPaint').onclick=()=>adminClear('paint');
if($('aWorldNature'))$('aWorldNature').onclick=()=>adminClear('world','nature');
if($('aWorldPaper'))$('aWorldPaper').onclick=()=>adminClear('world','paper');
if($('aWorldToy'))$('aWorldToy').onclick=()=>adminClear('world','toy');

$('aBlk').onclick=()=>setPerm('blk',!perm.blk);$('aPen').onclick=()=>setPerm('pen',!perm.pen);
$('mSave').onclick=async()=>dl(new Blob([await packWorld()]),'rakugaki_'+ts()+'.rakugaki');
$('mLoad').onclick=()=>{if(!isAdmin()){toast('管理者のみ世界を読み込めます');return}$('wf').click()};
$('wf').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{
  if(f.size>8*1024*1024)throw new Error('保存ファイルが大きすぎます（上限8 MiB）');
  const snap=await unpackWorld(new Uint8Array(await f.arrayBuffer()));
  validateWorldImport(snap);
  // 読み込み要求を送るだけにし、サーバーが受理した同期通知を受け取ってから画面へ反映する。
  const payload={t:'world',rle:snap.rle,keys:snap.keys,data:b64(snap.data),phoneStation:snap.phoneStation};
  const payloadBytes=new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if(payloadBytes>MAX_WORLD_MESSAGE_BYTES)throw new Error('ワールドデータが通信上限（4 MiB）を超えています');
  if(!Net.send(payload))throw new Error('サーバーに接続していません');
  worldLoadPending=true;
  toast('サーバーにワールドを送信しました…');
}catch(err){worldLoadPending=false;alert('読み込めませんでした：'+(err&&err.message?err.message:'形式かバージョンが違います'))}};
function doAuth(e){
 if(e){e.preventDefault();e.stopPropagation()}
 const pw=($('pw')&&$('pw').value||'').trim();
 if(!pw){toast('合言葉を入力してください');return}
 if(!Net.ws||Net.ws.readyState!==1){toast('サーバーに接続していません');return}
 Net.auth(pw);toast('認証中…');
}
if($('mTopic'))$('mTopic').onclick=()=>adminNextTopic();
if($('mTopicOn'))$('mTopicOn').onclick=()=>adminToggleTopic();
if($('mAuth')){
 $('mAuth').addEventListener('click',doAuth);
 $('mAuth').addEventListener('pointerup',e=>{if(e.button===0)doAuth(e)});
}
if($('pw'))$('pw').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();doAuth(e)}});
// 設定タイトルを連続クリックで管理者入力を表示（通常は隠す）
if($('mTitle'))$('mTitle').addEventListener('click',()=>{
 const now=performance.now();
 if(now-mTitleT>2000)mTitleClicks=0;
 mTitleT=now;mTitleClicks++;
 if(mTitleClicks>=5){mTitleClicks=0;showAdmAuth(true);toast('管理者入力を表示');if($('pw'))$('pw').focus()}
});
// メニュー中 Ctrl+Shift+A でも表示
addEventListener('keydown',e=>{
 if(!menu)return;
 if(e.ctrlKey&&e.shiftKey&&(e.code==='KeyA'||e.key==='A'||e.key==='a')){
  e.preventDefault();showAdmAuth(true);if($('pw'))$('pw').focus();
 }
});
$('mShot').onclick=()=>{shotReq=true};$('bShot').onclick=()=>{shotReq=true};
$('mAv').onclick=openEd;
if($('myColPick')){
 $('myColPick').value='#'+((myCol>>>0)&0xffffff).toString(16).padStart(6,'0');
 $('myColPick').oninput=e=>{const v=parseInt(e.target.value.slice(1),16);if(!isNaN(v))setMyCol(v,false)};
 $('myColPick').onchange=e=>{const v=parseInt(e.target.value.slice(1),16);if(!isNaN(v))setMyCol(v,true)};
}

$('bEmo').onclick=()=>toggleEmo();$('bView').onclick=()=>{viewMode=(viewMode+1)%3;toast(['一人称','背後から','正面から'][viewMode])};
/* ---- 設定メニュー(Esc) ---- */
let szPrevT=0,szPanelOpen=false;
function showSzPreview(){
 const e=$('szPrev');if(!e)return;
 const px=Math.max(8,Math.min(72,sz*8));
 e.style.width=px+'px';e.style.height=px+'px';e.style.display='block';
 clearTimeout(szPrevT);szPrevT=setTimeout(()=>{e.style.display='none'},900);
}
function syncSzUI(){
 if($('szRange'))$('szRange').value=sz;
 if($('szVal'))$('szVal').textContent=sz;
 if($('szBtn'))$('szBtn').textContent='太'+sz;
}
function setSz(n,quiet){
 sz=Math.max(1,Math.min(8,n|0));
 if(!quiet)toast('太さ: '+sz);
 showSzPreview();syncSzUI();refresh();setInfo();
}
function cycleSz(){setSz(sz>=8?1:sz+1)}
function toggleSzPanel(){
 const p=$('szPanel');if(!p)return;
 szPanelOpen=!szPanelOpen;
 p.classList.toggle('is-open',szPanelOpen);
 // inline display は使わない（CSS の right/bottom を確実に効かせる）
 p.style.display='';
 p.style.left='';p.style.right='';p.style.top='';p.style.bottom='';p.style.transform='';
 if(szPanelOpen){syncSzUI();showSzPreview()}
}
function closeSzPanel(){
 szPanelOpen=false;
 const p=$('szPanel');if(!p)return;
 p.classList.remove('is-open');
 p.style.display='';
}
function setTool(i){
 // i がペン番号ならペン枠、0..BN-1 ならそのブロックが入っている枠を探す／なければ選択枠に入れる
 const pt=penTool();
 if(i>=pt){selectHb(8);return}
 const found=hotbar.indexOf(i);
 if(found>=0)selectHb(found);
 else{hotbar[Math.min(hbSlot,7)]=i;saveHotbar();selectHb(Math.min(hbSlot,7))}
}

function sync(){
 if(!started||menu||typing||phonePanelOpen)return;
 if(cm()){if(locked){skipMenu=true;document.exitPointerLock()}}else if(!locked&&!TOUCH)lock();
}
function paintMenu(){
 $('mAim').classList.toggle('off',penMode!=='aim');$('mCur').classList.toggle('off',penMode!=='cursor');
 const horrorButton=$('mHorror');if(horrorButton){horrorButton.textContent='👁 世界の異変: '+(horrorEnabled?'オン':'オフ');horrorButton.classList.toggle('off',!horrorEnabled)}
 $('mHelp').textContent=penMode==='aim'?(TOUCH?'画面中央の照準で狙い、指のドラッグで視点を回します。「描く」を押している間だけ描きます。「消す」を押している間は消します。「視点」ボタンを押しながらドラッグで視点移動。':'画面中央の照準で狙って描きます。視点はマウスの動きで回します。右クリックで消します。'):(TOUCH?'指でなぞった場所に描きます。「消す」を押しながらなぞると消せます。視点は2本指ドラッグ、または「視点」ボタンを押しながら1本指で回します。':'ペン位置に描きます。右クリック（またはAlt+ドラッグ）で視点移動。Shift+左クリックで消します。矢印キーでも視点移動。');
 $('mc').style.display='';$('edc').style.display='none';
 if($('guide'))$('guide').style.display='none';
 paintAdmin();$('mPOn').classList.toggle('off',!usePress);$('mPOff').classList.toggle('off',usePress);$('sv').textContent=sens.toFixed(1);$('sens').value=sens;$('pm').textContent='描き方: '+(penMode==='aim'?'照準':'カーソル')+(TOUCH?'':'（X）');

}
function openGuide(){
 if($('mc'))$('mc').style.display='none';
 if($('edc'))$('edc').style.display='none';
 if($('guide'))$('guide').style.display='flex';
}
function openMenu(){if(menu)return;menu=true;menuAt=performance.now();drawing=null;panning=false;lastPix=null;Object.keys(keys).forEach(k=>keys[k]=false);closeSzPanel();paintMenu();$('menu').style.display='flex';if(locked)document.exitPointerLock();hint()}
function closeMenu(){menu=false;$('menu').style.display='none';sync();hint()}
// 設定パネルの外側をクリック／タップしたときだけ閉じる。カード内の操作は閉じない。
if($('menu'))$('menu').addEventListener('click',e=>{if(e.target===$('menu'))closeMenu()});
$('mAim').onclick=()=>setPen('aim',true);
$('mCur').onclick=()=>setPen('cursor',true);
const HORROR_PHONE_RANGE=14;
function phoneStationDistance(){
 if(!phoneStation)return Infinity;
 return Math.hypot(me.p.x-(phoneStation.x+.5),me.p.z-(phoneStation.z+.5));
}
function phoneCallInRange(call=phoneHauntCall){return !!(call&&call.localTest&&isAdmin())||phoneStationDistance()<=HORROR_PHONE_RANGE;}
function stopPhoneHauntRing(clearCall=false){
 Snd.stopPhoneRing();phoneHauntRinging=false;
 if(clearCall)phoneHauntCall=null;
}
function updatePhoneHauntPrompt(){
 const prompt=$('horrorCallPrompt'),answer=$('horrorCallAnswer'),mute=$('horrorCallMute');
 const call=phoneHauntCall;
 const active=!!(call&&(horrorEnabled||(call.localTest&&isAdmin()))&&started&&Date.now()<call.expiresAt&&phoneCallInRange(call));
 if(prompt)prompt.hidden=!active;
 if(answer){answer.disabled=!!(active&&call.answerPending);answer.textContent=active&&call.answerPending?'応答中…':'受話'}
 if(mute){mute.disabled=!active;mute.textContent=active&&call.muted?'音を戻す':'消音';mute.setAttribute('aria-pressed',active&&call.muted?'true':'false')}
}
function clearPhoneHaunt(){
 stopPhoneHauntRing(true);Snd.stopPhoneVoice();
 if(phoneHauntVoiceTimer){clearTimeout(phoneHauntVoiceTimer);phoneHauntVoiceTimer=0}
 if(phoneHauntPendingTimer){clearTimeout(phoneHauntPendingTimer);phoneHauntPendingTimer=0}
 updatePhoneHauntPrompt();
}
function updatePhoneHauntProximity(){
 const call=phoneHauntCall;
 if(!call){updatePhoneHauntPrompt();return}
 if(Date.now()>=call.expiresAt){clearPhoneHaunt();return}
 const localTest=!!(call.localTest&&isAdmin()),inRange=phoneCallInRange(call);
 updatePhoneHauntPrompt();
 if(call.answerPending||call.muted||(!horrorEnabled&&!localTest)||!started||!inRange){if(phoneHauntRinging)stopPhoneHauntRing(false);return}
 // 本番の着信は端末の近くでだけ聞こえ、遠いほど静かになる。範囲外では無音。
 const d=phoneStationDistance(),level=localTest?1:Math.max(.08,Math.min(1,1-Math.max(0,d-2)/(HORROR_PHONE_RANGE+2)));
 if(!phoneHauntRinging)phoneHauntRinging=true;
 Snd.startPhoneRing(level);
}
function receivePhoneHauntRing(message){
 if(!horrorEnabled||!started)return;
 clearPhoneHaunt();
 const serverAt=Number(message&&message.at)||Date.now();
 const serverUntil=Number(message&&message.expiresAt)||serverAt+32000;
 const duration=Math.max(0,Math.min(32000,serverUntil-serverAt));
 const expiresAt=Date.now()+duration;
 if(duration<=0)return;
 phoneHauntCall={id:String(message.callId||''),expiresAt,answerPending:false};
 updatePhoneHauntProximity();
}
function answerPhoneHaunt(){
 const call=phoneHauntCall;if(!call||Date.now()>=call.expiresAt||call.answerPending||!phoneCallInRange(call))return false;
 call.answerPending=true;stopPhoneHauntRing(false);
 if(call.localTest){showPhoneHauntVoice({callId:call.id,voiceId:Math.floor(Math.random()*HORROR_PHONE_LINES.length)});return true}
 if(!Net.send({t:'horror-phone-answer',callId:call.id})){call.answerPending=false;updatePhoneHauntProximity();return false}
 if(phoneHauntPendingTimer)clearTimeout(phoneHauntPendingTimer);
 phoneHauntPendingTimer=setTimeout(()=>{phoneHauntPendingTimer=0;if(phoneHauntCall&&phoneHauntCall.id===call.id&&phoneHauntCall.answerPending){phoneHauntCall.answerPending=false;updatePhoneHauntProximity()}},3500);
 return true;
}
function showPhoneHauntVoice(message){
 const call=phoneHauntCall;
 if(!call||String(message.callId||'')!==call.id)return;
 if(phoneHauntPendingTimer){clearTimeout(phoneHauntPendingTimer);phoneHauntPendingTimer=0}
 stopPhoneHauntRing(true);updatePhoneHauntPrompt();
 if((!horrorEnabled&&!(call.localTest&&isAdmin()))||!started)return;
 const voiceId=Math.max(0,Math.min(HORROR_PHONE_LINES.length-1,Number(message.voiceId)||0));
 const line=HORROR_PHONE_LINES[voiceId];
 // 電話の台詞は音声だけで伝える。画面上に字幕や文章は表示しない。
 if(phoneHauntVoiceTimer)clearTimeout(phoneHauntVoiceTimer);
 Snd.playPhoneVoice(line);
 phoneHauntVoiceTimer=setTimeout(()=>{phoneHauntVoiceTimer=0;Snd.stopPhoneVoice()},6500);
}
function endPhoneHaunt(message){if(!phoneHauntCall)return;if(message&&message.callId&&String(message.callId)!==phoneHauntCall.id)return;clearPhoneHaunt()}

const horrorCallAnswerButton=$('horrorCallAnswer');
if(horrorCallAnswerButton)horrorCallAnswerButton.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();Snd.init();answerPhoneHaunt()});
const horrorCallMuteButton=$('horrorCallMute');
if(horrorCallMuteButton)horrorCallMuteButton.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(!phoneHauntCall)return;phoneHauntCall.muted=!phoneHauntCall.muted;updatePhoneHauntProximity()});
const horrorCallPromptEl=$('horrorCallPrompt');
if(horrorCallPromptEl){['pointerdown','pointerup','pointercancel','touchstart','touchend'].forEach(type=>horrorCallPromptEl.addEventListener(type,e=>{if(type==='pointerdown'||type==='touchstart')Snd.init();e.stopPropagation()}));}
function applyHorrorEnabled(enabled, fromServer=false){
 horrorEnabled=!!enabled;lsSet('rkb_horror',horrorEnabled?'1':'0');paintMenu();
 if(!horrorEnabled){clearHorrorFx();clearPhoneHaunt();Snd.stopPhoneVoice()}
 if(!fromServer)toast(horrorEnabled?'世界の異変を有効にしました':'世界の異変をオフにしました');
}
function setHorrorEnabled(enabled){
 if(!isAdmin()){toast('世界の異変を変更できるのは管理者だけです');return}
 if(!Net.send({t:'horror-admin-toggle',enabled:!!enabled})){toast('サーバーに接続していません');return}
}
if($('mHorror'))$('mHorror').onclick=()=>setHorrorEnabled(!horrorEnabled);
function stopFootstepsEvent(){
 footstepsEventToken++;
 if(footstepsEventWatch){clearInterval(footstepsEventWatch);footstepsEventWatch=0}
 for(const timer of footstepsEventTimeouts)clearTimeout(timer);
 footstepsEventTimeouts=[];
}
function startFootstepsEvent(force=false){
 stopFootstepsEvent();
 const token=footstepsEventToken,startYaw=me.yaw,side=Math.random()<.5?-1:1,startedAt=performance.now();
 // 六步從視界一側慢慢移向中央，逐漸變近；不是畫面動畫，而是可感知方向變化的音效。
 const steps=[
  {at:260,pan:side*.9,gain:.075},
  {at:690,pan:side*.82,gain:.095},
  {at:1080,pan:side*.64,gain:.12},
  {at:1420,pan:side*.42,gain:.145},
  {at:1690,pan:side*.22,gain:.17},
  {at:1900,pan:side*.05,gain:.20}
 ];
 for(const step of steps){
  const timer=setTimeout(()=>{
   if(token!==footstepsEventToken||(!horrorEnabled&&!force)||!started||menu||typing||phonePanelOpen)return;
   Snd.playFootstep(step.pan,step.gain);
  },step.at);
  footstepsEventTimeouts.push(timer);
 }
 // 振り向く／大きく視点を変えると足音がそこで途切れる。
 footstepsEventWatch=setInterval(()=>{
  if(token!==footstepsEventToken)return;
  if((!horrorEnabled&&!force)||!started||menu||typing||phonePanelOpen){stopFootstepsEvent();return}
  const delta=Math.atan2(Math.sin(me.yaw-startYaw),Math.cos(me.yaw-startYaw));
  if(Math.abs(delta)>1.02){stopFootstepsEvent();return}
  if(performance.now()-startedAt>2250){stopFootstepsEvent()}
 },60);
}
function clearHorrorFx(){
 if(horrorFxTimer){clearTimeout(horrorFxTimer);horrorFxTimer=0}
 stopFootstepsEvent();
 const fx=$('horrorFx');if(fx){fx.className='horror-fx';fx.setAttribute('aria-hidden','true')}
}
const HORROR_WHISPER_LINES=[
 '……そこにいるの？','ねえ……聞こえてる？','……見ないで。','どこにいるの……？',
 'さっき、呼んだ？','……まだ、いる。','こっちを見ないで。','……気づいてるよ。'
];
let lastHorrorWhisperLine='';
function nextHorrorWhisperLine(){
 let candidates=HORROR_WHISPER_LINES.filter(line=>line!==lastHorrorWhisperLine);
 if(!candidates.length)candidates=HORROR_WHISPER_LINES;
 const line=candidates[Math.floor(Math.random()*candidates.length)];lastHorrorWhisperLine=line;return line;
}
function showHorrorEvent(message,force=false){
 if((!horrorEnabled&&!force)||!started||menu||typing||phonePanelOpen)return;
 const kind=['footsteps','whisper'].includes(message&&message.kind)?message.kind:'footsteps';
 clearHorrorFx();
 if(kind==='footsteps'){
  startFootstepsEvent(force);
  return;
 }
 const fx=$('horrorFx');if(!fx)return;
 const whisperSide=Math.random()<.5?' whisper-left':' whisper-right';
 fx.className='horror-fx on whisper'+whisperSide;fx.setAttribute('aria-hidden','false');
 Snd.playWhisperVoice(nextHorrorWhisperLine());
 horrorFxTimer=setTimeout(()=>{horrorFxTimer=0;clearHorrorFx()},1900);
}
// デバッグ用の試運転。サーバーにイベントを送らず、この端末だけで演出を確認できる。
function previewHorrorEvent(kind){
 if(!isAdmin()){toast('怪異演出のテストは管理者専用です');return}
 if(kind==='phone-ring'){
  closeMenu();clearPhoneHaunt();
  phoneHauntCall={id:'local-test-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),expiresAt:Date.now()+32000,answerPending:false,localTest:true};
  updatePhoneHauntProximity();toast('管理者用のローカルテスト着信です。受話または F キーで応答できます');return;
 }
 closeMenu();setTimeout(()=>showHorrorEvent({kind},true),80);
}
if($('mHorrorTestFootsteps'))$('mHorrorTestFootsteps').onclick=()=>previewHorrorEvent('footsteps');
if($('mHorrorTestWhisper'))$('mHorrorTestWhisper').onclick=()=>previewHorrorEvent('whisper');
if($('mHorrorTestPhone'))$('mHorrorTestPhone').onclick=()=>previewHorrorEvent('phone-ring');
if($('mHorrorTestCreatureVoice'))$('mHorrorTestCreatureVoice').onclick=()=>{if(!isAdmin()){toast('怪異演出のテストは管理者専用です');return}Snd.init();const p=new THREE.Vector3(-3.2,.2,2.5).applyQuaternion(cam.quaternion).add(cam.position);Snd.playMischiefVocalization({x:p.x,y:p.y,z:p.z,distance:p.distanceTo(cam.position),pan:-3.2/Math.hypot(3.2,2.5)},false,true)};
if($('mDisaster'))$('mDisaster').onclick=()=>setDisastersEnabled(!disastersEnabled);
if($('mDisasterTestStorm'))$('mDisasterTestStorm').onclick=()=>previewDisaster('storm');
if($('mDisasterTestShower'))$('mDisasterTestShower').onclick=()=>previewDisaster('meteor-shower');
if($('mDisasterTestImpact'))$('mDisasterTestImpact').onclick=()=>previewDisaster('meteor-impact');
if($('mDisasterTestBlizzard'))$('mDisasterTestBlizzard').onclick=()=>previewDisaster('blizzard');
if($('mKesaran'))$('mKesaran').onclick=()=>setKesaranEventsEnabled(!kesaranEventsEnabled);
if($('mKesaranTest'))$('mKesaranTest').onclick=()=>previewKesaranEvent();
$('sens').oninput=e=>{sens=+e.target.value;lsSet('rkb_sens',sens);paintMenu()};

$('mLeave')&&($('mLeave').onclick=()=>leaveToLobby());
$('mBack').onclick=closeMenu;
if($('mGuide'))$('mGuide').onclick=()=>openGuide();
if($('gBack'))$('gBack').onclick=()=>paintMenu();
if($('szRange')){
 $('szRange').addEventListener('pointerdown',e=>e.stopPropagation());
 $('szRange').addEventListener('click',e=>e.stopPropagation());
 $('szRange').oninput=e=>{e.stopPropagation();setSz(+e.target.value,true)};
 $('szRange').onchange=e=>{e.stopPropagation();setSz(+e.target.value)};
}
if($('szPanel'))$('szPanel').addEventListener('pointerdown',e=>e.stopPropagation());
addEventListener('pointerdown',e=>{
 if(!szPanelOpen)return;
 const t=e.target;
 if(t&&t.closest&&(t.closest('#szPanel')||t.closest('#szBtn')||t.closest('#pal')))return;
 closeSzPanel();
}); /* closeSzPanel outside */

$('mPOn').onclick=()=>{usePress=true;lsSet('rkb_press','1');paintMenu()};$('mPOff').onclick=()=>{usePress=false;lsSet('rkb_press','0');paintMenu()};
let toastT=0;
function toast(t){const e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>e.style.display='none',1300)}
function setPen(m,quiet){penMode=m;lsSet('rkb_pen',m);paintMenu();sync();hint();setInfo();if(!quiet)toast('描き方: '+(m==='aim'?'照準':'カーソル'))}
$('pm').onclick=()=>setPen(penMode==='aim'?'cursor':'aim');

/* ---- タッチ操作 ---- */
let lookHeld=false,drawHeld=false,delHeld=false;
function touchDown(e){if(isBlkPickOpen()||!act()||onUI(e)||armPick(e))return;tp.set(e.pointerId,{x:e.clientX,y:e.clientY});mx=e.clientX;my=e.clientY;
 // 描く／消すボタン押し中は画面タッチで視点を回すだけ（描画は維持）
 if(drawHeld||delHeld){lastPix=null;return}
 if(lookHeld||tp.size>1){drawing=null;lastPix=null;return}
 // カーソルモード: 触った位置に描く
 if(cm()&&isPen()&&canPen()&&tp.size===1){drawing=cur;lastPix=null}
 else if(!drawHeld&&!delHeld){drawing=null;lastPix=null}
}
function touchUp(e){if(!tp.delete(e.pointerId))return;if(!drawHeld&&!delHeld){drawing=null;lastPix=null}}
function touchMove(e){
 const p=tp.get(e.pointerId);if(!p)return;
 const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
 // カーソル: 1本指は描画位置だけ追う（消す押し中も位置を追う）
 if(cm()&&tp.size===1&&!lookHeld&&!drawHeld&&!delHeld){mx=p.x;my=p.y;return}
 if(cm()&&delHeld&&tp.size===1){mx=p.x;my=p.y;return}
 // 視点回転（照準 / 視点ボタン / 2本指 / 描く・消す押しながら）
 if(lookHeld||tp.size>1||!cm()||drawHeld||delHeld){
  if(!act()&&!lookHeld&&!drawHeld&&!delHeld)return;
  const k=.005*sens/Math.max(1,tp.size);me.yaw-=dx*k;me.pitch=Math.max(-1.5,Math.min(1.5,me.pitch-dy*k));
  // 描く／消す押し中は描画を切らない（視点を動かして線を描く／消す）
  if(!drawHeld&&!delHeld){drawing=null;lastPix=null}
 }
}
const stk=$('stick'),knob=$('knob');
function stickMove(e){const r=stk.getBoundingClientRect();let dx=(e.clientX-r.left-r.width/2)/(r.width/2),dy=(e.clientY-r.top-r.height/2)/(r.height/2);const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l}if(l<.15)dx=dy=0;stick.x=dx;stick.y=dy;knob.style.transform='translate('+dx*36+'px,'+dy*36+'px)'}
stk.addEventListener('pointerdown',e=>{stk.setPointerCapture(e.pointerId);stickMove(e)});
stk.addEventListener('pointermove',e=>{if(stk.hasPointerCapture(e.pointerId))stickMove(e)});
const stEnd=()=>{stick.x=stick.y=0;knob.style.transform=''};
stk.addEventListener('pointerup',stEnd);stk.addEventListener('pointercancel',stEnd);
function hold(id,on,off){const b=$(id),u=()=>off&&off();b.addEventListener('pointerdown',e=>{b.setPointerCapture(e.pointerId);on(e)});b.addEventListener('pointerup',u);b.addEventListener('pointercancel',u)}
const rel=()=>{drawing=null;lastPix=null;delHeld=false};
hold('bJump',()=>keys.Space=true,()=>keys.Space=false);
hold('bCrouch',()=>{keys.crouchTouch=true;const b=$('bCrouch');if(b)b.classList.add('on')},()=>{keys.crouchTouch=false;const b=$('bCrouch');if(b)b.classList.remove('on')});
hold('bAct',()=>{if(hit&&isPhoneStationBlock(hit.x,hit.y,hit.z)){openPhoneGameAtStation();return}if(requestForestResidentTalk())return;if(requestWiseCharacterTalk())return;if(tryPokeSporeShooter())return;if(isPen()){drawHeld=true;drawing=cur;lastPix=null}else{placeHeld=true;placeAcc=0;placeLockAxis=null;placeOkCount=0;place()}},()=>{drawHeld=false;placeHeld=false;placeAcc=0;placeLockAxis=null;placeOkCount=0;drawing=null;lastPix=null;setInfo()});
hold('bDel',()=>{
 if(isPen()){delHeld=true;drawing=0;lastPix=null}
 else if(hit)tryStartBreak(hit.x,hit.y,hit.z);
 else{breakHeld=true;breakAcc=0;breakTarget=null}
},()=>{delHeld=false;breakHeld=false;breakAcc=0;breakTarget=null;drawing=null;lastPix=null;hideBreakProg();setInfo()});
// 視点ボタン: 押しながらドラッグでカメラ回転
(function(){
 const b=$('bLook');if(!b)return;let lx=0,ly=0;
 b.addEventListener('pointerdown',e=>{
  b.setPointerCapture(e.pointerId);lookHeld=true;b.classList.add('on');
  lx=e.clientX;ly=e.clientY;if(!drawHeld&&!delHeld){drawing=null;lastPix=null}
 });
 b.addEventListener('pointermove',e=>{if(!lookHeld||!b.hasPointerCapture(e.pointerId))return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;const k=.005*sens;me.yaw-=dx*k;me.pitch=Math.max(-1.5,Math.min(1.5,me.pitch-dy*k))});
 const end=()=>{lookHeld=false;b.classList.remove('on')};b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);
})();
$('bMenu').onclick=openMenu;$('bChat').onclick=openChat;
if(TOUCH){document.body.classList.add('touch');inp.addEventListener('blur',()=>{if(typing)closeChat()})}

/* ---- ロビー ---- */

function leaveToLobby(){
 if(!started)return;
 if(!confirm('部屋から退室してタイトルに戻りますか？'))return;
 leaveIntent=true;
 // 操作状態をリセット
 menu=false;menuAt=0;typing=false;admAuthOpen=false;
 drawing=null;lastPix=null;stroke=null;out.length=0;
 placeHeld=false;placeAcc=0;placeLockAxis=null;placeOkCount=0;
 breakHeld=false;breakAcc=0;breakTarget=null;panning=false;hideBreakProg();
 Object.keys(keys).forEach(k=>keys[k]=false);
 closeSzPanel();closeBlkPick();
 if($('menu'))$('menu').style.display='none';
 if($('guide'))$('guide').style.display='none';
 if($('edc'))$('edc').style.display='none';
 if($('admAuth'))$('admAuth').style.display='none';
 if($('emo'))$('emo').style.display='none';emoOpen=false;
 if($('chatHist'))$('chatHist').style.display='none';
 if(typeof closeChat==='function'){try{closeChat()}catch(e){}}
 if(locked){skipMenu=true;try{document.exitPointerLock()}catch(e){}}
 // 他プレイヤー表示を消す
 for(const id of[...others.keys()])removePlayer(id);
 Net.leave();
 started=false;Net.admin=false;Net.id=null;
 saveDirty=false; // 退室後はローカル自動保存を止める（世界はサーバ保持）
 hideDisc();
 if($('topic'))$('topic').style.display='none';
 currentTopic='';topicEnabled=false;
 $('hud').style.display='none';
 if($('lobby'))$('lobby').style.display='flex';
 if($('st'))$('st').textContent='退室しました。もう一度「はじめる」で入れます';
 toast('退室しました');
 hint();setInfo();
}
function start(){
 if(started)return;started=true;$('lobby').style.display='none';$('hud').style.display='block';
 spawn();refresh();paintMenu();sync();hint();setInfo();
}
const nameVal=()=>$('nm').value.trim().slice(0,12);
function doConnect(){
 const n=nameVal();
 if(!n){$('st').textContent='なまえを入力してください';$('nm').focus();return}
 myName=n;
 $('st').textContent='接続中…';
 hideDisc();
 const jpw=($('jpw')&&$('jpw').value)||'';
 lastJoin={name:myName,col:myCol,sk:packSkin(mySkin),jpw};
 Net.connect(null,myName,myCol,packSkin(mySkin),jpw);
}
function reConnect(){
 if(!lastJoin){doConnect();return}
 hideDisc();
 $('st').textContent='再接続中…';
 toast('再接続中…');
 // 再接続時は一度 started を戻さず、init で再開する
 Net.connect(null,lastJoin.name,lastJoin.col,lastJoin.sk,lastJoin.jpw);
}
$('mk').onclick=()=>doConnect();
$('nm').addEventListener('keydown',e=>{if(e.key==='Enter')doConnect()});
if($('discRe'))$('discRe').onclick=()=>reConnect();

/* ---- メインループ ---- */
let last=performance.now(),posT=0,penT=0;
function loop(now){
 requestAnimationFrame(loop);
 const dt=Math.min((now-last)/1000,.05);last=now;
 updateSky(dt);
 if(started){
  if(phonePanelOpen)me.v.set(0,0,0);else physics(dt);if(act()){const sd=dt*sens;me.yaw+=((keys.ArrowLeft?1:0)-(keys.ArrowRight?1:0))*1.8*sd;me.pitch=Math.max(-1.5,Math.min(1.5,me.pitch+((keys.ArrowUp?1:0)-(keys.ArrowDown?1:0))*1.2*sd))}
  const moveSpeed=Math.hypot(me.v.x,me.v.z);
  const targetHeadYaw=headYawFor(me.yaw,selfBodyYaw,moveSpeed);
  // 静止中は首の可動域内で視線を向け、範囲を超えた分だけ胴体が緩やかに追従する。
  // 移動中は胴体の追従を速め、横を向いたまま歩き続けにくくする。
  const targetBodyYaw=me.yaw-targetHeadYaw;
  selfBodyYaw+=angleDelta(targetBodyYaw,selfBodyYaw)*(1-Math.exp(-dt*(moveSpeed>.12?10:3.2)));
  const selfHeadYaw=headYawFor(me.yaw,selfBodyYaw,moveSpeed);
  // 正面観察モードはカメラが対象を固定で見返すため、操作用pitchではなく正面姿勢を保つ。
  const selfHeadPitch=viewMode===2?0:clamp(me.pitch,-HEAD_PITCH_DOWN,HEAD_PITCH_UP);
  selfAv.holdingPen=isPen()&&cur!==0&&canPen();
  animAv(selfAv,dt,moveSpeed,me.crouch,selfHeadYaw,selfHeadPitch);
  const crouchBlend=selfAv.crouchMix;
  cam.position.set(me.p.x,me.p.y+(1.62-.37*crouchBlend),me.p.z);cam.rotation.set(me.pitch,me.yaw,0);
  if(viewMode===1){
   // 背後
   cam.position.addScaledVector(cam.getWorldDirection(ro),-3.5);
  }else if(viewMode===2){
   // 正面（顔が見える）
   const dist=3.2;
   const fx=-Math.sin(me.yaw),fz=-Math.cos(me.yaw);
   cam.position.set(me.p.x+fx*dist,me.p.y+1.5-.34*crouchBlend,me.p.z+fz*dist);
   cam.lookAt(me.p.x,me.p.y+1.35-.34*crouchBlend,me.p.z);
  }
  cam.updateMatrixWorld();
  updateFirstPersonPenView();
  Snd.updateListener(cam.position,cam.quaternion);
  applyUnderwaterFX();
  ro.copy(cam.position);if(cm()&&act())rd.set(mx/innerWidth*2-1,-(my/innerHeight)*2+1,.5).unproject(cam).sub(ro).normalize();else cam.getWorldDirection(rd);hit=cast();updatePhoneHauntProximity();updatePhoneStationHint();updateForestResidentHint();updateWiseCharacterHint();updateInteractPrompt();if(pickReq){pick();pickReq=picking=false}
  sel.visible=!!hit&&act();
  // 視線先の作者表示
  if($('authorTip')){
   const an=hit?authorAtHit(hit):null;
   // 自分の描いた面には作者名を出さない
   if(an&&an!==myName&&act()){
    const tip=$('authorTip');tip.style.display='block';
    const ac=nameColFor(an);
    tip.style.color=ac?colCss(ac):'#fff';
    tip.textContent=an+' が描いた';
   }
   else $('authorTip').style.display='none';
  }
if(hit)sel.position.set(hit.x+.5,hit.y+.5,hit.z+.5);
  doDraw();
  // 長押し連置: 初回即置き、以降 PLACE_REPEAT_SEC ごと。2個目以降は同じ一直線のみ
  if(placeHeld&&!isPen()&&act()){
   placeAcc+=dt;
   if(placeAcc>=PLACE_REPEAT_SEC){placeAcc=0;place()}
  }
  // 落書き付きブロックのみ長押し破壊（無地は tryStartBreak で即破壊済み）
  if(breakHeld&&!isPen()&&act()&&canBlk()){
   if(hit&&(!breakTarget||hit.x!==breakTarget.x||hit.y!==breakTarget.y||hit.z!==breakTarget.z)){
    // 照準が別ブロックへ：無地なら即壊し、落書き付きならカウントし直し
    if(blockHasPaint(hit.x,hit.y,hit.z)){
     breakTarget={x:hit.x,y:hit.y,z:hit.z};breakAcc=0;showBreakProg(0);
    }else{
     setBlock(hit.x,hit.y,hit.z,0,true);
     breakAcc=0;breakTarget=null;hideBreakProg();
    }
   }else if(hit&&breakTarget){
    if(!blockHasPaint(hit.x,hit.y,hit.z)){
     // 途中で絵が消えた等：即破壊
     setBlock(hit.x,hit.y,hit.z,0,true);
     breakHeld=false;breakAcc=0;breakTarget=null;hideBreakProg();
    }else{
     breakAcc+=dt;
     showBreakProg(breakAcc/BREAK_SEC);
     if(breakAcc>=BREAK_SEC){
      setBlock(hit.x,hit.y,hit.z,0,true);
      breakHeld=false;breakAcc=0;breakTarget=null;hideBreakProg();
     }
    }
   }else if(!hit){breakAcc=0;breakTarget=null;hideBreakProg()}
  }else if(!breakHeld){hideBreakProg()}
  if(wDirty){rebuildWorld();wDirty=false}
  syncPhoneStationVisual();
  if(oDirty){rebuildOverlay();oDirty=false}
  if(tDirty){for(const page of dirtyPaintPages)paintAtlases[page].texture.needsUpdate=true;dirtyPaintPages.clear();tDirty=false}
  if(out.length&&now-penT>60){{const faces=new Set(out.map(it=>it[0]));for(const k of faces)faceAuthor.set(k,myName);Net.send({t:'pen',s:out});out=[];penT=now}}
  if(saveDirty&&now-saveT>30000){saveDirty=false;saveT=now;saveWorld()}
  if(Net.id&&now-posT>66){Net.send({t:'pos',id:Net.id,p:[+me.p.x.toFixed(2),+me.p.y.toFixed(2),+me.p.z.toFixed(2)],y:+me.yaw.toFixed(3),by:+selfBodyYaw.toFixed(3),hy:+selfHeadYaw.toFixed(3),pitch:+selfHeadPitch.toFixed(3),crouch:!!me.crouch,heldPen:isPen()&&cur!==0&&canPen()});posT=now}
  const k=1-Math.exp(-dt*12);
  selfG.visible=viewMode>0;if(viewMode>0){selfG.position.copy(me.p);selfG.rotation.y=selfBodyYaw}
  for(const o of others.values()){
   if(!o.fresh){
    const px=o.g.position.x,pz=o.g.position.z;
    o.g.position.lerp(o.tp,k);
    o.g.rotation.y+=angleDelta(o.ty,o.g.rotation.y)*(1-Math.exp(-dt*10));
    const remoteSpeed=Math.hypot(o.g.position.x-px,o.g.position.z-pz)/Math.max(dt,.001);
    animAv(o.av,dt,remoteSpeed,o.crouch===true,Number.isFinite(o.lookYaw)?o.lookYaw:headYawFor(o.viewYaw,o.g.rotation.y,remoteSpeed),clamp(o.lookPitch,-HEAD_PITCH_DOWN,HEAD_PITCH_UP));
   }
   if(o.bub&&now>o.until){o.g.remove(o.bub);o.bub.material.map.dispose();o.bub.material.dispose();o.bub=null}
  }
  updateAmbientCritters(dt,now);
  updateCaveAmbience(dt,now);
  updateSporeShooter(dt,now);
  updateMischiefCreature(dt,now);
  updateForestResident(dt,now);
  updateWiseCharacter(dt,now);
 }
 updateMischiefSpeech(now);
 updateForestResidentSpeech(now);
 updateWiseCharacterSpeech(now);
 renderDisasterEffect(now);
 renderKesaranEffect(now);
 R.render(scene,cam);
 if(shotReq){shotReq=false;R.domElement.toBlob(async b=>{
   if(!b){toast('撮影に失敗しました');return}
   const name='rakugaki_'+ts()+'.png';
   let copied=false;
   try{
    if(navigator.clipboard&&window.ClipboardItem){
     await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);
     copied=true;
    }
   }catch(e){}
   dl(b,name);
   toast(copied?'📷 保存＋クリップボードにコピーしました':'📷 画像を保存しました（ダウンロード）');
  })}
}
requestAnimationFrame(loop);
})();
