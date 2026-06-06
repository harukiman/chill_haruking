/**
 * THE BACKROOMS
 * 一人称モバイル探索ホラー
 *
 * Player no-clips out of reality into Level 0 (The Lobby).
 * Survive HP/SAN/Stamina, find no-clip exits to descend through levels 0–9.
 *
 * Architecture:
 *   - GameEngine handles raycasting, input, audio synthesis, effects.
 *   - game.js owns level data, player state, entity AI, phone UI, save/load.
 */
(function () {
  'use strict';

  // ============================================================
  //  CONSTANTS
  // ============================================================
  var TS = 48;

  // Game state machine
  var ST = {
    TITLE: 'title',
    LOADING: 'loading',
    PLAYING: 'playing',
    DEAD: 'dead',
    ENDED: 'ended'
  };

  // Tile types (unified across all levels)
  // 0 = floor (walkable), 1 = wall (solid+blocks rays)
  // 2 = door (toggle, blocks when closed), 3 = no-clip exit point
  // 4 = pillar/furniture (solid), 5 = item spawn (walkable, may have item)
  // 6 = note spawn (walkable), 7 = water/slow (walkable, slows movement)
  // 8 = wall variant (solid), 9 = pipe (solid in pipe levels)
  // 10 = hazard tile (walkable + damages SAN/HP on touch)
  // 11 = safe zone (walkable, slowly regen HP/SAN, no entities approach)

  // ============================================================
  //  LEVEL DEFINITIONS
  //  Each level: { name, subtitle, theme, mapSpec, spawn, exits, hints }
  // ============================================================

  // Helper: convert string map → 2D int array
  // Chars: '#'=wall, '.'=floor, 'D'=door, 'X'=noclip exit, 'F'=furniture
  //        'i'=item, 'n'=note, '~'=water, '@'=pipe, '!'=hazard, 's'=safe
  //        'P'=player spawn (becomes floor)
  function parseMap(rows) {
    var h = rows.length;
    var w = rows[0].length;
    var tiles = [];
    var spawn = null;
    var noclipExits = [];
    var itemSpots = [];
    var noteSpots = [];
    var hazards = [];
    var safes = [];

    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) {
        var c = rows[y].charAt(x);
        var t = 0;
        switch (c) {
          case '#': t = 1; break;
          case '.': t = 0; break;
          case 'D': t = 2; break;
          case 'X': t = 3; noclipExits.push({ gx: x, gy: y }); break;
          case 'F': t = 4; break;
          case 'i': t = 5; itemSpots.push({ gx: x, gy: y }); break;
          case 'n': t = 6; noteSpots.push({ gx: x, gy: y }); break;
          case '~': t = 7; break;
          case '@': t = 9; break;
          case '!': t = 10; hazards.push({ gx: x, gy: y }); break;
          case 's': t = 11; safes.push({ gx: x, gy: y }); break;
          case 'P': t = 0; spawn = { gx: x, gy: y }; break;
          default:  t = 0; break;
        }
        row.push(t);
      }
      tiles.push(row);
    }
    return {
      tiles: tiles,
      width: w,
      height: h,
      spawn: spawn,
      noclipExits: noclipExits,
      itemSpots: itemSpots,
      noteSpots: noteSpots,
      hazards: hazards,
      safes: safes
    };
  }

  // ── LEVEL 0 — THE LOBBY ─────────────────────────────────
  // 24x24 yellow-walled maze. No entities, slow SAN drain.
  // No-clip exit revealed at center alcove after exploring.
  var LV0_ROWS = [
    '########################',
    '#......###...##........#',
    '#.iF...#.....#...n.....#',
    '#......D.....D.........#',
    '#......#.....#.........#',
    '#####D###..#####D####.##',
    '#....#......#####.....##',
    '#.n..#......##...P....##',
    '#....D......##........##',
    '#....#......##.....F..##',
    '##D###......##........##',
    '#...........##....i...##',
    '#.....#D....DD........##',
    '#.....#X#...##..#####.##',
    '#.....###...##..#...#.##',
    '#......##...##..#.n.#.##',
    '#......#....##..#####.##',
    '######.D.####..........#',
    '#......#.#......n......#',
    '#.i..F.#.#.............#',
    '#......#.#....F........#',
    '#......#.#.............#',
    '#......#.#.............#',
    '########################'
  ];

  // ── LEVEL 1 — HABITABLE ZONE ────────────────────────────
  // Concrete warehouse with crates and pillars
  var LV1_ROWS = [
    '######################',
    '#P.......i.....F.....#',
    '#.FF...........F.....#',
    '#.FF...####....F.....#',
    '#......#..#..........#',
    '#......#.n#...FF.....#',
    '#......####...FF.....#',
    '#............F.F...n.#',
    '#...F..FFFF..........#',
    '#...F........FF......#',
    '##D###.......FF......#',
    '#....#...............#',
    '#.i..#......FF.......#',
    '#....#......FF...i...#',
    '#....D...............#',
    '#....#....FFFF.......#',
    '#....#....FFFF.......#',
    '######...............#',
    '#....................#',
    '#....F.....X.....F...#',
    '#......F.........F...#',
    '######################'
  ];

  // ── LEVEL 2 — PIPE DREAMS ───────────────────────────────
  // Pipe maze with water and dripping
  var LV2_ROWS = [
    '######################',
    '#P~~~~~~........@@@@@#',
    '#.~~~~~~..n.....@...@#',
    '#.~~..~~........@.i.@#',
    '##D####~~~~~~~~~@...@#',
    '#......~~....@@@D@@@@#',
    '#.i....~~....@.......#',
    '#......~~....@..F....#',
    '#...F..~~....@.......#',
    '#......~~....@D####D##',
    '##~~D~~~~~~~~........#',
    '#.~~~~~~~~~~~........#',
    '#.~~~..n.~~~....FF...#',
    '#.~~~....~~~....FF...#',
    '#.~~~~~~~~~~....FF...#',
    '##D###~~~~~~~........#',
    '#....#~~~.......i....#',
    '#.n..#~~~............#',
    '#....D~~~............#',
    '#....#~~~....X.......#',
    '#....#~~~............#',
    '######################'
  ];

  // ── LEVEL 3 — ELECTRICAL STATION ────────────────────────
  // Dark, electric hazards, sparks
  var LV3_ROWS = [
    '####################',
    '#P.....F....!......#',
    '#......F....!......#',
    '#...........!..n...#',
    '#.....#####D####...#',
    '#.....#.........#..#',
    '#.....#..i..F...#..#',
    '#..n..#.........#..#',
    '#.....D.....F...#..#',
    '#.....#.........#..#',
    '#######!!!!!####...#',
    '#.....#......#.....#',
    '#.....#..i...#..F..#',
    '#.....#......#.....#',
    '#..F..D......D..F..#',
    '#.....#......#.....#',
    '######........#####.',
    '#............#.....#',
    '#....F..X....#.n.i.#',
    '#............#.....#',
    '####################'
  ];

  // ── LEVEL 4 — ABANDONED OFFICE ──────────────────────────
  // Office cubicles, Skin-Stealers (mimic dead bodies)
  var LV4_ROWS = [
    '######################',
    '#P..F..F..F..F..F..F.#',
    '#....................#',
    '##D####D####D####D###D',
    '#...##...##...##.....#',
    '#.n.##.i.##...##..F..#',
    '#...DD...DD...DD..F..#',
    '##D####D####D####D###D',
    '#....................#',
    '#..F..F..F..F..F..F..#',
    '#....................#',
    '##D####D####D####D###D',
    '#...##...##...##.....#',
    '#...##.n.##.i.##..F..#',
    '#...DD...DD...DD..F..#',
    '##D####D####D####D###D',
    '#....................#',
    '#..F..F....X...F..F..#',
    '#....................#',
    '######################'
  ];

  // ── LEVEL 5 — THE HOTEL ─────────────────────────────────
  // Long carpet corridor with doors. Partygoers / Mr.Hotel
  var LV5_ROWS = [
    '######################',
    '#......D....D....D...#',
    '#P.F...#....#....#.n.#',
    '#......#.i..#..F.#...#',
    '#......######....#...#',
    '#......#....######...#',
    '#......#....#....#...#',
    '#..n...#....#....D...#',
    '#......D....D........#',
    '#......#....#...F....#',
    '#......######........#',
    '#....................#',
    '#.....################',
    '#......D....D....D...#',
    '#......#....#....#...#',
    '#..i...#.F..#....#.n.#',
    '#......######....#...#',
    '#......#....######...#',
    '#......#....#....#.F.#',
    '#......#....#....#...#',
    '#......D....D....D...#',
    '#.................X..#',
    '######################'
  ];

  // ── LEVEL 6 — LIGHTS OUT (stretch) ──────────────────────
  // Pitch dark, very short fog
  var LV6_ROWS = [
    '##################',
    '#P...............#',
    '#......F....F....#',
    '#................#',
    '#.....######.....#',
    '#.....#....#.....#',
    '#..F..#..i.#..F..#',
    '#.....#....#.....#',
    '#.....D....D.....#',
    '#................#',
    '#......n.........#',
    '#................#',
    '#.....##D###.....#',
    '#.....#....#.....#',
    '#.....#.X..#.....#',
    '#.....######.....#',
    '#................#',
    '##################'
  ];

  // ── LEVEL 7 — RUN FOR YOUR LIFE (chase corridor) ────────
  // Long narrow corridor with Hound pack chasing from spawn end
  var LV7_ROWS = [
    '########',
    '#P.....#',
    '#......#',
    '#..F...#',
    '#......#',
    '#......#',
    '#......#',
    '#....F.#',
    '#......#',
    '#......#',
    '#.i....#',
    '#......#',
    '#......#',
    '#..F...#',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '#..n...#',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '#.....X#',
    '########'
  ];

  // ── LEVEL 9 — THE SUBURBS (stretch, THE END exit) ───────
  // Dark suburban houses, possible THE END
  var LV9_ROWS = [
    '##########################',
    '#P.......................#',
    '#..####....####....####..#',
    '#..#FF#....#..#....#FF#..#',
    '#..#i.#....#.n#....#..#..#',
    '#..#..D....D..D....D..D..#',
    '#..####....####....####..#',
    '#........................#',
    '#........................#',
    '#........................#',
    '#..####....####....####..#',
    '#..#..#....#FF#....#F.#..#',
    '#..#.n#....#..#....#.F#..#',
    '#..#..D....D.i#....D..D..#',
    '#..####....####....####..#',
    '#........................#',
    '#........................#',
    '#........................#',
    '#..####....####....####..#',
    '#..#FF#....#..#....#FF#..#',
    '#..#..#....#X.#....#..#..#',
    '#..#..D....D..D....D..D..#',
    '#..####....####....####..#',
    '##########################'
  ];

  // ── LEVEL THEMES (palette per level) ────────────────────
  var THEMES = {
    0: { // Lobby — mustard yellow
      wall: {
        upper: { 'default': [212, 179, 64], 1: [212, 179, 64], 2: [160, 110, 50] },
        lower: { 'default': [180, 144, 48], 1: [180, 144, 48], 2: [160, 110, 50] },
        pattern: 'stripe',
        splitRatio: 0.55,
        railColor: [110, 88, 24]
      },
      bg: {
        ceiling: ['#f0e9b8', '#d4ccb0', '#9c9070'],
        floor:   ['#3c2e0a', '#544010', '#6a5018']
      },
      floorDefault: [108, 80, 22],
      ceilingDefault: [212, 200, 150],
      floorPattern: 'damp',
      ceilingPattern: 'grid',
      fogDist: 14,
      ambientLoop: 'fluorescent',
      sanDrain: 0.4,
      vignette: 0.25,
      grain: 0.35,
      chromatic: 0.1
    },
    1: { // Habitable Zone — concrete grey
      wall: {
        upper: { 'default': [110, 100, 88], 1: [110, 100, 88] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#222020', '#312f2c', '#494540'],
        floor:   ['#1a1816', '#2a2622', '#3a3530']
      },
      floorDefault: [70, 64, 56],
      ceilingDefault: [55, 52, 48],
      fogDist: 15,
      ambientLoop: 'wind',
      sanDrain: 0.5,
      vignette: 0.35,
      grain: 0.3,
      chromatic: 0.15
    },
    2: { // Pipe Dreams — dark green-blue
      wall: {
        upper: { 'default': [50, 80, 65], 1: [50, 80, 65], 9: [110, 90, 50] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#0a1612', '#15221c', '#1f3028'],
        floor:   ['#0a1410', '#152018', '#202820']
      },
      floorDefault: [30, 48, 38],
      ceilingDefault: [30, 50, 42],
      fogDist: 11,
      ambientLoop: 'pipe_drip',
      sanDrain: 0.7,
      vignette: 0.4,
      grain: 0.3,
      chromatic: 0.2
    },
    3: { // Electrical — dark with blue sparks
      wall: {
        upper: { 'default': [45, 50, 60], 1: [45, 50, 60] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#08080c', '#101018', '#1c1c24'],
        floor:   ['#0a0c10', '#141820', '#1c2030']
      },
      floorDefault: [38, 42, 50],
      ceilingDefault: [22, 26, 34],
      fogDist: 8,
      ambientLoop: 'electric',
      sanDrain: 0.9,
      vignette: 0.55,
      grain: 0.4,
      chromatic: 0.3
    },
    4: { // Office — beige with shadows
      wall: {
        upper: { 'default': [150, 130, 100], 1: [150, 130, 100], 2: [120, 90, 60] },
        lower: { 'default': [100, 84, 60], 1: [100, 84, 60] },
        pattern: 'stripe',
        splitRatio: 0.62,
        railColor: [80, 64, 40]
      },
      bg: {
        ceiling: ['#1a1814', '#252118', '#33301f'],
        floor:   ['#2a241a', '#332a1f', '#3d3525']
      },
      floorDefault: [80, 60, 38],
      ceilingDefault: [55, 48, 36],
      fogDist: 12,
      ambientLoop: 'fluorescent',
      sanDrain: 0.6,
      vignette: 0.4,
      grain: 0.35,
      chromatic: 0.15
    },
    5: { // Hotel — burgundy carpet, gold details
      wall: {
        upper: { 'default': [155, 135, 105], 1: [155, 135, 105], 2: [160, 110, 50] },
        lower: { 'default': [85, 55, 35], 1: [85, 55, 35] },
        pattern: 'grain',
        splitRatio: 0.62,
        railColor: [50, 35, 22]
      },
      bg: {
        ceiling: ['#181614', '#262018', '#302a20'],
        floor:   ['#1c1210', '#2d1815', '#3a2018']
      },
      floorDefault: [60, 25, 22],
      ceilingDefault: [30, 24, 20],
      fogDist: 14,
      ambientLoop: 'fluorescent',
      sanDrain: 0.5,
      vignette: 0.35,
      grain: 0.3,
      chromatic: 0.1
    },
    7: { // Run For Your Life — fast chase, red tint
      wall: {
        upper: { 'default': [80, 30, 30], 1: [80, 30, 30] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#1a0808', '#280c0c', '#3a1414'],
        floor:   ['#100404', '#1c0a0a', '#281414']
      },
      floorDefault: [50, 24, 24],
      ceilingDefault: [40, 18, 18],
      fogDist: 10,
      ambientLoop: 'wind',
      sanDrain: 1.2,
      vignette: 0.5,
      grain: 0.5,
      chromatic: 0.3
    },
    6: { // Lights Out — pitch dark
      wall: {
        upper: { 'default': [60, 55, 50], 1: [60, 55, 50] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#000', '#050505', '#080808'],
        floor:   ['#000', '#080808', '#101010']
      },
      floorDefault: [20, 18, 16],
      ceilingDefault: [10, 10, 10],
      fogDist: 5,
      ambientLoop: 'wind',
      sanDrain: 1.1,
      vignette: 0.7,
      grain: 0.5,
      chromatic: 0.3
    },
    9: { // Suburbs — dark blue/black
      wall: {
        upper: { 'default': [70, 68, 80], 1: [70, 68, 80] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#0a0c1a', '#101428', '#1a2038'],
        floor:   ['#0a0c14', '#141822', '#1c2030']
      },
      floorDefault: [40, 42, 55],
      ceilingDefault: [20, 25, 40],
      fogDist: 13,
      ambientLoop: 'wind',
      sanDrain: 0.8,
      vignette: 0.45,
      grain: 0.3,
      chromatic: 0.2
    }
  };

  // ── LEVEL DESCRIPTORS ───────────────────────────────────
  var LEVELS = {
    0: { id: 0, name: 'LEVEL 0', subtitle: 'THE LOBBY',
         rows: LV0_ROWS, theme: 0,
         hint: '黄色い壁紙の無限の部屋。湿った絨毯。蛍光灯のハム音。',
         intro: 'no-clip して落ちた...ここはどこだ?',
         entities: [],
         timeLimit: null },
    1: { id: 1, name: 'LEVEL 1', subtitle: 'HABITABLE ZONE',
         rows: LV1_ROWS, theme: 1,
         hint: 'コンクリートの倉庫。時折ハウンドが徘徊する。',
         intro: '壁を抜けた...冷たいコンクリートの匂い。',
         entities: [ { type: 'hound', gx: 14, gy: 14 } ],
         timeLimit: null },
    2: { id: 2, name: 'LEVEL 2', subtitle: 'PIPE DREAMS',
         rows: LV2_ROWS, theme: 2,
         hint: '配管の迷路。足元の水が SAN を削る。',
         intro: '配管から水が滴る音。空気が湿っている。',
         entities: [ { type: 'smiler', gx: 12, gy: 12 } ],
         timeLimit: null },
    3: { id: 3, name: 'LEVEL 3', subtitle: 'ELECTRICAL STATION',
         rows: LV3_ROWS, theme: 3,
         hint: '感電する配線あり。火花の音と暗闇。',
         intro: '焦げた匂い...バチバチと火花が散る。',
         entities: [],
         timeLimit: null },
    4: { id: 4, name: 'LEVEL 4', subtitle: 'ABANDONED OFFICE',
         rows: LV4_ROWS, theme: 4,
         hint: 'オフィスのキュービクル。Skin-Stealer が紛れている。',
         intro: '誰もいないオフィス。けれど視線を感じる。',
         entities: [ { type: 'skinstealer', gx: 10, gy: 8 } ],
         timeLimit: null },
    5: { id: 5, name: 'LEVEL 5', subtitle: 'THE HOTEL',
         rows: LV5_ROWS, theme: 5,
         hint: '無数の部屋とドア。Partygoers の声が聞こえる。',
         intro: 'カーペットの廊下...どこかから笑い声。',
         entities: [ { type: 'partygoer', gx: 16, gy: 10 } ],
         timeLimit: null },
    6: { id: 6, name: 'LEVEL 6', subtitle: 'LIGHTS OUT',
         rows: LV6_ROWS, theme: 6,
         hint: '完全な暗闇。視界は極端に短い。',
         intro: '光が消えた。何も見えない。',
         entities: [ { type: 'hound', gx: 8, gy: 8 } ],
         timeLimit: null },
    7: { id: 7, name: 'LEVEL 7', subtitle: 'RUN FOR YOUR LIFE',
         rows: LV7_ROWS, theme: 7,
         hint: '一直線の回廊。背後から複数のHoundが迫る。走れ。',
         intro: '吠え声...近い。前へ走るしかない。',
         entities: [
           { type: 'hound', gx: 4, gy: 2 },
           { type: 'hound', gx: 3, gy: 4 },
           { type: 'hound', gx: 5, gy: 5 }
         ],
         timeLimit: null },
    9: { id: 9, name: 'LEVEL 9', subtitle: 'THE SUBURBS',
         rows: LV9_ROWS, theme: 9,
         hint: '永遠に続く郊外の街。THE END への扉がここに。',
         intro: '空に月はない。月のような何かがある。',
         entities: [ { type: 'partygoer', gx: 12, gy: 12 } ],
         timeLimit: null }
  };

  // ── ITEM DEFINITIONS ────────────────────────────────────
  // Each item type: id, name, icon, description, effect()
  var ITEMS = {
    almond_water: {
      id: 'almond_water', name: 'アーモンドウォーター',
      icon: '🥤', desc: 'バックルームで最も普通の飲料。SAN を回復する。',
      effect: function (p) { p.san = Math.min(p.sanMax, p.san + 35); toast('SAN +35'); }
    },
    bandage: {
      id: 'bandage', name: '応急手当キット',
      icon: '🩹', desc: '出血を止め、HP を大きく回復する。',
      effect: function (p) { p.hp = Math.min(p.hpMax, p.hp + 50); toast('HP +50'); }
    },
    energy_bar: {
      id: 'energy_bar', name: 'エナジーバー',
      icon: '🍫', desc: 'スタミナを満タンにする。',
      effect: function (p) { p.stam = p.stamMax; toast('STA 全回復'); }
    },
    flashlight: {
      id: 'flashlight', name: '懐中電灯',
      icon: '🔦', desc: '暗いレベルで視界を広げる。',
      effect: function (p) {
        if (p.flashlightOn) { p.flashlightOn = false; toast('懐中電灯 OFF'); }
        else { p.flashlightOn = true; toast('懐中電灯 ON'); }
      }
    },
    keycard: {
      id: 'keycard', name: 'カードキー',
      icon: '🔑', desc: 'どこかのドアを解錠できる...かもしれない。',
      effect: function (p) { toast('特定の場所で自動使用'); }
    },
    voucher: {
      id: 'voucher', name: 'ホテル引換券',
      icon: '🎫', desc: 'THE HOTEL で特別な部屋へ案内される。',
      effect: function (p) { toast('特定の場所で自動使用'); }
    },
    radio: {
      id: 'radio', name: '壊れたラジオ',
      icon: '📻', desc: 'ノイズの中に時折声が聞こえる。エンティティを察知できる。',
      effect: function (p) {
        if (p.radioOn) { p.radioOn = false; toast('ラジオ OFF'); }
        else { p.radioOn = true; toast('ラジオ ON — エンティティ警告'); }
      }
    }
  };

  // ── ITEMS POOL BY LEVEL ─────────────────────────────────
  var LEVEL_ITEM_POOLS = {
    0: ['almond_water', 'bandage', 'flashlight'],
    1: ['almond_water', 'bandage', 'energy_bar', 'keycard'],
    2: ['almond_water', 'bandage', 'energy_bar'],
    3: ['almond_water', 'bandage', 'flashlight', 'radio'],
    4: ['almond_water', 'keycard', 'energy_bar', 'radio'],
    5: ['almond_water', 'voucher', 'bandage', 'energy_bar'],
    6: ['almond_water', 'flashlight', 'bandage'],
    7: ['energy_bar', 'almond_water'],
    9: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'radio']
  };

  // ── NOTES ───────────────────────────────────────────────
  var NOTES_POOL = {
    0: [
      { title: 'メモ — 最初の被害者',
        text: '見つけた者へ\n\nもしお前が壁の向こうへ落ちた者なら、これを読んでくれ。\nここは「Level 0」と呼ばれている。最も穏やかな階層だ。\n出口は無い。だが no-clip して壁にめり込めば、別の階層へ降りられる。\n運がよければ。' },
      { title: '湿った絨毯',
        text: '床のシミは血ではない。漏水でもない。\nこの場所が記憶している、誰かの泣き痕だ。\n直視するな。SAN が削れる。' },
      { title: 'アーモンドウォーター',
        text: '見覚えのある飲み物が、見覚えのない壁に置かれている。\n飲める。普通の味だ。\n誰がここに置いたのか、考えるな。' },
      { title: '蛍光灯のリズム',
        text: 'ハム音には法則がある。\n3 回点滅したら近くにエンティティ。\n5 回点滅したら、もう手遅れだ。' }
    ],
    1: [
      { title: '倉庫の住人',
        text: 'Hound に注意。\n見かけたら走るな。動きで反応する。\n壁に貼り付いて呼吸を整えろ。' },
      { title: '居住可能ゾーン',
        text: 'Level 1 は比較的安全だ。\n他の "no-clipper" と出会うこともある。\nもし出会えたら、それは幸運だ。\nもし、向こうから来たら...違うかもしれない。' }
    ],
    2: [
      { title: '配管夢の警告',
        text: '水に長く立つな。\nSAN がゆるやかに削れる。\nそれから...足首から何かが昇ってくる気がするだろう。' },
      { title: 'Smiler',
        text: '暗闇に白い歯だけが浮かぶ。\n見るな。目を逸らせばすり抜ける。\n見続けると...笑いに、引き込まれる。' }
    ],
    3: [
      { title: '通電中',
        text: '床が黒い斑点は、まだ電流が通っている。\n触れるな。HP と SAN を一度に持っていかれる。' },
      { title: 'スパークの法則',
        text: '火花が見えた時、もう避ける時間はない。\nだから、火花が見える前に逃げろ。' }
    ],
    4: [
      { title: 'デスクの落書き',
        text: '"4F 第3キュービクル、奴は私だった"\n誰が書いたのか、思い出せない。\n私の字に似ている。' },
      { title: 'Skin-Stealer',
        text: '床に倒れている同僚。\n声をかけるな。触るな。\n目を合わせるな。\n奴らはお前の皮膚を欲しがっている。' }
    ],
    5: [
      { title: 'チェックイン用紙',
        text: 'THE HOTEL へようこそ。\n部屋は無料です。\nチェックアウトは...自由意志ではありません。' },
      { title: 'Mr. Hotel への警告',
        text: '"スーツの男に名前を尋ねられても、答えるな。\nお前の名前を持っていかれる。"' }
    ],
    6: [
      { title: '完全な暗闇',
        text: '光を消した者がいる。\n誰かがこの階層を「閉じた」のだ。\n懐中電灯がなければ、5 タイル先も見えない。' }
    ],
    7: [
      { title: 'Run For Your Life',
        text: 'この階層に立ち止まった者はいない。\n走れ。\n振り返るな。\n奴らの数は、振り返るたびに増える。' }
    ],
    9: [
      { title: '郊外の終わり',
        text: 'この街には終わりがあるという。\n最後の家のドアを開ければ、そこに...\n何があるのか、誰も戻って報告していない。' },
      { title: 'THE END',
        text: '黒い扉を見つけたら、それが終点だ。\nそこを開けば「TRUE END」へ到達できる。\nだが、開けないという選択肢もある。' }
    ]
  };

  // ============================================================
  //  GAME STATE
  // ============================================================
  var state = ST.TITLE;
  var currentLevel = 0;
  var currentMap = null;     // parsed map
  var currentLevelDef = null;
  var playTime = 0;          // seconds since game start
  var inLevelTime = 0;       // seconds in current level
  var visitedLevels = {};    // {levelId: true}
  var clearedLevels = {};
  var discoveredNotes = [];  // [{levelId, title, text}]
  var discoveredMap = {};    // {levelId: bool[][]}

  // Player state
  var player = {
    x: 0, y: 0, angle: 0,
    hp: 100, hpMax: 100,
    san: 100, sanMax: 100,
    stam: 100, stamMax: 100,
    sprintCooldown: 0,
    inventory: {},          // {itemId: count}
    flashlightOn: false,
    radioOn: false,
    inSafeZone: false,
    inHazard: false,
    inWater: false
  };

  var entities = [];         // current level entities (live, with state)
  var pickedUpItems = {};    // {levelId: {gx_gy: true}}
  var readNotes = {};        // {levelId: {gx_gy: true}}
  var pickupSpots = {};      // {gx_gy: itemId} (this level)
  var noteSpots = {};        // {gx_gy: noteObj}
  var doorStates = {};       // {gx_gy: {open}}

  // Audio
  var audioInitialized = false;
  var currentAmbient = null;

  // Phone UI
  var phoneOpen = false;
  var activeTab = 'Status';

  // Toast
  var toastTimer = null;

  // Save key
  var SAVE_KEY = 'thebackrooms_save_v1';

  // ============================================================
  //  UTILITY
  // ============================================================
  function el(id) { return document.getElementById(id); }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function gridKey(gx, gy) { return gx + '_' + gy; }

  function toast(msg, duration) {
    duration = duration || 2200;
    var t = el('toastNotification');
    var txt = el('toastText');
    if (!t || !txt) return;
    txt.textContent = msg;
    t.style.display = 'block';
    requestAnimationFrame(function () {
      t.classList.add('show');
    });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.style.display = 'none'; }, 300);
    }, duration);
  }

  function showOverlay(id) {
    var e = el(id);
    if (e) e.style.display = 'flex';
  }
  function hideOverlay(id) {
    var e = el(id);
    if (e) e.style.display = 'none';
  }

  function formatTime(sec) {
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  // ============================================================
  //  LEVEL LOADING
  // ============================================================
  function buildLevelMap(levelId) {
    var def = LEVELS[levelId];
    if (!def) return null;
    var parsed = parseMap(def.rows);

    // Assign random item types from level pool to item spots
    var pool = LEVEL_ITEM_POOLS[levelId] || ['almond_water'];
    pickupSpots = {};
    for (var i = 0; i < parsed.itemSpots.length; i++) {
      var spot = parsed.itemSpots[i];
      var key = gridKey(spot.gx, spot.gy);
      // Skip if already picked up in this run
      if (pickedUpItems[levelId] && pickedUpItems[levelId][key]) continue;
      var itemId = pool[Math.floor(Math.random() * pool.length)];
      pickupSpots[key] = itemId;
    }

    // Assign notes
    var notesPool = NOTES_POOL[levelId] || [];
    noteSpots = {};
    for (var ni = 0; ni < parsed.noteSpots.length && ni < notesPool.length; ni++) {
      var ns = parsed.noteSpots[ni];
      var nkey = gridKey(ns.gx, ns.gy);
      noteSpots[nkey] = notesPool[ni];
    }

    return parsed;
  }

  function setLevel(levelId, instant) {
    var def = LEVELS[levelId];
    if (!def) {
      console.error('Unknown level', levelId);
      return;
    }
    currentLevel = levelId;
    currentLevelDef = def;
    visitedLevels[levelId] = true;
    inLevelTime = 0;

    // Build map
    currentMap = buildLevelMap(levelId);
    GameEngine.loadMap(currentMap);

    // Apply theme
    var theme = THEMES[def.theme] || THEMES[0];
    GameEngine.theme = theme;
    GameEngine.grainIntensity = theme.grain || 0.3;
    GameEngine.chromaticLevel = theme.chromatic || 0;
    GameEngine.vignetteIntensity = theme.vignette || 0.3;

    // Door states for this level
    doorStates = {};
    for (var dy = 0; dy < currentMap.height; dy++) {
      for (var dx = 0; dx < currentMap.width; dx++) {
        if (currentMap.tiles[dy][dx] === 2) {
          doorStates[gridKey(dx, dy)] = { open: false, locked: false };
        }
      }
    }

    // Discovered map for this level
    if (!discoveredMap[levelId]) {
      discoveredMap[levelId] = [];
      for (var y = 0; y < currentMap.height; y++) {
        var row = [];
        for (var x = 0; x < currentMap.width; x++) row.push(false);
        discoveredMap[levelId].push(row);
      }
    }

    // Place player
    var spawn = currentMap.spawn || { gx: 1, gy: 1 };
    player.x = spawn.gx * TS + TS / 2;
    player.y = spawn.gy * TS + TS / 2;
    player.angle = 0;
    player.inSafeZone = false;
    player.inHazard = false;
    player.inWater = false;
    GameEngine.setPlayerView(player.x, player.y, player.angle);

    // Entities for this level
    entities = [];
    if (def.entities) {
      for (var ei = 0; ei < def.entities.length; ei++) {
        var ent = def.entities[ei];
        entities.push({
          type: ent.type,
          x: ent.gx * TS + TS / 2,
          y: ent.gy * TS + TS / 2,
          angle: 0,
          state: 'wander',
          stateTimer: 0,
          targetX: ent.gx * TS + TS / 2,
          targetY: ent.gy * TS + TS / 2,
          alive: true,
          hp: 100,
          color: getEntityColor(ent.type),
          bodyColor: '#000000'
        });
      }
    }

    // Add point lights for visibility (per-level pattern)
    GameEngine.pointLights = [];
    addLevelLights(levelId);

    // Audio: ambient loop per level
    if (audioInitialized) {
      GameEngine.stopLoop('ambient');
      GameEngine.stopLoop('fluorescent');
      GameEngine.stopLoop('pipe_drip');
      GameEngine.stopLoop('electric');
      GameEngine.stopLoop('wind');
      if (currentAmbient) GameEngine.stopLoop(currentAmbient);
      currentAmbient = theme.ambientLoop;
      if (currentAmbient) GameEngine.startLoop(currentAmbient);
    }

    // Loading screen
    if (!instant) {
      showLoadingScreen(def);
      setTimeout(function () {
        hideOverlay('loadingScreen');
        startPlaying();
      }, 1800);
    } else {
      startPlaying();
    }
  }

  function getEntityColor(type) {
    switch (type) {
      case 'hound': return '#2a1810';
      case 'smiler': return '#f0f0f0';
      case 'skinstealer': return '#a08070';
      case 'partygoer': return '#502828';
      default: return '#444';
    }
  }

  function addLevelLights(levelId) {
    if (!GameEngine.addPointLight) return;
    var m = currentMap;
    var theme = THEMES[currentLevelDef.theme];

    // Level-specific light patterns
    if (levelId === 0) {
      // Lobby — ceiling fluorescents in a grid every 4 tiles
      var idx = 0;
      for (var gy = 2; gy < m.height; gy += 4) {
        for (var gx = 2; gx < m.width; gx += 4) {
          if (m.tiles[gy][gx] === 0) {
            GameEngine.addPointLight('l_' + (idx++), gx, gy, {
              radius: 4, r: 255, g: 240, b: 180, intensity: 0.7,
              flicker: 8 + Math.random() * 6, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 1) {
      var i1 = 0;
      for (var gy1 = 3; gy1 < m.height; gy1 += 5) {
        for (var gx1 = 3; gx1 < m.width; gx1 += 5) {
          if (m.tiles[gy1][gx1] === 0) {
            GameEngine.addPointLight('l_' + (i1++), gx1, gy1, {
              radius: 3, r: 255, g: 230, b: 180, intensity: 0.45,
              flicker: 4, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 2) {
      // Pipe — sparse green-tinted lights
      var i2 = 0;
      for (var gy2 = 4; gy2 < m.height; gy2 += 6) {
        for (var gx2 = 4; gx2 < m.width; gx2 += 6) {
          if (m.tiles[gy2][gx2] === 0 || m.tiles[gy2][gx2] === 7) {
            GameEngine.addPointLight('l_' + (i2++), gx2, gy2, {
              radius: 2.5, r: 180, g: 220, b: 200, intensity: 0.35,
              flicker: 3, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 3) {
      // Electrical — very dim sparse lights with strong flicker
      var i3 = 0;
      for (var gy3 = 4; gy3 < m.height; gy3 += 7) {
        for (var gx3 = 4; gx3 < m.width; gx3 += 7) {
          if (m.tiles[gy3][gx3] === 0) {
            GameEngine.addPointLight('l_' + (i3++), gx3, gy3, {
              radius: 2, r: 200, g: 220, b: 255, intensity: 0.25,
              flicker: 12, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 4) {
      var i4 = 0;
      for (var gy4 = 2; gy4 < m.height; gy4 += 3) {
        for (var gx4 = 3; gx4 < m.width; gx4 += 5) {
          if (m.tiles[gy4][gx4] === 0) {
            GameEngine.addPointLight('l_' + (i4++), gx4, gy4, {
              radius: 3, r: 230, g: 215, b: 170, intensity: 0.5,
              flicker: 5, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 5) {
      var i5 = 0;
      for (var gy5 = 3; gy5 < m.height; gy5 += 4) {
        for (var gx5 = 3; gx5 < m.width; gx5 += 4) {
          if (m.tiles[gy5][gx5] === 0) {
            GameEngine.addPointLight('l_' + (i5++), gx5, gy5, {
              radius: 3, r: 255, g: 200, b: 130, intensity: 0.6,
              flicker: 2, phase: Math.random() * 6.28
            });
          }
        }
      }
    }
    // Level 6 lights out — no lights (only flashlight)
    else if (levelId === 7) {
      // Run For Your Life — red emergency lights every few tiles
      var i7 = 0;
      for (var gy7 = 3; gy7 < m.height; gy7 += 5) {
        GameEngine.addPointLight('l_' + (i7++), 3, gy7, {
          radius: 3, r: 255, g: 60, b: 60, intensity: 0.55,
          flicker: 6, phase: Math.random() * 6.28
        });
      }
    }
    // Level 9 sparse very dim
    else if (levelId === 9) {
      var i9 = 0;
      for (var gy9 = 5; gy9 < m.height; gy9 += 8) {
        for (var gx9 = 5; gx9 < m.width; gx9 += 8) {
          GameEngine.addPointLight('l_' + (i9++), gx9, gy9, {
            radius: 3, r: 180, g: 180, b: 220, intensity: 0.3,
            flicker: 1, phase: Math.random() * 6.28
          });
        }
      }
    }
  }

  function showLoadingScreen(def) {
    el('loadingLevel').textContent = def.name;
    el('loadingName').textContent = def.subtitle;
    el('loadingHint').textContent = def.hint;
    showOverlay('loadingScreen');
    // Animate progress bar
    var bar = el('loadingFill');
    if (bar) {
      bar.style.width = '0%';
      var startTime = performance.now();
      var animate = function () {
        var elapsed = (performance.now() - startTime) / 1500;
        bar.style.width = (Math.min(1, elapsed) * 100) + '%';
        if (elapsed < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  }

  function startPlaying() {
    state = ST.PLAYING;
    // Show in-game HUD
    el('vitalBars').classList.add('show');
    el('joystickArea').style.display = '';
    el('lookArea').style.display = '';
    el('touchZoneLeft').style.display = '';
    el('touchZoneRight').style.display = '';
    el('phoneBtn').style.display = 'flex';
    el('floorHUD').style.display = '';
    el('floorText').textContent = 'LV' + currentLevel;
    el('objectiveHUD').style.display = '';
    el('objectiveText').textContent = currentLevelDef.intro;
    setTimeout(function () { hideOverlay('objectiveHUD'); el('objectiveHUD').style.display = 'none'; }, 5000);

    // Save automatically on level start
    saveGame();
  }

  // ============================================================
  //  isTileSolid hook for raycaster
  // ============================================================
  function isTileSolid(tile, gx, gy) {
    if (tile === 1 || tile === 4 || tile === 8 || tile === 9) return true;
    if (tile === 2) {
      var ds = doorStates[gridKey(gx, gy)];
      if (ds) return !ds.open;
      return false;
    }
    return false;
  }

  function isWalkable(wx, wy) {
    var gx = Math.floor(wx / TS);
    var gy = Math.floor(wy / TS);
    if (!currentMap) return false;
    if (gx < 0 || gy < 0 || gx >= currentMap.width || gy >= currentMap.height) return false;
    var t = currentMap.tiles[gy][gx];
    if (t === 1 || t === 4 || t === 8 || t === 9) return false;
    if (t === 2) {
      var ds = doorStates[gridKey(gx, gy)];
      if (ds) return ds.open;
      return false;
    }
    return true;
  }

  // ============================================================
  //  PLAYER UPDATE
  // ============================================================
  function updatePlayer(dt) {
    if (state !== ST.PLAYING) return;
    if (phoneOpen) return;

    var inp = GameEngine.input;
    var sens = 2.5 * (parseInt(localStorage.getItem('bk_sens') || '100', 10) / 100);
    var look = inp.lookDx || 0;
    player.angle += look * sens * dt;

    // Movement
    var speed = 130; // pixels per second
    if (player.inWater) speed *= 0.55;
    var sprint = inp.sprint && player.stam > 5;
    if (sprint) speed *= 1.7;

    var forward = -inp.dy;
    var strafe = inp.dx;
    var moveX = Math.cos(player.angle) * forward + Math.cos(player.angle + Math.PI / 2) * strafe;
    var moveY = Math.sin(player.angle) * forward + Math.sin(player.angle + Math.PI / 2) * strafe;
    var len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 0.01) {
      moveX = (moveX / len) * speed * dt;
      moveY = (moveY / len) * speed * dt;
      // Try X
      var nx = player.x + moveX;
      if (isWalkable(nx, player.y)) player.x = nx;
      // Try Y
      var ny = player.y + moveY;
      if (isWalkable(player.x, ny)) player.y = ny;

      // Footstep audio every ~24 px traveled
      if (!player._footAccum) player._footAccum = 0;
      player._footAccum += len * speed * dt * 0.04;
      if (player._footAccum > 24) {
        player._footAccum = 0;
        if (audioInitialized) GameEngine.playSound('footstep');
      }
    }

    GameEngine.setPlayerView(player.x, player.y, player.angle);

    // Stamina
    if (sprint && len > 0.01) {
      player.stam = Math.max(0, player.stam - 24 * dt);
    } else {
      player.stam = Math.min(player.stamMax, player.stam + 12 * dt);
    }

    // Discover area
    var gx = Math.floor(player.x / TS);
    var gy = Math.floor(player.y / TS);
    for (var dy = -3; dy <= 3; dy++) {
      for (var dx = -3; dx <= 3; dx++) {
        var tx = gx + dx, ty = gy + dy;
        if (tx >= 0 && ty >= 0 && tx < currentMap.width && ty < currentMap.height) {
          if (dx * dx + dy * dy <= 9) {
            discoveredMap[currentLevel][ty][tx] = true;
          }
        }
      }
    }

    // Tile interactions
    var here = currentMap.tiles[gy][gx];
    player.inWater = (here === 7);
    player.inHazard = (here === 10);
    player.inSafeZone = (here === 11);

    if (player.inHazard) {
      player.hp = Math.max(0, player.hp - 15 * dt);
      player.san = Math.max(0, player.san - 8 * dt);
      if (Math.random() < 0.04) GameEngine.shakeScreen(3, 0.15);
    }
    if (player.inWater) {
      player.san = Math.max(0, player.san - 1.5 * dt);
    }
    if (player.inSafeZone) {
      player.hp = Math.min(player.hpMax, player.hp + 5 * dt);
      player.san = Math.min(player.sanMax, player.san + 5 * dt);
    }

    // SAN drain per level
    var theme = THEMES[currentLevelDef.theme];
    var sanDrain = (theme && theme.sanDrain) || 0.5;
    // Faster if in dark / no flashlight on Level 6
    if (currentLevel === 6 && !player.flashlightOn) sanDrain *= 2;
    player.san = Math.max(0, player.san - sanDrain * dt);

    // Stamina regen
    if (sprint) player._sprintingDuration = (player._sprintingDuration || 0) + dt;
    else player._sprintingDuration = 0;

    // Death check
    if (player.hp <= 0) {
      die('HP消失', 'HP がゼロになった。バックルームに飲まれた...');
      return;
    }
    if (player.san <= 0) {
      die('SAN崩壊', '正気を失い、二度と戻れなくなった。');
      return;
    }

    // Action button: pick up items, read notes, no-clip
    if (inp.actionJustPressed) {
      handleAction();
    }

    // Update vitals UI
    el('hpFill').style.width = (player.hp / player.hpMax * 100) + '%';
    el('sanFill').style.width = (player.san / player.sanMax * 100) + '%';
    el('stamFill').style.width = (player.stam / player.stamMax * 100) + '%';

    // Time
    playTime += dt;
    inLevelTime += dt;

    // SAN-driven visual effects
    var sanRatio = player.san / player.sanMax;
    GameEngine.vignetteIntensity = (theme.vignette || 0.3) + (1 - sanRatio) * 0.4;
    GameEngine.chromaticLevel = (theme.chromatic || 0) + (1 - sanRatio) * 0.4;
    GameEngine.grainIntensity = (theme.grain || 0.3) + (1 - sanRatio) * 0.2;

    // SAN whisper on low SAN
    if (sanRatio < 0.4 && Math.random() < 0.0015 && audioInitialized) {
      GameEngine.playSound('whisper');
    }

    // Heartbeat near entities
    var nearestDist = nearestEntityDist();
    if (nearestDist < 8 * TS) {
      var prox = 1 - nearestDist / (8 * TS);
      GameEngine.setProximity(prox);
      if (!player._heartbeatOn && prox > 0.3) {
        GameEngine.startLoop('heartbeat');
        player._heartbeatOn = true;
      }
    } else {
      GameEngine.setProximity(0);
      if (player._heartbeatOn) {
        GameEngine.stopLoop('heartbeat');
        player._heartbeatOn = false;
      }
    }

    // Radio detection
    if (player.radioOn && nearestDist < 12 * TS) {
      updateDangerIndicator(nearestDist);
    } else {
      hideDangerIndicator();
    }
  }

  function nearestEntityDist() {
    var minD = Infinity;
    for (var i = 0; i < entities.length; i++) {
      if (!entities[i].alive) continue;
      var dx = entities[i].x - player.x;
      var dy = entities[i].y - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < minD) minD = d;
    }
    return minD;
  }

  function updateDangerIndicator(dist) {
    // Find direction of nearest entity
    var nearest = null;
    var minD = Infinity;
    for (var i = 0; i < entities.length; i++) {
      if (!entities[i].alive) continue;
      var dx = entities[i].x - player.x;
      var dy = entities[i].y - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < minD) { minD = d; nearest = entities[i]; }
    }
    if (!nearest) { hideDangerIndicator(); return; }

    var angleTo = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    var rel = angleTo - player.angle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;

    el('dangerIndicator').style.display = 'block';
    if (rel < -0.5) {
      el('dangerLeft').classList.add('active');
      el('dangerRight').classList.remove('active');
    } else if (rel > 0.5) {
      el('dangerRight').classList.add('active');
      el('dangerLeft').classList.remove('active');
    } else {
      el('dangerLeft').classList.add('active');
      el('dangerRight').classList.add('active');
    }
  }
  function hideDangerIndicator() {
    el('dangerIndicator').style.display = 'none';
    el('dangerLeft').classList.remove('active');
    el('dangerRight').classList.remove('active');
  }

  // ============================================================
  //  ACTION (red button): pick up, open door, no-clip
  // ============================================================
  function handleAction() {
    var gx = Math.floor(player.x / TS);
    var gy = Math.floor(player.y / TS);

    // Check current tile
    var t = currentMap.tiles[gy][gx];

    // No-clip exit
    if (t === 3) {
      tryNoClip();
      return;
    }

    // Item spot
    var key = gridKey(gx, gy);
    if (pickupSpots[key]) {
      pickUpItem(pickupSpots[key], gx, gy);
      return;
    }

    // Note spot
    if (noteSpots[key]) {
      readNote(noteSpots[key], gx, gy);
      return;
    }

    // Check tiles facing
    var facingGx = Math.floor((player.x + Math.cos(player.angle) * TS * 0.7) / TS);
    var facingGy = Math.floor((player.y + Math.sin(player.angle) * TS * 0.7) / TS);
    var ft = currentMap.tiles[facingGy] ? currentMap.tiles[facingGy][facingGx] : null;
    var fkey = gridKey(facingGx, facingGy);

    // Door toggle
    if (ft === 2) {
      var ds = doorStates[fkey];
      if (ds) {
        if (ds.locked) {
          if (player.inventory.keycard) {
            ds.locked = false;
            ds.open = true;
            player.inventory.keycard--;
            if (player.inventory.keycard <= 0) delete player.inventory.keycard;
            toast('カードキーで解錠');
            if (audioInitialized) GameEngine.playSound('key_unlock');
          } else {
            toast('鍵がかかっている');
            if (audioInitialized) GameEngine.playSound('door');
          }
        } else {
          ds.open = !ds.open;
          if (audioInitialized) GameEngine.playSound('door');
        }
        return;
      }
    }

    // Item / note facing
    if (ft === 5 && pickupSpots[fkey]) {
      pickUpItem(pickupSpots[fkey], facingGx, facingGy);
      return;
    }
    if (ft === 6 && noteSpots[fkey]) {
      readNote(noteSpots[fkey], facingGx, facingGy);
      return;
    }
    if (ft === 3) {
      tryNoClip();
      return;
    }
  }

  function pickUpItem(itemId, gx, gy) {
    var item = ITEMS[itemId];
    if (!item) return;
    player.inventory[itemId] = (player.inventory[itemId] || 0) + 1;
    if (!pickedUpItems[currentLevel]) pickedUpItems[currentLevel] = {};
    pickedUpItems[currentLevel][gridKey(gx, gy)] = true;
    delete pickupSpots[gridKey(gx, gy)];
    toast(item.name + ' を入手');
    if (audioInitialized) GameEngine.playSound('item_get');
  }

  function readNote(note, gx, gy) {
    if (!readNotes[currentLevel]) readNotes[currentLevel] = {};
    if (!readNotes[currentLevel][gridKey(gx, gy)]) {
      discoveredNotes.push({
        levelId: currentLevel,
        title: note.title,
        text: note.text
      });
      readNotes[currentLevel][gridKey(gx, gy)] = true;
    }
    showNoteViewer(note.title, note.text);
    if (audioInitialized) GameEngine.playSound('paper');
  }

  function showNoteViewer(title, text) {
    el('noteTitle').textContent = title;
    el('noteText').textContent = text;
    showOverlay('noteViewerOverlay');
  }

  function tryNoClip() {
    var nextLevel = getNextLevel(currentLevel);
    if (nextLevel === null) {
      triggerEnding('truend');
      return;
    }
    clearedLevels[currentLevel] = true;
    if (audioInitialized) {
      GameEngine.stopAll();
      // Quiet during transition
    }
    // No-clip flash
    var flash = el('noclipFlash');
    flash.style.display = 'block';
    flash.classList.remove('show');
    requestAnimationFrame(function () { flash.classList.add('show'); });
    setTimeout(function () {
      flash.classList.remove('show');
      flash.style.display = 'none';
      setLevel(nextLevel);
    }, 600);
    toast('no-clip 成功!');
  }

  function getNextLevel(cur) {
    // Normal progression: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 9 → END
    var order = [0, 1, 2, 3, 4, 5, 6, 7, 9];
    var idx = order.indexOf(cur);
    if (idx < 0 || idx === order.length - 1) return null;
    return order[idx + 1];
  }

  // ============================================================
  //  ENTITY AI
  // ============================================================
  function updateEntities(dt) {
    if (state !== ST.PLAYING) return;
    if (phoneOpen) return;

    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.alive) continue;
      e.stateTimer += dt;

      var dx = player.x - e.x;
      var dy = player.y - e.y;
      var distP = Math.sqrt(dx * dx + dy * dy);

      // AI by type
      if (e.type === 'hound') {
        // Aggressive chaser. Triggers when player runs near.
        if (distP < 6 * TS && (GameEngine.input.sprint || e.state === 'chase')) {
          e.state = 'chase';
          // Pathfind: simple move toward player
          var spd = 90;
          var stepX = (dx / distP) * spd * dt;
          var stepY = (dy / distP) * spd * dt;
          var nx = e.x + stepX;
          if (isWalkable(nx, e.y)) e.x = nx;
          var ny = e.y + stepY;
          if (isWalkable(e.x, ny)) e.y = ny;
        } else if (distP > 10 * TS) {
          e.state = 'wander';
          wanderEntity(e, dt, 35);
        } else {
          e.state = 'idle';
        }
      } else if (e.type === 'smiler') {
        // Stares from distance. Drains SAN if seen.
        if (distP > 3 * TS && distP < 8 * TS) {
          e.state = 'stalk';
          // Stay just outside view
          var seenAngle = Math.atan2(-dy, -dx);
          e.angle = seenAngle;
          // Slow drift toward
          var spd2 = 25;
          var stepX2 = (dx / distP) * spd2 * dt;
          var stepY2 = (dy / distP) * spd2 * dt;
          if (isWalkable(e.x + stepX2, e.y)) e.x += stepX2;
          if (isWalkable(e.x, e.y + stepY2)) e.y += stepY2;
          // SAN drain on direct view
          if (isFacingPlayer(e)) player.san = Math.max(0, player.san - 8 * dt);
        } else if (distP <= 1.5 * TS) {
          attackPlayer(8 * dt);
        }
      } else if (e.type === 'skinstealer') {
        // Pretends to be dead until close
        if (distP > 2.5 * TS) {
          e.state = 'corpse';
          // No move
        } else if (distP < 2.5 * TS && e.state === 'corpse') {
          e.state = 'reveal';
          if (audioInitialized) GameEngine.playSound('stinger');
          toast('動いた!');
          GameEngine.shakeScreen(8, 0.6);
          player.san = Math.max(0, player.san - 15);
        } else if (e.state === 'reveal') {
          var spd3 = 70;
          var stepX3 = (dx / distP) * spd3 * dt;
          var stepY3 = (dy / distP) * spd3 * dt;
          if (isWalkable(e.x + stepX3, e.y)) e.x += stepX3;
          if (isWalkable(e.x, e.y + stepY3)) e.y += stepY3;
          if (distP < 1 * TS) attackPlayer(20 * dt);
        }
      } else if (e.type === 'partygoer') {
        // Wanders, attacks if too close
        wanderEntity(e, dt, 40);
        if (distP < 1.5 * TS) {
          attackPlayer(15 * dt);
        }
      }

      // Common: collision with player triggers damage
      if (distP < 0.8 * TS && e.type !== 'skinstealer' && e.state !== 'corpse') {
        attackPlayer(10 * dt);
      }
    }
  }

  function isFacingPlayer(e) {
    var angleTo = Math.atan2(player.y - e.y, player.x - e.x);
    var pAngleTo = Math.atan2(e.y - player.y, e.x - player.x);
    var rel = pAngleTo - player.angle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return Math.abs(rel) < Math.PI / 3.5; // within FOV cone
  }

  function attackPlayer(dmg) {
    player.hp = Math.max(0, player.hp - dmg);
    if (Math.random() < 0.1) GameEngine.redFlash();
  }

  function wanderEntity(e, dt, speed) {
    // Random target every few seconds
    if (e.stateTimer > 3 + Math.random() * 2 || !e.targetX) {
      e.stateTimer = 0;
      e.targetX = e.x + (Math.random() - 0.5) * 6 * TS;
      e.targetY = e.y + (Math.random() - 0.5) * 6 * TS;
    }
    var dx = e.targetX - e.x;
    var dy = e.targetY - e.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 4) { e.targetX = null; return; }
    var stepX = (dx / d) * speed * dt;
    var stepY = (dy / d) * speed * dt;
    if (isWalkable(e.x + stepX, e.y)) e.x += stepX;
    if (isWalkable(e.x, e.y + stepY)) e.y += stepY;
    e.angle = Math.atan2(dy, dx);
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function onRender(ctx) {
    if (!currentMap) return;
    if (state === ST.TITLE) return;

    GameEngine.drawMap();

    // Draw entities
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.alive) continue;
      // Skin-stealer in 'corpse' state appears lower (on ground)
      if (e.type === 'skinstealer' && e.state === 'corpse') {
        // Render as floor-pile (smaller)
        GameEngine.drawEntity({
          x: e.x, y: e.y, color: '#352825', visible: true,
          bodyColor: '#1a1208', _bodyR: 26, _bodyG: 18, _bodyB: 8
        });
      } else {
        GameEngine.drawEntity({
          x: e.x, y: e.y, color: e.color, visible: true,
          bodyColor: e.bodyColor, _bodyR: 26, _bodyG: 20, _bodyB: 18
        });
      }
    }

    // Draw item glow sprites
    var glowPhase = performance.now() * 0.003;
    for (var key in pickupSpots) {
      var parts = key.split('_');
      var gx = parseInt(parts[0], 10);
      var gy = parseInt(parts[1], 10);
      var wx = gx * TS + TS / 2;
      var wy = gy * TS + TS / 2;
      GameEngine.drawFloorGlow(wx, wy, glowPhase);
    }
    for (var nkey in noteSpots) {
      if (readNotes[currentLevel] && readNotes[currentLevel][nkey]) continue;
      var nparts = nkey.split('_');
      var ngx = parseInt(nparts[0], 10);
      var ngy = parseInt(nparts[1], 10);
      var nwx = ngx * TS + TS / 2;
      var nwy = ngy * TS + TS / 2;
      GameEngine.drawFloorGlow(nwx, nwy, glowPhase + 1);
    }
    // No-clip exit glow
    if (currentMap.noclipExits) {
      for (var ei = 0; ei < currentMap.noclipExits.length; ei++) {
        var ex = currentMap.noclipExits[ei];
        var ewx = ex.gx * TS + TS / 2;
        var ewy = ex.gy * TS + TS / 2;
        GameEngine.drawFloorGlow(ewx, ewy, glowPhase + 2);
      }
    }

    // Action button visibility
    updateActionButton();

    // Dim screen if flashlight off on dark levels
    GameEngine.drawDarkness(player.x, player.y, 200, 0);
  }

  function updateActionButton() {
    var btn = el('actionBtn');
    if (!btn) return;
    var gx = Math.floor(player.x / TS);
    var gy = Math.floor(player.y / TS);
    var here = currentMap.tiles[gy] && currentMap.tiles[gy][gx];
    var key = gridKey(gx, gy);

    var showAct = false;
    var label = '調べる';

    if (here === 3) { showAct = true; label = 'no-clip ↓'; }
    else if (pickupSpots[key]) { showAct = true; label = '拾う'; }
    else if (noteSpots[key]) { showAct = true; label = '読む'; }
    else {
      var facingGx = Math.floor((player.x + Math.cos(player.angle) * TS * 0.7) / TS);
      var facingGy = Math.floor((player.y + Math.sin(player.angle) * TS * 0.7) / TS);
      var ft = currentMap.tiles[facingGy] && currentMap.tiles[facingGy][facingGx];
      var fkey = gridKey(facingGx, facingGy);
      if (ft === 2) { showAct = true; label = 'ドア'; }
      else if (ft === 5 && pickupSpots[fkey]) { showAct = true; label = '拾う'; }
      else if (ft === 6 && noteSpots[fkey]) { showAct = true; label = '読む'; }
      else if (ft === 3) { showAct = true; label = 'no-clip ↓'; }
    }

    if (showAct) {
      btn.style.display = 'block';
      el('actionBtnText').textContent = label;
    } else {
      btn.style.display = 'none';
    }
  }

  // ============================================================
  //  GAME LOOP HOOK
  // ============================================================
  function onUpdate(dt) {
    if (state === ST.PLAYING && !phoneOpen) {
      updatePlayer(dt);
      updateEntities(dt);
      GameEngine.updateParticles(dt);
      // Random dust particles
      if (Math.random() < 0.03) {
        var pAng = Math.random() * Math.PI * 2;
        var pDist = 100 + Math.random() * 150;
        GameEngine.addParticle('dust', player.x + Math.cos(pAng) * pDist, player.y + Math.sin(pAng) * pDist);
      }
    }
  }

  // ============================================================
  //  DEATH / ENDING
  // ============================================================
  function die(causeId, sub) {
    state = ST.DEAD;
    el('vitalBars').classList.remove('show');
    el('joystickArea').style.display = 'none';
    el('lookArea').style.display = 'none';
    el('touchZoneLeft').style.display = 'none';
    el('touchZoneRight').style.display = 'none';
    el('actionBtn').style.display = 'none';
    el('phoneBtn').style.display = 'none';
    el('floorHUD').style.display = 'none';
    el('gameoverSub').textContent = sub;
    GameEngine.stopAll();
    GameEngine.fadeToBlack(800, function () {
      showOverlay('gameOverScreen');
    });
  }

  function triggerEnding(type) {
    state = ST.ENDED;
    GameEngine.stopAll();
    var screen = el('endingScreen');
    var content = screen.querySelector('.ending-content');
    content.classList.remove('bad-ending', 'true-ending', 'lost-ending');

    var tag = el('endingTag');
    var title = el('endingTitle');
    var msg = el('endingMessage');

    if (type === 'truend') {
      content.classList.add('true-ending');
      tag.textContent = 'THE END';
      title.textContent = 'TRUE END';
      msg.innerHTML = 'あなたは全ての階層を踏破した。<br>黒い扉の向こうで、本当の世界が待っている。<br>...かもしれない。';
    } else if (type === 'frontrooms') {
      content.classList.remove('bad-ending', 'true-ending', 'lost-ending');
      tag.textContent = 'ESCAPED';
      title.textContent = 'FRONTROOMS END';
      msg.innerHTML = 'バックルームから脱出した。<br>だが、あの蛍光灯のハム音は<br>今も耳に残っている。';
    } else {
      content.classList.add('lost-ending');
      tag.textContent = 'LOST';
      title.textContent = 'LOOP END';
      msg.innerHTML = '出口を見つけられないまま、永遠が経過した。<br>そして次の no-clipper を待つ存在になった。';
    }

    el('vitalBars').classList.remove('show');
    el('joystickArea').style.display = 'none';
    el('lookArea').style.display = 'none';
    el('touchZoneLeft').style.display = 'none';
    el('touchZoneRight').style.display = 'none';
    el('actionBtn').style.display = 'none';
    el('phoneBtn').style.display = 'none';
    el('floorHUD').style.display = 'none';

    GameEngine.fadeToBlack(1500, function () {
      showOverlay('endingScreen');
    });

    // Clear save on ending
    localStorage.removeItem(SAVE_KEY);
  }

  // ============================================================
  //  PHONE UI
  // ============================================================
  function openPhone() {
    if (state !== ST.PLAYING) return;
    phoneOpen = true;
    refreshPhoneUI();
    showOverlay('phoneOverlay');
  }
  function closePhone() {
    phoneOpen = false;
    hideOverlay('phoneOverlay');
  }

  function switchTab(name) {
    activeTab = name;
    var tabs = ['Status', 'Inventory', 'Map', 'Notes', 'Options'];
    tabs.forEach(function (n) {
      var tabEl = el('phoneTab' + n);
      if (tabEl) tabEl.style.display = (n === name) ? 'block' : 'none';
    });
    var btns = document.querySelectorAll('.phone-tab-btn');
    btns.forEach(function (b) {
      if (b.getAttribute('data-tab') === name) b.classList.add('active');
      else b.classList.remove('active');
    });
    refreshPhoneUI();
  }

  function refreshPhoneUI() {
    // Clock
    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2);
    var mm = ('0' + now.getMinutes()).slice(-2);
    el('phoneClock').textContent = hh + ':' + mm;

    // Battery (declines with playtime)
    var batRatio = Math.max(0, 1 - playTime / 3600);
    var bars = Math.floor(batRatio * 5);
    var battStr = '';
    for (var bi = 0; bi < 5; bi++) battStr += (bi < bars) ? '█' : '░';
    el('phoneBattery').textContent = battStr;

    // STATUS
    if (activeTab === 'Status') {
      el('statLevelNum').textContent = currentLevelDef ? currentLevelDef.name : 'LEVEL 0';
      el('statLevelName').textContent = currentLevelDef ? currentLevelDef.subtitle : 'THE LOBBY';
      el('statHpFill').style.width = (player.hp / player.hpMax * 100) + '%';
      el('statHpText').textContent = Math.floor(player.hp) + '/' + player.hpMax;
      el('statSanFill').style.width = (player.san / player.sanMax * 100) + '%';
      el('statSanText').textContent = Math.floor(player.san) + '/' + player.sanMax;
      el('statStaFill').style.width = (player.stam / player.stamMax * 100) + '%';
      el('statStaText').textContent = Math.floor(player.stam) + '/' + player.stamMax;
      el('statTimeText').textContent = formatTime(playTime);
      var clears = 0;
      for (var k in clearedLevels) if (clearedLevels[k]) clears++;
      el('statProgText').textContent = 'クリア: ' + clears + ' / 9 階層';
    }

    // INVENTORY
    if (activeTab === 'Inventory') {
      var grid = el('invGrid');
      grid.innerHTML = '';
      var keys = Object.keys(player.inventory);
      if (keys.length === 0) {
        grid.innerHTML = '<p class="inv-empty">所持アイテムなし</p>';
      } else {
        for (var ii = 0; ii < keys.length; ii++) {
          var id = keys[ii];
          var item = ITEMS[id];
          var cnt = player.inventory[id];
          if (!item) continue;
          var slot = document.createElement('div');
          slot.className = 'inv-slot';
          slot.innerHTML = '<span style="font-size:28px;">' + item.icon + '</span>' +
            (cnt > 1 ? '<span class="inv-count">' + cnt + '</span>' : '') +
            '<span class="inv-name">' + item.name.slice(0, 6) + '</span>';
          (function (itemId) {
            slot.addEventListener('click', function () {
              var it = ITEMS[itemId];
              if (!it) return;
              if (confirm(it.name + '\n\n' + it.desc + '\n\n使用しますか?')) {
                it.effect(player);
                player.inventory[itemId]--;
                if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
                refreshPhoneUI();
              }
            });
          })(id);
          grid.appendChild(slot);
        }
      }
    }

    // MAP
    if (activeTab === 'Map') {
      drawMap();
      el('mapLevelName').textContent =
        (currentLevelDef ? currentLevelDef.name + ' / ' + currentLevelDef.subtitle : '');
    }

    // NOTES
    if (activeTab === 'Notes') {
      var list = el('notesList');
      list.innerHTML = '';
      if (discoveredNotes.length === 0) {
        list.innerHTML = '<p class="notes-empty">まだ何も記録されていない。</p>';
      } else {
        for (var ni = 0; ni < discoveredNotes.length; ni++) {
          var note = discoveredNotes[ni];
          var card = document.createElement('div');
          card.className = 'note-card';
          var preview = note.text.split('\n').join(' ').slice(0, 60) + '...';
          card.innerHTML =
            '<div class="note-card-title">[LV' + note.levelId + '] ' + note.title + '</div>' +
            '<div class="note-card-preview">' + preview + '</div>';
          (function (n) {
            card.addEventListener('click', function () {
              showNoteViewer(n.title, n.text);
            });
          })(note);
          list.appendChild(card);
        }
      }
    }
  }

  function drawMap() {
    var canvas = el('mapCanvas');
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var sz = Math.min(rect.width, rect.height) | 0;
    canvas.width = sz;
    canvas.height = sz;

    ctx.fillStyle = '#050402';
    ctx.fillRect(0, 0, sz, sz);

    if (!currentMap) return;
    var mw = currentMap.width;
    var mh = currentMap.height;
    var ts = Math.floor(sz / Math.max(mw, mh));
    var ox = (sz - ts * mw) / 2;
    var oy = (sz - ts * mh) / 2;

    for (var y = 0; y < mh; y++) {
      for (var x = 0; x < mw; x++) {
        var t = currentMap.tiles[y][x];
        var disc = discoveredMap[currentLevel] && discoveredMap[currentLevel][y] && discoveredMap[currentLevel][y][x];
        if (!disc) {
          ctx.fillStyle = '#181208';
          ctx.fillRect(ox + x * ts, oy + y * ts, ts, ts);
          continue;
        }
        if (t === 1 || t === 4 || t === 8 || t === 9) {
          ctx.fillStyle = '#786020';
        } else if (t === 3) {
          ctx.fillStyle = '#d4b340';
        } else if (t === 2) {
          ctx.fillStyle = '#a08850';
        } else if (t === 10) {
          ctx.fillStyle = '#c63a3a';
        } else if (t === 11) {
          ctx.fillStyle = '#88b033';
        } else if (t === 7) {
          ctx.fillStyle = '#406070';
        } else {
          ctx.fillStyle = '#382a08';
        }
        ctx.fillRect(ox + x * ts, oy + y * ts, ts, ts);
      }
    }

    // Player
    var pgx = (player.x / TS);
    var pgy = (player.y / TS);
    ctx.fillStyle = '#88b033';
    ctx.beginPath();
    ctx.arc(ox + pgx * ts, oy + pgy * ts, Math.max(2, ts * 0.4), 0, Math.PI * 2);
    ctx.fill();
    // Facing
    ctx.strokeStyle = '#88b033';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + pgx * ts, oy + pgy * ts);
    ctx.lineTo(
      ox + pgx * ts + Math.cos(player.angle) * ts * 1.5,
      oy + pgy * ts + Math.sin(player.angle) * ts * 1.5
    );
    ctx.stroke();
  }

  // ============================================================
  //  SAVE / LOAD
  // ============================================================
  function saveGame() {
    try {
      var data = {
        v: 1,
        currentLevel: currentLevel,
        playTime: playTime,
        inLevelTime: inLevelTime,
        player: {
          hp: player.hp, hpMax: player.hpMax,
          san: player.san, sanMax: player.sanMax,
          stam: player.stam, stamMax: player.stamMax,
          inventory: player.inventory,
          flashlightOn: player.flashlightOn,
          radioOn: player.radioOn
        },
        visitedLevels: visitedLevels,
        clearedLevels: clearedLevels,
        discoveredNotes: discoveredNotes,
        pickedUpItems: pickedUpItems,
        readNotes: readNotes,
        spawn: { x: player.x, y: player.y, angle: player.angle }
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { console.warn('Save failed', e); }
  }

  function loadGame() {
    try {
      var s = localStorage.getItem(SAVE_KEY);
      if (!s) return false;
      var data = JSON.parse(s);
      currentLevel = data.currentLevel || 0;
      playTime = data.playTime || 0;
      player.hp = data.player.hp;
      player.hpMax = data.player.hpMax;
      player.san = data.player.san;
      player.sanMax = data.player.sanMax;
      player.stam = data.player.stam;
      player.stamMax = data.player.stamMax;
      player.inventory = data.player.inventory || {};
      player.flashlightOn = data.player.flashlightOn || false;
      player.radioOn = data.player.radioOn || false;
      visitedLevels = data.visitedLevels || {};
      clearedLevels = data.clearedLevels || {};
      discoveredNotes = data.discoveredNotes || [];
      pickedUpItems = data.pickedUpItems || {};
      readNotes = data.readNotes || {};
      return true;
    } catch (e) {
      console.warn('Load failed', e);
      return false;
    }
  }

  function hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  }

  // ============================================================
  //  TITLE / NEW GAME
  // ============================================================
  function startNewGame() {
    state = ST.LOADING;
    hideOverlay('titleScreen');

    player.hp = player.hpMax = 100;
    player.san = player.sanMax = 100;
    player.stam = player.stamMax = 100;
    player.inventory = {};
    player.flashlightOn = false;
    player.radioOn = false;
    playTime = 0;
    visitedLevels = {};
    clearedLevels = {};
    discoveredNotes = [];
    pickedUpItems = {};
    readNotes = {};
    discoveredMap = {};

    // Start audio context
    if (!audioInitialized) {
      GameEngine.initAudio();
      audioInitialized = true;
    }

    setLevel(0);
  }

  function continueGame() {
    if (!loadGame()) {
      toast('セーブデータが見つかりません');
      return;
    }
    state = ST.LOADING;
    hideOverlay('titleScreen');
    if (!audioInitialized) {
      GameEngine.initAudio();
      audioInitialized = true;
    }
    setLevel(currentLevel);
  }

  function returnToTitle() {
    state = ST.TITLE;
    GameEngine.stopAll();
    GameEngine.fadeFromBlack(500);

    // Hide HUD
    el('vitalBars').classList.remove('show');
    el('joystickArea').style.display = 'none';
    el('lookArea').style.display = 'none';
    el('touchZoneLeft').style.display = 'none';
    el('touchZoneRight').style.display = 'none';
    el('actionBtn').style.display = 'none';
    el('phoneBtn').style.display = 'none';
    el('floorHUD').style.display = 'none';
    el('objectiveHUD').style.display = 'none';

    hideOverlay('gameOverScreen');
    hideOverlay('endingScreen');
    hideOverlay('phoneOverlay');
    showOverlay('titleScreen');
    updateTitleButtons();
  }

  function updateTitleButtons() {
    var cont = el('continueBtn');
    if (cont) cont.style.display = hasSave() ? '' : 'none';
  }

  // ============================================================
  //  EVENT BINDINGS
  // ============================================================
  function bindEvents() {
    el('startBtn').addEventListener('click', startNewGame);
    el('continueBtn').addEventListener('click', continueGame);
    el('controlsBtn').addEventListener('click', function () {
      showOverlay('tutorialOverlay');
    });
    el('closeTutorialBtn').addEventListener('click', function () {
      hideOverlay('tutorialOverlay');
    });

    el('phoneBtn').addEventListener('click', openPhone);
    el('closePhoneBtn').addEventListener('click', closePhone);

    var tabBtns = document.querySelectorAll('.phone-tab-btn');
    tabBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        switchTab(b.getAttribute('data-tab'));
      });
    });

    el('closeNoteBtn').addEventListener('click', function () {
      hideOverlay('noteViewerOverlay');
    });

    el('retryBtn').addEventListener('click', function () {
      hideOverlay('gameOverScreen');
      if (hasSave()) continueGame();
      else { returnToTitle(); }
    });
    el('retryTitleBtn').addEventListener('click', returnToTitle);
    el('titleReturnBtn').addEventListener('click', returnToTitle);

    // Volume sliders
    var volS = el('volumeSlider');
    var volV = el('volumeValue');
    if (volS) {
      volS.value = parseInt(localStorage.getItem('bk_master_vol') || '70', 10);
      volV.textContent = volS.value + '%';
      volS.addEventListener('input', function () {
        var v = parseInt(volS.value, 10);
        volV.textContent = v + '%';
        GameEngine.setMasterVolume(v / 100);
        localStorage.setItem('bk_master_vol', v);
      });
      GameEngine.setMasterVolume(volS.value / 100);
    }
    var bgmS = el('bgmSlider');
    var bgmV = el('bgmValue');
    if (bgmS) {
      bgmS.value = parseInt(localStorage.getItem('bk_bgm_vol') || '90', 10);
      bgmV.textContent = bgmS.value + '%';
      bgmS.addEventListener('input', function () {
        var v = parseInt(bgmS.value, 10);
        bgmV.textContent = v + '%';
        GameEngine.setBgmVolume(v / 100);
        localStorage.setItem('bk_bgm_vol', v);
      });
      GameEngine.setBgmVolume(bgmS.value / 100);
    }
    var seS = el('seSlider');
    var seV = el('seValue');
    if (seS) {
      seS.value = parseInt(localStorage.getItem('bk_se_vol') || '80', 10);
      seV.textContent = seS.value + '%';
      seS.addEventListener('input', function () {
        var v = parseInt(seS.value, 10);
        seV.textContent = v + '%';
        GameEngine.setSeVolume(v / 100);
        localStorage.setItem('bk_se_vol', v);
      });
      GameEngine.setSeVolume(seS.value / 100);
    }
    var sensS = el('sensSlider');
    var sensV = el('sensValue');
    if (sensS) {
      sensS.value = parseInt(localStorage.getItem('bk_sens') || '100', 10);
      sensV.textContent = sensS.value + '%';
      sensS.addEventListener('input', function () {
        sensV.textContent = sensS.value + '%';
        localStorage.setItem('bk_sens', sensS.value);
      });
    }
    var grainS = el('grainSlider');
    var grainV = el('grainValue');
    if (grainS) {
      grainS.value = parseInt(localStorage.getItem('bk_grain') || '30', 10);
      grainV.textContent = grainS.value + '%';
      grainS.addEventListener('input', function () {
        var v = parseInt(grainS.value, 10);
        grainV.textContent = v + '%';
        GameEngine.grainIntensity = v / 100;
        localStorage.setItem('bk_grain', v);
      });
    }

    el('optSaveBtn').addEventListener('click', function () { saveGame(); toast('セーブしました'); });
    el('optLoadBtn').addEventListener('click', function () {
      if (loadGame()) { closePhone(); setLevel(currentLevel, true); toast('ロードしました'); }
      else toast('セーブデータなし');
    });
    el('optResetBtn').addEventListener('click', function () {
      if (confirm('セーブデータを削除しますか?')) {
        localStorage.removeItem(SAVE_KEY);
        toast('セーブを削除');
        updateTitleButtons();
      }
    });
    el('optReturnTitleBtn').addEventListener('click', function () {
      if (confirm('進捗を保存してタイトルへ戻りますか?')) {
        saveGame();
        closePhone();
        returnToTitle();
      }
    });

    // Auto-save every 30s
    setInterval(function () {
      if (state === ST.PLAYING) saveGame();
    }, 30000);
  }

  // ============================================================
  //  INIT
  // ============================================================
  function init() {
    GameEngine.init('gameCanvas');
    GameEngine.isTileSolid = isTileSolid;
    GameEngine.isWalkableHook = isWalkable;
    GameEngine.onUpdate = onUpdate;
    GameEngine.onRender = onRender;

    bindEvents();
    updateTitleButtons();
    showOverlay('titleScreen');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
