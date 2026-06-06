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
  // Large warehouse with M.E.G. colony (safe zone Hounds avoid)
  // 34x32 with central M.E.G. base
  var LV1_ROWS = [
    '##################################',
    '#P...............................#',
    '#..FF...........n...i............#',
    '#..FF............................#',
    '#......######....FFF.............#',
    '#......#....#....FFF......i......#',
    '#......#.n..#....FFF.............#',
    '#......#....######...............#',
    '#......##D####...........FFFF....#',
    '#................FFFF....FFFF....#',
    '#......i.........FFFF............#',
    '#..F.F.F.........................#',
    '#..F.F.F.......#####D####........#',
    '#..F.F.F.......#sssssssss#.......#',
    '#..............#ssssssssss#......#',
    '#......F.......#sssssssss#.......#',
    '#..............#ssssssssss#......#',
    '#......F.......#sssssssss#.......#',
    '#..............#sssssss##........#',
    '#..F....FF.....##D######.........#',
    '#.F.....FF.................F.....#',
    '#.F................F.....FF......#',
    '#......FFFF........FF...FF.F.....#',
    '#......FFFF........FF............#',
    '#..F...FFFF..........n...........#',
    '#..F.................F......i....#',
    '#......F....X........F...........#',
    '#......F.........FF..............#',
    '#....................F...........#',
    '#................................#',
    '#......F......F........F....F....#',
    '##################################'
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
  // Override theme ambient loops with refined per-level BGM
  // (use new procedural music for richer atmosphere)
  // We update THEMES inline below.

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
      bgmLoop: 'breath_drone',
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
      ambientLoop: 'wind',
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
      bgmLoop: 'lobby_music',
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
      bgmLoop: 'nostalgic',
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
         hint: '黄色い壁紙の無限の部屋。湿った絨毯。蛍光灯のハム音。\n稀に「もう一人の自分」が現れる。',
         intro: '壁を抜けた先...黄色い廊下が、どこまでも。',
         entities: [
           { type: 'echo', gx: 17, gy: 11 }
         ],
         timeLimit: null },
    1: { id: 1, name: 'LEVEL 1', subtitle: 'HABITABLE ZONE',
         rows: LV1_ROWS, theme: 1,
         hint: 'コンクリート倉庫。M.E.G. ベース (safe area) あり。Hound は近づけない。',
         intro: '壁を抜けた...冷たいコンクリートの匂い。中央に M.E.G. の基地が見える。',
         entities: [
           { type: 'hound', gx: 28, gy: 26 },
           { type: 'crawler', gx: 28, gy: 5 }
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
    },
    antacid: {
      id: 'antacid', name: 'アーモンド胃薬',
      icon: '💊', desc: 'HP+35 & SAN+35。だが 3 秒間移動速度 70% 低下。',
      effect: function (p) {
        p.hp = Math.min(p.hpMax, p.hp + 35);
        p.san = Math.min(p.sanMax, p.san + 35);
        p._sluggishUntil = (performance.now() / 1000) + 3;
        toast('HP+35 SAN+35 (3秒間 鈍化)');
        if (audioInitialized) GameEngine.playSound('item_get');
      }
    },
    compass: {
      id: 'compass', name: '壊れたコンパス',
      icon: '🧭', desc: '使用中マップ全体を表示。だが北が常に回転する。',
      persistent: true,
      effect: function (p) {
        if (p.compassOn) { p.compassOn = false; toast('コンパス OFF'); }
        else { p.compassOn = true; toast('コンパス ON — マップ全表示'); }
      }
    },
    lockpick: {
      id: 'lockpick', name: 'ロックピック',
      icon: '🔓', desc: '錠前破りミニゲームをスキップ。または鍵付きドア解錠。',
      effect: function (p) {
        // Try to find a locked door adjacent to player
        var pgx = Math.floor(p.x / TS);
        var pgy = Math.floor(p.y / TS);
        var opened = 0;
        for (var ddx = -1; ddx <= 1; ddx++) for (var ddy = -1; ddy <= 1; ddy++) {
          var dk = gridKey(pgx + ddx, pgy + ddy);
          var ds = doorStates[dk];
          if (ds && ds.locked) {
            ds.locked = false;
            ds.open = true;
            opened++;
          }
        }
        if (opened > 0) {
          toast(opened + ' 個のドアを解錠');
          if (audioInitialized) GameEngine.playSound('key_unlock');
        } else {
          toast('近くに錠付きドアなし');
        }
      }
    }
  };

  // ── ITEMS POOL BY LEVEL ─────────────────────────────────
  var LEVEL_ITEM_POOLS = {
    0: ['almond_water', 'bandage', 'flashlight', 'almond_milk', 'antacid', 'compass'],
    1: ['almond_water', 'bandage', 'energy_bar', 'keycard', 'flare', 'antacid', 'lockpick'],
    2: ['almond_water', 'bandage', 'energy_bar', 'flare', 'antacid'],
    3: ['almond_water', 'bandage', 'flashlight', 'radio', 'flare', 'lockpick'],
    4: ['almond_water', 'keycard', 'energy_bar', 'radio', 'mirror', 'lockpick', 'antacid'],
    5: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'flare', 'compass', 'antacid'],
    6: ['almond_water', 'flashlight', 'bandage', 'flare', 'compass'],
    7: ['energy_bar', 'almond_water', 'flare', 'antacid'],
    8: ['almond_water', 'bandage', 'radio', 'mirror', 'flare', 'antacid'],
    11: ['almond_water', 'flashlight', 'energy_bar', 'flare', 'compass'],
    12: ['almond_water', 'energy_bar', 'voucher', 'bandage', 'flare', 'antacid'],
    9: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'radio', 'almond_milk', 'antacid', 'lockpick']
  };

  // ── NOTES ───────────────────────────────────────────────
  var NOTES_POOL = {
    0: [
      { title: 'メモ — 最初の被害者',
        text: '見つけた者へ\n\nもしお前が壁の向こうへ落ちた者なら、これを読んでくれ。\nここは「Level 0」と呼ばれている。最も穏やかな階層だ。\n出口は無い。だが no-clip して壁にめり込めば、別の階層へ降りられる。\n運がよければ。' },
      { title: '湿った絨毯',
        text: '床のシミは血ではない。漏水でもない。\nこの場所が記憶している、誰かの泣き痕だ。\n直視するな。SAN が削れる。' },
      { title: 'アーモンドウォーター',
        text: '見覚えのある飲み物が、見覚えのない壁に置かれている。\n飲める。普通の味だ。\n誰がここに置いたのか、考えるな。\n\n成分表示: 水、アーモンド、\nそして「気のせい」。' },
      { title: '蛍光灯のリズム',
        text: 'ハム音には法則がある。\n3 回点滅したら近くにエンティティ。\n5 回点滅したら、もう手遅れだ。\n7 回点滅したら... 私は試したことがない。' },
      { title: 'ROOM 0 セッション #4521',
        text: '"私たちは皆、最初にここに来る。\nそしてここを出ようとする。\nそして気付くんだ。\n— ここは入口でもあり、出口でもあると。"\n\n発言者不明。録音は途中で切れている。' },
      { title: '黄色について',
        text: '何故、Level 0 の壁紙は黄色なのか。\nそれは、人の最も古い記憶を呼び覚ます色だから。\nお前は、思い出さない方が幸せだろう。\n\n— K-37 探検記第3巻' },
      { title: '前ホテルの噂',
        text: 'no-clipper 同士の間に伝わる噂。\n\n"あるホテルに、追跡者がいた。\nハルキ、と呼ばれていた。\n獲物を no-clip するまで追い詰め、\n壁の向こうまで追ってきた、と。"\n\n— Level 5 で会えるかもしれない。' },
      { title: 'M.E.G. 基地 BR-7 の住人手記',
        text: 'Major Explorer Group が築いた Level 0 内の基地。\n安全な部屋は 7 つあるとされるが、\n誰も全てを発見したことがない。\n\n基地メンバーは月に 1 度、入れ替わる。\n— 入る人数と出る人数は、いつも一致しない。' },
      { title: 'no-clip の科学',
        text: '"no-clip" とは、現実の物理ルールを抜け出す現象。\n壁、床、天井 — いかなる障壁も\nお前が「ここではない」と確信した瞬間、消える。\n\nだが、確信した先には別の現実が待っている。\nそして、戻り方は誰も知らない。' },
      { title: '私の名前は',
        text: '思い出せない。\nここに来てから、3 階層を降りた。\nまだ 1 週間も経っていない。\n\nなのに、自分の名前が出てこない。\nこれを書いている文字は、私の字なのか?' },
      { title: '時計が無い',
        text: 'Level 0 には時計が無い。\n光も日没も無い。\n蛍光灯のハム音だけが、時間の代わり。\n\n私は時計を持ってきた。\n3 時間で止まった。\n針が逆回りを始めている。' }
    ],
    1: [
      { title: '倉庫の住人',
        text: 'Hound に注意。\n見かけたら走るな。動きで反応する。\n壁に貼り付いて呼吸を整えろ。' },
      { title: '居住可能ゾーン',
        text: 'Level 1 は比較的安全だ。\n他の "no-clipper" と出会うこともある。\nもし出会えたら、それは幸運だ。\nもし、向こうから来たら...違うかもしれない。' },
      { title: 'M.E.G. 報告書',
        text: 'Major Explorer Group 第 14 派遣隊:\n"Level 1 は中継地点として最適。\n安全な領域あり、定期的にアーモンドウォーターが補給される。\nだが、夜は決して訪れないことを覚悟せよ。"\n\n補足: 派遣隊 14 のうち、戻ったのは 8 名。' },
      { title: '空気の重さ',
        text: 'コンクリートの匂いと、僅かなオイル。\nここは「現実」に最も近い階層だと言われている。\nだから帰りたくなる。だから危ない。\n\n— K-37 探検記第7巻' },
      { title: 'Crawler の生態',
        text: '低く、速く、多眼。\n奴は待つ。じっと待つ。\n動きが止まったら、次の瞬間に飛びかかってくる。\n— だから、走り続けろ。' },
      { title: '誰かの遺書',
        text: '"ハルキに見つかった。\nまた逃げなければ。\n壁を抜けても、追ってくる。\nここ Level 1 までは追いつかれた。\n次はもっと深くへ。"\n\n紙片はここで途切れている。' },
      { title: '搬入伝票 No.0024',
        text: '差出: 不明\n宛先: Level 1 倉庫\n品名: 一式 (内容不明)\n数量: ∞\n納期: 既に到着済み\n\n何が運ばれてきているのか、誰もが知らない。\nだが、棚は決して空にならない。' },
      { title: '電子掲示板',
        text: '"Level 1 ヘようこそ\n— サポートは平日 9-17 時 (もう一度: もう機能していません)\n— 安全のため夜間は外出禁止 (もう一度: ここに夜は来ません)\n— 楽しい滞在を!"' },
      { title: '前所有者の手紙',
        text: '"この倉庫は、私の祖父の代から続いていた。\n商品を運び、棚を整理し、出荷した。\n\n気付けば、私は壁の中にいた。\n商品はまだ運ばれてくる。\nだから、私は今も働き続けている。\n壁の向こう側で。"' },
      { title: 'コンクリートの夢',
        text: 'M.E.G. 神経科医 R 博士の論文:\n"Level 1 で長時間過ごすと、被験者は『コンクリートの夢』を見る。\n灰色の長い廊下、何も無い、終わらない夢。\n\n目覚めても、夢は続いている — それが Level 1 の本質。"' }
    ],
    2: [
      { title: '配管夢の警告',
        text: '水に長く立つな。\nSAN がゆるやかに削れる。\nそれから...足首から何かが昇ってくる気がするだろう。' },
      { title: 'Smiler',
        text: '暗闇に白い歯だけが浮かぶ。\n見るな。目を逸らせばすり抜ける。\n見続けると...笑いに、引き込まれる。' },
      { title: '腐食した詩',
        text: '"配管は夢を見る。\n誰も流さない水を流し、\n誰も呼ばない人を呼び、\n誰も帰らない者を待つ。"' },
      { title: 'プラント技師の最終ログ',
        text: '日報 #∞-3:\n"配管系統 A-7 が逆流を始めた。\n圧力計が壊れている。\n指針が裏返しを指している。\n\n上司への報告: ...そうか、上司はもういない。\n私が最後の技師か。\nだったら、誰がこれを読むんだ。"' },
      { title: '水の声',
        text: 'ここの水は、声を発する。\n聴き続けると、お前の名前を呼ぶ。\n\nお前の名前は、ここに来る前から\n配管が知っていた。' },
      { title: 'M.E.G. 構造解析報告',
        text: '"Level 2 の配管は重力に従わない。\n上向きに水が流れ、下向きに蒸気が降りる。\nここに来た物理学者 3 名は、3 通りの結論を出した:\n\n1) ここは現実ではない\n2) 我々が物理を誤解していた\n3) 配管が物理を超えた\n\n3 名とも戻らなかった。"' },
      { title: '配管夢',
        text: 'この階層で目を閉じると、必ず\n配管の音が聞こえる。\n\n水滴の音 — リズミカル。\nバルブの音 — 規則的。\nそして、誰かの咳 — 配管の中から。\n\n咳をしているのは、お前が来る前から\n中にいた、誰か。' },
      { title: '蒸気の中の影',
        text: '湿気の高い箇所で、たまに\n人影が見える。\nお前と同じ姿勢。お前と同じ動き。\n\n鏡ではない。\nそれは、もうここに残っている、お前。' }
    ],
    3: [
      { title: '通電中',
        text: '床が黒い斑点は、まだ電流が通っている。\n触れるな。HP と SAN を一度に持っていかれる。' },
      { title: 'スパークの法則',
        text: '火花が見えた時、もう避ける時間はない。\nだから、火花が見える前に逃げろ。' },
      { title: '電気技師の最後の言葉',
        text: '"発電所を見つけた。\nこれで全階層に光を戻せる。\n— だが、誰が光を消したのか、まだ分からない。"' },
      { title: 'Wretch とは',
        text: '動かない。\nだが、視線を合わせてはいけない。\n奴の胸には穴が開いている。\nその穴は、お前の SAN を吸い込む。\n目を逸らせ。決して、見つめるな。' },
      { title: '配電盤の記録',
        text: '配電盤 No.7 に黒い炭の文字:\n\n"電気を止めるな。\n電気を止めると、\n奴らが目覚める。\n\n— 元 Level 3 担当者"' },
      { title: '電撃の中の声',
        text: 'スパーク音の合間に、声が混じる。\nヘリ音に偽装された、女性の声。\n\n聞き取れた言葉:\n"...どこ...どこに...いる...の..."\n\nお前の母親の声に、似ているかもしれない。' },
      { title: '感電死体の供物',
        text: 'M.E.G. Level 3 観察隊報告:\n"床の黒い斑点は元 no-clipper の影。\n感電死した者の魂が床に焼き付いている。\n\n触れるな。彼らは仲間が欲しいのだ。\n孤独な階層で、誰かを連れていきたいのだ。"' }
    ],
    4: [
      { title: 'デスクの落書き',
        text: '"4F 第3キュービクル、奴は私だった"\n誰が書いたのか、思い出せない。\n私の字に似ている。' },
      { title: 'Skin-Stealer',
        text: '床に倒れている同僚。\n声をかけるな。触るな。\n目を合わせるな。\n奴らはお前の皮膚を欲しがっている。' },
      { title: '退職届',
        text: '退職事由: 不在\n退職日: 不明\n署名: ____________\n\n誰の退職届だ。なぜここに。' },
      { title: '人事部からの通知',
        text: '宛先: 全社員\n\n本日より、全社員の出社情報は\n「常に出社中」とみなされます。\n\nしたがって、退勤・退職・\n死亡の届出は受理されません。\n\n— 人事部より' },
      { title: '残業申請書',
        text: '申請者: M. 田中\n申請日: ??/??/????\n残業時間: ∞時間\n理由: 締切まで間に合わない\n\n承認印あり (印影は赤く滲んでいる)\n\n田中は、まだここで働いている。' },
      { title: 'コーヒーマシン',
        text: 'Level 4 のコーヒーマシンは未だ機能している。\nコインは要らない。\n\n紙コップにはいつも同じ言葉:\n\n"おかえりなさい、いつもの方"' },
      { title: '社内メール (未送信)',
        text: 'Subject: 来週月曜の会議について\nFrom: 自分\nTo: 上司\n\n"来週は出席できません。\n壁を抜けてしまったので。\n申し訳ありません。\nまたいつかお会いしましょう。\n\nたぶん、来週月曜の会議で。"' },
      { title: '4F 第3キュービクル',
        text: 'お前が立っているこのキュービクル。\nデスクに座ると、急に「思い出す」。\n\n書類の処理、上司の名前、\n隣の席の同僚の顔、\n会議の予定、\n\nそして、no-clipper になる前の人生を。\n\n— 思い出すな。それは罠だ。' }
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
        text: 'この階層では、無人の廊下に時々電話の音が響く。\n受話器は無い。\nだが、確実に聞こえる。\n\n— 出るな。\n  出れば、必ず追ってくる。' },
      { title: 'コンシェルジュからの挨拶',
        text: '"親愛なるお客様へ\n\n本ホテルでは、ご滞在中のあらゆる需要にお応えします:\n- お休みの部屋: 無限\n- お食事: 永遠\n- ご退室: ...差し止め中\n\nお気軽にコンシェルジュ (顔のないスーツの男) までお声がけください。\n\nMr. Hotel"' },
      { title: 'ロビーの絵画',
        text: 'ロビーに飾られた油絵。\n描かれているのは、お前の顔。\n\n気付くまで、お前は気付かない。\n気付いた瞬間、絵が瞬きをする。' },
      { title: '元 chill_haruking より',
        text: 'これはバックルーム以前の物語。\n深夜のホテルに、追跡者「ハルキ」がいた。\n彼女から逃げ切った宿泊客は、\n壁を抜けて Level 5 にたどり着いた。\n\nだが、ハルキも壁を抜いた。\n— 物語は、終わらない。' },
      { title: 'チェックアウト不能',
        text: 'M.E.G. 危険等級報告書 第 5 号:\n\n"Level 5 にチェックインした者は\nチェックアウトの方法を忘れる。\n\n出口の地図を持っていても、\n出口の存在自体を忘れる。\n\nこれは Mr. Hotel の能力ではない。\nここはホテル自体が、忘却させる場所なのだ。"' },
      { title: '深夜の従業員放送',
        text: 'スピーカーから:\n\n"夜 0 時を回りました。\nゲストの皆様におかれましては、\nお部屋に戻ってお休みください。\n\n戻らないゲストには、\nお迎えに上がります。"' }
    ],
    6: [
      { title: '完全な暗闇',
        text: '光を消した者がいる。\n誰かがこの階層を「閉じた」のだ。\n懐中電灯がなければ、5 タイル先も見えない。' },
      { title: '闇の儀式',
        text: 'この階層に来た者の SAN は、通常の倍速で削れる。\n暗闇そのものが脳に侵食する。\n光を絶やすな。' },
      { title: '誰かの最後の言葉',
        text: '"光が、消えた。\n電気を点けたのに。\n電池が満タンの懐中電灯を持っているのに。\n見えないものを、見ているのは、私だ。\n\n私の目こそが、ここで閉じてしまった。"' },
      { title: '見えない地図',
        text: '床にチョークで書かれた地図がある。\n手探りで形を読み取れる。\n\n書いた者の意図は明らかだ — \n後の者へ、迷わぬよう。\n\nだが地図は不規則に書き換えられている。\n誰かが、毎晩、新しく書いている。' },
      { title: '暗闇の発声',
        text: 'M.E.G. 音響観察:\n"完全な無音ではない。\n非常に低周波の振動 (約 0.3 Hz) が常時。\n人間の呼吸に近いリズム。\n\n何かが、この階層全体で\n呼吸している。"' }
    ],
    7: [
      { title: 'Run For Your Life',
        text: 'この階層に立ち止まった者はいない。\n走れ。\n振り返るな。\n奴らの数は、振り返るたびに増える。' },
      { title: '最速記録',
        text: 'この階層を 60 秒未満でクリアした者がいるという。\n彼は今、走り続けている。\n他の階層で。\n他の自分から、逃げ続けている。' },
      { title: '回廊の起源',
        text: 'M.E.G. 第 3 仮説:\n"Level 7 は元 Level 0 の一部だった。\n誰かが「永遠に走り続けたい」と願った瞬間、\nその部屋が回廊となり、独立した階層になった。\n\n願いは叶っている。\nだが、その誰かは、止まることができない。"' },
      { title: '前を見ろ',
        text: '走っている間、決して振り返るな。\n振り返った瞬間、後ろにいた奴が見える。\n見えると、奴は加速する。\n\n見なければ、奴は遅い。\n見なければ、お前は速い。\n\nだから — 振り返るな。' },
      { title: '私たちは走り続ける',
        text: 'Level 7 の出口に、メモが置かれている。\n\n"走った者へ\nおめでとう。\n君は今、振り返らずに 60 秒走り抜いた。\n\nだが、これからの人生でも\n振り返らない覚悟はあるか?"' }
    ],
    8: [
      { title: 'The Hive — 巣',
        text: 'セルの中に何かが吊るされている。\nそれを直視しないこと。\n甘い香りに意識を持っていかれる。' },
      { title: '巣の主',
        text: 'Smiler と Partygoer が共存している珍しい階層。\n奴らは互いに干渉しない。\nそして両方ともお前に興味を持っている。' },
      { title: '蜂蜜のような',
        text: '空気が甘い。\n床に小さな黄色い液滴が落ちている。\n蜂蜜? いや、もっと粘度が高い。\n— 触れるな。' },
      { title: '巣の働き手',
        text: 'M.E.G. 観察記録 #008-3:\n"Level 8 のセル状構造には、定期的に\n「働き手」が集まる。\n\n彼らは元 no-clipper。\nここの SAN 吸引に屈服した者たち。\n\n彼らは今もセルを修繕し、\n吊るされたものを増やし続ける。"' },
      { title: '巣の女王',
        text: 'セルの奥深く、最深部に\n「女王」と呼ばれる存在がいる、と噂される。\n\n見た者はいない。\n\nだが、Level 8 で死んだ者は\n例外なく、女王の腹の中に\n吊るされるという。' },
      { title: '蜜の中の声',
        text: '黄色い液滴に耳を近づけると、\n中から声が聞こえる。\n\n甘く優しい声。母親の声。\n\n"おかえりなさい。\nもう何もしなくていいよ。\nここで眠っていなさい。"\n\n— 聞いてはいけない。' }
    ],
    11: [
      { title: 'End of the Line',
        text: '線路は始点も終点も無い。\nだが、列車は時々通る。\n音が聞こえたら、伏せろ。' },
      { title: '駅員ノート',
        text: '"乗客 0 / 降客 ∞"\n"次の列車: もうすぐ"\n"次の次の列車: もう来ない"' },
      { title: '時刻表',
        text: '12:00\n00:00\n??:??\n\n次の到着時刻は表記されていない。\n"列車は always 通ります" と注釈がある。' },
      { title: '車掌の記録',
        text: '車掌室で発見された手帳:\n\n"今日も乗客はいなかった。\n運転手もいなかった。\n線路は私の意思に従って動いている。\n\nそれでも、列車は時刻通りに走る。\n— 何故、走り続けるのか、私には分からない。"' },
      { title: 'プラットフォームの落書き',
        text: '"次の列車を待っている人へ\n\n来ません。\nどんなに待っても来ません。\nでも、列車の音はします。\nそれは、お前の心臓の音です。"' },
      { title: 'M.E.G. 危険等級審議',
        text: '"Level ! の真の危険は列車ではない。\n列車を「見られる」ことだ。\n\n通過する列車を直視した者の魂は、\n列車に乗せられて、どこかへ運ばれる。\n\n伏せろ。決して、見るな。"' }
    ],
    12: [
      { title: 'Fun =)',
        text: 'パーティへようこそ!\n音楽は止まりません。\n笑顔の彼らは、お前にも笑顔を分けたがる。\n— 文字通り、お前の顔を切り取って。' },
      { title: '招待状',
        text: '宛先: 全 no-clipper 様\n本日のパーティは無料です。\nお帰りも無料です — できれば。' },
      { title: 'コンフェッティ',
        text: '床に散らばる紙片を拾った。\n読めない言語で何かが書かれている。\n— だが、自分の名前だけはハッキリと読めた。' },
      { title: 'パーティの主催者',
        text: '"このパーティは、6,247 日前から開催中。\n主催者: 不明。\nゲスト: 432 名 (うち生存: 不明)。\n音楽: ループ中。\n\nお祝いの理由: お前が来たこと。"' },
      { title: 'ケーキの中の手紙',
        text: 'ピンクのケーキを切ると、中から紙が出てきた。\n\n"おめでとう。\n君はパーティに最後に到着した客だ。\nだから、君がケーキを食べる役。\n\n食べないと、君が食べられる。\n選んで。"' },
      { title: 'カラオケの歌詞',
        text: 'ステージ上のマイクから、歌が流れている。\n歌詞は変わり続けている。\n\n"ハッピーバースデー、ディア [プレイヤー名]\nハッピーバースデー、トゥーユー\n\nまだ生きてる?\nお祝いするよ、何度でも♪"' },
      { title: 'パーティが終わらない理由',
        text: 'M.E.G. 文化観察記録:\n"Level Fun =) は、誰かの最高の誕生日の記憶から生まれた。\n\nその誰かは、もう存在しない。\nだが、記憶が階層を維持し続けている。\n\nパーティが終わるには、その誰かを思い出してあげる必要がある。\nだが、誰も覚えていない。\n— だから、永遠に続く。"' }
    ],
    9: [
      { title: '郊外の終わり',
        text: 'この街には終わりがあるという。\n最後の家のドアを開ければ、そこに...\n何があるのか、誰も戻って報告していない。' },
      { title: 'THE END',
        text: '黒い扉を見つけたら、それが終点だ。\nそこを開けば「TRUE END」へ到達できる。\nだが、開けないという選択肢もある。' },
      { title: 'THE ARCHITECT',
        text: 'この階層を構築・支配する存在。\n王冠を被った人型。\n3 つの段階で本性を見せる。\n\nフェーズ 1: 観察。徘徊。\nフェーズ 2: 接近。突進。\nフェーズ 3: 分裂。影を生み出す。\n\n— 倒さなくても TRUE END は見られる。だが、奴を倒した者だけが、本当の終わりを知る。' },
      { title: '隣家のポストカード',
        text: '"親愛なる隣人へ\n\n今日はお会いできて嬉しかったです。\nまたお茶でもどうですか?\n\n追伸: 私のことを覚えていてくれて嬉しい。\nあなた以前の隣人は、皆、忘れてしまったから。"\n\n— 隣の家から、明日も毎日届く。' },
      { title: '芝生の手紙',
        text: '芝生の上に、整然と並べられた小石。\nメッセージを綴っている:\n\n"ここはアメリカの郊外じゃない。\nここは「郊外の概念」そのもの。\n\nだから誰でも、ここで\n自分の故郷を見ることができる。\n\n見えたあなたの故郷を、忘れないように。"' },
      { title: 'THE ARCHITECT の手記',
        text: 'M.E.G. 入手の重大資料:\n\n"私は Level 9 を建てた者。\n人間だった頃の最後の願いは、\n「平穏な郊外で老後を過ごしたい」だった。\n\nだから、ここを永遠の郊外にした。\n人々を迎え入れた。\n\nだが、誰も帰らない。\nだから、私が引き留めている、と思われている。\n\n— 違う。彼らが、帰りたくないのだ。"' },
      { title: '満月の不在',
        text: 'この階層に月は無い。\nだが、月が「あった」場所には、\n大きな黒い円が浮かんでいる。\n\n直視すると、自分の影が伸びる。\n影は、自分より大きく、自分を見つめ返す。\n\n— あれは月の不在ではない。\n  月の代わりに、何かが見ているのだ。' }
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
  var currentBgm = null;

  // Phone UI
  var phoneOpen = false;
  var activeTab = 'Status';

  // Floating map
  var floatingMapOpen = false;
  var floatingMapOpacity = 0.65;

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

  // Default to LOW for mobile perf — users opt-in to HIGH via settings.
  var gfxQuality = 'low'; // 'high' | 'low'

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

  // Lifetime collected note titles (used for TRUE+ END unique collection)
  var lifetimeNoteTitles = {};

  var entitySeenTypes = {}; // {type: true}

  var ENTITY_INTROS = {
    hound: { name: 'HOUND', desc: 'バックルーム公式分類 Class 3。\n低い四足の捕食者で人間の頭部を持つ。\n動くものに反応するため、走らずゆっくり歩け。' },
    smiler: { name: 'SMILER', desc: 'バックルーム公式分類 Class 2。\n暗闇に浮かぶ無数の白い歯と目だけが見える。\n直視せず、視線を逸らせばすり抜ける。\n見つめ続けると引き込まれる。' },
    skinstealer: { name: 'SKIN-STEALER', desc: 'バックルーム公式分類 Class 4。\nLevel 4 オフィスに棲息。\n死体や同僚の皮を被って近付き、触れた者の皮を奪う。\n鏡を使えば本性を晒し、消滅させられる。' },
    partygoer: { name: 'PARTYGOER', desc: 'バックルーム公式分類 Class 3。\nLevel Fun=) の住人。塗装された笑顔と三角帽。\n陽気な暴力でお前を「祝う」。フレアで一時退避可能。' },
    crawler: { name: 'CRAWLER', desc: 'バックルーム公式分類 Class 2。\n複数の眼と長い四肢。配管や狭い空間を好む。\n静止 → 突進 → 撤退の三段階を繰り返す。' },
    wretch: { name: 'WRETCH', desc: 'バックルーム公式分類 Class 3 (Watcher 型)。\n動かないが、視線を合わせた者の SAN を胸の空洞へ吸い込む。\n目を逸らせば実害は無い。' },
    boss: { name: 'THE ARCHITECT', desc: 'バックルーム公式分類 Class 5 (Apex)。\nLevel 9 The Suburbs を構築・管理する存在。\n王冠と赤い目。3 段階で攻撃パターンが変化する。\nフレア (50dmg) / 鏡 (100dmg) で抵抗可能。' },
    mrhotel: { name: 'MR. HOTEL', desc: 'バックルーム公式分類 Class 4。\nLevel 5 ホテルの「支配人」。シルクハットに顔の無いスーツ。\n名前を尋ねられても答えるな。盗まれる。\n4 マス以内で SAN を継続吸引。' },
    haruki: { name: 'HARUKI', desc: '非公式。前ホテルからの no-clipper。\nお前を追って壁の向こうまで来た存在。\n姿は不定形だが、お前の最も恐ろしい記憶として現れる。\n電話のベルが近接の兆候。' },
    echo: { name: 'ECHO', desc: 'バックルーム未分類。\nお前の動きを 0.6 秒遅れで完全模倣する亡霊。\n直視すると鏡を見ているような感覚に襲われ、SAN が削れる。\n振り切るには思考しない急な動きが有効。' },
    faceling: { name: 'FACELING', desc: 'バックルーム公式分類 Class 1 (擬態型)。\nM.E.G. メンバーや過去の no-clipper の姿に化ける。\n顔は常に「ぼやけて」見える。\n敵対的ではないが、稀に視線を合わせると SAN を引き抜く。' }
  };
  // NOTE: ENTITY_SOUND_MAP.echo / .faceling are added inline in ENTITY_SOUND_MAP literal
  // below (line ~3957). Don't reference ENTITY_SOUND_MAP here — it's declared later via var
  // hoisting (undefined at this point), which previously caused the IIFE to throw a
  // TypeError ("Cannot set property 'echo' of undefined"), silently killing all
  // subsequent code including window.__titleAction assignment.

  // First-run tutorial state
  var tutorialDone = false;
  var tutorialStep = -1;
  var tutorialTimer = 0;

  // Game mode
  var gameMode = 'normal'; // 'normal' | 'endless'

  // Gamepad (PS4/PS5/Xbox) support
  var GAMEPAD_KEY = 'thebackrooms_gamepad_v1';
  var DEFAULT_GAMEPAD_MAP = {
    move: 'leftstick',       // axes 0, 1
    look: 'rightstick',      // axes 2, 3
    action: 0,                // button 0 = X (PS) / A (Xbox)
    phone: 3,                 // button 3 = △ (PS) / Y (Xbox)
    flare: 2,                 // button 2 = □ (PS) / X (Xbox)
    sprint: 6,                // L2 (PS) / LT (Xbox)
    map: 7,                   // R2 (PS) / RT (Xbox)
    pause: 9                  // Options (PS) / Start (Xbox)
  };
  var gamepadMap = DEFAULT_GAMEPAD_MAP;
  var gamepadConnected = false;
  function loadGamepadMap() {
    try {
      var s = localStorage.getItem(GAMEPAD_KEY);
      if (s) {
        var parsed = JSON.parse(s);
        gamepadMap = Object.assign({}, DEFAULT_GAMEPAD_MAP, parsed);
      }
    } catch (e) { /* ignore */ }
  }
  function saveGamepadMap() {
    try { localStorage.setItem(GAMEPAD_KEY, JSON.stringify(gamepadMap)); } catch (e) {}
  }
  function pollGamepad() {
    if (!navigator.getGamepads) return;
    var pads = navigator.getGamepads();
    var gp = null;
    for (var i = 0; i < pads.length; i++) {
      if (pads[i]) { gp = pads[i]; break; }
    }
    // Update gamepad status UI in title settings
    var statusEl = el('tsGamepadStatus');
    if (statusEl) statusEl.textContent = gp ? (gp.id.split('(')[0].trim() + ' 接続中') : '未接続';
    if (!gp) {
      if (gamepadConnected) {
        gamepadConnected = false;
        toast('コントローラ切断');
      }
      return;
    }
    if (!gamepadConnected) {
      gamepadConnected = true;
      toast('コントローラ接続: ' + (gp.id.split('(')[0].trim()));
      if (audioInitialized) GameEngine.playSound('item_get');
    }
    // Show last-pressed button in title settings (when settings overlay is open)
    var pressedEl = el('tsGpPressedBtn');
    if (pressedEl) {
      for (var pi = 0; pi < gp.buttons.length; pi++) {
        if (gp.buttons[pi].pressed) {
          pressedEl.textContent = '最後に押されたボタン: ' + pi;
          break;
        }
      }
    }
    // Handle menu navigation when overlays are open (close on action / phone button)
    var pauseBtn = gp.buttons[gamepadMap.pause];
    var actionBtnRaw = gp.buttons[gamepadMap.action];
    var phoneBtnRaw = gp.buttons[gamepadMap.phone];
    var anyClose = (pauseBtn && pauseBtn.pressed) || (phoneBtnRaw && phoneBtnRaw.pressed);
    var anyConfirm = actionBtnRaw && actionBtnRaw.pressed;

    // Phone open → phone or pause closes it
    if (phoneOpen && anyClose && !gp._menuClosePressed) {
      gp._menuClosePressed = true;
      closePhone();
      return;
    }
    // Item use modal → action confirms, pause cancels
    var iumEl = el('itemUseModal');
    if (iumEl && iumEl.style.display !== 'none') {
      if (anyConfirm && !gp._menuConfirmPressed) {
        gp._menuConfirmPressed = true;
        try { confirmItemUse(); } catch (e) {}
      }
      if (pauseBtn && pauseBtn.pressed && !gp._menuClosePressed) {
        gp._menuClosePressed = true;
        closeItemUseModal();
      }
      if (!anyConfirm) gp._menuConfirmPressed = false;
      if (!(pauseBtn && pauseBtn.pressed)) gp._menuClosePressed = false;
      return;
    }
    // Note viewer → any button closes
    var nveEl = el('noteViewerOverlay');
    if (nveEl && nveEl.style.display !== 'none') {
      if ((anyConfirm || anyClose) && !gp._menuClosePressed) {
        gp._menuClosePressed = true;
        var closeNoteBtn = el('closeNoteBtn');
        if (closeNoteBtn) closeNoteBtn.click();
      }
      if (!anyConfirm && !anyClose) gp._menuClosePressed = false;
      return;
    }
    // Tutorial overlay → close
    var tutEl = el('tutorialOverlay');
    if (tutEl && tutEl.style.display !== 'none') {
      if ((anyConfirm || anyClose) && !gp._menuClosePressed) {
        gp._menuClosePressed = true;
        var closeTutBtn = el('closeTutorialBtn');
        if (closeTutBtn) closeTutBtn.click();
      }
      if (!anyConfirm && !anyClose) gp._menuClosePressed = false;
      return;
    }
    // Reset close press tracking when no buttons held
    if (!anyClose) gp._menuClosePressed = false;

    if (state !== ST.PLAYING || phoneOpen || miniGameOpen) return;
    // Left stick: movement
    // BUGFIX: 以前は dead zone 以内で input がクリアされず最後の値が残り続け、
    // スティックを離しても滑り続ける症状があった。else 節を追加して明示的にクリア。
    var dx = gp.axes[0] || 0;
    var dy = gp.axes[1] || 0;
    var stickMag = Math.sqrt(dx * dx + dy * dy);
    if (stickMag > 0.15) {
      // Apply radial dead zone for smoother diagonal feel
      var deadAdj = (stickMag - 0.15) / (1 - 0.15);
      GameEngine.input.dx = (dx / stickMag) * deadAdj;
      GameEngine.input.dy = (dy / stickMag) * deadAdj;
    } else {
      GameEngine.input.dx = 0;
      GameEngine.input.dy = 0;
    }
    // Right stick: look
    var lookX = gp.axes[2] || 0;
    if (Math.abs(lookX) > 0.15) {
      var lookAdj = (Math.abs(lookX) - 0.15) / (1 - 0.15);
      GameEngine.input.lookDx = Math.sign(lookX) * lookAdj;
    } else {
      GameEngine.input.lookDx = 0;
    }
    // Action button
    var actionBtn = gp.buttons[gamepadMap.action];
    if (actionBtn && actionBtn.pressed) {
      if (!GameEngine.input.action) GameEngine.input.actionJustPressed = true;
      GameEngine.input.action = true;
    } else {
      GameEngine.input.action = false;
    }
    // Sprint (L2)
    var sprintBtn = gp.buttons[gamepadMap.sprint];
    GameEngine.input.sprint = !!(sprintBtn && sprintBtn.pressed);
    // Phone (Triangle)
    var phoneBtn = gp.buttons[gamepadMap.phone];
    if (phoneBtn && phoneBtn.pressed && !gp._phonePressed) {
      gp._phonePressed = true;
      openPhone();
    } else if (!(phoneBtn && phoneBtn.pressed)) {
      gp._phonePressed = false;
    }
    // Map toggle (R2)
    var mapBtn = gp.buttons[gamepadMap.map];
    if (mapBtn && mapBtn.pressed && !gp._mapPressed) {
      gp._mapPressed = true;
      floatingMapOpen = !floatingMapOpen;
      el('floatingMap').style.display = floatingMapOpen ? 'flex' : 'none';
    } else if (!(mapBtn && mapBtn.pressed)) {
      gp._mapPressed = false;
    }
    // Flare quick-use (Square)
    var flareBtn = gp.buttons[gamepadMap.flare];
    if (flareBtn && flareBtn.pressed && !gp._flarePressed) {
      gp._flarePressed = true;
      if (player.inventory.flare) {
        var flareIt = ITEMS.flare;
        flareIt.effect(player);
        player.inventory.flare--;
        if (player.inventory.flare <= 0) delete player.inventory.flare;
      }
    } else if (!(flareBtn && flareBtn.pressed)) {
      gp._flarePressed = false;
    }
  }
  // Poll gamepad each frame via existing engine update hook
  window.addEventListener('gamepadconnected', function (e) {
    console.log('Gamepad connected', e.gamepad);
  });
  window.addEventListener('gamepaddisconnected', function () {
    gamepadConnected = false;
  });
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

  // Discovery popup (item/note found) — pauses game while shown
  var _discoveryTimer = null;
  var _discoveryActive = false;
  function showDiscovery(icon, label, name) {
    var pop = el('discoveryPopup');
    if (!pop) return;
    el('discoveryIcon').textContent = icon;
    el('discoveryLabel').textContent = label;
    el('discoveryName').textContent = name;
    pop.classList.remove('show');
    pop.style.display = 'flex';
    void pop.offsetWidth; // force reflow
    pop.classList.add('show');
    _discoveryActive = true;
    if (_discoveryTimer) clearTimeout(_discoveryTimer);
    _discoveryTimer = setTimeout(function () {
      pop.classList.remove('show');
      setTimeout(function () {
        pop.style.display = 'none';
        _discoveryActive = false;
      }, 400);
    }, 1400);
  }

  // Encounter cinematic for entity first sighting
  var _inCinematic = false;
  function playEncounterCinematic(entityType) {
    var intro = ENTITY_INTROS[entityType];
    if (!intro) return;
    _inCinematic = true;
    // Audio cue
    if (audioInitialized) {
      GameEngine.playSound('jumpscare');
      GameEngine.shakeScreen(15, 0.6);
    }
    // Entity-specific icons
    var entityIcons = {
      hound: '🐺', smiler: '😬', skinstealer: '🧥', partygoer: '🎉',
      crawler: '🕷', wretch: '👁', boss: '👑', mrhotel: '🎩', haruki: '👤'
    };
    el('encounterShape').textContent = entityIcons[entityType] || '⚠';
    el('encounterName').textContent = intro.name;
    el('encounterDesc').textContent = intro.desc + '\n\n[ 画面をタップして閉じる ]';
    showOverlay('encounterCinematic');
    if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 80]);
    // Tap-to-close (no auto-dismiss). Safety net: auto-close after 30s.
    var encOverlay = el('encounterCinematic');
    var encDone = false;
    var encClose = function () {
      if (encDone) return;
      encDone = true;
      encOverlay.removeEventListener('click', encClose);
      encOverlay.removeEventListener('touchstart', encClose);
      hideOverlay('encounterCinematic');
      _inCinematic = false;
    };
    encOverlay.style.pointerEvents = 'auto';
    encOverlay.addEventListener('click', encClose);
    encOverlay.addEventListener('touchstart', encClose);
    setTimeout(encClose, 30000);
  }

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

    // Assign notes randomly from pool (every run shows different notes)
    var notesPool = NOTES_POOL[levelId] || [];
    noteSpots = {};
    // Shuffle copy
    var shuffledPool = notesPool.slice();
    for (var sh = shuffledPool.length - 1; sh > 0; sh--) {
      var jr = Math.floor(Math.random() * (sh + 1));
      var tmp = shuffledPool[sh]; shuffledPool[sh] = shuffledPool[jr]; shuffledPool[jr] = tmp;
    }
    for (var ni = 0; ni < parsed.noteSpots.length && ni < shuffledPool.length; ni++) {
      var ns = parsed.noteSpots[ni];
      var nkey = gridKey(ns.gx, ns.gy);
      noteSpots[nkey] = shuffledPool[ni];
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

    // Surface-aware footsteps by level theme
    // 0 lobby=carpet, 1 habitable=concrete, 2 pipes=water (with reset to metal on dry tiles),
    // 3 electrical=metal, 4 office=carpet, 5 hotel=carpet, 6 dark=concrete, 7 hallway=concrete,
    // 8 hive=wood, 9 suburbs=gravel, 11 train=metal, 12 fun=wood
    var SURFACE_BY_LEVEL = {
      0: 'carpet', 1: 'concrete', 2: 'water', 3: 'metal', 4: 'carpet',
      5: 'carpet', 6: 'concrete', 7: 'concrete', 8: 'wood', 9: 'gravel',
      11: 'metal', 12: 'wood'
    };
    if (typeof GameEngine.setPlayerFootSurface === 'function') {
      GameEngine.setPlayerFootSurface(SURFACE_BY_LEVEL[levelId] || 'carpet');
    }

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
    // Reset transient flags so next level starts with clean audio/visual state
    player._heartbeatOn = false;
    player._footAccum = 0;
    player._blackoutTimer = 0;
    player._trainTimer = 0;
    player._lastHpRatio = player.hp / player.hpMax;
    player._lastSanRatio = player.san / player.sanMax;
    player._noClipping = false;
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

    // Audio: stop all ambient + BGM loops, start fresh ones
    if (audioInitialized) {
      ['ambient', 'fluorescent', 'pipe_drip', 'electric', 'wind',
       'classical', 'lobby_music', 'nostalgic', 'chase', 'breath_drone'].forEach(function (l) {
        GameEngine.stopLoop(l);
      });
      currentAmbient = theme.ambientLoop;
      currentBgm = theme.bgmLoop;
      if (currentAmbient) GameEngine.startLoop(currentAmbient);
      if (currentBgm) GameEngine.startLoop(currentBgm);
    }
    player._beingChased = false;

    // Force canvas resize before/during overlays (iOS Safari dynamic viewport fix)
    forceCanvasResize();

    // Loading screen — then Level Reach cinematic before play
    if (!instant) {
      showLoadingScreen(def);
      setTimeout(function () {
        hideOverlay('loadingScreen');
        forceCanvasResize();
        // Show level reach cinematic
        playLevelReachCinematic(def, function () {
          forceCanvasResize();
          startPlaying();
        });
      }, 900);
    } else {
      forceCanvasResize();
      startPlaying();
    }
  }

  function forceCanvasResize() {
    if (GameEngine._resize) GameEngine._resize();
    // Also dispatch global resize event for any other listeners
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }

  function playLevelReachCinematic(def, onDone) {
    el('lrLevelNum').textContent = def.name;
    el('lrSubtitle').textContent = def.subtitle;
    el('lrFlavor').textContent = (def.hint || '') + '\n\n[ 画面をタップして始める ]';
    showOverlay('levelReachCinematic');
    if (audioInitialized) GameEngine.playSound('stinger');
    var lrOverlay = el('levelReachCinematic');
    var done = false;
    var advance = function () {
      if (done) return;
      done = true;
      lrOverlay.removeEventListener('click', advance);
      lrOverlay.removeEventListener('touchstart', advance);
      lrOverlay.style.pointerEvents = 'none';
      hideOverlay('levelReachCinematic');
      forceCanvasResize();
      onDone();
    };
    lrOverlay.style.pointerEvents = 'auto';
    lrOverlay.addEventListener('click', advance);
    lrOverlay.addEventListener('touchstart', advance);
    // Safety net: auto-advance after 60s in case tap event doesn't reach
    setTimeout(advance, 60000);
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
    // Animate progress bar (matches loading screen duration)
    var bar = el('loadingFill');
    if (bar) {
      bar.style.width = '0%';
      var startTime = performance.now();
      var animate = function () {
        var elapsed = (performance.now() - startTime) / 1100;
        bar.style.width = (Math.min(1, elapsed) * 100) + '%';
        if (elapsed < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  }

  function startPlaying() {
    state = ST.PLAYING;
    // Force canvas resize (fix: top-left only bug after overlays)
    if (GameEngine._resize) GameEngine._resize();
    window.dispatchEvent(new Event('resize'));
    // Show in-game HUD
    el('vitalBars').classList.add('show');
    el('joystickArea').style.display = '';
    el('lookArea').style.display = '';
    el('touchZoneLeft').style.display = '';
    el('touchZoneRight').style.display = '';
    el('phoneBtn').style.display = 'flex';
    el('floorHUD').style.display = '';
    // Inline style:display:none from HTML overrides CSS class. Explicitly clear it.
    el('floatingMapBtn').classList.add('show');
    el('floatingMapBtn').style.display = '';
    el('quickItemBtn').classList.add('show');
    el('quickItemBtn').style.display = '';
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

    // Lv9: dramatic Boss introduction sequence (delayed 5s after entering)
    if (currentLevel === 9 && !unlockedAchievements.defeat_boss) {
      setTimeout(function () { if (state === ST.PLAYING) playBossIntroSequence(); }, 5000);
    }

    // Save automatically on level start (normal mode only)
    if (gameMode === 'normal') saveGame();
  }

  var TUT_HINTS = [
    '左スティックで移動。右スティックで視点を回せ。',
    '同時に動かしてダッシュ。STA を消費する。',
    '黄色いアイテム/ノートを見つけたら 赤ボタンで拾え。',
    '黄色の▲ は出口の目印。近づいて赤ボタンで先へ進む。',
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
      setTimeout(function () { showTutorialStep(step + 1); }, 1200);
    }, 4000);
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
    if (_inCinematic) return;
    // Pause while popup/discovery/note viewer/item modal is shown
    if (_discoveryActive) return;
    var nv = el('noteViewerOverlay');
    if (nv && nv.style.display !== 'none') return;
    var iu = el('itemUseModal');
    if (iu && iu.style.display !== 'none') return;

    var inp = GameEngine.input;
    var sens = 2.5 * (parseInt(localStorage.getItem('bk_sens') || '100', 10) / 100);
    var look = inp.lookDx || 0;
    player.angle += look * sens * dt;
    // Swipe-impulse look: consume accumulated swipe delta this frame
    if (inp.lookImpulse) {
      player.angle += inp.lookImpulse * sens;
      inp.lookImpulse = 0;
    }

    // Movement
    var speed = 130; // pixels per second
    if (player.inWater) speed *= 0.55;
    var sprint = inp.sprint && player.stam > 5;
    if (sprint) speed *= 1.7;
    // Antacid sluggish penalty
    var nowSec = performance.now() / 1000;
    if (player._sluggishUntil && nowSec < player._sluggishUntil) speed *= 0.3;

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
      player.hp = Math.max(0, player.hp - 12 * dt);
      player.san = Math.max(0, player.san - 3 * dt);
      if (Math.random() < 0.04) GameEngine.shakeScreen(3, 0.15);
    }
    if (player.inWater) {
      player.san = Math.max(0, player.san - 0.6 * dt);
    }
    if (player.inSafeZone) {
      player.hp = Math.min(player.hpMax, player.hp + 5 * dt);
      player.san = Math.min(player.sanMax, player.san + 5 * dt);
      unlockAchievement('found_safe_zone');
      // Safe zone visual effect
      if (!player._safeZoneActive) {
        player._safeZoneActive = true;
        var sfe = el('safeZoneEffect');
        sfe.style.display = 'block';
        requestAnimationFrame(function () { sfe.classList.add('active'); });
        if (audioInitialized) GameEngine.playSound('item_get');
        toast('セーフエリア — 回復中');
      }
    } else if (player._safeZoneActive) {
      player._safeZoneActive = false;
      var sfe2 = el('safeZoneEffect');
      sfe2.classList.remove('active');
      setTimeout(function () { sfe2.style.display = 'none'; }, 1200);
    }

    // SAN drain per level (modulated by difficulty) — overall halved for forgiveness
    var theme = THEMES[currentLevelDef.theme];
    var sanDrain = ((theme && theme.sanDrain) || 0.5) * 0.45;
    // Faster if in dark / no flashlight on Level 6 (reduced multiplier)
    if (currentLevel === 6 && !player.flashlightOn) sanDrain *= 1.5;
    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    sanDrain *= diff.sanMul;
    // Endless: scale per floor (slower)
    if (gameMode === 'endless') sanDrain *= (1 + endlessFloor * 0.05);
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
      // Entity-specific death scene
      playEntityDeathScene(killerType);
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
      // Haptic feedback (mobile)
      if (navigator.vibrate) navigator.vibrate(20);
    }

    // Update vitals UI — only when value changed by > 0.5% (perf)
    var hpRatio = player.hp / player.hpMax;
    var sanRatio0 = player.san / player.sanMax;
    var stamRatio = player.stam / player.stamMax;
    if (!player._hudCache) player._hudCache = { hp: -1, san: -1, stam: -1 };
    if (Math.abs(hpRatio - player._hudCache.hp) > 0.005) {
      el('hpFill').style.width = (hpRatio * 100) + '%';
      el('hpFill').classList.toggle('low', hpRatio < 0.25);
      player._hudCache.hp = hpRatio;
    }
    if (Math.abs(sanRatio0 - player._hudCache.san) > 0.005) {
      el('sanFill').style.width = (sanRatio0 * 100) + '%';
      el('sanFill').classList.toggle('low', sanRatio0 < 0.25);
      player._hudCache.san = sanRatio0;
    }
    if (Math.abs(stamRatio - player._hudCache.stam) > 0.005) {
      el('stamFill').style.width = (stamRatio * 100) + '%';
      el('stamFill').classList.toggle('low', stamRatio < 0.2);
      player._hudCache.stam = stamRatio;
    }
    // Numeric vital display
    if (el('hpNum')) el('hpNum').textContent = Math.ceil(player.hp);
    if (el('sanNum')) el('sanNum').textContent = Math.ceil(player.san);
    if (el('stamNum')) el('stamNum').textContent = Math.ceil(player.stam);

    // HP/SAN screen state effects
    var hpFx = el('hpScreenEffect');
    if (hpFx) {
      if (hpRatio < 0.15) {
        hpFx.style.display = 'block';
        hpFx.classList.add('critical');
        hpFx.classList.remove('warn');
      } else if (hpRatio < 0.35) {
        hpFx.style.display = 'block';
        hpFx.classList.add('warn');
        hpFx.classList.remove('critical');
      } else {
        hpFx.style.display = 'none';
        hpFx.classList.remove('warn', 'critical');
      }
    }
    var sanFx = el('sanScreenEffect');
    if (sanFx) {
      if (sanRatio0 < 0.15) {
        sanFx.style.display = 'block';
        sanFx.classList.add('critical');
        sanFx.classList.remove('warn');
      } else if (sanRatio0 < 0.4) {
        sanFx.style.display = 'block';
        sanFx.classList.add('warn');
        sanFx.classList.remove('critical');
      } else {
        sanFx.style.display = 'none';
        sanFx.classList.remove('warn', 'critical');
      }
    }
    // Update floating map (if visible)
    if (floatingMapOpen) drawFloatingMap();

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
    if (gfxQuality === 'low') {
      GameEngine.vignetteIntensity = 0.15 + (1 - sanRatio) * 0.15;
      GameEngine.chromaticLevel = 0;
      GameEngine.grainIntensity = 0.05;
    } else {
      GameEngine.vignetteIntensity = (theme.vignette || 0.3) + (1 - sanRatio) * 0.4 + harukiNear * 0.3;
      GameEngine.chromaticLevel = (theme.chromatic || 0) + (1 - sanRatio) * 0.4 + harukiNear * 0.4;
      GameEngine.grainIntensity = (theme.grain || 0.3) + (1 - sanRatio) * 0.2 + harukiNear * 0.2;
    }

    // SAN whisper on low SAN
    if (sanRatio < 0.4 && Math.random() < 0.0015 && audioInitialized) {
      GameEngine.playSound('whisper');
    }

    // Level-specific dynamic events
    if (currentLevel === 7) {
      // Lv7 Run For Your Life — progressive escalation text based on progress
      if (!player._lv7Progress) player._lv7Progress = 0;
      var pgY7 = player.y / TS;
      var newProgress7 = 0;
      if (pgY7 > 5) newProgress7 = 1;
      if (pgY7 > 10) newProgress7 = 2;
      if (pgY7 > 15) newProgress7 = 3;
      if (pgY7 > 20) newProgress7 = 4;
      if (newProgress7 > player._lv7Progress) {
        player._lv7Progress = newProgress7;
        var lv7Lines = ['', '走れ。', '振り返るな。', 'まだ追ってくる。', 'もう少しだ。'];
        var hudObj7 = el('objectiveHUD');
        if (hudObj7 && lv7Lines[newProgress7]) {
          hudObj7.style.display = 'block';
          el('objectiveText').textContent = lv7Lines[newProgress7];
          setTimeout(function () { hudObj7.style.display = 'none'; }, 2400);
          if (audioInitialized) GameEngine.playSound('whisper');
        }
      }
    } else if (currentLevel === 3) {
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
      // End of the Line: train passes — cinematic with slow-down + flash
      player._trainTimer = (player._trainTimer || 0) - dt;
      if (player._trainTimer <= 0) {
        player._trainTimer = 18 + Math.random() * 16;
        if (Math.random() < 0.55) {
          // Distant rumble first
          if (audioInitialized) {
            GameEngine.playSound('thunder');
            setTimeout(function () { if (audioInitialized) GameEngine.playSound('thunder'); }, 800);
          }
          // 1.5s build-up, then full pass
          var hudObj11 = el('objectiveHUD');
          if (hudObj11) {
            hudObj11.style.display = 'block';
            el('objectiveText').textContent = '列車が来る...';
            setTimeout(function () { hudObj11.style.display = 'none'; }, 1800);
          }
          setTimeout(function () {
            GameEngine.shakeScreen(22, 2.5);
            GameEngine.flashImage(null, 100); // brief white flash
            GameEngine.redFlash();
            if (audioInitialized) GameEngine.playSound('static');
          }, 1500);
        }
      }
    } else if (currentLevel === 12) {
      // Fun =): periodic confetti / party effect
      if (Math.random() < 0.02) {
        var pAng2 = Math.random() * Math.PI * 2;
        GameEngine.addParticle('spark', player.x + Math.cos(pAng2) * 100, player.y + Math.sin(pAng2) * 100);
      }
    }

    // Multi-tier threat detection + nearest threat tracking for HUD compass
    var isBeingChased = false;
    var threatLevel = 0; // 0 = safe, 1 = uneasy, 2 = hunted, 3 = critical
    var nearestThreat = null;
    var nearestThreatDist = Infinity;
    for (var ceI = 0; ceI < entities.length; ceI++) {
      var ce = entities[ceI];
      if (!ce.alive) continue;
      var ceDx = ce.x - player.x, ceDy = ce.y - player.y;
      var ceD = Math.sqrt(ceDx * ceDx + ceDy * ceDy);
      if (ceD > 14 * TS) continue;
      // Awareness (uneasy)
      if (ceD < 14 * TS) threatLevel = Math.max(threatLevel, 1);
      if (ceD < 7 * TS) threatLevel = Math.max(threatLevel, 2);
      if (ceD < 3 * TS) threatLevel = Math.max(threatLevel, 3);
      if (ceD < nearestThreatDist) {
        nearestThreatDist = ceD;
        nearestThreat = ce;
      }
      // Entity-specific chase trigger
      if (ce.type === 'hound' && ce.state === 'chase') isBeingChased = true;
      else if (ce.type === 'skinstealer' && ce.state === 'reveal') isBeingChased = true;
      else if (ce.type === 'partygoer' && ceD < 4 * TS) isBeingChased = true;
      else if (ce.type === 'crawler' && ce.state === 'lunge') isBeingChased = true;
      else if (ce.type === 'haruki' && (ce.state === 'hunting' || ce.state === 'approach')) isBeingChased = true;
      else if (ce.type === 'boss' && ceD < 6 * TS) isBeingChased = true;
      else if (ce.type === 'mrhotel' && ceD < 4 * TS) isBeingChased = true;
      else if (ce.type === 'echo' && ceD < 3 * TS) isBeingChased = true;
    }
    // Cache for renderer to draw directional indicator
    player._nearestThreat = nearestThreat;
    player._nearestThreatDist = nearestThreatDist;
    player._threatLevel = threatLevel;

    // Low-SAN hallucination layer: activate when SAN < 35%, intensify below 15%
    var sanRatio = player.san / player.sanMax;
    var hLayer = el('hallucinationLayer');
    if (hLayer) {
      if (sanRatio < 0.35 && state === ST.PLAYING) {
        if (hLayer.style.display === 'none') hLayer.style.display = 'block';
        // Periodic text whisper flash
        player._hallucTextTimer = (player._hallucTextTimer || 0) - (1 / 60);
        if (player._hallucTextTimer <= 0) {
          var interval = sanRatio < 0.15 ? 6 + Math.random() * 4 : 12 + Math.random() * 8;
          player._hallucTextTimer = interval;
          var msgs = ['見ているぞ', 'もう逃げられない', 'こっちだ', 'カレが来る', 'まだここにいる', '振り向くな'];
          var txt = el('hallucText');
          if (txt) {
            txt.textContent = msgs[Math.floor(Math.random() * msgs.length)];
            txt.classList.remove('show');
            void txt.offsetWidth; // restart animation
            txt.classList.add('show');
          }
        }
      } else {
        if (hLayer.style.display !== 'none') hLayer.style.display = 'none';
      }
    }

    // Spatial audio cue: occasional positional whisper/breath from nearest threat
    if (audioInitialized && nearestThreat && typeof GameEngine.playPositional === 'function') {
      player._spatialCueTimer = (player._spatialCueTimer || 0) - (1 / 60);
      if (player._spatialCueTimer <= 0) {
        // Interval scales with proximity: 6s far, 1.5s very close
        var prox = Math.max(0, 1 - nearestThreatDist / (14 * TS));
        player._spatialCueTimer = 6 - prox * 4.5 + Math.random() * 1.5;
        var dx2 = nearestThreat.x - player.x;
        var dy2 = nearestThreat.y - player.y;
        var worldA = Math.atan2(dy2, dx2);
        var relA = worldA - player.angle;
        while (relA > Math.PI) relA -= Math.PI * 2;
        while (relA < -Math.PI) relA += Math.PI * 2;
        // Pan: relA -PI/2 = full left, +PI/2 = full right, 0 = front (no pan)
        // Behind: also no pan but slightly muffled.
        var pan = Math.max(-1, Math.min(1, Math.sin(relA)));
        var vol = 0.15 + prox * 0.35;
        // Tone by threat tier
        var tone = 'breath';
        if (threatLevel >= 3) tone = 'scrape';
        else if (threatLevel === 1 && Math.random() < 0.4) tone = 'tap';
        try { GameEngine.playPositional(tone, pan, vol); } catch (e) {}
      }
    }
    // Apply BGM layer adjustments by threat level (live blending)
    if (audioInitialized && typeof GameEngine.setBGMLayers === 'function') {
      try {
        var droneG = 0.06;
        var dissG = threatLevel * 0.08;
        var pulseG = isBeingChased ? 0.5 : threatLevel * 0.08;
        GameEngine.setBGMLayers({ drone: droneG, dissonance: dissG, pulse: pulseG });
      } catch (e) { /* ignore */ }
    }
    // BGM transition (chase only)
    if (audioInitialized && isBeingChased !== player._beingChased) {
      player._beingChased = isBeingChased;
      if (isBeingChased) {
        if (currentBgm) GameEngine.stopLoop(currentBgm);
        GameEngine.startLoop('chase');
        if (navigator.vibrate) navigator.vibrate(40);
      } else {
        GameEngine.stopLoop('chase');
        if (currentBgm) GameEngine.startLoop(currentBgm);
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

    // Always show danger indicator with intensity based on proximity
    if (nearestDist < 12 * TS) {
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

    // Intensity scales with proximity (1.0 at 0 distance, 0 at 12 TS)
    var proxRatio = Math.max(0, 1 - dist / (12 * TS));
    el('dangerIndicator').style.display = 'block';
    el('dangerIndicator').style.opacity = (0.3 + proxRatio * 0.7);
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
    // Only persist run save in normal mode (avoid endless mode polluting normal save)
    if (gameMode === 'normal') saveGame();
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
      var ln = localStorage.getItem('thebackrooms_lifetime_notes_v1');
      if (ln) lifetimeNoteTitles = JSON.parse(ln) || {};
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
    endlessFloor = 1;
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

  function applyGfxQuality() {
    if (gfxQuality === 'low') {
      // Reduce post-effects globally
      GameEngine.grainIntensity = 0.05;
      GameEngine.chromaticLevel = 0;
      GameEngine.vignetteIntensity = 0.15;
      // Set engine to low-quality raycasting (strip width 3)
      if (GameEngine.theme) GameEngine.theme.lowQuality = true;
    } else {
      if (GameEngine.theme) GameEngine.theme.lowQuality = false;
    }
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

  // Item use custom modal
  var _pendingItemId = null;
  function openItemUseModal(itemId) {
    var it = ITEMS[itemId];
    if (!it) return;
    _pendingItemId = itemId;
    el('itemUseIcon').textContent = it.icon;
    el('itemUseName').textContent = it.name;
    el('itemUseDesc').textContent = it.desc;
    showOverlay('itemUseModal');
  }
  function closeItemUseModal() {
    _pendingItemId = null;
    hideOverlay('itemUseModal');
  }
  function confirmItemUse() {
    if (!_pendingItemId) return;
    var itemId = _pendingItemId;
    var it = ITEMS[itemId];
    if (!it) { closeItemUseModal(); return; }
    // Guard against wasting items where they have no effect
    if (itemId === 'almond_water' && player.san >= player.sanMax) {
      toast('SAN は既に満タン — 使用しない');
      closeItemUseModal();
      return;
    }
    if (itemId === 'bandage' && player.hp >= player.hpMax) {
      toast('HP は既に満タン — 使用しない');
      closeItemUseModal();
      return;
    }
    if (itemId === 'energy_bar' && player.stam >= player.stamMax) {
      toast('スタミナ満タン — 使用しない');
      closeItemUseModal();
      return;
    }
    if (itemId === 'almond_milk' && player.hp >= player.hpMax && player.san >= player.sanMax && player.stam >= player.stamMax) {
      toast('全ステータス満タン — 使用しない');
      closeItemUseModal();
      return;
    }
    if (itemId === 'mirror') {
      // Only allow if Skin-Stealer or Boss within range
      var hasTarget = false;
      for (var mi = 0; mi < entities.length; mi++) {
        if (!entities[mi].alive) continue;
        if (entities[mi].type !== 'skinstealer' && entities[mi].type !== 'boss') continue;
        var mdx = entities[mi].x - player.x, mdy = entities[mi].y - player.y;
        if (Math.sqrt(mdx * mdx + mdy * mdy) < 8 * TS) { hasTarget = true; break; }
      }
      if (!hasTarget) {
        toast('鏡: 対象がいない (Skin-Stealer / Boss 8マス以内)');
        closeItemUseModal();
        return;
      }
    }
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
    if (navigator.vibrate) navigator.vibrate(30);
    closeItemUseModal();
    refreshPhoneUI();
  }

  function openMiniGame(id) {
    var def = MINI_GAMES[id];
    if (!def) return;
    miniGameOpen = true;
    currentMiniGame = id;
    el('minigameTitle').textContent = def.title;
    el('minigameSubtitle').textContent = def.subtitle;
    showOverlay('minigameOverlay');
    // Hide phone button during mini-game (avoid stacking conflict)
    el('phoneBtn').style.display = 'none';
    def.init();
  }

  function closeMiniGame() {
    miniGameOpen = false;
    currentMiniGame = null;
    mgState = null;
    hideOverlay('minigameOverlay');
    // Restore phone button (only if still playing)
    if (state === ST.PLAYING) el('phoneBtn').style.display = 'flex';
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

    // Note spot — only if not already read on this run
    if (noteSpots[key] && !(readNotes[currentLevel] && readNotes[currentLevel][key])) {
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

  function playBossIntroSequence() {
    // Sequence: silence → deep rumble → red flash → encounter cinematic
    _inCinematic = true;
    if (audioInitialized) {
      GameEngine.stopAll();
      GameEngine.playSound('thunder');
    }
    // Phase 1: 1.5s silent with red tint
    GameEngine.redFlash();
    setTimeout(function () {
      // Phase 2: stinger + heavy shake
      if (audioInitialized) {
        GameEngine.playSound('stinger');
        GameEngine.playSound('scream');
      }
      GameEngine.shakeScreen(25, 1.5);
      GameEngine.staticEffect(0.7);
      setTimeout(function () { GameEngine.staticEffect(0); }, 1200);
    }, 1500);
    // Phase 3: encounter cinematic (using existing system)
    setTimeout(function () {
      _inCinematic = false;
      var intro = ENTITY_INTROS.boss;
      el('encounterShape').textContent = '👑';
      el('encounterName').textContent = intro.name;
      el('encounterDesc').textContent = intro.desc + '\n\n— 用意できたら扉を探せ。';
      showOverlay('encounterCinematic');
      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
      setTimeout(function () {
        hideOverlay('encounterCinematic');
        // Resume ambient/BGM
        var theme = THEMES[currentLevelDef.theme];
        if (theme.ambientLoop && audioInitialized) GameEngine.startLoop(theme.ambientLoop);
        if (theme.bgmLoop && audioInitialized) GameEngine.startLoop(theme.bgmLoop);
      }, 4500);
    }, 3200);
  }

  function playEntityDeathScene(killerType) {
    // Per-entity dramatic death visual
    if (killerType === 'haruki') {
      var hImg = GameEngine.images['assets/img/haruki_scary.png'] || GameEngine.images['assets/img/haruki.png'];
      if (hImg) GameEngine.flashImage(hImg, 1000);
      if (audioInitialized) GameEngine.playSound('jumpscare');
      GameEngine.redFlash();
      GameEngine.shakeScreen(20, 0.8);
    } else if (killerType === 'hound') {
      GameEngine.redFlash();
      GameEngine.shakeScreen(18, 0.6);
      if (audioInitialized) {
        GameEngine.playSound('scream');
        GameEngine.playSound('hit');
      }
    } else if (killerType === 'smiler') {
      // Eerie smile zoom
      if (audioInitialized) {
        GameEngine.playSound('lullaby');
        GameEngine.playSound('whisper');
      }
      GameEngine.staticEffect(0.8);
      setTimeout(function () { GameEngine.staticEffect(0); }, 1500);
    } else if (killerType === 'skinstealer') {
      // Skin-stealing — static + jumpscare
      if (audioInitialized) {
        GameEngine.playSound('static');
        GameEngine.playSound('jumpscare');
      }
      GameEngine.shakeScreen(15, 1.2);
      GameEngine.staticEffect(1);
      setTimeout(function () { GameEngine.staticEffect(0); }, 1800);
    } else if (killerType === 'partygoer') {
      // Ironic party celebration
      if (audioInitialized) {
        GameEngine.playSound('phone');
        GameEngine.playSound('jumpscare');
      }
      GameEngine.redFlash();
      GameEngine.shakeScreen(10, 0.8);
    } else if (killerType === 'crawler') {
      if (audioInitialized) {
        GameEngine.playSound('knock');
        GameEngine.playSound('scream_short');
      }
      GameEngine.shakeScreen(22, 0.7);
    } else if (killerType === 'wretch') {
      if (audioInitialized) {
        GameEngine.playSound('tinnitus');
        GameEngine.playSound('whisper');
      }
      GameEngine.staticEffect(0.6);
      setTimeout(function () { GameEngine.staticEffect(0); }, 1200);
    } else if (killerType === 'boss') {
      // Architect — dramatic
      if (audioInitialized) {
        GameEngine.playSound('stinger');
        GameEngine.playSound('thunder');
        GameEngine.playSound('scream');
      }
      GameEngine.redFlash();
      GameEngine.shakeScreen(30, 1.5);
    } else if (killerType === 'mrhotel') {
      if (audioInitialized) {
        GameEngine.playSound('clock_tick');
        GameEngine.playSound('jumpscare');
      }
      GameEngine.shakeScreen(12, 0.8);
    } else if (killerType === 'echo') {
      // Hauntingly silent — just static
      GameEngine.staticEffect(0.9);
      if (audioInitialized) GameEngine.playSound('whisper');
      setTimeout(function () { GameEngine.staticEffect(0); }, 1500);
    } else {
      // Default
      GameEngine.redFlash();
      GameEngine.shakeScreen(10, 0.5);
    }
  }

  function pickUpItem(itemId, gx, gy) {
    var item = ITEMS[itemId];
    if (!item) return;
    player.inventory[itemId] = (player.inventory[itemId] || 0) + 1;
    if (!pickedUpItems[currentLevel]) pickedUpItems[currentLevel] = {};
    pickedUpItems[currentLevel][gridKey(gx, gy)] = true;
    delete pickupSpots[gridKey(gx, gy)];
    showDiscovery(item.icon, 'アイテム入手', item.name);
    if (audioInitialized) GameEngine.playSound('item_get');
    if (navigator.vibrate) navigator.vibrate(20);
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
    var isNew = !readNotes[currentLevel][gridKey(gx, gy)];
    if (isNew) {
      discoveredNotes.push({
        levelId: currentLevel,
        title: note.title,
        text: note.text
      });
      readNotes[currentLevel][gridKey(gx, gy)] = true;
      stats.totalNotesRead++;
      saveStats();
    }
    // Lifetime unique-title tracking
    if (!lifetimeNoteTitles[note.title]) {
      lifetimeNoteTitles[note.title] = true;
      try { localStorage.setItem('thebackrooms_lifetime_notes_v1', JSON.stringify(lifetimeNoteTitles)); } catch (e) {}
    }
    if (isNew) showDiscovery('📄', 'ノート発見', note.title);
    showNoteViewer(note.title, note.text);
    if (audioInitialized) GameEngine.playSound('paper');
    if (navigator.vibrate) navigator.vibrate(15);
  }

  function showNoteViewer(title, text) {
    el('noteTitle').textContent = title;
    el('noteText').textContent = text;
    showOverlay('noteViewerOverlay');
  }

  function tryNoClip() {
    if (player._noClipping) return; // prevent rapid-tap re-entry
    player._noClipping = true;
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
    haruki: { sound: 'phone', prob: 0.005 },
    echo: { sound: 'whisper', prob: 0.008 },
    faceling: { sound: 'whisper', prob: 0.005 }
  };

  function updateEntities(dt) {
    if (state !== ST.PLAYING) return;
    if (phoneOpen) return;
    if (miniGameOpen) return;
    if (_inCinematic) return;
    if (_discoveryActive) return;
    var nv2 = el('noteViewerOverlay');
    if (nv2 && nv2.style.display !== 'none') return;
    var iu2 = el('itemUseModal');
    if (iu2 && iu2.style.display !== 'none') return;
    var diffE = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    var sMul = diffE.enemySpeedMul;

    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.alive) continue;
      e.stateTimer += dt;

      // First-encounter cinematic
      if (!entitySeenTypes[e.type] && ENTITY_INTROS[e.type]) {
        var fcDx = e.x - player.x, fcDy = e.y - player.y;
        var fcD = Math.sqrt(fcDx * fcDx + fcDy * fcDy);
        if (fcD < 8 * TS) {
          entitySeenTypes[e.type] = true;
          saveStats();
          if (e.type === 'haruki') unlockAchievement('encounter_haruki');
          playEncounterCinematic(e.type);
          return; // stop processing all entities this frame
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
        // Check if player is in safe zone — Hound can't approach
        var pTileX = Math.floor(player.x / TS);
        var pTileY = Math.floor(player.y / TS);
        var pTile = currentMap.tiles[pTileY] && currentMap.tiles[pTileY][pTileX];
        var playerInSafe = (pTile === 11);
        // Aggressive chaser. Triggers ONLY when player sprints near AND not in safe.
        // Walking quietly does NOT provoke a chase.
        if (!playerInSafe && distP < 4 * TS && (GameEngine.input.sprint || e.state === 'chase')) {
          e.state = 'chase';
          var spd = 90 * sMul;
          var stepX = (dx / distP) * spd * dt;
          var stepY = (dy / distP) * spd * dt;
          // Check next position is NOT safe tile (Hound avoids)
          var nx = e.x + stepX;
          var ny = e.y + stepY;
          var checkSafe = function (cx, cy) {
            var ctx_x = Math.floor(cx / TS);
            var cty = Math.floor(cy / TS);
            if (cty < 0 || cty >= currentMap.height || ctx_x < 0 || ctx_x >= currentMap.width) return true;
            return currentMap.tiles[cty][ctx_x] === 11;
          };
          if (isWalkable(nx, e.y) && !checkSafe(nx, e.y)) e.x = nx;
          if (isWalkable(e.x, ny) && !checkSafe(e.x, ny)) e.y = ny;
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
          if (isFacingPlayer(e)) player.san = Math.max(0, player.san - 3 * dt);
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
          player.san = Math.max(0, player.san - 7);
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
        // Gaze-lock mechanic: WRETCH only drains SAN when player LOOKS AT it
        // Check if player is facing entity (entity is in player's FOV cone)
        var pAngleToE = Math.atan2(dy, dx);
        var relAngle = pAngleToE - player.angle;
        while (relAngle > Math.PI) relAngle -= Math.PI * 2;
        while (relAngle < -Math.PI) relAngle += Math.PI * 2;
        var playerLooksAtIt = Math.abs(relAngle) < Math.PI / 5; // within ~36° cone
        e._wretchGazed = playerLooksAtIt && distP < 10 * TS;
        if (e._wretchGazed) {
          // Player sees WRETCH — chest opens, moderate SAN drain
          player.san = Math.max(0, player.san - 5 * dt);
          if (Math.random() < 0.06 && audioInitialized) GameEngine.playSound('whisper');
          if (Math.random() < 0.01 && audioInitialized) GameEngine.playSound('tinnitus');
        } else if (distP < 8 * TS) {
          // Player doesn't look — mild SAN drain (subconscious dread)
          player.san = Math.max(0, player.san - 0.5 * dt);
        }
        // Direct contact damages
        if (distP < 0.8 * TS) attackPlayer(8 * dt);
      } else if (e.type === 'echo') {
        // ECHO: mimics player's exact movement, delayed by 0.6 seconds
        // Records player position history; replays as own movement
        if (!e._posHistory) e._posHistory = [];
        e._posHistory.push({ x: player.x, y: player.y, t: performance.now() / 1000 });
        // Trim history older than 1.5s
        while (e._posHistory.length > 0 && performance.now() / 1000 - e._posHistory[0].t > 1.5) {
          e._posHistory.shift();
        }
        // Find target position from 0.6s ago
        var delaySec = 0.6;
        var targetT = performance.now() / 1000 - delaySec;
        var targetPos = null;
        for (var phi = 0; phi < e._posHistory.length; phi++) {
          if (e._posHistory[phi].t >= targetT) { targetPos = e._posHistory[phi]; break; }
        }
        if (targetPos) {
          // Apply offset (e initial position remembered)
          if (!e._initOffsetX && e._initOffsetX !== 0) {
            // record initial offset between e and player
            e._initOffsetX = e.x - player.x;
            e._initOffsetY = e.y - player.y;
          }
          var tgtX = targetPos.x + e._initOffsetX;
          var tgtY = targetPos.y + e._initOffsetY;
          var ex = e.x + (tgtX - e.x) * Math.min(1, 4 * dt);
          var ey = e.y + (tgtY - e.y) * Math.min(1, 4 * dt);
          if (isWalkable(ex, e.y)) e.x = ex;
          if (isWalkable(e.x, ey)) e.y = ey;
        }
        // SAN drain when very close (uncanny valley effect — reduced)
        if (distP < 3 * TS) {
          player.san = Math.max(0, player.san - 1.2 * dt);
          if (Math.random() < 0.02 && audioInitialized) GameEngine.playPositionalSound('whisper', e.x, e.y);
        }
        if (distP < 0.8 * TS) attackPlayer(6 * dt);
      } else if (e.type === 'mrhotel') {
        // Stationary at first, slowly approaches when player nearby
        if (distP < 12 * TS) {
          if (distP < 4 * TS) player.san = Math.max(0, player.san - 2.5 * dt);
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
        // HARUKI 3-phase tracking:
        //  Phase 1 (>12 TS): 遠い - phone bell only, wanders slowly
        //  Phase 2 (6-12 TS): 視認 - approaches with female humming
        //  Phase 3 (<6 TS): 接触寸前 - sprint speed, breath/whisper, jumpscare risk
        var harPhase = 1;
        if (distP < 12 * TS) harPhase = 2;
        if (distP < 6 * TS) harPhase = 3;
        e._harPhase = harPhase;

        if (harPhase === 1) {
          // Phase 1: wander slowly, distant phone bell
          e.state = 'distant';
          wanderEntity(e, dt, 28 * sMul);
          if (Math.random() < 0.003 && audioInitialized) {
            GameEngine.playPositionalSound('phone', e.x, e.y);
          }
        } else if (harPhase === 2) {
          // Phase 2: approaching
          e.state = 'approach';
          var spdP2 = 50 * sMul;
          var p2x = (dx / distP) * spdP2 * dt;
          var p2y = (dy / distP) * spdP2 * dt;
          if (isWalkable(e.x + p2x, e.y)) e.x += p2x;
          if (isWalkable(e.x, e.y + p2y)) e.y += p2y;
          if (Math.random() < 0.005 && audioInitialized) {
            GameEngine.playPositionalSound('lullaby', e.x, e.y);
          }
          // Mild SAN drain
          player.san = Math.max(0, player.san - 0.6 * dt);
        } else {
          // Phase 3: hunting close
          e.state = 'hunting';
          var spdP3 = 85 * sMul;
          var p3x = (dx / distP) * spdP3 * dt;
          var p3y = (dy / distP) * spdP3 * dt;
          if (isWalkable(e.x + p3x, e.y)) e.x += p3x;
          if (isWalkable(e.x, e.y + p3y)) e.y += p3y;
          // Continuous SAN drain (reduced)
          player.san = Math.max(0, player.san - 2 * dt);
          // Breath/whisper sounds
          if (Math.random() < 0.012 && audioInitialized) {
            GameEngine.playPositionalSound('whisper', e.x, e.y);
          }
          if (Math.random() < 0.006 && audioInitialized) {
            GameEngine.playPositionalSound('breath', e.x, e.y);
          }
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
    var prevHp = player.hp;
    player.hp = Math.max(0, player.hp - dmg);
    // Always provide damage feedback: red flash + shake + sound
    GameEngine.redFlash();
    if (navigator.vibrate) navigator.vibrate(40);
    if (dmg > 0.5) {
      GameEngine.shakeScreen(Math.min(20, dmg * 30), Math.min(0.4, dmg * 1.5));
      if (audioInitialized && Math.random() < 0.5) GameEngine.playSound('hit');
    }
    // Scream/grunt on heavier hits
    if (audioInitialized) {
      if (dmg > 0.15 && Math.random() < 0.4) {
        GameEngine.playSound('scream_short');
      }
    }
    // Critical scream when about to die
    if (prevHp > player.hpMax * 0.2 && player.hp <= player.hpMax * 0.2) {
      if (audioInitialized) GameEngine.playSound('scream');
    }
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
    // Standard raycaster sprite projection — fix from engine bug (swapped tX/tY)
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    var tX = -dx * sinT + dy * cosT;   // lateral (right positive)
    var tY = dx * cosT + dy * sinT;    // depth (forward positive)
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

    // Subtle breathing oscillation per entity (low CPU cost — single sin per frame)
    var breath = Math.sin((performance.now() + (e._breathPhase || (e._breathPhase = Math.random() * 6.28))) * 0.003) * 0.012;
    var pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008 + (e._eyePhase || (e._eyePhase = Math.random() * 6.28)));

    // Per-type shape drawing
    if (e.type === 'hound') {
      // Realistic quadruped: humanoid head + dog body
      // Apply breathing scale to body
      var breathScale = 1 + breath;
      // 1) Body (lower 55%)
      var bodyY = startY + spriteH * 0.45;
      var bodyH = spriteH * 0.4 * breathScale;
      var bodyW = spriteW * 0.7;
      var bodyX = screenX - bodyW / 2;
      drawShapedSprite(ctx, bodyX, bodyY, bodyW, bodyH, screenX, depthTiles, zBuf, w,
        '#3a1f10', '#180a05');
      // 2) Head (humanoid, upper portion)
      var headH = spriteH * 0.4;
      var headW = spriteW * 0.55;
      var headX = screenX - headW / 2;
      var headY = startY + spriteH * 0.1;
      drawShapedSprite(ctx, headX, headY, headW, headH, screenX, depthTiles, zBuf, w,
        '#5a3220', '#2a1810');
      // 3) Snout (extends forward — thin rect at bottom of head)
      var snoutH = spriteH * 0.08;
      var snoutW = spriteW * 0.3;
      var snoutX = screenX - snoutW / 2;
      var snoutY = headY + headH * 0.65;
      ctx.fillStyle = 'rgba(35,18,8,' + fogFactor + ')';
      for (var snc = Math.floor(snoutX); snc < snoutX + snoutW; snc++) {
        if (snc < 0 || snc >= w) continue;
        if (zBuf[snc] > depthTiles) ctx.fillRect(snc, snoutY, 1, snoutH);
      }
      // 4) Teeth (white, smaller than snout)
      ctx.fillStyle = 'rgba(220,210,190,' + fogFactor + ')';
      var teethY = snoutY + snoutH * 0.4;
      var teethW = snoutW * 0.7;
      var teethStart = screenX - teethW / 2;
      for (var ttc = Math.floor(teethStart); ttc < teethStart + teethW; ttc++) {
        if (ttc < 0 || ttc >= w) continue;
        if (zBuf[ttc] > depthTiles && ((ttc - Math.floor(teethStart)) % 3 < 2)) {
          ctx.fillRect(ttc, teethY, 1, snoutH * 0.5);
        }
      }
      // 5) Glowing red eyes (large) — eye glow pulses with breathing
      var eyeY = headY + headH * 0.32;
      var eyeSize = Math.max(2, spriteH * 0.035) * (1 + pulse * 0.3);
      // Eye glow with pulse
      var eyeCol = Math.round(screenX);
      if (eyeCol >= 0 && eyeCol < w && zBuf[eyeCol] > depthTiles) {
        var eyeGlowR = spriteW * 0.15 * (1 + pulse * 0.35);
        var eGrad = ctx.createRadialGradient(screenX, eyeY, 0, screenX, eyeY, eyeGlowR);
        var pulseG = 0.5 + pulse * 0.4;
        eGrad.addColorStop(0, 'rgba(255,30,30,' + pulseG + ')');
        eGrad.addColorStop(0.5, 'rgba(180,0,0,' + (pulseG * 0.5) + ')');
        eGrad.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = eGrad;
        ctx.fillRect(screenX - eyeGlowR, eyeY - eyeGlowR, eyeGlowR * 2, eyeGlowR * 2);
      }
      ctx.fillStyle = 'rgba(255,30,30,' + fogFactor + ')';
      drawSpriteDot(ctx, screenX - spriteW * 0.13, eyeY, eyeSize, zBuf, w, depthTiles);
      drawSpriteDot(ctx, screenX + spriteW * 0.13, eyeY, eyeSize, zBuf, w, depthTiles);
      // Iris glow (inner white)
      ctx.fillStyle = 'rgba(255,200,80,' + (fogFactor * 0.7) + ')';
      drawSpriteDot(ctx, screenX - spriteW * 0.13, eyeY, eyeSize * 0.4, zBuf, w, depthTiles);
      drawSpriteDot(ctx, screenX + spriteW * 0.13, eyeY, eyeSize * 0.4, zBuf, w, depthTiles);
      // 6) Legs (4 vertical lines below body)
      ctx.strokeStyle = 'rgba(25,12,5,' + fogFactor + ')';
      ctx.lineWidth = Math.max(1.5, spriteH * 0.015);
      for (var lg = 0; lg < 4; lg++) {
        var lgX = screenX + (lg - 1.5) * bodyW * 0.18;
        var lgCol = Math.round(lgX);
        if (lgCol < 0 || lgCol >= w) continue;
        if (zBuf[lgCol] > depthTiles) {
          ctx.beginPath();
          ctx.moveTo(lgX, bodyY + bodyH * 0.9);
          ctx.lineTo(lgX + (lg < 2 ? -3 : 3), bodyY + bodyH + spriteH * 0.13);
          ctx.stroke();
        }
      }
      // 7) Ears (peaked at top of head)
      ctx.fillStyle = 'rgba(30,15,8,' + fogFactor + ')';
      var earCol1 = Math.round(screenX - spriteW * 0.18);
      var earCol2 = Math.round(screenX + spriteW * 0.18);
      [earCol1, earCol2].forEach(function (ec) {
        if (ec < 0 || ec >= w) return;
        if (zBuf[ec] > depthTiles) {
          ctx.beginPath();
          ctx.moveTo(ec, headY + 2);
          ctx.lineTo(ec - 4, headY - spriteH * 0.06);
          ctx.lineTo(ec + 4, headY - spriteH * 0.06);
          ctx.closePath();
          ctx.fill();
        }
      });
    } else if (e.type === 'smiler') {
      // Floating smile in darkness — only teeth visible
      var smileY = startY + spriteH * 0.45;
      var smileW = spriteW * 0.4;
      var smileH = spriteH * 0.08;
      var sStartX = screenX - smileW / 2;
      // Glow — only if center column visible (avoid showing through walls)
      var smilerCenterCol = Math.round(screenX);
      var smilerCenterVisible = smilerCenterCol >= 0 && smilerCenterCol < w && zBuf[smilerCenterCol] > depthTiles;
      if (smilerCenterVisible) {
        var gradRad = spriteW * 0.4;
        var grad = ctx.createRadialGradient(screenX, smileY, 0, screenX, smileY, gradRad);
        grad.addColorStop(0, 'rgba(220,220,220,' + (0.3 * fogFactor) + ')');
        grad.addColorStop(1, 'rgba(220,220,220,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(screenX - gradRad, smileY - gradRad, gradRad * 2, gradRad * 2);
      }
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
      // Big creepy smile (per-column z-buffer)
      ctx.fillStyle = 'rgba(180,40,40,' + fogFactor + ')';
      var pgFaceY = pgY + pgH * 0.18;
      var pgSmileW = pgW * 0.5;
      var pgSmileH = Math.max(1, pgH * 0.04);
      var pgSmileStart = Math.max(0, Math.floor(screenX - pgSmileW / 2));
      var pgSmileEnd = Math.min(w, Math.ceil(screenX + pgSmileW / 2));
      for (var psc = pgSmileStart; psc < pgSmileEnd; psc++) {
        if (zBuf[psc] > depthTiles) ctx.fillRect(psc, pgFaceY, 1, pgSmileH);
      }
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
      // Hollow chest cavity (pulsing) — per-column z-buffer
      var pulse = 0.5 + Math.sin(performance.now() * 0.004) * 0.5;
      var chestY = wrY + wrH * 0.35;
      var chestSize = spriteW * 0.15;
      ctx.fillStyle = 'rgba(' + (100 + 80 * pulse) + ',30,30,' + fogFactor + ')';
      // Sample columns across chest width
      var chStart = Math.max(0, Math.floor(screenX - chestSize));
      var chEnd = Math.min(w, Math.ceil(screenX + chestSize));
      // Use clip path of visible columns + draw ellipse
      var anyVisible = false;
      for (var chc = chStart; chc < chEnd; chc++) {
        if (zBuf[chc] > depthTiles) { anyVisible = true; break; }
      }
      if (anyVisible) {
        ctx.save();
        ctx.beginPath();
        for (var chc2 = chStart; chc2 < chEnd; chc2++) {
          if (zBuf[chc2] > depthTiles) ctx.rect(chc2, chestY - chestSize * 1.3, 1, chestSize * 2.6);
        }
        ctx.clip();
        ctx.beginPath();
        ctx.ellipse(screenX, chestY, chestSize, chestSize * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (e.type === 'haruki') {
      // HARUKI sprite — uses haruki.png head + dark body, with multi-layer enhancement
      var hkSpriteH = spriteH * 1.05;
      var hkSpriteY = startY - spriteH * 0.025;
      var hkBodyW = spriteW * 0.5;
      var hkBodyX = screenX - hkBodyW / 2;

      // Compute visibility ratio (for aura culling — auras only drawn if center + majority visible)
      var auraCenterCol = Math.round(screenX);
      var auraHalfW = Math.floor(hkSpriteH * 0.7);
      var auraVisCount = 0;
      var auraSamples = 9;
      var auraSampleStep = (auraHalfW * 2) / (auraSamples - 1);
      for (var avs = 0; avs < auraSamples; avs++) {
        var avc = Math.min(w - 1, Math.max(0, Math.round(auraCenterCol - auraHalfW + avs * auraSampleStep)));
        if (zBuf[avc] > depthTiles) auraVisCount++;
      }
      // Aura draws only if majority (>60%) visible AND center column visible
      var centerVisible = zBuf[auraCenterCol] && zBuf[auraCenterCol] > depthTiles;
      var auraVisible = centerVisible && auraVisCount >= Math.ceil(auraSamples * 0.6);

      // Pre-aura: large dark red halo (skip if mostly occluded)
      if (depthTiles > 1 && auraVisible) {
        ctx.globalAlpha = Math.min(0.45, fogFactor * 0.6);
        var preAuraR = hkSpriteH * 0.7;
        var preGrad = ctx.createRadialGradient(screenX, hkSpriteY + hkSpriteH * 0.5, 0,
                                                 screenX, hkSpriteY + hkSpriteH * 0.5, preAuraR);
        preGrad.addColorStop(0, 'rgba(180,20,20,0.6)');
        preGrad.addColorStop(0.5, 'rgba(120,10,10,0.3)');
        preGrad.addColorStop(1, 'rgba(80,0,0,0)');
        ctx.fillStyle = preGrad;
        ctx.fillRect(screenX - preAuraR, hkSpriteY + hkSpriteH * 0.5 - preAuraR, preAuraR * 2, preAuraR * 2);
        ctx.globalAlpha = fogFactor;
      }

      // Dark body shadow
      drawShapedSprite(ctx, hkBodyX, hkSpriteY + hkSpriteH * 0.35, hkBodyW, hkSpriteH * 0.65,
        screenX, depthTiles, zBuf, w, '#1a0808', '#000');

      // Head: haruki_scary.png when close (< 3 tiles), haruki.png otherwise
      var useImg = depthTiles < 3
        ? (GameEngine.images['assets/img/haruki_scary.png'] || GameEngine.images['assets/img/haruki.png'])
        : GameEngine.images['assets/img/haruki.png'];

      if (useImg) {
        var headW = spriteW * 0.6;
        var headH = hkSpriteH * 0.48;
        var headX = screenX - headW / 2;
        var headY = hkSpriteY;
        var startCol = Math.max(0, Math.floor(headX));
        var endCol = Math.min(w, Math.ceil(headX + headW));
        // Draw image columns with z-buffer occlusion (no full-rect overlays to avoid wall tinting)
        for (var col = startCol; col < endCol; col++) {
          if (zBuf[col] > depthTiles) {
            var srcX = ((col - headX) / headW) * useImg.width;
            ctx.drawImage(useImg, srcX, 0, 1, useImg.height, col, headY, 1, headH);
            // Per-column red tint via direct alpha-multiplied fill
            ctx.save();
            ctx.globalAlpha = (depthTiles < 3 ? 0.35 : 0.18) * fogFactor;
            ctx.fillStyle = 'rgba(180,30,30,1)';
            ctx.fillRect(col, headY, 1, headH);
            ctx.restore();
          }
        }
      } else {
        // Fallback: red blob head
        drawShapedSprite(ctx, screenX - spriteW * 0.25, hkSpriteY, spriteW * 0.5, hkSpriteH * 0.45,
          screenX, depthTiles, zBuf, w, '#883030', '#330000');
      }

      // Outer rim aura (subtle pulse) — also only if mostly visible
      if (depthTiles > 1.2 && auraVisible) {
        var rimPulse = 0.7 + Math.sin(performance.now() * 0.004) * 0.3;
        ctx.globalAlpha = Math.min(0.35, fogFactor * 0.45 * rimPulse);
        var rimR = hkSpriteH * 0.55;
        var rimGrad = ctx.createRadialGradient(screenX, hkSpriteY + hkSpriteH * 0.4, rimR * 0.6,
                                                  screenX, hkSpriteY + hkSpriteH * 0.4, rimR);
        rimGrad.addColorStop(0, 'rgba(0,0,0,0)');
        rimGrad.addColorStop(1, 'rgba(255,30,30,0.6)');
        ctx.fillStyle = rimGrad;
        ctx.fillRect(screenX - rimR, hkSpriteY + hkSpriteH * 0.4 - rimR, rimR * 2, rimR * 2);
        ctx.globalAlpha = fogFactor;
      }
    } else if (e.type === 'echo') {
      // ECHO: ghostly mirror of player — soft outline, glowing
      var ecH = spriteH * 0.95;
      var ecY = startY + spriteH * 0.02;
      var ecW = spriteW * 0.42;
      var ecX = screenX - ecW / 2;
      // Ghostly body with translucent glow
      drawShapedSprite(ctx, ecX, ecY + ecH * 0.3, ecW, ecH * 0.7,
        screenX, depthTiles, zBuf, w, '#7080a0', '#3a4860');
      // Head with blank face
      drawShapedSprite(ctx, screenX - ecW * 0.4, ecY, ecW * 0.8, ecH * 0.35,
        screenX, depthTiles, zBuf, w, '#8090b0', '#506070');
      // Glowing aura (white-blue, only if center visible)
      var ecCenterCol = Math.round(screenX);
      if (ecCenterCol >= 0 && ecCenterCol < w && zBuf[ecCenterCol] > depthTiles) {
        var auraR = ecH * 0.5;
        var auraGrad = ctx.createRadialGradient(screenX, ecY + ecH * 0.45, 0,
                                                 screenX, ecY + ecH * 0.45, auraR);
        auraGrad.addColorStop(0, 'rgba(180, 200, 240, 0.35)');
        auraGrad.addColorStop(1, 'rgba(180, 200, 240, 0)');
        ctx.globalAlpha = Math.min(0.5, fogFactor * 0.6);
        ctx.fillStyle = auraGrad;
        ctx.fillRect(screenX - auraR, ecY + ecH * 0.45 - auraR, auraR * 2, auraR * 2);
        ctx.globalAlpha = fogFactor;
      }
      // Empty eye sockets (dark dots)
      var ecEyeY = ecY + ecH * 0.15;
      ctx.fillStyle = 'rgba(20,30,50,' + fogFactor + ')';
      drawSpriteDot(ctx, screenX - ecW * 0.15, ecEyeY, Math.max(2, ecH * 0.03), zBuf, w, depthTiles);
      drawSpriteDot(ctx, screenX + ecW * 0.15, ecEyeY, Math.max(2, ecH * 0.03), zBuf, w, depthTiles);
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
      // Boss HP bar above head (per-column occlusion)
      if (e.bossHp !== undefined) {
        var bhpRatio = Math.max(0, e.bossHp / 200);
        var bhpY = bsY - 18;
        var bhpW = bsW * 1.5;
        var bhpX = screenX - bhpW / 2;
        var bhpStart = Math.max(0, Math.floor(bhpX));
        var bhpEnd = Math.min(w, Math.ceil(bhpX + bhpW));
        // Background
        ctx.fillStyle = 'rgba(0,0,0,' + fogFactor * 0.85 + ')';
        for (var bhc = bhpStart; bhc < bhpEnd; bhc++) {
          if (zBuf[bhc] > depthTiles) ctx.fillRect(bhc, bhpY, 1, 6);
        }
        // Fill
        ctx.fillStyle = 'rgba(200,40,40,' + fogFactor + ')';
        var bhpFillEnd = bhpStart + Math.floor((bhpEnd - bhpStart) * bhpRatio);
        for (var bhc2 = bhpStart; bhc2 < bhpFillEnd; bhc2++) {
          if (zBuf[bhc2] > depthTiles) ctx.fillRect(bhc2, bhpY, 1, 6);
        }
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

  // Offscreen canvas for per-column z-occluded icon rendering
  var _pickupOffCanvas = null;
  var _pickupOffCtx = null;
  function getPickupOffCanvas(size) {
    if (!_pickupOffCanvas) {
      _pickupOffCanvas = document.createElement('canvas');
      _pickupOffCtx = _pickupOffCanvas.getContext('2d');
    }
    if (_pickupOffCanvas.width !== size) {
      _pickupOffCanvas.width = size;
      _pickupOffCanvas.height = size;
    }
    return _pickupOffCanvas;
  }

  // World-space pickup renderer with proper z-buffer occlusion per column
  function drawWorldPickup(ctx, wx, wy, phase, color, icon, itemId) {
    var w = GameEngine.width;
    var h = GameEngine.height;
    var dx = wx - player.x;
    var dy = wy - player.y;
    // Standard raycaster sprite projection
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    var tX = -dx * sinT + dy * cosT;
    var tY = dx * cosT + dy * sinT;
    if (tY <= 0.5) return; // behind camera
    var depthTiles = tY / TS;
    if (depthTiles > 14) return; // too far

    var screenX = (w / 2) * (1 + tX / tY);
    var iconSize = Math.max(14, (h / depthTiles) * 0.18);
    // Off-screen culling: full icon width outside view
    if (screenX + iconSize < 0 || screenX - iconSize > w) return;

    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;

    // Sample multiple columns across icon width — if ALL are occluded, skip entirely
    var halfW = iconSize * 0.5;
    var sampleStart = Math.max(0, Math.floor(screenX - halfW));
    var sampleEnd = Math.min(w - 1, Math.ceil(screenX + halfW));
    if (sampleEnd <= sampleStart) return;
    var visibleCount = 0;
    for (var sc = sampleStart; sc <= sampleEnd; sc++) {
      if (zBuf[sc] > depthTiles) visibleCount++;
    }
    if (visibleCount === 0) return; // fully occluded by walls

    // Full opacity (fogFactor min 0.85) — items should not look transparent
    var fogFactor = Math.max(0.85, 1 - depthTiles / 14);
    var pulse = 0.88 + Math.sin(phase) * 0.12;
    var groundY = h / 2 + (h * 0.5) / depthTiles;
    var iconBaseY = groundY - iconSize * 0.4;
    var iconY = iconBaseY + Math.sin(phase * 2) * iconSize * 0.12;

    // Render the icon to offscreen canvas, then blit column-by-column with z-buffer check
    var displayIcon = (itemId && ITEMS[itemId]) ? ITEMS[itemId].icon : icon;
    var offSize = Math.ceil(iconSize * 2.2);
    var off = getPickupOffCanvas(offSize);
    var octx = _pickupOffCtx;
    octx.clearRect(0, 0, offSize, offSize);
    // Ground ring (drawn into offscreen, centered)
    var oCenterX = offSize / 2;
    var oGroundOff = iconSize * 0.4 + Math.sin(phase * 2) * iconSize * 0.12;
    var oGroundY = offSize / 2 + oGroundOff;
    var ringR = Math.max(4, iconSize * 0.5);
    octx.globalAlpha = pulse;
    var grad = octx.createRadialGradient(oCenterX, oGroundY, 0, oCenterX, oGroundY, ringR);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(oCenterX, oGroundY, ringR, 0, Math.PI * 2);
    octx.fill();
    // Beam (more visible)
    octx.globalAlpha = 0.7 * pulse;
    var beamW = Math.max(2, iconSize * 0.14);
    var beamH = iconSize * 1.6;
    var beamGrad = octx.createLinearGradient(oCenterX, oGroundY - beamH, oCenterX, oGroundY);
    beamGrad.addColorStop(0, 'rgba(0,0,0,0)');
    beamGrad.addColorStop(0.5, color);
    beamGrad.addColorStop(1, color);
    octx.fillStyle = beamGrad;
    octx.fillRect(oCenterX - beamW / 2, oGroundY - beamH, beamW, beamH);
    // Solid black background plate behind icon for full opacity
    octx.globalAlpha = 0.92;
    var plateR = iconSize * 0.55;
    var plateGrad = octx.createRadialGradient(oCenterX, offSize / 2, 0, oCenterX, offSize / 2, plateR);
    plateGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    plateGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.6)');
    plateGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = plateGrad;
    octx.beginPath();
    octx.arc(oCenterX, offSize / 2, plateR, 0, Math.PI * 2);
    octx.fill();
    // Icon with strong outline
    octx.globalAlpha = 1;
    octx.font = 'bold ' + iconSize + 'px sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillStyle = 'rgba(0,0,0,1)';
    for (var ox = -2; ox <= 2; ox++) for (var oy = -2; oy <= 2; oy++) {
      if (ox === 0 && oy === 0) continue;
      octx.fillText(displayIcon, oCenterX + ox, offSize / 2 + oy);
    }
    octx.fillStyle = color;
    octx.fillText(displayIcon, oCenterX, offSize / 2);

    // Blit column by column with per-column z-buffer test
    ctx.save();
    ctx.globalAlpha = fogFactor;
    var screenStartCol = Math.max(0, Math.floor(screenX - offSize / 2));
    var screenEndCol = Math.min(w, Math.ceil(screenX + offSize / 2));
    var blitY = iconY - offSize / 2;
    for (var col2 = screenStartCol; col2 < screenEndCol; col2++) {
      if (zBuf[col2] <= depthTiles) continue; // wall in front → skip this column
      var srcCol = col2 - (screenX - offSize / 2);
      if (srcCol < 0 || srcCol >= offSize) continue;
      ctx.drawImage(off, srcCol, 0, 1, offSize, col2, blitY, 1, offSize);
    }
    ctx.restore();
  }

  // Offscreen for no-clip beam (separate canvas to avoid corrupt during pickup draw)
  var _noClipOffCanvas = null;
  var _noClipOffCtx = null;
  function getNoClipOffCanvas(w_, h_) {
    if (!_noClipOffCanvas) {
      _noClipOffCanvas = document.createElement('canvas');
      _noClipOffCtx = _noClipOffCanvas.getContext('2d');
    }
    if (_noClipOffCanvas.width !== w_ || _noClipOffCanvas.height !== h_) {
      _noClipOffCanvas.width = w_;
      _noClipOffCanvas.height = h_;
    }
    return _noClipOffCanvas;
  }

  function drawNoClipBeam(ctx, wx, wy, phase) {
    var w = GameEngine.width;
    var h = GameEngine.height;
    var dx = wx - player.x;
    var dy = wy - player.y;
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    var tX = -dx * sinT + dy * cosT;
    var tY = dx * cosT + dy * sinT;
    if (tY <= 0.5) return;
    var depthTiles = tY / TS;
    // Only show beam when player is close — was 18, now 7 tiles for exploration challenge
    if (depthTiles > 7) return;

    var screenX = (w / 2) * (1 + tX / tY);
    var beamWidth = Math.max(6, (h / depthTiles) * 0.12);
    var beamHeight = (h / depthTiles) * 1.5;
    var ringR = beamWidth * 2;
    var totalWidth = Math.max(beamWidth * 2.5, ringR * 2);

    if (screenX + totalWidth < 0 || screenX - totalWidth > w) return;

    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;
    // Multi-column visibility check
    var sampleStart = Math.max(0, Math.floor(screenX - totalWidth / 2));
    var sampleEnd = Math.min(w - 1, Math.ceil(screenX + totalWidth / 2));
    if (sampleEnd <= sampleStart) return;
    var visCount = 0;
    for (var sc = sampleStart; sc <= sampleEnd; sc++) {
      if (zBuf[sc] > depthTiles) visCount++;
    }
    if (visCount === 0) return;

    var fogFactor = Math.max(0.3, 1 - depthTiles / 18);
    var groundY = h / 2 + (h * 0.5) / depthTiles;
    var beamTopY = Math.max(0, groundY - beamHeight);
    var pulse = 0.7 + Math.sin(phase * 1.5) * 0.3;

    // Render to offscreen
    var offW = Math.ceil(totalWidth);
    var offH = Math.ceil(beamHeight + ringR * 2);
    var off = getNoClipOffCanvas(offW, offH);
    var octx = _noClipOffCtx;
    octx.clearRect(0, 0, offW, offH);
    var oCenterX = offW / 2;
    var oGroundY = beamHeight; // ground at this y on offscreen
    // Beam
    octx.globalAlpha = 0.7 * pulse;
    var beamGrad = octx.createLinearGradient(oCenterX, 0, oCenterX, oGroundY);
    beamGrad.addColorStop(0, 'rgba(255, 220, 100, 0)');
    beamGrad.addColorStop(0.5, 'rgba(255, 220, 100, 0.6)');
    beamGrad.addColorStop(1, 'rgba(255, 180, 50, 0.9)');
    octx.fillStyle = beamGrad;
    octx.fillRect(oCenterX - beamWidth, 0, beamWidth * 2, oGroundY);
    // Ground glow
    octx.globalAlpha = 0.85 * pulse;
    var groundGrad = octx.createRadialGradient(oCenterX, oGroundY, 0, oCenterX, oGroundY, ringR);
    groundGrad.addColorStop(0, 'rgba(255, 200, 80, 0.95)');
    groundGrad.addColorStop(1, 'rgba(255, 180, 50, 0)');
    octx.fillStyle = groundGrad;
    octx.beginPath();
    octx.arc(oCenterX, oGroundY, ringR, 0, Math.PI * 2);
    octx.fill();
    // Triangle "▼"
    octx.globalAlpha = pulse;
    var triSize = beamWidth * 0.8;
    var triY = Math.max(0, triSize);
    octx.fillStyle = '#fce884';
    octx.beginPath();
    octx.moveTo(oCenterX, triY);
    octx.lineTo(oCenterX - triSize, triY - triSize);
    octx.lineTo(oCenterX + triSize, triY - triSize);
    octx.closePath();
    octx.fill();

    // Column-blit to main canvas with per-column z-buffer check
    ctx.save();
    ctx.globalAlpha = fogFactor;
    var blitY = beamTopY;
    var screenStartCol = Math.max(0, Math.floor(screenX - offW / 2));
    var screenEndCol = Math.min(w, Math.ceil(screenX + offW / 2));
    for (var col2 = screenStartCol; col2 < screenEndCol; col2++) {
      if (zBuf[col2] <= depthTiles) continue;
      var srcCol = col2 - (screenX - offW / 2);
      if (srcCol < 0 || srcCol >= offW) continue;
      ctx.drawImage(off, srcCol, 0, 1, offH, col2, blitY, 1, offH);
    }
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
    if (state === ST.TITLE || state === ST.ENDED || state === ST.DEAD) return;

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

    // Action button visibility (only during play)
    if (state === ST.PLAYING) updateActionButton();

    // Dim screen if flashlight off on dark levels
    GameEngine.drawDarkness(player.x, player.y, 200, 0);

    // Directional threat indicator (red arc on screen edge pointing at nearest threat)
    if (player._nearestThreat && player._nearestThreatDist < 14 * TS) {
      drawThreatCompass(ctx, player._nearestThreat, player._nearestThreatDist, player._threatLevel || 0);
    }
  }

  function drawThreatCompass(ctx, target, dist, threatLevel) {
    var W = ctx.canvas.width;
    var H = ctx.canvas.height;
    var dx = target.x - player.x;
    var dy = target.y - player.y;
    // Player facing is angle 0 = +X. relAng = angle from player facing direction
    var worldAng = Math.atan2(dy, dx);
    var relAng = worldAng - player.angle;
    // Normalize to [-PI, PI]
    while (relAng > Math.PI) relAng -= Math.PI * 2;
    while (relAng < -Math.PI) relAng += Math.PI * 2;
    // Intensity based on threat tier
    var maxDist = 14 * TS;
    var prox = Math.max(0, 1 - dist / maxDist); // 0 far .. 1 close
    var alpha = 0.15 + prox * 0.55;
    if (threatLevel >= 3) alpha = Math.min(1, alpha + 0.15);
    var pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.012 * (1 + prox * 2));
    alpha *= pulse;

    // Map relAng to screen-edge arc center.
    // -PI/2 = left edge, +PI/2 = right edge, 0 = top center (forward), +-PI = bottom center (behind)
    // Use a simple rectangular projection: arc placed on the edge of an ellipse
    var cx = W / 2;
    var cy = H / 2;
    var rx = W * 0.42;
    var ry = H * 0.42;
    // Angle on ellipse: 0 = right, +PI/2 = down. Player relAng 0 = forward = up = -PI/2
    var screenAng = relAng - Math.PI / 2;
    var px = cx + Math.cos(screenAng) * rx;
    var py = cy + Math.sin(screenAng) * ry;

    ctx.save();
    // Arc indicator: 30-degree arc on screen edge
    var arcLen = (40 + prox * 30) * Math.PI / 180;
    var arcRadius = Math.min(W, H) * 0.045;
    ctx.lineWidth = 4 + prox * 3;
    ctx.strokeStyle = threatLevel >= 3 ? 'rgba(220, 30, 30,' + alpha + ')'
                    : threatLevel >= 2 ? 'rgba(230, 100, 30,' + alpha + ')'
                    : 'rgba(220, 200, 60,' + alpha + ')';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(px, py, arcRadius, screenAng - arcLen / 2 + Math.PI, screenAng + arcLen / 2 + Math.PI);
    ctx.stroke();

    // Small triangular tip pointing inward (toward screen center)
    var inwardX = px - Math.cos(screenAng) * (arcRadius - 6);
    var inwardY = py - Math.sin(screenAng) * (arcRadius - 6);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.translate(inwardX, inwardY);
    ctx.rotate(screenAng + Math.PI);
    ctx.moveTo(0, -4);
    ctx.lineTo(7, 0);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  var _lastActState = { shown: null, label: null };
  function updateActionButton() {
    var btn = el('actionBtn');
    if (!btn) return;
    var gx = Math.floor(player.x / TS);
    var gy = Math.floor(player.y / TS);
    var here = currentMap.tiles[gy] && currentMap.tiles[gy][gx];
    var key = gridKey(gx, gy);

    var showAct = false;
    var label = '調べる';

    if (here === 3) { showAct = true; label = '降りる'; }
    else if (here === 11) {
      var safeKey2 = currentLevel + '_' + key;
      if (LEVEL_MINIGAMES[currentLevel] && !mgPlayedAt[safeKey2]) {
        showAct = true; label = 'PLAY';
      } else {
        showAct = false;
      }
    }
    else if (pickupSpots[key]) { showAct = true; label = '拾う'; }
    else if (noteSpots[key] && !(readNotes[currentLevel] && readNotes[currentLevel][key])) { showAct = true; label = '読む'; }
    else {
      var facingGx = Math.floor((player.x + Math.cos(player.angle) * TS * 0.7) / TS);
      var facingGy = Math.floor((player.y + Math.sin(player.angle) * TS * 0.7) / TS);
      var ft = currentMap.tiles[facingGy] && currentMap.tiles[facingGy][facingGx];
      var fkey = gridKey(facingGx, facingGy);
      if (ft === 2) { showAct = true; label = 'ドア'; }
      else if (ft === 5 && pickupSpots[fkey]) { showAct = true; label = '拾う'; }
      else if (ft === 6 && noteSpots[fkey] && !(readNotes[currentLevel] && readNotes[currentLevel][fkey])) { showAct = true; label = '読む'; }
      else if (ft === 3) { showAct = true; label = '降りる'; }
    }

    // Skip DOM update if state hasn't changed (perf)
    if (_lastActState.shown !== showAct || _lastActState.label !== label) {
      if (showAct) {
        btn.style.display = 'block';
        el('actionBtnText').textContent = label;
      } else {
        btn.style.display = 'none';
      }
      _lastActState.shown = showAct;
      _lastActState.label = label;
    }
  }

  // ============================================================
  //  GAME LOOP HOOK
  // ============================================================
  function onUpdate(dt) {
    pollGamepad();
    if (state === ST.PLAYING && !phoneOpen && !miniGameOpen) {
      updatePlayer(dt);
      updateEntities(dt);
      GameEngine.updateParticles(dt);
      // Per-level ambient particles (skip in LOW quality)
      if (gfxQuality !== 'low') {
        var partRand = Math.random();
        var pAng = Math.random() * Math.PI * 2;
        var pDist = 100 + Math.random() * 150;
        var px_ = player.x + Math.cos(pAng) * pDist;
        var py_ = player.y + Math.sin(pAng) * pDist;
        if (currentLevel === 2 && partRand < 0.05) {
          // Lv2 Pipe Dreams — water drops
          GameEngine.addParticle('fog', px_, py_);
        } else if (currentLevel === 3 && partRand < 0.04) {
          // Lv3 Electrical — sparks
          GameEngine.addParticle('spark', px_, py_);
        } else if (currentLevel === 5 && partRand < 0.025) {
          // Lv5 Hotel — dust motes
          GameEngine.addParticle('dust', px_, py_);
        } else if (currentLevel === 8 && partRand < 0.04) {
          // Lv8 Hive — dust (representing pollen)
          GameEngine.addParticle('dust', px_, py_);
        } else if (currentLevel === 9 && partRand < 0.03) {
          // Lv9 Suburbs — fireflies (sparks)
          GameEngine.addParticle('spark', px_, py_);
        } else if (currentLevel === 12 && partRand < 0.04) {
          // Lv12 Fun=) — confetti (sparks)
          GameEngine.addParticle('spark', px_, py_);
        } else if (partRand < 0.025) {
          // Default dust
          GameEngine.addParticle('dust', px_, py_);
        }
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
    // Build run summary (convert \n in sub to <br>)
    var subHtml = sub.replace(/\n/g, '<br>');
    var summary = ['<span style="color:#ff8060;font-weight:bold;">' + subHtml + '</span>'];
    var clears = 0;
    for (var ck in clearedLevels) if (clearedLevels[ck]) clears++;
    summary.push('<hr style="border:none;border-top:1px solid #483910;margin:10px 0;">');
    summary.push('<span style="color:#b09040;">生存時間:</span> ' + formatTime(playTime));
    summary.push('<span style="color:#b09040;">現在階層:</span> ' + (currentLevelDef ? currentLevelDef.name + ' / ' + currentLevelDef.subtitle : 'LV?'));
    summary.push('<span style="color:#b09040;">クリア階層数:</span> ' + clears);
    summary.push('<span style="color:#b09040;">収集ノート:</span> ' + discoveredNotes.length);
    if (gameMode === 'endless') {
      saveEndlessBest();
      summary.push('<span style="color:#b09040;">ENDLESS Floor:</span> ' + endlessFloor);
      summary.push('<span style="color:#b09040;">Score:</span> ' + endlessScore +
                   (endlessScore === endlessBestScore ? ' <span style="color:#88c050;font-weight:bold;">(★ NEW BEST!)</span>' : ' (Best: ' + endlessBestScore + ')'));
    }
    var sumEl = el('gameoverSub');
    if (sumEl) {
      sumEl.innerHTML = summary.join('<br>');
    }
    GameEngine.stopAll();
    GameEngine.fadeToBlack(800, function () {
      showOverlay('gameOverScreen');
    });
  }

  function playEndingCinematic(type, onDone) {
    // Sequence of fade lines like intro but for ending
    showOverlay('introOverlay');
    var eyes = el('introEyes');
    eyes.classList.add('open'); // start with eyes open
    var lineEl = el('introLine');
    lineEl.textContent = '';
    lineEl.classList.remove('show');
    if (audioInitialized) GameEngine.startLoop('wind');
    var lines;
    if (type === 'truend') {
      lines = [
        { text: '', delay: 800 },
        { text: 'お前は黒い扉に手をかけた。', delay: 2800 },
        { text: '振り返れば、9 つの階層と無数の影。', delay: 3200 },
        { text: '前を向けば、何かが待っている。', delay: 3000 },
        { text: '扉が、開く。', delay: 2400 },
        { text: '光、または、無。', delay: 2800 },
        { text: '...', delay: 1600 }
      ];
    } else {
      lines = [
        { text: '', delay: 800 },
        { text: 'お前は壁を抜けた。', delay: 2800 },
        { text: '...', delay: 2200 }
      ];
    }
    var idx = 0;
    var cancelled = false;
    function next() {
      if (cancelled) return;
      if (idx >= lines.length) {
        // Close eyes (slide out)
        eyes.classList.remove('open');
        eyes.classList.remove('partial');
        setTimeout(function () {
          if (cancelled) return;
          hideOverlay('introOverlay');
          if (audioInitialized) GameEngine.stopLoop('wind');
          onDone();
        }, 1200);
        return;
      }
      var line = lines[idx];
      lineEl.classList.remove('show');
      void lineEl.offsetWidth;
      lineEl.textContent = line.text;
      requestAnimationFrame(function () { lineEl.classList.add('show'); });
      idx++;
      setTimeout(next, line.delay);
    }
    var skip = el('introSkipBtn');
    var skipHandler = function () {
      cancelled = true;
      hideOverlay('introOverlay');
      if (audioInitialized) GameEngine.stopLoop('wind');
      skip.removeEventListener('click', skipHandler);
      onDone();
    };
    skip.addEventListener('click', skipHandler);
    next();
  }

  function triggerEnding(type) {
    // Play cinematic first, then show ending screen
    state = ST.ENDED;
    GameEngine.stopAll();
    playEndingCinematic(type, function () {
      _showEndingScreen(type);
    });
  }

  function _showEndingScreen(type) {
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
      // TRUE+ END uses lifetime collection (across multiple runs)
      var lifetimeCount = Object.keys(lifetimeNoteTitles).length;
      var hasAllNotes = lifetimeCount >= totalNotes;
      var hasAllAch = Object.keys(unlockedAchievements).length >= totalAch - 1;
      var runSummary =
        '<hr style="border:none;border-top:1px solid #483910;margin:14px 0;">' +
        '<div style="font-size:11px;color:#b09040;letter-spacing:0.15em;line-height:1.8;">' +
        '生存: ' + formatTime(playTime) + '<br>' +
        '本ラン ノート: ' + discoveredNotes.length + '<br>' +
        '通算 ユニーク ノート: ' + lifetimeCount + ' / ' + totalNotes + '<br>' +
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

    // Battery (declines with playtime) — iOS-style indicator
    var batRatio = Math.max(0, 1 - playTime / 3600);
    el('phoneBattery').textContent = Math.floor(batRatio * 100);
    var batFill = el('phoneBatteryFill');
    if (batFill) {
      batFill.style.width = (batRatio * 100) + '%';
      batFill.classList.toggle('low', batRatio < 0.3 && batRatio >= 0.15);
      batFill.classList.toggle('critical', batRatio < 0.15);
    }
    // Dynamic signal bars based on entity proximity
    var sigEl = document.querySelector('.phone-sb-signal');
    if (sigEl) {
      var minDist = Infinity;
      for (var sgi = 0; sgi < entities.length; sgi++) {
        if (!entities[sgi].alive) continue;
        var sgDx = entities[sgi].x - player.x;
        var sgDy = entities[sgi].y - player.y;
        var sgD = Math.sqrt(sgDx * sgDx + sgDy * sgDy);
        if (sgD < minDist) minDist = sgD;
      }
      // Map distance to bars (closer = fewer bars)
      var bars = 5;
      if (minDist < 3 * TS) bars = 1;
      else if (minDist < 5 * TS) bars = 2;
      else if (minDist < 8 * TS) bars = 3;
      else if (minDist < 12 * TS) bars = 4;
      var sgStr = '';
      for (var bi = 0; bi < 5; bi++) sgStr += (bi < bars) ? '●' : '○';
      sigEl.textContent = sgStr;
      sigEl.style.color = bars <= 2 ? '#c63a3a' : '#d4b340';
    }

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
              openItemUseModal(itemId);
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
      var lifetimeNotesCount = Object.keys(lifetimeNoteTitles).length;
      var trackProgress = {
        five_clears: clearsNow + ' / 5',
        all_clears: clearsNow + ' / 12',
        collect_10_notes: notesNow + ' / 10  (累積 ' + lifetimeNotesCount + ' / ' + totalNotesAvailable + ')',
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

  function refreshQuickItemBar() {
    var scroll = el('quickItemScroll');
    if (!scroll) return;
    scroll.innerHTML = '';
    var keys = Object.keys(player.inventory);
    if (keys.length === 0) {
      var emp = document.createElement('div');
      emp.style.cssText = 'color:#786020;font-size:11px;padding:0 10px;letter-spacing:0.1em;';
      emp.textContent = 'アイテムなし';
      scroll.appendChild(emp);
      return;
    }
    keys.forEach(function (id) {
      var item = ITEMS[id];
      if (!item) return;
      var cnt = player.inventory[id];
      var slot = document.createElement('div');
      slot.className = 'quick-item-slot';
      slot.innerHTML = item.icon +
        (item.persistent ? '' : (cnt > 1 ? '<span class="qi-count">' + cnt + '</span>' : ''));
      slot.title = item.name;
      slot.addEventListener('click', function () {
        openItemUseModal(id);
      });
      scroll.appendChild(slot);
    });
  }

  function drawFloatingMap() {
    var canvas = el('floatingMapCanvas');
    if (!canvas || !currentMap) return;
    var rect = canvas.getBoundingClientRect();
    var sz = Math.min(rect.width, rect.height) | 0;
    if (sz <= 0) return;
    canvas.width = sz;
    canvas.height = sz;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, sz, sz);
    var mw = currentMap.width;
    var mh = currentMap.height;
    var ts = Math.floor(sz / Math.max(mw, mh));
    var ox = (sz - ts * mw) / 2;
    var oy = (sz - ts * mh) / 2;
    for (var y = 0; y < mh; y++) {
      for (var x = 0; x < mw; x++) {
        var t = currentMap.tiles[y][x];
        var disc = discoveredMap[currentLevel] && discoveredMap[currentLevel][y] && discoveredMap[currentLevel][y][x];
        if (!disc) continue; // skip undiscovered
        if (t === 1 || t === 4 || t === 8 || t === 9) ctx.fillStyle = '#786020';
        else if (t === 3) ctx.fillStyle = '#f0dc8a';
        else if (t === 2) ctx.fillStyle = '#a08850';
        else if (t === 10) ctx.fillStyle = '#c63a3a';
        else if (t === 11) ctx.fillStyle = '#88b033';
        else if (t === 7) ctx.fillStyle = '#406070';
        else ctx.fillStyle = '#382a08';
        ctx.fillRect(ox + x * ts, oy + y * ts, ts, ts);
      }
    }
    // Items in discovered area
    for (var ikey in pickupSpots) {
      var parts = ikey.split('_');
      var igx = parseInt(parts[0], 10), igy = parseInt(parts[1], 10);
      if (discoveredMap[currentLevel] && discoveredMap[currentLevel][igy] && discoveredMap[currentLevel][igy][igx]) {
        ctx.fillStyle = '#88c050';
        ctx.beginPath();
        ctx.arc(ox + (igx + 0.5) * ts, oy + (igy + 0.5) * ts, Math.max(1.5, ts * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // No-clip exits
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
    // Player
    var pgx = player.x / TS, pgy = player.y / TS;
    ctx.fillStyle = '#88b033';
    ctx.beginPath();
    ctx.arc(ox + pgx * ts, oy + pgy * ts, Math.max(2, ts * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#88b033';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + pgx * ts, oy + pgy * ts);
    ctx.lineTo(ox + pgx * ts + Math.cos(player.angle) * ts * 1.5,
              oy + pgy * ts + Math.sin(player.angle) * ts * 1.5);
    ctx.stroke();
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
  // Intro cinematic — first-person POV with 3 scenes
  function playIntroCinematic(onDone) {
    showOverlay('introOverlay');
    var eyes = el('introEyes');
    eyes.classList.remove('open', 'partial');
    var lineEl = el('introLine');
    lineEl.textContent = '';
    lineEl.classList.remove('show');
    var s1 = el('introScene1');
    var s2 = el('introScene2');
    var s3 = el('introScene3');
    [s1, s2, s3].forEach(function (s) { s.classList.remove('active'); });
    if (audioInitialized) GameEngine.startLoop('wind');

    var cancelled = false;
    var footstepTimer = null;
    function startFootsteps() {
      if (!audioInitialized) return;
      footstepTimer = setInterval(function () {
        if (audioInitialized && !cancelled) {
          GameEngine.playSound('footstep');
        }
      }, 500);
    }
    function stopFootsteps() {
      if (footstepTimer) clearInterval(footstepTimer);
      footstepTimer = null;
    }

    function setLine(text) {
      lineEl.classList.remove('show');
      void lineEl.offsetWidth;
      lineEl.textContent = text;
      requestAnimationFrame(function () { lineEl.classList.add('show'); });
    }

    var skipHandler;
    function finish() {
      if (cancelled) return;
      cancelled = true;
      stopFootsteps();
      hideOverlay('introOverlay');
      if (audioInitialized) GameEngine.stopLoop('wind');
      try { el('introSkipBtn').removeEventListener('click', skipHandler); } catch (e) {}
      try { el('introOverlay').removeEventListener('click', skipHandler); } catch (e) {}
      onDone();
    }
    skipHandler = finish;
    // Multiple ways to skip: button OR tap anywhere on the overlay
    el('introSkipBtn').addEventListener('click', skipHandler);
    el('introOverlay').addEventListener('click', skipHandler);

    // Cinematic plays scenes, but final frame waits for tap to proceed.
    // Scene 1: night back-alley walking (3s)
    setTimeout(function () {
      if (cancelled) return;
      s1.classList.add('active');
      startFootsteps();
      setLine('...深夜、会社からの帰り道。');
    }, 300);
    setTimeout(function () { if (!cancelled) setLine('いつもの裏路地。'); }, 2200);

    // Scene 2: wallpaper closeup (3s)
    setTimeout(function () {
      if (cancelled) return;
      stopFootsteps();
      s1.classList.remove('active');
      s2.classList.add('active');
      setLine('— 足元の感触が、消えた。');
      if (audioInitialized) GameEngine.playSound('static');
    }, 4000);

    // Scene 3: falling (2.5s)
    setTimeout(function () {
      if (cancelled) return;
      s2.classList.remove('active');
      s3.classList.add('active');
      setLine('黄色い、無限の、壁紙の世界へ。');
      if (audioInitialized) GameEngine.playSound('thunder');
    }, 6500);

    // Eyes hint to open — but FINAL frame waits for tap
    setTimeout(function () {
      if (cancelled) return;
      eyes.classList.add('partial');
      setLine('[ 画面をタップして開始 ]');
    }, 8500);
    // No auto-finish — user taps overlay or skip button to advance
    // Safety net: auto-finish after 30s if no tap
    setTimeout(finish, 30000);
  }

  function startNewGame() {
    state = ST.LOADING;
    hideOverlay('titleScreen');
    gameMode = 'normal';
    stats.totalRuns++;
    saveStats();
    if (!audioInitialized) {
      GameEngine.initAudio();
      audioInitialized = true;
    }
    // Stop title BGM
    GameEngine.stopLoop('classical');
    GameEngine.stopLoop('wind');

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

    // Intro cinematic always plays when starting from "はじめから"
    playIntroCinematic(function () { setLevel(0); });
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
    // Title BGM (classical)
    if (audioInitialized) {
      setTimeout(function () {
        if (state === ST.TITLE) GameEngine.startLoop('classical');
      }, 300);
    }

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
    gameMode = 'freeroam';
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

    // Total reset (clears achievements, save, stats, best times, etc.)
    el('titleResetBtn').addEventListener('click', function () {
      // Two-step confirmation
      var confirm1 = confirm('全てのデータを削除します:\n\n• セーブデータ\n• 全アチーブメント (20種)\n• 全ベストタイム\n• ENDLESS Best Score\n• 通算記録\n• 累積収集ノート\n• 遭遇エンティティ図鑑\n\n本当に削除しますか?');
      if (!confirm1) return;
      var confirm2 = confirm('【最終確認】\n\n削除後は全進捗が完全に失われ、復元不可能です。\n本当によろしいですか?');
      if (!confirm2) return;
      // Clear all known keys
      var keys = ['thebackrooms_save_v1', 'thebackrooms_ach_v1', 'thebackrooms_best_v1', 'thebackrooms_diff_v1', 'thebackrooms_tut_v1', 'thebackrooms_endless_v1', 'thebackrooms_stats_v1', 'thebackrooms_ent_seen_v1', 'thebackrooms_lifetime_notes_v1', 'thebackrooms_items_collected_v1', 'thebackrooms_gfx_v1', 'bk_master_vol', 'bk_bgm_vol', 'bk_se_vol', 'bk_sens', 'bk_grain'];
      keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      // Reset in-memory state
      unlockedAchievements = {};
      bestTimes = {};
      stats = { totalDeaths: 0, totalNoClips: 0, totalRuns: 0, totalPlayTime: 0, totalItemsCollected: 0, totalNotesRead: 0, totalDistanceWalked: 0 };
      entitySeenTypes = {};
      lifetimeNoteTitles = {};
      endlessBestScore = 0;
      tutorialDone = false;
      currentDifficulty = 'normal';
      toast('全データを削除しました');
      setTimeout(function () { location.reload(); }, 1500);
    });
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

    el('phoneBtn').addEventListener('click', function () {
      openPhone();
      if (navigator.vibrate) navigator.vibrate(10);
    });

    // Floating map toggle
    el('floatingMapBtn').addEventListener('click', function () {
      floatingMapOpen = !floatingMapOpen;
      el('floatingMap').style.display = floatingMapOpen ? 'flex' : 'none';
      if (navigator.vibrate) navigator.vibrate(8);
    });

    // Quick item bar toggle
    var quickOpen = false;
    el('quickItemBtn').addEventListener('click', function () {
      quickOpen = !quickOpen;
      var panel = el('quickItemPanel');
      if (quickOpen) {
        panel.style.display = 'block';
        requestAnimationFrame(function () { panel.classList.add('show'); });
        refreshQuickItemBar();
      } else {
        panel.classList.remove('show');
        setTimeout(function () { panel.style.display = 'none'; }, 300);
      }
      if (navigator.vibrate) navigator.vibrate(8);
    });
    var fmOpacity = el('floatingMapOpacity');
    if (fmOpacity) {
      fmOpacity.addEventListener('input', function () {
        floatingMapOpacity = fmOpacity.value / 100;
        el('floatingMap').style.opacity = floatingMapOpacity;
      });
      el('floatingMap').style.opacity = floatingMapOpacity;
    }
    var closePhoneTop = el('closePhoneTopBtn');
    if (closePhoneTop) closePhoneTop.addEventListener('click', function () { closePhone(); });
    el('closePhoneBtn').addEventListener('click', function () {
      closePhone();
      if (navigator.vibrate) navigator.vibrate(10);
    });

    var tabBtns = document.querySelectorAll('.phone-tab-btn');
    tabBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        switchTab(b.getAttribute('data-tab'));
        if (navigator.vibrate) navigator.vibrate(8);
      });
    });

    el('closeNoteBtn').addEventListener('click', function () {
      hideOverlay('noteViewerOverlay');
    });

    // Item use modal
    el('itemUseConfirmBtn').addEventListener('click', confirmItemUse);
    el('itemUseCancelBtn').addEventListener('click', closeItemUseModal);

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
      // Fix: ensure fade overlay is cleared (avoid stuck dark screen after retry)
      GameEngine.fadeFromBlack(400);
      // ENDLESS death: retry starts new endless run
      if (gameMode === 'endless') {
        startEndlessMode();
        return;
      }
      // Free Roam death: return to title
      if (gameMode === 'freeroam') {
        returnToTitle();
        return;
      }
      // Normal: continue from save
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
    // GFX quality toggle
    var gfxBtn = el('gfxQualityBtn');
    var gfxValueEl = el('gfxQualityValue');
    if (gfxBtn) {
      gfxQuality = localStorage.getItem(GFX_KEY) === 'low' ? 'low' : 'high';
      if (gfxValueEl) gfxValueEl.textContent = gfxQuality === 'high' ? 'HIGH' : 'LOW';
      gfxBtn.addEventListener('click', function () {
        gfxQuality = (gfxQuality === 'high') ? 'low' : 'high';
        localStorage.setItem(GFX_KEY, gfxQuality);
        if (gfxValueEl) gfxValueEl.textContent = gfxQuality === 'high' ? 'HIGH' : 'LOW';
        applyGfxQuality();
        toast('グラフィック品質: ' + (gfxQuality === 'high' ? 'HIGH' : 'LOW'));
      });
      applyGfxQuality();
    }

    el('optReturnTitleBtn').addEventListener('click', function () {
      if (confirm('進捗を保存してタイトルへ戻りますか?')) {
        saveGame();
        closePhone();
        returnToTitle();
      }
    });

    // Auto-save every 30s (only normal mode — endless should not persist mid-run)
    setInterval(function () {
      if (state === ST.PLAYING && gameMode === 'normal') saveGame();
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

    // Title Settings Overlay sliders (mirror in-game phone settings)
    function bindTitleSetting(sliderId, valEl, storageKey, fmt, onApply) {
      var s = el(sliderId);
      var v = el(valEl);
      if (!s) return;
      var stored = localStorage.getItem(storageKey);
      if (stored !== null) s.value = parseInt(stored, 10);
      if (v) v.textContent = fmt(s.value);
      s.addEventListener('input', function () {
        if (v) v.textContent = fmt(s.value);
        try { localStorage.setItem(storageKey, s.value); } catch (e) {}
        if (onApply) onApply(parseInt(s.value, 10));
      });
      if (onApply) onApply(parseInt(s.value, 10));
    }
    bindTitleSetting('tsMasterVol', 'tsMasterVolVal', 'bk_master_vol',
      function (x) { return x + '%'; },
      function (x) { try { GameEngine.setMasterVolume(x / 100); } catch (e) {} });
    bindTitleSetting('tsBgmVol', 'tsBgmVolVal', 'bk_bgm_vol',
      function (x) { return x + '%'; },
      function (x) { try { GameEngine.setBgmVolume(x / 100); } catch (e) {} });
    bindTitleSetting('tsSeVol', 'tsSeVolVal', 'bk_se_vol',
      function (x) { return x + '%'; },
      function (x) { try { GameEngine.setSeVolume(x / 100); } catch (e) {} });
    bindTitleSetting('tsSens', 'tsSensVal', 'bk_sens',
      function (x) { return (x / 100).toFixed(1) + '×'; });
    bindTitleSetting('tsGrain', 'tsGrainVal', 'bk_grain_level',
      function (x) { return ['オフ', '中', '高'][parseInt(x, 10)] || '中'; },
      function (x) {
        var map = [0, 0.4, 0.8];
        GameEngine.grainIntensity = map[x] || 0.4;
      });

    var tsGfx = el('tsGfxToggle');
    if (tsGfx) {
      var gq = localStorage.getItem('thebackrooms_gfx_v1') === 'low' ? 'low' : 'high';
      tsGfx.textContent = gq === 'high' ? 'HIGH' : 'LOW';
      tsGfx.classList.toggle('off', gq === 'low');
      tsGfx.addEventListener('click', function () {
        gq = (gq === 'high') ? 'low' : 'high';
        localStorage.setItem('thebackrooms_gfx_v1', gq);
        tsGfx.textContent = gq === 'high' ? 'HIGH' : 'LOW';
        tsGfx.classList.toggle('off', gq === 'low');
        if (typeof applyGfxQuality === 'function') applyGfxQuality();
      });
    }
    var tsVib = el('tsVibrateToggle');
    if (tsVib) {
      var vibOn = localStorage.getItem('bk_vibrate') !== '0';
      tsVib.textContent = vibOn ? 'ON' : 'OFF';
      tsVib.classList.toggle('off', !vibOn);
      tsVib.addEventListener('click', function () {
        vibOn = !vibOn;
        localStorage.setItem('bk_vibrate', vibOn ? '1' : '0');
        tsVib.textContent = vibOn ? 'ON' : 'OFF';
        tsVib.classList.toggle('off', !vibOn);
      });
    }
    // Gamepad mapping UI
    var gpFields = {
      gpBtnAction: 'action', gpBtnPhone: 'phone', gpBtnFlare: 'flare',
      gpBtnSprint: 'sprint', gpBtnMap: 'map', gpBtnPause: 'pause'
    };
    function refreshGpUI() {
      for (var elid in gpFields) {
        var inp = el(elid);
        if (inp) inp.value = gamepadMap[gpFields[elid]];
      }
    }
    refreshGpUI();
    for (var elid2 in gpFields) {
      (function (id, key) {
        var inp = el(id);
        if (!inp) return;
        inp.addEventListener('input', function () {
          var v = parseInt(inp.value, 10);
          if (isFinite(v) && v >= 0 && v <= 20) {
            gamepadMap[key] = v;
            try { localStorage.setItem(GAMEPAD_KEY, JSON.stringify(gamepadMap)); } catch (e) {}
          }
        });
      })(elid2, gpFields[elid2]);
    }
    var gpReset = el('tsGpResetBtn');
    if (gpReset) {
      gpReset.addEventListener('click', function () {
        gamepadMap = Object.assign({}, DEFAULT_GAMEPAD_MAP);
        try { localStorage.setItem(GAMEPAD_KEY, JSON.stringify(gamepadMap)); } catch (e) {}
        refreshGpUI();
        toast('ゲームパッド設定をリセット');
      });
    }

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

    try { loadAchievements(); } catch (e) {}
    try { loadBestTimes(); } catch (e) {}
    try { loadDifficulty(); } catch (e) {}
    try { loadTutorialDone(); } catch (e) {}
    try { loadEndlessBest(); } catch (e) {}
    try { loadStats(); } catch (e) {}
    try { loadGamepadMap(); } catch (e) {}

    // CRITICAL: bind button events FIRST so title is interactive
    // even if any later setup throws
    try { bindEvents(); } catch (e) { console.error('bindEvents failed', e); }
    try { updateTitleButtons(); } catch (e) {}
    showOverlay('titleScreen');

    // Audio init is now handled per-button click via __titleAction.
    // No screen-wide tap requirement (removed per user request, was causing UX issues).

    // iOS Safari dynamic viewport: periodic canvas resize check
    try {
      var lastInnerH = window.innerHeight;
      var lastInnerW = window.innerWidth;
      setInterval(function () {
        if (window.innerHeight !== lastInnerH || window.innerWidth !== lastInnerW) {
          lastInnerH = window.innerHeight;
          lastInnerW = window.innerWidth;
          if (GameEngine._resize) GameEngine._resize();
        }
      }, 500);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && GameEngine._resize) {
          setTimeout(GameEngine._resize.bind(GameEngine), 100);
        }
      });
      window.addEventListener('orientationchange', function () {
        setTimeout(function () { if (GameEngine._resize) GameEngine._resize(); }, 200);
      });
    } catch (e) { console.error('viewport setup failed', e); }
  }

  // Diagnostic: indicate that game.js IIFE completed successfully.
  // After 2s, fade out so it's not visually distracting (still queryable in DOM).
  try {
    var diag = document.getElementById('jsLoadedDiag');
    if (diag) {
      diag.textContent = 'JS ✓';
      diag.style.color = '#88c050';
      setTimeout(function () {
        diag.style.transition = 'opacity 0.6s';
        diag.style.opacity = '0';
      }, 2000);
    }
  } catch (e) {}

  // Global title action façade — used by inline onclick attrs as a robust fallback
  // so title buttons always work even if addEventListener fails for any reason.
  window.__titleAction = function (action) {
    try {
      if (!audioInitialized) {
        try { GameEngine.initAudio(); } catch (e) {}
        audioInitialized = true;
        var hint = el('tapToStartHint');
        if (hint) hint.classList.add('hidden');
      }
      switch (action) {
        case 'start': startNewGame(); break;
        case 'continue': continueGame(); break;
        case 'endless': startEndlessMode(); break;
        case 'freeroam': openLevelSelect(); break;
        case 'difficulty':
          var order = ['easy', 'normal', 'hard', 'chaos'];
          var idx = order.indexOf(currentDifficulty);
          var nx = order[(idx + 1) % order.length];
          setDifficulty(nx);
          var dbtn = el('difficultyBtn');
          if (dbtn) dbtn.textContent = '難易度: ' + DIFFICULTIES[nx].name;
          break;
        case 'controls': showOverlay('tutorialOverlay'); break;
        case 'settings': showOverlay('titleSettingsOverlay'); break;
        case 'closeSettings': hideOverlay('titleSettingsOverlay'); break;
        case 'reset':
          if (!confirm('全データ削除しますか?')) return;
          if (!confirm('最終確認: 取り消せません。本当に?')) return;
          var keys = ['thebackrooms_save_v1', 'thebackrooms_ach_v1', 'thebackrooms_best_v1', 'thebackrooms_diff_v1', 'thebackrooms_tut_v1', 'thebackrooms_endless_v1', 'thebackrooms_stats_v1', 'thebackrooms_ent_seen_v1', 'thebackrooms_lifetime_notes_v1', 'thebackrooms_items_collected_v1', 'thebackrooms_gfx_v1', 'bk_master_vol', 'bk_bgm_vol', 'bk_se_vol', 'bk_sens', 'bk_grain'];
          keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          toast('全データを削除しました');
          setTimeout(function () { location.reload(); }, 1200);
          break;
      }
    } catch (e) { console.error('titleAction failed', action, e); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
