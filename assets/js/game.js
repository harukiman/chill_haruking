/**
 * 追跡者 -HARUKI- (TSUISEKISHA -HARUKI-)
 * 一人称モバイルホラーゲーム
 *
 * A Chilla's Art-style first-person raycasting horror game.
 * Player works at a hotel front desk. Haruki calls asking for towels.
 * Player walks to Room 404 -- nobody inside. Gets attacked from behind.
 * Wakes up in basement utility room. Must escape the hotel while Haruki chases.
 */
(function () {
  'use strict';

  // =========================================================
  //  CONSTANTS
  // =========================================================
  var TS = 48; // tile size (mirrors GameEngine.TILE_SIZE)

  // Tile types
  var TILE = {
    FLOOR: 0,
    WALL: 1,
    DOOR: 2,
    FRONT_DESK: 3,
    ROOM404: 4,
    UTILITY: 5,
    EXIT_DOOR: 6,
    FURNITURE: 7,
    CARPET: 8,
    ELEVATOR: 9,
    WINDOW: 10
  };

  // Which tiles are walkable by default
  var WALKABLE_TILES = {};
  WALKABLE_TILES[TILE.FLOOR] = true;
  WALKABLE_TILES[TILE.DOOR] = true;
  WALKABLE_TILES[TILE.FRONT_DESK] = true;
  WALKABLE_TILES[TILE.ROOM404] = true;
  WALKABLE_TILES[TILE.UTILITY] = true;
  WALKABLE_TILES[TILE.EXIT_DOOR] = true;
  WALKABLE_TILES[TILE.CARPET] = true;
  WALKABLE_TILES[TILE.ELEVATOR] = true;

  // =========================================================
  //  MAP DATA  (30 wide x 40 tall)
  //
  //  Layout:
  //    Rows  0-1   : upper floor top walls
  //    Rows  2-16  : upper floor (rooms + corridor)
  //    Rows 17-19  : stairway transition
  //    Rows 20-21  : ground floor top walls
  //    Rows 22-38  : ground floor (lobby, utility, exit)
  //    Row  39     : ground floor bottom wall
  // =========================================================
  /* eslint-disable comma-spacing, no-multi-spaces */
  // W=1, F=0, D=2, Fd=3, R4=4, U=5, X=6, Fu=7, C=8, E=9, Wi=10
  var W = TILE.WALL,
      F = TILE.FLOOR,
      D = TILE.DOOR,
      Fd = TILE.FRONT_DESK,
      R4 = TILE.ROOM404,
      U = TILE.UTILITY,
      X = TILE.EXIT_DOOR,
      Fu = TILE.FURNITURE,
      C = TILE.CARPET,
      Ev = TILE.ELEVATOR,
      Wi = TILE.WINDOW;

  var MAP_W = 30;
  var MAP_H = 40;

  // prettier-ignore
  var MAP_TILES = [
    // Row 0 -- upper floor top wall
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 1
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 2 -- room tops (401-402 left, 405-406 right)
    [W, Wi, F, F, F, W, Wi, F, F, F, W, W, C, C, C, C, C, C, W, W, Wi, F, F, F, W, Wi, F, F, F, W],
    // Row 3 -- rooms interior
    [W, Wi, F, Fu, F, W, Wi, F, Fu, F, W, W, C, C, C, C, C, C, W, W, Wi, F, Fu, F, W, Wi, F, Fu, F, W],
    // Row 4 -- rooms interior
    [W, F, F, F, F, W, F, F, F, F, W, W, C, C, C, C, C, C, W, W, F, F, F, F, W, F, F, F, F, W],
    // Row 5 -- rooms with doors to corridor
    [W, F, F, F, D, W, F, F, F, D, W, W, C, C, Fu, C, C, C, W, W, D, F, F, F, W, D, F, F, F, W],
    // Row 6 -- corridor (main upper hallway)
    [W, W, W, W, C, W, W, W, W, C, W, W, C, C, C, C, C, C, W, W, C, W, W, W, W, C, W, W, W, W],
    // Row 7 -- corridor
    [W, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, W],
    // Row 8 -- corridor with vending area
    [W, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, W],
    // Row 9 -- rooms bottom side doors (403-404 left, 407-408 right)
    [W, W, W, W, C, W, W, W, W, C, W, W, C, C, C, C, C, C, W, W, C, W, W, W, W, C, W, W, W, W],
    // Row 10 -- rooms (403, 404)
    [W, F, F, F, D, W, F, F, F, D, W, W, C, C, Fu, C, C, C, W, W, D, F, F, F, W, D, F, F, F, W],
    // Row 11
    [W, F, Fu, F, F, W, R4,R4,R4, F, W, W, C, C, C, C, C, C, W, W, F, F, Fu, F, W, F, F, Fu, F, W],
    // Row 12
    [W, F, F, F, F, W, R4, Fu,R4, F, W, W, C, C, C, C, C, C, W, W, F, F, F, F, W, F, F, F, F, W],
    // Row 13
    [W, Wi, F, F, F, W, Wi,R4,R4, F, W, W, C, C, C, C, C, C, W, W, Wi, F, F, F, W, Wi, F, F, F, W],
    // Row 14 -- bottom walls of upper rooms
    [W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, C, C, C, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 15 -- transition hall
    [W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, C, C, C, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 16 -- stairway top
    [W, W, W, W, W, W, W, W, W, W, W, W, C, C, Ev, Ev, C, C, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 17 -- stairway
    [W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, C, C, C, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 18 -- stairway
    [W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, C, C, C, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 19 -- stairway bottom → ground floor
    [W, W, W, W, W, W, W, W, W, W, W, W, C, C, Ev, Ev, C, C, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 20 -- ground floor top wall
    [W, W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, C, W, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 21 -- lobby top
    [W, W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, C, W, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 22 -- lobby corridor
    [W, Wi, F, F, F, F, F, F, F, F, F, F, C, C, C, C, C, C, C, C, F, F, F, F, F, F, F, F, Wi, W],
    // Row 23 -- lobby main area
    [W, F, F, F, F, F, F, F, F, F, F, F, C, C, C, C, C, C, C, C, F, F, F, F, F, F, F, F, F, W],
    // Row 24 -- front desk row
    [W, F, F, F, F, F, Fu, Fu, Fu, F, F, F, C, C, C, C, C, C, C, C, F, F, F, F, Fu, F, F, F, F, W],
    // Row 25 -- front desk (player side)
    [W, F, F, F, F, F, Fd, Fd, Fd, F, F, F, C, C, C, C, C, C, C, C, F, F, F, F, Fu, F, F, F, F, W],
    // Row 26 -- lobby lower
    [W, F, F, F, F, F, F, F, F, F, F, F, C, C, C, C, C, C, C, C, F, F, F, F, F, F, F, F, F, W],
    // Row 27 -- lobby to back hallway
    [W, F, F, F, F, F, F, F, F, F, F, F, C, C, C, C, C, C, C, C, F, F, F, F, F, F, F, F, F, W],
    // Row 28 -- wall separating lobby from back area
    [W, W, W, W, W, W, D, W, W, W, W, W, W, W, W, D, W, W, W, W, W, W, W, W, D, W, W, W, W, W],
    // Row 29 -- back corridor
    [W, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, W],
    // Row 30 -- back corridor
    [W, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, C, W],
    // Row 31 -- utility + storage rooms top walls
    [W, W, W, D, W, W, W, W, W, W, W, D, W, W, W, W, W, W, W, D, W, W, W, W, W, W, W, D, W, W],
    // Row 32 -- rooms
    [W, U, U, U, U, W, F, Fu, F, F, W, F, F, F, Fu, W, F, F, F, F, F, W, F, F, F, W, F, F, F, W],
    // Row 33
    [W, U, Fu, U, U, W, F, F, F, F, W, F, Fu, F, F, W, F, Fu, F, F, F, W, F, Fu, F, W, F, Fu, F, W],
    // Row 34
    [W, U, U, U, U, W, F, F, F, F, W, F, F, F, F, W, F, F, F, Fu, F, W, F, F, F, W, F, F, F, W],
    // Row 35
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    // Row 36 -- exit corridor
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, W],
    // Row 37
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, C, C, C, W],
    // Row 38 -- exit door row
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, C, X, C, W],
    // Row 39 -- bottom wall
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W]
  ];
  /* eslint-enable */

  // =========================================================
  //  DOOR DEFINITIONS
  // =========================================================
  // Doors that can be opened/closed. They start locked or unlocked.
  var doors = [
    // Upper floor room doors
    { gx: 4,  gy: 5,  label: '401', locked: false, open: false },
    { gx: 9,  gy: 5,  label: '402', locked: true,  open: false },
    { gx: 20, gy: 5,  label: '405', locked: true,  open: false },
    { gx: 25, gy: 5,  label: '406', locked: true,  open: false },
    { gx: 4,  gy: 10, label: '403', locked: true,  open: false },
    { gx: 9,  gy: 10, label: '404', locked: true,  open: false }, // Room 404 - key door
    { gx: 20, gy: 10, label: '407', locked: true,  open: false },
    { gx: 25, gy: 10, label: '408', locked: true,  open: false },
    // Ground floor doors
    { gx: 6,  gy: 28, label: 'back1', locked: false, open: false },
    { gx: 15, gy: 28, label: 'back2', locked: false, open: false },
    { gx: 24, gy: 28, label: 'back3', locked: false, open: false },
    // Utility / storage doors
    { gx: 3,  gy: 31, label: 'utility', locked: false, open: false },
    { gx: 11, gy: 31, label: 'storage1', locked: true, open: false },
    { gx: 19, gy: 31, label: 'storage2', locked: true, open: false },
    { gx: 27, gy: 31, label: 'storage3', locked: true, open: false }
  ];

  // Exit door
  var exitDoor = { gx: 27, gy: 38, locked: true, open: false };

  // =========================================================
  //  INTERACTABLES / ITEMS
  // =========================================================
  var interactables = [];
  var keyCardItem = null;

  function resetItems() {
    interactables = [];
    // Key card spawns in a random accessible room during EXPLORE phase
    // We pick from rooms 401, 403, 405, 407 (left/right upper)
    var keyRooms = [
      { gx: 2, gy: 3 },   // 401
      { gx: 2, gy: 12 },  // 403
      { gx: 22, gy: 3 },  // 405
      { gx: 22, gy: 12 }  // 407
    ];
    var pick = keyRooms[Math.floor(Math.random() * keyRooms.length)];
    keyCardItem = {
      gx: pick.gx,
      gy: pick.gy,
      wx: pick.gx * TS + TS / 2,
      wy: pick.gy * TS + TS / 2,
      type: 'keycard',
      collected: false,
      label: 'カードキー',
      glowPhase: 0
    };
    interactables.push(keyCardItem);
    resetMemos();
    resetInventory();
  }

  // =========================================================
  //  ROOM LABELS (for rendering room numbers on walls)
  // =========================================================
  var roomLabels = [
    { gx: 2,  gy: 6,  text: '401' },
    { gx: 7,  gy: 6,  text: '402' },
    { gx: 22, gy: 6,  text: '405' },
    { gx: 27, gy: 6,  text: '406' },
    { gx: 2,  gy: 9,  text: '403' },
    { gx: 7,  gy: 9,  text: '404' },
    { gx: 22, gy: 9,  text: '407' },
    { gx: 27, gy: 9,  text: '408' }
  ];

  // =========================================================
  //  PLAYER ENTITY
  // =========================================================
  var player = {
    x: 0, y: 0,
    w: 20, h: 20,
    speed: 120,
    sprintSpeed: 200,
    angle: Math.PI * 1.5, // facing up (north) initially
    dir: 'down',
    color: '#4488cc',
    stamina: 1.0,
    staminaRecharging: false,
    hasKey: false,
    flashlightRadius: 200,
    flashlightFlicker: 0,
    footstepTimer: 0,
    moving: false
  };

  // =========================================================
  //  HARUKI ENTITY (enemy)
  // =========================================================
  var haruki = {
    x: 0, y: 0,
    w: 24, h: 24,
    speed: 90,         // patrol speed (player walk=120, sprint=200)
    chaseSpeed: 155,    // chase speed — player can outrun with sprint
    dir: 'down',
    color: '#880000',
    sprite: 'assets/img/haruki.png',
    bodyColor: true,
    _bodyR: 35, _bodyG: 30, _bodyB: 40,
    active: false,
    visible: true,
    path: [],
    pathTimer: 0,
    catchRadius: TS * 0.8,
    // AI state: 'patrol' | 'chase' | 'search'
    aiState: 'patrol',
    patrolIndex: 0,
    lastSeenX: 0, lastSeenY: 0,
    searchTimer: 0,
    lostSightTimer: 0,     // time since player last seen during chase
    spotRange: TS * 6      // 6 tiles line-of-sight
  };

  // Patrol waypoints (corridor loop)
  var patrolPoints = [
    { gx: 1, gy: 7 }, { gx: 14, gy: 7 }, { gx: 28, gy: 7 },   // upper corridor
    { gx: 14, gy: 15 }, { gx: 14, gy: 19 },                     // stairway
    { gx: 14, gy: 25 }, { gx: 7, gy: 25 }, { gx: 24, gy: 25 }, // ground floor
    { gx: 14, gy: 30 }, { gx: 7, gy: 30 }, { gx: 24, gy: 30 }, // basement
    { gx: 14, gy: 25 }, { gx: 14, gy: 19 }, { gx: 14, gy: 15 }  // back up
  ];

  // =========================================================
  //  PHASE / STATE MACHINE
  // =========================================================
  var PHASES = {
    TITLE: 'TITLE',
    FRONT_DESK: 'FRONT_DESK',
    PHONE_CALL: 'PHONE_CALL',
    WALK_TO_ROOM: 'WALK_TO_ROOM',
    ENTER_ROOM: 'ENTER_ROOM',
    ATTACK: 'ATTACK',
    WAKE_UP: 'WAKE_UP',
    EXPLORE: 'EXPLORE',
    CHASE_1: 'CHASE_1',
    CHASE_FINAL: 'CHASE_FINAL',
    ENDING: 'ENDING',
    TRUE_ENDING: 'TRUE_ENDING',
    BAD_ENDING: 'BAD_ENDING',
    GAME_OVER: 'GAME_OVER'
  };

  var phase = PHASES.TITLE;
  var phaseTimer = 0;       // seconds elapsed in current phase
  var phaseFlags = {};       // arbitrary phase-local flags

  // =========================================================
  //  GLOBAL GAME STATE
  // =========================================================
  var audioInitialized = false;
  var phoneRinging = false;
  var dialogueActive = false;
  var dialogueQueue = [];
  var creepyEventTimer = 0;
  var visitedTiles = {};     // "gx,gy" → true (for minimap)
  var sprinting = false;
  var actionCallback = null; // function to call when action pressed
  var room404DoorRef = null;
  var unlockingExit = false;
  var unlockTimer = 0;

  // =========================================================
  //  MEMO / DOCUMENT SYSTEM (E1)
  // =========================================================
  var memos = [
    { id: 'memo1', gx: 2, gy: 4, collected: false,
      title: '従業員日誌 — 4月2日',
      text: '404号室の長期滞在客、ハルキ氏。毎晩フロントに来ては話しかけてくる。オネエ口調で馴れ馴れしい。同僚の田中さんが「あの人、目が怖い」と言っていた。気のせいだと思いたい。' },
    { id: 'memo2', gx: 22, gy: 4, collected: false,
      title: '苦情報告書',
      text: '403号室の宿泊客より苦情。「隣の404号室から深夜に女性の歌声が聞こえる。壁を叩いても止まない」。確認したがハルキ氏は男性の一人客。歌声の件を問うと「あら、聞こえちゃった？うふふ」と笑うのみ。' },
    { id: 'memo3', gx: 5, gy: 25, collected: false,
      title: 'ハルキのメモ①',
      text: 'あのフロントの子、今日も可愛かったわぁ♡ いつもあたしを見て怯えた顔するの。その表情がたまらないのよぉ〜。ずっとずっと、見ていたいわ。逃がさないわよ♡' },
    { id: 'memo4', gx: 14, gy: 28, collected: false,
      title: '支配人メモ',
      text: 'ハルキ氏について緊急協議。従業員への付きまとい行為がエスカレート。退去勧告を検討。ただし長期契約のため法的手続きが必要。警察への相談も視野に入れる。' },
    { id: 'memo5', gx: 22, gy: 12, collected: false,
      title: 'ハルキのメモ②',
      text: 'なんで避けるの？ あたしが怖いの？ そんなの悲しいわ... でも大丈夫♡ いつか分かってくれるわ。あたしの愛は本物よ。誰にも渡さない。あたしだけのもの。永遠に♡' },
    { id: 'memo6', gx: 12, gy: 32, collected: false,
      title: '警察報告書',
      text: '被害者：フロント係 ○○（21歳）。加害者：宿泊客ハルキ（年齢不詳）。深夜、被害者の退勤を待ち伏せし暴行。被害者は軽傷。加害者は現場から逃走、現在も行方不明。ホテル地下への逃走経路を確認中。' },
    { id: 'memo7', gx: 3, gy: 33, collected: false,
      title: '整備記録 — 異音調査',
      text: '地下倉庫エリアより異音の報告が複数。「引きずるような足音」「笑い声のような音」。調査したが原因不明。配管の老朽化による共鳴の可能性あり。...本当にそうだろうか。' },
    { id: 'memo8', gx: 20, gy: 32, collected: false,
      title: 'ハルキのメモ③',
      text: 'この暗い部屋は落ち着くわぁ♡ 誰にも邪魔されない。上の世界はうるさすぎるのよ。でもね、寂しいの。次に来てくれる人は、きっとあたしのことを分かってくれるわ♡ だから待ってるの。ずっと、ずっと♡' },
    { id: 'memo9', gx: 25, gy: 25, collected: false,
      title: '閉鎖通知',
      text: '度重なる事件と、加害者の未逮捕を受け、当ホテルは無期限の営業停止とする。地下フロアは封鎖。再開の見通しは立っていない。宿泊客および従業員の安全が確保できない以上、この決定は覆らない。' },
    { id: 'memo10', gx: 7, gy: 7, collected: false,
      title: 'リニューアルオープンのお知らせ',
      text: 'ホテル・シャドウレスト、リニューアルオープン！ 全客室リノベーション済み。「過去の不幸な事件は全て解決済みです。安心してご利用ください」 ——支配人より。...本当に、解決したのだろうか？' }
  ];

  function resetMemos() {
    for (var i = 0; i < memos.length; i++) {
      memos[i].collected = false;
    }
  }

  function getCollectedMemoCount() {
    var count = 0;
    for (var i = 0; i < memos.length; i++) {
      if (memos[i].collected) count++;
    }
    return count;
  }

  function showToast(message) {
    var existing = document.getElementById('gameToast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'gameToast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#e0d8c0;padding:10px 24px;border-radius:6px;font-size:14px;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.4s;border:1px solid rgba(255,220,100,0.3);';
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () { if (toast.parentNode) toast.remove(); }, 500);
      }, 2500);
    });
  }

  // =========================================================
  //  HIDING SYSTEM (G2)
  // =========================================================
  var hideSpots = [
    { gx: 3, gy: 3, label: '401クローゼット' },
    { gx: 21, gy: 3, label: '405クローゼット' },
    { gx: 14, gy: 23, label: 'フロントデスク下' },
    { gx: 8, gy: 25, label: '柱の影' },
    { gx: 12, gy: 33, label: '棚の裏' },
    { gx: 28, gy: 33, label: '箱の陰' }
  ];
  var isHiding = false;
  var hideTimer = 0;
  var maxHideTime = 15;
  var hidingSpotRef = null;

  // =========================================================
  //  INVENTORY / ITEM SYSTEM (G3)
  // =========================================================
  var inventory = {
    bottles: 0,
    memoCount: 0,
    hasPhoto: false
  };

  var bottleSpawns = [
    { gx: 7, gy: 32, collected: false },
    { gx: 17, gy: 33, collected: false },
    { gx: 27, gy: 32, collected: false }
  ];

  var hiddenPhoto = { gx: 14, gy: 18, found: false };

  function resetInventory() {
    inventory.bottles = 0;
    inventory.memoCount = 0;
    inventory.hasPhoto = false;
    for (var i = 0; i < bottleSpawns.length; i++) {
      bottleSpawns[i].collected = false;
    }
    hiddenPhoto.found = false;
  }

  // =========================================================
  //  RANDOM EVENT SYSTEM (E2)
  // =========================================================
  var randomEvents = {
    lastEventTime: 0,
    minInterval: 25,
    maxInterval: 45,
    nextEventTime: 0,
    events: [
      'tv_flicker',
      'elevator_sound',
      'door_slam',
      'blackout',
      'distant_footstep',
      'phone_ring'
    ]
  };

  function initRandomEvents() {
    randomEvents.lastEventTime = 0;
    randomEvents.nextEventTime = randomEvents.minInterval + Math.random() * (randomEvents.maxInterval - randomEvents.minInterval);
  }

  // =========================================================
  //  GAME TIMER & DYNAMIC DIFFICULTY (G4)
  // =========================================================
  var gameTimer = 0;
  var badEndingTriggered = false;
  var difficultySpeedBoosts = 0;
  var difficultyRangeBoosts = 0;
  var blackoutEventTriggered = false;

  // =========================================================
  //  AI SOUND DETECTION (G1)
  // =========================================================
  var harukiAlertLevel = 0;
  var noiseTimer = 0;

  // =========================================================
  //  VISION CONE (G1-3)
  // =========================================================
  var harukiFacingAngle = 0; // radians

  // =========================================================
  //  PLAYER MONOLOGUE SYSTEM (E5)
  // =========================================================
  var monologueTimer = 0;
  var nextMonologueTime = 60;

  // =========================================================
  //  PROXIMITY WHISPER SYSTEM (E5)
  // =========================================================
  var whisperTimer = 0;
  var whisperCooldown = 0;

  // =========================================================
  //  SCRIPTED EVENT FLAGS (E3)
  // =========================================================
  var scriptedEvents = {
    room404WallText: false,
    wakeUpBlurry: false,
    wakeUpBlurTimer: 0,
    wakeUpStagger: false,
    wakeUpStaggerTimer: 0,
    keyCardStinger: false,
    preExitBlock: false,
    preExitTimer: 0,
    preExitCleared: false,
    blackoutTriggered: false,
    blackoutTimer: 0
  };

  // =========================================================
  //  TITLE SCREEN LIGHTNING
  // =========================================================
  var lightning = {
    canvas: null,
    ctx: null,
    active: false,
    timer: 0,
    nextStrike: 3,   // seconds until next lightning
    flashAlpha: 0,
    bolts: [],       // stored bolt paths for rendering during flash
    rumbleTimeout: null
  };

  function initLightningCanvas() {
    lightning.canvas = document.getElementById('lightningCanvas');
    if (!lightning.canvas) return;
    lightning.ctx = lightning.canvas.getContext('2d');
    resizeLightningCanvas();
  }

  function resizeLightningCanvas() {
    if (!lightning.canvas) return;
    lightning.canvas.width = window.innerWidth;
    lightning.canvas.height = window.innerHeight;
  }

  function generateBolt(x1, y1, x2, y2, depth) {
    var segments = [];
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 4 || depth > 5) {
      segments.push({ x1: x1, y1: y1, x2: x2, y2: y2 });
      return segments;
    }
    var mx = (x1 + x2) / 2 + (Math.random() - 0.5) * len * 0.3;
    var my = (y1 + y2) / 2 + (Math.random() - 0.5) * len * 0.15;
    var upper = generateBolt(x1, y1, mx, my, depth + 1);
    var lower = generateBolt(mx, my, x2, y2, depth + 1);
    segments = upper.concat(lower);
    // Branch at midpoint
    if (depth < 3 && Math.random() < 0.4) {
      var bx = mx + (Math.random() - 0.5) * len * 0.5;
      var by = my + len * (0.15 + Math.random() * 0.25);
      var branch = generateBolt(mx, my, bx, by, depth + 2);
      segments = segments.concat(branch);
    }
    return segments;
  }

  function triggerLightning() {
    if (!lightning.canvas) return;
    var w = lightning.canvas.width;
    var h = lightning.canvas.height;
    // Generate 1-2 bolts
    lightning.bolts = [];
    var numBolts = Math.random() < 0.3 ? 2 : 1;
    for (var i = 0; i < numBolts; i++) {
      var startX = w * (0.2 + Math.random() * 0.6);
      var endX = startX + (Math.random() - 0.5) * w * 0.3;
      var bolt = generateBolt(startX, 0, endX, h * (0.4 + Math.random() * 0.3), 0);
      lightning.bolts.push(bolt);
    }
    lightning.flashAlpha = 1.0;
    // Play thunder sound
    playThunder();
  }

  function updateLightning(dt) {
    if (!lightning.active) return;
    lightning.timer += dt;
    if (lightning.timer >= lightning.nextStrike) {
      lightning.timer = 0;
      lightning.nextStrike = 4 + Math.random() * 8; // 4-12 seconds between strikes
      triggerLightning();
    }
    // Decay flash
    if (lightning.flashAlpha > 0) {
      // Rapid flicker effect: briefly re-flash
      if (lightning.flashAlpha > 0.7 && Math.random() < 0.15) {
        lightning.flashAlpha = 0.9;
      }
      lightning.flashAlpha -= dt * 2.5;
      if (lightning.flashAlpha < 0) lightning.flashAlpha = 0;
    }
    renderLightning();
  }

  function renderLightning() {
    var ctx = lightning.ctx;
    var w = lightning.canvas.width;
    var h = lightning.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (lightning.flashAlpha <= 0) return;

    // Screen flash (white with slight blue tint)
    ctx.fillStyle = 'rgba(200,210,255,' + (lightning.flashAlpha * 0.15) + ')';
    ctx.fillRect(0, 0, w, h);

    // Draw bolt segments
    var alpha = lightning.flashAlpha;
    for (var b = 0; b < lightning.bolts.length; b++) {
      var segs = lightning.bolts[b];
      // Outer glow
      ctx.strokeStyle = 'rgba(150,160,255,' + (alpha * 0.3) + ')';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (var i = 0; i < segs.length; i++) {
        ctx.moveTo(segs[i].x1, segs[i].y1);
        ctx.lineTo(segs[i].x2, segs[i].y2);
      }
      ctx.stroke();
      // Inner bright core
      ctx.strokeStyle = 'rgba(220,225,255,' + alpha + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var j = 0; j < segs.length; j++) {
        ctx.moveTo(segs[j].x1, segs[j].y1);
        ctx.lineTo(segs[j].x2, segs[j].y2);
      }
      ctx.stroke();
    }
  }

  function playThunder() {
    if (!audioInitialized) return;
    try {
      var ac = GameEngine._getAudioCtx();
      if (!ac || ac.state !== 'running') return;
      var now = ac.currentTime;
      var seNode = GameEngine._getSeGain();

      // --- Crack (sharp initial impact) ---
      var crackBuf = ac.createBuffer(1, ac.sampleRate * 0.15, ac.sampleRate);
      var crackData = crackBuf.getChannelData(0);
      for (var i = 0; i < crackData.length; i++) {
        crackData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.03));
      }
      var crackSrc = ac.createBufferSource();
      crackSrc.buffer = crackBuf;
      var crackGain = ac.createGain();
      crackGain.gain.setValueAtTime(0.6, now);
      crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      var crackFilter = ac.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.value = 800;
      crackSrc.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(seNode);
      crackSrc.start(now);

      // --- Rumble (low thunder roll) ---
      var rumbleDur = 1.5 + Math.random() * 1.5;
      var rumbleBuf = ac.createBuffer(1, ac.sampleRate * rumbleDur, ac.sampleRate);
      var rumbleData = rumbleBuf.getChannelData(0);
      for (var r = 0; r < rumbleData.length; r++) {
        var env = Math.exp(-r / (ac.sampleRate * rumbleDur * 0.4));
        // Add some rumble variation
        var wave = Math.sin(r / ac.sampleRate * 60 * Math.PI * 2) * 0.3;
        rumbleData[r] = ((Math.random() * 2 - 1) * 0.7 + wave) * env;
      }
      var rumbleSrc = ac.createBufferSource();
      rumbleSrc.buffer = rumbleBuf;
      var rumbleGain = ac.createGain();
      rumbleGain.gain.setValueAtTime(0.35, now + 0.1);
      rumbleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1 + rumbleDur);
      var rumbleFilter = ac.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 200;
      rumbleSrc.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(seNode);
      rumbleSrc.start(now + 0.08);

      // --- Distant secondary rumble ---
      var dist2Dur = 2 + Math.random();
      var dist2Buf = ac.createBuffer(1, ac.sampleRate * dist2Dur, ac.sampleRate);
      var dist2Data = dist2Buf.getChannelData(0);
      for (var d = 0; d < dist2Data.length; d++) {
        dist2Data[d] = (Math.random() * 2 - 1) * Math.exp(-d / (ac.sampleRate * dist2Dur * 0.5)) * 0.3;
      }
      var dist2Src = ac.createBufferSource();
      dist2Src.buffer = dist2Buf;
      var dist2Gain = ac.createGain();
      dist2Gain.gain.setValueAtTime(0.15, now + 0.5);
      dist2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5 + dist2Dur);
      var dist2Filter = ac.createBiquadFilter();
      dist2Filter.type = 'lowpass';
      dist2Filter.frequency.value = 120;
      dist2Src.connect(dist2Filter);
      dist2Filter.connect(dist2Gain);
      dist2Gain.connect(seNode);
      dist2Src.start(now + 0.4 + Math.random() * 0.3);
    } catch (e) {
      // ignore audio errors
    }
  }

  function startTitleLightning() {
    initLightningCanvas();
    lightning.active = true;
    lightning.timer = 0;
    lightning.nextStrike = 1.5 + Math.random() * 2; // first strike comes sooner
    lightning.flashAlpha = 0;
    lightning.bolts = [];
  }

  function stopTitleLightning() {
    lightning.active = false;
    lightning.flashAlpha = 0;
    if (lightning.ctx) {
      lightning.ctx.clearRect(0, 0, lightning.canvas.width, lightning.canvas.height);
    }
  }

  // ─── Big Thunder (Resident Evil style, for start button) ───
  function playBigThunder() {
    if (!audioInitialized) return;
    try {
      var ac = GameEngine._getAudioCtx();
      if (!ac || ac.state !== 'running') return;
      var now = ac.currentTime;
      var seNode = GameEngine._getSeGain();

      // Massive crack
      var crackBuf = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
      var crackData = crackBuf.getChannelData(0);
      for (var i = 0; i < crackData.length; i++) {
        crackData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.05));
      }
      var crackSrc = ac.createBufferSource();
      crackSrc.buffer = crackBuf;
      var crackGain = ac.createGain();
      crackGain.gain.setValueAtTime(1.0, now);
      crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      var crackHi = ac.createBiquadFilter();
      crackHi.type = 'highpass';
      crackHi.frequency.value = 600;
      crackSrc.connect(crackHi);
      crackHi.connect(crackGain);
      crackGain.connect(seNode);
      crackSrc.start(now);

      // Heavy rumble
      var rumbleDur = 3.5;
      var rumbleBuf = ac.createBuffer(1, ac.sampleRate * rumbleDur, ac.sampleRate);
      var rumbleData = rumbleBuf.getChannelData(0);
      for (var r = 0; r < rumbleData.length; r++) {
        var env = Math.exp(-r / (ac.sampleRate * rumbleDur * 0.35));
        var wave = Math.sin(r / ac.sampleRate * 45 * Math.PI * 2) * 0.4;
        var wave2 = Math.sin(r / ac.sampleRate * 30 * Math.PI * 2) * 0.2;
        rumbleData[r] = ((Math.random() * 2 - 1) * 0.6 + wave + wave2) * env;
      }
      var rumbleSrc = ac.createBufferSource();
      rumbleSrc.buffer = rumbleBuf;
      var rumbleGain = ac.createGain();
      rumbleGain.gain.setValueAtTime(0.7, now + 0.05);
      rumbleGain.gain.exponentialRampToValueAtTime(0.01, now + rumbleDur);
      var rumbleFilter = ac.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 150;
      rumbleSrc.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(seNode);
      rumbleSrc.start(now + 0.03);

      // Reverberant tail
      var tailDur = 4;
      var tailBuf = ac.createBuffer(1, ac.sampleRate * tailDur, ac.sampleRate);
      var tailData = tailBuf.getChannelData(0);
      for (var t = 0; t < tailData.length; t++) {
        tailData[t] = (Math.random() * 2 - 1) * Math.exp(-t / (ac.sampleRate * tailDur * 0.3)) * 0.15;
      }
      var tailSrc = ac.createBufferSource();
      tailSrc.buffer = tailBuf;
      var tailGain = ac.createGain();
      tailGain.gain.setValueAtTime(0.4, now + 0.2);
      tailGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2 + tailDur);
      var tailFilter = ac.createBiquadFilter();
      tailFilter.type = 'lowpass';
      tailFilter.frequency.value = 80;
      tailSrc.connect(tailFilter);
      tailFilter.connect(tailGain);
      tailGain.connect(seNode);
      tailSrc.start(now + 0.15);
    } catch (e) { /* ignore */ }
  }

  // ─── Title BGM (eerie drone) ───
  var titleBgmNodes = null;

  function startTitleBGM() {
    if (!audioInitialized) return;
    if (titleBgmNodes) return;
    try {
      var ac = GameEngine._getAudioCtx();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      var bgmNode = GameEngine._getSeGain();

      // Low drone oscillator
      var osc1 = ac.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 55; // low A
      var osc2 = ac.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 58; // slightly detuned for unease

      // LFO for slow pulsing
      var lfo = ac.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.15;
      var lfoGain = ac.createGain();
      lfoGain.gain.value = 0.03;
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);

      var gain = ac.createGain();
      gain.gain.value = 0.08;
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(bgmNode);

      osc1.start();
      osc2.start();
      lfo.start();

      titleBgmNodes = { nodes: [osc1, osc2, lfo], gain: gain };
    } catch (e) { /* ignore */ }
  }

  function stopTitleBGM() {
    if (titleBgmNodes) {
      for (var i = 0; i < titleBgmNodes.nodes.length; i++) {
        try { titleBgmNodes.nodes[i].stop(); } catch (e) { /* */ }
        try { titleBgmNodes.nodes[i].disconnect(); } catch (e) { /* */ }
      }
      try { titleBgmNodes.gain.disconnect(); } catch (e) { /* */ }
      titleBgmNodes = null;
    }
  }

  // ─── Init title audio on first tap ───
  function initTitleAudio() {
    if (audioInitialized) {
      startTitleRain();
      startTitleBGM();
      return;
    }
    GameEngine.initAudio();
    audioInitialized = true;
    startTitleRain();
    startTitleBGM();
  }

  // ─── Title Rain Sound ───
  var titleRainNodes = null;

  function startTitleRain() {
    if (!audioInitialized) return;
    if (titleRainNodes) return;
    try {
      var ac = GameEngine._getAudioCtx();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      var bgmNode = GameEngine._getSeGain(); // use SE gain for rain

      // Brown noise → bandpass = rain-like hiss
      var bufSize = ac.sampleRate * 4;
      var noiseBuf = ac.createBuffer(1, bufSize, ac.sampleRate);
      var data = noiseBuf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < bufSize; i++) {
        var white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
        data[i] *= 3.5;
      }
      var src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      var filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3000;
      filter.Q.value = 0.5;

      var gain = ac.createGain();
      gain.gain.value = 0.12;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(bgmNode);
      src.start();

      titleRainNodes = { src: src, filter: filter, gain: gain };
    } catch (e) {
      // ignore
    }
  }

  function stopTitleRain() {
    if (titleRainNodes) {
      try { titleRainNodes.src.stop(); } catch (e) { /* */ }
      try { titleRainNodes.src.disconnect(); } catch (e) { /* */ }
      try { titleRainNodes.filter.disconnect(); } catch (e) { /* */ }
      try { titleRainNodes.gain.disconnect(); } catch (e) { /* */ }
      titleRainNodes = null;
    }
  }

  // =========================================================
  //  HELPER: Grid ↔ World
  // =========================================================
  function gToW(gx, gy) {
    return { x: gx * TS + TS / 2, y: gy * TS + TS / 2 };
  }
  function wToG(wx, wy) {
    return { gx: Math.floor(wx / TS), gy: Math.floor(wy / TS) };
  }

  // =========================================================
  //  HELPER: tile walkability (with door logic)
  // =========================================================
  function isTileWalkable(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return false;
    var t = MAP_TILES[gy][gx];
    // Exit door
    if (t === TILE.EXIT_DOOR) {
      return exitDoor.open;
    }
    // Regular doors — only walkable when open
    if (t === TILE.DOOR) {
      for (var i = 0; i < doors.length; i++) {
        if (doors[i].gx === gx && doors[i].gy === gy) {
          return doors[i].open;
        }
      }
      return false; // unlisted door → blocked
    }
    return !!WALKABLE_TILES[t];
  }

  // Player collision check: check corners of bounding box
  function canMoveTo(wx, wy) {
    var hw = player.w / 2 - 1;
    var hh = player.h / 2 - 1;
    var corners = [
      { x: wx - hw, y: wy - hh },
      { x: wx + hw, y: wy - hh },
      { x: wx - hw, y: wy + hh },
      { x: wx + hw, y: wy + hh }
    ];
    for (var i = 0; i < corners.length; i++) {
      var g = wToG(corners[i].x, corners[i].y);
      if (!isTileWalkable(g.gx, g.gy)) return false;
    }
    return true;
  }

  // =========================================================
  //  BFS PATHFINDING
  // =========================================================
  function findPath(sx, sy, ex, ey) {
    if (sx === ex && sy === ey) return [];
    if (!isTileWalkable(ex, ey)) return null;

    var queue = [];
    var visited = {};
    var parent = {};
    var key = function (x, y) { return x + ',' + y; };

    queue.push({ x: sx, y: sy });
    visited[key(sx, sy)] = true;

    var dirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];

    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      if (cur.x === ex && cur.y === ey) {
        // reconstruct path
        var path = [];
        var c = cur;
        while (c) {
          path.push({ gx: c.x, gy: c.y });
          c = parent[key(c.x, c.y)];
        }
        path.reverse();
        return path;
      }
      for (var d = 0; d < dirs.length; d++) {
        var nx = cur.x + dirs[d].dx;
        var ny = cur.y + dirs[d].dy;
        var nk = key(nx, ny);
        if (!visited[nk] && isTileWalkable(nx, ny)) {
          visited[nk] = true;
          parent[nk] = cur;
          queue.push({ x: nx, y: ny });
        }
      }
      // Safety: don't blow up on huge search
      if (head > 3000) return null;
    }
    return null;
  }

  // =========================================================
  //  HARUKI-SPECIFIC PATHFINDING & LINE OF SIGHT
  // =========================================================

  // Haruki treats unlocked doors (even if closed) as walkable
  function isTileWalkableForHaruki(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return false;
    var t = MAP_TILES[gy][gx];
    if (t === TILE.EXIT_DOOR) return exitDoor.open;
    if (t === TILE.DOOR) {
      for (var i = 0; i < doors.length; i++) {
        if (doors[i].gx === gx && doors[i].gy === gy) {
          return !doors[i].locked; // passable if unlocked (even if closed)
        }
      }
      return false;
    }
    return !!WALKABLE_TILES[t];
  }

  // BFS pathfinding using Haruki's walkability rules
  function findPathForHaruki(sx, sy, ex, ey) {
    if (sx === ex && sy === ey) return [];
    if (!isTileWalkableForHaruki(ex, ey)) return null;

    var queue = [];
    var visited = {};
    var parent = {};
    var key = function (x, y) { return x + ',' + y; };

    queue.push({ x: sx, y: sy });
    visited[key(sx, sy)] = true;

    var dirs = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
    ];

    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      if (cur.x === ex && cur.y === ey) {
        var path = [];
        var c = cur;
        while (c) {
          path.push({ gx: c.x, gy: c.y });
          c = parent[key(c.x, c.y)];
        }
        path.reverse();
        return path;
      }
      for (var d = 0; d < dirs.length; d++) {
        var nx = cur.x + dirs[d].dx;
        var ny = cur.y + dirs[d].dy;
        var nk = key(nx, ny);
        if (!visited[nk] && isTileWalkableForHaruki(nx, ny)) {
          visited[nk] = true;
          parent[nk] = cur;
          queue.push({ x: nx, y: ny });
        }
      }
      if (head > 3000) return null;
    }
    return null;
  }

  // Raycast line-of-sight check between two world positions
  // Returns true if no wall blocks the view
  function hasLineOfSight(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return true;

    var steps = Math.ceil(dist / (TS * 0.4)); // check every ~0.4 tiles
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var cx = x1 + dx * t;
      var cy = y1 + dy * t;
      var g = wToG(cx, cy);
      var tile = MAP_TILES[g.gy] && MAP_TILES[g.gy][g.gx];
      if (tile === undefined) return false;
      // Walls and windows block sight
      if (tile === TILE.WALL || tile === TILE.WINDOW || tile === TILE.FURNITURE) return false;
      // Closed doors block sight
      if (tile === TILE.DOOR) {
        for (var di = 0; di < doors.length; di++) {
          if (doors[di].gx === g.gx && doors[di].gy === g.gy && !doors[di].open) return false;
        }
      }
    }
    return true;
  }

  // Vision cone check (G1-3): Haruki can see player only within FOV or very close
  function harukiCanSeePlayer(pDist) {
    if (isHiding) return false;
    // Very close: peripheral vision, detect regardless
    if (pDist < TS * 2) return hasLineOfSight(haruki.x, haruki.y, player.x, player.y);
    // Calculate angle from Haruki to player
    var angleToPlayer = Math.atan2(player.y - haruki.y, player.x - haruki.x);
    // Normalize angle difference
    var diff = angleToPlayer - harukiFacingAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // 120 degree FOV = 60 degrees each side
    if (Math.abs(diff) > Math.PI / 3) return false;
    return hasLineOfSight(haruki.x, haruki.y, player.x, player.y);
  }

  // Haruki collision check: can Haruki move to this world position?
  function canHarukiMoveTo(wx, wy) {
    var hw = 10;
    var corners = [
      wToG(wx - hw, wy - hw), wToG(wx + hw, wy - hw),
      wToG(wx - hw, wy + hw), wToG(wx + hw, wy + hw)
    ];
    for (var i = 0; i < 4; i++) {
      if (!isTileWalkableForHaruki(corners[i].gx, corners[i].gy)) return false;
    }
    return true;
  }

  // =========================================================
  //  CAMERA SENSITIVITY
  // =========================================================
  var lookSensitivity = 1.0; // 0.3 to 2.0 range

  // =========================================================
  //  UI HELPERS
  // =========================================================
  function showOverlay(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'flex'; }
  }
  function hideOverlay(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; }
  }

  function showActionBtn(text, callback) {
    var btn = document.getElementById('actionBtn');
    var btnText = document.getElementById('actionBtnText');
    if (btn && btnText) {
      btnText.textContent = text;
      btn.classList.add('visible');
      btn.style.display = 'flex';
      actionCallback = callback;
    }
  }

  function hideActionBtn() {
    var btn = document.getElementById('actionBtn');
    if (btn) {
      btn.classList.remove('visible');
      btn.style.display = 'none';
    }
    actionCallback = null;
  }

  function showJoystick() {
    var lz = document.getElementById('touchZoneLeft');
    if (lz) lz.style.display = 'block';
    var rz = document.getElementById('touchZoneRight');
    if (rz) rz.style.display = 'block';
    var el = document.getElementById('joystickArea');
    if (el) el.style.display = 'block';
    var la = document.getElementById('lookArea');
    if (la) la.style.display = 'block';
    var mb = document.getElementById('minimapBtn');
    if (mb) mb.classList.add('visible');
  }
  function hideJoystick() {
    var lz = document.getElementById('touchZoneLeft');
    if (lz) lz.style.display = 'none';
    var rz = document.getElementById('touchZoneRight');
    if (rz) rz.style.display = 'none';
    var el = document.getElementById('joystickArea');
    if (el) { el.style.display = 'none'; el.classList.remove('active'); }
    var la = document.getElementById('lookArea');
    if (la) { la.style.display = 'none'; la.classList.remove('active'); }
    var mb = document.getElementById('minimapBtn');
    if (mb) mb.classList.remove('visible');
  }
  function showStamina() {
    var el = document.getElementById('staminaBar');
    if (el) el.classList.add('visible');
  }
  function hideStamina() {
    var el = document.getElementById('staminaBar');
    if (el) el.classList.remove('visible');
  }

  // =========================================================
  //  DIALOGUE SYSTEM (queue-based)
  // =========================================================
  function queueDialogue(lines, onComplete) {
    dialogueQueue = lines.slice();
    dialogueActive = true;
    var lz = document.getElementById('touchZoneLeft');
    if (lz) lz.classList.add('faded');
    var rz = document.getElementById('touchZoneRight');
    if (rz) rz.classList.add('faded');
    var advance = function () {
      if (dialogueQueue.length === 0) {
        GameEngine.hideDialogue();
        dialogueActive = false;
        var lz = document.getElementById('touchZoneLeft');
        if (lz) lz.classList.remove('faded');
        var rz = document.getElementById('touchZoneRight');
        if (rz) rz.classList.remove('faded');
        if (onComplete) onComplete();
        return;
      }
      var line = dialogueQueue.shift();
      GameEngine.showDialogue(line.speaker, line.text, function () {
        advance();
      });
    };
    advance();
  }

  // =========================================================
  //  PHASE TRANSITIONS
  // =========================================================
  function setPhase(newPhase) {
    phase = newPhase;
    phaseTimer = 0;
    phaseFlags = {};
    hideActionBtn();

    switch (newPhase) {
      case PHASES.TITLE:
        onEnterTitle();
        break;
      case PHASES.FRONT_DESK:
        onEnterFrontDesk();
        break;
      case PHASES.PHONE_CALL:
        onEnterPhoneCall();
        break;
      case PHASES.WALK_TO_ROOM:
        onEnterWalkToRoom();
        break;
      case PHASES.ENTER_ROOM:
        onEnterEnterRoom();
        break;
      case PHASES.ATTACK:
        onEnterAttack();
        break;
      case PHASES.WAKE_UP:
        onEnterWakeUp();
        break;
      case PHASES.EXPLORE:
        onEnterExplore();
        break;
      case PHASES.CHASE_1:
        onEnterChase1();
        break;
      case PHASES.CHASE_FINAL:
        onEnterChaseFinal();
        break;
      case PHASES.ENDING:
        onEnterEnding();
        break;
      case PHASES.TRUE_ENDING:
        onEnterTrueEnding();
        break;
      case PHASES.BAD_ENDING:
        onEnterBadEnding();
        break;
      case PHASES.GAME_OVER:
        onEnterGameOver();
        break;
    }
  }

  // =========================================================
  //  PHASE ENTER HANDLERS
  // =========================================================
  function onEnterTitle() {
    showOverlay('titleScreen');
    hideOverlay('gameOverScreen');
    hideOverlay('endingScreen');
    hideOverlay('phoneUI');
    hideJoystick();
    hideStamina();
    GameEngine.hideDialogue();
    GameEngine.stopAll();
    haruki.active = false;
    hideOverlay('trueEndingScreen');
    hideOverlay('badEndingScreen');
    // Reset start button
    var sb = document.getElementById('startBtn');
    if (sb) {
      sb.style.opacity = '';
      sb.style.pointerEvents = '';
      sb.textContent = audioInitialized ? 'ゲームスタート' : 'タップしてスタート';
    }
    startTitleLightning();
    // Audio starts on first tap (mobile requires user gesture)
    if (audioInitialized) {
      startTitleRain();
      startTitleBGM();
    }
  }

  function onEnterFrontDesk() {
    hideOverlay('titleScreen');
    stopTitleLightning();
    stopTitleRain();
    stopTitleBGM();
    showJoystick();

    // Spawn player at front desk area
    var sp = gToW(7, 26);
    player.x = sp.x;
    player.y = sp.y;
    player.angle = Math.PI * 1.5; // facing up (north)
    player.dir = 'up';
    player.flashlightRadius = 200;
    player.flashlightFlicker = 0;
    player.hasKey = false;
    player.stamina = 1.0;
    player.staminaRecharging = false;

    // Reset doors to initial state
    resetDoors();
    resetItems();

    // Reset all new systems
    gameTimer = 0;
    badEndingTriggered = false;
    difficultySpeedBoosts = 0;
    difficultyRangeBoosts = 0;
    blackoutEventTriggered = false;
    isHiding = false;
    hideTimer = 0;
    hidingSpotRef = null;
    harukiAlertLevel = 0;
    noiseTimer = 0;
    monologueTimer = 0;
    whisperCooldown = 0;
    haruki.chaseSpeed = 155; // reset chase speed
    haruki.spotRange = TS * 6; // reset spot range
    scriptedEvents.room404WallText = false;
    scriptedEvents.wakeUpBlurry = false;
    scriptedEvents.wakeUpStagger = false;
    scriptedEvents.keyCardStinger = false;
    scriptedEvents.preExitBlock = false;
    scriptedEvents.preExitCleared = false;
    scriptedEvents.blackoutTriggered = false;

    GameEngine.startLoop('ambient');
    phoneRinging = false;
  }

  function onEnterPhoneCall() {
    phoneRinging = false;
    try { GameEngine.stopLoop('phone'); } catch(e) {}

    // Show phone UI
    showOverlay('phoneUI');
  }

  function onEnterWalkToRoom() {
    hideOverlay('phoneUI');
    player.flashlightRadius = 150;

    // Keep room 404 door locked until player knocks
    room404DoorRef = findDoor('404');

    // Make the corridor slightly creepier
    phaseFlags.creepySoundTimer = 5; // first creepy sound after 5 sec
  }

  function onEnterEnterRoom() {
    // Player entered room 404
    phaseFlags.roomTimer = 0;
    phaseFlags.dialogueDone = false;

    queueDialogue([
      { speaker: 'あなた', text: '...お客様？ハルキ様？...誰もいない...？' },
      { speaker: 'あなた', text: '...壁に何か書いてある...「ずっと待ってたわ♡」...赤い文字...' }
    ], function () {
      phaseFlags.dialogueDone = true;
      phaseFlags.roomTimer = 0; // reset timer for exit delay
    });
  }

  function onEnterAttack() {
    hideActionBtn();
    hideJoystick();

    // JUMP SCARE SEQUENCE
    GameEngine.stopAll();
    GameEngine.playSound('hit');
    GameEngine.shakeScreen(15, 500);

    setTimeout(function () {
      // Start heartbeat for tension
      GameEngine.startLoop('heartbeat');

      var img = GameEngine.images['assets/img/haruki_scary.png'] || null;
      if (img) {
        // Play jumpscare sound DURING the face display
        GameEngine.playSound('jumpscare');
        GameEngine.flashImage(img, 3000, function () {
          // Second scare: brief black then face again with shake
          GameEngine.shakeScreen(20, 300);
          GameEngine.redFlash();
          setTimeout(function () {
            GameEngine.playSound('hit');
            GameEngine.staticEffect(0.5);
            GameEngine.fadeToBlack(800, function () {
              GameEngine.stopAll();
              // Eerie silence then static
              setTimeout(function () {
                GameEngine.playSound('static');
                GameEngine.staticEffect(1.0);
                setTimeout(function () {
                  setPhase(PHASES.WAKE_UP);
                }, 1200);
              }, 2000);
            });
          }, 300);
        });
      } else {
        GameEngine.playSound('jumpscare');
        GameEngine.redFlash();
        GameEngine.shakeScreen(20, 600);
        GameEngine.fadeToBlack(800, function () {
          GameEngine.stopAll();
          setTimeout(function () {
            setPhase(PHASES.WAKE_UP);
          }, 2000);
        });
      }
    }, 400);
  }

  function onEnterWakeUp() {
    showJoystick();
    GameEngine.stopAll();

    // Teleport player to utility room
    var sp = gToW(3, 33);
    player.x = sp.x;
    player.y = sp.y;
    player.angle = Math.PI * 1.5; // facing up (north)
    player.dir = 'up';
    player.flashlightRadius = 100;
    player.flashlightFlicker = 0.8;
    player.hasKey = false;
    player.stamina = 1.0;

    // Sync camera to new position
    GameEngine.setPlayerView(player.x, player.y, player.angle);

    // Reset items for explore phase
    resetItems();

    // Unlock rooms for exploration
    unlockExplorationDoors();

    // Open the utility room door so player can leave
    var utilDoor = findDoor('utility');
    if (utilDoor) utilDoor.open = true;

    // Blurry vision effect (E3)
    scriptedEvents.wakeUpBlurry = true;
    scriptedEvents.wakeUpBlurTimer = 3.0;
    if (GameEngine.chromaticLevel !== undefined) GameEngine.chromaticLevel = 0.8;

    // Stagger walk (E3) — reduce speed temporarily
    scriptedEvents.wakeUpStagger = true;
    scriptedEvents.wakeUpStaggerTimer = 5.0;
    player.speed = 60; // half speed

    GameEngine.fadeFromBlack(2000, function () {
      GameEngine.startLoop('breath');
      GameEngine.startLoop('ambient');

      queueDialogue([
        { speaker: 'あなた', text: '...うっ...頭が...ここは...用務室...？' },
        { speaker: 'あなた', text: '...体が重い...目がかすむ...' },
        { speaker: 'あなた', text: '...出口を見つけないと...' }
      ], function () {
        setPhase(PHASES.EXPLORE);
      });
    });
  }

  function onEnterExplore() {
    GameEngine.paused = false;
    showJoystick();
    showStamina();
    // Ensure touch zones are fully active (clear any leftover faded state)
    var lz = document.getElementById('touchZoneLeft');
    if (lz) { lz.style.display = 'block'; lz.classList.remove('faded'); }
    var rz = document.getElementById('touchZoneRight');
    if (rz) { rz.style.display = 'block'; rz.classList.remove('faded'); }
    dialogueActive = false;
    player.flashlightRadius = 100;
    player.flashlightFlicker = 0.6;
    creepyEventTimer = 8 + Math.random() * 7;

    // Initialize new systems
    initRandomEvents();
    gameTimer = 0;
    badEndingTriggered = false;
    difficultySpeedBoosts = 0;
    difficultyRangeBoosts = 0;
    blackoutEventTriggered = false;
    monologueTimer = 0;
    nextMonologueTime = 60 + Math.random() * 30;
    whisperCooldown = 0;
    isHiding = false;
    hideTimer = 0;
    hidingSpotRef = null;
    harukiAlertLevel = 0;
    noiseTimer = 0;

    // Set BGM layers for explore
    if (GameEngine.setBGMLayers) {
      GameEngine.setBGMLayers({drone: 0.4, dissonance: 0.15, melody: 0.1, pulse: 0});
    }
  }

  function onEnterChase1() {
    // Haruki goes into full chase mode!
    GameEngine.redFlash();
    if (!haruki.active) {
      GameEngine.startLoop('heartbeat');
      // Spawn if not already active
      var sp = gToW(14, 7);
      haruki.x = sp.x;
      haruki.y = sp.y;
      haruki.active = true;
      haruki.visible = true;
    }
    haruki.chaseIntensity = 1.0;
    haruki.aiState = 'chase';
    haruki.path = [];
    haruki.pathTimer = 0;

    // Reset pre-exit event flags
    scriptedEvents.preExitBlock = false;
    scriptedEvents.preExitCleared = false;
    scriptedEvents.preExitTimer = 0;

    // Set BGM layers for chase
    if (GameEngine.setBGMLayers) {
      GameEngine.setBGMLayers({drone: 0.5, dissonance: 0.4, melody: 0, pulse: 0.5});
    }

    // Brief dialogue flash
    queueDialogue([
      { speaker: 'ハルキ', text: 'みーつけたぁ♡ もう逃がさないわよぉ〜！' }
    ], function () {
      // Chase begins
    });

    // Unlock exit corridor
    // The exit door is at bottom-right -- unlock the path to it
    // Make exit tiles walkable (rows 35-38 right side)
    MAP_TILES[35][26] = TILE.CARPET;
    MAP_TILES[35][27] = TILE.CARPET;
    MAP_TILES[35][28] = TILE.CARPET;
  }

  function onEnterChaseFinal() {
    // Player reached exit door with key
    unlockingExit = true;
    unlockTimer = 0;
    hideActionBtn();
  }

  function onEnterEnding() {
    hideJoystick();
    hideStamina();
    hideActionBtn();
    GameEngine.stopAll();
    haruki.active = false;
    if (GameEngine.stopEnemyFootsteps) GameEngine.stopEnemyFootsteps();

    // Determine ending type (E4)
    var mc = getCollectedMemoCount();
    if (mc >= 10 && inventory.hasPhoto) {
      setPhase(PHASES.TRUE_ENDING);
      return;
    }

    GameEngine.fadeToBlack(1000, function () {
      setTimeout(function () {
        var ep = document.querySelector('#endingScreen .ending-message');
        if (ep) {
          var txt = 'あなたはホテルから逃げ出した。<br>しかし、ハルキの影は今も...';
          if (mc > 0) txt += '<br><br>収集したメモ: ' + mc + '/10';
          ep.innerHTML = txt;
        }
        showOverlay('endingScreen');
      }, 500);
    });
  }

  function onEnterTrueEnding() {
    hideJoystick();
    hideStamina();
    hideActionBtn();
    GameEngine.stopAll();
    haruki.active = false;
    if (GameEngine.stopEnemyFootsteps) GameEngine.stopEnemyFootsteps();

    GameEngine.fadeToBlack(1500, function () {
      setTimeout(function () {
        var msg = document.getElementById('trueEndingMessage');
        if (msg) {
          msg.innerHTML =
            'あなたは全ての記録を持ち出した。<br><br>' +
            'ハルキ——本名不明。3年前、このホテルに長期滞在。<br>' +
            'フロント係への異常な執着の末、暴行事件を起こし逃走。<br>' +
            '以来、ホテルの地下に潜み続けていた。<br><br>' +
            '写真には、まだ普通の青年だった頃のハルキが笑っていた...<br><br>' +
            '事件は警察に通報された。もう誰も犠牲にはならない。';
        }
        showOverlay('trueEndingScreen');
      }, 500);
    });
  }

  function onEnterBadEnding() {
    hideJoystick();
    hideStamina();
    hideActionBtn();
    GameEngine.stopAll();
    haruki.active = false;
    if (GameEngine.stopEnemyFootsteps) GameEngine.stopEnemyFootsteps();
    if (GameEngine.vignetteIntensity !== undefined) GameEngine.vignetteIntensity = 1.0;
    GameEngine.playSound('stinger');
    GameEngine.shakeScreen(10, 500);

    GameEngine.fadeToBlack(2000, function () {
      setTimeout(function () {
        showOverlay('badEndingScreen');
      }, 800);
    });
  }

  function onEnterGameOver() {
    hideJoystick();
    hideStamina();
    hideActionBtn();
    GameEngine.stopAll();
    haruki.active = false;
    isHiding = false;
    if (GameEngine.vignetteIntensity !== undefined) GameEngine.vignetteIntensity = 0;
    if (GameEngine.stopEnemyFootsteps) GameEngine.stopEnemyFootsteps();

    // Reset game over screen text to default (in case bad ending changed it)
    var goScreen = document.getElementById('gameOverScreen');
    if (goScreen) {
      var goTitle = goScreen.querySelector('h1');
      if (goTitle) goTitle.textContent = 'GAME OVER';
      var goSub = goScreen.querySelector('p');
      if (goSub) goSub.textContent = '';
    }

    GameEngine.playSound('static');
    GameEngine.staticEffect(1.0);

    setTimeout(function () {
      showOverlay('gameOverScreen');
    }, 600);
  }

  // =========================================================
  //  DOOR HELPERS
  // =========================================================
  function findDoor(label) {
    for (var i = 0; i < doors.length; i++) {
      if (doors[i].label === label) return doors[i];
    }
    return null;
  }

  function resetDoors() {
    for (var i = 0; i < doors.length; i++) {
      doors[i].open = false;
      // Default lock states
      if (['401', 'back1', 'back2', 'back3', 'utility'].indexOf(doors[i].label) >= 0) {
        doors[i].locked = false;
      } else {
        doors[i].locked = true;
      }
    }
    exitDoor.locked = true;
    exitDoor.open = false;

    // Reset exit corridor walls
    MAP_TILES[35][26] = TILE.WALL;
    MAP_TILES[35][27] = TILE.WALL;
    MAP_TILES[35][28] = TILE.WALL;
  }

  function unlockExplorationDoors() {
    // Unlock more doors for explore phase
    var labelsToUnlock = ['401', '402', '403', '405', '406', '407', '408',
                          'back1', 'back2', 'back3',
                          'utility', 'storage1', 'storage2', 'storage3'];
    for (var i = 0; i < doors.length; i++) {
      if (labelsToUnlock.indexOf(doors[i].label) >= 0) {
        doors[i].locked = false;
      }
    }
    // Room 404 stays locked (already visited / creepy)
    var d404 = findDoor('404');
    if (d404) d404.locked = true;
  }

  // Try to open a door at grid position -- return true if opened
  function tryOpenDoor(gx, gy) {
    for (var i = 0; i < doors.length; i++) {
      if (doors[i].gx === gx && doors[i].gy === gy) {
        if (!doors[i].locked) {
          doors[i].open = !doors[i].open;
          GameEngine.playSound('door');
          return true;
        }
        return false;
      }
    }
    return false;
  }

  // =========================================================
  //  PLAYER UPDATE
  // =========================================================
  function updatePlayer(dt) {
    if (dialogueActive) return;
    if (phase === PHASES.ATTACK || phase === PHASES.TITLE ||
        phase === PHASES.GAME_OVER || phase === PHASES.ENDING) return;
    if (unlockingExit) return;
    if (isHiding) {
      // While hiding, only allow action button (exit hiding)
      var input = GameEngine.input;
      if (input.actionJustPressed && actionCallback) {
        var cb = actionCallback;
        hideActionBtn();
        cb();
      }
      // Still update camera
      GameEngine.setPlayerView(player.x, player.y, player.angle);
      return;
    }

    var input = GameEngine.input;
    var turnSpeed = 2.5 * lookSensitivity; // radians per second * sensitivity

    // Sprint logic (only during chase phases or explore)
    sprinting = false;
    if ((phase === PHASES.CHASE_1 || phase === PHASES.EXPLORE || phase === PHASES.CHASE_FINAL) &&
        (Math.abs(input.dy) > 0.7 || input.sprint)) {
      if (!player.staminaRecharging && player.stamina > 0) {
        sprinting = true;
      }
    }

    var moveSpeed = sprinting ? player.sprintSpeed : player.speed;

    if (sprinting) {
      player.stamina -= dt / 5; // 5 seconds of sprint
      if (player.stamina <= 0) {
        player.stamina = 0;
        player.staminaRecharging = true;
        sprinting = false;
      }
    } else {
      if (player.stamina < 1) {
        player.stamina += dt / 3; // 3 seconds to recharge
        if (player.stamina >= 1) {
          player.stamina = 1;
          player.staminaRecharging = false;
        }
      }
    }

    // Stamina UI
    if (phase === PHASES.CHASE_1 || phase === PHASES.EXPLORE || phase === PHASES.CHASE_FINAL) {
      GameEngine.updateStamina(player.stamina);
      // Update stamina fill color class
      var fill = document.getElementById('staminaFill');
      if (fill) {
        fill.classList.remove('medium', 'low');
        if (player.stamina < 0.3) fill.classList.add('low');
        else if (player.stamina < 0.6) fill.classList.add('medium');
      }
    }

    // Turn (right joystick horizontal)
    if (Math.abs(input.lookDx) > 0.1) {
      player.angle += input.lookDx * turnSpeed * dt;
    }

    // Move (left joystick: dy=forward/back, dx=strafe)
    var moveX = 0, moveY = 0;
    if (Math.abs(input.dy) > 0.1 || Math.abs(input.dx) > 0.1) {
      // Forward/backward along facing direction
      var fwd = Math.abs(input.dy) > 0.1 ? -input.dy : 0;
      // Strafe perpendicular to facing direction
      var strafe = Math.abs(input.dx) > 0.1 ? input.dx : 0;
      moveX = (Math.cos(player.angle) * fwd + Math.cos(player.angle + Math.PI / 2) * strafe) * moveSpeed * dt;
      moveY = (Math.sin(player.angle) * fwd + Math.sin(player.angle + Math.PI / 2) * strafe) * moveSpeed * dt;
    }

    // Collision check and apply movement
    if (moveX !== 0 && canMoveTo(player.x + moveX, player.y)) {
      player.x += moveX;
    }
    if (moveY !== 0 && canMoveTo(player.x, player.y + moveY)) {
      player.y += moveY;
    }

    player.moving = (Math.abs(input.dy) > 0.1 || Math.abs(input.dx) > 0.1);

    // Footstep sounds
    if (player.moving) {
      player.footstepTimer -= dt;
      if (player.footstepTimer <= 0) {
        GameEngine.playSound('footstep');
        player.footstepTimer = sprinting ? 0.25 : 0.35;
      }
    } else {
      player.footstepTimer = 0;
    }

    // Track visited tiles
    var pg = wToG(player.x, player.y);
    visitedTiles[pg.gx + ',' + pg.gy] = true;

    // Update camera (first-person view)
    GameEngine.setPlayerView(player.x, player.y, player.angle);

    // Handle action button press
    if (input.actionJustPressed && actionCallback) {
      var cb = actionCallback;
      hideActionBtn();
      cb();
    }

    // Auto-open doors when walking near them
    checkNearbyDoors();

    // --- Memo detection (E1) ---
    if (phase === PHASES.EXPLORE || phase === PHASES.CHASE_1) {
      checkNearbyMemos();
    }

    // --- Hiding system (G2) ---
    if (phase === PHASES.EXPLORE || phase === PHASES.CHASE_1) {
      updateHidingSystem(dt);
    }

    // --- Bottle pickup (G3) ---
    if (phase === PHASES.EXPLORE || phase === PHASES.CHASE_1) {
      checkNearbyBottles();
    }

    // --- Hidden photo (E4) ---
    if (phase === PHASES.EXPLORE && !hiddenPhoto.found) {
      checkHiddenPhoto();
    }

    // --- Throw bottle (G3) ---
    if ((phase === PHASES.EXPLORE || phase === PHASES.CHASE_1) && inventory.bottles > 0 && !isHiding) {
      checkThrowBottle();
    }

    // --- Floor surface for footsteps (Audio) ---
    if (player.moving) {
      var floorTile = MAP_TILES[pg.gy] && MAP_TILES[pg.gy][pg.gx];
      var surfaceType = 'tile';
      if (floorTile === TILE.CARPET) surfaceType = 'carpet';
      else if (floorTile === TILE.UTILITY || (pg.gy >= 31 && floorTile === TILE.FLOOR)) surfaceType = 'tile';
      if (GameEngine.setFootstepSurface) GameEngine.setFootstepSurface(surfaceType);
    }
  }

  function checkNearbyDoors() {
    var pg = wToG(player.x, player.y);
    for (var i = 0; i < doors.length; i++) {
      var d = doors[i];
      var dist = Math.abs(d.gx - pg.gx) + Math.abs(d.gy - pg.gy);
      if (dist <= 1 && !d.locked && !d.open) {
        d.open = true;
        GameEngine.playSound('door');
        // Alert Haruki if door opens within 5 tiles (G1)
        if (haruki.active) {
          var hg = wToG(haruki.x, haruki.y);
          var hDist = Math.abs(d.gx - hg.gx) + Math.abs(d.gy - hg.gy);
          if (hDist <= 5) {
            harukiAlertLevel = Math.min(1.0, harukiAlertLevel + 0.4);
          }
        }
      }
    }
  }

  // =========================================================
  //  MEMO DETECTION (E1)
  // =========================================================
  function checkNearbyMemos() {
    if (dialogueActive || isHiding) return;
    var pg = wToG(player.x, player.y);
    for (var i = 0; i < memos.length; i++) {
      var m = memos[i];
      if (m.collected) continue;
      var dist = Math.abs(pg.gx - m.gx) + Math.abs(pg.gy - m.gy);
      if (dist <= 1) {
        if (!actionCallback) {
          (function (memo) {
            showActionBtn('読む', function () {
              memo.collected = true;
              inventory.memoCount = getCollectedMemoCount();
              if (GameEngine.playSound) GameEngine.playSound('paper');
              showToast('メモを入手しました (' + inventory.memoCount + '/10)');
              queueDialogue([
                { speaker: memo.title, text: memo.text }
              ]);
            });
          })(m);
        }
        return;
      }
    }
  }

  // =========================================================
  //  HIDING SYSTEM UPDATE (G2)
  // =========================================================
  function updateHidingSystem(dt) {
    var pg = wToG(player.x, player.y);

    if (isHiding) {
      hideTimer += dt;
      // Darken screen while hiding
      if (GameEngine.vignetteIntensity !== undefined) {
        GameEngine.vignetteIntensity = 0.7;
      }
      // After maxHideTime: cough and reveal
      if (hideTimer >= maxHideTime) {
        isHiding = false;
        hideTimer = 0;
        hidingSpotRef = null;
        if (GameEngine.vignetteIntensity !== undefined) {
          GameEngine.vignetteIntensity = 0;
        }
        queueDialogue([
          { speaker: 'あなた', text: '（っ...！咳が...）' }
        ]);
        // Alert Haruki
        if (haruki.active) {
          harukiAlertLevel = 1.0;
          haruki.lastSeenX = player.x;
          haruki.lastSeenY = player.y;
          haruki.aiState = 'chase';
          haruki.path = [];
          haruki.pathTimer = 0;
        }
        hideActionBtn();
        return;
      }
      // Show exit button while hiding
      if (!actionCallback) {
        showActionBtn('出る', function () {
          isHiding = false;
          hideTimer = 0;
          hidingSpotRef = null;
          if (GameEngine.vignetteIntensity !== undefined) {
            GameEngine.vignetteIntensity = 0;
          }
        });
      }
      return;
    }

    // Check if on a hide spot
    if (!dialogueActive && !actionCallback) {
      for (var i = 0; i < hideSpots.length; i++) {
        var hs = hideSpots[i];
        if (pg.gx === hs.gx && pg.gy === hs.gy) {
          (function (spot) {
            showActionBtn('隠れる', function () {
              isHiding = true;
              hideTimer = 0;
              hidingSpotRef = spot;
              if (GameEngine.vignetteIntensity !== undefined) {
                GameEngine.vignetteIntensity = 0.7;
              }
            });
          })(hs);
          return;
        }
      }
    }
  }

  // =========================================================
  //  BOTTLE PICKUP (G3)
  // =========================================================
  function checkNearbyBottles() {
    if (dialogueActive || isHiding || actionCallback) return;
    var pg = wToG(player.x, player.y);
    for (var i = 0; i < bottleSpawns.length; i++) {
      var b = bottleSpawns[i];
      if (b.collected) continue;
      var dist = Math.abs(pg.gx - b.gx) + Math.abs(pg.gy - b.gy);
      if (dist <= 1) {
        (function (bottle) {
          showActionBtn('拾う', function () {
            bottle.collected = true;
            inventory.bottles++;
            showToast('ガラス瓶を入手 (' + inventory.bottles + ')');
            if (GameEngine.playSound) GameEngine.playSound('door');
          });
        })(b);
        return;
      }
    }
  }

  // =========================================================
  //  HIDDEN PHOTO CHECK (E4)
  // =========================================================
  function checkHiddenPhoto() {
    if (dialogueActive || isHiding || actionCallback) return;
    var pg = wToG(player.x, player.y);
    var dist = Math.abs(pg.gx - hiddenPhoto.gx) + Math.abs(pg.gy - hiddenPhoto.gy);
    if (dist <= 1) {
      showActionBtn('壁を調べる', function () {
        hiddenPhoto.found = true;
        inventory.hasPhoto = true;
        if (GameEngine.playSound) GameEngine.playSound('stinger');
        showToast('古い写真を発見した...');
        queueDialogue([
          { speaker: 'あなた', text: '...写真？...まだ普通の青年だった頃のハルキ...？' }
        ]);
      });
    }
  }

  // =========================================================
  //  THROW BOTTLE (G3)
  // =========================================================
  var throwActionShown = false;
  function checkThrowBottle() {
    // Only show throw button if no other action is shown and we have bottles
    if (actionCallback || dialogueActive) {
      throwActionShown = false;
      return;
    }
    if (inventory.bottles > 0 && !throwActionShown) {
      // We show the throw button passively — player can use it anytime
      // But only when no other action is active
    }
  }

  function throwBottle() {
    if (inventory.bottles <= 0) return;
    inventory.bottles--;
    // Calculate throw target: 5 tiles in player's facing direction
    var targetX = player.x + Math.cos(player.angle) * TS * 5;
    var targetY = player.y + Math.sin(player.angle) * TS * 5;
    // Clamp to map bounds
    targetX = Math.max(TS, Math.min(targetX, (MAP_W - 1) * TS));
    targetY = Math.max(TS, Math.min(targetY, (MAP_H - 1) * TS));
    if (GameEngine.playPositionalSound) {
      GameEngine.playPositionalSound('glass_rattle', targetX, targetY);
    } else if (GameEngine.playSound) {
      GameEngine.playSound('door'); // fallback
    }
    showToast('瓶を投げた (残り: ' + inventory.bottles + ')');
    // Alert Haruki toward throw position
    if (haruki.active) {
      harukiAlertLevel = 1.0;
      haruki.lastSeenX = targetX;
      haruki.lastSeenY = targetY;
      haruki.aiState = 'search';
      haruki.searchTimer = 0;
      haruki.path = [];
      haruki.pathTimer = 0;
    }
  }

  // =========================================================
  //  HARUKI AI UPDATE — Patrol / Chase / Search state machine
  // =========================================================
  function updateHaruki(dt) {
    if (!haruki.active) return;

    // --- AUDIO INTEGRATION ---
    if (GameEngine.startEnemyFootsteps) GameEngine.startEnemyFootsteps(0.5);
    if (GameEngine.setEnemyFootstepPosition) GameEngine.setEnemyFootstepPosition(haruki.x, haruki.y);

    var hg = wToG(haruki.x, haruki.y);
    var pg = wToG(player.x, player.y);
    var pdx = player.x - haruki.x;
    var pdy = player.y - haruki.y;
    var pDist = Math.sqrt(pdx * pdx + pdy * pdy);

    // --- SOUND DETECTION (G1) ---
    // Alert level decays over time
    harukiAlertLevel = Math.max(0, harukiAlertLevel - dt * 0.08);

    // Player sprinting generates noise
    if (sprinting && player.moving) {
      noiseTimer -= dt;
      if (noiseTimer <= 0) {
        noiseTimer = 0.5;
        var noiseDist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (noiseDist < TS * 8) {
          harukiAlertLevel = Math.min(1.0, harukiAlertLevel + 0.3);
        }
      }
    }

    // Door opening near Haruki raises alert
    // (checked in checkNearbyDoors when doors open)

    // Alert level triggers
    if (harukiAlertLevel >= 0.8 && haruki.aiState === 'patrol') {
      haruki.aiState = 'search';
      haruki.searchTimer = 0;
      haruki.lastSeenX = player.x;
      haruki.lastSeenY = player.y;
      haruki.path = [];
      haruki.pathTimer = 0;
    } else if (harukiAlertLevel >= 0.5 && haruki.aiState === 'patrol') {
      haruki.aiState = 'search';
      haruki.searchTimer = 0;
      haruki.lastSeenX = player.x;
      haruki.lastSeenY = player.y;
      haruki.path = [];
      haruki.pathTimer = 0;
    }

    // --- VISION CONE (G1-3) ---
    // Use vision cone for sight check instead of raw line of sight
    var canSeePlayer = pDist < haruki.spotRange && harukiCanSeePlayer(pDist);

    // --- HIDING CHECK (G2) ---
    // If player is hiding, Haruki can't see them (already handled in harukiCanSeePlayer)
    // But if Haruki walks within 1 tile of hide spot: 30% chance to detect
    if (isHiding && hidingSpotRef) {
      var hideDistX = Math.abs(hg.gx - hidingSpotRef.gx);
      var hideDistY = Math.abs(hg.gy - hidingSpotRef.gy);
      if (hideDistX + hideDistY <= 1) {
        // Check if Haruki discovers player
        if (!phaseFlags.harukiCheckingHideSpot) {
          phaseFlags.harukiCheckingHideSpot = true;
          phaseFlags.harukiCheckTimer = 3.0;
          if (Math.random() < 0.3) {
            // Will find player after check
            phaseFlags.harukiWillFind = true;
          } else {
            phaseFlags.harukiWillFind = false;
          }
        }
      }
    }
    if (phaseFlags.harukiCheckingHideSpot) {
      phaseFlags.harukiCheckTimer -= dt;
      if (phaseFlags.harukiCheckTimer <= 0) {
        phaseFlags.harukiCheckingHideSpot = false;
        if (phaseFlags.harukiWillFind && isHiding) {
          // Found! Force unhide
          isHiding = false;
          hideTimer = 0;
          hidingSpotRef = null;
          if (GameEngine.vignetteIntensity !== undefined) GameEngine.vignetteIntensity = 0;
          canSeePlayer = true;
        }
      }
    }

    // --- STATE TRANSITIONS ---
    switch (haruki.aiState) {
      case 'patrol':
        if (canSeePlayer) {
          haruki.aiState = 'chase';
          haruki.lostSightTimer = 0;
          haruki.lastSeenX = player.x;
          haruki.lastSeenY = player.y;
          haruki.path = [];
          haruki.pathTimer = 0;
        }
        break;

      case 'chase':
        if (canSeePlayer) {
          haruki.lostSightTimer = 0;
          haruki.lastSeenX = player.x;
          haruki.lastSeenY = player.y;
        } else {
          haruki.lostSightTimer += dt;
          if (haruki.lostSightTimer > 3.0) {
            // Lost sight for 3 seconds → search last known position
            haruki.aiState = 'search';
            haruki.searchTimer = 0;
            haruki.path = [];
            haruki.pathTimer = 0;
          }
        }
        break;

      case 'search':
        if (canSeePlayer) {
          haruki.aiState = 'chase';
          haruki.lostSightTimer = 0;
          haruki.lastSeenX = player.x;
          haruki.lastSeenY = player.y;
          haruki.path = [];
          haruki.pathTimer = 0;
        } else {
          haruki.searchTimer += dt;
          if (haruki.searchTimer > 8.0) {
            // Gave up searching → resume patrol
            haruki.aiState = 'patrol';
            haruki.path = [];
            haruki.pathTimer = 0;
          }
        }
        break;
    }

    // --- STATE BEHAVIOR ---
    var currentSpeed;
    switch (haruki.aiState) {
      case 'patrol':
        currentSpeed = haruki.speed;
        haruki.pathTimer -= dt;
        if (haruki.pathTimer <= 0) {
          haruki.pathTimer = 1.0;
          var wp = patrolPoints[haruki.patrolIndex];
          haruki.path = findPathForHaruki(hg.gx, hg.gy, wp.gx, wp.gy) || [];
          if (haruki.path.length > 0) haruki.path.shift();
        }
        // Check if reached patrol waypoint
        if (haruki.path.length === 0) {
          haruki.patrolIndex = (haruki.patrolIndex + 1) % patrolPoints.length;
          haruki.pathTimer = 0; // recalc immediately
        }
        break;

      case 'chase':
        currentSpeed = haruki.chaseSpeed;
        haruki.pathTimer -= dt;
        if (haruki.pathTimer <= 0) {
          haruki.pathTimer = 0.3; // faster repath during chase
          haruki.path = findPathForHaruki(hg.gx, hg.gy, pg.gx, pg.gy) || [];
          if (haruki.path.length > 0) haruki.path.shift();
        }
        break;

      case 'search':
        currentSpeed = haruki.speed;
        haruki.pathTimer -= dt;
        if (haruki.pathTimer <= 0) {
          haruki.pathTimer = 1.0;
          var lastG = wToG(haruki.lastSeenX, haruki.lastSeenY);
          haruki.path = findPathForHaruki(hg.gx, hg.gy, lastG.gx, lastG.gy) || [];
          if (haruki.path.length > 0) haruki.path.shift();
        }
        break;

      default:
        currentSpeed = haruki.speed;
    }

    // --- FOLLOW PATH with wall collision ---
    if (haruki.path.length > 0) {
      var next = haruki.path[0];
      var target = gToW(next.gx, next.gy);
      var ddx = target.x - haruki.x;
      var ddy = target.y - haruki.y;
      var dist = Math.sqrt(ddx * ddx + ddy * ddy);

      if (dist < TS * 0.3) {
        // Arrived at waypoint — snap only if walkable
        if (canHarukiMoveTo(target.x, target.y)) {
          haruki.x = target.x;
          haruki.y = target.y;
        }
        haruki.path.shift();
      } else {
        var nx = ddx / dist;
        var ny = ddy / dist;
        var stepDist = currentSpeed * dt;
        // Clamp step to remaining distance to avoid overshoot
        if (stepDist > dist) stepDist = dist;
        var moveX = nx * stepDist;
        var moveY = ny * stepDist;

        // Separate X/Y collision
        var movedX = false, movedY = false;
        if (moveX !== 0 && canHarukiMoveTo(haruki.x + moveX, haruki.y)) {
          haruki.x += moveX;
          movedX = true;
        }
        if (moveY !== 0 && canHarukiMoveTo(haruki.x, haruki.y + moveY)) {
          haruki.y += moveY;
          movedY = true;
        }

        // If completely stuck, repath immediately
        if (!movedX && !movedY && (moveX !== 0 || moveY !== 0)) {
          haruki.pathTimer = 0;
        }

        // Update facing direction
        if (Math.abs(nx) > Math.abs(ny)) {
          haruki.dir = nx > 0 ? 'right' : 'left';
        } else {
          haruki.dir = ny > 0 ? 'down' : 'up';
        }
        // Update facing angle for vision cone
        harukiFacingAngle = Math.atan2(ny, nx);
      }

      // Haruki opens closed unlocked doors he walks near
      var hgNow = wToG(haruki.x, haruki.y);
      for (var di = 0; di < doors.length; di++) {
        var dd = doors[di];
        if (!dd.open && !dd.locked && Math.abs(dd.gx - hgNow.gx) + Math.abs(dd.gy - hgNow.gy) <= 1) {
          dd.open = true;
        }
      }
    }

    // --- PROXIMITY audio ---
    var maxProxDist = 400;
    var proximity = Math.max(0, 1 - pDist / maxProxDist);
    GameEngine.setProximity(proximity);

    // --- BGM layers based on AI state ---
    if (GameEngine.setBGMLayers) {
      if (haruki.aiState === 'chase') {
        GameEngine.setBGMLayers({drone: 0.5, dissonance: 0.4, melody: 0, pulse: 0.5});
      } else if (haruki.aiState === 'search') {
        GameEngine.setBGMLayers({drone: 0.45, dissonance: 0.25, melody: 0.05, pulse: 0.15});
      } else {
        GameEngine.setBGMLayers({drone: 0.4, dissonance: 0.15, melody: 0.1, pulse: 0});
      }
    }

    // --- CATCH check (skip if hiding) ---
    if (pDist < haruki.catchRadius && !isHiding) {
      onHarukiCatchPlayer();
    }
  }

  function onHarukiCatchPlayer() {
    haruki.active = false;
    if (GameEngine.stopEnemyFootsteps) GameEngine.stopEnemyFootsteps();
    GameEngine.setProximity(0);
    GameEngine.stopAll();
    GameEngine.playSound('jumpscare');
    GameEngine.shakeScreen(15, 400);
    GameEngine.redFlash();

    var img = GameEngine.images['assets/img/haruki.png'] || null;
    if (img) {
      GameEngine.flashImage(img, 600, function () {
        setPhase(PHASES.GAME_OVER);
      });
    } else {
      setTimeout(function () {
        setPhase(PHASES.GAME_OVER);
      }, 600);
    }
  }

  // =========================================================
  //  RANDOM EVENT SYSTEM (E2)
  // =========================================================
  function updateRandomEvents(dt) {
    if (phase !== PHASES.EXPLORE) return;
    randomEvents.lastEventTime += dt;
    if (randomEvents.lastEventTime < randomEvents.nextEventTime) return;
    randomEvents.lastEventTime = 0;
    randomEvents.nextEventTime = randomEvents.minInterval + Math.random() * (randomEvents.maxInterval - randomEvents.minInterval);

    var eventType = randomEvents.events[Math.floor(Math.random() * randomEvents.events.length)];
    switch (eventType) {
      case 'tv_flicker':
        if (GameEngine.playSound) GameEngine.playSound('static');
        if (GameEngine.staticEffect) GameEngine.staticEffect(0.3);
        setTimeout(function () {
          if (GameEngine.staticEffect) GameEngine.staticEffect(0.08);
        }, 2000);
        break;

      case 'elevator_sound':
        if (GameEngine.playSound) GameEngine.playSound('elevator_hum');
        if (GameEngine.shakeScreen) GameEngine.shakeScreen(3, 800);
        break;

      case 'door_slam':
        // Find nearest open door behind player and close it
        var pg = wToG(player.x, player.y);
        var closestDoor = null;
        var closestDist = Infinity;
        for (var i = 0; i < doors.length; i++) {
          if (doors[i].open && !doors[i].locked) {
            var dd = Math.abs(doors[i].gx - pg.gx) + Math.abs(doors[i].gy - pg.gy);
            if (dd > 1 && dd < 6 && dd < closestDist) {
              closestDist = dd;
              closestDoor = doors[i];
            }
          }
        }
        if (closestDoor) {
          closestDoor.open = false;
          if (GameEngine.playSound) GameEngine.playSound('door');
        }
        break;

      case 'blackout':
        if (GameEngine.vignetteIntensity !== undefined) {
          GameEngine.vignetteIntensity = 1.0;
          if (GameEngine.playSound) GameEngine.playSound('stinger');
          setTimeout(function () {
            if (GameEngine.vignetteIntensity !== undefined) GameEngine.vignetteIntensity = 0;
          }, 5000);
        }
        break;

      case 'distant_footstep':
        var corridorPositions = [
          {gx: 5, gy: 7}, {gx: 14, gy: 7}, {gx: 25, gy: 7},
          {gx: 7, gy: 29}, {gx: 14, gy: 29}, {gx: 24, gy: 29}
        ];
        var rp = corridorPositions[Math.floor(Math.random() * corridorPositions.length)];
        if (GameEngine.playPositionalSound) {
          GameEngine.playPositionalSound('footstep', rp.gx * TS + TS / 2, rp.gy * TS + TS / 2);
        } else if (GameEngine.playSound) {
          GameEngine.playSound('footstep');
        }
        break;

      case 'phone_ring':
        // Only if player on ground floor (gy >= 20)
        var ppg = wToG(player.x, player.y);
        if (ppg.gy >= 20) {
          if (GameEngine.playSound) GameEngine.playSound('phone');
        }
        break;
    }
  }

  // =========================================================
  //  PLAYER MONOLOGUE (E5)
  // =========================================================
  function updatePlayerMonologue(dt) {
    if (phase !== PHASES.EXPLORE || dialogueActive || isHiding) return;
    monologueTimer += dt;
    if (monologueTimer < nextMonologueTime) return;
    monologueTimer = 0;
    nextMonologueTime = 60 + Math.random() * 30;

    var thoughts;
    if (gameTimer > 600) {
      // More desperate after 10 minutes
      thoughts = [
        '（もう時間がない...早くしないと...）',
        '（頼む...もう少しだけ持ってくれ...）',
        '（あいつが...近づいてくる...）',
        '（もうダメかもしれない...でも...）',
        '（誰か...助けて...）'
      ];
    } else {
      thoughts = [
        '（早く出口を見つけないと...）',
        '（あの声...どこから聞こえてくるんだ...）',
        '（鍵...鍵さえあれば...）',
        '（頼む...もう少しだけ持ってくれ...）',
        '（なんでこんなことに...）'
      ];
    }
    var thought = thoughts[Math.floor(Math.random() * thoughts.length)];
    queueDialogue([{ speaker: 'あなた', text: thought }]);
  }

  // =========================================================
  //  PROXIMITY WHISPERS (E5)
  // =========================================================
  function updateProximityWhispers(dt) {
    if (!haruki.active || dialogueActive || isHiding) return;
    if (haruki.aiState === 'chase') return; // no whispers during chase
    var pdx = player.x - haruki.x;
    var pdy = player.y - haruki.y;
    var pDist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pDist > TS * 3) {
      whisperCooldown = 0;
      return;
    }
    whisperCooldown += dt;
    if (whisperCooldown < 8) return; // min 8 sec between whispers
    whisperCooldown = 0;

    var whispers = [
      '...すぐそこにいるわ♡',
      '...見えてるわよぉ...',
      '...ふふっ...'
    ];
    var w = whispers[Math.floor(Math.random() * whispers.length)];
    // Auto-dismiss after 2 seconds
    GameEngine.showDialogue('ハルキ', w, function () {});
    dialogueActive = true;
    setTimeout(function () {
      GameEngine.hideDialogue();
      dialogueActive = false;
    }, 2000);
  }

  // =========================================================
  //  GAME TIMER & DYNAMIC DIFFICULTY UPDATE (G4)
  // =========================================================
  function updateGameTimer(dt) {
    if (phase !== PHASES.EXPLORE && phase !== PHASES.CHASE_1) return;
    gameTimer += dt;

    // Bad ending at 15 minutes
    if (gameTimer >= 900 && !badEndingTriggered) {
      badEndingTriggered = true;
      triggerBadEnding();
      return;
    }

    // Haruki gets faster every minute (cap at 185)
    if (haruki.active && haruki.chaseSpeed < 185) {
      haruki.chaseSpeed += 2 * dt / 60;
      if (haruki.chaseSpeed > 185) haruki.chaseSpeed = 185;
    }

    // Spot range increases every 3 minutes (cap at TS*10)
    var targetBoosts = Math.floor(gameTimer / 180);
    if (targetBoosts > difficultyRangeBoosts && haruki.spotRange < TS * 10) {
      difficultyRangeBoosts = targetBoosts;
      haruki.spotRange += TS * 0.5;
      if (haruki.spotRange > TS * 10) haruki.spotRange = TS * 10;
    }
  }

  function triggerBadEnding() {
    setPhase(PHASES.BAD_ENDING);
  }

  // =========================================================
  //  SCRIPTED BLACKOUT EVENT (E3)
  // =========================================================
  function updateBlackoutEvent(dt) {
    if (phase !== PHASES.EXPLORE) return;
    if (blackoutEventTriggered) return;
    if (phaseTimer <= 420) return; // 7 minutes

    blackoutEventTriggered = true;
    scriptedEvents.blackoutTriggered = true;
    scriptedEvents.blackoutTimer = 8.0;

    if (GameEngine.vignetteIntensity !== undefined) GameEngine.vignetteIntensity = 1.0;
    // Footsteps getting closer
    var stepCount = 0;
    var stepInterval = setInterval(function () {
      if (GameEngine.playSound) GameEngine.playSound('footstep');
      stepCount++;
      if (stepCount >= 8) {
        clearInterval(stepInterval);
        if (GameEngine.playSound) GameEngine.playSound('stinger');
        setTimeout(function () {
          if (GameEngine.vignetteIntensity !== undefined) GameEngine.vignetteIntensity = 0;
          scriptedEvents.blackoutTriggered = false;
        }, 500);
      }
    }, 1000);
  }

  // =========================================================
  //  PHASE-SPECIFIC UPDATE LOGIC
  // =========================================================
  function updatePhase(dt) {
    phaseTimer += dt;

    switch (phase) {
      case PHASES.FRONT_DESK:
        updateFrontDesk(dt);
        break;
      case PHASES.WALK_TO_ROOM:
        updateWalkToRoom(dt);
        break;
      case PHASES.ENTER_ROOM:
        updateEnterRoom(dt);
        break;
      case PHASES.EXPLORE:
        updateExplore(dt);
        break;
      case PHASES.CHASE_1:
        updateChase1(dt);
        break;
      case PHASES.CHASE_FINAL:
        updateChaseFinal(dt);
        break;
    }
  }

  function updateFrontDesk(dt) {
    // After 3 seconds, phone rings
    if (phaseTimer > 3 && !phoneRinging) {
      phoneRinging = true;
      GameEngine.startLoop('phone');
      phaseFlags.phoneLoopStarted = true;
    }

    // Show action button when near front desk
    if (phoneRinging && !phaseFlags.actionShown) {
      var pg = wToG(player.x, player.y);
      // Front desk tiles are around (6-8, 25)
      if (pg.gy >= 24 && pg.gy <= 26 && pg.gx >= 5 && pg.gx <= 9) {
        showActionBtn('電話に出る', function () {
          try { GameEngine.stopLoop('phone'); } catch(e) {}
          phoneRinging = false;
          phaseFlags.actionShown = true;
          setPhase(PHASES.PHONE_CALL);
        });
      }
    }
  }

  function updateWalkToRoom(dt) {
    // Creepy sounds during walk
    if (phaseFlags.creepySoundTimer !== undefined) {
      phaseFlags.creepySoundTimer -= dt;
      if (phaseFlags.creepySoundTimer <= 0) {
        // Random creepy sound
        var sounds = ['footstep', 'knock', 'door'];
        GameEngine.playSound(sounds[Math.floor(Math.random() * sounds.length)]);
        phaseFlags.creepySoundTimer = 8 + Math.random() * 12;
      }
    }

    // Flickering flashlight occasionally
    if (Math.random() < 0.002) {
      player.flashlightFlicker = 0.3;
      setTimeout(function () { player.flashlightFlicker = 0; }, 200);
    }

    // Check if player is near Room 404 door
    var pg = wToG(player.x, player.y);
    var d404 = findDoor('404');
    if (d404) {
      var dist = Math.abs(pg.gx - d404.gx) + Math.abs(pg.gy - d404.gy);
      if (dist <= 2 && !phaseFlags.knockShown) {
        phaseFlags.knockShown = true;
        showActionBtn('ノックする', function () {
          phaseFlags.knockShown = false;
          GameEngine.playSound('knock');
          setTimeout(function () {
            d404.locked = false;
            d404.open = true;
            GameEngine.playSound('door');
            setPhase(PHASES.ENTER_ROOM);
          }, 800);
        });
      } else if (dist > 3 && phaseFlags.knockShown) {
        phaseFlags.knockShown = false;
        hideActionBtn();
      }
    }
  }

  function updateEnterRoom(dt) {
    if (phaseFlags.dialogueDone) {
      phaseFlags.roomTimer += dt;
      // After 5 seconds, or if player tries to leave
      var pg = wToG(player.x, player.y);
      var inRoom = (MAP_TILES[pg.gy] && MAP_TILES[pg.gy][pg.gx] === TILE.ROOM404);
      var nearDoor = (pg.gy <= 10); // near the corridor

      if (phaseFlags.roomTimer > 5 || (phaseFlags.roomTimer > 2 && !inRoom)) {
        setPhase(PHASES.ATTACK);
      }
    }
  }

  function updateExplore(dt) {
    // --- Wake-up effects (E3) ---
    if (scriptedEvents.wakeUpBlurry) {
      scriptedEvents.wakeUpBlurTimer -= dt;
      if (GameEngine.chromaticLevel !== undefined) {
        GameEngine.chromaticLevel = Math.max(0, 0.8 * (scriptedEvents.wakeUpBlurTimer / 3.0));
      }
      if (scriptedEvents.wakeUpBlurTimer <= 0) {
        scriptedEvents.wakeUpBlurry = false;
        if (GameEngine.chromaticLevel !== undefined) GameEngine.chromaticLevel = 0;
      }
    }
    if (scriptedEvents.wakeUpStagger) {
      scriptedEvents.wakeUpStaggerTimer -= dt;
      if (scriptedEvents.wakeUpStaggerTimer <= 0) {
        scriptedEvents.wakeUpStagger = false;
        player.speed = 120; // restore normal speed
      }
    }

    // Random creepy events
    creepyEventTimer -= dt;
    if (creepyEventTimer <= 0) {
      triggerCreepyEvent();
      creepyEventTimer = 10 + Math.random() * 10;
    }

    // Random event system (E2)
    updateRandomEvents(dt);

    // Game timer & difficulty (G4)
    updateGameTimer(dt);

    // Player monologue (E5)
    updatePlayerMonologue(dt);

    // Proximity whispers (E5)
    updateProximityWhispers(dt);

    // Blackout event at 7 minutes (E3)
    updateBlackoutEvent(dt);

    // Flashlight flicker variation
    player.flashlightFlicker = 0.3 + Math.sin(phaseTimer * 2.5) * 0.15;
    if (Math.random() < 0.003) {
      player.flashlightFlicker = 1.0;
      setTimeout(function () { player.flashlightFlicker = 0.3; }, 150);
    }

    // Spawn Haruki after 25 seconds of exploring (slow patrol mode)
    if (phaseTimer > 25 && !haruki.active && !phaseFlags.harukiSpawned) {
      phaseFlags.harukiSpawned = true;
      // Spawn far from player
      var pg = wToG(player.x, player.y);
      var spawnPoints = [
        { gx: 14, gy: 7 },  // upper corridor center
        { gx: 1, gy: 7 },   // upper corridor left
        { gx: 28, gy: 7 },  // upper corridor right
        { gx: 14, gy: 25 }  // ground floor
      ];
      // Pick furthest spawn from player
      var best = spawnPoints[0];
      var bestDist = 0;
      for (var s = 0; s < spawnPoints.length; s++) {
        var sd = Math.abs(spawnPoints[s].gx - pg.gx) + Math.abs(spawnPoints[s].gy - pg.gy);
        if (sd > bestDist) {
          bestDist = sd;
          best = spawnPoints[s];
        }
      }
      var sp = gToW(best.gx, best.gy);
      haruki.x = sp.x;
      haruki.y = sp.y;
      haruki.active = true;
      haruki.visible = true;
      haruki.chaseIntensity = 0.5; // slow patrol during explore
      haruki.path = [];
      haruki.pathTimer = 0;
      GameEngine.startLoop('heartbeat');
      queueDialogue([
        { speaker: 'ハルキ', text: 'ねぇ〜？どこに隠れてるのぉ〜？出てきなさいよぉ〜！' }
      ]);
    }

    // Update Haruki if active (slow patrol during explore)
    if (haruki.active) {
      updateHaruki(dt);

      // Periodic shouts from Haruki (E5 expanded to 15)
      if (!phaseFlags.harukiShoutTimer) phaseFlags.harukiShoutTimer = 12 + Math.random() * 8;
      phaseFlags.harukiShoutTimer -= dt;
      if (phaseFlags.harukiShoutTimer <= 0 && !dialogueActive) {
        phaseFlags.harukiShoutTimer = 15 + Math.random() * 15;
        var shouts = [
          'ねぇ〜？どこにいるのぉ〜？',
          'かくれんぼは終わりよぉ〜♡',
          'あたしから逃げられると思ってるのぉ？うふふ',
          'ねぇってばぁ〜！無視しないでよぉ〜！',
          '出てきなさいよぉ...怒るわよぉ？',
          'あら〜...こっちかしらぁ？',
          'もぉ〜...じらさないでよぉ〜♡',
          'あなたの匂い...するわよぉ〜うふふふ',
          'ねぇねぇ♡ あたしと遊びましょうよぉ〜',
          'この暗闇の中、あたしだけがあなたを見てるのよぉ♡',
          'どこに隠れても無駄よぉ？ あなたの匂い、分かるもの♡',
          '昔ね、ここに素敵な人がいたの...あなたも同じ匂いがするわぁ♡',
          'うふふ...足音が聞こえるわ。近いわねぇ♡',
          '出口なんてないわよぉ？ ここはあたしたちの世界♡',
          '怖がらないでぇ♡ あたしは優しいわよぉ...最初はね♡'
        ];
        var shout = shouts[Math.floor(Math.random() * shouts.length)];
        queueDialogue([{ speaker: 'ハルキ', text: shout }]);
      }
    }

    // Check for key card pickup
    if (keyCardItem && !keyCardItem.collected) {
      var pg2 = wToG(player.x, player.y);
      var dist = Math.abs(pg2.gx - keyCardItem.gx) + Math.abs(pg2.gy - keyCardItem.gy);
      if (dist <= 1 && !phaseFlags.keyActionShown) {
        phaseFlags.keyActionShown = true;
        showActionBtn('調べる', function () {
          keyCardItem.collected = true;
          player.hasKey = true;
          phaseFlags.keyActionShown = false;

          // Key card stinger event (E3)
          if (GameEngine.playSound) GameEngine.playSound('stinger');
          if (haruki.active && GameEngine.playPositionalSound) {
            GameEngine.playPositionalSound('jumpscare', haruki.x, haruki.y);
          }
          // Increase Haruki speed
          if (haruki.active) {
            haruki.chaseSpeed += 10;
          }

          queueDialogue([
            { speaker: 'あなた', text: 'カードキーを見つけた！これで出口を...' }
          ], function () {
            setPhase(PHASES.CHASE_1);
          });
        });
      } else if (dist > 2) {
        if (phaseFlags.keyActionShown) {
          phaseFlags.keyActionShown = false;
          hideActionBtn();
        }
      }
    }
  }

  function updateChase1(dt) {
    updateHaruki(dt);
    updateGameTimer(dt);

    // Set BGM layers for chase
    if (GameEngine.setBGMLayers) {
      GameEngine.setBGMLayers({drone: 0.5, dissonance: 0.4, melody: 0, pulse: 0.5});
    }

    // Periodic chase shouts (E5 expanded to 12)
    if (!phaseFlags.harukiShoutTimer) phaseFlags.harukiShoutTimer = 8 + Math.random() * 5;
    phaseFlags.harukiShoutTimer -= dt;
    if (phaseFlags.harukiShoutTimer <= 0 && !dialogueActive) {
      phaseFlags.harukiShoutTimer = 10 + Math.random() * 10;
      var chaseShouts = [
        '逃げても無駄よぉ〜♡',
        'もうすぐ捕まえちゃうわよぉ〜！',
        '待ちなさいよぉ〜！あたしを置いていかないでぇ！',
        'あはははっ！楽しいわねぇ〜このかくれんぼ！',
        'そっちに行ったわねぇ〜♡',
        'ねぇ...ずっと一緒にいましょうよぉ〜',
        '逃げても無駄よぉ〜♡ あたしの方が速いんだからぁ！',
        'きゃはは！走ってる姿も可愛いわぁ♡',
        '捕まえたらぎゅーってしてあげるわ♡ 骨が折れるくらいにね♡',
        'お願い待ってぇ！あたしを一人にしないでぇ！',
        'あはっ！心臓の音が聞こえるわ！ドキドキしてるのねぇ♡',
        'もうすぐ...もうすぐよぉ♡ あたしの手が届くわ！'
      ];
      var s = chaseShouts[Math.floor(Math.random() * chaseShouts.length)];
      queueDialogue([{ speaker: 'ハルキ', text: s }]);
    }

    // Flashlight flicker intensifies
    player.flashlightFlicker = 0.4 + Math.sin(phaseTimer * 4) * 0.2;

    // --- Pre-exit event (E3): Haruki teleport block ---
    var pg = wToG(player.x, player.y);
    if (!scriptedEvents.preExitBlock && !scriptedEvents.preExitCleared && player.hasKey) {
      var exitDistG = Math.abs(pg.gx - exitDoor.gx) + Math.abs(pg.gy - exitDoor.gy);
      if (exitDistG <= 3 && pg.gy >= 34) {
        scriptedEvents.preExitBlock = true;
        scriptedEvents.preExitTimer = 5.0;
        // Teleport Haruki between player and exit
        var blockGx = Math.min(28, Math.max(26, pg.gx));
        var blockGy = Math.min(38, pg.gy + 1);
        var blockPos = gToW(blockGx, blockGy);
        haruki.x = blockPos.x;
        haruki.y = blockPos.y;
        haruki.path = [];
        haruki.pathTimer = 2;
        if (GameEngine.playSound) GameEngine.playSound('stinger');
        queueDialogue([
          { speaker: 'ハルキ', text: 'どこに行くのぉ？ ここから出さないわよぉ♡' }
        ]);
      }
    }
    if (scriptedEvents.preExitBlock) {
      scriptedEvents.preExitTimer -= dt;
      if (scriptedEvents.preExitTimer <= 0) {
        scriptedEvents.preExitBlock = false;
        scriptedEvents.preExitCleared = true;
        // Haruki resumes normal chase
        haruki.path = [];
        haruki.pathTimer = 0;
      }
    }

    // Check if player reaches exit area
    if (pg.gy >= 36 && pg.gx >= 25 && pg.gx <= 28) {
      // Near exit door
      var dist = Math.abs(pg.gx - exitDoor.gx) + Math.abs(pg.gy - exitDoor.gy);
      if (dist <= 1 && player.hasKey && !phaseFlags.exitActionShown) {
        phaseFlags.exitActionShown = true;
        showActionBtn('脱出する', function () {
          setPhase(PHASES.CHASE_FINAL);
        });
      }
    }
  }

  function updateChaseFinal(dt) {
    updateHaruki(dt);

    unlockTimer += dt;

    // Unlocking animation - 1.5 seconds
    if (unlockTimer < 1.5) {
      // Show unlocking progress via shaking
      if (Math.random() < 0.3) {
        GameEngine.shakeScreen(2, 50);
      }
    } else {
      // Door opens!
      exitDoor.locked = false;
      exitDoor.open = true;
      unlockingExit = false;
      GameEngine.playSound('door');
      setPhase(PHASES.ENDING);
    }
  }

  function triggerCreepyEvent() {
    var r = Math.random();
    if (r < 0.3) {
      GameEngine.playSound('footstep');
    } else if (r < 0.5) {
      GameEngine.playSound('door');
    } else if (r < 0.7) {
      GameEngine.playSound('knock');
    } else if (r < 0.85) {
      // Intense flicker
      player.flashlightFlicker = 1.0;
      setTimeout(function () { player.flashlightFlicker = 0.3; }, 400);
    } else {
      GameEngine.playSound('static');
      GameEngine.staticEffect(0.15);
    }
  }

  // =========================================================
  //  RENDERING
  // =========================================================
  function renderGame(ctx) {
    // 1. Draw map (raycasting: walls, floor, ceiling)
    GameEngine.drawMap();

    // 2. Draw items as sprites (key card)
    drawItems(ctx);

    // 3. Draw Haruki as sprite (only if active and in range)
    if (haruki.active) {
      var hdx = haruki.x - player.x;
      var hdy = haruki.y - player.y;
      var hDist = Math.sqrt(hdx * hdx + hdy * hdy);
      if (hDist < player.flashlightRadius + 60) {
        GameEngine.drawEntity(haruki);
      }
    }

    // 4. Darkness / vignette
    if (phase !== PHASES.TITLE && phase !== PHASES.GAME_OVER && phase !== PHASES.ENDING) {
      GameEngine.drawDarkness(player.x, player.y, player.flashlightRadius, player.flashlightFlicker);
    }

    // 4.5. Persistent film grain overlay
    GameEngine.staticEffect(0.08);

    // 5. Update visited tile discovery
    if (phase === PHASES.EXPLORE || phase === PHASES.CHASE_1 || phase === PHASES.CHASE_FINAL ||
        phase === PHASES.WALK_TO_ROOM) {
      updateVisitedTiles();
    }

    // 6. Phase overlays
    if (phase === PHASES.CHASE_FINAL && unlockingExit) {
      drawUnlockingOverlay(ctx);
    }
  }

  function drawRoomLabels(ctx) {
    var cam = GameEngine.camera;
    var canvas = ctx.canvas;
    var cx = canvas.width / 2;
    var cy = canvas.height / 2;

    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ccaa66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < roomLabels.length; i++) {
      var rl = roomLabels[i];
      var sx = (rl.gx * TS + TS / 2) - cam.x + cx;
      var sy = (rl.gy * TS + TS / 2) - cam.y + cy;
      // Only draw if on screen
      if (sx > -50 && sx < canvas.width + 50 && sy > -50 && sy < canvas.height + 50) {
        ctx.fillText(rl.text, sx, sy);
      }
    }
    ctx.restore();
  }

  function drawItems(ctx) {
    // Draw key card
    if (keyCardItem && !keyCardItem.collected) {
      keyCardItem.glowPhase += 0.05;
      var pulse = 0.6 + Math.sin(keyCardItem.glowPhase) * 0.4;

      var glowEntity = {
        x: keyCardItem.wx,
        y: keyCardItem.wy,
        w: 30,
        h: 60,
        color: 'rgba(255,220,50,' + (0.5 * pulse) + ')',
        visible: true
      };
      GameEngine.drawEntity(glowEntity);

      var itemEntity = {
        x: keyCardItem.wx,
        y: keyCardItem.wy,
        w: 22,
        h: 22,
        color: 'rgb(255,' + ((200 + 55 * pulse) | 0) + ',0)',
        visible: true
      };
      GameEngine.drawEntity(itemEntity);

      if (GameEngine.drawFloorGlow) {
        GameEngine.drawFloorGlow(keyCardItem.wx, keyCardItem.wy, keyCardItem.glowPhase);
      }
    }

    // Draw uncollected memos as small glowing items
    for (var mi = 0; mi < memos.length; mi++) {
      var m = memos[mi];
      if (m.collected) continue;
      var mwx = m.gx * TS + TS / 2;
      var mwy = m.gy * TS + TS / 2;
      var memoEntity = {
        x: mwx, y: mwy, w: 16, h: 16,
        color: 'rgba(220,200,160,0.7)',
        visible: true
      };
      GameEngine.drawEntity(memoEntity);
    }

    // Draw uncollected bottles as items
    for (var bi = 0; bi < bottleSpawns.length; bi++) {
      var b = bottleSpawns[bi];
      if (b.collected) continue;
      var bwx = b.gx * TS + TS / 2;
      var bwy = b.gy * TS + TS / 2;
      var bottleEntity = {
        x: bwx, y: bwy, w: 12, h: 20,
        color: 'rgba(100,180,200,0.7)',
        visible: true
      };
      GameEngine.drawEntity(bottleEntity);
    }

    // Draw hidden photo interactable (faint glow)
    if (!hiddenPhoto.found && (phase === PHASES.EXPLORE)) {
      var phwx = hiddenPhoto.gx * TS + TS / 2;
      var phwy = hiddenPhoto.gy * TS + TS / 2;
      var photoEntity = {
        x: phwx, y: phwy, w: 8, h: 8,
        color: 'rgba(255,255,200,0.3)',
        visible: true
      };
      GameEngine.drawEntity(photoEntity);
    }
  }

  function drawHarukiEntity(ctx) {
    // In first-person mode, the engine's sprite renderer handles Haruki
    GameEngine.drawEntity(haruki);
  }

  // Track tile discovery each frame
  function updateVisitedTiles() {
    var pg = wToG(player.x, player.y);
    for (var dy = -3; dy <= 3; dy++) {
      for (var dx = -3; dx <= 3; dx++) {
        var vgx = pg.gx + dx;
        var vgy = pg.gy + dy;
        if (vgx >= 0 && vgy >= 0 && vgx < MAP_W && vgy < MAP_H) {
          visitedTiles[vgx + ',' + vgy] = true;
        }
      }
    }
  }

  // Get current objective grid position based on phase
  function getObjective() {
    if (phase === PHASES.WALK_TO_ROOM) {
      // Go to room 404
      var d404 = findDoor('404');
      if (d404) return { gx: d404.gx, gy: d404.gy, label: '404号室' };
      return { gx: 14, gy: 5, label: '404号室' };
    }
    if (phase === PHASES.EXPLORE) {
      // Don't show keycard location — player must find it
      if (keyCardItem && keyCardItem.collected) {
        return { gx: exitDoor.gx, gy: exitDoor.gy, label: '出口' };
      }
      return null; // no objective shown during search
    }
    if (phase === PHASES.CHASE_1) {
      return { gx: exitDoor.gx, gy: exitDoor.gy, label: '出口' };
    }
    if (phase === PHASES.CHASE_FINAL) {
      return { gx: exitDoor.gx, gy: exitDoor.gy, label: '出口' };
    }
    return null;
  }

  var minimapOpen = false;

  function openMinimap() {
    var overlay = document.getElementById('minimapOverlay');
    if (!overlay) return;
    minimapOpen = true;
    overlay.style.display = 'flex';
    GameEngine.paused = true;
    drawExpandedMinimap();
  }

  function closeMinimap() {
    var overlay = document.getElementById('minimapOverlay');
    if (overlay) overlay.style.display = 'none';
    minimapOpen = false;
    GameEngine.paused = false;
  }

  function drawExpandedMinimap() {
    var mmCanvas = document.getElementById('minimapCanvas');
    if (!mmCanvas) return;

    var ts = 6; // tile size in minimap pixels
    mmCanvas.width = MAP_W * ts;
    mmCanvas.height = MAP_H * ts;
    var ctx = mmCanvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, mmCanvas.width, mmCanvas.height);

    // Draw visited tiles
    for (var key in visitedTiles) {
      var parts = key.split(',');
      var gx = parseInt(parts[0]);
      var gy = parseInt(parts[1]);
      var t = MAP_TILES[gy] ? MAP_TILES[gy][gx] : 1;
      var tx = gx * ts;
      var ty = gy * ts;

      switch (t) {
        case TILE.WALL:
        case TILE.WINDOW:
          ctx.fillStyle = '#666';
          break;
        case TILE.DOOR:
          ctx.fillStyle = '#8a6020';
          break;
        case TILE.EXIT_DOOR:
          ctx.fillStyle = '#2a6a2a';
          break;
        case TILE.CARPET:
          ctx.fillStyle = '#3a2a30';
          break;
        case TILE.ELEVATOR:
          ctx.fillStyle = '#555';
          break;
        case TILE.FURNITURE:
          ctx.fillStyle = '#444';
          break;
        default:
          ctx.fillStyle = '#2a2a2a';
      }
      ctx.fillRect(tx, ty, ts, ts);

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.strokeRect(tx, ty, ts, ts);
    }

    // Objective marker (pulsing yellow)
    var obj = getObjective();
    if (obj) {
      var ox = obj.gx * ts + ts / 2;
      var oy = obj.gy * ts + ts / 2;
      // Glow
      ctx.beginPath();
      ctx.arc(ox, oy, ts * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 204, 0, 0.25)';
      ctx.fill();
      // Dot
      ctx.beginPath();
      ctx.arc(ox, oy, ts * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc00';
      ctx.fill();
      // Label
      ctx.font = 'bold ' + (ts * 1.5) + 'px sans-serif';
      ctx.fillStyle = '#ffcc00';
      ctx.textAlign = 'center';
      ctx.fillText(obj.label, ox, oy - ts * 1.8);
    }

    // Player position
    var pg = wToG(player.x, player.y);
    var px = pg.gx * ts + ts / 2;
    var py = pg.gy * ts + ts / 2;

    // Player direction indicator
    var dirLen = ts * 2;
    var dx = Math.cos(player.angle) * dirLen;
    var dy = Math.sin(player.angle) * dirLen;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx, py + dy);
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Player dot
    ctx.beginPath();
    ctx.arc(px, py, ts * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#4488ff';
    ctx.fill();

    // Label
    ctx.font = 'bold ' + (ts * 1.5) + 'px sans-serif';
    ctx.fillStyle = '#4488ff';
    ctx.textAlign = 'center';
    ctx.fillText('現在地', px, py - ts * 1.8);

  }

  function drawUnlockingOverlay(ctx) {
    var canvas = ctx.canvas;
    var progress = Math.min(unlockTimer / 1.5, 1.0);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Progress bar
    var barW = 200;
    var barH = 8;
    var barX = (canvas.width - barW) / 2;
    var barY = canvas.height / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(barX, barY, barW * progress, barH);

    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('解錠中...', canvas.width / 2, barY - 12);

    ctx.restore();
  }

  // =========================================================
  //  MAIN UPDATE CALLBACK
  // =========================================================
  function onUpdate(dt) {
    // Clamp dt to prevent physics explosions
    if (dt > 0.1) dt = 0.1;

    updateLightning(dt);
    updatePlayer(dt);
    updatePhase(dt);

    // Update HUD elements for bottle count
    if (phase === PHASES.EXPLORE || phase === PHASES.CHASE_1) {
      var bottleHud = document.getElementById('bottleCount');
      if (bottleHud) {
        bottleHud.textContent = inventory.bottles > 0 ? '瓶: ' + inventory.bottles : '';
      }
    }
  }

  // =========================================================
  //  MAIN RENDER CALLBACK
  // =========================================================
  function onRender(ctx) {
    if (phase === PHASES.TITLE) {
      // Just draw a dark background behind the title overlay
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    renderGame(ctx);
  }

  // =========================================================
  //  INITIALIZATION
  // =========================================================
  function buildMapData() {
    // Build the map data structure for the engine
    var mapData = {
      width: MAP_W,
      height: MAP_H,
      tiles: MAP_TILES,
      doors: [],
      interactables: []
    };

    // Populate door list for engine
    for (var i = 0; i < doors.length; i++) {
      mapData.doors.push({
        gx: doors[i].gx,
        gy: doors[i].gy,
        locked: doors[i].locked,
        open: doors[i].open
      });
    }
    // Exit door
    mapData.doors.push({
      gx: exitDoor.gx,
      gy: exitDoor.gy,
      locked: exitDoor.locked,
      open: exitDoor.open
    });

    return mapData;
  }

  function initGame() {
    GameEngine.init('gameCanvas');
    initLightningCanvas();
    window.addEventListener('resize', resizeLightningCanvas);

    // Load the map
    var mapData = buildMapData();
    GameEngine.loadMap(mapData);

    // --- FLOOR COLORS ---
    if (GameEngine.floorColors) {
      for (var fy = 0; fy < MAP_H; fy++) {
        for (var fx = 0; fx < MAP_W; fx++) {
          var ft = MAP_TILES[fy][fx];
          var fc = null;
          if (ft === TILE.CARPET) {
            fc = {r:60, g:30, b:25}; // deep red carpet
          } else if (ft === TILE.ROOM404) {
            fc = {r:50, g:15, b:15}; // blood-tinted
          } else if (ft === TILE.UTILITY) {
            fc = {r:45, g:50, b:48}; // cold gray-green
          } else if (ft === TILE.FRONT_DESK) {
            fc = {r:50, g:35, b:25}; // warm carpet
          } else if (ft === TILE.FLOOR && fy >= 31) {
            fc = {r:55, g:40, b:30}; // storage: rusty brown
          }
          if (fc) {
            GameEngine.floorColors[fy * 1000 + fx] = fc;
          }
        }
      }
    }

    // --- POINT LIGHTS ---
    if (GameEngine.addPointLight) {
      var lightIdx = 0;
      // Upper corridor lights (row 7-8)
      for (var lx = 2; lx < MAP_W - 2; lx += 4) {
        var isCorridorTile = MAP_TILES[7][lx] === TILE.CARPET || MAP_TILES[7][lx] === TILE.FLOOR;
        if (isCorridorTile) {
          GameEngine.addPointLight('light_' + lightIdx++, lx, 7, {
            radius: 3, r: 255, g: 230, b: 180, intensity: 0.6,
            flicker: 2 + Math.random() * 3, phase: Math.random() * 6.28
          });
        }
      }
      // Ground floor corridor lights (rows 22-27)
      for (var lx2 = 2; lx2 < MAP_W - 2; lx2 += 4) {
        var isGroundTile = MAP_TILES[25][lx2] !== TILE.WALL;
        if (isGroundTile) {
          GameEngine.addPointLight('light_' + lightIdx++, lx2, 25, {
            radius: 3, r: 255, g: 230, b: 180, intensity: 0.6,
            flicker: 2 + Math.random() * 3, phase: Math.random() * 6.28
          });
        }
      }
      // Back corridor lights (rows 29-30)
      for (var lx3 = 2; lx3 < MAP_W - 2; lx3 += 4) {
        GameEngine.addPointLight('light_' + lightIdx++, lx3, 29, {
          radius: 3, r: 255, g: 230, b: 180, intensity: 0.5,
          flicker: 3 + Math.random() * 4, phase: Math.random() * 6.28
        });
      }
      // Utility/storage dimmer lights with more flicker
      var storageLights = [{gx:2, gy:33}, {gx:8, gy:33}, {gx:13, gy:33}, {gx:18, gy:33}, {gx:23, gy:33}, {gx:27, gy:33}];
      for (var sl = 0; sl < storageLights.length; sl++) {
        GameEngine.addPointLight('light_' + lightIdx++, storageLights[sl].gx, storageLights[sl].gy, {
          radius: 2, r: 200, g: 180, b: 150, intensity: 0.35,
          flicker: 5 + Math.random() * 5, phase: Math.random() * 6.28
        });
      }
      // Stairway lights
      GameEngine.addPointLight('light_' + lightIdx++, 14, 16, {
        radius: 3, r: 220, g: 200, b: 170, intensity: 0.4,
        flicker: 4 + Math.random() * 3, phase: Math.random() * 6.28
      });
      GameEngine.addPointLight('light_' + lightIdx++, 14, 19, {
        radius: 3, r: 220, g: 200, b: 170, intensity: 0.4,
        flicker: 4 + Math.random() * 3, phase: Math.random() * 6.28
      });
    }

    // --- DOOR STYLES ---
    if (GameEngine.doorStyles) {
      // Utility / storage doors: steel
      var steelDoors = ['utility', 'storage1', 'storage2', 'storage3'];
      for (var sd = 0; sd < doors.length; sd++) {
        if (steelDoors.indexOf(doors[sd].label) >= 0) {
          GameEngine.doorStyles[doors[sd].gx + ',' + doors[sd].gy] = 'steel';
        }
      }
      // Exit door: emergency
      GameEngine.doorStyles[exitDoor.gx + ',' + exitDoor.gy] = 'emergency';
    }

    // Tell raycaster which tiles are solid (block rays)
    GameEngine.isTileSolid = function (tile, gx, gy) {
      // Always-solid tiles
      if (tile === TILE.WALL || tile === TILE.FURNITURE || tile === TILE.WINDOW) return true;
      // Closed doors block rays
      if (tile === TILE.DOOR) {
        for (var i = 0; i < doors.length; i++) {
          if (doors[i].gx === gx && doors[i].gy === gy) {
            return !doors[i].open;
          }
        }
        return false; // unlisted door → open
      }
      // Exit door
      if (tile === TILE.EXIT_DOOR) return !exitDoor.open;
      // Elevator
      if (tile === TILE.ELEVATOR) return true;
      return false;
    };

    // Preload images
    Promise.all([
      GameEngine.loadImage('assets/img/haruki.png').then(function (img) {
        GameEngine.images['assets/img/haruki.png'] = img;
      }).catch(function () { /* optional */ }),
      GameEngine.loadImage('assets/img/haruki_scary.png').then(function (img) {
        GameEngine.images['assets/img/haruki_scary.png'] = img;
      }).catch(function () { /* optional */ })
    ]).then(function () {
      // Set up engine callbacks
      GameEngine.onUpdate = onUpdate;
      GameEngine.onRender = onRender;

      // Start at title
      setPhase(PHASES.TITLE);
    });
  }

  // =========================================================
  //  EVENT BINDINGS
  // =========================================================
  function bindEvents() {
    // Title screen start button
    var startBtn = document.getElementById('startBtn');
    if (startBtn) {
      var handleStart = function () {
        if (phase !== PHASES.TITLE) return;

        // First tap: init audio + start BGM/rain
        if (!audioInitialized) {
          GameEngine.initAudio();
          audioInitialized = true;
          startTitleRain();
          startTitleBGM();
          startBtn.textContent = 'ゲームスタート';
          return;
        }

        // Already audio ready but rain/BGM not started (returned to title)
        if (!titleRainNodes) startTitleRain();
        if (!titleBgmNodes) startTitleBGM();

        // Thunder transition
        if (phaseFlags.starting) return;
        phaseFlags.starting = true;
        triggerLightning();
        playBigThunder();
        startBtn.style.opacity = '0';
        startBtn.style.pointerEvents = 'none';
        var ts = document.getElementById('titleScreen');
        setTimeout(function () {
          if (ts) {
            ts.style.transition = 'opacity 1.5s ease-in';
            ts.style.opacity = '0';
          }
          setTimeout(function () {
            setPhase(PHASES.FRONT_DESK);
            if (ts) { ts.style.transition = ''; ts.style.opacity = ''; }
            GameEngine.fadeFromBlack(1000);
          }, 1600);
        }, 800);
      };
      startBtn.addEventListener('click', function (e) {
        e.preventDefault();
        handleStart();
      });
      startBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        handleStart();
      });
    }

    // Phone answer button
    var answerBtn = document.getElementById('answerBtn');
    if (answerBtn) {
      var handleAnswer = function () {
        if (phase !== PHASES.PHONE_CALL) return;
        hideOverlay('phoneUI');
        queueDialogue([
          { speaker: 'ハルキ', text: 'あら〜、フロントさん？404のハルキよぉ〜' },
          { speaker: 'ハルキ', text: 'バスタオルが無いのぉ。届けてくれなぁい？' },
          { speaker: 'あなた', text: '（はぁ...面倒くさいな...）わかりました、すぐお持ちします。' },
          { speaker: 'ハルキ', text: 'やったぁ♡ 待ってるわねぇ〜うふふ' }
        ], function () {
          setPhase(PHASES.WALK_TO_ROOM);
        });
      };
      answerBtn.addEventListener('click', handleAnswer);
      answerBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        handleAnswer();
      });
    }

    // Action button
    var actionBtn = document.getElementById('actionBtn');
    if (actionBtn) {
      var handleAction = function () {
        if (actionCallback) {
          var cb = actionCallback;
          hideActionBtn();
          cb();
        }
      };
      actionBtn.addEventListener('touchstart', function (e) {
        e.stopPropagation();
      }, { passive: true });
      actionBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleAction();
      });
      actionBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleAction();
      });
    }

    // Retry button (game over)
    var retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      var handleRetry = function () {
        hideOverlay('gameOverScreen');
        setPhase(PHASES.WAKE_UP);
      };
      retryBtn.addEventListener('click', handleRetry);
      retryBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        handleRetry();
      });
    }

    // Title return buttons (all ending screens)
    var endingReturnButtons = [
      { id: 'titleReturnBtn', overlay: 'endingScreen' },
      { id: 'trueEndReturnBtn', overlay: 'trueEndingScreen' },
      { id: 'badEndReturnBtn', overlay: 'badEndingScreen' }
    ];
    endingReturnButtons.forEach(function (cfg) {
      var btn = document.getElementById(cfg.id);
      if (btn) {
        var handler = function () {
          hideOverlay(cfg.overlay);
          setPhase(PHASES.TITLE);
        };
        btn.addEventListener('click', handler);
        btn.addEventListener('touchend', function (e) {
          e.preventDefault();
          handler();
        });
      }
    });

    // Joystick handling
    bindJoystick();
    bindMinimap();

    // Settings / pause
    bindSettingsButton();

    // Throw bottle on 'T' key press or via touch
    document.addEventListener('keydown', function (e) {
      if (e.key === 't' || e.key === 'T') {
        if ((phase === PHASES.EXPLORE || phase === PHASES.CHASE_1) && inventory.bottles > 0 && !isHiding && !dialogueActive) {
          throwBottle();
        }
      }
    });
  }

  // =========================================================
  //  VIRTUAL JOYSTICK (touch handled by engine via touch zones)
  // =========================================================
  function bindJoystick() {
    // Touch input is handled by engine.js touch zones.
    // No additional binding needed.
  }

  function bindMinimap() {
    var btn = document.getElementById('minimapBtn');
    var closeBtn = document.getElementById('closeMinimapBtn');
    var overlay = document.getElementById('minimapOverlay');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!minimapOpen) openMinimap();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeMinimap();
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeMinimap();
      });
    }
  }

  // =========================================================
  //  SETTINGS / PAUSE MENU
  // =========================================================
  function bindSettingsButton() {
    var settingsBtn = document.getElementById('settingsBtn');
    var settingsOverlay = document.getElementById('settingsOverlay');
    var closeSettingsBtn = document.getElementById('closeSettingsBtn');
    var volumeSlider = document.getElementById('volumeSlider');
    var bgmSlider = document.getElementById('bgmSlider');
    var seSlider = document.getElementById('seSlider');
    var sensSlider = document.getElementById('sensSlider');
    var returnTitleBtn = document.getElementById('returnTitleFromSettings');

    if (!settingsBtn || !settingsOverlay) return;

    function syncSliders() {
      if (volumeSlider) volumeSlider.value = Math.round(GameEngine.getMasterVolume() * 100);
      if (bgmSlider) bgmSlider.value = Math.round(GameEngine.getBgmVolume() * 100);
      if (seSlider) seSlider.value = Math.round(GameEngine.getSeVolume() * 100);
      if (sensSlider) sensSlider.value = Math.round(lookSensitivity * 100);
      var vl = document.getElementById('volumeValue');
      var bl = document.getElementById('bgmValue');
      var sl = document.getElementById('seValue');
      var snl = document.getElementById('sensValue');
      if (vl) vl.textContent = Math.round(GameEngine.getMasterVolume() * 100) + '%';
      if (bl) bl.textContent = Math.round(GameEngine.getBgmVolume() * 100) + '%';
      if (sl) sl.textContent = Math.round(GameEngine.getSeVolume() * 100) + '%';
      if (snl) snl.textContent = Math.round(lookSensitivity * 100) + '%';
    }

    function openSettings() {
      if (phase === PHASES.TITLE) return;
      settingsOverlay.style.display = 'flex';
      GameEngine.paused = true;
      syncSliders();
    }

    settingsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      openSettings();
    });

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        settingsOverlay.style.display = 'none';
        GameEngine.paused = false;
      });
    }

    if (volumeSlider) {
      volumeSlider.addEventListener('input', function () {
        var v = Math.round(this.value);
        GameEngine.setMasterVolume(v / 100);
        var lbl = document.getElementById('volumeValue');
        if (lbl) lbl.textContent = v + '%';
      });
    }
    if (bgmSlider) {
      bgmSlider.addEventListener('input', function () {
        var v = Math.round(this.value);
        GameEngine.setBgmVolume(v / 100);
        var lbl = document.getElementById('bgmValue');
        if (lbl) lbl.textContent = v + '%';
      });
    }
    if (seSlider) {
      seSlider.addEventListener('input', function () {
        var v = Math.round(this.value);
        GameEngine.setSeVolume(v / 100);
        var lbl = document.getElementById('seValue');
        if (lbl) lbl.textContent = v + '%';
      });
    }
    if (sensSlider) {
      sensSlider.addEventListener('input', function () {
        var v = Math.round(this.value);
        lookSensitivity = v / 100;
        var lbl = document.getElementById('sensValue');
        if (lbl) lbl.textContent = v + '%';
      });
    }

    if (returnTitleBtn) {
      returnTitleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        settingsOverlay.style.display = 'none';
        GameEngine.paused = false;
        setPhase(PHASES.TITLE);
      });
    }
  }

  // =========================================================
  //  WINDOW LOAD
  // =========================================================
  window.addEventListener('load', function () {
    initGame();
    bindEvents();
  });

})();
