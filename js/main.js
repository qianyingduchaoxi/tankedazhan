/* ============================================================
   星海堡垒 · 科幻坦克大战 - 核心逻辑 main.js
   架构：逻辑层与表现层严格分离
     · 逻辑层：Map/Tank/Bullet/Enemy/Item/WeaponPickup/Base 只存 2D 网格坐标
     · 表现层：
        - CanvasRenderer 负责 2D 俯视绘制（零依赖）
        - ThreeRenderer 负责 3D 第一/第三人称（需 Three.js CDN 加载成功，否则回退 2D）
     · 视角切换（V 键）仅切换渲染器/摄像机，逻辑对象完全保留
   所有注释中文，关键算法标注设计思路
   ============================================================ */

(function () {
'use strict';

/* ============================================================
   全局常量 / 数据
   ============================================================ */

// 2D 网格大小（13x13 单位，每格 64px = 832 画布尺寸）
// 3D 模式中 1 格 = 1 世界单位，映射到 XZ 平面
const GRID = 13;                   // 13 x 13 格
const CELL = 64;                   // 每格像素
const CANVAS_SIZE = GRID * CELL;  // 832

// 方向枚举（角度制：0上、1右、2下、3左）
const DIR = { UP:0, RIGHT:1, DOWN:2, LEFT:3 };
const DIR_VEC = [ [0,-1], [1,0], [0,1], [-1,0] ];
const DIR_RAD = [ -Math.PI/2, 0, Math.PI/2, Math.PI ];

// 玩家坦克移动速度（格/秒）——敌我统一速度基准（要求敌人速度与玩家完全一致）
const PLAYER_SPEED = 4.2;

// 敌人雷达探测半径（约为可视屏的 1.5 倍：屏幕约 13 格 → 雷达 19 格，覆盖整张常规地图）
const ENEMY_RADAR_RANGE = 19;
// 敌人视觉探测半径
const ENEMY_SIGHT_RANGE = 9;
// 敌人动态距离保持区间（格，对应"米"的等比缩放）
const ENEMY_PREF_MIN = 4.5;
const ENEMY_PREF_MAX = 9.0;
// 敌人每批次同时在场数量（固定 4）
const ENEMY_BATCH_SIZE = 4;
// 敌人生成最小间距（坦克单位/格）
const ENEMY_SPAWN_SPACING = 3.0;

// 难度参数（同屏敌人数 = 每批 4 个；super 为全新"超级人机"纯机械反应模式）
// robot=true：零反应时间、零瞄准误差、即时回避、全员弹道预判，超越人类极限
const DIFFICULTY = {
  low:  { total:8,  maxActive:4, reactMin:1.2, reactMax:1.8, chaseRate:0.25, shootErr:0.45, pickupRate:0.3, heavyChance:0.03, fastChance:0.15, scoreMul:1.0, weaponDropMul:1.1, shootCdMul:1.3,  robot:false },
  mid:  { total:12, maxActive:4, reactMin:0.9, reactMax:1.5, chaseRate:0.45, shootErr:0.30, pickupRate:0.5, heavyChance:0.08, fastChance:0.22, scoreMul:1.2, weaponDropMul:1.0, shootCdMul:1.1,  robot:false },
  high: { total:16, maxActive:4, reactMin:0.6, reactMax:1.1, chaseRate:0.65, shootErr:0.18, pickupRate:0.85,heavyChance:0.15, fastChance:0.28, scoreMul:1.5, weaponDropMul:0.85, shootCdMul:1.0,  robot:false },
  super:{ total:16, maxActive:4, reactMin:0.0, reactMax:0.05,chaseRate:1.0,  shootErr:0.02, pickupRate:0,   heavyChance:0.20, fastChance:0.35, scoreMul:2.5, weaponDropMul:0.7, shootCdMul:0.62, robot:true }
};
const DIFF_NAME = { low:'低难度', mid:'中难度', high:'高难度', super:'超级人机' };
const VIEW_NAME = { topdown:'经典俯视', first:'第一人称', third:'第三人称' };

// 武器定义（子弹速度已按玩家反馈整体调低约 40%，更容易看清弹道和躲避）
const WEAPONS = {
  standard: { name:'标准炮弹', icon:'◉', color:'#00eaff', dmg:1, speed:230, cd:0.30, ammo:Infinity, size:7, pierce:0, breakSteel:false, beam:false, aoe:0, spread:0, type:'standard' },
  laserPipe:{ name:'镭射管',   icon:'≡', color:'#00aaff', dmg:1, speed:420, cd:0.16, ammo:10, size:5, pierce:2, breakSteel:false, beam:true,  aoe:0, spread:0, type:'laserPipe' },
  laserCannon:{ name:'激光炮', icon:'✹', color:'#ff3d7f', dmg:3, speed:520, cd:0.6,  ammo:2, size:11, pierce:0, breakSteel:true,  beam:true,  aoe:0, spread:0, type:'laserCannon' },
  rocket:   { name:'火箭弹',   icon:'◈', color:'#ffa040', dmg:2, speed:190, cd:0.7,  ammo:2, size:9, pierce:0, breakSteel:true,  beam:false, aoe:2.2, spread:0, type:'rocket' },
  spread:   { name:'散射弹',   icon:'❖', color:'#ffd34e', dmg:0.5, speed:215, cd:0.42, ammo:2, size:6, pierce:0, breakSteel:false, beam:false, aoe:0, spread:8, type:'spread' }
};
const SPECIAL_WEAPONS = ['laserPipe','laserCannon','rocket','spread'];

// 传统道具
const ITEMS = {
  star:   { name:'坦克升级（⭐）', icon:'⭐', color:'#ffd34e' },
  bomb:   { name:'手雷（💣）', icon:'💣', color:'#ff3d7f' },
  life:   { name:'坦克生命（❤）', icon:'❤', color:'#ff4d4d' },
  shield: { name:'护盾（🛡）', icon:'🛡', color:'#00eaff' },
  freeze: { name:'定时冻结（❄）', icon:'❄', color:'#8fd8ff' }
};
const ITEM_KEYS = ['star','bomb','life','shield','freeze'];

// 敌人类型（速度与玩家统一为 PLAYER_SPEED；射速 2-3 秒；带连发/弹匣/回避参数）
const ENEMY_TYPES = {
  normal: { name:'普通坦克', color:'#ff7f7f', hp:2, shootCd:2.4, bulletSpeed:230, dmg:1, score:100, pickWeapons:true, radius:0.8, burst:[3,4], magSize:24 },
  fast:   { name:'快速坦克', color:'#ffa040', hp:1, shootCd:2.8, bulletSpeed:230, dmg:1, score:200, pickWeapons:true, radius:0.75, burst:[3,5], magSize:20 },
  heavy:  { name:'重型坦克', color:'#b56565', hp:4, shootCd:2.6, bulletSpeed:230, dmg:1, score:400, pickWeapons:true, radius:0.9, bulletColor:'#ff4d4d', burst:[4,5], magSize:30 },
  reward: { name:'奖励坦克', color:'#ffd34e', hp:2, shootCd:2.2, bulletSpeed:230, dmg:1, score:300, pickWeapons:true, radius:0.8, dropBonus:2.5, burst:[3,4], magSize:24 },
  boss:   { name:'超强人机', color:'#c06cff', hp:24, shootCd:2.2, bulletSpeed:240, dmg:1, score:5000, pickWeapons:false, radius:0.95, bulletColor:'#c06cff', burst:[4,5], magSize:30, isBoss:true }
};

// 三个关卡（均 13x13 网格；. 空地, B 砖墙, S 钢墙, G 草丛, W 水面, P 玩家出生, 1/2/3 敌人出生点）
// 已按玩家反馈：障碍物密度加大（掩体更多、走廊更窄），并彻底移除基地 H
const LEVELS = [
  [
    "BB.SS.BB.B...",
    "...SS...B....",
    "1....BB.SS..2",
    ".BB......SS..",
    "....BBBB..B..",
    "..GG.WWWW..GG",
    "..GG.WWWW..GG",
    "......BB.....",
    ".SS..BB..P.B.",
    "...BB..BBB...",
    "....S...S....",
    ".B..S...S..B.",
    "...3.........",
  ].map(s=>s.slice(0,13)),
  [
    "..BB..SS..BB.",
    "..BB..SS..BB.",
    "..SS.....SS..",
    "1...BBBBBB..2",
    ".SS..GGG..SS.",
    "..S..GGG..S..",
    ".....B.B.....",
    "..S.BBBBB.S..",
    ".SS.B...B.SS.",
    "....B.P.B....",
    "..S.B...B.S..",
    "....BB.BB....",
    "3............",
  ].map(s=>s.slice(0,13)),
  [
    "SS.SSS.SS.SSS",
    "S..........S.",
    ".BB..WWW..BB.",
    "1.B..WWW..B2.",
    "..B.......B..",
    ".....GGG.....",
    "..S..GGG..S..",
    "....S.P.S....",
    "..S.......S..",
    ".SS..BBB..SS.",
    "..B...B...B..",
    "3...BBBBB...2",
    "..SS.....SS..",
  ].map(s=>s.slice(0,13)),
];

// 超强人机 1V1 竞技场：25×25（约 1600 战场单位，远超 800×800 米规格）
// 钢墙边界 + 对称掩体/水面/草丛的多样化工业地形
function makeBossArena(){
  const N = 25;
  const g = Array.from({length:N}, ()=>Array(N).fill('.'));
  const put = (x,y,c)=>{ if(x>=1&&x<N-1&&y>=1&&y<N-1) g[y][x]=c; };
  for (let i=0;i<N;i++){ g[0][i]='S'; g[N-1][i]='S'; g[i][0]='S'; g[i][N-1]='S'; }
  // 对称掩体群（3 格长条）
  [
    [6,6],[18,6],[6,18],[18,18],
    [12,8],[12,16],[8,12],[16,12],[4,10],[20,14]
  ].forEach(([x,y])=>{ put(x,y,'B'); put(x-1,y,'B'); put(x+1,y,'B'); });
  // 钢质重掩体（方形）
  [
    [11,4],[13,20],[4,13],[20,11]
  ].forEach(([x,y])=>{ for (let i=0;i<2;i++) for (let j=0;j<2;j++) put(x+i,y+j,'S'); });
  // 水面（2×2）
  [[9,5],[15,18],[5,9],[18,15]].forEach(([x,y])=>{ put(x,y,'W'); put(x+1,y,'W'); put(x,y+1,'W'); put(x+1,y+1,'W'); });
  // 草丛带
  for (let i=6;i<=18;i+=3){ put(i,11,'G'); put(i+1,11,'G'); put(i,13,'G'); }
  // 出生点：敌人(顶部) 玩家(底部)
  put(12,2,'1');
  put(12,22,'P');
  return g.map(r=>r.join(''));
}
const BOSS_ARENA = makeBossArena();

// 墙体类型
// wall.type: 'brick' 可毁 / 'steel' 钢墙，生命值按补丁条款⑦
// steel 生命 2，brick 生命 1
// grass 和 water 不是墙，但阻挡坦克（water）或半透明（grass）

/* ============================================================
   工具函数
   ============================================================ */
const rand = (a,b)=>a+Math.random()*(b-a);
const randInt = (a,b)=>Math.floor(rand(a,b+1));
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const aabb = (x,y,w,h, x2,y2,w2,h2) => x<x2+w2 && x+w>x2 && y<y2+h2 && y+h>y2;
function saveLocal(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
function loadLocal(key, def){ try{ const s = localStorage.getItem(key); return s==null? def : JSON.parse(s); }catch(e){ return def; } }

/* ============================================================
   SettingsManager · 设置管理器（全局覆盖所有模式）
   所有设置统一存储，修改后立即生效
   ============================================================ */
// 电脑端默认键位：WASD 移动（同时支持方向键）、空格/鼠标 射击
const DEFAULT_KEYS = {
  moveUp:'KeyW', moveDown:'KeyS', moveLeft:'KeyA', moveRight:'KeyD',
  shoot:'Space', switchWeapon:'KeyQ', switchWeapon2:'Tab', switchView:'KeyV',
  pause:'KeyP', restart:'KeyR'
};
const KEY_LABELS = {
  moveUp:'↑ 移动上(W)', moveDown:'↓ 移动下(S)', moveLeft:'← 移动左(A)', moveRight:'→ 移动右(D)',
  shoot:'射击(空格)', switchWeapon:'切换武器(Q)', switchWeapon2:'切换武器(Tab)', switchView:'切换视角(V)',
  pause:'暂停(P)', restart:'重开(R)'
};

class SettingsManager {
  constructor(){
    this.STORAGE_KEY = 'xhjs_settings_v1';
    this.defaults = {
      volMaster:80, volMusic:50, volSfx:85,
      quality:'mid', fx:'mid', font:'mid',
      shake:true, particles:true, colorblind:false,
      sensitivity:1.0,
      keys:Object.assign({}, DEFAULT_KEYS),
      joySize:150, fireSize:64, touchAlpha:80,
      haptic:true,
      firstRun:true
    };
    this.s = Object.assign({}, this.defaults, loadLocal(this.STORAGE_KEY, {}));
    // 兼容
    for (const k in this.defaults) if (this.s[k]===undefined) this.s[k] = this.defaults[k];
    this.apply();
    this.listeners = [];
  }
  onChange(fn){ this.listeners.push(fn); }
  commit(){ saveLocal(this.STORAGE_KEY, this.s); this.apply(); this.listeners.forEach(fn=>{ try{fn(this.s);}catch(e){} }); }
  apply(){
    // 字体大小
    const f = { small:0.85, mid:1.0, large:1.2 }[this.s.font];
    document.documentElement.style.setProperty('--font-size-scale', f);
    // 色盲模式
    document.body.classList.toggle('cb-protanopia', !!this.s.colorblind);
    // 触控大小/透明度
    const joystick = document.getElementById('joystick');
    const fire = document.getElementById('btnFire');
    if (joystick) { joystick.style.width = this.s.joySize+'px'; joystick.style.height = this.s.joySize+'px'; }
    if (fire) { fire.style.width = this.s.fireSize+'px'; fire.style.height = this.s.fireSize+'px'; }
    const a = (this.s.touchAlpha/100).toFixed(2);
    const tui = document.getElementById('touchUI');
    if (tui) tui.style.opacity = a;
  }
  reset(){ this.s = JSON.parse(JSON.stringify(this.defaults)); this.commit(); }
  // 提供给 AudioManager 的音量合成
  masterGain(v){ return (this.s.volMaster/100) * (v/100); }
}
const SM = new SettingsManager();

/* ============================================================
   AudioManager · Web Audio 合成音效（零外部文件）
   所有事件独立函数：射击（分武器）/爆炸/拾取/切换/受伤/过关/结束/警报/击杀确认
   ============================================================ */
class AudioManager {
  constructor(){
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicStarted = false;
    this.initDeferred();
    SM.onChange(()=>this.refreshGains());
  }
  initDeferred(){
    // 为兼容 iOS，必须在首次点击手势里 resume
    const self = this;
    const start = () => {
      try{
        self.ctx = new (window.AudioContext||window.webkitAudioContext)();
        self.masterGain = self.ctx.createGain();
        self.musicGain = self.ctx.createGain();
        self.sfxGain = self.ctx.createGain();
        self.masterGain.connect(self.ctx.destination);
        self.musicGain.connect(self.masterGain);
        self.sfxGain.connect(self.masterGain);
        self.refreshGains();
      }catch(e){}
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start, {once:true});
    window.addEventListener('keydown', start, {once:true});
  }
  // 在开始按钮里主动调用（补丁条款⑬）
  resume(){ if (this.ctx && this.ctx.state==='suspended'){ this.ctx.resume().catch(()=>{}); }
            if (!this.ctx) { try{ this.ctx = new (window.AudioContext||window.webkitAudioContext)();
                                    this.masterGain = this.ctx.createGain();
                                    this.musicGain = this.ctx.createGain();
                                    this.sfxGain = this.ctx.createGain();
                                    this.masterGain.connect(this.ctx.destination);
                                    this.musicGain.connect(this.masterGain);
                                    this.sfxGain.connect(this.masterGain);
                                    this.refreshGains(); }catch(e){} }
            this._ensureVoice();
            this.startMusic();
  }
  // 彩蛋语音：拾取=「晚安」/ 受击=「你干嘛」
  // 用 HTMLAudio 媒体元素播放（双击 index.html 的 file:// 协议下 fetch 会被 CORS 拦截，
  // 但媒体元素可正常播放本地 mp3；http(s) 下同样工作）
  _ensureVoice(){
    if (this._voiceReady) return;
    this._voiceReady = true;
    try{
      this._voicePickup = new Audio('audio/pickup.mp3');
      this._voicePickup.preload = 'auto';
      this._voiceHurt = new Audio('audio/hurt.mp3');
      this._voiceHurt.preload = 'auto';
    }catch(e){ this._voicePickup = null; this._voiceHurt = null; }
  }
  _playVoice(baseEl, vol){
    if (!baseEl) return false;
    try{
      const a = baseEl.cloneNode ? baseEl.cloneNode(true) : baseEl;
      const m = (SM.s.volMaster||0)/100, s = (SM.s.volSfx||0)/100;
      a.volume = Math.max(0, Math.min(1, vol * m * s * 2.2));
      const p = a.play();
      if (p && p.catch) p.catch(()=>{});
      return true;
    }catch(e){ return false; }
  }
  refreshGains(){
    if(!this.ctx) return;
    const m = SM.s.volMaster/100;
    this.masterGain.gain.value = m;
    this.musicGain.gain.value = SM.s.volMusic/100;
    this.sfxGain.gain.value = SM.s.volSfx/100;
  }
  startMusic(){
    if(!this.ctx || this.musicStarted) return;
    this.musicStarted = true;
    const ctx = this.ctx;
    const out = this.musicGain;
    const t0 = ctx.currentTime;
    // 科幻感简单低音循环（五音音阶）
    const notes = [110, 123, 146, 130, 110, 98, 110, 146];
    let i = 0;
    const self = this;
    function loop(){
      if (!self.musicStarted) return;
      const f = notes[i % notes.length];
      i++;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type='triangle'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.45);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t+0.5);
      // 上一层小琶音
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.value = f*2;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.08, t+0.08);
      g2.gain.exponentialRampToValueAtTime(0.0001, t+0.35);
      o2.connect(g2); g2.connect(out);
      o2.start(t); o2.stop(t+0.4);
      setTimeout(loop, 520);
    }
    loop();
  }
  // 基础：射击（分武器类型）
  shoot(type='standard'){
    if(!this.ctx) return;
    const ctx = this.ctx; const out = this.sfxGain;
    const t = ctx.currentTime;
    switch(type){
      case 'standard': {
        const o=ctx.createOscillator(), g=ctx.createGain();
        o.type='square'; o.frequency.setValueAtTime(780,t); o.frequency.exponentialRampToValueAtTime(320,t+0.12);
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.22,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.13);
        o.connect(g); g.connect(out); o.start(t); o.stop(t+0.15); break;
      }
      case 'laserPipe': {
        const o=ctx.createOscillator(), g=ctx.createGain();
        o.type='sawtooth'; o.frequency.setValueAtTime(1400,t); o.frequency.exponentialRampToValueAtTime(900,t+0.09);
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.18,t+0.005); g.gain.exponentialRampToValueAtTime(0.0001,t+0.1);
        o.connect(g); g.connect(out); o.start(t); o.stop(t+0.12); break;
      }
      case 'laserCannon': {
        // 充能+放电
        const o1=ctx.createOscillator(), g1=ctx.createGain();
        o1.type='sine'; o1.frequency.setValueAtTime(120,t); o1.frequency.exponentialRampToValueAtTime(660,t+0.35);
        g1.gain.setValueAtTime(0.0001,t); g1.gain.exponentialRampToValueAtTime(0.28,t+0.35); g1.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
        const o2=ctx.createOscillator(), g2=ctx.createGain();
        o2.type='sawtooth'; o2.frequency.setValueAtTime(300,t+0.35); o2.frequency.exponentialRampToValueAtTime(80,t+0.55);
        g2.gain.setValueAtTime(0.0001,t+0.35); g2.gain.exponentialRampToValueAtTime(0.3,t+0.36); g2.gain.exponentialRampToValueAtTime(0.0001,t+0.6);
        o1.connect(g1); g1.connect(out); o2.connect(g2); g2.connect(out); o1.start(t); o1.stop(t+0.52); o2.start(t+0.35); o2.stop(t+0.62); break;
      }
      case 'rocket': {
        const o=ctx.createOscillator(), g=ctx.createGain();
        const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900;
        o.type='square'; o.frequency.setValueAtTime(220,t); o.frequency.exponentialRampToValueAtTime(90,t+0.22);
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.35,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.25);
        o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t+0.3); break;
      }
      case 'spread': {
        for (let k=0;k<3;k++){
          const o=ctx.createOscillator(), g=ctx.createGain();
          o.type='triangle';
          o.frequency.setValueAtTime(900+rand(-150,150), t+k*0.01);
          o.frequency.exponentialRampToValueAtTime(450, t+0.08+k*0.01);
          g.gain.setValueAtTime(0.0001, t+k*0.01);
          g.gain.exponentialRampToValueAtTime(0.16, t+0.005+k*0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t+0.12+k*0.01);
          o.connect(g); g.connect(out); o.start(t+k*0.01); o.stop(t+0.15+k*0.01);
        }
        break;
      }
    }
  }
  // 爆炸
  explode(level=1){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const n = Math.min(3, level);
    for(let k=0;k<n;k++){
      const o=ctx.createOscillator(), g=ctx.createGain();
      const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=500+k*150;
      o.type='sawtooth'; o.frequency.setValueAtTime(160-k*30, t+k*0.04);
      o.frequency.exponentialRampToValueAtTime(40, t+0.35+k*0.04);
      g.gain.setValueAtTime(0.0001, t+k*0.04);
      g.gain.exponentialRampToValueAtTime(0.42/n, t+0.01+k*0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.55+k*0.04);
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t+k*0.04); o.stop(t+0.6+k*0.04);
    }
    // 白噪模拟冲击
    try{
      const sr = ctx.sampleRate; const buf = ctx.createBuffer(1, sr*0.25, sr);
      const d = buf.getChannelData(0);
      for(let i=0;i<d.length;i++){ d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2.2); }
      const src = ctx.createBufferSource(); src.buffer=buf;
      const g = ctx.createGain(); g.gain.value = 0.5 * level;
      const f=ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=380;
      src.connect(f); f.connect(g); g.connect(out); src.start(t);
    }catch(e){}
  }
  pick(type='item'){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const freqs = type==='weapon' ? [660, 880, 1175] : [520, 780, 990];
    freqs.forEach((f,i)=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001, t+i*0.05);
      g.gain.exponentialRampToValueAtTime(0.26, t+0.01+i*0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.18+i*0.05);
      o.connect(g); g.connect(out); o.start(t+i*0.05); o.stop(t+0.2+i*0.05);
    });
  }
  // 玩家彩蛋：拾取武器/强化包时播放「晚安」语音（鸡你太美梗）
  // 优先播放 mp3（媒体元素，file/http 均可）；失败时回落 TTS"鸡"，再不济回落电子音阶
  ji(){
    if (this._playVoice(this._voicePickup, 0.9)) return;
    if (this._sayJi()) return;
    this.pick('weapon');
  }
  _sayJi(){
    try{
      const ss = window.speechSynthesis;
      if (!ss || !window.SpeechSynthesisUtterance) return false;
      const vs = ss.getVoices ? ss.getVoices() : [];
      const zh = vs.find(v => /zh|chinese|中文|huihui|kangkang|yaoyao|xiaoxiao|yunxi|yunyang/i.test((v.lang||'')+' '+(v.name||'')));
      if (vs.length && !zh) return false;   // 系统有嗓音列表但无中文嗓音→回落电子音
      const u = new SpeechSynthesisUtterance('鸡');
      u.lang = 'zh-CN';
      u.rate = 1.1;    // 短促
      u.pitch = 1.6;   // 高音更喜感
      u.volume = Math.max(0.2, Math.min(1, (SM.s.volMaster/100) * (SM.s.volSfx/100) * 2.2));
      if (zh) u.voice = zh;
      try{ ss.cancel(); }catch(e){}   // 连续拾取时打断上一声，避免语音堆积
      ss.speak(u);
      return true;
    }catch(e){ return false; }
  }
  switch(){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='square'; o.frequency.setValueAtTime(1200,t); o.frequency.exponentialRampToValueAtTime(600,t+0.06);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.22,t+0.005); g.gain.exponentialRampToValueAtTime(0.0001,t+0.08);
    o.connect(g); g.connect(out); o.start(t); o.stop(t+0.1);
  }
  hurt(){
    // 玩家被攻击：优先播「你干嘛」语音（1.2s 节流，语音较长避免重叠）；未就绪时回落电子音
    const now = performance.now();
    if (!this._lastHurtT || now - this._lastHurtT > 1200){
      this._lastHurtT = now;
      if (this._playVoice(this._voiceHurt, 1.0)) return;
    }
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sawtooth'; o.frequency.setValueAtTime(280,t); o.frequency.exponentialRampToValueAtTime(80,t+0.3);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.42,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.35);
    o.connect(g); g.connect(out); o.start(t); o.stop(t+0.4);
  }
  levelClear(){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const seq=[523,659,784,1047,1319];
    seq.forEach((f,i)=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='triangle'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,t+i*0.1);
      g.gain.exponentialRampToValueAtTime(0.3,t+0.01+i*0.1);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.4+i*0.1);
      o.connect(g); g.connect(out); o.start(t+i*0.1); o.stop(t+0.45+i*0.1);
    });
  }
  gameOver(){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const seq=[440,370,294,220,165];
    seq.forEach((f,i)=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sawtooth'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,t+i*0.14);
      g.gain.exponentialRampToValueAtTime(0.28,t+0.01+i*0.14);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.5+i*0.14);
      o.connect(g); g.connect(out); o.start(t+i*0.14); o.stop(t+0.55+i*0.14);
    });
  }
  baseAlarm(){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='square'; o.frequency.setValueAtTime(880,t); o.frequency.setValueAtTime(660,t+0.25);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.25,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
    o.connect(g); g.connect(out); o.start(t); o.stop(t+0.55);
  }
  // 击杀确认（击败特效专用，清脆金属感，区别爆炸声）
  killConfirm(){
    if(!this.ctx) return;
    const ctx=this.ctx, out=this.sfxGain; const t=ctx.currentTime;
    // 上行音阶 + 金属敲击
    const o1=ctx.createOscillator(), g1=ctx.createGain();
    o1.type='triangle'; o1.frequency.setValueAtTime(880,t); o1.frequency.exponentialRampToValueAtTime(1760,t+0.12);
    g1.gain.setValueAtTime(0.0001,t); g1.gain.exponentialRampToValueAtTime(0.32,t+0.01); g1.gain.exponentialRampToValueAtTime(0.0001,t+0.28);
    const o2=ctx.createOscillator(), g2=ctx.createGain();
    o2.type='square'; o2.frequency.setValueAtTime(2400,t+0.02);
    g2.gain.setValueAtTime(0.0001,t+0.02); g2.gain.exponentialRampToValueAtTime(0.08,t+0.025); g2.gain.exponentialRampToValueAtTime(0.0001,t+0.12);
    // 噪声"叮"感
    const buf = ctx.createBuffer(1, ctx.sampleRate*0.1, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length, 4);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const fg=ctx.createBiquadFilter(); fg.type='bandpass'; fg.frequency.value=7000; fg.Q.value=6;
    const g3=ctx.createGain(); g3.gain.value=0.35;
    src.connect(fg); fg.connect(g3); g3.connect(out); src.start(t+0.005);

    o1.connect(g1); g1.connect(out); o2.connect(g2); g2.connect(out);
    o1.start(t); o1.stop(t+0.32); o2.start(t+0.02); o2.stop(t+0.15);
  }
  // 触觉振动（手机）
  vibrate(ms=20){ if (SM.s.haptic && 'vibrate' in navigator) { try{ navigator.vibrate(ms); }catch(e){} } }
}
const AM = new AudioManager();

/* ============================================================
   武器库 · WeaponInventory（玩家持有多种武器，每种最多 1 个）
   ============================================================ */
class WeaponInventory {
  constructor(){
    this.owned = { standard: { key:'standard', ammo:Infinity } };
    this.order = ['standard'];  // 切换顺序
    this.current = 'standard';
  }
  hasWeapon(key){ return !!this.owned[key]; }
  pickupWeapon(key){
    if (key === 'standard') return 'dup';
    if (this.hasWeapon(key)) return 'dup';
    this.owned[key] = { key, ammo: WEAPONS[key].ammo };
    this.order.push(key);
    return 'ok';
  }
  currentWeapon(){ return this.owned[this.current]; }
  // 切换（Q 或 Tab，循环）
  next(){
    if (this.order.length <= 1) return;
    const i = this.order.indexOf(this.current);
    this.current = this.order[(i+1) % this.order.length];
    this._playSwitch();
  }
  prev(){
    if (this.order.length <= 1) return;
    const i = this.order.indexOf(this.current);
    this.current = this.order[(i-1+this.order.length) % this.order.length];
    this._playSwitch();
  }
  _playSwitch(){
    AM.switch();
    const card = document.getElementById('weaponCard');
    if (card){ card.classList.add('switching'); setTimeout(()=>card.classList.remove('switching'), 260); }
  }
  // 发射一次消耗弹药；返回 true 表示允许发射
  consume(){
    const w = this.currentWeapon();
    const W = WEAPONS[w.key];
    if (w.ammo <= 0) return false;
    if (w.ammo !== Infinity){
      w.ammo -= 1;
      if (w.ammo <= 0){
        // 耗尽自动移除并切回标准
        const k = w.key;
        const idx = this.order.indexOf(k);
        if (idx >= 0) this.order.splice(idx,1);
        delete this.owned[k];
        this.current = 'standard';
        this._playSwitch();
        game && game.showToast('武器弹药耗尽，已切换为标准炮弹', 'warn', 1800);
      }
    }
    return true;
  }
}

/* ============================================================
   逻辑对象定义（逻辑层，与渲染器完全无关）
   坐标统一为：网格浮点数（0~13）
   ============================================================ */

// 玩家坦克
class Player {
  constructor(gx, gy){
    this.x = gx + 0.5; this.y = gy + 0.5;  // 逻辑中心
    this.radius = 0.45;                     // 碰撞半径（AABB 简化为盒）
    this.dir = DIR.UP;                       // 朝向（炮塔朝向，经典模式下就是车身朝向）
    this.turretYaw = 0;                      // 3D 模式炮塔额外朝向（相对车身）
    this.aimYaw = -Math.PI/2;                // 俯视模式炮塔指向（鼠标瞄准角），默认朝上
    this.level = 1;                          // 坦克等级，影响标准炮弹速度与 cd
    this.shootTimer = 0;
    this.hp = 10;                            // 补丁条款①血量制
    this.hpMax = 14;
    this.invul = 0;                          // 护盾秒数
    this.inventory = new WeaponInventory();
    this.freeze = 0;                         // 预留（敌人被冻结）
  }
  speed(){ return PLAYER_SPEED; }            // 格/秒（敌我统一速度基准）
  currentCd(){
    const w = WEAPONS[this.inventory.currentWeapon().key];
    let cd = w.cd;
    if (w.type === 'standard'){
      cd -= (this.level-1)*0.05;
      if (cd < 0.12) cd = 0.12;
    }
    return cd;
  }
}

// 敌方坦克
class Enemy {
  constructor(type, gx, gy, diff){
    this.type = type;
    const T = ENEMY_TYPES[type];
    this.x = gx + 0.5; this.y = gy + 0.5;
    this.radius = T.radius;
    this.dir = DIR.DOWN;
    // 修正：统一用 maxHp（之前同时赋值 hpMax 和 maxHp，Canvas 血条读 maxHp，避免后续混淆）
    this.maxHp = T.hp; this.hp = T.hp;
    // 敌人移动速度与玩家完全一致（玩家要求：enemy speed = player speed exactly）
    this.speed = PLAYER_SPEED;
    this.shootCd = T.shootCd;
    this.shootTimer = rand(0.5, 1.5);
    this.spawnProtect = 2.0;            // 补丁条款⑧ 2 秒出生保护
    this.weapon = 'standard';           // 敌人默认标准炮，拾取增强包后切换
    this.reactTimer = 0;                // 第一人称反应计时
    this.hasSeenPlayer = false;
    this.stuckTimer = 0;                // 防卡死
    this.lastX = this.x; this.lastY = this.y;
    this.wanderDir = pick([DIR.UP,DIR.RIGHT,DIR.DOWN,DIR.LEFT]);
    this.wanderTimer = rand(1.2, 3.0);
    this.decideTimer = rand(0.2, 0.8);  // 行为决策冷却（防每帧随机翻面抽搐）
    this.state = 'wander';              // 'wander' | 'chase' | 'pickup'
    this.goalX = undefined; this.goalY = undefined;
    this.diff = diff;
    this.target = null;                 // 追击目标（武器包 or 玩家 or 基地）
    this.hitShowTime = 0;               // 被击时显示血条计时
    this.dmgFlash = 0;                  // 受击闪红
    // —— 火力系统：弹匣 + 连发 ——
    this.magSize = T.magSize || 24;
    this.ammo = this.magSize;           // 当前弹匣子弹数
    this.burstLeft = 0;                 // 本轮连发剩余弹数
    this.burstCd = 0;                   // 连发间隔（0.12s/发）
    this.reloadTimer = 0;               // 装填计时（弹匣打空后 2.5s）
    // —— 回避系统：检测玩家子弹后 0.3~0.8s 随机反应，横向/纵向闪避 ——
    this.dodgeTimer = -1;               // 回避反应倒计时（-1=未触发）
    this.dodgeDir = -1;                 // 回避方向（4 向索引）
    this.dodgeMoveT = 0;                // 回避动作持续时间
    // —— 超强人机专属身法 ——
    this.agileTimer = rand(0.4, 1.2);   // 随机变向计时
    this.sPhase = 0;                    // S 形规避相位
    this._isBoss = !!T.isBoss;
  }
}

// 子弹（逻辑弹）
class Bullet {
  constructor(ownerSide, weaponKey, x, y, dir, fromPlayer){
    this.side = ownerSide;              // 'player' / 'enemy'
    this.key = weaponKey;
    const W = WEAPONS[weaponKey];
    this.def = W;
    this.x = x; this.y = y;
    const v = DIR_VEC[dir];
    // 3D 模式：turret 自定义方向可覆盖
    this.vx = v[0]; this.vy = v[1];
    this.speed = W.speed / CELL;        // 格/秒
    this.radius = Math.max(0.08, W.size/CELL/2);
    this.life = 2.5;                    // 最大存活秒
    this.dead = false;
    this.fromPlayer = !!fromPlayer;
    this.pierceLeft = W.pierce || 0;    // 穿透剩余
    this.hitTiles = new Set();          // 已击中砖块，避免同一粒子穿透重复扣血
    this.isBeam = W.beam;
    this.beamLife = 0.15;               // 光束持续绘制（视觉非实体）
    this.dmg = W.dmg;
    this.startX = x; this.startY = y;
    // 物理反弹：钢墙/边界按入射角=反射角反弹，最多 3 次，每次保留 80% 速度
    this.bouncesLeft = 3;
    this.isReflected = false;
  }
  setVelocityRad(rad, speedFactor=1){
    const s = this.speed * speedFactor;
    this.vx = Math.cos(rad) * s / (this.speed) ; // 仅比例
    const len = Math.hypot(this.vx,this.vy) || 1;
    this.vx = Math.cos(rad); this.vy = Math.sin(rad);
  }
}

// 武器增强包（闪烁光球）
class WeaponPickup {
  constructor(key, gx, gy){
    this.key = key;
    this.x = gx + 0.5; this.y = gy + 0.5;
    this.radius = 0.45;
    this.flash = 0;
  }
}

// 传统道具
class Item {
  constructor(kind, gx, gy){
    this.kind = kind; this.x = gx+0.5; this.y = gy+0.5;
    this.radius = 0.45; this.age = 0;
  }
}

// 伤害数字（浮字）
class DamageText {
  constructor(tx, ty, text, color='#fff'){ this.x=tx; this.y=ty; this.text=text; this.color=color; this.life=0.8; this.age=0; }
}

// 粒子
class Particle {
  constructor(x,y,vx,vy,color,life,size=3){
    this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.color=color; this.life=life; this.maxLife=life; this.size=size;
  }
}

// 爆炸标记（视觉特效）
class ExplosionFx {
  constructor(x,y,radius=1.2, kind='normal'){
    this.x=x; this.y=y; this.r=radius; this.age=0; this.life=0.55; this.kind=kind;
  }
}

/* ============================================================
   逻辑层核心 Game（状态机 + 所有逻辑数据）
   所有渲染器都从 this 中读数据
   ============================================================ */
const STATE = { START:'start', PLAYING:'playing', PAUSED:'paused', LEVEL_COMPLETE:'level_complete', GAME_OVER:'game_over', VICTORY:'victory' };

class Game {
  constructor(){
    this.canvas = document.getElementById('canvas2d');
    this.ctx = this.canvas.getContext('2d');
    this.threeBox = document.getElementById('three-container');
    this.width = CANVAS_SIZE; this.height = CANVAS_SIZE;

    this.state = STATE.START;
    this.difficulty = 'mid';
    this.gridN = GRID;                   // 当前地图边长（超强人机大地图 > 13）
    this.bossMode = false;               // 超强人机 1V1 模式
    this.view = 'topdown';              // topdown / first / third
    this.viewPrev = 'topdown';
    this.threeEnabled = false;          // three.js 是否可用
    this.threeRenderer = null;
    this.renderer = null;               // 当前激活渲染器

    this.levelIdx = 0;
    this.score = 0;
    this.enemiesKilledTotal = 0;
    this.pityThisLevel = false;         // 怜悯已触发
    this.dmgWindow = [];                // 受伤害时间戳窗（秒）
    this.map = null;
    this.player = null;
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.pickups = [];
    this.items = [];
    this.fxParticles = [];
    this.damageTexts = [];
    this.explosions = [];
    this.bloodBarShowers = new Map();   // id -> expire time
    this.base = { x:0, y:0, hp:1, alive:true };   // 占位，防止旧逻辑空引用
    this.hasBase = false;               // 玩家要求：不要基地，胜负只看敌军/玩家
    this.enemySpawnPoints = [];         // 逻辑格子
    this.playerSpawnPoint = [6,12];
    this.enemiesRemainingToSpawn = 0;
    this.enemiesSpawnedInWave = 0;
    this.spawnTimers = [0,2.2,4.0];     // 三个出生点的下一次出生秒
    this.enemySpecialShooters = 0;      // 同时持有特殊武器开火的敌人数量（≤1 补丁条款⑥）
    this.globalFreeze = 0;              // 定时冻结道具秒数
    this.pickupSpawnTimer = 0;          // 下一个武器增强包刷新（秒）
    this.itemSpawnTimer = 0;            // 下一轮道具刷新（秒）
    this.elapsed = 0;
    this.lastTime = 0;
    this.input = null;
    this.touch = null;

    // 击败特效冷却
    this.killFxTimer = 0;

    // 新人引导计时
    this.tutorialTimer = 0;
    this.tutorialSeen3d = false;

    // 性能监测（FPS）
    this.fps = 60; this.fpsLowCount = 0; this.perfDowngradeOnce = false;

    // 鼠标牵引目标
    this.towTarget = null;  // {x,y,persistence}
    this.mouseDownAt = -1;  // 左键按下时间戳
    this.mouseDownMoved = false;
    this.mouseRmbTarget = null;

    // 朝向/炮塔目标（第一人称鼠标/触摸 3D）
    this.camYaw = 0;
    this.camPitch = 0.15;
  }

  /* ---------- 启动与重置 ---------- */
  startNewGame(diff, view){
    this.bossMode = false;
    this.difficulty = diff;
    this.view = view;
    this.levelIdx = 0;
    this.score = 0;
    this.enemiesKilledTotal = 0;
    this.initLevel(0);
    this.state = STATE.PLAYING;
    this.showToast(`第 1 关 · ${DIFF_NAME[diff]} · ${VIEW_NAME[view]} 开始！`, 'good', 2400);
    this.tutorialTimer = 10;   // 新人引导 10 秒
    UI.hideAllMenus();
    UI.showHUD();
    this._ensureRenderer();
    this.showViewHint();
  }

  /* ---------- 超强人机 1V1（强度按所选难度分级） ---------- */
  startBossMode(){
    this.bossMode = true;
    // 若未选过难度，默认中
    this.difficulty = DIFFICULTY[this.difficulty] ? this.difficulty : 'mid';
    this.view = 'topdown';
    this.levelIdx = 0;
    this.score = 0;
    this.enemiesKilledTotal = 0;
    this.initLevel(0);
    // 直接生成 1 个超强人机，强度随难度分级
    const sp = this.enemySpawnPoints[0] || [12, 2];
    const boss = new Enemy('boss', sp[0], sp[1], this.difficulty);
    const D = DIFFICULTY[this.difficulty];
    const hpMul = { low:0.5, mid:1.0, high:1.5, super:2.0 }[this.difficulty] || 1;
    boss.maxHp = boss.hp = Math.round(boss.maxHp * hpMul);
    // 机器人模式：纯机械反应（零延迟回避/零误差/全员预判由 D.robot 统一驱动）
    boss._robot = !!D.robot;
    this.enemies.push(boss);
    this.enemiesRemainingToSpawn = 0;
    this.enemiesSpawnedInWave = 1;
    this.state = STATE.PLAYING;
    this.showToast(`🤖 超强人机 1V1 · ${DIFF_NAME[this.difficulty]}${D.robot ? '（纯机械反应）' : ''}`, 'good', 3200);
    UI.hideAllMenus();
    UI.showHUD();
    this._ensureRenderer();
    this.showViewHint();
  }
  // V 键视角切换引导浮层（开局/切换后显示 3.5 秒）
  showViewHint(){
    const el = document.getElementById('viewHint');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(this._viewHintT);
    this._viewHintT = setTimeout(()=>el.classList.remove('show'), 3500);
  }
  initLevel(idx){
    this.levelIdx = idx;
    // 超强人机使用 25×25 大竞技场，其余使用常规关卡
    const rows = this.bossMode ? BOSS_ARENA : LEVELS[idx % LEVELS.length];
    this.map = this._parseLevel(rows);
    // 基地/出生点信息已在 parseLevel 设置
    const p = this.playerSpawnPoint;
    // 保留玩家生命/武器库（过关不重置）。第一次进入时创建。
    if (!this.player){
      this.player = new Player(p[0], p[1]);
    } else {
      this.player.x = p[0] + 0.5;
      this.player.y = p[1] + 0.5;
      this.player.invul = 2.0;
      this.player.dir = DIR.UP;
      this.player.turretYaw = 0;
    }
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.pickups = [];
    this.items = [];
    this.fxParticles = [];
    this.damageTexts = [];
    this.explosions = [];
    this.pityThisLevel = false;
    this.dmgWindow.length = 0;
    this.globalFreeze = 0;
    this.enemySpecialShooters = 0;
    this.elapsed = 0;

    const D = DIFFICULTY[this.difficulty];
    this.enemiesRemainingToSpawn = D.total;
    this.enemiesSpawnedInWave = 0;
    this.spawnTimers = [2.0, 4.2 + Math.random()*1.0, 6.5 + Math.random()*1.2];

    // 开场刷 3 个武器增强包（补丁条款）
    for (let i=0;i<3;i++) this._spawnWeaponPickupRandom();

    // 先刷 3 个道具
    for (let i=0;i<3;i++) this._spawnItemRandom();

    this.itemSpawnTimer = 40;     // 每 40 秒补 3 个
    this.pickupSpawnTimer = 30;   // 开场后 30 秒补 1 个（若场上<2）

    this.base.hp = 1; this.base.alive = true;
    this._refreshHUD();
  }
  _parseLevel(rows){
    const grid = [];
    const walls = []; // {x,y,w,h,type:'brick'|'steel',hp}
    const grasses = [];
    const waters = [];
    const spawns = [];
    const n = (rows[0] || '').length;
    this.gridN = n || GRID;
    for (let y=0;y<n;y++){
      grid[y] = [];
      const row = rows[y] || '';
      for (let x=0;x<n;x++){
        const ch = row[x] || '.';
        grid[y][x] = ch;
        if (ch==='B') walls.push({gx:x,gy:y,type:'brick',hp:1});
        else if (ch==='S') walls.push({gx:x,gy:y,type:'steel',hp:2});
        else if (ch==='G') grasses.push({gx:x,gy:y});
        else if (ch==='W') waters.push({gx:x,gy:y});
        else if (ch==='H'){ /* 玩家要求移除基地：H 格子按空地处理 */ }
        else if (ch==='P') this.playerSpawnPoint = [x,y];
        else if (ch==='1'||ch==='2'||ch==='3') spawns.push([x,y]);
      }
    }
    // 补齐 3 个出生点（防止地图漏写）
    while (spawns.length < 3) spawns.push([spawns.length*4 + 1, 0]);
    this.enemySpawnPoints = spawns.slice(0,3);
    return { walls, grasses, waters, grid };
  }

  /* ---------- 出生/刷新 ---------- */
  _randomCellAvoidingWalls(){
    for (let tries=0;tries<80;tries++){
      const n = this.gridN || GRID;
      const gx = randInt(1, n-2), gy = randInt(1, n-2);
      if (this._cellBlockedByWallWaterOrBase(gx,gy)) continue;
      if (this.enemySpawnPoints.find(p=>p[0]===gx && p[1]===gy)) continue;
      if (Math.abs(gx - this.playerSpawnPoint[0])<2 && Math.abs(gy - this.playerSpawnPoint[1])<2) continue;
      return [gx,gy];
    }
    return [1,1];
  }
  _cellBlockedByWallWaterOrBase(gx,gy){
    const grid = this.map.grid;
    if (!grid[gy]) return true;
    const ch = grid[gy][gx];
    if (ch==='B'||ch==='S'||ch==='W') return true;
    if (this.base.gx===gx && this.base.gy===gy) return true;
    return false;
  }
  _spawnWeaponPickupRandom(){
    const [gx,gy] = this._randomCellAvoidingWalls();
    const key = pick(SPECIAL_WEAPONS);
    this.pickups.push(new WeaponPickup(key, gx, gy));
  }
  _spawnItemRandom(){
    const [gx,gy] = this._randomCellAvoidingWalls();
    const key = pick(this._itemKeyPool());
    this.items.push(new Item(key, gx, gy));
  }
  // 超级人机模式：移除"一键清除敌人"的手雷道具（其余道具不变）
  _itemKeyPool(){
    return this.difficulty === 'super' ? ITEM_KEYS.filter(k => k !== 'bomb') : ITEM_KEYS;
  }
  // 道具场上上限 5，新替旧（补丁条款⑨）
  _pruneItems(){
    while (this.items.length > 5) this.items.shift();
  }
  // 增强包上限 2（补丁条款，排除开场 3 个）
  _prunePickups(){
    // 刷新后若 > 2，限制每 30s 只补到 2；已有的允许保留到被拾取（以避免强制删除掉落资源）
    // 我们这里按"场上最多 2"在刷新前判断
  }

  _spawnEnemyAt(sp, type){
    const [gx, gy] = sp;
    const D = DIFFICULTY[this.difficulty];
    // 间距约束：与已在场敌人保持 ≥3 格、与玩家保持 ≥4 格，避免出生堆叠
    for (const e of this.enemies){
      if (Math.hypot(e.x-(gx+0.5), e.y-(gy+0.5)) < ENEMY_SPAWN_SPACING) return false;
    }
    if (this.player && Math.hypot(this.player.x-(gx+0.5), this.player.y-(gy+0.5)) < 4) return false;
    // 类型分布
    if (!type){
      const r = Math.random();
      type = 'normal';
      if (r < D.heavyChance) type = 'heavy';
      else if (r < D.heavyChance + D.fastChance) type = 'fast';
      else if (r < D.heavyChance + D.fastChance + 0.18) type = 'reward';
    }
    const enemy = new Enemy(type, gx, gy, this.difficulty);
    enemy._robot = !!D.robot;   // 超级人机：纯机械反应（零延迟/零误差/即时回避/弹道预判）
    this.enemies.push(enemy);
    this.enemiesRemainingToSpawn--;
    this.enemiesSpawnedInWave++;
    return true;
  }
  // 批量出生：优先 3 个标记出生点，满员/间距不足时在场景中搜索符合间距的开放格
  _spawnOneEnemy(D){
    const points = this.enemySpawnPoints.slice();
    // 已尝试过的点本轮跳过，优先出生点
    for (let i = points.length - 1; i > 0; i--){
      const j = randInt(0, i);
      [points[i], points[j]] = [points[j], points[i]];
    }
    for (const sp of points){
      if (this._spawnEnemyAt(sp)) return true;
    }
    // 场景内寻找满足 ≥3 格间距的开放格
    for (let t = 0; t < 40; t++){
      const [gx, gy] = this._randomCellAvoidingWalls();
      if (this._spawnEnemyAt([gx, gy])) return true;
    }
    return false;
  }

  /* ---------- 辅助查询 ---------- */
  _circleVsWalls(x,y,r){
    // 简化：检测圆形 vs 所有墙格 AABB，返回 true 表示有重叠
    for (const w of this.map.walls){
      if (w.hp <= 0) continue;
      const wx = w.gx, wy = w.gy;
      if (x+r > wx && x-r < wx+1 && y+r > wy && y-r < wy+1) return true;
    }
    return false;
  }
  _circleVsWaters(x,y,r){
    for (const w of this.map.waters){
      if (x+r > w.gx && x-r < w.gx+1 && y+r > w.gy && y-r < w.gy+1) return true;
    }
    return false;
  }
  _inBounds(x,y,r){ const n = this.gridN || GRID; return (x-r>=0 && x+r<=n && y-r>=0 && y+r<=n); }

  // 尝试按 (dx,dy) 步长移动坦克（玩家或敌人），若碰墙则只在可通过方向分量移动（经典坦克手感，防卡死）
  _moveTank(t, dx, dy){
    const r = t.radius;
    // 先尝试 X
    let nx = t.x + dx, ny = t.y;
    if (this._inBounds(nx, ny, r) && !this._circleVsWalls(nx, ny, r) && !this._circleVsWaters(nx, ny, r) && !this._tankVsOthers(t, nx, ny)) t.x = nx;
    // 再尝试 Y
    nx = t.x; ny = t.y + dy;
    if (this._inBounds(nx, ny, r) && !this._circleVsWalls(nx, ny, r) && !this._circleVsWaters(nx, ny, r) && !this._tankVsOthers(t, nx, ny)) t.y = ny;
  }
  // 坦克之间碰撞
  _tankVsOthers(self, nx, ny){
    const r = self.radius;
    // 玩家 vs 敌人
    if (self === this.player){
      for (const e of this.enemies){
        const dx = nx - e.x, dy = ny - e.y;
        const rr = r + e.radius - 0.1;
        if (dx*dx + dy*dy < rr*rr) return true;
      }
    } else {
      // 敌人 vs 玩家 & 其他敌人
      const dx0 = nx - this.player.x, dy0 = ny - this.player.y;
      const rr0 = r + this.player.radius - 0.1;
      if (dx0*dx0 + dy0*dy0 < rr0*rr0) return true;
      for (const e of this.enemies){
        if (e === self) continue;
        const dx = nx - e.x, dy = ny - e.y;
        const rr = r + e.radius - 0.1;
        if (dx*dx + dy*dy < rr*rr) return true;
      }
    }
    return false;
  }

  /* ---------- 主循环入口 ---------- */
  loop(ts){
    if (!this.lastTime) this.lastTime = ts;
    let dt = (ts - this.lastTime) / 1000;
    this.lastTime = ts;
    if (dt > 0.1) dt = 0.1;  // 卡顿时限帧
    if (this.state === STATE.PLAYING){
      this._update(dt);
      this._updateFps(dt);
    }
    // 修正：START 状态下 startNewGame 还没执行，2D 地图、3D 场景、player 等数据还未建立
    // 此时 Canvas 可以只渲染背景，ThreeRenderer 因为 threeContainer 未构建也不应被调用
    if (this.renderer){
      if (this.state === STATE.START){
        // START 阶段只允许 canvas 渲染背景（地图不存在时跳过 entity 绘制）；ThreeRenderer 不允许 render
        if (this.canvasRenderer) this.canvasRenderer.render(dt);
      } else {
        this.renderer.render(dt);
      }
    }
    this._updateEffectsOnly(dt);  // 即使暂停，UI 层面也可能有特效残留
    requestAnimationFrame((t)=>this.loop(t));
  }

  _updateFps(dt){
    const f = 1/Math.max(0.0001, dt);
    this.fps = this.fps * 0.9 + f * 0.1;
    if (this.fps < 30) this.fpsLowCount++;
    else this.fpsLowCount = 0;
    if (this.fpsLowCount > 60 && !this.perfDowngradeOnce && SM.s.quality !== 'low'){
      SM.s.quality = 'low'; SM.commit();
      UI.rebuildQualityChip();
      this.perfDowngradeOnce = true;
      UI.showPerfTip();
      if (this.threeRenderer) this.threeRenderer.applyQuality();
    }
  }

  /* ---------- 击败特效四件套（屏幕脉冲 + 徽章 + 音效 + 粒子爆发） ---------- */
  triggerKillFx(x,y,scoreDelta){
    // 屏幕脉冲
    const pulse = document.getElementById('killPulse');
    if (pulse){ pulse.classList.remove('play'); void pulse.offsetWidth; pulse.classList.add('play'); }
    // 徽章
    const badge = document.getElementById('killBadge');
    if (badge){ badge.classList.remove('play'); void badge.offsetWidth; badge.classList.add('play'); }
    // 击杀确认音效
    AM.killConfirm();
    AM.vibrate(30);
    // 粒子爆发：按特效强度（补丁条款⑭）
    const coef = { low:0.4, mid:0.7, high:1.0 }[SM.s.fx];
    if (SM.s.particles){
      const n = Math.floor(48 * coef);
      for (let i=0;i<n;i++){
        const ang = Math.random()*Math.PI*2;
        const spd = rand(3, 11);
        this.fxParticles.push(new Particle(x, y, Math.cos(ang)*spd, Math.sin(ang)*spd,
          pick(['#ffd34e','#00eaff','#ff3d7f','#c06cff','#fff']), rand(0.5, 1.1), rand(2,5)));
      }
      // 冲击波环：用爆炸模拟
      this.explosions.push(new ExplosionFx(x,y,2.5,'shock'));
    }
    // 屏幕震动
    if (SM.s.shake){
      const app = document.getElementById('app');
      if (app){ app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); }
    }
    // HUD 分数放大
    const sc = document.getElementById('scoreVal');
    if (sc){ sc.textContent = this.score; sc.classList.remove('pop'); void sc.offsetWidth; sc.classList.add('pop');
      setTimeout(()=>sc.classList.remove('pop'), 400); }
    // 生命/弹药微光
    const wc = document.getElementById('weaponCard');
    if (wc){ wc.style.boxShadow = '0 0 22px rgba(255,211,78,0.65)';
      setTimeout(()=>wc.style.boxShadow='var(--shadow-neon)', 600); }
  }

  /* ---------- 屏幕提示 ---------- */
  showToast(text, cls='', ms=1500){
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'toast show ' + cls;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(()=>{ el.className = 'toast'; }, ms);
  }

  /* ---------- 主 update ---------- */
  _update(dt){
    this.elapsed += dt;
    // 计时器（暂停时此函数不调用，自动满足补丁条款⑩）

    // 新人引导
    if (this.tutorialTimer > 0){
      this.tutorialTimer -= dt;
      const step = Math.ceil(this.tutorialTimer / 3);
      if (this.view === 'topdown'){
        const lines = {
          3: '提示：WASD / 方向键 移动 · 空格或鼠标 射击（鼠标指向即炮口方向）',
          2: '提示：Q 或 Tab 切换武器 · 拾取闪烁光球获得特殊武器',
          1: '提示：消灭所有敌人即可过关 · 60 秒内受伤 6 次会触发怜悯护盾'
        };
        if (lines[step]) this.showToast(lines[step], '', 1600);
      } else if (!this.tutorialSeen3d){
        this.showToast('提示：鼠标环顾视角 · WASD 移动 · 左键射击 · V 键切回俯视', '', 2600);
        this.tutorialSeen3d = true;
      }
    }

    // 全局冻结倒计时
    if (this.globalFreeze > 0) this.globalFreeze = Math.max(0, this.globalFreeze - dt);

    // 道具刷新（40秒刷3个，上限5）
    this.itemSpawnTimer -= dt;
    if (this.itemSpawnTimer <= 0){
      this.itemSpawnTimer = 40;
      for (let i=0;i<3;i++) this._spawnItemRandom();
      this._pruneItems();
    }

    // 武器增强包刷新（30秒补1，场上≤2）
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0){
      this.pickupSpawnTimer = 30;
      if (this.pickups.length < 2) this._spawnWeaponPickupRandom();
    }

    // 敌人出生：每批固定 4 个同屏，出生点 + 场景随机格分布，间距≥3
    const D = DIFFICULTY[this.difficulty];
    if (!this.bossMode && this.enemiesRemainingToSpawn > 0){
      this._spawnTick = (this._spawnTick ?? 0) - dt;
      if (this._spawnTick <= 0 && this.enemies.length < D.maxActive){
        if (this._spawnOneEnemy(D)){
          this._spawnTick = rand(0.6, 1.1);   // 批次内错峰出生
        } else {
          this._spawnTick = 0.8;              // 无合法位置，稍后重试
        }
      }
    }

    // 玩家
    this._updatePlayer(dt);
    // 敌人
    this._updateEnemies(dt);
    // 子弹
    this._updateBullets(dt);
    // 拾取物与道具逻辑
    this._updatePickupsAndItems(dt);
    // 基地受击警告
    this._updateBaseWarnings(dt);
    // 过关 / 失败 / 怜悯判定
    this._checkFlow();
    // HUD 刷新
    this._refreshHUD();
  }

  /* ---------- 玩家 ---------- */
  _updatePlayer(dt){
    const p = this.player;
    if (p.invul > 0) p.invul = Math.max(0, p.invul - dt);
    if (p.shootTimer > 0) p.shootTimer = Math.max(0, p.shootTimer - dt);

    // 触屏第三人称拖拽牵引（仅移动端；PC 端移动已改为纯 WASD）
    if (this.view === 'third'){
      if (this.towTarget && this.towTarget.persistence > 0){
        this.towTarget.persistence -= dt;
        const dx = this.towTarget.x - p.x, dy = this.towTarget.y - p.y;
        const dist = Math.hypot(dx,dy);
        if (dist > 0.15){
          const vx = (dx/dist), vy = (dy/dist);
          p.dir = this._dirFromVecStable(p.dir, vx, vy);
          this._moveTank(p, vx * p.speed() * dt, vy * p.speed() * dt);
        } else {
          this.towTarget.persistence = 0;
        }
      }
    }

    // 键盘输入（WASD / 方向键 / 自定义键 双通道）
    const I = this.input.getKeys();
    let ix = 0, iy = 0;
    if (I.up) iy -= 1;
    if (I.down) iy += 1;
    if (I.left) ix -= 1;
    if (I.right) ix += 1;

    // 触屏输入（摇杆）
    const ti = this.touch.getAxis();
    ix += ti.x; iy += ti.y;

    let aimRad = null;
    if (this.view === 'topdown'){
      // 经典俯视：屏幕方向 = 网格方向（四向稳定判定防抽搐）
      if (ix || iy){
        const len = Math.hypot(ix,iy) || 1;
        p.dir = this._dirFromVecStable(p.dir, ix, iy);
        this._moveTank(p, ix/len*p.speed()*dt, iy/len*p.speed()*dt);
      }
      // 炮塔指向鼠标（悬停即瞄准）
      if (this.input.hasMousePos){
        const aim = this._screenToGridClient(this.input.mouseClientX, this.input.mouseClientY);
        if (aim){
          const ang = Math.atan2(aim.y - p.y, aim.x - p.x);
          p.turretYaw = ang;
          p.aimYaw = ang;
          aimRad = ang;
        }
      }
    } else {
      // 第一/第三人称：相机相对移动（W 前进 / S 后退 / A 左平移 / D 右平移）
      // 约定：相机/炮口前进方向（网格系）= (cos a, sin a)，右平移方向 = (-sin a, cos a)
      const a = this.camYaw;
      const fx = Math.cos(a),  fy = Math.sin(a);    // 前
      const rx = -Math.sin(a), ry = Math.cos(a);    // 右
      const fwd = -iy;   // W / 摇杆向上 = 前进
      const str = ix;    // D / 摇杆向右 = 右平移
      let mx = fx*fwd + rx*str;
      let my = fy*fwd + ry*str;
      const ml = Math.hypot(mx, my);
      if (ml > 0.05){
        mx /= ml; my /= ml;
        // 车身朝向移动方向（4 向稳定判定，防抖动）
        p.dir = this._dirFromVecStable(p.dir, mx, my);
        this._moveTank(p, mx*p.speed()*dt, my*p.speed()*dt);
        // 第三人称镜头要求：坦克移动/转向时镜头方向保持固定，不随车体旋转（镜头角度仅在切入视角时初始化一次）
      }
      if (this.view === 'first'){
        // 第一人称：鼠标控制视角 = 控制炮口方向（指针锁或按住拖动驱动 yaw/pitch）
        // 修正：鼠标 X 右移应使炮口向右转，原逻辑取反导致水平反向；现 1:1 映射 mouseX→yaw, mouseY→pitch
        const delta = this.input.consumeMouseDelta();
        const s = 0.003 * SM.s.sensitivity;
        this.camYaw += delta.x * s;
        this.camPitch = clamp(this.camPitch - delta.y * s, -0.6, 0.5);
        p.turretYaw = this.camYaw;
      } else {
        // 第三人称：鼠标只控制炮口——炮塔实时指向鼠标射线与地面的交点
        this.input.consumeMouseDelta();   // 第三人称不再用鼠标转镜头
        if (this.threeRenderer && this.input.hasMousePos){
          const pt = this.threeRenderer.screenToGrid(this.input.mouseClientX, this.input.mouseClientY);
          if (pt){
            p.turretYaw = Math.atan2(pt.y - p.y, pt.x - p.x);
          }
        }
      }
    }

    // 射击：鼠标左键 / 空格 均可开火（触屏射击键在 touch.firing）
    const wantShoot = I.shoot || this.touch.firing;
    if (wantShoot && p.shootTimer <= 0){
      this._playerShoot(aimRad);
      p.shootTimer = p.currentCd();
    }
    // 武器切换
    if (I.switchWeapon){ this.player.inventory.next(); I.switchWeapon = false; }

    // 草丛隐蔽：进入草丛 0.5 秒平滑过渡到 70% 不透明度，离开平滑恢复
    const pgx = Math.floor(p.x), pgy = Math.floor(p.y);
    const cellCh = this.map.grid[pgy] ? this.map.grid[pgy][pgx] : '.';
    const inGrass = cellCh === 'G';
    p.grassT = clamp((p.grassT||0) + (inGrass ? dt*2 : -dt*2), 0, 1);
    p.alpha = 1 - 0.3*p.grassT;
  }
  // 最短弧角度插值（用于第三人称相机平滑转向）
  _lerpAngle(cur, target, t){
    let d = target - cur;
    while (d >  Math.PI) d -= Math.PI*2;
    while (d < -Math.PI) d += Math.PI*2;
    return cur + d*t;
  }
  // 稳定方向判定：带 15% 迟滞，主分量没有明显优势时保持原方向（消除每帧左右抽动）
  _dirFromVecStable(prev, vx, vy){
    const ax = Math.abs(vx), ay = Math.abs(vy);
    if (ax > ay * 1.15) return vx>0 ? DIR.RIGHT : DIR.LEFT;
    if (ay > ax * 1.15) return vy>0 ? DIR.DOWN : DIR.UP;
    return prev;
  }
  _dirFromVec(vx,vy){
    if (Math.abs(vx) > Math.abs(vy)) return vx>0?DIR.RIGHT:DIR.LEFT;
    return vy>0?DIR.DOWN:DIR.UP;
  }
  // 客户端屏幕坐标 -> 逻辑网格（俯视 Canvas，比例换算）
  _screenToGridClient(clientX, clientY){
    const c = this.canvas; if (!c) return null;
    const n = this.gridN || GRID;
    const rect = c.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = (clientX - rect.left) / rect.width * n;
    const y = (clientY - rect.top)  / rect.height * n;
    if (x < 0 || x > n || y < 0 || y > n) return null;
    return { x, y };
  }
  _playerShoot(aimRad){
    const inv = this.player.inventory;
    const wk = inv.currentWeapon().key;
    const W = WEAPONS[wk];
    if (!inv.consume()) return;   // 扣弹药
    AM.shoot(W.type);
    AM.vibrate(12);
    // 3D 模式按炮塔朝向发射；俯视（鼠标瞄准或朝向）按 aimRad / 车身朝向
    const p = this.player;
    const barrelLen = 0.62;       // 炮口伸出距离（从坦克中心）
    const spawns = [];
    if (this.view === 'topdown'){
      const rad = (aimRad !== null && aimRad !== undefined) ? aimRad : DIR_RAD[p.dir];
      spawns.push({ rad, mode3d:true });
    } else {
      spawns.push({ rad: p.turretYaw, mode3d:true });
    }
    for (const sp of spawns){
      const sx = p.x + Math.cos(sp.rad) * barrelLen;
      const sy = p.y + Math.sin(sp.rad) * barrelLen;
      if (W.spread){
        // 散射弹：N 片扇形
        const N = W.spread;
        const spread = Math.PI / 3.2; // 60° 扇形
        for (let i=0;i<N;i++){
          const t = (N===1)?0 : i/(N-1) - 0.5;
          const ang = sp.rad + t*spread;
          const b = new Bullet('player', wk, sx, sy, DIR.UP, true);
          b.vx = Math.cos(ang); b.vy = Math.sin(ang);
          this.bullets.push(b);
          this._spawnMuzzleFx(sx, sy, ang);
        }
      } else {
        const b = new Bullet('player', wk, sx, sy, DIR.UP, true);
        b.vx = Math.cos(sp.rad); b.vy = Math.sin(sp.rad);
        this.bullets.push(b);
        this._spawnMuzzleFx(sx, sy, sp.rad);
      }
    }
    // 炮口闪光
    if (this.threeRenderer && (this.view==='first'||this.view==='third')){
      this.threeRenderer.muzzleFlash();
    }
  }
  _spawnMuzzleFx(x,y,rad){
    if (!SM.s.particles) return;
    for (let i=0;i<6;i++){
      const a = rad + rand(-0.4,0.4);
      const s = rand(2,6);
      this.fxParticles.push(new Particle(x+Math.cos(rad)*0.5, y+Math.sin(rad)*0.5, Math.cos(a)*s, Math.sin(a)*s,
        pick(['#fff','#ffd34e','#00eaff']), rand(0.12,0.28), rand(2,4)));
    }
  }

  /* ---------- 敌人 AI ---------- */
  _updateEnemies(dt){
    const D = DIFFICULTY[this.difficulty];
    const frozen = this.globalFreeze > 0;   // 冻结期间敌人不移动/不射击
    // 玩家速度估计（超强人机弹道预判用，带平滑）
    const pp = this.player;
    const ipvx = clamp((pp.x - (this._prevPx ?? pp.x)) / Math.max(dt, 0.016), -PLAYER_SPEED*1.3, PLAYER_SPEED*1.3);
    const ipvy = clamp((pp.y - (this._prevPy ?? pp.y)) / Math.max(dt, 0.016), -PLAYER_SPEED*1.3, PLAYER_SPEED*1.3);
    this._pvx = (this._pvx||0)*0.55 + ipvx*0.45;
    this._pvy = (this._pvy||0)*0.55 + ipvy*0.45;
    this._prevPx = pp.x; this._prevPy = pp.y;

    for (const e of this.enemies){
      if (e.hp <= 0) continue;
      if (e.hitShowTime > 0) e.hitShowTime = Math.max(0, e.hitShowTime - dt);
      if (e.dmgFlash > 0) e.dmgFlash = Math.max(0, e.dmgFlash - dt);
      if (e.spawnProtect > 0) e.spawnProtect = Math.max(0, e.spawnProtect - dt);
      if (frozen) continue;
      e.shootTimer -= dt;

      /* --- 双重探测：雷达穿墙（≈1.5 屏）+ 视线（LOS） --- */
      const dxP = pp.x - e.x, dyP = pp.y - e.y;
      const distP = Math.hypot(dxP, dyP);
      const radarSee = distP <= ENEMY_RADAR_RANGE;
      const canSee = radarSee && distP <= ENEMY_SIGHT_RANGE && this._hasLineOfSight(e.x, e.y, pp.x, pp.y);
      if (canSee && !e.hasSeenPlayer){
        e.hasSeenPlayer = true;
        e.reactTimer = rand(D.reactMin, D.reactMax);
      } else if (!canSee){
        e.hasSeenPlayer = false;
        e.reactTimer = 0;
      } else {
        e.reactTimer = Math.max(0, e.reactTimer - dt);
      }

      /* --- 弹匣装填 --- */
      if (e.reloadTimer > 0){
        e.reloadTimer -= dt;
        if (e.reloadTimer <= 0) e.ammo = e.magSize;
      }

      /* --- 连发推进（3-5 发/次，0.13s 间隔） --- */
      if (e.burstLeft > 0){
        e.burstCd -= dt;
        if (e.burstCd <= 0){
          if (e.ammo <= 0){
            // 弹匣打空：立即装填，终止本轮连发
            e.burstLeft = 0;
            e.reloadTimer = 2.5;
          } else {
            e.burstCd = 0.13;
            e.burstLeft--;
            e.ammo--;
            if (canSee) this._enemyFireOne(e, D, dxP, dyP, distP);
            if (e.ammo <= 0) e.reloadTimer = 2.5;
          }
        }
      }

      /* --- 子弹回避：人类 0.3~0.8s 随机反应；机器人 0.05~0.12s 即时回避 --- */
      if (e.dodgeMoveT > 0){
        e.dodgeMoveT -= dt;
      } else if (e.dodgeTimer === -1){
        if (this._detectIncomingBullet(e)) e.dodgeTimer = (e._robot || e._isBoss) ? rand(0.05, 0.12) : rand(0.3, 0.8);
      } else if (e.dodgeTimer >= 0){
        e.dodgeTimer -= dt;
        if (e.dodgeTimer <= 0){
          e.dodgeTimer = -1;
          const b0 = this._detectIncomingBullet(e);
          const baseAng = b0 ? Math.atan2(b0.vy*b0.speed, b0.vx*b0.speed) : Math.atan2(dyP, dxP);
          // 机器人选择两个垂直方向中可通行的一侧（无随机犹豫）；人类随机一侧
          const sides = (e._robot || e._isBoss) ? [1, -1] : [Math.random() < 0.5 ? 1 : -1];
          let dd = -1;
          for (const side of sides){
            const cand = this._dirFromVecStable(e.dir, Math.cos(baseAng + side*Math.PI/2), Math.sin(baseAng + side*Math.PI/2));
            if (this._canStep(e, cand)){ dd = cand; break; }
          }
          if (dd < 0) dd = this._firstFreeDir(e, e.dir);
          e.dodgeDir = dd;
          // 机器人闪避动作更快更短
          e.dodgeMoveT = (e._robot || e._isBoss) ? rand(0.22, 0.4) : rand(0.35, 0.6);
        }
      }

      /* --- 移动决策 --- */
      let dir = e.dir;
      const agile = e._isBoss || e._robot;   // 超强人机与超级人机均使用机械身法
      if (e.dodgeMoveT > 0){
        dir = e.dodgeDir;
      } else if (agile && radarSee){
        // 机械身法：S 形规避 + 随机变向 + 180° 急转（机器人变向间隔更短更规律）
        e.agileTimer -= dt;
        if (e.agileTimer <= 0){
          e.agileTimer = e._robot ? rand(0.28, 0.55) : rand(0.35, 0.9);
          e.sPhase ^= 1;
          const turnChance = e._robot ? 0.12 : 0.18;
          if (Math.random() < turnChance){
            e.agileDir = this._firstFreeDir(e, (e.dir+2)%4);
          } else {
            const a = Math.atan2(dyP, dxP) + (e.sPhase ? Math.PI/2 : -Math.PI/2);
            const cand = this._dirFromVecStable(e.dir, Math.cos(a), Math.sin(a));
            e.agileDir = this._canStep(e, cand) ? cand : this._firstFreeDir(e, cand);
          }
        }
        dir = (e.agileDir !== undefined) ? e.agileDir : e.dir;
      } else if (radarSee){
        // 动态距离保持：4.5~9 格最优攻击距离
        if (distP > ENEMY_PREF_MAX){
          dir = this._dirFromVecStable(e.dir, dxP, dyP);
        } else if (distP < ENEMY_PREF_MIN){
          dir = this._dirFromVecStable(e.dir, -dxP, -dyP);
        } else {
          // 环绕游走射击
          e.agileTimer -= dt;
          if (e.agileTimer <= 0 || e.strafeDir === undefined){
            e.agileTimer = rand(1.2, 2.4);
            e.strafeSide = (e.strafeSide === 1) ? -1 : 1;
            const a = Math.atan2(dyP, dxP) + e.strafeSide * Math.PI/2;
            const cand = this._dirFromVecStable(e.dir, Math.cos(a), Math.sin(a));
            e.strafeDir = this._canStep(e, cand) ? cand : this._firstFreeDir(e, cand);
          }
          dir = e.strafeDir;
        }
      } else {
        // 巡逻 / 拾取（带冷却防抖）
        e.decideTimer -= dt;
        if (e.decideTimer <= 0){
          e.decideTimer = rand(0.7, 1.3);
          const pickup = this._nearestWeaponPickupTo(e, 6);
          if (pickup && D.pickupRate > 0.3 && Math.random() < D.pickupRate){
            dir = this._dirFromVecStable(e.dir, pickup.x-e.x, pickup.y-e.y);
            e.wanderDir = dir;
          } else {
            e.wanderTimer -= 0.7;
            if (e.wanderTimer <= 0){ e.wanderDir = pick([DIR.UP,DIR.RIGHT,DIR.DOWN,DIR.LEFT]); e.wanderTimer = rand(1.6, 3.2); }
            dir = e.wanderDir;
          }
        } else {
          dir = e.wanderDir;
        }
      }
      e.dir = dir;
      const v = DIR_VEC[dir];
      const prevX = e.x, prevY = e.y;
      this._moveTank(e, v[0]*e.speed*dt, v[1]*e.speed*dt);
      // 防卡死：撞墙后优先垂直/反向，再硬脱困
      if (Math.abs(e.x-prevX)<0.002 && Math.abs(e.y-prevY)<0.002){
        e.stuckTimer += dt;
        if (e.stuckTimer > 0.45){
          e.stuckTimer = 0;
          const free = this._firstFreeDir(e, dir);
          e.wanderDir = free; e.dir = free;
          if (e.agileDir !== undefined) e.agileDir = free;
          e.decideTimer = rand(0.8, 1.4);
          if (free === dir) this._unstickTeleport(e);
        }
      } else {
        e.stuckTimer = 0;
      }

      /* --- 开火触发（视线内 + 弹匣可用 + 射速 2~3 秒/轮连发） --- */
      if (canSee && e.burstLeft <= 0 && e.reloadTimer <= 0 && e.shootTimer <= 0
          && !(this.view === 'first' && e.reactTimer > 0)){
        const T = ENEMY_TYPES[e.type];
        e.shootTimer = T.shootCd * D.shootCdMul * rand(0.9, 1.15);
        e.burstLeft = randInt(T.burst[0], T.burst[1]);
        e.burstCd = 0;
      }
    }
    // 移除已死敌人（爆炸动画在子弹碰撞阶段已播放）
    this.enemies = this.enemies.filter(e=>e.hp>0);
  }
  // 检测飞向某敌人的玩家子弹（0.7 秒内将到达其碰撞半径）
  _detectIncomingBullet(e){
    for (const b of this.bullets){
      if (b.dead) continue;
      const bvx = b.vx*b.speed, bvy = b.vy*b.speed;
      const rx = e.x - b.x, ry = e.y - b.y;
      const v2 = bvx*bvx + bvy*bvy;
      if (v2 < 1e-6) continue;
      const vdotr = bvx*rx + bvy*ry;
      if (vdotr <= 0) continue;
      const tca = vdotr / v2;
      if (tca > 0.7) continue;
      const cx = b.x + bvx*tca, cy = b.y + bvy*tca;
      if (Math.hypot(cx-e.x, cy-e.y) < e.radius + 0.45) return b;
    }
    return null;
  }
  // 判断某方向是否可通行（回避/走位前探路）
  _canStep(e, dir){
    const v = DIR_VEC[dir];
    const nx = e.x + v[0]*0.8, ny = e.y + v[1]*0.8;
    return this._inBounds(nx, ny, e.radius)
        && !this._circleVsWalls(nx, ny, e.radius)
        && !this._circleVsWaters(nx, ny, e.radius)
        && !this._tankVsOthers(e, nx, ny);
  }
  // 敌人发射连发中的一发；超强人机带弹道预判
  _enemyFireOne(e, D, dxP, dyP, distP){
    const T = ENEMY_TYPES[e.type];
    const wKey = (e.weapon !== 'standard' && this.enemySpecialShooters < 1) ? e.weapon : 'standard';
    let aimX = this.player.x, aimY = this.player.y;
    if (e._isBoss || e._robot){
      // 超强人机与超级人机：弹道提前量预判（按子弹飞行时间瞄准玩家未来位置）
      const bspd = WEAPONS.standard.speed / CELL;
      const tt = distP / Math.max(bspd, 0.1);
      const n = this.gridN || GRID;
      aimX = clamp(this.player.x + (this._pvx||0)*tt, 0.5, n-0.5);
      aimY = clamp(this.player.y + (this._pvy||0)*tt, 0.5, n-0.5);
    }
    let aimAng = Math.atan2(aimY - e.y, aimX - e.x);
    // 机器人零误差（D.shootErr≈0.02），普通敌人按难度误差
    aimAng += rand(-D.shootErr, D.shootErr) * (e._isBoss && !e._robot ? 0.35 : 1);
    AM.shoot(wKey);
    const bx = e.x + Math.cos(aimAng)*0.62, by = e.y + Math.sin(aimAng)*0.62;
    const b = new Bullet('enemy', wKey, bx, by, e.dir, false);
    b.vx = Math.cos(aimAng); b.vy = Math.sin(aimAng);
    b.dmg = T.dmg;
    if (T.bulletColor) b.colorHint = T.bulletColor;
    this.enemyBullets.push(b);
    this._spawnMuzzleFx(bx, by, aimAng);
    if (wKey !== 'standard'){
      this.enemySpecialShooters++;
      const self = this;
      setTimeout(()=>{ self.enemySpecialShooters = Math.max(0, self.enemySpecialShooters-1); }, 800);
    }
  }
  // 视线判定：从 a 到 b 的网格直线（Bresenham）上是否有砖/钢墙阻挡；草丛/水面不挡视线
  _hasLineOfSight(x0, y0, x1, y1){
    const gx0 = Math.floor(x0), gy0 = Math.floor(y0);
    const gx1 = Math.floor(x1), gy1 = Math.floor(y1);
    let x = gx0, y = gy0;
    const dx = Math.abs(gx1-gx0), dy = Math.abs(gy1-gy0);
    const sx = gx0<gx1 ? 1 : -1, sy = gy0<gy1 ? 1 : -1;
    let err = dx - dy;
    let steps = 0;
    const n = this.gridN || GRID;
    while (!(x===gx1 && y===gy1) && steps < n*2){
      steps++;
      const e2 = 2*err;
      if (e2 > -dy){ err -= dy; x += sx; }
      if (e2 <  dx){ err += dx; y += sy; }
      if (this._cellBlocksSight(x, y)) return false;
    }
    return true;
  }
  _cellBlocksSight(gx, gy){
    const n = this.gridN || GRID;
    if (gx<0 || gy<0 || gx>=n || gy>=n) return true;
    const ch = this.map.grid[gy] ? this.map.grid[gy][gx] : 'B';
    return (ch === 'B' || ch === 'S');
  }
  // 找第一个可通行方向（优先左右垂直、再反向；同时避让其他坦克）
  _firstFreeDir(e, blockedDir){
    const candidates = [ (blockedDir+1)%4, (blockedDir+3)%4, (blockedDir+2)%4 ];
    for (const d of candidates){
      const v = DIR_VEC[d];
      const nx = e.x + v[0]*0.8, ny = e.y + v[1]*0.8;
      if (this._inBounds(nx, ny, e.radius)
          && !this._circleVsWalls(nx, ny, e.radius)
          && !this._circleVsWaters(nx, ny, e.radius)
          && !this._tankVsOthers(e, nx, ny)){
        return d;
      }
    }
    return blockedDir;
  }
  // 硬脱困：螺旋搜索最近的开放格并瞬时位移（出生点/角落被封堵兜底）
  _unstickTeleport(e){
    const n = this.gridN || GRID;
    const cx = Math.floor(e.x), cy = Math.floor(e.y);
    for (let r=1; r<=4; r++){
      for (let dy=-r; dy<=r; dy++){
        for (let dx=-r; dx<=r; dx++){
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const gx = cx+dx, gy = cy+dy;
          if (gx<0 || gy<0 || gx>=n || gy>=n) continue;
          const ch = this.map.grid[gy][gx];
          if (ch==='B'||ch==='S'||ch==='W') continue;
          const tx = gx+0.5, ty = gy+0.5;
          if (!this._circleVsWalls(tx, ty, e.radius) && !this._circleVsWaters(tx, ty, e.radius)
              && !this._tankVsOthers(e, tx, ty)){
            e.x = tx; e.y = ty;
            return;
          }
        }
      }
    }
  }
  _nearestWeaponPickupTo(e, maxDist){
    let best=null, bd=1e9;
    for (const p of this.pickups){
      const d = Math.hypot(p.x-e.x, p.y-e.y);
      if (d < maxDist && d < bd){ bd=d; best=p; }
    }
    return best;
  }

  /* ---------- 子弹 ---------- */
  _updateBullets(dt){
    const arrs = [ [this.bullets, true], [this.enemyBullets, false] ];
    for (const [arr, fromPlayer] of arrs){
      for (const b of arr){
        if (b.dead) continue;
        if (b.beamLife){ b.beamLife = Math.max(0, b.beamLife - dt); }
        b.life -= dt;
        if (b.life <= 0){ b.dead = true; continue; }
        const step = b.speed * dt;
        b.x += b.vx * step;
        b.y += b.vy * step;
        // 边界（大地图动态边长）
        const n = this.gridN || GRID;
        if (b.x < 0 || b.x > n || b.y < 0 || b.y > n){ b.dead = true; continue; }
        // 撞墙
        this._bulletVsWalls(b);
        if (b.dead) continue;
        // 撞坦克
        if (fromPlayer){
          // 玩家弹 -> 敌人
          for (const e of this.enemies){
            if (e.hp<=0) continue;
            if (e.spawnProtect > 0) continue;    // 补丁条款⑧：保护期穿过
            const dx = b.x-e.x, dy = b.y-e.y; const r = e.radius + b.radius;
            if (dx*dx + dy*dy < r*r){ this._hitEnemy(e, b); break; }
          }
          // 玩家弹 -> 基地（误射也算）补丁条款⑤（已按玩家要求移除基地）
          if (this.hasBase && !b.dead){
            const dx = b.x-this.base.x, dy = b.y-this.base.y; const r = 0.6 + b.radius;
            if (dx*dx+dy*dy < r*r){ this._destroyBase(); b.dead=true; }
          }
        } else {
          // 敌人弹 -> 玩家
          const p = this.player;
          if (p.invul <= 0){
            const dx=b.x-p.x, dy=b.y-p.y; const r = p.radius + b.radius;
            if (dx*dx+dy*dy < r*r){ this._hitPlayer(b); continue; }
          }
          // 敌人弹 -> 基地（已移除基地，跳过）
        }
      }
    }
    // 清除
    this.bullets = this.bullets.filter(b=>!b.dead);
    this.enemyBullets = this.enemyBullets.filter(b=>!b.dead);
  }
  _bulletVsWalls(b){
    const W = b.def;
    for (const w of this.map.walls){
      if (w.hp <= 0) continue;
      const wx = w.gx, wy = w.gy;
      if (b.x+b.radius > wx && b.x-b.radius < wx+1 && b.y+b.radius > wy && b.y-b.radius < wy+1){
        const tileKey = wx+','+wy;
        if (b.hitTiles.has(tileKey)) continue;
        b.hitTiles.add(tileKey);
        // 钢墙
        if (w.type === 'steel'){
          if (W.breakSteel){
            w.hp -= b.dmg;
            this._hitSpark(b.x, b.y, '#c06cff');
            if (w.hp <= 0) this._wallBrokenFx(w);
            b.dead = true;
          } else if (b.bouncesLeft > 0 && !b.isBeam){
            // 物理反弹：入射角=反射角，速度保留 80%，反弹次数最多 3
            this._hitSpark(b.x, b.y, '#88ccff');
            const cx = wx + 0.5, cy = wy + 0.5;
            const rdx = b.x - cx, rdy = b.y - cy;
            // 从 X 侧入射 → 反转 vx 并推出墙外；Y 侧同理
            if (Math.abs(rdx) > Math.abs(rdy)){
              b.vx = -b.vx;
              b.x = rdx > 0 ? (wx + 1 + b.radius + 0.02) : (wx - b.radius - 0.02);
            } else {
              b.vy = -b.vy;
              b.y = rdy > 0 ? (wy + 1 + b.radius + 0.02) : (wy - b.radius - 0.02);
            }
            b.speed *= 0.8;
            b.bouncesLeft--;
            b.isReflected = true;
            b.hitTiles.clear();   // 允许反弹后重新参与相邻格碰撞
            this._spawnBounceFx(b.x, b.y);
            return;
          } else {
            this._hitSpark(b.x, b.y, '#88aaff');
            b.dead = true;
          }
        } else {
          // 砖墙
          if (W.pierce){
            // 穿透：扣 1 层后继续
            w.hp -= b.dmg;
            b.pierceLeft--;
            if (w.hp<=0) this._wallBrokenFx(w);
            this._hitSpark(b.x, b.y, '#aa7755');
            if (b.pierceLeft < 0) b.dead = true;
          } else if (W.aoe){
            // 范围爆炸（火箭弹）：对中心周围格子砖墙全部摧毁
            this._explodeRocket(b);
            b.dead = true;
            return;
          } else {
            w.hp -= b.dmg;
            this._hitSpark(b.x, b.y, '#aa7755');
            if (w.hp<=0) this._wallBrokenFx(w);
            b.dead = true;
          }
        }
        break;
      }
    }
  }
  _wallBrokenFx(w){
    // 粒子
    if (SM.s.particles){
      const coef = { low:0.4, mid:0.7, high:1.0 }[SM.s.fx];
      const n = Math.floor(14*coef);
      for (let i=0;i<n;i++){
        const ang = rand(0, Math.PI*2); const spd = rand(2,7);
        this.fxParticles.push(new Particle(w.gx+0.5, w.gy+0.5, Math.cos(ang)*spd, Math.sin(ang)*spd,
          w.type==='steel' ? '#bcc6dc' : '#c68a5a', rand(0.4,0.9), rand(2,4)));
      }
    }
  }
  _hitSpark(x,y,color){
    if (!SM.s.particles) return;
    const coef = { low:0.4, mid:0.7, high:1.0 }[SM.s.fx];
    const n = Math.floor(10*coef);
    for (let i=0;i<n;i++){
      const a = rand(0, Math.PI*2); const spd = rand(2,6);
      this.fxParticles.push(new Particle(x, y, Math.cos(a)*spd, Math.sin(a)*spd, color, rand(0.15,0.4), rand(2,3)));
    }
  }
  _spawnBounceFx(x,y){
    if (!SM.s.particles) return;
    // 反弹青色火花环
    for (let i=0;i<8;i++){
      const a = i*Math.PI/4;
      this.fxParticles.push(new Particle(x, y, Math.cos(a)*3.2, Math.sin(a)*3.2, '#88e8ff', 0.22, 2));
    }
  }
  _explodeRocket(b){
    const R = b.def.aoe;
    this.explosions.push(new ExplosionFx(b.x, b.y, R, 'rocket'));
    AM.explode(2);
    // 周围墙：砖墙全毁，钢墙扣 1（补丁条款⑦一发摧毁=钢墙生命2，dmg=2，刚好）
    for (const w of this.map.walls){
      if (w.hp<=0) continue;
      const dx = (w.gx+0.5) - b.x, dy = (w.gy+0.5) - b.y;
      if (dx*dx+dy*dy < R*R){
        w.hp -= b.def.dmg;
        if (w.hp<=0) this._wallBrokenFx(w);
      }
    }
    // 对敌人
    for (const e of this.enemies){
      if (e.hp<=0 || e.spawnProtect>0) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      if (dx*dx+dy*dy < R*R){
        this._damageEnemy(e, b.def.dmg, b.x, b.y);
      }
    }
    // 对玩家（自伤 1，补丁条款④ 火箭弹自伤）
    const p = this.player;
    if (p.invul<=0){
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx*dx+dy*dy < R*R){
        this._damagePlayer(1);   // 自伤固定 1
      }
    }
    // 对基地（基地已移除）
    if (this.hasBase){
      const dx2 = this.base.x - b.x, dy2 = this.base.y - b.y;
      if (dx2*dx2+dy2*dy2 < R*R) this._destroyBase();
    }
  }
  _hitEnemy(e, b){
    this._damageEnemy(e, b.def.dmg, b.x, b.y);
    // 穿透或 AOE 特殊
    if (b.def.aoe){
      this._explodeRocket(b);
    } else if (!b.def.pierce){
      b.dead = true;
    } else {
      // 穿透敌人？按补丁未说，默认穿透只针对砖墙。这里不穿透坦克。
      b.dead = true;
    }
  }
  _damageEnemy(e, dmg, fx, fy){
    if (dmg <= 0) return;
    e.hp -= dmg;
    e.dmgFlash = 0.15;
    e.hitShowTime = 1.5;   // 血条显示 1.5 秒，补丁条款
    // 伤害数字
    this.damageTexts.push(new DamageText(e.x, e.y - 0.6, '-' + dmg.toFixed(dmg%1===0?0:1),
      dmg>=3?'#ff3d7f': (dmg>=1.5?'#ffd34e':'#ffffff')));
    // 粒子火花
    this._hitSpark(fx||e.x, fy||e.y, '#fff');
    if (SM.s.shake){
      const app = document.getElementById('app'); if(app){ app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); }
    }
    if (e.hp <= 0){
      // 死亡！
      const T = ENEMY_TYPES[e.type];
      const scoreDelta = Math.round(T.score * DIFFICULTY[this.difficulty].scoreMul);
      this.score += scoreDelta;
      this.enemiesKilledTotal++;
      // 爆炸
      this.explosions.push(new ExplosionFx(e.x, e.y, 1.5, e.type==='heavy'?'heavy':'normal'));
      AM.explode(e.type==='heavy'?3:2);
      // 击败特效
      this.triggerKillFx(e.x, e.y, scoreDelta);
      // 掉落
      const dropMul = (T.dropBonus||1) * (0.22 * DIFFICULTY[this.difficulty].weaponDropMul);
      if (Math.random() < dropMul){
        // 奖励敌人更高概率掉增强包
        if (e.type === 'reward' && Math.random() < 0.5){
          this.pickups.push(new WeaponPickup(pick(SPECIAL_WEAPONS), Math.floor(e.x), Math.floor(e.y)));
        } else if (Math.random() < 0.18 * DIFFICULTY[this.difficulty].weaponDropMul){
          this.pickups.push(new WeaponPickup(pick(SPECIAL_WEAPONS), Math.floor(e.x), Math.floor(e.y)));
        } else {
          this.items.push(new Item(pick(this._itemKeyPool()), Math.floor(e.x), Math.floor(e.y)));
          this._pruneItems();
        }
      }
    }
  }
  _hitPlayer(b){
    this._damagePlayer(b.dmg);
    b.dead = true;
    AM.explode(1);
  }
  _damagePlayer(dmg){
    const p = this.player;
    if (p.invul > 0) return;
    p.hp -= dmg;
    this._recordDmgWindow();
    this._checkPity();
    // 反馈
    const app = document.getElementById('app');
    if (app){ app.classList.remove('hit-flash'); void app.offsetWidth; app.classList.add('hit-flash'); }
    if (SM.s.shake && app){ app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); }
    // 心形闪烁
    const hs = document.querySelectorAll('.life-bar .heart');
    hs.forEach(h=>{ h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); });
    AM.hurt(); AM.vibrate(45);
    this.player.invul = 1.0;  // 受伤后 1 秒无敌，防止同帧秒死
    this.damageTexts.push(new DamageText(this.player.x, this.player.y-0.6, '-'+dmg, '#ff4d4d'));
    if (p.hp <= 0){
      p.hp = 0;
      this._gameOver(false);
    }
  }
  _recordDmgWindow(){
    const now = this.elapsed;
    this.dmgWindow.push(now);
    // 保留 60 秒窗口
    while (this.dmgWindow.length && now - this.dmgWindow[0] > 60) this.dmgWindow.shift();
  }
  _checkPity(){
    // 补丁条款①：60 秒内生命损失累计≥6 且本关尚未触发（已在 _recordDmgWindow 滑出>60秒老记录）
    if (this.pityThisLevel) return;
    // 修正：之前用"当前血量与初始上限差值"，跨关保留玩家后下一关开局血量已偏低→误触发
    // 改为严格按 dmgWindow 中 60 秒窗口内的受击次数（每次受伤都 push 了时间戳）判断
    const hits60s = this.dmgWindow.length;
    if (hits60s >= 6){
      this.pityThisLevel = true;
      // 临时护盾 3 秒（简单可靠的怜悯效果）
      this.player.invul = Math.max(this.player.invul, 3.0);
      this.showToast('怜悯机制：临时护盾 3 秒！', 'good', 2400);
      AM.pick('weapon');
    }
  }
  get _itemLivesAdded(){ return (this.__addLives)||0; }
  addLife(){
    this.__addLives = (this.__addLives||0) + 1;
  }

  _destroyBase(){
    // 基地已移除：防御性空实现
    if (!this.hasBase || !this.base.alive) return;
    this.base.alive = false;
    this.explosions.push(new ExplosionFx(this.base.x, this.base.y, 3, 'base'));
    AM.explode(3); AM.baseAlarm();
    this._gameOver(false, true);
  }

  /* ---------- 拾取物与道具 ---------- */
  _updatePickupsAndItems(dt){
    const p = this.player;
    // 武器增强包
    const pick = (arr, cb) => {
      for (let i=arr.length-1;i>=0;i--){
        const it = arr[i];
        if (it.flash!==undefined) it.flash = (it.flash + dt*3) % (Math.PI*2);
        const dx = it.x - p.x, dy = it.y - p.y;
        const r = it.radius + p.radius;
        if (dx*dx+dy*dy < r*r){
          const res = cb(it, i);
          if (res === 'removed') continue;
        }
      }
    };
    // 玩家拾取增强包
    for (let i=this.pickups.length-1;i>=0;i--){
      const pk = this.pickups[i];
      pk.flash = (pk.flash+dt*4) % (Math.PI*2);
      const dx = pk.x - p.x, dy = pk.y - p.y;
      const r = pk.radius + p.radius;
      if (dx*dx+dy*dy < r*r){
        const res = p.inventory.pickupWeapon(pk.key);
        if (res === 'ok'){
          this.pickups.splice(i,1);
          this.showToast('获得 '+WEAPONS[pk.key].name+'！弹药 '+WEAPONS[pk.key].ammo+' 发', 'good', 2000);
          AM.ji();
        } else {
          this.showToast('已拥有该武器', 'warn', 1200);
          // 已拥有也不删除，等其他敌人去捡
        }
      }
    }
    // 敌人拾取增强包（行为优先级已在 AI 阶段移动）
    for (let i=this.pickups.length-1;i>=0;i--){
      const pk = this.pickups[i];
      for (const e of this.enemies){
        const dx = pk.x-e.x, dy = pk.y-e.y; const r = pk.radius+e.radius;
        if (dx*dx+dy*dy < r*r){
          e.weapon = pk.key;
          this.pickups.splice(i,1);
          this.showToast('敌方获得 '+WEAPONS[pk.key].name, 'warn', 1800);
          break;
        }
      }
    }
    // 传统道具（玩家可拾取，敌人不拾）
    for (let i=this.items.length-1;i>=0;i--){
      const it = this.items[i];
      it.age += dt;
      const dx = it.x-p.x, dy = it.y-p.y; const r = it.radius + p.radius;
      if (dx*dx+dy*dy < r*r){
        this._applyItem(it.kind);
        this.items.splice(i,1);
      }
    }
  }
  _applyItem(kind){
    AM.ji();
    switch(kind){
      case 'star':
        this.player.level = Math.min(3, this.player.level + 1);
        this.showToast('坦克升级至 Lv.'+this.player.level+'，标准炮弹威力+射速提升', 'good', 2200);
        break;
      case 'bomb':
        // 清空所有敌人
        for (const e of this.enemies.slice()){
          if (e.hp>0) this._damageEnemy(e, 9999, e.x, e.y);
        }
        this.showToast('手雷！全场敌人被清除！', 'good', 2200);
        break;
      case 'life':
        if (this.player.hp < this.player.hpMax){
          this.player.hp = Math.min(this.player.hpMax, this.player.hp + 1);
          this.addLife();
          this.showToast('生命值 +1！', 'good', 1800);
        } else {
          this.score += 500;
          this.showToast('生命已满，分数 +500', 'good', 1800);
        }
        break;
      case 'shield':
        this.player.invul = Math.max(this.player.invul, 5);
        this.showToast('护盾启动，5 秒无敌！', 'good', 1800);
        break;
      case 'freeze':
        this.globalFreeze = Math.max(this.globalFreeze, 5);
        this.showToast('定时冻结！所有敌人静止 5 秒', 'good', 2000);
        break;
    }
  }

  /* ---------- 基地警告（基地已移除，保留空实现） ---------- */
  _updateBaseWarnings(dt){
    if (!this.hasBase || !this.base.alive) return;
    // 若有敌人弹距基地 < 2.5 格，且正向基地靠近 -> 警告
    let warn = false;
    for (const b of this.enemyBullets){
      const dx = this.base.x - b.x, dy = this.base.y - b.y;
      if (dx*dx+dy*dy < 9){ warn = true; break; }
    }
    if (warn){
      if (!this._warnOn){ this.showToast('⚠ 基地遭到攻击！', 'warn', 900); AM.baseAlarm(); this._warnOn = true;
        clearTimeout(this._warnOffT); this._warnOffT = setTimeout(()=>this._warnOn=false, 1100); }
    }
  }

  /* ---------- 流程判定 ---------- */
  _checkFlow(){
    // 只判断玩家存活 + 敌人清空（基地已移除）
    if (this.player.hp <= 0) return;
    if (this.enemiesRemainingToSpawn <= 0 && this.enemies.length === 0){
      // 过关
      this.state = STATE.LEVEL_COMPLETE;
      AM.levelClear();
      // 超强人机 1V1：击杀人机即胜利
      const isFinal = this.bossMode || this.levelIdx + 1 >= LEVELS.length * 2;
      UI.showResult(isFinal ? 'victory' : 'clear', {
        score: this.score,
        level: this.levelIdx + 1,
        kills: this.enemiesKilledTotal
      });
    }
  }
  _gameOver(quit=false, base=false){
    if (this.state === STATE.GAME_OVER || this.state === STATE.VICTORY) return;
    this.state = STATE.GAME_OVER;
    AM.gameOver();
    UI.showResult('gameover', { score: this.score, level: this.levelIdx+1, kills: this.enemiesKilledTotal, reason: '坦克被击毁' });
    // 排行榜保存统一由 UI.showResult 处理（避免重复提交）
  }

  nextLevel(){
    if (this.bossMode){ this.restartLevel(); return; }
    const nextIdx = (this.levelIdx + 1);
    this.initLevel(nextIdx);
    this.state = STATE.PLAYING;
    this.showToast(`第 ${nextIdx+1} 关 · 继续战斗！`, 'good', 2200);
    UI.hideAllMenus(); UI.showHUD();
  }
  restartLevel(){
    if (this.bossMode){
      // 超强人机：重开 1V1
      this.player = null;
      this.startBossMode();
      return;
    }
    this.player = null; // 重置玩家生命/武器到初始 10 条命、标准武器
    this.score = Math.max(0, this.score - 500);
    this.initLevel(this.levelIdx);
    this.state = STATE.PLAYING;
    UI.hideAllMenus(); UI.showHUD();
    this.showViewHint();
  }
  quitToMenu(){
    // 排行榜已在游戏结束/胜利时保存
    this.bossMode = false;
    this.state = STATE.START;
    this.player = null;
    if (this.threeRenderer) this.threeRenderer.deactivate();
    this.renderer = null;
    this.threeBox.classList.remove('active');
    this.canvas.style.display = 'block';
    UI.hideHUD(); UI.hideAllMenus();
    document.getElementById('mainMenu').classList.remove('hidden');
    LB.refresh();
  }

  /* ---------- HUD 刷新 ---------- */
  _refreshHUD(){
    const sv = document.getElementById('scoreVal'); if(sv) sv.textContent = this.score;
    const lv = document.getElementById('levelVal'); if(lv) lv.textContent = (this.levelIdx+1);
    const vv = document.getElementById('viewVal');  if(vv) vv.textContent = VIEW_NAME[this.view];
    const dv = document.getElementById('diffVal');  if(dv) dv.textContent = DIFF_NAME[this.difficulty];
    const D = DIFFICULTY[this.difficulty];
    // 修正：剩余敌人 = 未出生数 + 场上存活数（之前把活跃敌人"加"了两次导致 HUD 显示偏大与进度条反向）
    const remainingTotal = this.enemiesRemainingToSpawn + this.enemies.length;
    const ec = document.getElementById('enemyCount'); if(ec) ec.textContent = Math.max(0, remainingTotal);
    const prog = document.getElementById('enemyProgress');
    const killedProgress = (D.total - remainingTotal) / D.total * 100;
    if (prog) prog.style.width = clamp(killedProgress, 0, 100) + '%';
    // 武器面板
    const inv = this.player ? this.player.inventory : null;
    if (inv){
      const w = inv.currentWeapon();
      const W = WEAPONS[w.key];
      document.getElementById('weaponIcon').textContent = W.icon;
      document.getElementById('weaponIcon').style.color = W.color;
      document.getElementById('weaponName').textContent = W.name;
      document.getElementById('weaponAmmo').innerHTML = (w.ammo === Infinity) ? '∞' : '<b>'+w.ammo+'</b>';
      // 武器列表
      const wl = document.getElementById('weaponList');
      wl.innerHTML = '';
      for (const k of inv.order){
        const slot = document.createElement('div');
        slot.className = 'slot' + (inv.current===k?' active':'');
        slot.style.color = WEAPONS[k].color;
        slot.textContent = WEAPONS[k].icon;
        if (WEAPONS[k].ammo !== Infinity){
          const mini = document.createElement('span');
          mini.className = 'mini-ammo';
          mini.textContent = inv.owned[k].ammo;
          slot.appendChild(mini);
        }
        wl.appendChild(slot);
      }
    }
    // 生命
    const hearts = document.getElementById('hearts');
    if (hearts && this.player){
      hearts.innerHTML = '';
      const total = Math.max(this.player.hpMax, this.player.hp);
      for (let i=0;i<total;i++){
        const el = document.createElement('span');
        el.className = 'heart' + (i >= this.player.hp ? ' empty' : '');
        hearts.appendChild(el);
      }
    }
    // 等级
    const lt = document.getElementById('levelTxt'); if (lt && this.player) lt.textContent = 'Lv.'+this.player.level;
  }

  /* ---------- 视角切换（V 键，补丁条款④：仅切换渲染器，逻辑对象 100% 保留） ---------- */
  cycleView(dir=1){
    const list = this.threeEnabled ? ['topdown','first','third'] : ['topdown'];
    let i = list.indexOf(this.view);
    let next = list[(i + dir + list.length) % list.length];
    this._switchView(next);
  }
  switchViewTo(v){
    const list = this.threeEnabled ? ['topdown','first','third'] : ['topdown'];
    if (!list.includes(v)) v = 'topdown';
    this._switchView(v);
  }
  _switchView(target){
    if (target !== 'topdown' && !this.threeEnabled){
      this.showToast('3D 引擎加载失败，已保持俯视模式', 'warn', 2200);
      return;
    }
    const prev = this.view;
    this.view = target;
    if (target === 'topdown'){
      // 切 2D
      this._ensureRenderer();
      if (this.threeRenderer) this.threeRenderer.deactivate();
      this.canvas.style.display = 'block';
      this.threeBox.classList.remove('active');
      document.getElementById('crosshair').classList.remove('active');
    } else {
      // 切 3D：先确保 ThreeRenderer 构建成功（WebGL 不可用时优雅回退）
      if (!this._ensureThreeRenderer()){
        this.view = 'topdown';
        this._ensureRenderer();
        this.showToast('3D 引擎不可用，已保持俯视模式', 'warn', 2200);
        return;
      }
      this._ensureRenderer();
      this.threeRenderer.activate(target);
      // 视角切换时从当前朝向初始化相机/炮塔角度，避免切 3D 后视角卡死在错误方向
      if (target === 'first'){
        if (prev === 'topdown'){
          this.camYaw = this.input.hasMousePos ? this.player.aimYaw : DIR_RAD[this.player.dir];
        }
        this.camPitch = 0.12;
        this.player.turretYaw = this.camYaw;
      } else if (target === 'third'){
        // 第三人称相机落在车身后方
        this.camYaw = DIR_RAD[this.player.dir];
      }
      this.canvas.style.display = 'none';
      this.threeBox.classList.add('active');
      document.getElementById('crosshair').classList.toggle('active', target==='first');
    }
    this.showToast(`视角切换为 · ${VIEW_NAME[target]}`, '', 1400);
    this.showViewHint();   // 每次视角切换后显示 3.5 秒"按 V 切换视角"引导
    AM.vibrate(15);
  }
  _ensureRenderer(){
    if (this.view === 'topdown'){
      if (!this._2dRenderer) this._2dRenderer = new CanvasRenderer(this);
      this.renderer = this._2dRenderer;
    } else {
      this._ensureThreeRenderer();
      this.renderer = this.threeRenderer;
    }
  }
  _ensureThreeRenderer(){
    if (!this.threeEnabled) return false;
    if (this.threeRenderer) return true;
    try{
      this.threeRenderer = new ThreeRenderer(this);
      return true;
    }catch(err){
      // 防御：WebGL 不可用（无头浏览器/驱动禁用）时不要崩主循环，优雅回退 2D
      console.warn('[ThreeRenderer] 初始化失败，回退 2D 模式：', err);
      this.threeRenderer = null;
      this.threeEnabled = false;
      const bf = document.getElementById('btnFirst'), bt = document.getElementById('btnThird');
      if (bf){ bf.disabled = true; bf.style.opacity = 0.4; }
      if (bt){ bt.disabled = true; bt.style.opacity = 0.4; }
      const st = document.getElementById('threeStatus');
      if (st){ st.textContent = '3D 引擎：不可用（已回退 2D 模式）'; st.style.color = 'var(--c-red)'; }
      if (this.view !== 'topdown'){ this._switchView('topdown'); }
      return false;
    }
  }
  /* 仅视觉层特效（不受暂停影响，粒子/爆炸/浮字动画） */
  _updateEffectsOnly(dt){
    // 粒子
    const ps = this.fxParticles;
    for (let i=ps.length-1;i>=0;i--){
      const p = ps[i];
      p.age = (p.age||0) + dt;
      if (p.age >= p.life){ ps.splice(i,1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
    }
    // 浮字
    const dt2 = this.damageTexts;
    for (let i=dt2.length-1;i>=0;i--){
      const d = dt2[i];
      d.age += dt;
      if (d.age >= d.life){ dt2.splice(i,1); continue; }
      d.y -= dt * 0.8;
    }
    // 爆炸
    const ex = this.explosions;
    for (let i=ex.length-1;i>=0;i--){
      const e2 = ex[i];
      e2.age += dt;
      if (e2.age >= e2.life) ex.splice(i,1);
    }
  }
}

/* ============================================================
   InputManager · 键鼠统一抽象 + 按键自定义
   不直接读取具体按键，而是查询"意图" up/down/left/right/shoot 等
   ============================================================ */
class InputManager {
  constructor(game){
    this.game = game;
    this.keys = Object.create(null);    // keyCode -> bool
    this.intent = { up:false, down:false, left:false, right:false, shoot:false, switchWeapon:false, pause:false, restart:false };
    this.mouseDown = false; this.mouseDownX=0; this.mouseDownY=0; this.mouseDownTime=-1; this.mouseDownMoved=false;
    this.mouseRmb = { x:0, y:0, active:false };
    this._mouseShootHold = false;   // 鼠标按住 = 持续射击（所有视角）
    this.mouseAimActive = false;    // 兼容旧逻辑
    this.mouseAimX = 0; this.mouseAimY = 0;
    this.hasMousePos = false;       // 是否已收到鼠标位置
    this.mouseClientX = 0; this.mouseClientY = 0;  // 最新鼠标屏幕坐标（用于 3D 射线瞄准）
    this.dx = 0; this.dy = 0;       // 第一人称视角旋转增量，每帧消费
    this.dragPending = false;

    this._bind();
  }
  getKeys(){
    const I = this.intent;
    return { up:I.up, down:I.down, left:I.left, right:I.right, shoot:I.shoot, switchWeapon:I.switchWeapon, pause:I.pause, restart:I.restart };
  }
  consumeMouseDelta(){
    const r = { x: this.dx, y: this.dy };
    this.dx = 0; this.dy = 0;
    return r;
  }
  _bind(){
    const self = this;
    // 设备：键盘
    window.addEventListener('keydown', (e)=>{
      if (this._listeningKey && this._listeningKey.resolve){
        // 设置按键自定义录入中
        const k = e.code === 'Escape' ? '__cancel__' : e.code;
        if (k !== '__cancel__'){
          SM.s.keys[this._listeningKey.key] = k;
          SM.commit();
          UI.rebuildKeyRow();
        }
        this._listeningKey.resolve();
        this._listeningKey = null;
        e.preventDefault();
        return;
      }
      this.keys[e.code] = true;
      this._recomputeIntentFromKeys();
      // 游戏中屏蔽空格/方向键默认行为（滚动页面/误触按钮）
      if (this.game.state === STATE.PLAYING &&
          (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight')){
        e.preventDefault();
      }
      // 一次性按键（暂停、切换武器、重开、切换视角）
      const K = SM.s.keys;
      if (e.code === K.switchWeapon || e.code === K.switchWeapon2){ this.intent.switchWeapon = true; e.preventDefault(); }
      if (e.code === K.pause){
        if (this.game.state === STATE.PLAYING) { UI.pause(); }
        else if (this.game.state === STATE.PAUSED) { UI.resume(); }
        e.preventDefault();
      }
      if (e.code === K.restart){
        if (this.game.state === STATE.PLAYING || this.game.state === STATE.PAUSED || this.game.state === STATE.GAME_OVER) {
          this.game.restartLevel();
          e.preventDefault();
        }
      }
      if (e.code === SM.s.keys.switchView || (SM.s.keys.switchView===undefined && e.code === 'KeyV')){
        if (this.game.state === STATE.PLAYING) { this.game.cycleView(1); }
        e.preventDefault();
      }
      // 兼容开始界面按 Enter = 开始
      if (e.code === 'Enter' && document.getElementById('mainMenu') && !document.getElementById('mainMenu').classList.contains('hidden')){
        UI.startFromMain();
      }
    });
    window.addEventListener('keyup', (e)=>{
      this.keys[e.code] = false;
      this._recomputeIntentFromKeys();
    });

    // 鼠标：左键/按住 = 开火（所有视角）；第一人称移动鼠标 = 转视角炮口；第三人称/俯视 = 炮口指向鼠标
    const host = document.getElementById('app');
    const isUiTarget = (e)=>{
      const t = e.target;
      if (!t || !t.closest) return false;
      return !!(t.closest('button, select, input, label, .panel, .overlay, .hud-item'));
    };
    host.addEventListener('mousedown', (e)=>{
      if (isUiTarget(e)) return;   // 点击 UI 不算游戏输入
      if (e.button === 0){
        this.mouseDown = true;
        this.mouseDownTime = performance.now();
        this.mouseDownX = e.clientX; this.mouseDownY = e.clientY;
        this.mouseDownMoved = false;
        if (this.game.state === STATE.PLAYING){
          // 所有视角：鼠标按住 = 连续开火；炮塔指向同时更新
          this._mouseShootHold = true;
          this.mouseClientX = e.clientX; this.mouseClientY = e.clientY;
          this.hasMousePos = true;
          this.intent.shoot = true;
        }
      }
    });
    window.addEventListener('mouseup', (e)=>{
      if (e.button === 0){
        // 松开即停止鼠标连发；空格/射击键不受影响
        this._mouseShootHold = false;
        this.intent.shoot = !!(this.keys[SM.s.keys.shoot]);
        this.mouseDown = false;
      }
    });
    host.addEventListener('contextmenu', (e)=>{
      if (this.game.state === STATE.PLAYING) e.preventDefault();
    }, { passive:false });
    host.addEventListener('mousemove', (e)=>{
      if (this.game.state !== STATE.PLAYING) return;
      // 始终记录鼠标位置（俯视/第三人称炮塔指向、第一人称视角都依赖）
      this.mouseClientX = e.clientX; this.mouseClientY = e.clientY;
      this.mouseAimX = e.clientX; this.mouseAimY = e.clientY;
      this.hasMousePos = true;
      this.mouseAimActive = true;
      // 仅第一人称：鼠标移动转 yaw/pitch（指针锁，或未锁定时按住拖动）
      if (this.game.view === 'first'){
        if (document.pointerLockElement){
          this.dx += e.movementX || 0;
          this.dy += e.movementY || 0;
        } else if (this.mouseDown){
          this.dx += (e.movementX||0) * 1.8;
          this.dy += (e.movementY||0) * 1.8;
        }
      }
      // 第三人称：鼠标只决定炮口方向（在 _updatePlayer 中射线求交），不再拖拽牵引、不再转镜头
    });
    // 点击 3D 画布则尝试请求指针锁（更沉浸的第一人称体验）
    const threeContainer = document.getElementById('three-container');
    threeContainer.addEventListener('click', ()=>{
      if (this.game.view === 'first' && this.game.state === STATE.PLAYING){
        threeContainer.requestPointerLock && threeContainer.requestPointerLock();
      }
    });
    // 鼠标连发已并入 _mouseShootHold（mousedown 置位 / mouseup 清除），不再使用定时器轮询
  }
  _recomputeIntentFromKeys(){
    const K = SM.s.keys;
    const k = this.keys;
    const I = this.intent;
    // 双通道绑定：自定义键 + WASD + 方向键 均可移动（修复"电脑端键位有问题"）
    const any = (...codes)=>codes.some(c=>!!k[c]);
    I.up    = any(K.moveUp, 'KeyW', 'ArrowUp');
    I.down  = any(K.moveDown, 'KeyS', 'ArrowDown');
    I.left  = any(K.moveLeft, 'KeyA', 'ArrowLeft');
    I.right = any(K.moveRight, 'KeyD', 'ArrowRight');
    // 射击 = 射击键 或 鼠标按住；不再每次按键覆盖鼠标射击状态（修复鼠标开火被键盘事件吞掉）
    I.shoot = !!(k[K.shoot] || this._mouseShootHold);
  }
  // 设置用：录入下一个按键（返回 Promise）
  listenFor(key){
    return new Promise(resolve=>{
      this._listeningKey = { key, resolve };
    });
  }
  _setTowTarget(clientX, clientY, persist=3){
    // 屏幕坐标 -> 逻辑网格坐标，通过渲染器（2D/3D）的反投影实现
    let gx=null, gy=null;
    const g = this.game;
    if (g.view === 'topdown'){
      // canvas 内坐标
      const n = g.gridN || GRID;
      const rect = g.canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width * n;
      const y = (clientY - rect.top)  / rect.height * n;
      gx = x; gy = y;
    } else if (g.threeRenderer){
      const res = g.threeRenderer.screenToGrid(clientX, clientY);
      if (res){ gx = res.x; gy = res.y; }
    }
    if (gx == null) return;
    const n2 = g.gridN || GRID;
    gx = clamp(gx, 0.5, n2-0.5);
    gy = clamp(gy, 0.5, n2-0.5);
    this.game.towTarget = { x:gx, y:gy, persistence: persist };
    const el = document.getElementById('towTarget');
    if (el){
      // 视觉上直接显示在屏幕坐标
      el.style.left = clientX + 'px'; el.style.top  = clientY + 'px';
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(this._towHideT);
      this._towHideT = setTimeout(()=>el.classList.remove('show'), 1200);
    }
  }
}

/* ============================================================
   TouchController · 虚拟摇杆 / 射击 / 切武器 / 切视角 / 暂停
   所有触控区 ≥ 44x44px，支持多点触控，位置/大小可在设置里改
   ============================================================ */
class TouchController {
  constructor(game){
    this.game = game;
    this.axis = { x:0, y:0 };
    this.firing = false;
    this.lookPadActive = false;
    this.lookLastX = 0; this.lookLastY = 0;

    this.isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints>0);
    if (this.isTouch) document.getElementById('touchUI').classList.add('active');
    this._bind();
  }
  getAxis(){ return this.axis; }

  _bind(){
    const joy = document.getElementById('joystick');
    const stick = document.getElementById('joystickStick');
    const fire = document.getElementById('btnFire');
    const weap = document.getElementById('btnWeapon');
    const view = document.getElementById('btnView');
    const paus = document.getElementById('btnPause');
    const lookPad = document.getElementById('fpLookPad');
    const app = document.getElementById('app');

    let joyTouchId = null;
    const joyRect = ()=> joy.getBoundingClientRect();
    const handleJoyStart = (e)=>{
      const r = joyRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      stick.style.left = (r.width/2) + 'px'; stick.style.top = (r.height/2) + 'px';
      joy.classList.add('active');
      joyTouchId = e.identifier;
      this._updateStick(e.clientX, e.clientY, r);
    };
    const handleJoyMove = (e)=>{
      if (e.identifier !== joyTouchId) return;
      this._updateStick(e.clientX, e.clientY, joyRect());
    };
    const handleJoyEnd = (e)=>{
      if (e.identifier !== joyTouchId) return;
      joyTouchId = null;
      const r = joyRect();
      stick.style.left = (r.width/2)+'px';
      stick.style.top  = (r.height/2)+'px';
      joy.classList.remove('active');
      this.axis.x = 0; this.axis.y = 0;
    };
    joy.addEventListener('touchstart', (e)=>{
      e.preventDefault();
      for (const t of e.changedTouches) handleJoyStart(t);
    }, {passive:false});
    app.addEventListener('touchmove', (e)=>{
      for (const t of e.changedTouches){
        if (t.identifier === joyTouchId) handleJoyMove(t);
      }
    }, {passive:false});
    app.addEventListener('touchend', (e)=>{
      for (const t of e.changedTouches){
        if (t.identifier === joyTouchId) handleJoyEnd(t);
      }
    });
    // 射击 / 切武器 / 切视角 / 暂停 按钮
    const bindHold = (el, onDown, onUp)=>{
      el.addEventListener('touchstart', (e)=>{ e.preventDefault(); AM.vibrate(10); onDown(); }, {passive:false});
      el.addEventListener('touchend',   (e)=>{ e.preventDefault(); onUp(); });
      el.addEventListener('mousedown',  (e)=>{ e.preventDefault(); AM.vibrate(10); onDown(); });
      el.addEventListener('mouseup',    (e)=>{ e.preventDefault(); onUp(); });
      el.addEventListener('mouseleave', (e)=>{ onUp(); });
    };
    bindHold(fire, ()=>this.firing=true, ()=>this.firing=false);
    weap.addEventListener('click', ()=>{ if (this.game.player) { this.game.player.inventory.next(); AM.vibrate(15); } });
    view.addEventListener('click', ()=>{ this.game.cycleView(1); AM.vibrate(20); });
    paus.addEventListener('click', ()=>{
      if (this.game.state === STATE.PLAYING) UI.pause();
      else if (this.game.state === STATE.PAUSED) UI.resume();
    });

    // 右侧视角滑动（第一人称）/ 第三人称转镜头 OR 牵引
    let lookTouchId = null, isTow = false, lastTowT=0;
    lookPad.addEventListener('touchstart', (e)=>{
      e.preventDefault();
      if (this.game.view === 'first' || this.game.view === 'third'){
        for (const t of e.changedTouches){
          lookTouchId = t.identifier;
          this.lookPadActive = true;
          this.lookLastX = t.clientX; this.lookLastY = t.clientY;
          isTow = false; lastTowT = performance.now();
        }
      }
    }, {passive:false});
    app.addEventListener('touchmove', (e)=>{
      for (const t of e.changedTouches){
        if (t.identifier !== lookTouchId) continue;
        if (this.game.view === 'first' || this.game.view === 'third'){
          const dx = t.clientX - this.lookLastX;
          const dy = t.clientY - this.lookLastY;
          this.lookLastX = t.clientX; this.lookLastY = t.clientY;
          const s = 0.006 * SM.s.sensitivity;
          if (this.game.view === 'first'){
            // 第一人称：手指右滑=炮口向右转（与鼠标 1:1 同方向，原逻辑取反已修正）
            this.game.camYaw += dx * s;
            this.game.camPitch = clamp(this.game.camPitch - dy * s, -0.6, 0.5);
          } else {
            // 第三人称：镜头方向固定不随操作旋转，拖拽仍可牵引移动
            if (Math.hypot(dx,dy) > 5 && performance.now() - lastTowT > 80){
              const tgt = this._screenToGridFromTouch(t.clientX, t.clientY, 1.0);
              if (tgt){ this.game.towTarget = tgt; lastTowT = performance.now(); }
            }
          }
        }
      }
    }, {passive:false});
    app.addEventListener('touchend', (e)=>{
      for (const t of e.changedTouches){
        if (t.identifier === lookTouchId){
          lookTouchId = null; this.lookPadActive = false;
          // 短点也可以牵引第三人称；screenToGrid 返回 null 时不赋值以免后续 towTarget.x 空引用
          if (this.game.view === 'third'){
            const tgt = this._screenToGridFromTouch(this.lookLastX, this.lookLastY, 2.0);
            if (tgt){ this.game.towTarget = tgt; }
          }
        }
      }
    });

    // 屏幕旋转提示
    const rh = document.getElementById('rotateHint');
    const closeR = document.getElementById('closeRotateHint');
    if (rh && closeR){
      const check = ()=>{
        const w = window.innerWidth, h = window.innerHeight;
        if (w < 640 && h > w && this.isTouch){ rh.classList.add('show'); }
        else { rh.classList.remove('show'); }
      };
      setTimeout(check, 400);
      window.addEventListener('resize', check);
      window.addEventListener('orientationchange', check);
      closeR.addEventListener('click', ()=>rh.classList.remove('show'));
    }
  }
  _screenToGridFromTouch(cx, cy, persist=2){
    const g = this.game;
    const n = g.gridN || GRID;
    if (g.view === 'topdown'){
      const r = g.canvas.getBoundingClientRect();
      return { x: clamp((cx-r.left)/r.width*n, 0.5, n-0.5), y: clamp((cy-r.top)/r.height*n, 0.5, n-0.5), persistence: persist };
    } else if (g.threeRenderer){
      const res = g.threeRenderer.screenToGrid(cx, cy);
      if (!res) return null;
      return { x: clamp(res.x, 0.5, n-0.5), y: clamp(res.y, 0.5, n-0.5), persistence: persist };
    }
    return null;
  }
  _updateStick(cx, cy, r){
    const centerX = r.left + r.width/2;
    const centerY = r.top  + r.height/2;
    let dx = cx - centerX, dy = cy - centerY;
    const maxR = r.width/2;
    const len = Math.hypot(dx, dy);
    if (len > maxR){ dx *= maxR/len; dy *= maxR/len; }
    const stick = document.getElementById('joystickStick');
    stick.style.left = (r.width/2 + dx) + 'px';
    stick.style.top  = (r.height/2 + dy) + 'px';
    this.axis.x = dx / maxR;
    this.axis.y = dy / maxR;
  }
}

/* ============================================================
   CanvasRenderer · 2D 俯视渲染层（零依赖，现代科幻风）
   只负责从 game 读取数据绘制，绝不修改数据；
   血条/伤害数字/击败特效/烟雾粒子全部在此
   ============================================================ */
class CanvasRenderer {
  constructor(game){
    this.game = game;
    this.c = game.ctx;
    this.trackPhase = 0;
    this.resize();
    window.addEventListener('resize', ()=>this.resize());
  }
  resize(){
    // 保持画布正方形，适配窗口：取 min(宽,高) - 24px，极限 832
    const maxSide = Math.min(window.innerWidth, window.innerHeight) - 24;
    const side = Math.min(832, Math.max(320, maxSide));
    const canvas = this.game.canvas;
    canvas.style.width  = side+'px';
    canvas.style.height = side+'px';
  }
  render(dt){
    const g = this.game;
    const ctx = this.c;
    // 大地图（超强人机）使用更大的逻辑画布，CSS 缩放保持自适应
    const n = g.gridN || GRID;
    const px = n * CELL;
    if (g.canvas.width !== px){ g.canvas.width = px; g.canvas.height = px; }
    const W = px, H = px;
    ctx.clearRect(0,0,W,H);
    // 背景（科幻地板 + 网格光）
    this._drawBackground(ctx, W, H);
    // 修正：START 状态下 game.map / player / enemies 等数据未初始化（startNewGame 尚未执行）
    // 只画静态背景即可，避免后续 `this.game.map.length` 空引用
    if (!g.map){
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.font = '300 18px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,234,255,0.45)';
      ctx.fillText('点击【开始游戏】', W/2, H/2);
      ctx.textAlign = 'left';
      return;
    }
    // 先绘制所有非草丛元素（墙、水、基地、道具、拾取物、坦克车身、子弹、爆炸）
    this._drawMapEntities(ctx, W, H);
    this._drawItemsAndPickups(ctx, W, H);
    this._drawBullets(ctx, W, H);
    this._drawBase(ctx, W, H);
    this._drawEnemies(ctx, W, H);
    this._drawPlayer(ctx, W, H);
    // 草丛：坦克在其中会半透明 -> 放在坦克后
    this._drawGrass(ctx, W, H);
    // 爆炸覆盖层
    this._drawExplosions(ctx, W, H);
    // 粒子（上层）
    this._drawParticles(ctx, W, H);
    // 浮字 + 血条
    this._drawDamageTextsAndBloodbars(ctx, W, H);
    // 引导提示（屏幕层由 CSS toast 负责，此处可以画一个小箭头示意）
  }
  // 懒加载玩家自定义底图（qizhong.jpg）；加载失败静默回落原科幻地板
  _getBgPhoto(){
    if (this._bgPhoto !== undefined) return this._bgPhoto;
    this._bgPhoto = null;
    const im = new Image();
    im.onload = ()=>{ this._bgPhoto = im; };
    im.onerror = ()=>{ this._bgPhoto = null; };
    im.src = encodeURI('qizhong.jpg');
    return null;
  }
  _drawBackground(ctx, W, H){
    const grd = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, W*0.7);
    grd.addColorStop(0, '#0f1840');
    grd.addColorStop(1, '#05081a');
    ctx.fillStyle = grd; ctx.fillRect(0,0,W,H);
    // 玩家自定义关卡底图（qizhong.jpg，40% 透明度，cover 铺满；墙/水/草在其后绘制不受影响）
    const bgImg = this._getBgPhoto();
    if (bgImg){
      const s = Math.max(W/bgImg.naturalWidth, H/bgImg.naturalHeight);
      const dw = bgImg.naturalWidth*s, dh = bgImg.naturalHeight*s;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.drawImage(bgImg, (W-dw)/2, (H-dh)/2, dw, dh);
      ctx.restore();
    }
    // 微妙网格
    ctx.strokeStyle = 'rgba(0,234,255,0.05)';
    ctx.lineWidth = 1;
    const gn = (this.game.gridN || GRID);
    for (let i=1;i<gn;i++){
      const p = i*CELL;
      ctx.beginPath(); ctx.moveTo(p,0); ctx.lineTo(p,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,p); ctx.lineTo(W,p); ctx.stroke();
    }
    // 中心科幻光环
    const t = performance.now()/1000;
    ctx.strokeStyle = 'rgba(192,108,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W/2, H/2, 160 + Math.sin(t*0.8)*18, 0, Math.PI*2); ctx.stroke();
  }
  _toPx(x,y){ return [x*CELL, y*CELL]; }
  _drawMapEntities(ctx){
    const gm = this.game.map;
    // 水面（波光粼粼）
    const t = performance.now()/1000;
    for (const w of gm.waters){
      const [x,y] = this._toPx(w.gx, w.gy);
      const grd = ctx.createLinearGradient(x, y, x+CELL, y+CELL);
      grd.addColorStop(0, '#0a2a4a'); grd.addColorStop(1, '#0d3c60');
      ctx.fillStyle = grd; ctx.fillRect(x,y,CELL,CELL);
      ctx.strokeStyle = 'rgba(0,234,255,0.28)';
      ctx.lineWidth = 1.5;
      for (let i=0;i<2;i++){
        const phase = (t*1.5 + i*1.3 + w.gx*0.4 + w.gy*0.4) % 2;
        ctx.beginPath();
        ctx.moveTo(x+6, y + CELL/2 + Math.sin(phase*Math.PI)*8 + i*12 - 8);
        ctx.quadraticCurveTo(x+CELL/2, y+CELL/2 + Math.cos(phase*Math.PI)*6 + i*12 - 8, x+CELL-6, y+CELL/2 + Math.sin(phase*Math.PI+1)*8 + i*12 - 8);
        ctx.stroke();
      }
    }
    // 砖墙（科幻拼接板：半块斜切 + 高光）
    for (const w of gm.walls){
      if (w.hp <= 0) continue;
      const [x,y] = this._toPx(w.gx, w.gy);
      if (w.type === 'brick'){
        const grd = ctx.createLinearGradient(x,y,x,y+CELL);
        grd.addColorStop(0, '#8a5a3c'); grd.addColorStop(1, '#57392a');
        ctx.fillStyle = grd; ctx.fillRect(x+2,y+2,CELL-4,CELL-4);
        // 分段斜切
        ctx.strokeStyle = 'rgba(255,200,150,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x+2,y+CELL/3); ctx.lineTo(x+CELL-2,y+CELL/3);
        ctx.moveTo(x+CELL/2, y+2); ctx.lineTo(x+CELL/2, y+CELL/3);
        ctx.moveTo(x+2, y+CELL*2/3); ctx.lineTo(x+CELL-2, y+CELL*2/3);
        ctx.moveTo(x+CELL/4, y+CELL/3); ctx.lineTo(x+CELL/4, y+CELL*2/3);
        ctx.moveTo(x+CELL*3/4, y+CELL/3); ctx.lineTo(x+CELL*3/4, y+CELL*2/3);
        ctx.moveTo(x+CELL/2, y+CELL*2/3); ctx.lineTo(x+CELL/2, y+CELL-2);
        ctx.stroke();
        // 高光
        ctx.fillStyle = 'rgba(255,220,180,0.12)';
        ctx.fillRect(x+2, y+2, CELL-4, 4);
      } else {
        // 钢墙：合金装甲 + 能量闪烁
        const pulse = 0.5 + Math.sin(t*3 + w.gx*0.7 + w.gy*0.6)*0.5;
        const grd = ctx.createLinearGradient(x,y,x+CELL,y+CELL);
        grd.addColorStop(0, '#8da4d0'); grd.addColorStop(1, '#40507a');
        ctx.fillStyle = grd; ctx.fillRect(x+2,y+2,CELL-4,CELL-4);
        // 六边形合金格
        ctx.strokeStyle = 'rgba(192,108,255,'+(0.25+pulse*0.3)+')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const cx = x+CELL/2, cy = y+CELL/2, r = CELL*0.35;
        for (let i=0;i<6;i++){
          const a = i*Math.PI/3;
          const px = cx + Math.cos(a)*r, py = cy + Math.sin(a)*r;
          if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath(); ctx.stroke();
        // 四角能量点
        ctx.fillStyle = 'rgba(0,234,255,'+(0.4+pulse*0.5)+')';
        [[6,6],[CELL-6,6],[6,CELL-6],[CELL-6,CELL-6]].forEach(p=>{
          ctx.beginPath(); ctx.arc(x+p[0], y+p[1], 2+pulse, 0, Math.PI*2); ctx.fill();
        });
        // 损伤（hp < 2）
        if (w.hp < 2){
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x+CELL*0.3, y+CELL*0.25, CELL*0.15, CELL*0.15);
          ctx.fillRect(x+CELL*0.55, y+CELL*0.6, CELL*0.12, CELL*0.12);
        }
      }
    }
  }
  _drawGrass(ctx){
    const t = performance.now()/1000;
    for (const g of this.game.map.grasses){
      const [x,y] = this._toPx(g.gx, g.gy);
      // 半透明草丛，用许多绿色短线模拟
      ctx.save();
      ctx.globalAlpha = 0.72;
      // 基底
      ctx.fillStyle = 'rgba(62, 255, 138, 0.09)'; ctx.fillRect(x,y,CELL,CELL);
      // 每格程序化 14 根草
      for (let i=0;i<14;i++){
        const sx = x + ((i*37 + g.gx*13) % CELL);
        const sy = y + ((i*61 + g.gy*23) % CELL);
        const sway = Math.sin(t*2 + i*0.5 + g.gx + g.gy) * 2;
        ctx.strokeStyle = `hsla(${130 + i*3 % 20}, 90%, ${40+i%10}%, 0.9)`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(sx, sy+4); ctx.quadraticCurveTo(sx+sway, sy+2, sx+sway*2, sy-4); ctx.stroke();
      }
      // 动态粒子
      if (SM.s.particles){
        ctx.fillStyle = 'rgba(110,255,160,0.5)';
        for (let i=0;i<3;i++){
          const sx = x + (Math.sin(t*1.2+i*1.3+g.gx)*0.5+0.5)*CELL;
          const sy = y + (Math.cos(t*0.9+i*1.7+g.gy)*0.5+0.5)*CELL;
          ctx.beginPath(); ctx.arc(sx,sy,1.5,0,Math.PI*2); ctx.fill();
        }
      }
      ctx.restore();
    }
  }
  _drawBase(ctx){
    if (!this.game.hasBase) return;   // 基地已移除
    const b = this.game.base;
    if (!b.alive){
      // 废墟：绘制已毁
      const [x,y] = this._toPx(b.x-0.5, b.y-0.5);
      ctx.fillStyle = 'rgba(80,30,30,0.8)'; ctx.fillRect(x+6,y+6,CELL-12,CELL-12);
      ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2;
      ctx.strokeRect(x+6,y+6,CELL-12,CELL-12);
      return;
    }
    const [x,y] = this._toPx(b.x, b.y);
    const t = performance.now()/1000;
    // 外环
    const pulse = 0.6 + Math.sin(t*3)*0.4;
    ctx.save();
    ctx.translate(x,y);
    ctx.fillStyle = '#111';
    // 核心装置：金色圆 + 发光 + 鹰旗纹理（几何）
    ctx.strokeStyle = `rgba(255,211,78,${0.5+pulse*0.4})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0,0, CELL*0.42, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = `rgba(0,234,255,${0.4+pulse*0.3})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0,0, CELL*0.32, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = `rgba(255,211,78,${0.7+pulse*0.3})`;
    ctx.beginPath(); ctx.arc(0,0, CELL*0.14, 0, Math.PI*2); ctx.fill();
    // 星芒
    ctx.strokeStyle = `rgba(255,211,78,${pulse*0.5})`;
    ctx.lineWidth = 1;
    for (let i=0;i<6;i++){
      const a = i*Math.PI/3 + t*0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*CELL*0.18, Math.sin(a)*CELL*0.18);
      ctx.lineTo(Math.cos(a)*CELL*0.4, Math.sin(a)*CELL*0.4);
      ctx.stroke();
    }
    ctx.restore();
  }
  _drawTankBody(ctx, x, y, dir, color, scale=1, opts={}){
    const [px, py] = this._toPx(x, y);
    ctx.save();
    ctx.translate(px, py);
    // 修正：Canvas 坐标系 y 向下，DirectRAD 是数学约定（y 向上），直接使用会差 90°→朝向/炮口与移动及子弹方向不一致
    ctx.rotate(this._dirCanvasRad(dir));
    ctx.scale(scale, scale);
    const s = CELL*0.42;  // 车身边框半长
    // 车身：科幻底盘 + 梯形
    const bodyGrad = ctx.createLinearGradient(0,-s, 0, s);
    bodyGrad.addColorStop(0, this._mix(color,'#fff',0.25));
    bodyGrad.addColorStop(0.5, color);
    bodyGrad.addColorStop(1, this._mix(color,'#000',0.35));
    ctx.fillStyle = bodyGrad;
    this._roundRect(ctx, -s*0.9, -s, s*1.8, s*2, 5); ctx.fill();
    // 履带
    this.trackPhase = (this.trackPhase + 0.05) % 1;
    const trackGrd = ctx.createLinearGradient(0,-s,0,s);
    trackGrd.addColorStop(0,'#2a2a33'); trackGrd.addColorStop(1,'#0a0a10');
    ctx.fillStyle = trackGrd;
    this._roundRect(ctx, -s, -s*1.05, s*0.28, s*2.1, 3); ctx.fill();
    this._roundRect(ctx, s*0.72, -s*1.05, s*0.28, s*2.1, 3); ctx.fill();
    // 履带纹路（滚动）
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    const offset = this.trackPhase * 8;
    for (let i=-1;i<9;i++){
      const yy = -s*0.95 + i*8 + offset;
      ctx.beginPath(); ctx.moveTo(-s, yy); ctx.lineTo(-s*0.72, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s*0.72, yy); ctx.lineTo(s, yy); ctx.stroke();
    }
    // 炮塔：圆形 + 六边形（支持炮塔独立旋转 -- 鼠标瞄准俯视）
    if (opts.turretRad !== undefined){
      // 修正：与车身一致使用 Canvas 角度换算，确保炮管实际指向 = 鼠标瞄准角
      ctx.rotate(this._radCanvasAngle(opts.turretRad) - this._dirCanvasRad(dir));
    }
    ctx.fillStyle = this._mix(color,'#fff',0.2);
    ctx.beginPath(); ctx.arc(0,0, s*0.58, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = opts.noOutline? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i=0;i<6;i++){
      const a = i*Math.PI/3 + Math.PI/6;
      const px2 = Math.cos(a)*s*0.58, py2 = Math.sin(a)*s*0.58;
      if (i===0) ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
    }
    ctx.closePath(); ctx.stroke();
    // 炮管
    ctx.fillStyle = this._mix(color,'#ccc',0.3);
    this._roundRect(ctx, -s*0.11, -s*1.25, s*0.22, s*1.3, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(-s*0.11, -s*1.25, s*0.22, s*1.3);
    // 护盾
    if (opts.shield){
      const ph = 0.5 + Math.sin(performance.now()/150)*0.5;
      ctx.strokeStyle = `rgba(255,211,78,${0.45+ph*0.45})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0,0, s*1.3, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = `rgba(255,211,78,${0.06+ph*0.08})`;
      ctx.beginPath(); ctx.arc(0,0, s*1.3, 0, Math.PI*2); ctx.fill();
    }
    // 出生保护闪烁
    if (opts.protectBlink){
      ctx.globalAlpha = 0.35 + 0.35*Math.abs(Math.sin(performance.now()/80));
      ctx.strokeStyle = '#00eaff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0,0, s*1.35, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 受损冒烟（hp<max 的重型）
    if (opts.damaged){
      const t2 = performance.now()/1000;
      ctx.fillStyle = 'rgba(200,200,200,0.35)';
      for (let i=0;i<3;i++){
        const r = 3 + (t2*20 + i*5) % 12;
        ctx.beginPath(); ctx.arc(-s*0.2 + Math.sin(t2+i)*2, -s*0.5 - r*0.6, r, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }
  _mix(c1, c2, t){
    const a = this._hex(c1), b = this._hex(c2);
    const r = Math.round(a[0]*(1-t)+b[0]*t);
    const g = Math.round(a[1]*(1-t)+b[1]*t);
    const bl = Math.round(a[2]*(1-t)+b[2]*t);
    return `rgb(${r},${g},${bl})`;
  }
  _hex(c){
    if (c.startsWith('#')){
      const s = c.slice(1); const p = s.length===3 ? s.split('').map(x=>x+x).join('') : s;
      return [parseInt(p.slice(0,2),16), parseInt(p.slice(2,4),16), parseInt(p.slice(4,6),16)];
    }
    const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [+m[1],+m[2],+m[3]];
    return [200,200,200];
  }
  _roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }
  // 逻辑方向索引 -> Canvas 旋转角（Canvas y 向下，与数学约定相反）
  _dirCanvasRad(d){ return Math.atan2(DIR_VEC[d][0], -DIR_VEC[d][1]); }
  // 逻辑瞄准角（atan2 结果，y 向下） -> Canvas 旋转角
  _radCanvasAngle(a){ return Math.atan2(Math.cos(a), -Math.sin(a)); }
  _drawPlayer(ctx){
    const p = this.game.player;
    if (!p) return;
    const shieldT = p.invul > 0;
    let col = SM.s.colorblind ? '#66c2ff' : '#3eff8a';
    if (p.invul > 0 && (Math.floor(performance.now()/100) % 2 === 0)) col = '#ffffff';
    // 俯视 + 鼠标瞄准时炮塔独立旋转指向鼠标
    const mouseAim = this.game.input && this.game.input.mouseAimActive;
    const turretRad = (this.game.view === 'topdown' && mouseAim) ? p.aimYaw : undefined;
    // 草丛隐蔽：玩家模型不透明度平滑过渡到 70%
    const alpha = (p.alpha !== undefined) ? p.alpha : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    this._drawTankBody(ctx, p.x, p.y, p.dir, col, 1.0, { shield: shieldT, damaged: p.hp < 6, turretRad });
    // 自定义皮肤贴花（2D 车身区域裁剪绘制）
    if (this.game.skinImg){
      const [px, py] = this._toPx(p.x, p.y);
      ctx.translate(px, py);
      ctx.rotate(this._dirCanvasRad(p.dir));
      ctx.beginPath();
      ctx.rect(-CELL*0.42, -CELL*0.5, CELL*0.84, CELL*0.62);
      ctx.clip();
      ctx.drawImage(this.game.skinImg, -CELL*0.42, -CELL*0.5, CELL*0.84, CELL*0.62);
      ctx.setTransform(1,0,0,1,0,0);
    }
    ctx.restore();
  }
  _drawEnemies(ctx){
    for (const e of this.game.enemies){
      const T = ENEMY_TYPES[e.type];
      let col = T.color;
      if (this.game.globalFreeze > 0){
        col = '#7cc8ff';  // 冻结变蓝
      }
      if (e.dmgFlash > 0) col = '#fff';
      const opts = {
        protectBlink: e.spawnProtect>0,
        damaged: e.hp < e.maxHp
      };
      this._drawTankBody(ctx, e.x, e.y, e.dir, col, e.type==='heavy'?1.15 : (e.type==='fast'?0.92:1.0), opts);
      // 武器持有标记（敌人拿了增强包）
      if (e.weapon !== 'standard'){
        const [px,py] = this._toPx(e.x, e.y);
        ctx.fillStyle = WEAPONS[e.weapon].color;
        ctx.beginPath(); ctx.arc(px, py-CELL*0.55, 4, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  _drawBullets(ctx){
    const drawOne = (b)=>{
      const W = b.def;
      const [x,y] = this._toPx(b.x, b.y);
      if (b.isBeam){
        // 光束：从起点画到当前点/稍前方
        const len = CELL * 1.6;
        const ang = Math.atan2(b.vy, b.vx);
        const x2 = x + Math.cos(ang)*len, y2 = y + Math.sin(ang)*len;
        const col = W.color;
        const grd = ctx.createLinearGradient(x,y,x2,y2);
        grd.addColorStop(0, col); grd.addColorStop(1, this._mix(col,'#fff',0.5));
        ctx.strokeStyle = grd;
        ctx.lineWidth = Math.max(2, W.size*1.3);
        ctx.lineCap = 'round';
        ctx.shadowBlur = 12; ctx.shadowColor = col;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x2,y2); ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (W.type === 'rocket'){
        // 火箭弹 + 火焰尾迹
        const ang = Math.atan2(b.vy, b.vx);
        for (let i=0;i<6;i++){
          const t = i/6;
          ctx.fillStyle = `rgba(${255},${160 - i*18},${80},${1-t})`;
          const rr = 4 - i*0.5;
          const bx = x - Math.cos(ang)*i*4, by = y - Math.sin(ang)*i*4;
          ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI*2); ctx.fill();
        }
        ctx.fillStyle = '#fff8cc';
        ctx.beginPath(); ctx.arc(x,y, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = W.color;
        ctx.beginPath(); ctx.arc(x,y, 3.5, 0, Math.PI*2); ctx.fill();
      } else {
        const col = b.colorHint || W.color;
        ctx.shadowBlur = 10; ctx.shadowColor = col;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x,y, Math.max(2, W.size*0.7), 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x,y, Math.max(1, W.size*0.3), 0, Math.PI*2); ctx.fill();
      }
    };
    for (const b of this.game.bullets) drawOne(b);
    for (const b of this.game.enemyBullets) drawOne(b);
  }
  _drawItemsAndPickups(ctx){
    const t = performance.now()/1000;
    for (const pk of this.game.pickups){
      const W = WEAPONS[pk.key];
      const [x,y] = this._toPx(pk.x, pk.y);
      const pulse = 0.5 + 0.5*Math.sin(t*4 + pk.flash);
      ctx.save();
      ctx.translate(x,y);
      // 光环
      ctx.globalAlpha = 0.35 + pulse*0.4;
      ctx.fillStyle = W.color;
      ctx.beginPath(); ctx.arc(0,0, CELL*0.45, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
      const grd = ctx.createRadialGradient(0,0,2,0,0,CELL*0.3);
      grd.addColorStop(0, '#fff'); grd.addColorStop(0.3, W.color); grd.addColorStop(1, this._mix(W.color,'#000',0.4));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0,0, CELL*0.3, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(W.icon, 0, 1);
      ctx.restore();
    }
    for (const it of this.game.items){
      const I = ITEMS[it.kind];
      const [x,y] = this._toPx(it.x, it.y);
      const bob = Math.sin(t*3 + it.age*3)*3;
      ctx.save();
      ctx.translate(x, y+bob);
      ctx.rotate(t*1.2);
      ctx.fillStyle = 'rgba(12,18,48,0.8)';
      this._roundRect(ctx, -CELL*0.3, -CELL*0.3, CELL*0.6, CELL*0.6, 6); ctx.fill();
      ctx.strokeStyle = I.color; ctx.lineWidth = 2;
      this._roundRect(ctx, -CELL*0.3, -CELL*0.3, CELL*0.6, CELL*0.6, 6); ctx.stroke();
      ctx.rotate(-t*1.2);
      ctx.font = '24px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(I.icon, 0, 1);
      ctx.restore();
    }
  }
  _drawExplosions(ctx){
    for (const ex of this.game.explosions){
      const [x,y] = this._toPx(ex.x, ex.y);
      const t2 = ex.age / ex.life;
      if (ex.kind === 'rocket'){
        const R = ex.r * CELL * (0.3 + t2*1.1);
        const grd = ctx.createRadialGradient(x,y,2, x,y,R);
        grd.addColorStop(0, 'rgba(255,255,255,'+(1-t2)+')');
        grd.addColorStop(0.2, 'rgba(255,180,60,'+(1-t2*0.8)+')');
        grd.addColorStop(0.6, 'rgba(255,60,40,'+(0.7-t2*0.6)+')');
        grd.addColorStop(1, 'rgba(20,0,0,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = `rgba(255,211,78,${1-t2})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x,y,R*0.95,0,Math.PI*2); ctx.stroke();
      } else if (ex.kind === 'shock'){
        const R = ex.r * CELL * t2;
        ctx.strokeStyle = `rgba(0,234,255,${1-t2})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle = `rgba(255,211,78,${(1-t2)*0.6})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x,y,R*1.3,0,Math.PI*2); ctx.stroke();
      } else if (ex.kind === 'base'){
        const R = ex.r * CELL * (0.2 + t2*1.4);
        const grd = ctx.createRadialGradient(x,y,4, x,y,R);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.4, 'rgba(255,80,40,0.9)');
        grd.addColorStop(1, 'rgba(60,0,0,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2); ctx.fill();
      } else {
        // normal / heavy
        const R = ex.r * CELL * (0.3 + t2*1.2);
        const coef = ex.kind==='heavy' ? 1.4 : 1;
        const grd = ctx.createRadialGradient(x,y,2, x,y,R);
        grd.addColorStop(0, 'rgba(255,255,200,'+(1-t2)+')');
        grd.addColorStop(0.3, `rgba(255,140,60,${0.9-t2*0.7})`);
        grd.addColorStop(0.7, `rgba(255,50,30,${0.5-t2*0.4})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x,y,R*coef,0,Math.PI*2); ctx.fill();
      }
    }
  }
  _drawParticles(ctx){
    if (!SM.s.particles) return;
    for (const p of this.game.fxParticles){
      const alpha = 1 - (p.age||0)/p.life;
      const [x,y] = this._toPx(p.x, p.y);
      ctx.globalAlpha = Math.max(0,alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(x-p.size/2, y-p.size/2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
  _drawDamageTextsAndBloodbars(ctx){
    // 伤害数字
    for (const d of this.game.damageTexts){
      const alpha = 1 - d.age/d.life;
      const [x,y] = this._toPx(d.x, d.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0,alpha);
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(d.text, x, y);
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, x, y);
      ctx.restore();
    }
    // 血条（命中后 1.5 秒内显示，颜色随生命变化：绿→黄→红）
    for (const e of this.game.enemies){
      if (e.hp <= 0) continue;
      if (e.hitShowTime <= 0 && e.hp >= e.maxHp) continue;
      if (e.hitShowTime <= 0 && e.hp < e.maxHp && false) continue; // 平时不显示
      if (e.hitShowTime <= 0) continue;  // 补丁：只有被击中才显示
      const [x,y] = this._toPx(e.x, e.y - e.radius - 0.35);
      const w = CELL*0.8, h = 6;
      const ratio = clamp(e.hp / e.maxHp, 0, 1);
      const color = ratio > 0.6 ? '#3eff8a' : (ratio > 0.3 ? '#ffd34e' : '#ff4d4d');
      if (SM.s.colorblind){
        // 色盲：用形状+明暗区分（保持颜色也调整）
        const col2 = ratio > 0.6 ? '#66c2ff' : (ratio > 0.3 ? '#ffdf80' : '#ff9000');
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x-w/2-2, y-h/2-2, w+4, h+4);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x-w/2, y-h/2, w, h);
        ctx.fillStyle = col2; ctx.fillRect(x-w/2, y-h/2, w*ratio, h);
        // 加形状标记：绿色=圆/黄色=方/红色=三角
        ctx.fillStyle = col2;
        ctx.beginPath();
        if (ratio>0.6) ctx.arc(x-w/2-8, y, 3, 0, Math.PI*2);
        else if (ratio>0.3) ctx.rect(x-w/2-11,y-3,6,6);
        else { ctx.moveTo(x-w/2-8,y-4); ctx.lineTo(x-w/2-4,y+4); ctx.lineTo(x-w/2-12,y+4); }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x-w/2-2, y-h/2-2, w+4, h+4);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x-w/2, y-h/2, w, h);
        ctx.fillStyle = color; ctx.fillRect(x-w/2, y-h/2, w*ratio, h);
      }
    }
    // 玩家受击显示自身血条不用画（HUD有）
  }
}

/* ============================================================
   ThreeRenderer · Three.js 3D 渲染层（第一/第三人称共用）
   渲染时把 2D 逻辑网格直接映射到 XZ 平面（1格=1世界单位，格坐标 0~13 -> 世界 -6.5~+6.5）
   同一个场景/渲染器实例在"激活/停用"之间切换，避免每次切视角重建资源
   ============================================================ */
class ThreeRenderer {
  constructor(game){
    this.game = game;
    this.activated = false;
    this.view = null;        // 'first' or 'third'
    this.container = document.getElementById('three-container');
    this.initThree();
    this.tankVisuals = new Map();    // logic -> THREE.Group
    this.bulletVisuals = new Map();
    this.wallVisuals = [];
    this.baseVisual = null;
    this.pickupVisuals = new Map();
    this.itemVisuals = new Map();
    this.particles = [];             // 简单 3D 粒子
    this.muzzleFlashTimer = 0;
    this.applyQuality();
    window.addEventListener('resize', ()=>this._onResize());
  }
  initThree(){
    const t0 = performance.now();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1030);
    this.scene.fog = new THREE.Fog(0x0a1030, 14, 32);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.camera.position.set(0, 18, 12);
    this.camera.lookAt(0, 0, 0);

    // 灯光：方向光 + 环境光 + 两个点光源
    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.dirLight.position.set(10, 18, 8);
    this.scene.add(this.dirLight);
    this.amb = new THREE.AmbientLight(0x445080, 0.7);
    this.scene.add(this.amb);
    this.pl1 = new THREE.PointLight(0x00eaff, 0.9, 20, 1.8); this.pl1.position.set(-6, 3, -6); this.scene.add(this.pl1);
    this.pl2 = new THREE.PointLight(0xff3d7f, 0.9, 20, 1.8); this.pl2.position.set( 6, 3,  6); this.scene.add(this.pl2);

    // 渲染器（开启抗锯齿减少边缘锯齿，像素比上限 2 兼顾清晰度与 60FPS 性能）
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference:'high-performance', alpha:false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // 修正：SRGBColorSpace 在低版本 UMD/min.js 中可能未命名导出，加兜底字符串以防止 undefined 导致色彩空间抛错
    this.renderer.outputColorSpace = (typeof THREE.SRGBColorSpace !== 'undefined') ? THREE.SRGBColorSpace : 'srgb';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    // 地面
    this._buildGround();
    this._onResize();
  }
  applyQuality(){
    if (!this.renderer) return;
    const q = SM.s.quality;
    const dpr = q==='low' ? 0.6 : (q==='mid'? Math.min(1.25, window.devicePixelRatio||1) : Math.min(1.75, window.devicePixelRatio||1.75));
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = (q!=='low');
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.dirLight) this.dirLight.castShadow = (q!=='low');
    this._onResize();
    // 泛光模拟：在 Canvas 后置处理成本过高；这里用更亮的光 + 半透明 self-illuminated 材质模拟（未用 UnrealBloom 以避免额外 examples 依赖）
  }
  _onResize(){
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
  }
  // 逻辑网格坐标 -> 世界 XZ（支持超强人机大地图）
  _gridSize(){ return this.game.gridN || GRID; }
  grid2world(x, y, z=0){
    const half = this._gridSize()/2;
    return new THREE.Vector3(x - half, z, y - half);
  }
  world2grid(v){ const half = this._gridSize()/2; return { x: v.x + half, y: v.z + half }; }
  // 逻辑朝向索引 -> Three.js rotation.y（坦克模型局部正前方为 -Z）
  _gridDirToWorldYaw(d){ return Math.atan2(-DIR_VEC[d][0], -DIR_VEC[d][1]); }
  // 逻辑瞄准角 a（子弹速度 cos/sin 约定） -> 世界 yaw
  _aimRadToWorldYaw(a){ return Math.atan2(-Math.cos(a), -Math.sin(a)); }
  // 屏幕坐标 -> 逻辑网格（射线与 y=0.5 平面相交）
  screenToGrid(clientX, clientY){
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    // 与 y=0 平面求交（坦克在地面）
    const nd = new THREE.Vector3(0,1,0);
    const no = new THREE.Vector3(0,0.1,0);
    const d = ray.ray.direction, o = ray.ray.origin;
    const denom = d.dot(nd);
    if (Math.abs(denom) < 1e-6) return null;
    const t = (no.clone().sub(o)).dot(nd) / denom;
    if (t < 0) return null;
    const p = o.clone().add(d.multiplyScalar(t));
    return this.world2grid(p);
  }
  activate(view){
    this.view = view;
    this.activated = true;
    // 每次 activate 都强制重新构建静态地图（先清空再重建）
    this._clearStaticMap();
    // 大地图（超强人机）地面尺寸不同：若边长变化则重建地面/围栏
    const n = this._gridSize();
    if (this._groundBuiltFor !== n){
      const olds = [];
      this.scene.traverse(o=>{ if (o.userData && o.userData.$ground) olds.push(o); });
      for (const g of olds){ try{ this.scene.remove(g); }catch(e){} }
      this._buildGround();
      this._groundBuiltFor = n;
    }
    this._buildStaticMap();
    this._onResize();
    this._refreshViewCamera();
  }
  deactivate(){
    this.activated = false;
    if (document.pointerLockElement) document.exitPointerLock && document.exitPointerLock();
  }
  muzzleFlash(){ this.muzzleFlashTimer = 0.08; }

  /* --- 清理静态地图（过关/重开前重置墙、拾取物、物品、粒子、坦克缓存） --- */
  _clearStaticMap(){
    // 墙体组：整体移除（墙体/水/草都挂在 wallGroup 下，单个 scene.remove 无效）
    if (this._wallGroup){
      try{ this.scene.remove(this._wallGroup); }catch(e){}
      this._wallGroup = null;
    }
    this.wallVisuals.length = 0;
    // 基地
    if (this.baseVisual){
      if (this.baseVisual.group){ try{ this.scene.remove(this.baseVisual.group); }catch(e){} }
      this.baseVisual = null;
    }
    // 拾取物/道具缓存
    for (const [k, v] of this.pickupVisuals){ try{ this.scene.remove(v); }catch(e){} }
    this.pickupVisuals.clear();
    for (const [k, v] of this.itemVisuals){ try{ this.scene.remove(v); }catch(e){} }
    this.itemVisuals.clear();
    // 子弹缓存
    for (const [k, v] of this.bulletVisuals){ try{ this.scene.remove(v); }catch(e){} }
    this.bulletVisuals.clear();
    // 坦克缓存
    for (const [k, v] of this.tankVisuals){ try{ this.scene.remove(v); }catch(e){} }
    this.tankVisuals.clear();
    // 3D 粒子
    for (const p of this.particles){ try{ this.scene.remove(p.mesh); }catch(e){} }
    this.particles.length = 0;
    // 注意：地面 + 霓虹围栏（$ground）是静态背景，不随关卡变化，保留不删。
    // 之前这里把地面删掉后 _buildStaticMap 从不重建 → 场景只剩黑雾 = 3D 黑屏的根因，已修复。
  }

  /* --- 静态地图一次性构建 --- */
  _buildGround(){
    // 科幻地板：程序化材质 + 网格光（尺寸随地图边长）
    const size = this._gridSize() + 2;
    // 地面重建代次：异步纹理回来时若已重建过，直接丢弃，避免重叠平面 z-fighting
    const buildId = (this._groundBuildId = (this._groundBuildId||0) + 1);
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const cx = c.getContext('2d');
    const g = cx.createLinearGradient(0,0,512,512);
    g.addColorStop(0,'#152155'); g.addColorStop(1,'#070a1d');
    cx.fillStyle = g; cx.fillRect(0,0,512,512);
    // 发光网格
    cx.strokeStyle = 'rgba(0,234,255,0.28)'; cx.lineWidth = 3;
    for (let i=0;i<=8;i++){ const p=i*64; cx.beginPath(); cx.moveTo(p,0); cx.lineTo(p,512); cx.stroke(); cx.beginPath(); cx.moveTo(0,p); cx.lineTo(512,p); cx.stroke(); }
    // 随机装饰点
    for (let i=0;i<80;i++){ cx.fillStyle = `rgba(${192+randInt(0,63)},${108+randInt(0,60)},${255},${rand(0.08,0.22)})`;
      cx.beginPath(); cx.arc(randInt(0,512), randInt(0,512), rand(1,3), 0, Math.PI*2); cx.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3,3);
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map:tex, roughness:0.8, metalness:0.1 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI/2;
    m.receiveShadow = true;
    m.userData.$ground = true;
    this.scene.add(m);

    // 玩家自定义关卡底图（qizhong.jpg，40% 透明度）：薄照片层贴在地板之上、水面(y=0.05)之下
    const expectKey = this.game.gridN || GRID;
    try{
      new THREE.TextureLoader().load(encodeURI('qizhong.jpg'), (tex)=>{
        if (buildId !== this._groundBuildId) return;  // 地面已重建，丢弃过期回调（防止重叠平面）
        if ((this.game.gridN || GRID) !== expectKey) return;  // 地图尺寸已变
        tex.anisotropy = 4;
        try{ tex.colorSpace = THREE.SRGBColorSpace; }catch(e){}
        const photoMat = new THREE.MeshBasicMaterial({ map:tex, transparent:true, opacity:0.4, depthWrite:false });
        const photo = new THREE.Mesh(new THREE.PlaneGeometry(size, size), photoMat);
        photo.rotation.x = -Math.PI/2;
        photo.position.y = 0.02;
        photo.userData.$ground = true;
        this.scene.add(photo);
      });
    }catch(e){}

    // 边界霓虹围栏（尺寸随地图边长）
    const geo2 = new THREE.BoxGeometry(size-0.6, 0.5, 0.1);
    const mat2 = new THREE.MeshStandardMaterial({ color: 0x00eaff, emissive:0x00eaff, emissiveIntensity:1.1, roughness:0.3, metalness:0.6 });
    const fence = new THREE.Group();
    fence.userData.$ground = true;
    for (let i=0;i<4;i++){
      const edge = new THREE.Mesh(geo2, mat2.clone());
      const L = size/2 - 1;
      if (i===0){ edge.position.set(0, 0.25, -L); }
      else if (i===1){ edge.position.set(0, 0.25, L); }
      else if (i===2){ edge.rotation.y = Math.PI/2; edge.position.set(-L, 0.25, 0); }
      else { edge.rotation.y = Math.PI/2; edge.position.set(L, 0.25, 0); }
      fence.add(edge);
    }
    this.scene.add(fence);
  }
  _buildStaticMap(){
    const gm = this.game.map;
    const wallGroup = new THREE.Group();
    // 砖墙
    const brickTex = this._canvasTex(512, (ctx)=>{
      ctx.fillStyle = '#7b4a2e'; ctx.fillRect(0,0,512,512);
      ctx.strokeStyle = 'rgba(255,180,120,0.6)'; ctx.lineWidth = 2;
      for (let y=0;y<512;y+=64) for (let x=0;x<512;x+=64){
        ctx.strokeRect(x+((y/64)%2?32:0), y, 64, 32);
        ctx.strokeRect(x+((y/64)%2?32:0), y+32, 64, 32);
      }
      ctx.fillStyle = 'rgba(255,200,150,0.1)'; ctx.fillRect(0,0,512,6);
    });
    const steelTex = this._canvasTex(256, (ctx)=>{
      const g = ctx.createLinearGradient(0,0,256,256);
      g.addColorStop(0,'#9cb4dc'); g.addColorStop(1,'#3a4a76'); ctx.fillStyle=g; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(192,108,255,0.6)'; ctx.lineWidth = 2;
      for (let i=0;i<8;i++){
        ctx.beginPath(); ctx.arc(128,128, 30+i*14, 0, Math.PI*2); ctx.stroke();
      }
    });
    const waterTex = this._canvasTex(256, (ctx)=>{
      const g = ctx.createLinearGradient(0,0,256,256);
      g.addColorStop(0,'#082848'); g.addColorStop(1,'#124d7e'); ctx.fillStyle=g; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(0,234,255,0.35)'; ctx.lineWidth = 2;
      for (let i=0;i<16;i++){
        ctx.beginPath();
        for (let x=0;x<=256;x+=16){
          const y = 16 + i*16 + Math.sin((x+i*20)/40)*4;
          if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
    });
    const grassTex = this._canvasTex(256, (ctx)=>{
      ctx.fillStyle = 'rgba(62,255,138,0.06)'; ctx.fillRect(0,0,256,256);
      ctx.strokeStyle = 'rgba(62,255,138,0.7)';
      for (let i=0;i<260;i++){
        const x = randInt(0,255), y = randInt(0,255);
        ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+2, y-4, x-2, y-10); ctx.stroke();
      }
    });
    this._wallMatBrick = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.75, metalness: 0.08 });
    this._wallMatSteel = new THREE.MeshStandardMaterial({ map: steelTex, roughness: 0.45, metalness: 0.7, emissive: 0x202050 });
    this._waterMat = new THREE.MeshStandardMaterial({ map: waterTex, transparent:true, opacity:0.92, metalness:0.4, roughness:0.2 });
    this._grassMat = new THREE.MeshStandardMaterial({ map: grassTex, transparent:true, opacity:0.75, side: THREE.DoubleSide, depthWrite:false });

    for (const w of gm.walls){
      const isSteel = w.type === 'steel';
      const geo = new THREE.BoxGeometry(1, isSteel ? 1.0 : 0.8, 1);
      const mesh = new THREE.Mesh(geo, isSteel ? this._wallMatSteel : this._wallMatBrick);
      const p = this.grid2world(w.gx+0.5, w.gy+0.5, isSteel ? 0.5 : 0.4);
      mesh.position.copy(p);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { type:'wall', logic:w };
      wallGroup.add(mesh);
      this.wallVisuals.push(mesh);
    }
    for (const w of gm.waters){
      const geo = new THREE.PlaneGeometry(1,1);
      const mesh = new THREE.Mesh(geo, this._waterMat);
      const p = this.grid2world(w.gx+0.5, w.gy+0.5, 0.05);
      mesh.rotation.x = -Math.PI/2;
      mesh.position.copy(p);
      wallGroup.add(mesh);
    }
    for (const g of gm.grasses){
      const geo = new THREE.PlaneGeometry(1,1);
      const mesh = new THREE.Mesh(geo, this._grassMat);
      const p = this.grid2world(g.gx+0.5, g.gy+0.5, 0.15);
      mesh.rotation.x = -Math.PI/2;
      mesh.position.copy(p);
      wallGroup.add(mesh);
    }
    this.scene.add(wallGroup);
    this._wallGroup = wallGroup;

    // 基地（已按玩家要求移除：不再建造基地模型）
    if (this.game.hasBase){
      const baseGroup = new THREE.Group();
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 12, 40), new THREE.MeshStandardMaterial({ color:0xffd34e, emissive:0xffd34e, emissiveIntensity:1.3, metalness:0.7, roughness:0.2 }));
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.03, 10, 32), new THREE.MeshStandardMaterial({ color:0x00eaff, emissive:0x00eaff, emissiveIntensity:1.3, metalness:0.6, roughness:0.3 }));
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 1), new THREE.MeshStandardMaterial({ color:0xffd34e, emissive:0xffa040, emissiveIntensity:1.4, metalness:0.8, roughness:0.2 }));
      ring1.rotation.x = Math.PI/2; ring2.rotation.x = Math.PI/2;
      baseGroup.add(ring1); baseGroup.add(ring2); baseGroup.add(core);
      const basePos = this.grid2world(this.game.base.x, this.game.base.y, 0.5);
      baseGroup.position.copy(basePos);
      this.scene.add(baseGroup);
      this.baseVisual = { group:baseGroup, ring1, ring2, core };
    }
  }
  _canvasTex(size, drawer){
    const c = document.createElement('canvas'); c.width=c.height=size;
    drawer(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  /* 动态构建坦克视觉（玩家/敌人通用）——高模版本：炮塔/炮管/装饰分段数提升约 2 倍，
     增加斜装甲板、天线、舱盖等《星球大战》工业科幻细节，同时保留卡通感配色 */
  _buildTankVisual(kind, logicRef){
    const g = new THREE.Group();
    const isPlayer = kind==='player';
    let col = isPlayer ? (SM.s.colorblind ? 0x66c2ff : 0x3eff8a) : 0xff7f7f;
    if (!isPlayer){
      col = { normal:0xff7f7f, fast:0xffa040, heavy:0xaa5555, reward:0xffd34e, boss:0xc06cff }[logicRef.type] || 0xff7f7f;
    }
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, metalness:0.55, roughness:0.4, emissive: new THREE.Color(col).multiplyScalar(0.12) });
    const darkMat = new THREE.MeshStandardMaterial({ color:0x1a1a22, roughness:0.85, metalness:0.4 });
    const steelMat = new THREE.MeshStandardMaterial({ color:0x9aa4b8, metalness:0.85, roughness:0.3 });
    // 车身（底盘 + 上装甲，双层工业科幻结构）
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 1.1), bodyMat);
    body.position.y = 0.26; body.castShadow = true; g.add(body);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.9), bodyMat);
    deck.position.y = 0.5; deck.castShadow = true; g.add(deck);
    // 前斜装甲板
    const plateF = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.1, 0.18), bodyMat);
    plateF.position.set(0, 0.42, 0.52); plateF.rotation.x = -0.35; g.add(plateF);
    // 履带（加宽双段，暗金属）
    const tL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 1.22), darkMat); tL.position.set(-0.52, 0.13, 0); tL.castShadow = true; g.add(tL);
    const tR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 1.22), darkMat); tR.position.set( 0.52, 0.13, 0); tR.castShadow = true; g.add(tR);
    // 负重轮细节（两侧各 3 个小轮，增加多边形与工业感）
    const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.26, 12);
    for (let i=0;i<3;i++){
      const wz = -0.38 + i*0.38;
      const wL = new THREE.Mesh(wheelGeo, steelMat); wL.rotation.z = Math.PI/2; wL.position.set(-0.52, 0.09, wz); g.add(wL);
      const wR = new THREE.Mesh(wheelGeo, steelMat); wR.rotation.z = Math.PI/2; wR.position.set( 0.52, 0.09, wz); g.add(wR);
    }
    // 炮塔（10 边柱 + 舱盖，分段数提升）
    const turretGeo = new THREE.CylinderGeometry(0.26, 0.32, 0.26, 10);
    const turret = new THREE.Mesh(turretGeo, bodyMat);
    turret.position.y = 0.66; turret.castShadow = true; g.add(turret);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), steelMat);
    hatch.position.y = 0.82; g.add(hatch);
    // 天线
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), steelMat);
    antenna.position.set(0.14, 1.02, 0.1); antenna.rotation.z = 0.15; g.add(antenna);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color:0x00eaff }));
    antennaTip.position.set(0.22, 1.28, 0.1); g.add(antennaTip);
    // 炮管（挂在炮塔独立子节点，12 边 + 炮口制退器）
    const barrelG = new THREE.Group();
    barrelG.position.y = 0.68;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 1.0, 12), steelMat);
    barrel.rotation.x = Math.PI/2; barrel.position.z = -0.5; barrel.castShadow = true; barrelG.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10), darkMat);
    muzzle.rotation.x = Math.PI/2; muzzle.position.z = -1.0; barrelG.add(muzzle);
    g.add(barrelG);
    // 护盾球体
    const shpere = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16),
      new THREE.MeshBasicMaterial({ color:0xffd34e, transparent:true, opacity:0.15, side:THREE.DoubleSide, depthWrite:false }));
    shpere.visible = false;
    g.add(shpere);
    g.userData = { body, turret, barrelG, shieldMesh: shpere, bodyMat, _lastWeapon: null };
    if (!isPlayer && logicRef.type === 'heavy') g.scale.setScalar(1.12);
    if (!isPlayer && logicRef.type === 'fast')  g.scale.setScalar(0.92);
    if (!isPlayer && logicRef.type === 'boss')  g.scale.setScalar(1.25);
    return g;
  }
  // 第一人称视图模型：屏幕右下方小型炮管，挂在相机上，不遮挡中央战斗视野
  _ensureViewmodel(){
    if (this._viewmodel) return this._viewmodel;
    const vm = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color:0x9aa4b8, metalness:0.85, roughness:0.3 });
    const bodyCol = SM.s.colorblind ? 0x66c2ff : 0x3eff8a;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyCol, metalness:0.55, roughness:0.4, emissive:new THREE.Color(bodyCol).multiplyScalar(0.15) });
    // 炮管（细长短管，位于右下，仅占屏幕边缘）
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.9, 12), steel);
    barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0, -0.55); vm.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10),
      new THREE.MeshStandardMaterial({ color:0x1a1a22, metalness:0.6, roughness:0.5 }));
    muzzle.rotation.x = Math.PI/2; muzzle.position.set(0, 0, -0.98); vm.add(muzzle);
    // 小块炮塔顶部（右下角可见，提供沉浸感）
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 10), bodyMat);
    turret.position.set(0, -0.16, -0.28); vm.add(turret);
    vm.position.set(0.32, -0.30, -0.15);   // 相机空间：右下、略低
    vm.visible = false;
    this.camera.add(vm);
    this.scene.add(this.camera);
    this._viewmodel = vm;
    return vm;
  }
  _updateViewmodel(p){
    const vm = this._ensureViewmodel();
    vm.visible = true;
    // 视图模型随炮口 yaw 做轻微摆动（模拟转向），pitch 微调高低
    vm.rotation.y = 0;   // 固定在屏幕右下角，不随视角转动遮挡画面
    const pitch = clamp(this.game.camPitch, -0.5, 0.4);
    vm.rotation.x = pitch * 0.15;
  }
  // 应用自定义皮肤（车身贴图）
  applySkin(dataURL){
    if (!THREE || !dataURL) return;
    const loader = new THREE.TextureLoader();
    loader.load(dataURL, (tex)=>{
      tex.colorSpace = (typeof THREE.SRGBColorSpace !== 'undefined') ? THREE.SRGBColorSpace : 'srgb';
      tex.anisotropy = 8;
      this._skinTex = tex;
      const pv = this.tankVisuals ? this.tankVisuals.get(this.game.player) : null;
      if (pv && pv.userData.bodyMat){
        pv.userData.bodyMat.map = tex;
        pv.userData.bodyMat.needsUpdate = true;
      }
    });
  }

  /* 渲染入口 */
  render(dt){
    if (!this.activated) return;
    // 更新墙壁（钢墙/砖墙死亡隐藏）
    for (const wv of this.wallVisuals){
      if (wv.userData.type === 'wall'){
        const alive = wv.userData.logic.hp > 0;
        wv.visible = alive;
        if (alive && wv.userData.logic.type === 'steel'){
          const t = performance.now()/1000;
          wv.material.emissiveIntensity = 0.4 + 0.6 * (0.5+0.5*Math.sin(t*3 + wv.userData.logic.gx*0.7 + wv.userData.logic.gy*0.6));
        }
      }
    }
    // 基地旋转动画
    if (this.baseVisual){
      const t = performance.now()/1000;
      this.baseVisual.ring1.rotation.z = t*0.8;
      this.baseVisual.ring2.rotation.z = -t*1.2;
      this.baseVisual.core.rotation.y = t*1.5;
      this.baseVisual.core.rotation.x = t*0.7;
      this.baseVisual.group.visible = !!this.game.base.alive;
    }
    // 玩家视觉
    const p = this.game.player;
    if (p){
      let pv = this.tankVisuals.get(p);
      if (!pv){ pv = this._buildTankVisual('player', p); this.scene.add(pv); this.tankVisuals.set(p, pv); }
      // 应用自定义皮肤（玩家车身贴图，仅在首次创建视觉或换肤时设置）
      if (SM.skinDataURL && !pv.userData._skinApplied){
        pv.userData._skinApplied = true;
        this.applySkin(SM.skinDataURL);
      }
      const w = this.grid2world(p.x, p.y, 0);
      pv.position.set(w.x, 0, w.z);
      // 修正：车身/炮塔世界 yaw 换用正确换算（旧式 -DIR_RAD 导致上下方向前后颠倒 180°）
      const bodyYaw = this._gridDirToWorldYaw(p.dir);
      pv.rotation.y = bodyYaw;
      pv.userData.barrelG.rotation.y = this._aimRadToWorldYaw(p.turretYaw) - bodyYaw;  // 炮塔相对车身
      // 护盾
      if (p.invul > 0){
        pv.userData.shieldMesh.visible = true;
        const s = 1 + Math.sin(performance.now()/120)*0.05;
        pv.userData.shieldMesh.scale.setScalar(s);
      } else pv.userData.shieldMesh.visible = false;
      // 草丛隐蔽：车体材质不透明度平滑过渡到 70%
      const alpha = (p.alpha !== undefined) ? p.alpha : 1;
      // 第一人称：隐藏自身车体（避免炮管/车身遮挡视野），改用屏幕下方小型视图模型
      const fp = (this.view === 'first');
      pv.visible = !fp;
      if (fp){
        this._updateViewmodel(p);
      } else if (this._viewmodel){
        this._viewmodel.visible = false;
      }
      if (!fp){
        pv.traverse(o=>{
          if (o === pv.userData.shieldMesh) return;
          if (o.isMesh && o.material){
            o.material.transparent = true;
            o.material.opacity = alpha;
          }
        });
      }
    }
    // 敌人视觉
    for (const e of this.game.enemies){
      let ev = this.tankVisuals.get(e);
      if (!ev){ ev = this._buildTankVisual('enemy', e); this.scene.add(ev); this.tankVisuals.set(e, ev); }
      const w = this.grid2world(e.x, e.y, 0);
      ev.position.set(w.x, 0, w.z);
      ev.rotation.y = this._gridDirToWorldYaw(e.dir);
      // 出生保护闪烁透明度
      if (e.spawnProtect > 0) {
        ev.visible = (Math.floor(performance.now()/100) % 2 === 0);
      } else ev.visible = true;
      if (this.game.globalFreeze > 0){
        ev.children.forEach(ch=>{ if (ch.material && ch.material.color) ch.material.color.setHex(0x7cc8ff); });
      } else if (e.dmgFlash > 0){
        ev.children.forEach(ch=>{ if (ch.material && ch.material.emissive) ch.material.emissive.setHex(0xffffff); });
      } else {
        // 恢复
        const col = { normal:0xff7f7f, fast:0xffa040, heavy:0xaa5555, reward:0xffd34e }[e.type] || 0xff7f7f;
        if (ev.userData.body.material.color.getHex() !== col){
          ev.userData.body.material.color.setHex(col);
          ev.userData.turret.material.color.setHex(col);
        }
        ev.userData.body.material.emissive.setHex(new THREE.Color(col).multiplyScalar(0.1).getHex());
        ev.userData.turret.material.emissive.setHex(new THREE.Color(col).multiplyScalar(0.1).getHex());
      }
      // 护盾：敌人无护盾
      if (ev.userData.shieldMesh) ev.userData.shieldMesh.visible = false;
      // 武器持有标记（小光点）
      if (e.weapon !== 'standard' && ev.userData._lastWeapon !== e.weapon){
        if (!ev.userData._weaponMarker){
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.08,8,8),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(WEAPONS[e.weapon].color) }));
          m.position.y = 1.1;
          ev.add(m);
          ev.userData._weaponMarker = m;
        } else {
          ev.userData._weaponMarker.material.color.set(WEAPONS[e.weapon].color);
        }
        ev.userData._weaponMarker.visible = true;
      } else if (e.weapon === 'standard' && ev.userData._weaponMarker){
        ev.userData._weaponMarker.visible = false;
      }
      ev.userData._lastWeapon = e.weapon;
    }
    // 移除已不存在敌人视觉
    for (const [k,v] of this.tankVisuals){
      if (k !== this.game.player && !this.game.enemies.includes(k)){
        this.scene.remove(v); this.tankVisuals.delete(k);
      }
    }
    // 子弹
    const allB = [...this.game.bullets, ...this.game.enemyBullets];
    const seen = new Set(allB);
    for (const b of allB){
      let bv = this.bulletVisuals.get(b);
      if (!bv){
        const W = b.def;
        let mesh;
        if (b.isBeam){
          // 细胶囊
          const geo = new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6);
          const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(W.color), transparent:true, opacity:0.9 });
          mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = Math.PI/2;
        } else if (W.type === 'rocket'){
          const group = new THREE.Group();
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.09,10,10), new THREE.MeshBasicMaterial({ color:0xffa040 }));
          group.add(head);
          const trailTex = this._canvasTex(64, ctx=>{
            const grd = ctx.createLinearGradient(0,0,64,0);
            grd.addColorStop(0,'rgba(255,180,80,0)'); grd.addColorStop(1,'rgba(255,200,100,0.9)');
            ctx.fillStyle=grd; ctx.fillRect(0,0,64,64);
          });
          const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.2), new THREE.MeshBasicMaterial({ map:trailTex, transparent:true, depthWrite:false, side:THREE.DoubleSide }));
          trail.position.z = -0.35;   // 尾迹置于弹体后方
          group.add(trail);
          mesh = group;
        } else {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07,8,8), new THREE.MeshBasicMaterial({ color: new THREE.Color(W.color) }));
        }
        // 发光包裹
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(W.color), transparent:true, opacity:0.35, depthWrite:false, blending:THREE.AdditiveBlending }));
        const wrap = new THREE.Group();
        wrap.add(mesh); wrap.add(glow);
        this.scene.add(wrap);
        this.bulletVisuals.set(b, wrap);
        bv = wrap;   // 修正：创建后必须回填局部变量，否则下一行 bv.position 抛 TypeError
      }
      const w = this.grid2world(b.x, b.y, 0.45);
      bv.position.set(w.x, 0.45, w.z);
      if (b.vx || b.vy){
        const ang = Math.atan2(b.vy, b.vx);
        // 修正：胶囊/尾迹主轴为 Z，需绕 Y 转 π/2−ang 才与弹道方向 (cos, sin) 对齐
        bv.rotation.y = Math.PI/2 - ang;
      }
    }
    // 清除已消失子弹视觉
    for (const [k,v] of this.bulletVisuals){
      if (!seen.has(k)){ this.scene.remove(v); this.bulletVisuals.delete(k); }
    }
    // 武器增强包 & 道具
    const pkMap = new Map();
    for (const pk of this.game.pickups){
      let v = this.pickupVisuals.get(pk);
      if (!v){
        const col = new THREE.Color(WEAPONS[pk.key].color);
        const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.3, depthWrite:false, blending:THREE.AdditiveBlending }));
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshStandardMaterial({ color:col, emissive:col, emissiveIntensity:1.2, metalness:0.7, roughness:0.3 }));
        const g = new THREE.Group(); g.add(halo); g.add(core);
        this.scene.add(g); this.pickupVisuals.set(pk, g);
        v = g;   // 修正：创建后回填局部变量
      }
      const w = this.grid2world(pk.x, pk.y, 0.6 + Math.sin(performance.now()/400 + pk.flash)*0.15);
      v.position.set(w.x, w.y, w.z);
      v.rotation.y += dt*2;
      pkMap.set(pk, 1);
    }
    for (const [k,v] of this.pickupVisuals){ if (!pkMap.has(k)){ this.scene.remove(v); this.pickupVisuals.delete(k); } }

    const itmMap = new Map();
    for (const it of this.game.items){
      let v = this.itemVisuals.get(it);
      if (!v){
        const col = new THREE.Color(ITEMS[it.kind].color);
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color:col, emissive:col, emissiveIntensity:1.1, metalness:0.5, roughness:0.3 }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 24), new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.7 }));
        ring.rotation.x = Math.PI/2;
        const g = new THREE.Group(); g.add(mesh); g.add(ring);
        this.scene.add(g); this.itemVisuals.set(it, g);
        v = g;   // 修正：创建后回填局部变量
      }
      const w = this.grid2world(it.x, it.y, 0.5 + Math.sin(performance.now()/350 + it.age*2)*0.15);
      v.position.set(w.x, w.y, w.z);
      v.rotation.y += dt*1.6;
      itmMap.set(it, 1);
    }
    for (const [k,v] of this.itemVisuals){ if (!itmMap.has(k)){ this.scene.remove(v); this.itemVisuals.delete(k); } }

    // 爆炸粒子（简单）
    this._updateFxParticles3D(dt);
    for (const ex of this.game.explosions){
      if (!ex._3d){
        this._explode3D(ex);
        ex._3d = true;
      }
    }

    // 炮口闪光（简易点光源一闪）
    if (this.muzzleFlashTimer > 0){
      this.muzzleFlashTimer -= dt;
      this.pl1.intensity = 2.5;
    } else {
      this.pl1.intensity = 0.9 + 0.1*Math.sin(performance.now()/500);
    }

    // 相机
    this._refreshViewCamera();
    this.renderer.render(this.scene, this.camera);
  }
  _explode3D(ex){
    const R = ex.r;
    const n = Math.floor(28 * (SM.s.particles ? ({low:0.4,mid:0.7,high:1.0}[SM.s.fx]) : 0.25));
    const col = ex.kind==='rocket' ? 0xffa040 : 0xffd34e;
    for (let i=0;i<n;i++){
      const ang = Math.random()*Math.PI*2;
      const up = Math.random()*1.4;
      const sp = rand(2,6);
      const geo = new THREE.BoxGeometry(0.08,0.08,0.08);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent:true, opacity:0.9 });
      const m = new THREE.Mesh(geo, mat);
      const w = this.grid2world(ex.x, ex.y, 0.4);
      m.position.copy(w);
      this.scene.add(m);
      this.particles.push({ mesh:m, vx:Math.cos(ang)*sp, vy:up, vz:Math.sin(ang)*sp, life:rand(0.4,0.9), age:0 });
    }
    // 冲击波环
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.35, 32),
      new THREE.MeshBasicMaterial({ color:0x00eaff, transparent:true, opacity:0.8, side:THREE.DoubleSide, depthWrite:false }));
    ring.rotation.x = -Math.PI/2;
    const w = this.grid2world(ex.x, ex.y, 0.15);
    ring.position.copy(w);
    this.scene.add(ring);
    this.particles.push({ mesh:ring, ring:true, life:0.5, age:0 });
  }
  _updateFxParticles3D(dt){
    // 冲击波环最大扩散倍数：从 scale 1 扩到 targetScale（life 0.5s 内达到）
    const RING_TARGET = 2.0 / 0.3;  // 约 6.7，即最终半径 ≈ 0.35 * 6.7 ≈ 2.3 单位
    for (let i=this.particles.length-1;i>=0;i--){
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life){ this.scene.remove(p.mesh); this.particles.splice(i,1); continue; }
      if (p.ring){
        // 修正：之前调用函数声明在 for 循环之后，非提升函数表达式在严格模式/部分引擎会抛 ReferenceError
        const s = 1 + (p.age/p.life) * RING_TARGET;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = 0.8 * (1 - p.age/p.life);
      } else {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 6*dt;
        p.mesh.rotation.x += dt*8; p.mesh.rotation.y += dt*6;
        p.mesh.material.opacity = (1 - p.age/p.life);
      }
    }
  }

  _refreshViewCamera(){
    if (!this.activated || !this.game.player) return;
    const p = this.game.player;
    const world = this.grid2world(p.x, p.y, 0);
    if (this.view === 'first'){
      // 第一人称：摄像机在坦克炮塔附近，视角方向与炮口/子弹同用 (cos a, sin a) 约定
      const yaw = p.turretYaw;
      const pitch = clamp(this.game.camPitch, -0.5, 0.4);
      this.camera.position.set(world.x, 0.7, world.z);
      // 修正：旧公式 (−sin yaw, −cos yaw) 与弹道 (cos, sin) 差 90° → 准星与炮口不一致
      const lookDir = new THREE.Vector3(Math.cos(yaw)*Math.cos(pitch), Math.sin(pitch), Math.sin(yaw)*Math.cos(pitch));
      this.camera.lookAt(this.camera.position.clone().add(lookDir));
    } else {
      // 第三人称：摄像机位于炮口指向的反方向后上方跟随，yaw 来自 camYaw
      const yaw = this.game.camYaw;
      const dist = 6;
      const height = 4.2;
      const cx = world.x - Math.cos(yaw) * dist;
      const cz = world.z - Math.sin(yaw) * dist;
      const cy = height;
      this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.18);
      // 朝向目标：坦克位置上方一点
      this.camera.lookAt(new THREE.Vector3(world.x, 0.8, world.z));
    }
  }
}

/* ============================================================
   Leaderboard 本地排行榜（每难度前 5）
   ============================================================ */
const LB = {
  KEY:'xhjs_lb_v1',
  all(){ return loadLocal(this.KEY, { low:[], mid:[], high:[], super:[] }); },
  commit(diff, score){
    score = Math.max(0, Math.floor(Number(score)||0));
    const all = this.all();
    all[diff] = all[diff] || [];
    const date = new Date().toISOString().slice(0,10);
    // 防重复：同一难度、同一分数、同一天且已存在相同记录 -> 跳过（避免一局多次提交）
    if (all[diff].some(r => r.score === score && r.date === date)) { this.refresh(); return; }
    all[diff].push({ score, date });
    all[diff].sort((a,b)=>b.score-a.score);
    all[diff] = all[diff].slice(0, 5);
    saveLocal(this.KEY, all);
    this.refresh();
  },
  refresh(){
    const box = document.getElementById('lbContent');
    if (!box) return;
    const all = this.all();
    const diffs = ['low','mid','high','super'];
    let html = '';
    for (const d of diffs){
      html += `<div style="font-weight:700; color:var(--c-accent); margin-top:8px;">${DIFF_NAME[d]}</div>`;
      const rows = all[d] && all[d].length ? all[d] : null;
      if (!rows) html += `<div class="lb-row"><span class="rk">暂无</span><span>暂无战绩</span><span class="val">-</span></div>`;
      else rows.forEach((r,i)=>{
        html += `<div class="lb-row"><span class="rk ${i<3?'top':''}">#${i+1}</span><span>${r.date}</span><span class="val">${r.score}</span></div>`;
      });
    }
    box.innerHTML = html;
  }
};

/* ============================================================
   UI 控制器（菜单/设置/HUD 显示，驱动 game 对象的生命周期）
   ============================================================ */
const UI = {
  game: null,
  hideAllMenus(){
    ['mainMenu','pauseMenu','settingsMenu','helpMenu','resultMenu'].forEach(id=>{
      document.getElementById(id).classList.add('hidden');
    });
  },
  showHUD(){ document.getElementById('hud').style.display='block'; },
  hideHUD(){ document.getElementById('hud').style.display='none'; },
  pause(){
    if (!this.game || this.game.state !== STATE.PLAYING) return;
    this.game.state = STATE.PAUSED;
    document.getElementById('pauseMenu').classList.remove('hidden');
  },
  resume(){
    if (!this.game || this.game.state !== STATE.PAUSED) return;
    this.game.state = STATE.PLAYING;
    document.getElementById('pauseMenu').classList.add('hidden');
  },
  showResult(kind, info){
    const rm = document.getElementById('resultMenu');
    const rt = document.getElementById('resultTitle');
    const rs = document.getElementById('resultSub');
    const rd = document.getElementById('resultDetail');
    const next = document.getElementById('btnResultNext');
    if (kind === 'clear'){
      rt.textContent = '🎉 关卡完成！'; rt.style.color='var(--c-green)';
      rs.textContent = `消灭全部敌人，准备进入第 ${info.level+1} 关`;
      next.textContent = '▶ 下一关'; next.disabled = false;
    } else if (kind === 'victory'){
      rt.textContent = '🏆 恭喜通关！'; rt.style.color='var(--c-gold)';
      rs.textContent = `你已循环通过所有地图，总击杀 ${info.kills}`;
      next.textContent = '▶ 再来一轮'; next.disabled = false;
    } else {
      rt.textContent = '💥 任务失败'; rt.style.color='var(--c-red)';
      rs.textContent = info.reason || '游戏结束';
      next.textContent = '▶ 从第 1 关重新开始'; next.disabled = false;
    }
    rd.innerHTML = `
      <div>关卡：<b style="color:var(--c-accent)">${info.level}</b></div>
      <div>总击杀：<b style="color:var(--c-accent2)">${info.kills}</b></div>
      <div>最终分数：<b style="color:var(--c-gold); font-size:1.4rem; text-shadow:0 0 10px var(--c-gold);">${info.score}</b></div>
    `;
    rm.classList.remove('hidden');
    // 保存排行榜：失败(gameover)与最终胜利(victory)都结算；过关(clear)继续战斗不结算
    if (kind==='gameover' || kind==='victory') LB.commit(this.game.difficulty, this.game.score);
  },
  showToast: (t,c,m)=> game && game.showToast(t,c,m),
  showPerfTip(){
    const e = document.getElementById('perfTip');
    if (!e) return;
    e.classList.add('show');
    setTimeout(()=>e.classList.remove('show'), 3600);
  },
  /* 主设置面板构建（芯片、按键行、各种滑块） */
  buildSettings(){
    const qChip = id => {
      const el = document.getElementById(id);
      const keyMap = { qualityChip:'quality', fxChip:'fx', fontChip:'font', shakeChip:'shake',
        particleChip:'particles', colorblindChip:'colorblind', hapticChip:'haptic' };
      const k = keyMap[id];
      const val = SM.s[k];
      el.querySelectorAll('.chip').forEach(c=>{
        const match = String(c.dataset.v) === String((typeof val==='boolean')?(val?1:0):val);
        c.classList.toggle('active', match);
        c.onclick = ()=>{
          let nv = c.dataset.v;
          if (id==='shakeChip'||id==='particleChip'||id==='colorblindChip'||id==='hapticChip') nv = nv==='1';
          SM.s[k] = nv; SM.commit();
          qChip(id);
          // 画质变更立即应用到 3D
          if (k==='quality' && game && game.threeRenderer) game.threeRenderer.applyQuality();
        };
      });
    };
    ['qualityChip','fxChip','fontChip','shakeChip','particleChip','colorblindChip','hapticChip'].forEach(qChip);
    UI.rebuildQualityChip = ()=>qChip('qualityChip');

    const bindSlider = (id, key, fmt, hintId)=>{
      const el = document.getElementById(id);
      const hint = hintId ? document.getElementById(hintId) : null;
      el.value = SM.s[key];
      const upd = ()=>{
        let v = +el.value;
        if (key==='sensitivity') v = v/100;
        SM.s[key] = (key==='sensitivity' || key==='joySize' || key==='fireSize' || key==='touchAlpha') ? v : v;
        if (hint) hint.textContent = fmt ? fmt(SM.s[key]) : SM.s[key]+'%';
        SM.commit();
      };
      el.addEventListener('input', upd);
      upd();
    };
    bindSlider('volMaster','volMaster', v=>v+'%', 'volMasterVal');
    bindSlider('volMusic','volMusic', v=>v+'%', 'volMusicVal');
    bindSlider('volSfx','volSfx', v=>v+'%', 'volSfxVal');
    bindSlider('sensRange','sensitivity', v=>v.toFixed(2)+'x', 'sensVal');
    bindSlider('joySize','joySize', v=>v+'px', 'joySizeVal');
    bindSlider('fireSize','fireSize', v=>v+'px', 'fireSizeVal');
    bindSlider('touchAlpha','touchAlpha', v=>v+'%', 'touchAlphaVal');

    // 按键行
    this.rebuildKeyRow();

    document.getElementById('btnResetSet').onclick = ()=>{ SM.reset(); this.buildSettings(); };
  },
  rebuildKeyRow(){
    const box = document.getElementById('keyRow');
    box.innerHTML = '';
    const self = this;
    for (const k of Object.keys(DEFAULT_KEYS)){
      const label = KEY_LABELS[k] || k;
      const cur = SM.s.keys[k];
      const item = document.createElement('div');
      item.className = 'kb-item';
      const label2 = k === 'switchWeapon2' && false ? '' : `<span class="name">${label}</span>`;
      item.innerHTML = `${label2}<span class="key">${codeToLabel(cur)}</span>`;
      const keyEl = item.querySelector('.key');
      keyEl.addEventListener('click', async ()=>{
        keyEl.classList.add('listening');
        keyEl.textContent = '按下按键…';
        await self.game.input.listenFor(k);
        keyEl.classList.remove('listening');
      });
      box.appendChild(item);
    }
  },

  /* 开始：主菜单按钮 & 选择组 */
  buildMainMenu(){
    const diffs = document.getElementById('diffChoices');
    const views = document.getElementById('viewChoices');
    diffs.querySelectorAll('button').forEach(b=>{
      b.onclick = ()=>{
        diffs.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        game.difficulty = b.dataset.v;
      };
      if (b.dataset.v === game.difficulty) b.classList.add('active');
    });
    views.querySelectorAll('button').forEach(b=>{
      b.onclick = ()=>{
        views.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        game.view = b.dataset.v;
      };
      if (b.dataset.v === game.view) b.classList.add('active');
    });

    document.getElementById('btnStart').onclick = ()=> UI.startFromMain();
    const btnBoss = document.getElementById('btnBoss');
    if (btnBoss) btnBoss.onclick = ()=>{ AM.resume(); game.startBossMode(); };
    const btnSkin = document.getElementById('btnSkin');
    const skinInput = document.getElementById('skinFileInput');
    if (btnSkin && skinInput){
      btnSkin.onclick = ()=> skinInput.click();
      skinInput.onchange = (ev)=>{
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = ()=>{
          // 居中正方形裁剪并缩放到 256×256，存入 localStorage
          const img = new Image();
          img.onload = ()=>{
            const s = Math.min(img.width, img.height);
            const sx = (img.width - s)/2, sy = (img.height - s)/2;
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const cx = c.getContext('2d');
            cx.drawImage(img, sx, sy, s, s, 0, 0, 256, 256);
            const url = c.toDataURL('image/jpeg', 0.9);
            try{ localStorage.setItem('xhjs_skin', url); }catch(e){ console.warn('皮肤保存失败', e); }
            SM.skinDataURL = url;
            const skinIm = new Image();
            skinIm.onload = ()=>{
              game.skinImg = skinIm;
              if (window.THREE && game.threeRenderer) game.threeRenderer.applySkin(url);
              game.showToast('🎨 皮肤已应用！', 'good', 2200);
              if (confirm('皮肤上传成功，是否立即开始一局超强人机体感新涂装？')){
                game.startBossMode();
              }
            };
            skinIm.src = url;
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
        skinInput.value = '';
      };
    }
    document.getElementById('btnSettings').onclick = ()=>{
      document.getElementById('settingsMenu').classList.remove('hidden');
      UI._backFrom = 'mainMenu';
    };
    document.getElementById('btnHelp').onclick = ()=>{
      document.getElementById('helpMenu').classList.remove('hidden');
      UI._backFrom = 'mainMenu';
    };
    document.getElementById('btnCloseSet').onclick = ()=>{
      document.getElementById('settingsMenu').classList.add('hidden');
      if (UI._backFrom) document.getElementById(UI._backFrom).classList.remove('hidden');
    };
    document.getElementById('btnCloseHelp').onclick = ()=>{
      document.getElementById('helpMenu').classList.add('hidden');
      if (UI._backFrom) document.getElementById(UI._backFrom).classList.remove('hidden');
    };
    // 暂停菜单按钮
    document.getElementById('btnResume').onclick = ()=>UI.resume();
    document.getElementById('btnRestart').onclick = ()=>{ game.restartLevel(); };
    document.getElementById('btnPauseSettings').onclick = ()=>{
      document.getElementById('pauseMenu').classList.add('hidden');
      document.getElementById('settingsMenu').classList.remove('hidden');
      UI._backFrom = 'pauseMenu';
    };
    document.getElementById('btnPauseHelp').onclick = ()=>{
      document.getElementById('pauseMenu').classList.add('hidden');
      document.getElementById('helpMenu').classList.remove('hidden');
      UI._backFrom = 'pauseMenu';
    };
    document.getElementById('btnToMain').onclick = ()=>{ game.quitToMenu(); };
    document.getElementById('btnQuit').onclick = ()=>{
      if (confirm('确认退出游戏？（将返回主菜单）')) game.quitToMenu();
    };
    // 结算
    document.getElementById('btnResultNext').onclick = ()=>{
      if (game.state === STATE.GAME_OVER){
        game.player = null;
        if (game.bossMode) game.startBossMode(); else game.startNewGame(game.difficulty, 'topdown');
        return;
      }
      game.nextLevel();
    };
    document.getElementById('btnResultRestart').onclick = ()=>{
      if (game.state === STATE.GAME_OVER){
        game.player = null;
        if (game.bossMode) game.startBossMode(); else game.startNewGame(game.difficulty, 'topdown');
      }
      else game.restartLevel();
    };
    document.getElementById('btnResultMain').onclick = ()=>{ game.quitToMenu(); };
  },
  startFromMain(){
    AM.resume();   // 补丁条款⑬：启动音频，兼容 iOS（必须在用户点击回调内立即调用）
    const d = (document.querySelector('#diffChoices button.active') || {}).dataset.v || 'mid';
    // 主菜单视角选择已移除：统一以经典俯视开局，游戏内按 V 切换
    game.startNewGame(d, 'topdown');
  },
  _backFrom:'mainMenu'
};
function codeToLabel(code){
  if (!code) return '未绑定';
  const map = { ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→',
    Space:'空格', Enter:'回车', Tab:'Tab', Numpad0:'小0', Digit0:'0',
    Backquote:'`', Escape:'Esc' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/* ============================================================
   初始化
   ============================================================ */
let game = null;
function waitThreeReady(cb, tries=0){
  // 修正：CDN 的 <script> onload 会把 THREE 注入全局，但 onload 可能在本代码执行前或后触发
  // 因此要同时检测三个信号：window.__THREE_READY__、typeof THREE、以及当前 script 元素的 readyState（IE 旧）
  const hasThree = typeof THREE !== 'undefined';
  if (window.__THREE_READY__ || hasThree){
    game.threeEnabled = true;
    if (typeof THREE !== 'undefined') window.THREE = THREE;
    cb();
    return;
  }
  // 查 head 中当前加载的 three 脚本是否加载完成（network idle 视为失败）
  if (window.__THREE_FAIL__ || tries > 35){
    game.threeEnabled = false;
    const bf = document.getElementById('btnFirst'), bt = document.getElementById('btnThird');
    if (bf){ bf.disabled = true; bf.style.opacity = 0.4; bt.disabled = true; bt.style.opacity = 0.4;
      bf.title = 'Three.js CDN 加载失败，3D 模式不可用'; bt.title = bf.title; }
    const st = document.getElementById('threeStatus');
    if (st){ st.textContent = '3D 引擎：加载失败（自动回退 2D 模式，仍可游玩）'; st.style.color = 'var(--c-red)'; }
    cb();
    return;
  }
  setTimeout(()=>waitThreeReady(cb, tries+1), 180);
}
function boot(){
  game = new Game();
  UI.game = game;
  window.game = game;   // 调试用
  game.input = new InputManager(game);
  game.touch = new TouchController(game);
  LB.refresh();
  // 加载自定义皮肤（localStorage 中的上传图片）
  try{
    const skin = localStorage.getItem('xhjs_skin');
    if (skin){
      SM.skinDataURL = skin;
      const im = new Image();
      im.onload = ()=>{ game.skinImg = im; };
      im.src = skin;
    }
  }catch(e){ /* 隐私模式等场景忽略 */ }
  UI.buildSettings();
  UI.buildMainMenu();

  waitThreeReady(()=>{
    if (game.threeEnabled){
      document.getElementById('threeStatus').textContent = '3D 引擎：Three.js 0.152.2 已就绪 ✔';
      document.getElementById('threeStatus').style.color = 'var(--c-green)';
      // 修正：CDN 加载成功后确保 window.THREE 可被 ThreeRenderer 类内部直接使用
      if (typeof THREE !== 'undefined' && !window.THREE) window.THREE = THREE;
    }
    requestAnimationFrame((t)=>game.loop(t));
    // 首次运行设置：帮助引导
    if (SM.s.firstRun){
      SM.s.firstRun = false; SM.commit();
      setTimeout(()=>{
        document.getElementById('helpMenu').classList.remove('hidden');
        UI._backFrom = 'mainMenu';
      }, 600);
    }
  });
}
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// 暴露 UI 方便按键监听调用
window.UI = UI;
})();
