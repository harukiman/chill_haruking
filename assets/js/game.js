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
    '#......#.#.....s.......#',
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
    '#....#......s........#',
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
    '#..........s.........#',
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

  // ── LEVEL 8 — THE HIVE ──────────────────────────────────
  // Hexagonal cell-like clusters, hanging bodies
  var LV8_ROWS = [
    '######################',
    '#P...................#',
    '#..FFF...FFF...FFF...#',
    '#..F.F...F.F...F.F...#',
    '#..F.F.n.F.F...F.F...#',
    '#..F.F...F.F.i.F.F...#',
    '#..FFF...FFF...FFF...#',
    '#....................#',
    '#....................#',
    '#..FFF...FFF...FFF...#',
    '#..F.F.i.F.F...F.F.n.#',
    '#..F.F...F.F...F.F...#',
    '#..F.F...F.F...F.F...#',
    '#..FFF...FFF...FFF...#',
    '#....................#',
    '#....................#',
    '#..FFF...FFF...FFF...#',
    '#..F.F...F.F...F.F...#',
    '#..F.F...F.F.X.F.F...#',
    '#..F.F...F.F...F.F...#',
    '#..FFF.s.FFF...FFF...#',
    '######################'
  ];

  // ── LEVEL ! (id 11) — END OF THE LINE ───────────────────
  // Dark train station with abandoned cars
  var LV11_ROWS = [
    '############',
    '#P.........#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#..........#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#..n.......#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#..........#',
    '#.FFFFFFFF.#',
    '#.......i..#',
    '#..........#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#..........#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#..n.......#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#..........#',
    '#.FFFFFFFF.#',
    '#..........#',
    '#......X...#',
    '#..........#',
    '############'
  ];

  // ── LEVEL Fun =) (id 12) — ETERNAL PARTY ────────────────
  // Bright pink party hellscape with Partygoers
  var LV12_ROWS = [
    '######################',
    '#P....i....i....i.s..#',
    '#....................#',
    '#..####D####D####....#',
    '#..#..........#......#',
    '#..#.n........#..F...#',
    '#..#..........D......#',
    '#..#......i...#......#',
    '#..############......#',
    '#....................#',
    '#......F.......F.....#',
    '#....................#',
    '#..############......#',
    '#..#..........#...F..#',
    '#..#......n...#......#',
    '#..#..........D..n...#',
    '#..#..i.......#......#',
    '#..####D####D####....#',
    '#....................#',
    '#.......i....X.......#',
    '#....................#',
    '######################'
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
    '#............s...........#',
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
    8: { // The Hive — green-tinted dark with body shadows
      wall: {
        upper: { 'default': [60, 80, 50], 1: [60, 80, 50] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#0a0c08', '#101810', '#1a2418'],
        floor:   ['#0a0c08', '#141810', '#1c2418']
      },
      floorDefault: [35, 45, 30],
      ceilingDefault: [25, 35, 22],
      fogDist: 10,
      ambientLoop: 'wind',
      sanDrain: 0.9,
      vignette: 0.45,
      grain: 0.4,
      chromatic: 0.2
    },
    11: { // End of the Line — pitch black with rare flashes
      wall: {
        upper: { 'default': [40, 35, 32], 1: [40, 35, 32] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#000', '#040404', '#080808'],
        floor:   ['#000', '#080808', '#101010']
      },
      floorDefault: [25, 22, 20],
      ceilingDefault: [12, 10, 10],
      fogDist: 6,
      ambientLoop: 'wind',
      sanDrain: 1.0,
      vignette: 0.6,
      grain: 0.5,
      chromatic: 0.25
    },
    12: { // Fun =) — bright pink hellscape
      wall: {
        upper: { 'default': [220, 100, 160], 1: [220, 100, 160], 2: [180, 120, 80] },
        lower: { 'default': [180, 60, 120], 1: [180, 60, 120] },
        pattern: 'stripe',
        splitRatio: 0.55,
        railColor: [120, 40, 70]
      },
      bg: {
        ceiling: ['#a04060', '#882048', '#601838'],
        floor:   ['#503040', '#7a4060', '#a0507a']
      },
      floorDefault: [200, 80, 120],
      ceilingDefault: [180, 60, 110],
      fogDist: 13,
      ambientLoop: 'fluorescent',
      sanDrain: 0.6,
      vignette: 0.3,
      grain: 0.3,
      chromatic: 0.15
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
         entities: [
           { type: 'hound', gx: 14, gy: 14 },
           { type: 'crawler', gx: 4, gy: 18 }
         ],
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
         entities: [
           { type: 'wretch', gx: 13, gy: 8 },
           { type: 'wretch', gx: 2, gy: 13 }
         ],
         timeLimit: null },
    4: { id: 4, name: 'LEVEL 4', subtitle: 'ABANDONED OFFICE',
         rows: LV4_ROWS, theme: 4,
         hint: 'オフィスのキュービクル。Skin-Stealer が紛れている。',
         intro: '誰もいないオフィス。けれど視線を感じる。',
         entities: [ { type: 'skinstealer', gx: 10, gy: 8 } ],
         timeLimit: null },
    5: { id: 5, name: 'LEVEL 5', subtitle: 'THE HOTEL',
         rows: LV5_ROWS, theme: 5,
         hint: '無数の部屋とドア。Partygoers と...見覚えのある追跡者の声。',
         intro: 'カーペットの廊下...電話が、どこかで鳴っている。',
         entities: [
           { type: 'partygoer', gx: 16, gy: 10 },
           { type: 'mrhotel', gx: 10, gy: 18 },
           { type: 'haruki', gx: 1, gy: 21 }
         ],
         timeLimit: null },
    6: { id: 6, name: 'LEVEL 6', subtitle: 'LIGHTS OUT',
         rows: LV6_ROWS, theme: 6,
         hint: '完全な暗闇。視界は極端に短い。',
         intro: '光が消えた。何も見えない。',
         entities: [ { type: 'hound', gx: 8, gy: 8 } ],
         timeLimit: null },
    7: { id: 7, name: 'LEVEL 7', subtitle: 'RUN FOR YOUR LIFE',
         rows: LV7_ROWS, theme: 7,
         hint: '一直線の回廊。背後から複数のHoundが迫る。HARUKI の声も混じる。',
         intro: '吠え声...そして、女の声。前へ走るしかない。',
         entities: [
           { type: 'hound', gx: 4, gy: 2 },
           { type: 'hound', gx: 3, gy: 4 },
           { type: 'hound', gx: 5, gy: 5 },
           { type: 'haruki', gx: 4, gy: 3 }
         ],
         timeLimit: null },
    8: { id: 8, name: 'LEVEL 8', subtitle: 'THE HIVE',
         rows: LV8_ROWS, theme: 8,
         hint: '六角形のセル。吊るされた何かが揺れている。',
         intro: '甘い腐臭。蜂の巣のような部屋が並ぶ。',
         entities: [
           { type: 'smiler', gx: 8, gy: 14 },
           { type: 'partygoer', gx: 14, gy: 8 }
         ],
         timeLimit: null },
    11: { id: 11, name: 'LEVEL !', subtitle: 'END OF THE LINE',
         rows: LV11_ROWS, theme: 11,
         hint: '線路の上を歩く。遠くから何かが近づく音。',
         intro: '駅の匂い...ここで降りる客はいない。',
         entities: [
           { type: 'hound', gx: 5, gy: 26 },
           { type: 'crawler', gx: 7, gy: 13 }
         ],
         timeLimit: null },
    12: { id: 12, name: 'LEVEL Fun =)', subtitle: 'ETERNAL PARTY',
         rows: LV12_ROWS, theme: 12,
         hint: 'ピンクの壁紙。終わらないパーティ。Partygoer が踊る。',
         intro: '陽気な音楽。だが、笑顔が多すぎる。',
         entities: [
           { type: 'partygoer', gx: 8, gy: 6 },
           { type: 'partygoer', gx: 10, gy: 14 },
           { type: 'partygoer', gx: 7, gy: 18 },
           { type: 'partygoer', gx: 16, gy: 2 }
         ],
         timeLimit: null },
    9: { id: 9, name: 'LEVEL 9', subtitle: 'THE SUBURBS',
         rows: LV9_ROWS, theme: 9,
         hint: '永遠に続く郊外の街。THE END への扉がここに。',
         intro: '空に月はない。月のような何かがある。',
         entities: [
           { type: 'boss', gx: 12, gy: 9 },
           { type: 'crawler', gx: 5, gy: 16 }
         ],
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
      icon: '🔦', desc: '暗いレベルで視界を広げる。トグル式。',
      persistent: true,
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
      icon: '📻', desc: 'ノイズの中に時折声が聞こえる。エンティティを察知できる。トグル式。',
      persistent: true,
      effect: function (p) {
        if (p.radioOn) { p.radioOn = false; toast('ラジオ OFF'); }
        else { p.radioOn = true; toast('ラジオ ON — エンティティ警告'); }
      }
    },
    flare: {
      id: 'flare', name: 'フレア',
      icon: '🔥', desc: '点火。周囲6マスのエンティティを4秒スタン + Boss に 50 ダメージ。HP+10。',
      effect: function (p) {
        var stunRange = 6 * TS;
        var stunned = 0;
        var bossHit = 0;
        for (var i = 0; i < entities.length; i++) {
          var e = entities[i];
          if (!e.alive) continue;
          var dx = e.x - p.x, dy = e.y - p.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < stunRange) {
            e.stunned = true;
            e.stunTimer = 4;
            stunned++;
            if (e.type === 'boss') {
              e.bossHp = (e.bossHp !== undefined ? e.bossHp : 200) - 50;
              bossHit++;
              if (e.bossHp <= 0) {
                e.alive = false;
                toast('BOSS 撃破!');
                unlockAchievement('defeat_boss');
              }
            }
          }
        }
        p.hp = Math.min(p.hpMax, p.hp + 10);
        if (audioInitialized) GameEngine.playSound('jumpscare');
        GameEngine.redFlash();
        GameEngine.shakeScreen(6, 0.3);
        var msg = 'フレア発火!';
        if (stunned > 0) msg += ' ' + stunned + '体スタン';
        if (bossHit > 0) msg += ' BOSS HIT';
        toast(msg);
      }
    },
    mirror: {
      id: 'mirror', name: 'ひび割れた鏡',
      icon: '🪞', desc: 'Skin-Stealer 消滅 + Boss に 100 ダメージ。1回使い切り。',
      effect: function (p) {
        var reflected = 0;
        var bossDmg = 0;
        for (var i = 0; i < entities.length; i++) {
          var e = entities[i];
          if (!e.alive) continue;
          if (e.type === 'skinstealer') {
            e.alive = false;
            reflected++;
          } else if (e.type === 'boss') {
            var dx = e.x - p.x, dy = e.y - p.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < 8 * TS) {
              e.bossHp = (e.bossHp !== undefined ? e.bossHp : 200) - 100;
              bossDmg++;
              if (e.bossHp <= 0) {
                e.alive = false;
                toast('BOSS 撃破!');
                unlockAchievement('defeat_boss');
              }
            }
          }
        }
        if (audioInitialized) GameEngine.playSound('static');
        var m = '鏡を構えた';
        if (reflected > 0) m += ' Skin-Stealer ' + reflected + '体消滅';
        if (bossDmg > 0) m += ' BOSS HIT';
        toast(m);
      }
    },
    almond_milk: {
      id: 'almond_milk', name: 'アーモンドミルク',
      icon: '🥛', desc: '最高級品。HP/SAN/STA を全回復。',
      effect: function (p) {
        p.hp = p.hpMax;
        p.san = p.sanMax;
        p.stam = p.stamMax;
        toast('全回復!');
        if (audioInitialized) GameEngine.playSound('item_get');
      }
    }
  };

  // ── ITEMS POOL BY LEVEL ─────────────────────────────────
  var LEVEL_ITEM_POOLS = {
    0: ['almond_water', 'bandage', 'flashlight', 'almond_milk'],
    1: ['almond_water', 'bandage', 'energy_bar', 'keycard', 'flare'],
    2: ['almond_water', 'bandage', 'energy_bar', 'flare'],
    3: ['almond_water', 'bandage', 'flashlight', 'radio', 'flare'],
    4: ['almond_water', 'keycard', 'energy_bar', 'radio', 'mirror'],
    5: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'flare'],
    6: ['almond_water', 'flashlight', 'bandage', 'flare'],
    7: ['energy_bar', 'almond_water', 'flare'],
    8: ['almond_water', 'bandage', 'radio', 'mirror', 'flare'],
    11: ['almond_water', 'flashlight', 'energy_bar', 'flare'],
    12: ['almond_water', 'energy_bar', 'voucher', 'bandage', 'flare'],
    9: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'radio', 'almond_milk']
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
        text: 'ハム音には法則がある。\n3 回点滅したら近くにエンティティ。\n5 回点滅したら、もう手遅れだ。' },
      { title: 'ROOM 0 セッション #4521',
        text: '"私たちは皆、最初にここに来る。\nそしてここを出ようとする。\nそして気付くんだ。\n— ここは入口でもあり、出口でもあると。"' },
      { title: '黄色について',
        text: '何故、Level 0 の壁紙は黄色なのか。\nそれは、人の最も古い記憶を呼び覚ます色だから。\nお前は、思い出さない方が幸せだろう。' },
      { title: '前ホテルの噂',
        text: 'no-clipper 同士の間に伝わる噂。\n\n"あるホテルに、追跡者がいた。\nハルキ、と呼ばれていた。\n獲物を no-clip するまで追い詰め、\n壁の向こうまで追ってきた、と。"\n\n— Level 5 で会えるかもしれない。' }
    ],
    1: [
      { title: '倉庫の住人',
        text: 'Hound に注意。\n見かけたら走るな。動きで反応する。\n壁に貼り付いて呼吸を整えろ。' },
      { title: '居住可能ゾーン',
        text: 'Level 1 は比較的安全だ。\n他の "no-clipper" と出会うこともある。\nもし出会えたら、それは幸運だ。\nもし、向こうから来たら...違うかもしれない。' },
      { title: 'M.E.G. 報告書',
        text: 'Major Explorer Group:\n"Level 1 は中継地点として最適。\n安全な領域あり、定期的にアーモンドウォーターが補給される。\nだが、夜は決して訪れないことを覚悟せよ。"' },
      { title: '空気の重さ',
        text: 'コンクリートの匂いと、僅かなオイル。\nここは「現実」に最も近い階層だと言われている。\nだから帰りたくなる。だから危ない。' },
      { title: 'Crawler の生態',
        text: '低く、速く、多眼。\n奴は待つ。じっと待つ。\n動きが止まったら、次の瞬間に飛びかかってくる。\n— だから、走り続けろ。' },
      { title: '誰かの遺書',
        text: '"ハルキに見つかった。\nまた逃げなければ。\n壁を抜けても、追ってくる。\nここ Level 1 までは追いつかれた。\n次はもっと深くへ。"\n\n紙片はここで途切れている。' }
    ],
    2: [
      { title: '配管夢の警告',
        text: '水に長く立つな。\nSAN がゆるやかに削れる。\nそれから...足首から何かが昇ってくる気がするだろう。' },
      { title: 'Smiler',
        text: '暗闇に白い歯だけが浮かぶ。\n見るな。目を逸らせばすり抜ける。\n見続けると...笑いに、引き込まれる。' },
      { title: '腐食した詩',
        text: '"配管は夢を見る。\n誰も流さない水を流し、\n誰も呼ばない人を呼び、\n誰も帰らない者を待つ。"' }
    ],
    3: [
      { title: '通電中',
        text: '床が黒い斑点は、まだ電流が通っている。\n触れるな。HP と SAN を一度に持っていかれる。' },
      { title: 'スパークの法則',
        text: '火花が見えた時、もう避ける時間はない。\nだから、火花が見える前に逃げろ。' },
      { title: '電気技師の最後の言葉',
        text: '"発電所を見つけた。\nこれで全階層に光を戻せる。\n— だが、誰が光を消したのか、まだ分からない。"' },
      { title: 'Wretch とは',
        text: '動かない。\nだが、視線を合わせてはいけない。\n奴の胸には穴が開いている。\nその穴は、お前の SAN を吸い込む。\n目を逸らせ。決して、見つめるな。' }
    ],
    4: [
      { title: 'デスクの落書き',
        text: '"4F 第3キュービクル、奴は私だった"\n誰が書いたのか、思い出せない。\n私の字に似ている。' },
      { title: 'Skin-Stealer',
        text: '床に倒れている同僚。\n声をかけるな。触るな。\n目を合わせるな。\n奴らはお前の皮膚を欲しがっている。' },
      { title: '退職届',
        text: '退職事由: 不在\n退職日: 不明\n署名: ____________\n\n誰の退職届だ。なぜここに。' }
    ],
    5: [
      { title: 'チェックイン用紙',
        text: 'THE HOTEL へようこそ。\n部屋は無料です。\nチェックアウトは...自由意志ではありません。' },
      { title: 'Mr. Hotel への警告',
        text: '"スーツの男に名前を尋ねられても、答えるな。\nお前の名前を持っていかれる。"' },
      { title: '404 号室',
        text: '部屋番号 404 は決して開けないこと。\n「Page Not Found」と書かれた部屋。\n中には...何も無い。\nそれが、最も怖い。' },
      { title: 'HARUKI について',
        text: '彼女はもともと、別のホテルのフロント従業員を追っていた。\nだがその獲物が壁を抜けた瞬間、\nハルキも壁を抜いた。\n— 彼女の唯一の目的は、追跡。それだけ。\n\n音は: 電話のベル。\n姿は: 暗闇から、ぼんやりと。\n対処: フレアで一時的に怯ませろ。' },
      { title: '前ホテルの遺品',
        text: 'フロントデスクに置かれた、別のホテルのキーホルダー。\n「6畳一間ホテル」と刻まれている。\n誰かが no-clip して持ち込んだものか?\n\n表面に、爪痕のような筋がついている。' },
      { title: '電話が鳴る',
        text: 'この階層では、無人の廊下に時々電話の音が響く。\n受話器は無い。\nだが、確実に聞こえる。\n\n— 出るな。\n  出れば、必ず追ってくる。' }
    ],
    6: [
      { title: '完全な暗闇',
        text: '光を消した者がいる。\n誰かがこの階層を「閉じた」のだ。\n懐中電灯がなければ、5 タイル先も見えない。' },
      { title: '闇の儀式',
        text: 'この階層に来た者の SAN は、通常の倍速で削れる。\n暗闇そのものが脳に侵食する。\n光を絶やすな。' }
    ],
    7: [
      { title: 'Run For Your Life',
        text: 'この階層に立ち止まった者はいない。\n走れ。\n振り返るな。\n奴らの数は、振り返るたびに増える。' },
      { title: '最速記録',
        text: 'この階層を 60 秒未満でクリアした者がいるという。\n彼は今、走り続けている。\n他の階層で。\n他の自分から、逃げ続けている。' }
    ],
    8: [
      { title: 'The Hive — 巣',
        text: 'セルの中に何かが吊るされている。\nそれを直視しないこと。\n甘い香りに意識を持っていかれる。' },
      { title: '巣の主',
        text: 'Smiler と Partygoer が共存している珍しい階層。\n奴らは互いに干渉しない。\nそして両方ともお前に興味を持っている。' },
      { title: '蜂蜜のような',
        text: '空気が甘い。\n床に小さな黄色い液滴が落ちている。\n蜂蜜? いや、もっと粘度が高い。\n— 触れるな。' }
    ],
    11: [
      { title: 'End of the Line',
        text: '線路は始点も終点も無い。\nだが、列車は時々通る。\n音が聞こえたら、伏せろ。' },
      { title: '駅員ノート',
        text: '"乗客 0 / 降客 ∞"\n"次の列車: もうすぐ"\n"次の次の列車: もう来ない"' },
      { title: '時刻表',
        text: '12:00\n00:00\n??:??\n\n次の到着時刻は表記されていない。\n"列車は always 通ります" と注釈がある。' }
    ],
    12: [
      { title: 'Fun =)',
        text: 'パーティへようこそ!\n音楽は止まりません。\n笑顔の彼らは、お前にも笑顔を分けたがる。\n— 文字通り、お前の顔を切り取って。' },
      { title: '招待状',
        text: '宛先: 全 no-clipper 様\n本日のパーティは無料です。\nお帰りも無料です — できれば。' },
      { title: 'コンフェッティ',
        text: '床に散らばる紙片を拾った。\n読めない言語で何かが書かれている。\n— だが、自分の名前だけはハッキリと読めた。' }
    ],
    9: [
      { title: '郊外の終わり',
        text: 'この街には終わりがあるという。\n最後の家のドアを開ければ、そこに...\n何があるのか、誰も戻って報告していない。' },
      { title: 'THE END',
        text: '黒い扉を見つけたら、それが終点だ。\nそこを開けば「TRUE END」へ到達できる。\nだが、開けないという選択肢もある。' },
      { title: 'THE OPERATOR',
        text: 'この階層を支配する存在。\n王冠を被った人型。\n3 つの段階で本性を見せる。\n\nフェーズ 1: 観察。徘徊。\nフェーズ 2: 接近。突進。\nフェーズ 3: 分裂。影を生み出す。\n\n— 倒さなくても TRUE END は見られる。だが、奴を倒した者だけが、本当の終わりを知る。' }
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

  // Mini-game
  var miniGameOpen = false;
  var currentMiniGame = null;
  var mgState = null;
  var mgPlayedAt = {};  // {levelId_safeKey: true} — prevent replay per visit

  // Achievements
  var unlockedAchievements = {};

  // Toast
  var toastTimer = null;

  // Save key
  var SAVE_KEY = 'thebackrooms_save_v1';
  var ACH_KEY = 'thebackrooms_ach_v1';
  var BEST_KEY = 'thebackrooms_best_v1';
  var DIFF_KEY = 'thebackrooms_diff_v1';
  var TUT_KEY = 'thebackrooms_tut_v1';
  var ENDLESS_KEY = 'thebackrooms_endless_v1';
  var STATS_KEY = 'thebackrooms_stats_v1';
  var ENT_SEEN_KEY = 'thebackrooms_ent_seen_v1';
  var GFX_KEY = 'thebackrooms_gfx_v1';

  var gfxQuality = 'high'; // 'high' | 'low'

  // Lifetime stats (persists across all runs)
  var stats = {
    totalDeaths: 0,
    totalNoClips: 0,
    totalRuns: 0,
    totalPlayTime: 0,
    totalItemsCollected: 0,
    totalNotesRead: 0,
    totalDistanceWalked: 0
  };

  var entitySeenTypes = {}; // {type: true}

  var ENTITY_INTROS = {
    hound: { name: 'HOUND', desc: '低い四足の捕食者。動くものに反応する。\n走るな。歩け。' },
    smiler: { name: 'SMILER', desc: '暗闇に浮かぶ白い歯。\n見つめると意識を奪われる。' },
    skinstealer: { name: 'SKIN-STEALER', desc: '死体のフリをして近付ける。\n触れるな。鏡が有効。' },
    partygoer: { name: 'PARTYGOER', desc: '陽気な笑顔と帽子。\n陽気さで殴ってくる。' },
    crawler: { name: 'CRAWLER', desc: '低くて速い。多眼。\n突進と撤退を繰り返す。' },
    wretch: { name: 'WRETCH', desc: '動かない。だが見つめると胸の穴に SAN を吸われる。\n目を逸らせ。' },
    boss: { name: 'THE OPERATOR', desc: '王冠を被った階層支配者。\n3 段階で姿を変える。フレア/鏡で攻撃。' },
    mrhotel: { name: 'MR. HOTEL', desc: 'シルクハットの男。顔は無い。\n4 マス以内で SAN を継続的に削る。' },
    haruki: { name: 'HARUKI', desc: '前のホテルから no-clip した存在。\nお前と同じ。だが、戻ろうとしない。\n追ってくる理由は、ただ "あなただから"。' }
  };

  // First-run tutorial state
  var tutorialDone = false;
  var tutorialStep = -1;
  var tutorialTimer = 0;

  // Game mode
  var gameMode = 'normal'; // 'normal' | 'endless'
  var endlessFloor = 0;
  var endlessVisitedLevels = [];
  var endlessScore = 0;
  var endlessBestScore = 0;

  // Difficulty modes (multipliers applied to SAN drain + enemy speed)
  var DIFFICULTIES = {
    easy:   { name: 'EASY',   sanMul: 0.5,  enemySpeedMul: 0.7,  hpMul: 1.5 },
    normal: { name: 'NORMAL', sanMul: 1.0,  enemySpeedMul: 1.0,  hpMul: 1.0 },
    hard:   { name: 'HARD',   sanMul: 1.5,  enemySpeedMul: 1.3,  hpMul: 0.7 },
    chaos:  { name: 'CHAOS',  sanMul: 2.5,  enemySpeedMul: 1.8,  hpMul: 0.5 }
  };
  var currentDifficulty = 'normal';

  // Best times per level (sec) — persists across runs
  var bestTimes = {};

  // ============================================================
  //  UTILITY
  // ============================================================
  var _elCache = {};
  function el(id) {
    if (_elCache[id]) return _elCache[id];
    var e = document.getElementById(id);
    if (e) _elCache[id] = e;
    return e;
  }

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
    else if (levelId === 8) {
      // The Hive — green-tinted dim lights
      var i8 = 0;
      for (var gy8 = 4; gy8 < m.height; gy8 += 6) {
        for (var gx8 = 4; gx8 < m.width; gx8 += 6) {
          if (m.tiles[gy8][gx8] === 0) {
            GameEngine.addPointLight('l_' + (i8++), gx8, gy8, {
              radius: 3, r: 180, g: 220, b: 130, intensity: 0.35,
              flicker: 4, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 11) {
      // End of the Line — very dim sparse white lights with flicker
      var i11 = 0;
      for (var gy11 = 5; gy11 < m.height; gy11 += 7) {
        GameEngine.addPointLight('l_' + (i11++), 6, gy11, {
          radius: 2, r: 200, g: 200, b: 215, intensity: 0.25,
          flicker: 8, phase: Math.random() * 6.28
        });
      }
    } else if (levelId === 12) {
      // Fun =) — bright pink + chase pattern colored party lights
      var i12 = 0;
      var partyColors = [
        [255, 100, 180], [180, 100, 255], [100, 180, 255], [255, 200, 100]
      ];
      for (var gy12 = 2; gy12 < m.height; gy12 += 3) {
        for (var gx12 = 3; gx12 < m.width; gx12 += 4) {
          if (m.tiles[gy12][gx12] === 0) {
            var pc = partyColors[i12 % partyColors.length];
            GameEngine.addPointLight('l_' + (i12++), gx12, gy12, {
              radius: 3, r: pc[0], g: pc[1], b: pc[2], intensity: 0.7,
              flicker: 5, phase: Math.random() * 6.28
            });
          }
        }
      }
    } else if (levelId === 7) {
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

  var GAMEPLAY_TIPS = [
    '蛍光灯のハム音が変化したら近くにエンティティ',
    'Smiler は直視するな。視線を逸らせ',
    'Skin-Stealer は床の死体。触るな',
    'no-clip 地点は黄色い▲で示される',
    'スマホの Notes タブでロアと進捗を確認',
    'スタミナがあれば両スティック同時押しでダッシュ',
    'フレアはエンティティをスタン + Boss にダメージ',
    'カードキーは Lv1 で入手して Lv4/Lv5 で使う',
    'セーフエリアでは HP/SAN がゆっくり回復',
    'ベストタイムは Free Roam モードでも更新される',
    'CHAOS 難易度は SAN drain 2.5倍 + 敵速度 1.8倍',
    'ENDLESS モードは階毎に難易度上昇',
    'ロア全収集 + 全アチーブで TRUE+ END 解放'
  ];

  function showLoadingScreen(def) {
    el('loadingLevel').textContent = def.name;
    el('loadingName').textContent = def.subtitle;
    // Show HARUKI image only on Lv5 loading
    var harL = el('loadingHaruki');
    if (harL) harL.style.display = (def.id === 5) ? 'flex' : 'none';
    // 50% chance to show level hint, 50% random gameplay tip
    if (Math.random() < 0.5 && visitedLevels[def.id]) {
      el('loadingHint').textContent = 'TIP: ' + GAMEPLAY_TIPS[Math.floor(Math.random() * GAMEPLAY_TIPS.length)];
    } else {
      el('loadingHint').textContent = def.hint;
    }
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
    if (gameMode === 'endless') {
      el('floorText').textContent = 'ENDLESS F' + endlessFloor + ' / LV' + currentLevel + ' / ' + endlessScore;
    } else {
      el('floorText').textContent = 'LV' + currentLevel;
    }
    el('objectiveHUD').style.display = '';
    el('objectiveText').textContent = currentLevelDef.intro;
    setTimeout(function () { hideOverlay('objectiveHUD'); el('objectiveHUD').style.display = 'none'; }, 5000);

    // First-time tutorial trigger (only Lv0, first run)
    if (currentLevel === 0 && !tutorialDone) {
      tutorialStep = 0;
      tutorialTimer = 6;
      setTimeout(function () { showTutorialStep(0); }, 6000);
    }

    // Lv5: first-time HARUKI subliminal flash (cinematic)
    if (currentLevel === 5 && !unlockedAchievements.encounter_haruki) {
      setTimeout(function () {
        var hImg = GameEngine.images['assets/img/haruki_scary.png'] ||
                   GameEngine.images['assets/img/haruki.png'];
        if (hImg) {
          GameEngine.flashImage(hImg, 250);
          if (audioInitialized) GameEngine.playSound('stinger');
        }
      }, 3500);
    }

    // Save automatically on level start
    saveGame();
  }

  var TUT_HINTS = [
    '左スティックで移動。右スティックで視点を回せ。',
    '同時に動かしてダッシュ。STA を消費する。',
    '黄色いアイテム/ノートを見つけたら 赤ボタンで拾え。',
    '黄色の▲ no-clip 地点を探せ。壁の隙間に隠れていることも。',
    '右上のスマホでステータス・マップ・記録を確認できる。'
  ];

  function showTutorialStep(step) {
    if (tutorialDone) return;
    if (step >= TUT_HINTS.length) {
      tutorialDone = true;
      localStorage.setItem(TUT_KEY, '1');
      return;
    }
    var hud = el('objectiveHUD');
    var txt = el('objectiveText');
    hud.style.display = 'block';
    txt.textContent = '[ヒント] ' + TUT_HINTS[step];
    setTimeout(function () {
      hud.style.display = 'none';
      setTimeout(function () { showTutorialStep(step + 1); }, 2500);
    }, 5500);
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
    if (miniGameOpen) return;

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
      unlockAchievement('found_safe_zone');
    }

    // SAN drain per level (modulated by difficulty)
    var theme = THEMES[currentLevelDef.theme];
    var sanDrain = (theme && theme.sanDrain) || 0.5;
    // Faster if in dark / no flashlight on Level 6
    if (currentLevel === 6 && !player.flashlightOn) sanDrain *= 2;
    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    sanDrain *= diff.sanMul;
    // Endless: scale per floor
    if (gameMode === 'endless') sanDrain *= (1 + endlessFloor * 0.08);
    player.san = Math.max(0, player.san - sanDrain * dt);

    // Stamina regen
    if (sprint) player._sprintingDuration = (player._sprintingDuration || 0) + dt;
    else player._sprintingDuration = 0;

    // Death check
    if (player.hp <= 0) {
      var killer = '不明';
      var killerType = null;
      if (player.inHazard) killer = '通電床のハザード';
      else if (player.inWater) killer = '水底';
      else if (entities.length > 0) {
        var minD = Infinity, closestE = null;
        for (var ek = 0; ek < entities.length; ek++) {
          if (!entities[ek].alive) continue;
          var ekDx = entities[ek].x - player.x;
          var ekDy = entities[ek].y - player.y;
          var ekD = Math.sqrt(ekDx * ekDx + ekDy * ekDy);
          if (ekD < minD) { minD = ekD; closestE = entities[ek]; }
        }
        if (closestE && minD < 3 * TS) {
          var iName = ENTITY_INTROS[closestE.type];
          killer = iName ? iName.name : closestE.type;
          killerType = closestE.type;
        }
      }
      // HARUKI jumpscare
      if (killerType === 'haruki') {
        var hImg = GameEngine.images['assets/img/haruki_scary.png'] || GameEngine.images['assets/img/haruki.png'];
        if (hImg) GameEngine.flashImage(hImg, 1000);
        if (audioInitialized) GameEngine.playSound('jumpscare');
        GameEngine.redFlash();
        GameEngine.shakeScreen(20, 0.8);
      }
      die('HP消失', 'HP がゼロになった。\n死因: ' + killer);
      return;
    }
    if (player.san <= 0) {
      die('SAN崩壊', '正気を失い、二度と戻れなくなった。\n壁紙の黄色が、最後の光景だった。');
      return;
    }

    // Action button: pick up items, read notes, no-clip
    if (inp.actionJustPressed) {
      handleAction();
      // Visual ripple feedback
      var actBtn = el('actionBtn');
      if (actBtn) {
        actBtn.classList.remove('ripple');
        void actBtn.offsetWidth; // force reflow
        actBtn.classList.add('ripple');
      }
    }

    // Update vitals UI
    var hpRatio = player.hp / player.hpMax;
    var sanRatio0 = player.san / player.sanMax;
    var stamRatio = player.stam / player.stamMax;
    el('hpFill').style.width = (hpRatio * 100) + '%';
    el('sanFill').style.width = (sanRatio0 * 100) + '%';
    el('stamFill').style.width = (stamRatio * 100) + '%';
    el('hpFill').classList.toggle('low', hpRatio < 0.25);
    el('sanFill').classList.toggle('low', sanRatio0 < 0.25);
    el('stamFill').classList.toggle('low', stamRatio < 0.2);

    // Threshold warnings (sound + toast on crossing 50% / 25%)
    if (!player._lastHpRatio) player._lastHpRatio = 1;
    if (!player._lastSanRatio) player._lastSanRatio = 1;
    if (player._lastHpRatio >= 0.25 && hpRatio < 0.25 && audioInitialized) {
      GameEngine.playSound('heartbeat');
      toast('⚠ HP 25% 以下');
    }
    if (player._lastSanRatio >= 0.25 && sanRatio0 < 0.25 && audioInitialized) {
      GameEngine.playSound('whisper');
      toast('⚠ SAN 25% 以下');
    }
    player._lastHpRatio = hpRatio;
    player._lastSanRatio = sanRatio0;

    // Flashlight effect: dynamic point light at player position
    if (player.flashlightOn) {
      var fgx = Math.floor(player.x / TS);
      var fgy = Math.floor(player.y / TS);
      GameEngine.addPointLight('player_flashlight', fgx, fgy, {
        radius: 6, r: 255, g: 240, b: 200, intensity: 0.9
      });
    } else {
      GameEngine.removePointLight('player_flashlight');
    }

    // Time
    playTime += dt;
    inLevelTime += dt;

    // SAN-driven visual effects + HARUKI proximity bonus
    var sanRatio = player.san / player.sanMax;
    var harukiNear = 0;
    for (var hkI = 0; hkI < entities.length; hkI++) {
      if (entities[hkI].type === 'haruki' && entities[hkI].alive) {
        var hkD = Math.sqrt(
          (entities[hkI].x - player.x) * (entities[hkI].x - player.x) +
          (entities[hkI].y - player.y) * (entities[hkI].y - player.y)
        );
        if (hkD < 6 * TS) {
          harukiNear = Math.max(harukiNear, 1 - hkD / (6 * TS));
        }
      }
    }
    GameEngine.vignetteIntensity = (theme.vignette || 0.3) + (1 - sanRatio) * 0.4 + harukiNear * 0.3;
    GameEngine.chromaticLevel = (theme.chromatic || 0) + (1 - sanRatio) * 0.4 + harukiNear * 0.4;
    GameEngine.grainIntensity = (theme.grain || 0.3) + (1 - sanRatio) * 0.2 + harukiNear * 0.2;

    // SAN whisper on low SAN
    if (sanRatio < 0.4 && Math.random() < 0.0015 && audioInitialized) {
      GameEngine.playSound('whisper');
    }

    // Level-specific dynamic events
    if (currentLevel === 3) {
      // Electrical Station: random brief blackouts
      player._blackoutTimer = (player._blackoutTimer || 0) - dt;
      if (player._blackoutTimer <= 0) {
        player._blackoutTimer = 10 + Math.random() * 8;
        if (Math.random() < 0.5) {
          GameEngine.staticEffect(0.5);
          GameEngine.shakeScreen(4, 0.4);
          if (audioInitialized) GameEngine.playSound('static');
          setTimeout(function () { GameEngine.staticEffect(0); }, 700);
        }
      }
    } else if (currentLevel === 11) {
      // End of the Line: train passes
      player._trainTimer = (player._trainTimer || 0) - dt;
      if (player._trainTimer <= 0) {
        player._trainTimer = 16 + Math.random() * 14;
        if (Math.random() < 0.5) {
          GameEngine.shakeScreen(18, 3);
          if (audioInitialized) GameEngine.playSound('thunder');
          toast('列車が通過する...');
        }
      }
    } else if (currentLevel === 12) {
      // Fun =): periodic confetti / party effect
      if (Math.random() < 0.02) {
        var pAng2 = Math.random() * Math.PI * 2;
        GameEngine.addParticle('spark', player.x + Math.cos(pAng2) * 100, player.y + Math.sin(pAng2) * 100);
      }
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
  //  ACHIEVEMENTS
  // ============================================================
  var ACHIEVEMENTS = {
    first_no_clip:    { name: 'はじめての no-clip', icon: '↓' },
    five_clears:      { name: '5 階層クリア', icon: '◆' },
    all_clears:       { name: '全階層踏破', icon: '★' },
    no_damage_lv:     { name: '無傷で1階層クリア', icon: '◇' },
    found_safe_zone:  { name: 'セーフエリア発見', icon: '◉' },
    won_minigame:     { name: 'ミニゲーム勝利', icon: '🎯' },
    san_zero_survive: { name: 'SAN 10% で生還', icon: '☉' },
    collect_10_notes: { name: 'ロア 10 件収集', icon: '≡' },
    inventory_full:   { name: 'インベントリ満載', icon: '▣' },
    true_end:         { name: 'TRUE END 到達', icon: '∞' },
    defeat_boss:      { name: 'BOSS 撃破', icon: '☠' },
    endless_5_floors: { name: 'ENDLESS 5階突破', icon: '∇' },
    endless_score_500:{ name: 'ENDLESS スコア 500', icon: '⚆' },
    play_chaos:       { name: 'CHAOS 難易度プレイ', icon: '⚠' },
    use_all_weapons:  { name: '全武器使用', icon: '⚔' },
    speed_demon:      { name: 'Level 7 を 60s 以内', icon: '⚡' },
    collect_all_items:{ name: '全 10 種類入手', icon: '◈' },
    silent_run:       { name: '無音 (アイテム未使用) 1階クリア', icon: '◐' },
    survive_haruki:   { name: 'HARUKI を振り切る', icon: '🩸' },
    encounter_haruki: { name: 'HARUKI と遭遇', icon: '👁' }
  };

  function unlockAchievement(id) {
    if (unlockedAchievements[id]) return;
    var ach = ACHIEVEMENTS[id];
    if (!ach) return;
    unlockedAchievements[id] = true;
    showAchievementToast(ach);
    // Persist to dedicated achievement store (cross-run)
    try {
      localStorage.setItem(ACH_KEY, JSON.stringify(unlockedAchievements));
    } catch (e) { /* ignore */ }
    saveGame();
  }

  function loadAchievements() {
    try {
      var s = localStorage.getItem(ACH_KEY);
      if (s) unlockedAchievements = JSON.parse(s) || {};
    } catch (e) { unlockedAchievements = {}; }
  }

  function loadBestTimes() {
    try {
      var s = localStorage.getItem(BEST_KEY);
      if (s) bestTimes = JSON.parse(s) || {};
    } catch (e) { bestTimes = {}; }
  }

  function loadDifficulty() {
    var s = localStorage.getItem(DIFF_KEY);
    if (s && DIFFICULTIES[s]) currentDifficulty = s;
  }

  function loadTutorialDone() {
    tutorialDone = localStorage.getItem(TUT_KEY) === '1';
  }

  function loadEndlessBest() {
    var s = localStorage.getItem(ENDLESS_KEY);
    endlessBestScore = s ? parseInt(s, 10) || 0 : 0;
  }

  function loadStats() {
    try {
      var s = localStorage.getItem(STATS_KEY);
      if (s) {
        var parsed = JSON.parse(s);
        for (var k in parsed) if (k in stats) stats[k] = parsed[k];
      }
      var es = localStorage.getItem(ENT_SEEN_KEY);
      if (es) entitySeenTypes = JSON.parse(es) || {};
    } catch (e) { /* ignore */ }
  }

  function saveStats() {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      localStorage.setItem(ENT_SEEN_KEY, JSON.stringify(entitySeenTypes));
    } catch (e) {}
  }

  function saveEndlessBest() {
    if (endlessScore > endlessBestScore) {
      endlessBestScore = endlessScore;
      try { localStorage.setItem(ENDLESS_KEY, String(endlessBestScore)); } catch (e) {}
    }
  }

  function startEndlessMode() {
    state = ST.LOADING;
    hideOverlay('titleScreen');
    gameMode = 'endless';
    stats.totalRuns++;
    saveStats();
    endlessFloor = 0;
    endlessVisitedLevels = [];
    endlessScore = 0;
    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    player.hpMax = Math.round(100 * diff.hpMul);
    player.hp = player.hpMax;
    player.san = player.sanMax = 100;
    player.stam = player.stamMax = 100;
    player.inventory = {};
    player.flashlightOn = false;
    player.radioOn = false;
    playTime = 0;
    discoveredNotes = [];
    pickedUpItems = {};
    readNotes = {};
    discoveredMap = {};
    mgPlayedAt = {};

    if (!audioInitialized) {
      GameEngine.initAudio();
      audioInitialized = true;
    }
    setLevel(pickNextEndlessLevel());
  }

  function pickNextEndlessLevel() {
    var allLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 9];
    // Remove already visited this cycle
    var avail = allLevels.filter(function (l) { return endlessVisitedLevels.indexOf(l) < 0; });
    if (avail.length === 0) {
      // Reset cycle but exclude current
      endlessVisitedLevels = [currentLevel];
      avail = allLevels.filter(function (l) { return l !== currentLevel; });
    }
    var pick = avail[Math.floor(Math.random() * avail.length)];
    endlessVisitedLevels.push(pick);
    return pick;
  }
  function setDifficulty(id) {
    if (!DIFFICULTIES[id]) return;
    currentDifficulty = id;
    localStorage.setItem(DIFF_KEY, id);
    toast('難易度: ' + DIFFICULTIES[id].name);
  }

  function showAchievementToast(ach) {
    var t = el('achievementToast');
    el('achName').textContent = ach.name;
    el('achIcon').textContent = ach.icon;
    t.style.display = 'flex';
    requestAnimationFrame(function () {
      t.classList.add('show');
    });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.style.display = 'none'; }, 400);
    }, 3500);
  }

  // ============================================================
  //  MINI-GAMES
  // ============================================================
  // Each safe zone in a level can host one mini-game.
  // Per-level default mini-game (cycles through types).
  var LEVEL_MINIGAMES = {
    0: 'vending',
    1: 'lockpick',
    5: 'memory',
    8: 'snake',
    9: 'cipher',
    12: 'pong'
  };

  // Mini-game definitions
  var MINI_GAMES = {

    // ── VENDING MACHINE ──
    vending: {
      title: '自動販売機',
      subtitle: 'タップしてリールを回転 → 3 個のアイテム獲得',
      itemPool: ['almond_water', 'almond_water', 'almond_water', 'bandage', 'bandage', 'energy_bar', 'flashlight'],
      init: function () {
        mgState = {
          reels: [0, 0, 0],
          spinning: [false, false, false],
          spinTimer: [0, 0, 0],
          spinTotal: [0, 0, 0],
          stopped: 0,
          won: null,
          phase: 'idle' // idle, spinning, done
        };
        setMGAction('スピン', 'green');
        setMGStatus('スピンを押せ');
      },
      action: function () {
        if (mgState.phase !== 'idle') return;
        mgState.phase = 'spinning';
        for (var i = 0; i < 3; i++) {
          mgState.spinning[i] = true;
          mgState.spinTotal[i] = 1.2 + i * 0.5;
          mgState.spinTimer[i] = 0;
        }
        setMGStatus('スピン中...');
        setMGAction('待機中...', 'gray');
      },
      update: function (dt) {
        if (mgState.phase !== 'spinning') return;
        var spinSpeed = 18;
        for (var i = 0; i < 3; i++) {
          if (mgState.spinning[i]) {
            mgState.reels[i] = (mgState.reels[i] + spinSpeed * dt) % MINI_GAMES.vending.itemPool.length;
            mgState.spinTimer[i] += dt;
            if (mgState.spinTimer[i] >= mgState.spinTotal[i]) {
              mgState.spinning[i] = false;
              mgState.reels[i] = Math.floor(Math.random() * MINI_GAMES.vending.itemPool.length);
              mgState.stopped++;
            }
          }
        }
        if (mgState.stopped >= 3) {
          mgState.phase = 'done';
          // Award items
          var wonItems = [];
          for (var j = 0; j < 3; j++) {
            var itemId = MINI_GAMES.vending.itemPool[mgState.reels[j]];
            player.inventory[itemId] = (player.inventory[itemId] || 0) + 1;
            wonItems.push(ITEMS[itemId].name);
          }
          setMGStatus('入手: ' + wonItems.join(', '));
          setMGAction('終了', 'green');
          unlockAchievement('won_minigame');
          if (audioInitialized) GameEngine.playSound('item_get');
        }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#0d0c08';
        ctx.fillRect(0, 0, w, h);
        // Frame
        ctx.strokeStyle = '#786020';
        ctx.lineWidth = 4;
        ctx.strokeRect(8, 8, w - 16, h - 16);

        // 3 reels
        var reelW = (w - 60) / 3;
        var reelH = h - 60;
        var pool = MINI_GAMES.vending.itemPool;
        for (var i = 0; i < 3; i++) {
          var rx = 20 + i * (reelW + 10);
          var ry = 30;
          ctx.fillStyle = '#1a1408';
          ctx.fillRect(rx, ry, reelW, reelH);
          ctx.strokeStyle = '#483910';
          ctx.lineWidth = 2;
          ctx.strokeRect(rx, ry, reelW, reelH);

          // Show 3 items per reel, centered
          var cur = mgState.reels[i];
          for (var off = -1; off <= 1; off++) {
            var idx = (Math.floor(cur) + off + pool.length) % pool.length;
            var item = ITEMS[pool[idx]];
            var iy = ry + reelH / 2 + off * reelH / 3 - 20;
            var alpha = off === 0 ? 1 : 0.4;
            ctx.globalAlpha = alpha;
            ctx.font = '32px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(item.icon, rx + reelW / 2, iy + 32);
            ctx.globalAlpha = 1;
          }

          // Center line
          ctx.strokeStyle = '#d4b340';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx, ry + reelH / 2);
          ctx.lineTo(rx + reelW, ry + reelH / 2);
          ctx.stroke();
        }
      }
    },

    // ── LOCK PICK ──
    lockpick: {
      title: '錠前破り',
      subtitle: '緑のゾーンでタップ × 3 回',
      init: function () {
        mgState = {
          phase: 'play',
          cursor: 0,
          dir: 1,
          speed: 0.7, // % per second
          zoneStart: 0.4,
          zoneEnd: 0.55,
          stage: 0,
          maxStages: 3,
          failTimes: 0,
          message: ''
        };
        setMGAction('タップ', 'green');
        setMGStatus('ステージ 1/3');
      },
      action: function () {
        if (mgState.phase !== 'play') return;
        var inZone = mgState.cursor >= mgState.zoneStart && mgState.cursor <= mgState.zoneEnd;
        if (inZone) {
          mgState.stage++;
          setMGStatus('OK! ステージ ' + (mgState.stage + 1) + '/' + mgState.maxStages);
          if (mgState.stage >= mgState.maxStages) {
            mgState.phase = 'win';
            setMGStatus('解錠成功! カードキー +1');
            setMGAction('終了', 'green');
            player.inventory.keycard = (player.inventory.keycard || 0) + 1;
            unlockAchievement('won_minigame');
            if (audioInitialized) GameEngine.playSound('key_unlock');
          } else {
            mgState.speed *= 1.3;
            mgState.zoneEnd = mgState.zoneStart + (mgState.zoneEnd - mgState.zoneStart) * 0.8;
            mgState.zoneStart = 0.2 + Math.random() * 0.5;
            mgState.zoneEnd = mgState.zoneStart + 0.12;
            if (audioInitialized) GameEngine.playSound('clock_tick');
          }
        } else {
          mgState.failTimes++;
          if (audioInitialized) GameEngine.playSound('hit');
          if (mgState.failTimes >= 3) {
            mgState.phase = 'lose';
            setMGStatus('失敗! 錠が壊れた');
            setMGAction('終了', 'red');
          } else {
            setMGStatus('ミス! 残り試行 ' + (3 - mgState.failTimes));
          }
        }
      },
      update: function (dt) {
        if (mgState.phase !== 'play') return;
        mgState.cursor += mgState.dir * mgState.speed * dt;
        if (mgState.cursor >= 1) { mgState.cursor = 1; mgState.dir = -1; }
        if (mgState.cursor <= 0) { mgState.cursor = 0; mgState.dir = 1; }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#0d0c08';
        ctx.fillRect(0, 0, w, h);
        // Lock illustration top
        var lockY = 50;
        var lockSize = 80;
        ctx.fillStyle = '#382a08';
        ctx.fillRect(w / 2 - lockSize / 2, lockY, lockSize, lockSize);
        ctx.fillStyle = mgState.phase === 'win' ? '#88c050' : (mgState.phase === 'lose' ? '#c63a3a' : '#786020');
        ctx.fillRect(w / 2 - 20, lockY + 20, 40, 30);
        // Stages indicator
        for (var s = 0; s < mgState.maxStages; s++) {
          ctx.fillStyle = s < mgState.stage ? '#88c050' : '#382a08';
          ctx.fillRect(w / 2 - 30 + s * 22, lockY + 60, 16, 6);
        }

        // Slider track
        var barY = h - 80;
        var barH = 24;
        var barX = 20;
        var barW = w - 40;
        ctx.fillStyle = '#1a1408';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.strokeStyle = '#483910';
        ctx.strokeRect(barX, barY, barW, barH);
        // Green zone
        ctx.fillStyle = 'rgba(136, 192, 80, 0.5)';
        ctx.fillRect(barX + barW * mgState.zoneStart, barY,
                     barW * (mgState.zoneEnd - mgState.zoneStart), barH);
        // Cursor
        ctx.fillStyle = '#d4b340';
        var cx = barX + barW * mgState.cursor;
        ctx.fillRect(cx - 2, barY - 4, 4, barH + 8);
        // Label
        ctx.font = 'bold 14px sans-serif';
        ctx.fillStyle = '#d4b340';
        ctx.textAlign = 'center';
        ctx.fillText('緑ゾーンでタップ', w / 2, barY - 12);
      }
    },

    // ── CARD MEMORY ──
    memory: {
      title: 'カード合わせ',
      subtitle: '同じ絵柄のペアを全て揃えろ',
      icons: ['🥤', '🩹', '🍫', '🔦', '🔑', '📻'],
      init: function () {
        // 4 pairs = 8 cards (3 pairs from 6 icons)
        var pool = MINI_GAMES.memory.icons.slice(0, 4); // 4 pairs
        var cards = pool.concat(pool); // 8 cards
        // Shuffle
        for (var i = cards.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
        }
        mgState = {
          cards: cards,
          revealed: [false, false, false, false, false, false, false, false],
          flipped: [],
          matchedCount: 0,
          attempts: 0,
          maxAttempts: 12,
          phase: 'play',
          flipBackTimer: 0
        };
        setMGAction('閉じる', 'gray');
        setMGStatus('試行 0/' + mgState.maxAttempts);
      },
      action: function () {
        // Action button is just close
        closeMiniGame();
      },
      onTap: function (cx, cy, w, h) {
        if (mgState.phase !== 'play') return;
        if (mgState.flipped.length >= 2) return;
        var cols = 4, rows = 2;
        var gridY = 50;
        var gridH = h - 100;
        var cardW = (w - 40) / cols;
        var cardH = gridH / rows;
        for (var i = 0; i < 8; i++) {
          var r = Math.floor(i / cols);
          var c = i % cols;
          var x = 20 + c * cardW;
          var y = gridY + r * cardH;
          if (cx >= x && cx <= x + cardW && cy >= y && cy <= y + cardH) {
            if (mgState.revealed[i] || mgState.flipped.indexOf(i) >= 0) return;
            mgState.flipped.push(i);
            if (audioInitialized) GameEngine.playSound('clock_tick');
            if (mgState.flipped.length === 2) {
              mgState.attempts++;
              setMGStatus('試行 ' + mgState.attempts + '/' + mgState.maxAttempts);
              var a = mgState.flipped[0];
              var b = mgState.flipped[1];
              if (mgState.cards[a] === mgState.cards[b]) {
                // Match
                mgState.revealed[a] = true;
                mgState.revealed[b] = true;
                mgState.matchedCount++;
                mgState.flipped = [];
                if (mgState.matchedCount >= 4) {
                  mgState.phase = 'win';
                  setMGStatus('クリア! 試行 ' + mgState.attempts + ' 回');
                  // Reward: random useful item
                  var rewardId = ['almond_water', 'bandage', 'energy_bar'][Math.floor(Math.random() * 3)];
                  player.inventory[rewardId] = (player.inventory[rewardId] || 0) + 2;
                  toast(ITEMS[rewardId].name + ' ×2 入手');
                  unlockAchievement('won_minigame');
                  if (audioInitialized) GameEngine.playSound('item_get');
                  setMGAction('終了', 'green');
                }
              } else {
                // No match — flip back after delay
                mgState.flipBackTimer = 0.8;
              }
              if (mgState.attempts >= mgState.maxAttempts && mgState.phase === 'play') {
                mgState.phase = 'lose';
                setMGStatus('試行回数切れ。');
                setMGAction('終了', 'red');
              }
            }
            return;
          }
        }
      },
      update: function (dt) {
        if (mgState.flipBackTimer > 0) {
          mgState.flipBackTimer -= dt;
          if (mgState.flipBackTimer <= 0) {
            mgState.flipped = [];
          }
        }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#0d0c08';
        ctx.fillRect(0, 0, w, h);
        var cols = 4, rows = 2;
        var gridY = 50;
        var gridH = h - 100;
        var cardW = (w - 40) / cols;
        var cardH = gridH / rows;
        for (var i = 0; i < 8; i++) {
          var r = Math.floor(i / cols);
          var c = i % cols;
          var x = 20 + c * cardW + 4;
          var y = gridY + r * cardH + 4;
          var rw = cardW - 8;
          var rh = cardH - 8;
          var open = mgState.revealed[i] || mgState.flipped.indexOf(i) >= 0;
          ctx.fillStyle = open ? '#382a08' : '#1a1408';
          ctx.fillRect(x, y, rw, rh);
          ctx.strokeStyle = open ? '#d4b340' : '#483910';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, rw, rh);
          if (open) {
            ctx.font = '36px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(mgState.cards[i], x + rw / 2, y + rh / 2);
          } else {
            ctx.font = '24px serif';
            ctx.fillStyle = '#786020';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', x + rw / 2, y + rh / 2);
          }
        }
      }
    },

    // ── SNAKE ──
    snake: {
      title: 'スネーク',
      subtitle: 'ドットを5個食べると勝利 — タップして方向転換',
      init: function () {
        mgState = {
          phase: 'play',
          grid: 12,
          snake: [{x: 6, y: 8}, {x: 5, y: 8}, {x: 4, y: 8}],
          dir: {x: 1, y: 0},
          nextDir: {x: 1, y: 0},
          food: {x: 9, y: 4},
          tick: 0,
          tickRate: 0.18,
          eaten: 0,
          goal: 5
        };
        setMGAction('閉じる', 'gray');
        setMGStatus('0 / 5');
      },
      action: function () { closeMiniGame(); },
      onTap: function (cx, cy, w, h) {
        if (mgState.phase !== 'play') return;
        // Determine direction from tap relative to canvas center
        var dx = cx - w / 2;
        var dy = cy - h / 2;
        // Disallow 180 reversal
        if (Math.abs(dx) > Math.abs(dy)) {
          var nd = dx > 0 ? {x: 1, y: 0} : {x: -1, y: 0};
          if (nd.x !== -mgState.dir.x) mgState.nextDir = nd;
        } else {
          var nd2 = dy > 0 ? {x: 0, y: 1} : {x: 0, y: -1};
          if (nd2.y !== -mgState.dir.y) mgState.nextDir = nd2;
        }
      },
      update: function (dt) {
        if (mgState.phase !== 'play') return;
        mgState.tick += dt;
        if (mgState.tick < mgState.tickRate) return;
        mgState.tick = 0;
        mgState.dir = mgState.nextDir;
        var head = mgState.snake[0];
        var nh = { x: head.x + mgState.dir.x, y: head.y + mgState.dir.y };
        // Wall collision
        if (nh.x < 0 || nh.y < 0 || nh.x >= mgState.grid || nh.y >= mgState.grid) {
          mgState.phase = 'lose';
          setMGStatus('壁にぶつかった');
          setMGAction('終了', 'red');
          if (audioInitialized) GameEngine.playSound('hit');
          return;
        }
        // Self collision
        for (var i = 0; i < mgState.snake.length; i++) {
          if (mgState.snake[i].x === nh.x && mgState.snake[i].y === nh.y) {
            mgState.phase = 'lose';
            setMGStatus('自爆');
            setMGAction('終了', 'red');
            return;
          }
        }
        mgState.snake.unshift(nh);
        // Food
        if (nh.x === mgState.food.x && nh.y === mgState.food.y) {
          mgState.eaten++;
          if (audioInitialized) GameEngine.playSound('clock_tick');
          // Respawn food
          while (true) {
            var fx = Math.floor(Math.random() * mgState.grid);
            var fy = Math.floor(Math.random() * mgState.grid);
            var clash = mgState.snake.some(function (s) { return s.x === fx && s.y === fy; });
            if (!clash) { mgState.food = { x: fx, y: fy }; break; }
          }
          mgState.tickRate = Math.max(0.08, mgState.tickRate * 0.9);
          if (mgState.eaten >= mgState.goal) {
            mgState.phase = 'win';
            setMGStatus('クリア! 報酬獲得');
            setMGAction('終了', 'green');
            var rewards = ['flare', 'almond_water', 'energy_bar'];
            var rwd = rewards[Math.floor(Math.random() * rewards.length)];
            player.inventory[rwd] = (player.inventory[rwd] || 0) + 1;
            toast(ITEMS[rwd].name + ' を入手');
            unlockAchievement('won_minigame');
            if (audioInitialized) GameEngine.playSound('item_get');
          }
        } else {
          mgState.snake.pop();
        }
        setMGStatus(mgState.eaten + ' / ' + mgState.goal);
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#0a0805';
        ctx.fillRect(0, 0, w, h);
        var cs = Math.min(w, h) / mgState.grid;
        var ox = (w - cs * mgState.grid) / 2;
        var oy = (h - cs * mgState.grid) / 2;
        // Grid lines
        ctx.strokeStyle = '#382a08';
        ctx.lineWidth = 1;
        for (var gi = 0; gi <= mgState.grid; gi++) {
          ctx.beginPath();
          ctx.moveTo(ox + gi * cs, oy);
          ctx.lineTo(ox + gi * cs, oy + mgState.grid * cs);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ox, oy + gi * cs);
          ctx.lineTo(ox + mgState.grid * cs, oy + gi * cs);
          ctx.stroke();
        }
        // Snake
        for (var si = 0; si < mgState.snake.length; si++) {
          var s = mgState.snake[si];
          var bright = si === 0 ? '#d4b340' : '#88a040';
          ctx.fillStyle = bright;
          ctx.fillRect(ox + s.x * cs + 1, oy + s.y * cs + 1, cs - 2, cs - 2);
        }
        // Food
        ctx.fillStyle = '#c84050';
        ctx.beginPath();
        ctx.arc(ox + mgState.food.x * cs + cs / 2, oy + mgState.food.y * cs + cs / 2, cs * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    // ── CIPHER DECODER ──
    cipher: {
      title: '暗号解読',
      subtitle: 'シーザー暗号を解読 (シフト = 数字キーから推測)',
      words: ['BACKROOMS', 'NOCLIP', 'ALMOND', 'OPERATOR', 'HOUND', 'PARTYGOER', 'WRETCH', 'CRAWLER', 'SMILER', 'HOTEL'],
      init: function () {
        var pool = MINI_GAMES.cipher.words;
        var word = pool[Math.floor(Math.random() * pool.length)];
        var shift = 3 + Math.floor(Math.random() * 5); // 3-7
        var encoded = '';
        for (var i = 0; i < word.length; i++) {
          var c = word.charCodeAt(i) - 65;
          encoded += String.fromCharCode(((c + shift) % 26) + 65);
        }
        mgState = {
          phase: 'play',
          original: word,
          encoded: encoded,
          shift: shift,
          guessIdx: 0,
          guessed: '',
          alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          timeLeft: 30,
          letterButtons: []
        };
        setMGAction('閉じる', 'gray');
        setMGStatus('暗号: ' + encoded + ' (シフト=' + shift + ')');
      },
      action: function () { closeMiniGame(); },
      onTap: function (cx, cy, w, h) {
        if (mgState.phase !== 'play') return;
        // Detect tap on letter buttons
        for (var i = 0; i < mgState.letterButtons.length; i++) {
          var b = mgState.letterButtons[i];
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
            mgState.guessed += b.letter;
            mgState.guessIdx++;
            if (audioInitialized) GameEngine.playSound('clock_tick');
            if (mgState.guessIdx >= mgState.original.length) {
              if (mgState.guessed === mgState.original) {
                mgState.phase = 'win';
                setMGStatus('正解! 解読成功!');
                setMGAction('終了', 'green');
                var rewards = ['almond_milk', 'voucher', 'flare'];
                var rwd = rewards[Math.floor(Math.random() * rewards.length)];
                player.inventory[rwd] = (player.inventory[rwd] || 0) + 1;
                toast(ITEMS[rwd].name + ' を入手');
                unlockAchievement('won_minigame');
                if (audioInitialized) GameEngine.playSound('item_get');
              } else {
                mgState.phase = 'lose';
                setMGStatus('不正解。正解: ' + mgState.original);
                setMGAction('終了', 'red');
              }
            } else {
              setMGStatus('入力: ' + mgState.guessed + '_');
            }
            break;
          }
        }
      },
      update: function (dt) {
        if (mgState.phase !== 'play') return;
        mgState.timeLeft -= dt;
        if (mgState.timeLeft <= 0) {
          mgState.phase = 'lose';
          setMGStatus('時間切れ! 正解: ' + mgState.original);
          setMGAction('終了', 'red');
        }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#0d0c08';
        ctx.fillRect(0, 0, w, h);
        // Encoded word at top
        ctx.font = 'bold 22px monospace';
        ctx.fillStyle = '#d4b340';
        ctx.textAlign = 'center';
        ctx.fillText(mgState.encoded, w / 2, 40);
        // Shift hint
        ctx.font = '12px monospace';
        ctx.fillStyle = '#b09040';
        ctx.fillText('SHIFT = ' + mgState.shift, w / 2, 60);
        // Guess display
        ctx.font = 'bold 18px monospace';
        ctx.fillStyle = '#88c050';
        ctx.fillText(mgState.guessed + (mgState.phase === 'play' ? '_' : ''), w / 2, 88);
        // Timer
        ctx.font = '10px monospace';
        ctx.fillStyle = mgState.timeLeft < 10 ? '#c63a3a' : '#786020';
        ctx.fillText('TIME ' + Math.ceil(mgState.timeLeft) + 's', w / 2, 106);
        // Letter buttons (A-Z grid)
        var cols = 6;
        var rows = 5;  // 26 letters / 6 = 4.33 → 5 rows (last row partial)
        var gridY = 120;
        var btnW = (w - 30) / cols;
        var btnH = (h - gridY - 16) / rows;
        mgState.letterButtons = [];
        for (var li = 0; li < 26; li++) {
          var letter = mgState.alphabet[li];
          var r = Math.floor(li / cols);
          var c = li % cols;
          var bx = 15 + c * btnW;
          var by = gridY + r * btnH;
          mgState.letterButtons.push({ letter: letter, x: bx + 2, y: by + 2, w: btnW - 4, h: btnH - 4 });
          ctx.fillStyle = '#1a1408';
          ctx.fillRect(bx + 2, by + 2, btnW - 4, btnH - 4);
          ctx.strokeStyle = '#382a08';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx + 2, by + 2, btnW - 4, btnH - 4);
          ctx.font = 'bold 14px monospace';
          ctx.fillStyle = '#d4b340';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(letter, bx + btnW / 2, by + btnH / 2);
        }
      }
    },

    // ── PONG ──
    pong: {
      title: 'PONG (古いアーケード)',
      subtitle: 'AI を 3 点先取で勝利 / SAN +50 報酬',
      init: function () {
        mgState = {
          phase: 'play',
          ballX: 0.5,
          ballY: 0.5,
          ballVX: (Math.random() < 0.5 ? -1 : 1) * 0.35,
          ballVY: (Math.random() - 0.5) * 0.4,
          playerY: 0.5,
          aiY: 0.5,
          playerScore: 0,
          aiScore: 0,
          paddleH: 0.18,
          paddleW: 0.025,
          touch: 0.5  // last touch y
        };
        setMGAction('閉じる', 'gray');
        setMGStatus('0 - 0');
      },
      action: function () {
        closeMiniGame();
      },
      onTap: function (cx, cy, w, h) {
        if (mgState.phase !== 'play') return;
        mgState.touch = cy / h;
      },
      onDrag: function (cx, cy, w, h) {
        if (mgState.phase !== 'play') return;
        mgState.touch = cy / h;
      },
      update: function (dt) {
        if (mgState.phase !== 'play') return;
        // Move player paddle toward touch
        var diff = mgState.touch - mgState.playerY;
        mgState.playerY += Math.sign(diff) * Math.min(Math.abs(diff), 1.5 * dt);
        mgState.playerY = clamp(mgState.playerY, mgState.paddleH / 2, 1 - mgState.paddleH / 2);
        // AI movement (slight lag)
        var aiDiff = mgState.ballY - mgState.aiY;
        mgState.aiY += Math.sign(aiDiff) * Math.min(Math.abs(aiDiff), 0.75 * dt);
        mgState.aiY = clamp(mgState.aiY, mgState.paddleH / 2, 1 - mgState.paddleH / 2);

        // Ball movement
        mgState.ballX += mgState.ballVX * dt;
        mgState.ballY += mgState.ballVY * dt;
        // Top/bottom bounce
        if (mgState.ballY <= 0.02 || mgState.ballY >= 0.98) {
          mgState.ballVY *= -1;
          mgState.ballY = clamp(mgState.ballY, 0.02, 0.98);
          if (audioInitialized) GameEngine.playSound('clock_tick');
        }
        // Player paddle (left) bounce
        if (mgState.ballX <= 0.07 && mgState.ballVX < 0) {
          if (Math.abs(mgState.ballY - mgState.playerY) < mgState.paddleH / 2 + 0.02) {
            mgState.ballVX = -mgState.ballVX * 1.05;
            mgState.ballVY += (mgState.ballY - mgState.playerY) * 0.8;
            if (audioInitialized) GameEngine.playSound('clock_tick');
          }
        }
        // AI paddle (right) bounce
        if (mgState.ballX >= 0.93 && mgState.ballVX > 0) {
          if (Math.abs(mgState.ballY - mgState.aiY) < mgState.paddleH / 2 + 0.02) {
            mgState.ballVX = -mgState.ballVX * 1.05;
            mgState.ballVY += (mgState.ballY - mgState.aiY) * 0.8;
            if (audioInitialized) GameEngine.playSound('clock_tick');
          }
        }
        // Score
        if (mgState.ballX < 0) {
          mgState.aiScore++;
          mgState.ballX = 0.5; mgState.ballY = 0.5;
          mgState.ballVX = 0.4; mgState.ballVY = (Math.random() - 0.5) * 0.4;
        }
        if (mgState.ballX > 1) {
          mgState.playerScore++;
          mgState.ballX = 0.5; mgState.ballY = 0.5;
          mgState.ballVX = -0.4; mgState.ballVY = (Math.random() - 0.5) * 0.4;
        }
        setMGStatus(mgState.playerScore + ' - ' + mgState.aiScore);
        if (mgState.playerScore >= 3) {
          mgState.phase = 'win';
          setMGStatus('勝利! SAN +50');
          setMGAction('終了', 'green');
          player.san = Math.min(player.sanMax, player.san + 50);
          unlockAchievement('won_minigame');
        } else if (mgState.aiScore >= 3) {
          mgState.phase = 'lose';
          setMGStatus('敗北');
          setMGAction('終了', 'red');
        }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#0a0805';
        ctx.fillRect(0, 0, w, h);
        // Center line
        ctx.strokeStyle = '#382a08';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 4);
        ctx.lineTo(w / 2, h - 4);
        ctx.stroke();
        ctx.setLineDash([]);
        // Score
        ctx.font = 'bold 28px monospace';
        ctx.fillStyle = '#382a08';
        ctx.textAlign = 'center';
        ctx.fillText(mgState.playerScore + ' ' + mgState.aiScore, w / 2, 30);
        // Paddles
        var pH = mgState.paddleH * h;
        var pW = mgState.paddleW * w;
        ctx.fillStyle = '#d4b340';
        ctx.fillRect(0.02 * w, mgState.playerY * h - pH / 2, pW, pH);
        ctx.fillRect(w - 0.02 * w - pW, mgState.aiY * h - pH / 2, pW, pH);
        // Ball
        ctx.beginPath();
        ctx.arc(mgState.ballX * w, mgState.ballY * h, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  function setMGStatus(msg) { el('minigameStatus').textContent = msg; }
  function setMGAction(label, type) {
    var b = el('minigameActionBtn');
    b.textContent = label;
    b.classList.remove('primary');
    if (type === 'green') b.classList.add('primary');
  }

  function openMiniGame(id) {
    var def = MINI_GAMES[id];
    if (!def) return;
    miniGameOpen = true;
    currentMiniGame = id;
    el('minigameTitle').textContent = def.title;
    el('minigameSubtitle').textContent = def.subtitle;
    showOverlay('minigameOverlay');
    def.init();
  }

  function closeMiniGame() {
    miniGameOpen = false;
    currentMiniGame = null;
    mgState = null;
    hideOverlay('minigameOverlay');
  }

  function updateMiniGame(dt) {
    if (!miniGameOpen || !currentMiniGame) return;
    var def = MINI_GAMES[currentMiniGame];
    if (def.update) def.update(dt);
    drawMiniGame();
  }

  function drawMiniGame() {
    var canvas = el('minigameCanvas');
    var def = MINI_GAMES[currentMiniGame];
    if (!def || !def.draw) return;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    var ctx = canvas.getContext('2d');
    def.draw(ctx, canvas.width, canvas.height);
  }

  function miniGameTap(e) {
    if (!miniGameOpen || !currentMiniGame) return;
    var canvas = el('minigameCanvas');
    var rect = canvas.getBoundingClientRect();
    var def = MINI_GAMES[currentMiniGame];
    var touch = (e.changedTouches && e.changedTouches[0]) || e;
    var cx = (touch.clientX - rect.left) * (canvas.width / rect.width);
    var cy = (touch.clientY - rect.top) * (canvas.height / rect.height);
    if (def.onTap) def.onTap(cx, cy, canvas.width, canvas.height);
  }
  function miniGameDrag(e) {
    if (!miniGameOpen || !currentMiniGame) return;
    var canvas = el('minigameCanvas');
    var rect = canvas.getBoundingClientRect();
    var def = MINI_GAMES[currentMiniGame];
    var touch = (e.changedTouches && e.changedTouches[0]) || e;
    var cx = (touch.clientX - rect.left) * (canvas.width / rect.width);
    var cy = (touch.clientY - rect.top) * (canvas.height / rect.height);
    if (def.onDrag) def.onDrag(cx, cy, canvas.width, canvas.height);
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

    // Safe zone with mini-game
    if (t === 11) {
      var mgId = LEVEL_MINIGAMES[currentLevel];
      if (mgId) {
        var safeKey = currentLevel + '_' + gridKey(gx, gy);
        if (mgPlayedAt[safeKey]) {
          toast('このセーフエリアは利用済み');
        } else {
          mgPlayedAt[safeKey] = true;
          openMiniGame(mgId);
        }
        return;
      }
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
    stats.totalItemsCollected++;
    saveStats();
    // Track all-time collected items
    try {
      var allKey = 'thebackrooms_items_collected_v1';
      var allColl = JSON.parse(localStorage.getItem(allKey) || '{}');
      allColl[itemId] = true;
      localStorage.setItem(allKey, JSON.stringify(allColl));
      if (Object.keys(allColl).length >= Object.keys(ITEMS).length) {
        unlockAchievement('collect_all_items');
      }
    } catch (e) {}
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
      stats.totalNotesRead++;
      saveStats();
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
    // Endless mode: pick random next, increment score
    if (gameMode === 'endless') {
      endlessFloor++;
      endlessScore += 100 + (discoveredNotes.length * 10) +
                       Object.keys(player.inventory).reduce(function (sum, k) { return sum + player.inventory[k] * 5; }, 0);
      saveEndlessBest();
      if (endlessFloor >= 5) unlockAchievement('endless_5_floors');
      if (endlessScore >= 500) unlockAchievement('endless_score_500');
      toast('ENDLESS Floor ' + endlessFloor + ' / Score ' + endlessScore);
      var nLv = pickNextEndlessLevel();
      var flash = el('noclipFlash');
      flash.style.display = 'block';
      flash.classList.remove('show');
      requestAnimationFrame(function () { flash.classList.add('show'); });
      setTimeout(function () {
        flash.classList.remove('show');
        flash.style.display = 'none';
        setLevel(nLv);
      }, 600);
      return;
    }

    var nextLevel = getNextLevel(currentLevel);
    // Record best time
    if (!bestTimes[currentLevel] || inLevelTime < bestTimes[currentLevel]) {
      bestTimes[currentLevel] = inLevelTime;
      try { localStorage.setItem(BEST_KEY, JSON.stringify(bestTimes)); } catch (e) {}
      toast('Best time! ' + formatTime(inLevelTime));
    }
    if (nextLevel === null) {
      triggerEnding('truend');
      return;
    }
    clearedLevels[currentLevel] = true;
    unlockAchievement('first_no_clip');
    stats.totalNoClips++;
    saveStats();
    var clearedCount = 0;
    for (var ck in clearedLevels) if (clearedLevels[ck]) clearedCount++;
    if (clearedCount >= 5) unlockAchievement('five_clears');
    if (clearedCount >= 12) unlockAchievement('all_clears');
    // No damage check
    if (player.hp >= player.hpMax * 0.95) unlockAchievement('no_damage_lv');
    if (player.san < player.sanMax * 0.1) unlockAchievement('san_zero_survive');
    if (Object.keys(player.inventory).length >= 6) unlockAchievement('inventory_full');
    if (discoveredNotes.length >= 10) unlockAchievement('collect_10_notes');
    // Speed demon: Level 7 cleared under 60s
    if (currentLevel === 7 && inLevelTime < 60) unlockAchievement('speed_demon');
    // Silent run: no items used (count tracked elsewhere — proxy: inventory only)
    if (!player._itemsUsedThisLevel) unlockAchievement('silent_run');
    player._itemsUsedThisLevel = 0;
    // Survive HARUKI: clear Lv5
    if (currentLevel === 5) unlockAchievement('survive_haruki');
    // CHAOS achievement: only unlock when actually clearing a level on CHAOS
    if (currentDifficulty === 'chaos') unlockAchievement('play_chaos');
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
    // Normal progression: 0→1→2→3→4→5→6→7→8→!→Fun→9→END
    var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 9];
    var idx = order.indexOf(cur);
    if (idx < 0 || idx === order.length - 1) return null;
    return order[idx + 1];
  }

  // ============================================================
  //  ENTITY AI
  // ============================================================
  // Hoisted: avoid per-frame allocation
  var ENTITY_SOUND_MAP = {
    hound: { sound: 'breath', prob: 0.008 },
    smiler: { sound: 'lullaby', prob: 0.003 },
    skinstealer: { sound: 'static', prob: 0.004 },
    partygoer: { sound: 'phone', prob: 0.003 },
    crawler: { sound: 'knock', prob: 0.006 },
    wretch: { sound: 'whisper', prob: 0.005 },
    boss: { sound: 'stinger', prob: 0.002 },
    mrhotel: { sound: 'clock_tick', prob: 0.012 },
    haruki: { sound: 'phone', prob: 0.005 }
  };

  function updateEntities(dt) {
    if (state !== ST.PLAYING) return;
    if (phoneOpen) return;
    if (miniGameOpen) return;
    var diffE = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    var sMul = diffE.enemySpeedMul;

    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.alive) continue;
      e.stateTimer += dt;

      // First-encounter intro
      if (!entitySeenTypes[e.type] && ENTITY_INTROS[e.type]) {
        var fcDx = e.x - player.x, fcDy = e.y - player.y;
        var fcD = Math.sqrt(fcDx * fcDx + fcDy * fcDy);
        if (fcD < 10 * TS) {
          entitySeenTypes[e.type] = true;
          saveStats();
          var intro = ENTITY_INTROS[e.type];
          showAchievementToast({ name: '◉ ' + intro.name + ' 出現', icon: '👁' });
          var hudObj = el('objectiveHUD');
          if (hudObj) {
            hudObj.style.display = 'block';
            el('objectiveText').textContent = '【' + intro.name + '】' + intro.desc.split('\n')[0];
            setTimeout(function () { hudObj.style.display = 'none'; }, 6000);
          }
          if (e.type === 'haruki') unlockAchievement('encounter_haruki');
        }
      }

      // Stun handling
      if (e.stunned) {
        e.stunTimer -= dt;
        if (e.stunTimer <= 0) e.stunned = false;
        else continue; // skip AI while stunned
      }

      var dx = player.x - e.x;
      var dy = player.y - e.y;
      var distP = Math.sqrt(dx * dx + dy * dy);

      // Perf: skip AI when very far (>16 TS) — wretches and bosses always update
      if (distP > 16 * TS && e.type !== 'wretch' && e.type !== 'boss') {
        continue;
      }

      // Entity-specific positional sound
      var sndDef = ENTITY_SOUND_MAP[e.type];
      if (sndDef && distP < 9 * TS && audioInitialized && Math.random() < sndDef.prob) {
        GameEngine.playPositionalSound(sndDef.sound, e.x, e.y);
      }

      // AI by type
      if (e.type === 'hound') {
        // Aggressive chaser. Triggers when player runs near.
        if (distP < 6 * TS && (GameEngine.input.sprint || e.state === 'chase')) {
          e.state = 'chase';
          // Pathfind: simple move toward player
          var spd = 90 * sMul;
          var stepX = (dx / distP) * spd * dt;
          var stepY = (dy / distP) * spd * dt;
          var nx = e.x + stepX;
          if (isWalkable(nx, e.y)) e.x = nx;
          var ny = e.y + stepY;
          if (isWalkable(e.x, ny)) e.y = ny;
        } else if (distP > 10 * TS) {
          e.state = 'wander';
          wanderEntity(e, dt, 35 * sMul);
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
          var spd2 = 25 * sMul;
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
          var spd3 = 70 * sMul;
          var stepX3 = (dx / distP) * spd3 * dt;
          var stepY3 = (dy / distP) * spd3 * dt;
          if (isWalkable(e.x + stepX3, e.y)) e.x += stepX3;
          if (isWalkable(e.x, e.y + stepY3)) e.y += stepY3;
          if (distP < 1 * TS) attackPlayer(20 * dt);
        }
      } else if (e.type === 'partygoer') {
        // Wanders, attacks if too close
        wanderEntity(e, dt, 40 * sMul);
        if (distP < 1.5 * TS) {
          attackPlayer(15 * dt);
        }
      } else if (e.type === 'crawler') {
        // Fast attacker that retreats after hitting
        if (e.state === 'wait') {
          if (e.stateTimer > 1.5) { e.state = 'lunge'; e.stateTimer = 0; }
        } else if (e.state === 'lunge') {
          if (distP < 8 * TS) {
            var crSpd = 140 * sMul;
            var stepX_c = (dx / distP) * crSpd * dt;
            var stepY_c = (dy / distP) * crSpd * dt;
            if (isWalkable(e.x + stepX_c, e.y)) e.x += stepX_c;
            if (isWalkable(e.x, e.y + stepY_c)) e.y += stepY_c;
            if (distP < 1.0 * TS) {
              attackPlayer(22 * dt);
              e.state = 'retreat';
              e.stateTimer = 0;
            }
          } else {
            e.state = 'wait';
            e.stateTimer = 0;
          }
        } else if (e.state === 'retreat') {
          var retSpd = 100 * sMul;
          var rx = -(dx / distP) * retSpd * dt;
          var ry = -(dy / distP) * retSpd * dt;
          if (isWalkable(e.x + rx, e.y)) e.x += rx;
          if (isWalkable(e.x, e.y + ry)) e.y += ry;
          if (e.stateTimer > 2) { e.state = 'wait'; e.stateTimer = 0; }
        } else {
          e.state = 'wait';
        }
      } else if (e.type === 'wretch') {
        // Stationary, leeches SAN when player in FOV
        if (distP < 8 * TS && isFacingPlayer(e)) {
          player.san = Math.max(0, player.san - 12 * dt);
          if (Math.random() < 0.04 && audioInitialized) GameEngine.playSound('whisper');
        }
        // Direct contact damages
        if (distP < 0.8 * TS) attackPlayer(8 * dt);
      } else if (e.type === 'mrhotel') {
        // Stationary at first, slowly approaches when player nearby
        if (distP < 12 * TS) {
          if (distP < 4 * TS) player.san = Math.max(0, player.san - 6 * dt);
          var mhSpd = 30 * sMul;
          var mhx = (dx / distP) * mhSpd * dt;
          var mhy = (dy / distP) * mhSpd * dt;
          if (isWalkable(e.x + mhx, e.y)) e.x += mhx;
          if (isWalkable(e.x, e.y + mhy)) e.y += mhy;
        }
        if (distP < 1.0 * TS) {
          attackPlayer(8 * dt);
          if (Math.random() < 0.002 && audioInitialized) {
            GameEngine.playPositionalSound('whisper', e.x, e.y);
          }
        }
      } else if (e.type === 'haruki') {
        // HARUKI: persistent stalker. Faster when chasing.
        var harSpd = (e.state === 'chase' ? 75 : 45) * sMul;
        if (distP < 9 * TS) {
          e.state = 'chase';
          var hx = (dx / distP) * harSpd * dt;
          var hy = (dy / distP) * harSpd * dt;
          if (isWalkable(e.x + hx, e.y)) e.x += hx;
          if (isWalkable(e.x, e.y + hy)) e.y += hy;
          // Phone ring at edge of perception
          if (distP > 6 * TS && Math.random() < 0.004 && audioInitialized) {
            GameEngine.playPositionalSound('phone', e.x, e.y);
          }
          // SAN drain at close range
          if (distP < 3 * TS) player.san = Math.max(0, player.san - 4 * dt);
        } else {
          e.state = 'wander';
          wanderEntity(e, dt, 35 * sMul);
        }
        if (distP < 1.0 * TS) {
          attackPlayer(18 * dt);
          // Brief jumpscare
          if (Math.random() < 0.05) {
            var simg = GameEngine.images['assets/img/haruki_scary.png'];
            if (simg) GameEngine.flashImage(simg, 200);
            if (audioInitialized) GameEngine.playSound('jumpscare');
          }
        }
      } else if (e.type === 'boss') {
        // Boss: multi-phase, boss HP tracked separately
        e.bossHp = e.bossHp !== undefined ? e.bossHp : 200;
        // Phase determined by HP
        var phase = 1;
        if (e.bossHp < 130) phase = 2;
        if (e.bossHp < 60)  phase = 3;
        var bossSpd = (50 + phase * 25) * sMul;
        wanderEntity(e, dt, bossSpd);
        // Move toward player if in range
        if (distP < 10 * TS) {
          var bsx = (dx / distP) * bossSpd * dt;
          var bsy = (dy / distP) * bossSpd * dt;
          if (isWalkable(e.x + bsx, e.y)) e.x += bsx;
          if (isWalkable(e.x, e.y + bsy)) e.y += bsy;
        }
        if (distP < 1.6 * TS) {
          attackPlayer((8 + phase * 4) * dt);
        }
        // Phase 3: spawn shadow copies (one-time)
        if (phase === 3 && !e._spawnedShadows) {
          e._spawnedShadows = true;
          for (var bsi = 0; bsi < 2; bsi++) {
            entities.push({
              type: 'crawler',
              x: e.x + (Math.random() - 0.5) * 4 * TS,
              y: e.y + (Math.random() - 0.5) * 4 * TS,
              angle: 0, state: 'wait', stateTimer: 0,
              alive: true, hp: 100, color: '#1a0a0a', bodyColor: '#000'
            });
          }
          toast('影が分離した!');
          if (audioInitialized) GameEngine.playSound('stinger');
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
  //  ENTITY RENDERER (type-aware, uses engine z-buffer)
  // ============================================================
  function drawTypedEntity(ctx, e) {
    var w = GameEngine.width;
    var h = GameEngine.height;
    var dx = e.x - player.x;
    var dy = e.y - player.y;
    var cosA = Math.cos(-player.angle);
    var sinA = Math.sin(-player.angle);
    var tX = dx * cosA - dy * sinA;
    var tY = dx * sinA + dy * cosA;
    if (tY <= 0.1) return;
    var depthTiles = tY / TS;
    var maxDist = 22;
    if (depthTiles > maxDist) return;

    var screenX = (w / 2) * (1 + tX / tY);
    var spriteH = Math.abs(h / depthTiles) * 0.8;
    var spriteW = spriteH;
    var startY = (h - spriteH) / 2;
    var startX = screenX - spriteW / 2;

    var fogFactor = Math.max(0.15, 1 - depthTiles / maxDist);
    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;

    ctx.save();
    ctx.globalAlpha = fogFactor;

    // Per-type shape drawing
    if (e.type === 'hound') {
      // Low quadruped: dark mass at bottom 50% of sprite, with eyes
      var bodyY = startY + spriteH * 0.5;
      var bodyH = spriteH * 0.45;
      drawShapedSprite(ctx, startX, bodyY, spriteW, bodyH, screenX, depthTiles, zBuf, w,
        '#2a1810', '#150c08');
      // Eyes (red dots)
      var eyeY = startY + spriteH * 0.45;
      var eyeSize = Math.max(2, spriteH * 0.03);
      ctx.fillStyle = 'rgba(255,40,40,' + fogFactor + ')';
      drawSpriteDot(ctx, screenX - spriteW * 0.12, eyeY, eyeSize, zBuf, w, depthTiles);
      drawSpriteDot(ctx, screenX + spriteW * 0.12, eyeY, eyeSize, zBuf, w, depthTiles);
    } else if (e.type === 'smiler') {
      // Floating smile in darkness — only teeth visible
      var smileY = startY + spriteH * 0.45;
      var smileW = spriteW * 0.4;
      var smileH = spriteH * 0.08;
      var sStartX = screenX - smileW / 2;
      // Glow
      var gradRad = spriteW * 0.4;
      var grad = ctx.createRadialGradient(screenX, smileY, 0, screenX, smileY, gradRad);
      grad.addColorStop(0, 'rgba(220,220,220,' + (0.3 * fogFactor) + ')');
      grad.addColorStop(1, 'rgba(220,220,220,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(screenX - gradRad, smileY - gradRad, gradRad * 2, gradRad * 2);
      // Teeth (white blocks)
      ctx.fillStyle = 'rgba(245,245,235,' + fogFactor + ')';
      var teethCount = 8;
      var teethW = smileW / teethCount;
      for (var ti = 0; ti < teethCount; ti++) {
        var tx = sStartX + ti * teethW + 1;
        var col = Math.round(tx);
        if (col < 0 || col >= w) continue;
        if (zBuf[col] > depthTiles) {
          ctx.fillRect(tx, smileY, teethW - 1, smileH);
        }
      }
      // Eyes (small yellow pinpricks)
      ctx.fillStyle = 'rgba(255,255,180,' + fogFactor + ')';
      var sEyeY = startY + spriteH * 0.32;
      drawSpriteDot(ctx, screenX - spriteW * 0.08, sEyeY, Math.max(1, spriteH * 0.012), zBuf, w, depthTiles);
      drawSpriteDot(ctx, screenX + spriteW * 0.08, sEyeY, Math.max(1, spriteH * 0.012), zBuf, w, depthTiles);
    } else if (e.type === 'skinstealer') {
      if (e.state === 'corpse') {
        // Pile on ground — short and wide
        var pH = spriteH * 0.18;
        var pY = startY + spriteH * 0.78;
        drawShapedSprite(ctx, startX, pY, spriteW, pH, screenX, depthTiles, zBuf, w,
          '#3a2820', '#1a1208');
      } else {
        // Tall thin humanoid with skin texture
        var ssH = spriteH * 0.92;
        var ssY = startY + spriteH * 0.04;
        var ssW = spriteW * 0.4;
        var ssX = screenX - ssW / 2;
        drawShapedSprite(ctx, ssX, ssY, ssW, ssH, screenX, depthTiles, zBuf, w,
          '#a08070', '#604838');
        // Mask (white face)
        ctx.fillStyle = 'rgba(240,230,210,' + fogFactor + ')';
        var faceY = ssY + ssH * 0.05;
        var faceH = ssH * 0.18;
        var faceW = ssW * 0.7;
        var faceX = screenX - faceW / 2;
        for (var fc = Math.floor(faceX); fc < faceX + faceW; fc++) {
          if (fc < 0 || fc >= w) continue;
          if (zBuf[fc] > depthTiles) ctx.fillRect(fc, faceY, 1, faceH);
        }
        // Empty eye sockets
        ctx.fillStyle = 'rgba(0,0,0,' + fogFactor + ')';
        drawSpriteDot(ctx, screenX - ssW * 0.12, faceY + faceH * 0.4, Math.max(1, ssH * 0.02), zBuf, w, depthTiles);
        drawSpriteDot(ctx, screenX + ssW * 0.12, faceY + faceH * 0.4, Math.max(1, ssH * 0.02), zBuf, w, depthTiles);
      }
    } else if (e.type === 'partygoer') {
      // Humanoid with cone party hat
      var pgH = spriteH * 0.85;
      var pgY = startY + spriteH * 0.15;
      var pgW = spriteW * 0.45;
      var pgX = screenX - pgW / 2;
      drawShapedSprite(ctx, pgX, pgY, pgW, pgH, screenX, depthTiles, zBuf, w,
        '#603040', '#301820');
      // Party hat cone (triangle on top)
      var hatColor = 'rgba(255,180,80,' + fogFactor + ')';
      ctx.fillStyle = hatColor;
      var hatBase = pgY;
      var hatTop = pgY - spriteH * 0.18;
      var hatW = pgW * 0.7;
      for (var hc = Math.floor(screenX - hatW / 2); hc < screenX + hatW / 2; hc++) {
        if (hc < 0 || hc >= w) continue;
        if (zBuf[hc] > depthTiles) {
          var hcNorm = Math.abs(hc - screenX) / (hatW / 2);
          var hcTop = hatBase - (1 - hcNorm) * (hatBase - hatTop);
          ctx.fillRect(hc, hcTop, 1, hatBase - hcTop);
        }
      }
      // Big creepy smile
      ctx.fillStyle = 'rgba(180,40,40,' + fogFactor + ')';
      var pgFaceY = pgY + pgH * 0.18;
      var pgSmileW = pgW * 0.5;
      ctx.fillRect(screenX - pgSmileW / 2, pgFaceY, pgSmileW, Math.max(1, pgH * 0.04));
    } else if (e.type === 'crawler') {
      // Low and wide insect-like creature
      var crH = spriteH * 0.3;
      var crY = startY + spriteH * 0.7;
      var crW = spriteW * 0.8;
      var crX = screenX - crW / 2;
      drawShapedSprite(ctx, crX, crY, crW, crH, screenX, depthTiles, zBuf, w,
        '#3a1a0a', '#150805');
      // Multiple eye dots
      ctx.fillStyle = 'rgba(255,200,40,' + fogFactor + ')';
      for (var ce = 0; ce < 4; ce++) {
        var cdx = (ce - 1.5) * spriteW * 0.08;
        drawSpriteDot(ctx, screenX + cdx, crY + crH * 0.3, Math.max(1, spriteH * 0.015), zBuf, w, depthTiles);
      }
      // Legs (lines extending)
      ctx.strokeStyle = 'rgba(50,30,15,' + fogFactor + ')';
      ctx.lineWidth = Math.max(1, spriteH * 0.012);
      for (var lg = -3; lg <= 3; lg++) {
        var lgX = screenX + lg * spriteW * 0.07;
        var lgCol = Math.round(lgX);
        if (lgCol < 0 || lgCol >= w) continue;
        if (zBuf[lgCol] > depthTiles) {
          ctx.beginPath();
          ctx.moveTo(lgX, crY + crH * 0.5);
          ctx.lineTo(lgX + lg * spriteW * 0.02, crY + crH);
          ctx.stroke();
        }
      }
    } else if (e.type === 'wretch') {
      // Tall stationary husk with hollow chest
      var wrH = spriteH * 0.9;
      var wrY = startY + spriteH * 0.08;
      var wrW = spriteW * 0.5;
      var wrX = screenX - wrW / 2;
      drawShapedSprite(ctx, wrX, wrY, wrW, wrH, screenX, depthTiles, zBuf, w,
        '#1a1a14', '#080805');
      // Hollow chest cavity (pulsing)
      var pulse = 0.5 + Math.sin(performance.now() * 0.004) * 0.5;
      var chestY = wrY + wrH * 0.35;
      var chestSize = spriteW * 0.15;
      ctx.fillStyle = 'rgba(' + (100 + 80 * pulse) + ',30,30,' + fogFactor + ')';
      var chestCol = Math.round(screenX);
      if (chestCol >= 0 && chestCol < w && zBuf[chestCol] > depthTiles) {
        ctx.beginPath();
        ctx.ellipse(screenX, chestY, chestSize, chestSize * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.type === 'haruki') {
      // HARUKI sprite — uses haruki.png head, dark body
      var hkSpriteH = spriteH * 1.0;
      var hkSpriteY = startY;
      var hkBodyW = spriteW * 0.45;
      var hkBodyX = screenX - hkBodyW / 2;
      // Dark body
      drawShapedSprite(ctx, hkBodyX, hkSpriteY + hkSpriteH * 0.35, hkBodyW, hkSpriteH * 0.65,
        screenX, depthTiles, zBuf, w, '#1a0808', '#080000');
      // Head: use haruki.png or haruki_scary.png when close
      var useImg = depthTiles < 3
        ? (GameEngine.images['assets/img/haruki_scary.png'] || GameEngine.images['assets/img/haruki.png'])
        : GameEngine.images['assets/img/haruki.png'];
      if (useImg) {
        var headW = spriteW * 0.55;
        var headH = hkSpriteH * 0.45;
        var headX = screenX - headW / 2;
        var headY = hkSpriteY;
        var startCol = Math.max(0, Math.floor(headX));
        var endCol = Math.min(w, Math.ceil(headX + headW));
        for (var col = startCol; col < endCol; col++) {
          if (zBuf[col] > depthTiles) {
            var srcX = ((col - headX) / headW) * useImg.width;
            ctx.drawImage(useImg, srcX, 0, 1, useImg.height, col, headY, 1, headH);
          }
        }
      } else {
        // Fallback: red blob head
        drawShapedSprite(ctx, screenX - spriteW * 0.2, hkSpriteY, spriteW * 0.4, hkSpriteH * 0.4,
          screenX, depthTiles, zBuf, w, '#883030', '#330000');
      }
      // Red glow aura (like original haruki)
      if (depthTiles > 1.5) {
        ctx.globalAlpha = Math.min(0.4, fogFactor * 0.5);
        var auraR = hkSpriteH * 0.5;
        var grad = ctx.createRadialGradient(screenX, hkSpriteY + hkSpriteH * 0.5, 0,
                                              screenX, hkSpriteY + hkSpriteH * 0.5, auraR);
        grad.addColorStop(0, 'rgba(200,30,30,0.5)');
        grad.addColorStop(1, 'rgba(200,30,30,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(screenX - auraR, hkSpriteY + hkSpriteH * 0.5 - auraR, auraR * 2, auraR * 2);
        ctx.globalAlpha = fogFactor;
      }
    } else if (e.type === 'mrhotel') {
      // Tall thin man in suit, blank face
      var mhBH = spriteH * 0.95;
      var mhBY = startY + spriteH * 0.05;
      var mhBW = spriteW * 0.32;
      var mhBX = screenX - mhBW / 2;
      drawShapedSprite(ctx, mhBX, mhBY, mhBW, mhBH, screenX, depthTiles, zBuf, w,
        '#252025', '#0a0a10');
      // Top hat
      ctx.fillStyle = 'rgba(20,20,20,' + fogFactor + ')';
      var hatY = mhBY - spriteH * 0.15;
      var hatH = spriteH * 0.18;
      var hatW = mhBW * 0.9;
      var hatX = screenX - hatW / 2;
      for (var mhc = Math.floor(hatX); mhc < hatX + hatW; mhc++) {
        if (mhc < 0 || mhc >= w) continue;
        if (zBuf[mhc] > depthTiles) ctx.fillRect(mhc, hatY, 1, hatH);
      }
      // Brim
      var brimW = mhBW * 1.6;
      var brimX = screenX - brimW / 2;
      for (var mhbc = Math.floor(brimX); mhbc < brimX + brimW; mhbc++) {
        if (mhbc < 0 || mhbc >= w) continue;
        if (zBuf[mhbc] > depthTiles) ctx.fillRect(mhbc, hatY + hatH - 2, 1, 3);
      }
      // Blank white face
      ctx.fillStyle = 'rgba(230,225,210,' + fogFactor + ')';
      var faceY2 = mhBY;
      var faceH2 = mhBH * 0.15;
      for (var mhfc = Math.floor(mhBX); mhfc < mhBX + mhBW; mhfc++) {
        if (mhfc < 0 || mhfc >= w) continue;
        if (zBuf[mhfc] > depthTiles) ctx.fillRect(mhfc, faceY2, 1, faceH2);
      }
    } else if (e.type === 'boss') {
      // Large humanoid with crown and floating presence
      var bsH = spriteH * 1.1;
      var bsY = startY - spriteH * 0.05;
      var bsW = spriteW * 0.6;
      var bsX = screenX - bsW / 2;
      drawShapedSprite(ctx, bsX, bsY, bsW, bsH, screenX, depthTiles, zBuf, w,
        '#1c0028', '#0a0010');
      // Crown spikes
      ctx.fillStyle = 'rgba(212,179,64,' + fogFactor + ')';
      for (var bks = -2; bks <= 2; bks++) {
        var bkX = screenX + bks * bsW * 0.18;
        var bkCol = Math.round(bkX);
        if (bkCol < 0 || bkCol >= w) continue;
        if (zBuf[bkCol] > depthTiles) {
          ctx.beginPath();
          ctx.moveTo(bkX, bsY - bsH * 0.05);
          ctx.lineTo(bkX - 4, bsY + bsH * 0.05);
          ctx.lineTo(bkX + 4, bsY + bsH * 0.05);
          ctx.closePath();
          ctx.fill();
        }
      }
      // Glowing eyes
      ctx.fillStyle = 'rgba(220,40,40,' + fogFactor + ')';
      drawSpriteDot(ctx, screenX - bsW * 0.18, bsY + bsH * 0.18, Math.max(2, bsH * 0.025), zBuf, w, depthTiles);
      drawSpriteDot(ctx, screenX + bsW * 0.18, bsY + bsH * 0.18, Math.max(2, bsH * 0.025), zBuf, w, depthTiles);
      // Boss HP bar above head
      if (e.bossHp !== undefined) {
        var bhpRatio = Math.max(0, e.bossHp / 200);
        var bhpY = bsY - 18;
        var bhpW = bsW * 1.5;
        var bhpX = screenX - bhpW / 2;
        ctx.fillStyle = 'rgba(0,0,0,' + fogFactor * 0.8 + ')';
        ctx.fillRect(bhpX, bhpY, bhpW, 6);
        ctx.fillStyle = 'rgba(200,40,40,' + fogFactor + ')';
        ctx.fillRect(bhpX, bhpY, bhpW * bhpRatio, 6);
      }
    } else {
      // Default — basic blob
      drawShapedSprite(ctx, startX, startY, spriteW, spriteH, screenX, depthTiles, zBuf, w,
        e.color || '#444', '#222');
    }

    // Stun marker (animated stars above sprite)
    if (e.stunned) {
      var starY = startY - spriteH * 0.1;
      var t = performance.now() * 0.006;
      ctx.fillStyle = 'rgba(255,255,150,' + (fogFactor * 0.85) + ')';
      ctx.font = 'bold ' + Math.max(10, spriteH * 0.15) + 'px sans-serif';
      ctx.textAlign = 'center';
      for (var si = 0; si < 3; si++) {
        var ox = Math.cos(t + si * Math.PI * 2 / 3) * spriteW * 0.15;
        var oy = Math.sin(t + si * Math.PI * 2 / 3) * spriteH * 0.05;
        var col = Math.round(screenX + ox);
        if (col < 0 || col >= w) continue;
        if (zBuf[col] > depthTiles) {
          ctx.fillText('✦', screenX + ox, starY + oy);
        }
      }
    }
    ctx.restore();
  }

  // World-space pickup renderer (replaces faint floor glow with visible floating icon + beam)
  function drawWorldPickup(ctx, wx, wy, phase, color, icon, itemId) {
    var w = GameEngine.width;
    var h = GameEngine.height;
    var dx = wx - player.x;
    var dy = wy - player.y;
    var cosA = Math.cos(-player.angle);
    var sinA = Math.sin(-player.angle);
    var tX = dx * cosA - dy * sinA;
    var tY = dx * sinA + dy * cosA;
    if (tY <= 0.5) return;
    var depthTiles = tY / TS;
    if (depthTiles > 14) return;

    var screenX = (w / 2) * (1 + tX / tY);
    if (screenX < -50 || screenX > w + 50) return;

    var zBuf = GameEngine._zBuffer;
    var col = Math.round(screenX);
    if (zBuf && col >= 0 && col < w && zBuf[col] < depthTiles) return; // occluded

    var fogFactor = Math.max(0.25, 1 - depthTiles / 14);
    var iconSize = Math.max(14, (h / depthTiles) * 0.18);
    var pulse = 0.7 + Math.sin(phase) * 0.3;

    // Floor circle (small, on ground)
    var groundY = h / 2 + (h * 0.5) / depthTiles;
    var ringR = Math.max(4, iconSize * 0.5);
    ctx.save();
    ctx.globalAlpha = fogFactor * 0.85 * pulse;
    var grad = ctx.createRadialGradient(screenX, groundY, 0, screenX, groundY, ringR);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(screenX, groundY, ringR, 0, Math.PI * 2);
    ctx.fill();

    // Vertical beam (attention-grabbing)
    ctx.globalAlpha = fogFactor * 0.4 * pulse;
    var beamW = Math.max(2, iconSize * 0.12);
    var beamH = iconSize * 1.8;
    var beamY = groundY - beamH;
    var beamGrad = ctx.createLinearGradient(screenX, beamY, screenX, groundY);
    beamGrad.addColorStop(0, 'rgba(0,0,0,0)');
    beamGrad.addColorStop(1, color);
    ctx.fillStyle = beamGrad;
    ctx.fillRect(screenX - beamW / 2, beamY, beamW, beamH);

    // Floating icon just above ground (follows floor projection)
    ctx.globalAlpha = fogFactor;
    // Icon hovers slightly above where it sits on floor
    var iconBaseY = groundY - iconSize * 0.4;
    var iconY = iconBaseY + Math.sin(phase * 2) * iconSize * 0.12;
    ctx.font = 'bold ' + iconSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Outline (dark) for legibility
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
      if (ox === 0 && oy === 0) continue;
      ctx.fillText(icon, screenX + ox, iconY + oy);
    }
    // Item-specific icon override
    var displayIcon = icon;
    if (itemId && ITEMS[itemId]) displayIcon = ITEMS[itemId].icon;
    ctx.fillStyle = color;
    ctx.fillText(displayIcon, screenX, iconY);
    ctx.restore();
  }

  function drawNoClipBeam(ctx, wx, wy, phase) {
    var w = GameEngine.width;
    var h = GameEngine.height;
    var dx = wx - player.x;
    var dy = wy - player.y;
    var cosA = Math.cos(-player.angle);
    var sinA = Math.sin(-player.angle);
    var tX = dx * cosA - dy * sinA;
    var tY = dx * sinA + dy * cosA;
    if (tY <= 0.5) return;
    var depthTiles = tY / TS;
    if (depthTiles > 18) return;

    var screenX = (w / 2) * (1 + tX / tY);
    var zBuf = GameEngine._zBuffer;
    var col = Math.round(screenX);
    if (zBuf && col >= 0 && col < w && zBuf[col] < depthTiles) return;

    var fogFactor = Math.max(0.3, 1 - depthTiles / 18);
    var beamWidth = Math.max(6, (h / depthTiles) * 0.12);
    var beamHeight = (h / depthTiles) * 1.5;
    var groundY = h / 2 + (h * 0.5) / depthTiles;
    var beamTopY = Math.max(0, groundY - beamHeight);
    var pulse = 0.7 + Math.sin(phase * 1.5) * 0.3;

    ctx.save();
    // Beam
    ctx.globalAlpha = fogFactor * 0.7 * pulse;
    var beamGrad = ctx.createLinearGradient(screenX, beamTopY, screenX, groundY);
    beamGrad.addColorStop(0, 'rgba(255, 220, 100, 0)');
    beamGrad.addColorStop(0.5, 'rgba(255, 220, 100, 0.6)');
    beamGrad.addColorStop(1, 'rgba(255, 180, 50, 0.9)');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(screenX - beamWidth, beamTopY, beamWidth * 2, beamHeight);
    // Ground glow
    ctx.globalAlpha = fogFactor * 0.85 * pulse;
    var ringR = beamWidth * 2;
    var groundGrad = ctx.createRadialGradient(screenX, groundY, 0, screenX, groundY, ringR);
    groundGrad.addColorStop(0, 'rgba(255, 200, 80, 0.9)');
    groundGrad.addColorStop(1, 'rgba(255, 180, 50, 0)');
    ctx.fillStyle = groundGrad;
    ctx.beginPath();
    ctx.arc(screenX, groundY, ringR, 0, Math.PI * 2);
    ctx.fill();
    // Triangle "▼" pointer above
    ctx.globalAlpha = fogFactor * pulse;
    var triSize = beamWidth * 0.8;
    var triY = beamTopY + triSize;
    ctx.fillStyle = '#fce884';
    ctx.beginPath();
    ctx.moveTo(screenX, triY);
    ctx.lineTo(screenX - triSize, triY - triSize);
    ctx.lineTo(screenX + triSize, triY - triSize);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShapedSprite(ctx, x, y, w, h, centerX, depth, zBuf, sw, mainColor, edgeColor) {
    var startCol = Math.max(0, Math.floor(x));
    var endCol = Math.min(sw, Math.ceil(x + w));
    for (var c = startCol; c < endCol; c++) {
      if (zBuf[c] > depth) {
        var norm = (c - x) / w;
        var edgeBlend = 1 - Math.pow(Math.abs(norm - 0.5) * 2, 2) * 0.5;
        // Linear interp between edge and main
        var color = edgeBlend > 0.6 ? mainColor : edgeColor;
        ctx.fillStyle = color;
        ctx.fillRect(c, y, 1, h);
      }
    }
  }

  function drawSpriteDot(ctx, cx, cy, r, zBuf, sw, depth) {
    var col = Math.round(cx);
    if (col < 0 || col >= sw) return;
    if (zBuf[col] <= depth) return;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function onRender(ctx) {
    if (!currentMap) return;
    if (state === ST.TITLE) return;

    GameEngine.drawMap();

    // Draw entities (type-aware)
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.alive) continue;
      drawTypedEntity(ctx, e);
    }

    // Draw item / note / exit sprites (custom visible)
    var glowPhase = performance.now() * 0.003;
    for (var key in pickupSpots) {
      var parts = key.split('_');
      var gx = parseInt(parts[0], 10);
      var gy = parseInt(parts[1], 10);
      var wx = gx * TS + TS / 2;
      var wy = gy * TS + TS / 2;
      drawWorldPickup(ctx, wx, wy, glowPhase, '#88c050', '📦', pickupSpots[key]);
    }
    for (var nkey in noteSpots) {
      if (readNotes[currentLevel] && readNotes[currentLevel][nkey]) continue;
      var nparts = nkey.split('_');
      var ngx = parseInt(nparts[0], 10);
      var ngy = parseInt(nparts[1], 10);
      var nwx = ngx * TS + TS / 2;
      var nwy = ngy * TS + TS / 2;
      drawWorldPickup(ctx, nwx, nwy, glowPhase + 1, '#5a82c8', '📄', null);
    }
    // No-clip exit (large beam)
    if (currentMap.noclipExits) {
      for (var ei = 0; ei < currentMap.noclipExits.length; ei++) {
        var ex = currentMap.noclipExits[ei];
        var ewx = ex.gx * TS + TS / 2;
        var ewy = ex.gy * TS + TS / 2;
        drawNoClipBeam(ctx, ewx, ewy, glowPhase + 2);
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

    if (here === 3) { showAct = true; label = 'NoClip'; }
    else if (here === 11) {
      var safeKey2 = currentLevel + '_' + key;
      if (LEVEL_MINIGAMES[currentLevel] && !mgPlayedAt[safeKey2]) {
        showAct = true; label = 'PLAY';
      } else {
        showAct = false;
      }
    }
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
      else if (ft === 3) { showAct = true; label = 'NoClip'; }
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
    if (state === ST.PLAYING && !phoneOpen && !miniGameOpen) {
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
    if (miniGameOpen) updateMiniGame(dt);
  }

  // ============================================================
  //  DEATH / ENDING
  // ============================================================
  function die(causeId, sub) {
    state = ST.DEAD;
    stats.totalDeaths++;
    saveStats();
    el('vitalBars').classList.remove('show');
    el('joystickArea').style.display = 'none';
    el('lookArea').style.display = 'none';
    el('touchZoneLeft').style.display = 'none';
    el('touchZoneRight').style.display = 'none';
    el('actionBtn').style.display = 'none';
    el('phoneBtn').style.display = 'none';
    el('floorHUD').style.display = 'none';
    // Build run summary
    var summary = [sub];
    var clears = 0;
    for (var ck in clearedLevels) if (clearedLevels[ck]) clears++;
    summary.push('生存時間: ' + formatTime(playTime));
    summary.push('現在階層: ' + (currentLevelDef ? currentLevelDef.name : 'LV?'));
    summary.push('クリアした階層: ' + clears);
    summary.push('ノート: ' + discoveredNotes.length);
    if (gameMode === 'endless') {
      saveEndlessBest();
      summary.push('ENDLESS Floor: ' + endlessFloor);
      summary.push('Score: ' + endlessScore +
                   (endlessScore === endlessBestScore ? ' (★ NEW BEST!)' : ' (Best: ' + endlessBestScore + ')'));
    }
    var sumEl = el('gameoverSub');
    if (sumEl) {
      sumEl.innerHTML = summary.map(function (s) { return s; }).join('<br>');
    }
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
      // Count total notes available across all levels
      var totalNotes = 0;
      for (var lk in NOTES_POOL) totalNotes += NOTES_POOL[lk].length;
      // Count total achievements
      var totalAch = Object.keys(ACHIEVEMENTS).length;
      var hasAllNotes = discoveredNotes.length >= totalNotes;
      var hasAllAch = Object.keys(unlockedAchievements).length >= totalAch - 1;
      var runSummary =
        '<hr style="border:none;border-top:1px solid #483910;margin:14px 0;">' +
        '<div style="font-size:11px;color:#b09040;letter-spacing:0.15em;line-height:1.8;">' +
        '生存: ' + formatTime(playTime) + '<br>' +
        'ノート: ' + discoveredNotes.length + ' / ' + totalNotes + '<br>' +
        'アチーブ: ' + Object.keys(unlockedAchievements).length + ' / ' + totalAch + '<br>' +
        '難易度: ' + (DIFFICULTIES[currentDifficulty] ? DIFFICULTIES[currentDifficulty].name : 'NORMAL') +
        '</div>';
      if (hasAllNotes && hasAllAch) {
        tag.textContent = '∞∞∞';
        title.textContent = 'TRUE+ END';
        msg.innerHTML = 'すべてのロアを読み、すべての試練を超えた。<br><br>あなたはバックルームを「理解した」最初の存在となった。<br>壁紙の黄色が、ようやく真の色を見せる...<br><br>あなたは、新しい階層になった。' + runSummary;
      } else {
        tag.textContent = 'THE END';
        title.textContent = 'TRUE END';
        msg.innerHTML = 'あなたは全ての階層を踏破した。<br>黒い扉の向こうで、本当の世界が待っている。<br>...かもしれない。' + runSummary;
      }
      unlockAchievement('true_end');
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
      var diffName = DIFFICULTIES[currentDifficulty] ? DIFFICULTIES[currentDifficulty].name : 'NORMAL';
      var bestSec = bestTimes[currentLevel];
      var bestStr = bestSec ? formatTime(bestSec) : '--';
      var lifeStr =
        '<hr style="border:none;border-top:1px solid #382a08;margin:10px 0;">' +
        '<div style="font-size:10px;color:#b09040;letter-spacing:0.2em;margin-bottom:4px;">通算記録</div>' +
        '<div style="font-size:10px;line-height:1.6;color:#d8d2bc;">' +
        '通算ラン: ' + stats.totalRuns + ' 回<br>' +
        '通算 no-clip: ' + stats.totalNoClips + ' 回<br>' +
        '通算デス: ' + stats.totalDeaths + ' 回<br>' +
        'アイテム入手: ' + stats.totalItemsCollected + ' 個<br>' +
        'ノート閲覧: ' + stats.totalNotesRead + ' 件<br>' +
        'ENDLESS Best: ' + endlessBestScore +
        '</div>';
      el('statProgText').innerHTML = 'クリア: ' + clears + ' / 12 階層<br>難易度: ' + diffName + '<br>本階層ベスト: ' + bestStr + lifeStr;
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
          // Mark persistent items + show ON/OFF state for toggle items
          var stateMark = '';
          if (item.id === 'flashlight') stateMark = '<span class="inv-state ' + (player.flashlightOn ? 'on' : 'off') + '">' + (player.flashlightOn ? 'ON' : 'OFF') + '</span>';
          if (item.id === 'radio') stateMark = '<span class="inv-state ' + (player.radioOn ? 'on' : 'off') + '">' + (player.radioOn ? 'ON' : 'OFF') + '</span>';
          slot.innerHTML = '<span style="font-size:28px;">' + item.icon + '</span>' +
            (item.persistent ? '<span class="inv-perm">∞</span>' : (cnt > 1 ? '<span class="inv-count">' + cnt + '</span>' : '')) +
            stateMark +
            '<span class="inv-name">' + item.name.slice(0, 6) + '</span>';
          (function (itemId) {
            slot.addEventListener('click', function () {
              var it = ITEMS[itemId];
              if (!it) return;
              if (confirm(it.name + '\n\n' + it.desc + '\n\n使用しますか?')) {
                it.effect(player);
                if (!it.persistent) {
                  player.inventory[itemId]--;
                  if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
                  player._itemsUsedThisLevel = (player._itemsUsedThisLevel || 0) + 1;
                  if (!player._itemsUsedAllRun) player._itemsUsedAllRun = {};
                  player._itemsUsedAllRun[itemId] = true;
                  if (player._itemsUsedAllRun.flare && player._itemsUsedAllRun.mirror) {
                    unlockAchievement('use_all_weapons');
                  }
                }
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
      // Notes section
      var notesHeader = document.createElement('h3');
      notesHeader.className = 'phone-h3';
      notesHeader.textContent = 'ロアノート (' + discoveredNotes.length + ' 件)';
      notesHeader.style.margin = '0 0 8px';
      list.appendChild(notesHeader);
      if (discoveredNotes.length === 0) {
        var emp = document.createElement('p');
        emp.className = 'notes-empty';
        emp.style.padding = '20px 16px';
        emp.textContent = 'まだ何も記録されていない。';
        list.appendChild(emp);
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
      // Achievements section
      var achHeader = document.createElement('h3');
      achHeader.className = 'phone-h3';
      var achCount = Object.keys(unlockedAchievements).length;
      var totalAch = Object.keys(ACHIEVEMENTS).length;
      achHeader.textContent = 'アチーブメント (' + achCount + ' / ' + totalAch + ')';
      list.appendChild(achHeader);
      // Progress trackers per achievement (for trackable ones)
      var clearsNow = Object.keys(clearedLevels).length;
      var notesNow = discoveredNotes.length;
      var invNow = Object.keys(player.inventory).length;
      var itemsAllTime = (function () {
        try { return Object.keys(JSON.parse(localStorage.getItem('thebackrooms_items_collected_v1') || '{}')).length; }
        catch (e) { return 0; }
      })();
      var totalNotesAvailable = 0;
      for (var lk2 in NOTES_POOL) totalNotesAvailable += NOTES_POOL[lk2].length;
      var trackProgress = {
        five_clears: clearsNow + ' / 5',
        all_clears: clearsNow + ' / 12',
        collect_10_notes: notesNow + ' / 10',
        inventory_full: invNow + ' / 6',
        collect_all_items: itemsAllTime + ' / ' + Object.keys(ITEMS).length,
        endless_5_floors: endlessFloor + ' / 5',
        endless_score_500: endlessScore + ' / 500'
      };

      for (var aid in ACHIEVEMENTS) {
        var ach = ACHIEVEMENTS[aid];
        var unlocked = !!unlockedAchievements[aid];
        var achCard = document.createElement('div');
        achCard.className = 'note-card';
        achCard.style.borderLeftColor = unlocked ? '#d4b340' : '#382a08';
        achCard.style.opacity = unlocked ? '1' : '0.45';
        var status = unlocked ? '✓ 達成済み' : '未達成';
        if (!unlocked && trackProgress[aid]) {
          status = '進捗: ' + trackProgress[aid];
        }
        achCard.innerHTML =
          '<div class="note-card-title">' + ach.icon + ' ' + ach.name + '</div>' +
          '<div class="note-card-preview">' + status + '</div>';
        list.appendChild(achCard);
      }
      // Bestiary section (encountered entities)
      var bestHeader = document.createElement('h3');
      bestHeader.className = 'phone-h3';
      var encSeen = Object.keys(entitySeenTypes).length;
      var encTotal = Object.keys(ENTITY_INTROS).length;
      bestHeader.textContent = '遭遇エンティティ図鑑 (' + encSeen + ' / ' + encTotal + ')';
      list.appendChild(bestHeader);
      for (var eid in ENTITY_INTROS) {
        var ent = ENTITY_INTROS[eid];
        var seen = !!entitySeenTypes[eid];
        var bestCard = document.createElement('div');
        bestCard.className = 'note-card';
        bestCard.style.borderLeftColor = seen ? '#c63a3a' : '#382a08';
        bestCard.style.opacity = seen ? '1' : '0.35';
        var bestDesc = seen ? ent.desc.replace(/\n/g, ' ') : '? ? ? — 未遭遇';
        bestCard.innerHTML =
          '<div class="note-card-title">👁 ' + (seen ? ent.name : '?????') + '</div>' +
          '<div class="note-card-preview">' + bestDesc + '</div>';
        if (seen) {
          (function (entRef) {
            bestCard.addEventListener('click', function () {
              showNoteViewer(entRef.name, entRef.desc);
            });
          })(ent);
        }
        list.appendChild(bestCard);
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

    // Discovered items/notes/safe markers
    for (var ikey in pickupSpots) {
      var iparts = ikey.split('_');
      var igx = parseInt(iparts[0], 10);
      var igy = parseInt(iparts[1], 10);
      if (discoveredMap[currentLevel] && discoveredMap[currentLevel][igy] && discoveredMap[currentLevel][igy][igx]) {
        ctx.fillStyle = '#88c050';
        ctx.beginPath();
        ctx.arc(ox + (igx + 0.5) * ts, oy + (igy + 0.5) * ts, Math.max(1.5, ts * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (var nkey2 in noteSpots) {
      if (readNotes[currentLevel] && readNotes[currentLevel][nkey2]) continue;
      var nparts2 = nkey2.split('_');
      var ngx2 = parseInt(nparts2[0], 10);
      var ngy2 = parseInt(nparts2[1], 10);
      if (discoveredMap[currentLevel] && discoveredMap[currentLevel][ngy2] && discoveredMap[currentLevel][ngy2][ngx2]) {
        ctx.fillStyle = '#5a82c8';
        ctx.fillRect(ox + (ngx2 + 0.25) * ts, oy + (ngy2 + 0.25) * ts, ts * 0.5, ts * 0.5);
      }
    }
    // No-clip exits on map
    if (currentMap.noclipExits) {
      for (var nci = 0; nci < currentMap.noclipExits.length; nci++) {
        var nce = currentMap.noclipExits[nci];
        if (discoveredMap[currentLevel] && discoveredMap[currentLevel][nce.gy] && discoveredMap[currentLevel][nce.gy][nce.gx]) {
          ctx.fillStyle = '#f0dc8a';
          ctx.beginPath();
          ctx.moveTo(ox + (nce.gx + 0.5) * ts, oy + (nce.gy + 0.1) * ts);
          ctx.lineTo(ox + (nce.gx + 0.9) * ts, oy + (nce.gy + 0.9) * ts);
          ctx.lineTo(ox + (nce.gx + 0.1) * ts, oy + (nce.gy + 0.9) * ts);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // Entities on map (only nearby visible)
    for (var ei = 0; ei < entities.length; ei++) {
      var e = entities[ei];
      if (!e.alive) continue;
      var edx = e.x - player.x;
      var edy = e.y - player.y;
      var ed = Math.sqrt(edx * edx + edy * edy);
      if (ed > 7 * TS && !player.radioOn) continue;
      var egx = e.x / TS, egy = e.y / TS;
      ctx.fillStyle = e.stunned ? '#888' : '#c63a3a';
      ctx.beginPath();
      ctx.arc(ox + egx * ts, oy + egy * ts, Math.max(2, ts * 0.3), 0, Math.PI * 2);
      ctx.fill();
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
        v: 2,
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
        unlockedAchievements: unlockedAchievements,
        mgPlayedAt: mgPlayedAt,
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
      unlockedAchievements = data.unlockedAchievements || {};
      mgPlayedAt = data.mgPlayedAt || {};
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
    gameMode = 'normal';
    stats.totalRuns++;
    saveStats();

    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    player.hpMax = Math.round(100 * diff.hpMul);
    player.hp = player.hpMax;
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
    mgPlayedAt = {};
    // Konami starter pack
    if (window._konamiGranted) {
      window._konamiGranted = false;
      player.inventory.almond_water = 3;
      player.inventory.bandage = 2;
      player.inventory.flare = 2;
      player.inventory.flashlight = 1;
      player.inventory.energy_bar = 2;
      toast('★ KONAMI スターターパック付与');
    }
    // Note: unlockedAchievements persists across runs

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
    gameMode = 'normal';
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
    var diff = el('difficultyBtn');
    if (diff) diff.textContent = '難易度: ' + (DIFFICULTIES[currentDifficulty] ? DIFFICULTIES[currentDifficulty].name : 'NORMAL');
    var ac = el('titleAchCounter');
    if (ac) {
      var acCount = Object.keys(unlockedAchievements).length;
      var acTotal = Object.keys(ACHIEVEMENTS).length;
      var extras = [];
      extras.push('🏆 ' + acCount + ' / ' + acTotal);
      if (endlessBestScore > 0) extras.push('∞ ' + endlessBestScore);
      if (stats.totalRuns > 0) extras.push('▶ ' + stats.totalRuns);
      ac.innerHTML = extras.join('<br>');
    }
    var fr = el('freeRoamBtn');
    if (fr) {
      var anyBest = Object.keys(bestTimes).length > 0;
      fr.style.display = anyBest ? '' : 'none';
    }
    var eb = el('endlessBtn');
    if (eb && endlessBestScore > 0) {
      eb.textContent = 'ENDLESS モード (Best ' + endlessBestScore + ')';
    }
  }

  function openLevelSelect() {
    var grid = el('lvlselGrid');
    grid.innerHTML = '';
    var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 9];
    for (var i = 0; i < order.length; i++) {
      var lvId = order[i];
      var def = LEVELS[lvId];
      if (!def) continue;
      var card = document.createElement('div');
      card.className = 'lvlsel-card';
      var canPlay = !!bestTimes[lvId];
      if (canPlay) card.classList.add('cleared');
      else card.classList.add('locked');
      var bestStr = bestTimes[lvId] ? formatTime(bestTimes[lvId]) : '--:--:--';
      card.innerHTML =
        '<div class="lvlsel-num">' + def.name.replace('LEVEL ', '') + '</div>' +
        '<div class="lvlsel-name">' + def.subtitle + '</div>' +
        '<div class="lvlsel-best">' + (canPlay ? 'BEST ' + bestStr : 'ロック') + '</div>';
      if (canPlay) {
        (function (id) {
          card.addEventListener('click', function () {
            hideOverlay('levelSelectOverlay');
            hideOverlay('titleScreen');
            startFreeRoam(id);
          });
        })(lvId);
      }
      grid.appendChild(card);
    }
    showOverlay('levelSelectOverlay');
  }

  function startFreeRoam(levelId) {
    state = ST.LOADING;
    gameMode = 'normal';
    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    player.hpMax = Math.round(100 * diff.hpMul);
    player.hp = player.hpMax;
    player.san = player.sanMax = 100;
    player.stam = player.stamMax = 100;
    player.inventory = {};
    player.flashlightOn = false;
    player.radioOn = false;
    playTime = 0;
    discoveredNotes = [];
    pickedUpItems = {};
    readNotes = {};
    discoveredMap = {};
    mgPlayedAt = {};

    if (!audioInitialized) {
      GameEngine.initAudio();
      audioInitialized = true;
    }
    setLevel(levelId);
  }

  // ============================================================
  //  EVENT BINDINGS
  // ============================================================
  function bindEvents() {
    el('startBtn').addEventListener('click', startNewGame);
    el('continueBtn').addEventListener('click', continueGame);
    el('endlessBtn').addEventListener('click', startEndlessMode);
    el('freeRoamBtn').addEventListener('click', openLevelSelect);
    el('lvlselCloseBtn').addEventListener('click', function () {
      hideOverlay('levelSelectOverlay');
    });
    el('difficultyBtn').addEventListener('click', function () {
      var order = ['easy', 'normal', 'hard', 'chaos'];
      var idx = order.indexOf(currentDifficulty);
      var next = order[(idx + 1) % order.length];
      setDifficulty(next);
      el('difficultyBtn').textContent = '難易度: ' + DIFFICULTIES[next].name;
    });
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

    // Mini-game controls
    el('minigameActionBtn').addEventListener('click', function () {
      if (!currentMiniGame) return;
      var def = MINI_GAMES[currentMiniGame];
      if (def.action) def.action();
    });
    el('minigameCloseBtn').addEventListener('click', function () {
      closeMiniGame();
    });
    var mgCanvas = el('minigameCanvas');
    mgCanvas.addEventListener('touchstart', function (e) { e.preventDefault(); miniGameTap(e); }, { passive: false });
    mgCanvas.addEventListener('touchmove',  function (e) { e.preventDefault(); miniGameDrag(e); }, { passive: false });
    mgCanvas.addEventListener('mousedown',  function (e) { miniGameTap(e); });
    mgCanvas.addEventListener('mousemove',  function (e) { if (e.buttons) miniGameDrag(e); });

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

    // Konami code on title screen (↑↑↓↓←→←→BA) → grants starter pack
    var konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
    var ki = 0;
    window.addEventListener('keydown', function (e) {
      var key = e.key;
      if (key === konami[ki]) {
        ki++;
        if (ki === konami.length) {
          ki = 0;
          if (state === ST.TITLE) {
            unlockAchievement('won_minigame');
            // Grant starter items on next new game via a flag
            window._konamiGranted = true;
            toast('★ KONAMI! 次のラン開始時にスタートパック付与');
            if (audioInitialized) GameEngine.playSound('item_get');
          } else if (state === ST.PLAYING) {
            // In-game: full restore
            player.hp = player.hpMax;
            player.san = player.sanMax;
            player.stam = player.stamMax;
            toast('★ KONAMI! 全回復');
          }
        }
      } else { ki = 0; }
    });

    // 3-tap on title logo triggers same effect (mobile-friendly)
    var titleTaps = 0;
    var titleTapTimer = 0;
    var gameTitle = document.querySelector('.game-title');
    if (gameTitle) {
      gameTitle.addEventListener('click', function () {
        var now = performance.now();
        if (now - titleTapTimer > 1200) titleTaps = 0;
        titleTapTimer = now;
        titleTaps++;
        if (titleTaps >= 5) {
          titleTaps = 0;
          window._konamiGranted = true;
          unlockAchievement('won_minigame');
          toast('★ 隠し効果解除! 次のランにスタートパック');
          if (audioInitialized) GameEngine.playSound('item_get');
        }
      });
    }
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

    // Preload HARUKI sprites (legacy assets - integrated into Lv5)
    GameEngine.loadImage('assets/img/haruki.png').then(function (img) {
      GameEngine.images['assets/img/haruki.png'] = img;
    }).catch(function () {});
    GameEngine.loadImage('assets/img/haruki_scary.png').then(function (img) {
      GameEngine.images['assets/img/haruki_scary.png'] = img;
    }).catch(function () {});

    loadAchievements();
    loadBestTimes();
    loadDifficulty();
    loadTutorialDone();
    loadEndlessBest();
    loadStats();
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
