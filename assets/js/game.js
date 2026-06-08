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

  // ── Multi-user / multi-tab session isolation ────────────────
  // The game ships statically from GitHub Pages, so different *devices*
  // already have isolated state. The conflict surface is multi-tab on a
  // single browser: localStorage is per-origin and shared across tabs,
  // so two tabs would race on save data, sens, gamepad map etc.
  //
  // Solution: an optional ?session=<id> URL parameter (or ?profile=<name>)
  // namespaces every storage key. Without the parameter, default shared
  // behaviour is preserved so existing players see no change.
  // Detect a concurrent tab BEFORE we shadow window.localStorage, so the
  // detection itself uses the raw storage. SESSION_ID stays empty for the
  // common single-tab case to preserve the existing save's namespace.
  var _rawLS = window.localStorage;
  var SESSION_ID = (function () {
    try {
      var sp = new URLSearchParams(window.location.search);
      var explicit = sp.get('session') || sp.get('profile') || '';
      if (explicit) {
        return '_' + String(explicit).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      }
      // Auto-detect: sessionStorage is per-tab; if this tab already chose
      // a per-tab id (e.g. after a reload), reuse it. Otherwise check the
      // shared last_open timestamp — if another tab opened the game within
      // the last 3s, allocate a unique per-tab id to avoid save-race.
      var TAB_KEY = 'thebackrooms_tab_session_v1';
      var perTab = '';
      try { perTab = sessionStorage.getItem(TAB_KEY) || ''; } catch (e) {}
      if (perTab) return '_' + perTab;
      try {
        var OPEN_KEY = 'thebackrooms_last_open_v1';
        var lastOpen = parseInt(_rawLS.getItem(OPEN_KEY) || '0', 10);
        var now = Date.now();
        _rawLS.setItem(OPEN_KEY, String(now));
        if (lastOpen > 0 && (now - lastOpen) < 3000) {
          var tid = 't' + Math.random().toString(36).slice(2, 10);
          try { sessionStorage.setItem(TAB_KEY, tid); } catch (e) {}
          return '_' + tid;
        }
      } catch (e) {}
      return '';
    } catch (e) { return ''; }
  })();
  function _lsKey(k) { return SESSION_ID ? (k + SESSION_ID) : k; }
  // Shadow the global `localStorage` inside this IIFE so every existing call
  // automatically goes through the namespaced wrapper without touching call
  // sites.
  var localStorage = {
    getItem: function (k) { try { return _rawLS.getItem(_lsKey(k)); } catch (e) { return null; } },
    setItem: function (k, v) { try { _rawLS.setItem(_lsKey(k), v); } catch (e) {} },
    removeItem: function (k) { try { _rawLS.removeItem(_lsKey(k)); } catch (e) {} }
  };

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
    var stairsUp = [];
    var stairsDown = [];
    var weaponSpots = [];  // dedicated weapon-only pickup tiles ('w')
    var shopSpots = [];    // shopkeeper interaction tiles ('M') — open shop on action
    var secretSpots = [];  // secret doc tiles ('S') — pick up lore document on action
    var altarSpots = [];   // hidden-boss altar tiles ('A') — 祈り dialog → 隠しボス出現

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
          case 'U': t = 0; stairsUp.push({ gx: x, gy: y }); break;
          case 'd': t = 0; stairsDown.push({ gx: x, gy: y }); break;
          case 'w': t = 5; itemSpots.push({ gx: x, gy: y }); weaponSpots.push({ gx: x, gy: y }); break;
          case 'M': t = 0; shopSpots.push({ gx: x, gy: y }); break;
          case 'S': t = 0; secretSpots.push({ gx: x, gy: y }); break;
          case 'A': t = 0; altarSpots.push({ gx: x, gy: y }); break;
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
      safes: safes,
      stairsUp: stairsUp,
      stairsDown: stairsDown,
      weaponSpots: weaponSpots,
      shopSpots: shopSpots,
      secretSpots: secretSpots,
      altarSpots: altarSpots
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
    '#....D......##.....w..##',
    '#....#......##.....F..##',
    '##D###......##........##',
    '#...........##....i...##',
    '#.....#D....DD........##',
    '#.....#X#...##..#####.##',
    '#.....###...##..#...#.##',
    '#......##...##..#.n.#.##',
    '#......#....##..#D###.##',
    '######.D.####..........#',
    '#......#.#......n......#',
    '#.i..F.#.#............S#',
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
    '#..F.F.F............U............#',
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
    '#..F...FFFF..........n.........S.#',
    '#..F.................F......i....#',
    '#......F....X........F....w......#',
    '#......F.........FF..........d...#',
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
    '##D####~~~~~~~~~....@#',
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
    '#....D~~~..........S.#',
    '#....#~~~....X.......#',
    '#....#~~~....w.......#',
    '######################'
  ];

  // ── LEVEL 3 — ELECTRICAL STATION ────────────────────────
  // Dark, electric hazards, sparks
  // Lv3 — ELECTRICAL. Repopulated with broken-equipment F decor
  // (server racks, fallen wires, breaker panels) and an extra note +
  // safe-pocket s tile so the corridors don't feel like bare dungeon.
  var LV3_ROWS = [
    '####################',
    '#P.F...F....!....F.#',
    '#..F..F.F...!......#',
    '#.F.........F..n.F.#',
    '#.F...#####D####.F.#',
    '#.....#.F.....F.#..#',
    '#.F.F.#..i..F...#.F#',
    '#..n..#..F......#..#',
    '#..F..D.....F...#.w#',
    '#.F.F.#..F......#.F#',
    '#######!!!!!####...#',
    '#..F..#..F...#..F..#',
    '#.....#..i...#..F..#',
    '#..F..#.F....#.....#',
    '#..F..D...s..D.F.F.#', // central safe pocket s
    '#..F..#......#..F..#',
    '######...F....######',
    '#..F.F.......#..F..#',
    '#....F..X....D.n.i.#',
    '#.F.....F.F..#..F..#',
    '####################'
  ];

  // ── LEVEL 4 — ABANDONED OFFICE (open cubicle floor) ─────
  // Re-laid as an open office floor: low cubicle partitions (## islands)
  // dotting an open plan, central conference room, meeting pods. Skin-
  // Stealers hide between cubicles — from a distance their silhouettes
  // read as toppled office chairs, so the threat is hard to spot.
  // Lv4 — ABANDONED OFFICE. Cubicle islands ##### with decor scattered
  // between (papers, toppled chairs, plants). User feedback:
  // 「オブジェクトも少なく単調」 — open hallway space now reads as a
  // working office floor instead of empty corridor.
  var LV4_ROWS = [
    '##############################',
    '#P...F.......F.....F.........#',
    '#..####..####..####..####.F..#',
    '#..####.F####F.####F.####....#',
    '#...F........F............F..#',
    '#......F.....F.......F.......#',
    '#..####..####F.####..####....#',
    '#..####..####..####..####.i..#',
    '#......F.....F............F..#',
    '#.......######################',
    '#..F....#........F....F......#',
    '#.......#....#################',
    '#..F....#....#..............##',
    '#.......D....D....F.......F.##',
    '#.......#....#..............##',
    '#..F.F..#....#################',
    '#.......#.....i..............#',
    '#.......######################',
    '#..F.........F............F..#',
    '#..####..####..####..####....#',
    '#..####.F####.F####..####....#',
    '#......F.....F............F..#',
    '#..F.........F....F..........#',
    '#..####..####..####..####.U..#',
    '#..####F.####..####F.####...w#',
    '#......F.....F.......F.......#',
    '#..S....F...........F...d....#',
    '#........X..F....F......F....#',
    '##############################'
  ];

  // ── LEVEL 5 — THE HOTEL ─────────────────────────────────
  // Long carpet corridor with doors. Partygoers / Mr.Hotel
  // Lv5 redesigned as a Resident-Evil-style mansion. v3 fixes a critical
  // connectivity bug where the south exit room was unreachable because doors
  // in horizontal walls landed on top of vertical interior walls. v3 uses
  // BFS-verified connectivity: every door in a horizontal wall is flanked
  // north/south by open floor, every doorway in the south wall opens into a
  // wide exit corridor with the X tile. 2F stair pair (U at col 4, d at col 26)
  // teleports between locations to simulate a second floor.
  // ── LEVEL 5 — THE HOTEL ──────────────────────────────────
  // Lobby + front-desk room + guest-room corridor + back-of-house exit.
  // Top third = open lobby (the "inviting" part), middle row pair = the
  // front-desk closet and a small lounge (safe tile), then a row of small
  // guest rooms, then a connector with stairs, then a service corridor.
  // Lv5 — THE HOTEL. Long carpet corridor with rooms.
  // Repopulated with lobby furniture F (chairs, side tables, lamps,
  // overturned plants) so the corridor reads as a once-busy hotel
  // rather than empty hall.
  var LV5_ROWS = [
    '##############################',
    '#P.F.F.....F....F.....F.F....#', // entrance carpet decor
    '#....F.........F.........F...#',
    '#.F....F.....F....F....F.....#',
    '#....####D####....####D####..#',
    '#..F.#........#...#........#.#',
    '#....#...i....#...#...n....#.#',
    '#..F.#........D...D....s....##',
    '#....#...F....#...#.........##',
    '#..F.####D####....####D####.F#',
    '#....F.....F.......F.....F...#',
    '####D######D######D######D####',
    '#..F.#......#......#......#.F#',
    '#.i..#..F.n.#..F.n.#..F...D.i#',
    '#..F.#......#......#......#.F#',
    '####D######D######D######D####',
    '#....F.....F.......F.....F...#',
    '#.F.U....F.....F.........F.d.#',
    '#....F.....F.......F.....F...#',
    '##############D###############',
    '#......F.........F.........F.#',
    '#..F...n.........F....F.....X#',
    '#......F....F....F.........F.#',
    '##############################'
  ];

  // ── LEVEL 6 — LIGHTS OUT (stretch) ──────────────────────
  // Pitch dark, very short fog
  // Lv6 — LIGHTS OUT. Pitch-dark with very short fog distance. Even
  // empty floor is invisible, so excess F decor just clutters BFS
  // without adding visual feel. Decor restrained on purpose; still
  // bumped a couple corner motes so the player can find walls by
  // bumping landmarks. User feedback: 「オブジェクトも少なく単調」
  // — for Lv6 the *low* density IS the level identity, but corner
  // hint F bumps mark a few orientation points.
  var LV6_ROWS = [
    '##################',
    '#P...F........F..#',
    '#......F....F....#',
    '#..F............F#',
    '#.....######.....#',
    '#.....#....#.....#',
    '#..F..#..i.#..F..#',
    '#..F..#....#..F..#',
    '#.....D....D.....#',
    '#..F..........F..#',
    '#......n.........#',
    '#..F..F....F..F..#',
    '#.....##D###.....#',
    '#..F..#....#..F..#',
    '#.....#.X..#.....#',
    '#.....######.....#',
    '#..F...w......F..#',
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
  // ── LEVEL 11 — OFFICE DISTRICT (open plaza) ──────────────
  // Outdoor city block: open plaza in the middle, building footprints (##)
  // forming the storefronts and offices around the edges, civilians wandering,
  // a single 'M' marking the lone street vendor in this district. The user
  // explicitly wanted Lv11 to break the "enclosed building" pattern, so the
  // central plaza is wide-open with light cover from kiosks (single # blocks).
  // Lv11 redesigned 2026-06-07 — the original was an empty mall of ###
  // blocks. User feedback: 「オブジェクトも少なく単調」. Now packed with
  // F decor (street furniture: benches, planters, trash, signs), an s
  // safe pocket (bus stop cafe), more notes for lore, and a clearer
  // walking path between buildings.
  var LV11_ROWS = [
    '################################',
    '#P..F........F........F........#', // sidewalk, scattered street decor
    '#............F................i#',
    '#..####.F..####...F..####.....F#', // building row 1
    '#..####....####......####......#',
    '#..####.F..####...F..####....w.#',
    '#..F.........................F.#',
    '#....F.n....F.....F...n.F......#',
    '#..F.........#####.........F...#', // building row 2 (taller central)
    '#............#####...........F.#',
    '#....F.......#####.F......F....#',
    '#..............................#',
    '#..####.F..####....####.F....i.#', // building row 3
    '#..####....####....####........#',
    '#..####.F..####....####...F....#',
    '#..F....s.s....F...F.s.s...F...#', // bus stop cafe safe pockets
    '#.....M..F..F.................F#', // shop merchant
    '#..............F............i..#',
    '#..####....####.F..####........#',
    '#..####.F..####....####.F......#',
    '#..####....####.F..####........#',
    '#......n....F.....F....n.F.....#',
    '#..F.............F............F#',
    '#..F.........#####...........F.#', // building row 4
    '#............#####.F...........#',
    '#..F....F....#####.........F...#',
    '#......F.....F....F....F.......#',
    '#..F....F........X.....F....F..#',
    '################################'
  ];

  // ── LEVEL Fun =) (id 12) — ETERNAL PARTY ────────────────
  // Bright pink party hellscape with Partygoers
  // Lv12 — ETERNAL PARTY. Now strewn with party debris (F = confetti
  // piles, fallen streamers, plastic cups, torn paper hats). The empty
  // corridors between event rooms used to feel sterile — party levels
  // should look LIVED-IN with junk.
  var LV12_ROWS = [
    '######################',
    '#P.F..i..F.i..F.i.s.F#',
    '#..F....F.....F......#',
    '#..####D####D####.F..#',
    '#..#.F........#......#',
    '#..#.n....F...#..F...#',
    '#..#.....F....D...F..#',
    '#..#......i.F.#......#',
    '#..############..F...#',
    '#.F..F....F.F....F...#',
    '#......F.U..F..F.....#',
    '#..F..F..F..F....F...#',
    '#..############...d..#',
    '#..#..F.......#...F..#',
    '#..#......n.F.#..F...#',
    '#..#.F........D..n...#',
    '#..#..i....F..#..F...#',
    '#..####D####D####.F..#',
    '#..F....F....F....F..#',
    '#.F....i..F.X..F...F.#',
    '#..F....F.....F....F.#',
    '######################'
  ];

  // ── LEVEL 7 — RUN FOR YOUR LIFE (chase corridor) ────────
  // Long narrow corridor with Hound pack chasing from spawn end
  // Lv7 — THE INFINITE CORRIDOR. Repopulated with broken-floor F decor
  // and an extra note + secret-doc spawn so the chase corridor doesn't
  // feel like an empty pipe. User feedback: 「オブジェクトも少なく単調」
  var LV7_ROWS = [
    '########',
    '#P.F...#',
    '#.....F#',
    '#..F...#',
    '#.F..F.#',
    '#......#',
    '#..F.F.#',
    '#.F..F.#',
    '#...F..#',
    '#.F....#',
    '#.i..F.#',
    '#...F..#',
    '#.F....#',
    '#..F..F#',
    '#.F....#',
    '#...F.F#',
    '#.F.n..#',
    '#....S.#',
    '#.F....#',
    '#..n.F.#',
    '#.F....#',
    '#...F..#',
    '#.F.F..#',
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
    '#..#Fi#....#i.#....#FF#..#',
    '#..#ii#....#.n#....#i.#..#',
    '#..#..D....D..D....D..D..#',
    '#..####....####....####..#',
    '#........................#',
    '#....i..............i....#',
    '#........................#',
    '#..####....####....####..#',
    '#..#i.#....#FF#....#F.#..#',
    '#..#.n#....#i.#....#iF#..#',
    '#..#..D....D.i#....D..D..#',
    '#..####....####....####..#',
    '#....i..............i....#',
    '#............s...........#',
    '#........................#',
    '#..####....####....####..#',
    '#..#FF#....#iS#....#Fi#..#',
    '#..#ii#....#X.#....#ii#..#',
    '#..#..D....D..D....D..D..#',
    '#..####....####....####..#',
    '##########################'
  ];

  // ── LEVEL 13 — THE LIBRARY ─────────────────────────────
  // Dense bookshelf maze with reading rooms and a central reference desk.
  // Lots of narrow aisles to break up the "long corridor" feel.
  var LV13_ROWS = [
    '############################',
    '#P.........................#',
    '#.FFFFF..FFFFF..FFFFF..FFF.#',
    '#.F...F..F...F..F...F..F.F.#',
    '#.F.i.F..F.n.F..F...F..F.F.#',
    '#.F...D..D...D..D...D..D.F.#',
    '#.FFFFF..FFFFF..FFFFF..FFF.#',
    '#..........................#',
    '#..FFFFFFFFFF...FFFFFFFFF..#',
    '#..F............F........F.#',
    '#..F..i..n.....F..s......F.#',
    '#..F............F........F.#',
    '#..FFFFFFFFFFFFFFFFFFFFFFF.#',
    '#......U...................#',
    '#.FFF..FFFFF..FFFFF..FFFFF.#',
    '#.F.F..F...F..F...F..F...F.#',
    '#.F.F..D.n.D..D.i.D..D...D.#',
    '#.F.F..F...F..F...F..F...F.#',
    '#.FFF..FFFFF..FFFFF..FFFFF.#',
    '#..........................#',
    '#.....A....X...........d...#',
    '############################'
  ];

  // ── LEVEL 14 — THE TRENCH ──────────────────────────────
  // Flooded corridors of an abandoned undersea station. Water tiles drain
  // SAN; column rooms hold items between the channels.
  var LV14_ROWS = [
    '##########################',
    '#P~~~~~~~~~~~~~~~~~~~~~~~#',
    '#.....FF....FF.....FF....#',
    '#.i..FFF....FFF...FFF..n.#',
    '#.....FF....FF.....FF....#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#FFFF......FFFF......FFFF#',
    '#F..F..F...F..F..F...F..F#',
    '#F..D..F.s.F..D..F...F..F#',
    '#FFFF..F...FFFF..F...FFFF#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#......FFFFFFFFFFF.......#',
    '#..F...F.........F....n..#',
    '#......F.U..i....F....d..#',
    '#......FFFFFFFFFFF...F...#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#.....FFFF....FFFF.......#',
    '#.n...F..D....D..F...i...#',
    '#.....F..F....F..F.......#',
    '#.....FFFF....FFFF.......#',
    '#~~~~~~~~~~~~~~~~~~~X~~~~#',
    '##########################'
  ];

  // ── LEVEL 15 — THE GARDEN ──────────────────────────────
  // Eternal greenhouse: concentric hedge maze with item nodes inside.
  var LV15_ROWS = [
    '##########################',
    '#P..F....F....F....F....F#',
    '#FFFFFFFFFFFFFFFFFFFFFFFF#',
    '#F......i...n...........F#',
    '#F...F....F....F....F...F#',
    '#F......................F#',
    '#F...F....F....D....F...F#',
    '#F..........s...........F#',
    '#F...F....F....F....F...F#',
    '#F......................F#',
    '#F...D....F.i..F....F...F#',
    '#F......................F#',
    '#F...F..n.F....F....D...F#',
    '#F......................F#',
    '#F...F....F....F....F...F#',
    '#F..........i...........F#',
    '#FFFFFFFFFFFFFFFFFFFFFFFF#',
    '#........................#',
    '#.......................X#',
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
    11: { // Office district — light, open city after the train tunnel.
          // Shops, civilians, a brief reprieve before deeper levels.
      wall: {
        upper: { 'default': [200, 195, 180], 1: [200, 195, 180], 2: [170, 160, 140] },
        lower: { 'default': [120, 110, 95], 1: [120, 110, 95] },
        pattern: 'brick',
        splitRatio: 0.6,
        railColor: [80, 70, 55]
      },
      bg: {
        // Open sky overhead + dusty street underfoot — feels outdoors
        ceiling: ['#7a8aa0', '#8c9cb0', '#a0afc0'],
        floor:   ['#2e2820', '#403828', '#544838']
      },
      floorDefault: [80, 72, 56],
      ceilingDefault: [150, 158, 175],
      fogDist: 14,
      ambientLoop: 'wind',
      sanDrain: 0.2,   // safe district — SAN drain minimal
      vignette: 0.25,
      grain: 0.2,
      chromatic: 0.05
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
    9: { // Suburbs — open night sky over dark houses (more "outdoor")
      wall: {
        upper: { 'default': [70, 68, 80], 1: [70, 68, 80] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        // Storm sky: deep purple zenith → indigo horizon
        ceiling: ['#0c0820', '#181440', '#3a2860'],
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
    },
    14: { // THE TRENCH — deep teal, bioluminescent flecks
      wall: {
        upper: { 'default': [20, 60, 80], 1: [20, 60, 80] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        ceiling: ['#020608', '#04101c', '#08182c'],
        floor:   ['#020608', '#06141e', '#0a1c2a']
      },
      floorDefault: [20, 50, 70],
      ceilingDefault: [10, 30, 50],
      fogDist: 9,
      ambientLoop: 'pipe_drip',
      sanDrain: 1.1,
      vignette: 0.55,
      grain: 0.35,
      chromatic: 0.25
    },
    15: { // THE GARDEN — overgrown outdoor sky over moss-covered walls
      wall: {
        upper: { 'default': [40, 80, 30], 1: [40, 80, 30] },
        flat: true,
        pattern: 'concrete'
      },
      bg: {
        // Overcast dusk sky → wet leaves below. Feels exterior.
        ceiling: ['#8a98a8', '#7a8a98', '#5a7080'],
        floor:   ['#0a1408', '#162818', '#243020']
      },
      floorDefault: [30, 60, 28],
      ceilingDefault: [110, 130, 150],
      fogDist: 12,
      ambientLoop: 'wind',
      sanDrain: 0.7,
      vignette: 0.4,
      grain: 0.3,
      chromatic: 0.15
    }
  };

  // ── LEVEL DESCRIPTORS ───────────────────────────────────
  var LEVELS = {
    0: { id: 0, name: 'LEVEL 0', subtitle: 'THE LOBBY',
         rows: LV0_ROWS, theme: 0,
         hint: '黄色い壁紙の無限の部屋。湿った絨毯。蛍光灯のハム音。\n稀に「もう一人の自分」が現れる。「観測者」が遠くで見ている。',
         intro: '壁を抜けた先...黄色い廊下が、どこまでも。',
         entities: [
           { type: 'echo', gx: 17, gy: 11 },
           { type: 'echo', gx: 8,  gy: 8  },  // ambient echo in opposite corner
           { type: 'witness', gx: 10, gy: 18 } // far-side voyeur, SAN drain only
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
         hint: '配管の迷路。足元の水が SAN を削る。\n配管の隙間から「観測者」が覗いている。',
         intro: '配管から水が滴る音。空気が湿っている。',
         entities: [
           { type: 'smiler', gx: 12, gy: 12 },
           { type: 'witness', gx: 5, gy: 5 },   // far-corner voyeur
           { type: 'crawler', gx: 18, gy: 18 }  // lurking in the deep pipe
         ],
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
         hint: '広いオフィスフロア。低いキュービクル仕切りの間に Skin-Stealer が紛れる。',
         intro: '誰もいないオフィス。会議室の戸が半開きで揺れている。',
         entities: [
           { type: 'skinstealer', gx: 16, gy: 5 },
           { type: 'skinstealer', gx: 26, gy: 21 },
           { type: 'skinstealer', gx: 4,  gy: 18 }
         ],
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
         hint: '完全な暗闇。視界は極端に短い。\n暗闇の中で、何かが立って、お前を見ている。',
         intro: '光が消えた。何も見えない。\n── だが、向こうは、お前が見える。',
         entities: [
           { type: 'hound', gx: 8, gy: 8 },
           { type: 'witness', gx: 3, gy: 10 },
           { type: 'witness', gx: 13, gy: 3 }
         ],
         timeLimit: null },
    7: { id: 7, name: 'LEVEL 7', subtitle: 'RUN FOR YOUR LIFE',
         rows: LV7_ROWS, theme: 7,
         hint: '一直線の回廊。背後から複数のHoundが迫る。HARUKI の声も混じる。',
         intro: '吠え声...そして、女の声。前へ走るしかない。',
         // Spawn pushed several tiles down the corridor so the player has
         // visual + movement runway. Lv7 is "RUN FOR YOUR LIFE" — chase, not ambush.
         entities: [
           { type: 'hound',  gx: 4, gy: 8 },
           { type: 'hound',  gx: 3, gy: 13 },
           { type: 'hound',  gx: 5, gy: 17 },
           { type: 'haruki', gx: 4, gy: 11 }
         ],
         timeLimit: null },
    8: { id: 8, name: 'LEVEL 8', subtitle: 'THE HIVE',
         rows: LV8_ROWS, theme: 8,
         hint: '六角形のセル。吊るされた何かが揺れている。\n角の影から、何かがついてくる。',
         intro: '甘い腐臭。蜂の巣のような部屋が並ぶ。\n背後の足音が、止まったり、また鳴ったり。',
         entities: [
           { type: 'smiler', gx: 8, gy: 14 },
           { type: 'partygoer', gx: 14, gy: 8 },
           { type: 'lurker', gx: 2, gy: 6 },
           { type: 'lurker', gx: 18, gy: 20 },
           // sd_8 kill-target stays — FACELING was already required to drop the doc
           { type: 'faceling', gx: 12, gy: 8 }
         ],
         timeLimit: null },
    11: { id: 11, name: 'LEVEL !', subtitle: 'OFFICE DISTRICT',
         rows: LV11_ROWS, theme: 11,
         hint: 'オフィス街の屋外プラザ。露店主 (M) と中立の人々。\n彼らは攻撃されない限り反撃しない。コインで品を買おう。',
         intro: '駅を抜けた...空が広い。露店の声、行き交う人。',
         entities: [
           { type: 'civilian', gx: 8,   gy: 16 }, // shopkeeper at the M tile
           { type: 'civilian', gx: 16,  gy: 6 },
           { type: 'civilian', gx: 22,  gy: 11 },
           { type: 'civilian', gx: 18,  gy: 16 },
           { type: 'civilian', gx: 24,  gy: 18 },
           { type: 'civilian', gx: 12,  gy: 22 },
           { type: 'civilian', gx: 20,  gy: 26 }
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
    13: { id: 13, name: 'LEVEL 13', subtitle: 'THE LIBRARY',
          rows: LV13_ROWS, theme: 5,
          hint: '無限の書架。本に触れると過去のささやきが聞こえる。\n奥に祭壇 (A) があるが、近付かない方が良いとも噂される。',
          intro: '紙の匂い。誰も読まない文献が、私たちを読んでいる。\n中央付近に石造りの祭壇 — 誰かが祈りを捧げ続けている。',
          entities: [
            { type: 'smiler', gx: 14, gy: 12 },
            { type: 'partygoer', gx: 5, gy: 16 },
            { type: 'hound', gx: 24, gy: 4 },
            { type: 'witness', gx: 12, gy: 17 } // standing near the altar, dead-eyed
          ],
          timeLimit: null },
    9: { id: 9, name: 'LEVEL 9', subtitle: 'THE SUBURBS',
         rows: LV9_ROWS, theme: 9,
         hint: 'ハルキを倒さなければ THE END の扉は開かない。武器をかき集めろ。\n影 (SHADOW) はハルキの随伴 — 光源で抑えろ。',
         intro: '空に月はない。月のような何かがある。— ハルキが、待っている。\nその周りで、影が、揺れている。',
         entities: [
           { type: 'haruki_boss', gx: 12, gy: 9 },
           { type: 'crawler', gx: 5, gy: 16 },
           { type: 'hound', gx: 18, gy: 7 },
           { type: 'hound', gx: 4, gy: 8 },
           { type: 'skinstealer', gx: 19, gy: 17 },
           { type: 'shadow', gx: 9, gy: 11 },
           { type: 'shadow', gx: 15, gy: 11 }
         ],
         bossRequired: true, // exit door locked until boss is dead
         timeLimit: null },
    14: { id: 14, name: 'LEVEL 14', subtitle: 'THE TRENCH',
          rows: LV14_ROWS, theme: 14,
          hint: '海底のごとき廃ステーション。床のほとんどが浸水しSANを削る。\n溺死者 (DROWNED) が水中を走る — 懐中電灯で抑えろ。',
          intro: '塩の匂い。足元は水。— 深くまで、降りて来てしまった。\n水面下で、何かが動いた。',
          entities: [
            { type: 'crawler', gx: 8, gy: 8 },
            { type: 'skinstealer', gx: 18, gy: 13 },
            { type: 'drowned', gx: 12, gy: 1 },
            { type: 'drowned', gx: 6, gy: 15 }
          ],
          timeLimit: null },
    15: { id: 15, name: 'LEVEL 15', subtitle: 'THE GARDEN',
          rows: LV15_ROWS, theme: 15,
          hint: '永遠に手入れされ続ける温室の生垣迷路。中心に何かを隠している。\nハルキの気配を感じる。',
          intro: '緑の匂い — 朽ちていない、しかし生きてもいない。\n生垣の奥で、ハルキが微笑んでいる。',
          entities: [
            { type: 'faceling', gx: 12, gy: 8 },
            { type: 'hound', gx: 18, gy: 14 },
            { type: 'haruki', gx: 15, gy: 17 },
            { type: 'vinewalker', gx: 5, gy: 5 },
            { type: 'vinewalker', gx: 20, gy: 11 }
          ],
          timeLimit: null }
  };

  // ── ITEM DEFINITIONS ────────────────────────────────────
  // Each item type: id, name, icon, description, effect()
  var ITEMS = {
    almond_water: {
      id: 'almond_water', name: 'アーモンドウォーター',
      icon: '🥤', desc: 'バックルームで最も普通の飲料。SAN を回復する。',
      useSound: 'gulp',
      effect: function (p) { p.san = Math.min(p.sanMax, p.san + 35); toast('SAN +35'); }
    },
    bandage: {
      id: 'bandage', name: '応急手当キット',
      icon: '🩹', desc: '出血を止め、HP を大きく回復する。',
      useSound: 'unwrap',
      effect: function (p) { p.hp = Math.min(p.hpMax, p.hp + 50); toast('HP +50'); }
    },
    energy_bar: {
      id: 'energy_bar', name: 'エナジーバー',
      icon: '🍫', desc: 'スタミナを満タンにする。',
      useSound: 'crunch',
      effect: function (p) { p.stam = p.stamMax; toast('STA 全回復'); }
    },
    flashlight: {
      id: 'flashlight', name: '懐中電灯',
      icon: '🔦', desc: '暗所で視界を広げる。1個=約100秒。バッテリー切れで自動消灯、所持があれば自動交換。',
      persistent: true,
      effect: function (p) {
        if (p.flashlightOn) {
          p.flashlightOn = false;
          toast('懐中電灯 OFF (残量 ' + Math.round(p.flashlightBattery || 0) + '%)');
        } else {
          // Battery empty? consume one item (use logic doesn't auto-deduct
          // because flashlight is persistent; we manually decrement here).
          if ((p.flashlightBattery || 0) <= 0) {
            if ((p.inventory.flashlight || 0) > 1) {
              p.inventory.flashlight--;
              p.flashlightBattery = 100;
              toast('予備バッテリー装填 100%');
            } else {
              toast('バッテリー切れ — 予備なし');
              return;
            }
          }
          p.flashlightOn = true;
          toast('懐中電灯 ON (残量 ' + Math.round(p.flashlightBattery) + '%)');
        }
      }
    },
    keycard: {
      id: 'keycard', name: 'カードキー',
      icon: '🔑', desc: 'どこかのドアを解錠できる...かもしれない。',
      useSound: 'key_unlock',
      effect: function (p) { toast('特定の場所で自動使用'); }
    },
    voucher: {
      id: 'voucher', name: 'ホテル引換券',
      icon: '🎫', desc: 'THE HOTEL で特別な部屋へ案内される。',
      useSound: 'paper',
      effect: function (p) { toast('特定の場所で自動使用'); }
    },
    radio: {
      id: 'radio', name: '壊れたラジオ',
      icon: '📻', desc: 'ノイズの中に時折声が聞こえる。エンティティを察知できる。トグル式。',
      persistent: true,
      useSound: 'static',
      effect: function (p) {
        if (p.radioOn) { p.radioOn = false; toast('ラジオ OFF'); }
        else { p.radioOn = true; toast('ラジオ ON — エンティティ警告'); }
      }
    },
    flare: {
      id: 'flare', name: 'フレア',
      icon: '🔥', desc: '点火。周囲6マスのエンティティを4秒スタン + Boss に 50 ダメージ。HP+10。',
      useSound: 'static', // hiss + ignite
      category: 'weapon',
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
            e._lastHitAt = performance.now(); // sprite hit-flash
            stunned++;
            if (e.type === 'boss' || e.type === 'haruki_boss') {
              e.bossHp = (e.bossHp !== undefined ? e.bossHp : 200) - 50;
              bossHit++;
              if (e.bossHp <= 0) {
                e.alive = false;
                toast(e.type === 'haruki_boss' ? '★ ハルキ 撃破! ★' : 'BOSS 撃破!');
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
      category: 'weapon',
      effect: function (p) {
        var reflected = 0;
        var bossDmg = 0;
        for (var i = 0; i < entities.length; i++) {
          var e = entities[i];
          if (!e.alive) continue;
          if (e.type === 'skinstealer') {
            e.alive = false;
            e.deathAt = performance.now(); // pick up the death fade
            reflected++;
          } else if (e.type === 'boss' || e.type === 'haruki_boss') {
            var dx = e.x - p.x, dy = e.y - p.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < 8 * TS) {
              e.bossHp = (e.bossHp !== undefined ? e.bossHp : 200) - 100;
              e._lastHitAt = performance.now();
              e._hitWasCrit = true; // mirror vs boss is a designated weakness
              bossDmg++;
              if (e.bossHp <= 0) {
                e.alive = false;
                toast(e.type === 'haruki_boss' ? '★ ハルキ 撃破! ★' : 'BOSS 撃破!');
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
      useSound: 'gulp',
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
      useSound: 'unwrap',
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
      useSound: 'key_unlock',
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

  // ============================================================
  //  WEAPONS — directional ranged / melee attacks against entities
  //  Stored in player.inventory just like items (count = ammo / durability).
  //  category:'weapon' triggers the D-pad weapon mode usage.
  // ============================================================
  // Helper: damage the nearest entity that lies inside a forward cone
  // (angle in radians, distance in tiles). Returns the affected entity or null.
  // Show a brief muzzle-flash overlay. CSS class .show triggers the animation
  // (defined in game.css). Class is removed after the animation length so
  // rapid fire restarts the flash cleanly.
  function _muzzleFlash(color) {
    var mf = el('muzzleFlash');
    if (!mf) return;
    if (color) mf.style.color = color;
    mf.classList.remove('show');
    void mf.offsetWidth;
    mf.classList.add('show');
    setTimeout(function () { mf.classList.remove('show'); }, 220);
  }

  // ── Bullet tracers ──
  // Brief streak from the muzzle (lower-center screen) to the hit point
  // (or to the in-front max range if the shot missed). Adds the visceral
  // confirmation that the gun actually projected something into the world
  // — previously firing a pistol was only audio + screen shake + a screen
  // flash, with no spatial cue of where the bullet went. Pure render-time
  // effect, no physics — tracers don't interact with anything.
  var tracers = []; // { worldEndX, worldEndY, life, lifeMax, color, width }
  var TRACER_MAX = 12;
  function _spawnTracer(p, opts) {
    if (tracers.length >= TRACER_MAX) tracers.shift();
    var ex, ey;
    if (opts.hit) {
      ex = opts.hit.x;
      ey = opts.hit.y;
    } else {
      // Miss — project straight in front of the player to rangeTiles.
      var r = (opts.rangeTiles || 8) * TS;
      ex = p.x + Math.cos(p.angle) * r;
      ey = p.y + Math.sin(p.angle) * r;
    }
    // Per-shot lateral jitter so back-to-back shots don't draw the same
    // line. Small, in world space, so far targets get more visual spread.
    var jitterAng = (Math.random() - 0.5) * 0.04;
    var dEx = ex - p.x, dEy = ey - p.y;
    var len = Math.sqrt(dEx * dEx + dEy * dEy) || 1;
    var jx = -dEy / len * jitterAng * len;
    var jy =  dEx / len * jitterAng * len;
    tracers.push({
      worldEndX: ex + jx,
      worldEndY: ey + jy,
      life: 0.12, lifeMax: 0.12,
      color: opts.color || 'rgba(255,240,180,0.95)',
      width: opts.width || 2
    });
  }
  function updateTracers(dt) {
    if (!tracers.length) return;
    for (var i = tracers.length - 1; i >= 0; i--) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) tracers.splice(i, 1);
    }
  }
  function drawTracers(ctx) {
    if (!tracers.length || !player) return;
    var w = GameEngine.width;
    var h = GameEngine.height;
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    // Origin: lower-center screen (where the gun nozzle is on the HUD).
    // Slightly to the right so the line reads as coming from a hand-gun
    // on the player's right side.
    var oX = w * 0.55;
    var oY = h * 0.72;
    for (var i = 0; i < tracers.length; i++) {
      var t = tracers[i];
      var dx = t.worldEndX - player.x;
      var dy = t.worldEndY - player.y;
      var tX = -dx * sinT + dy * cosT;
      var tY = dx * cosT + dy * sinT;
      if (tY <= 0.1) continue;
      var sx = (w / 2) * (1 + tX / tY);
      var sy = h / 2; // shoot through the reticle vertical
      var lifeR = t.life / t.lifeMax;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Outer halo
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width * 2.6 * lifeR;
      ctx.globalAlpha = 0.35 * lifeR;
      ctx.beginPath();
      ctx.moveTo(oX, oY);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      // Hot core
      ctx.lineWidth = Math.max(1, t.width * lifeR);
      ctx.globalAlpha = 0.95 * lifeR;
      ctx.beginPath();
      ctx.moveTo(oX, oY);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.restore();
    }
  }
  window._spawnTracer = _spawnTracer;
  // Spray blood/spark particles from the hit point toward the player. tinge
  // chooses the particle palette per weapon flavour.
  function _hitParticles(target, count, tinge) {
    if (!GameEngine.addParticle) return;
    for (var pi = 0; pi < count; pi++) {
      var spread = (Math.random() - 0.5) * 30;
      GameEngine.addParticle(tinge || 'spark',
        target.x + spread, target.y + spread);
    }
  }
  // ── Floating damage number popups ──
  // Spawn a short-lived screen-anchored DOM element showing the damage value.
  // We anchor at screen center (where the reticle is) and apply a small random
  // horizontal offset so rapid multi-shots don't perfectly stack.
  function _spawnDamagePopup(dmg, opts) {
    opts = opts || {};
    if (typeof document === 'undefined' || !document.body) return;
    var rounded = Math.max(1, Math.round(dmg));
    var node = document.createElement('div');
    node.className = 'damage-popup';
    if (opts.kill)      node.classList.add('kill');
    else if (opts.crit) node.classList.add('crit');
    node.textContent = opts.kill ? (rounded + ' KILL') : String(rounded);
    var dx = (Math.random() - 0.5) * 80; // -40..40 px
    node.style.setProperty('--dx', dx.toFixed(1) + 'px');
    document.body.appendChild(node);
    setTimeout(function () {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }, 900);
  }
  // ── ALTAR / HIDDEN BOSS ──
  // Opens a yes/no prompt 「祈りを捧げますか？」. Picking はい spawns the
  // hidden boss next to the altar. Picking いいえ closes the prompt.
  // Players can still no-clip to the next level without killing the boss,
  // but they forfeit the eternal_charm reward this run.
  function openAltarPrompt(altarIdx) {
    var promptEl = el('promptOverlay');
    if (!promptEl) return;
    var textEl = el('promptText');
    if (textEl) textEl.textContent = '— この祭壇に、祈りを捧げますか？';
    showOverlay('promptOverlay');
    var yes = el('promptYesBtn');
    var no  = el('promptNoBtn');
    var done = false;
    function close() {
      hideOverlay('promptOverlay');
      try { yes.removeEventListener('click', onYes); } catch (e) {}
      try { no.removeEventListener('click', onNo); } catch (e) {}
      try { promptEl.removeEventListener('click', onBackdrop); } catch (e) {}
    }
    function onYes(e) {
      if (e) e.stopPropagation();
      if (done) return; done = true;
      close();
      spawnHiddenBossNearAltar(altarIdx);
    }
    function onNo(e) {
      if (e) e.stopPropagation();
      if (done) return; done = true;
      close();
      toast('祭壇は静かなままだった。');
    }
    function onBackdrop(e) {
      if (e.target !== promptEl) return; // ignore clicks on the card
      onNo();
    }
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    promptEl.addEventListener('click', onBackdrop);
  }

  function spawnHiddenBossNearAltar(altarIdx) {
    if (!currentMap || !currentMap.altarSpots) return;
    var alt = currentMap.altarSpots[altarIdx];
    if (!alt) return;
    // Remove altar tile so re-prayer isn't possible until next visit.
    currentMap.altarSpots.splice(altarIdx, 1);
    // Find a walkable tile in the 8-neighborhood of the altar — wrap around
    // the altar so the boss can never spawn inside a wall.
    var candidates = [
      [alt.gx,     alt.gy - 1], // above
      [alt.gx + 1, alt.gy],     // right
      [alt.gx - 1, alt.gy],     // left
      [alt.gx,     alt.gy + 1], // below
      [alt.gx + 1, alt.gy - 1],
      [alt.gx - 1, alt.gy - 1],
      [alt.gx + 1, alt.gy + 1],
      [alt.gx - 1, alt.gy + 1],
      [alt.gx,     alt.gy]      // altar tile itself
    ];
    var spawnGx = alt.gx, spawnGy = alt.gy;
    for (var ci = 0; ci < candidates.length; ci++) {
      var cx = candidates[ci][0], cy = candidates[ci][1];
      if (cy < 0 || cx < 0 || cy >= currentMap.height || cx >= currentMap.width) continue;
      var tt = currentMap.tiles[cy] && currentMap.tiles[cy][cx];
      // tile 0 = open floor (walkable). Anything non-wall accepted.
      if (tt === 0) { spawnGx = cx; spawnGy = cy; break; }
    }
    // Spawn the hidden boss as a haruki_boss with elevated HP and an inflated
    // bossHp so it lives through several full magazines.
    entities.push({
      type: 'haruki_boss',
      x: spawnGx * TS + TS / 2,
      y: spawnGy * TS + TS / 2,
      angle: 0,
      state: 'wait',
      stateTimer: 0,
      alive: true,
      hp: 999,
      bossHp: 1500,    // bumped 500 → 1500 with the rest of the 2026-06-07
      bossHpMax: 1500, // boss durability pass — the hidden boss is THE
      color: getEntityColor('haruki_boss'), // bonus encounter, must feel like one
      bodyColor: '#180004',
      _isHidden: true
    });
    toast('★ 祭壇の影から、何かが立ち上がった。');
    if (audioInitialized) {
      try { GameEngine.playSound('jumpscare'); } catch (e) {}
      try { GameEngine.playSound('whisper'); } catch (e) {}
    }
    GameEngine.shakeScreen(28, 1.4);
    // TTS line — voice the boss reveal so the moment lands harder.
    try { _uncannySpeak('呼んだか。'); } catch (e) {}
    unlockAchievement('altar_pray');
  }

  // Called from _grantCoinsForKill when a haruki_boss dies. If it was the
  // altar-spawned hidden one, drop the eternal_charm reward + persistent flag.
  var HIDDEN_BOSS_FLAG_KEY = 'thebackrooms_hidden_boss_kill_v1';
  function grantEternalCharmIfHidden(entity) {
    if (!entity || !entity._isHidden) return;
    try { localStorage.setItem(HIDDEN_BOSS_FLAG_KEY, '1'); } catch (e) {}
    player.inventory.eternal_charm = 1;
    unlockAchievement('hidden_boss_kill');
    toast('★ 永遠の護符を手に入れた。');
    if (audioInitialized) try { GameEngine.playSound('level_clear'); } catch (e) {}
  }
  function hasEternalCharm() {
    try { return localStorage.getItem(HIDDEN_BOSS_FLAG_KEY) === '1'; } catch (e) { return false; }
  }
  window.hasEternalCharm = hasEternalCharm;

  // ── SHOP (Lv11 office-district vendor) ──
  // Items the shop can stock. Prices in coins. Each visit picks a random
  // subset of SHOP_GENERAL plus exactly one SHOP_UNIQUE pick (★ flagged).
  var SHOP_GENERAL = [
    { id: 'bandage',      price: 25 },
    { id: 'almond_water', price: 30 },
    { id: 'energy_bar',   price: 28 },
    { id: 'flashlight',   price: 60 },
    { id: 'flare',        price: 70 },
    { id: 'pistol',       price: 120 },
    { id: 'katana',       price: 150 },
    { id: 'shotgun',      price: 200 }
  ];
  var SHOP_UNIQUE = [
    { id: 'soul_lantern',    price: 350 },
    { id: 'haruki_charm',    price: 400 },
    { id: 'architect_blade', price: 500 },
    { id: 'siren_whistle',   price: 320 },
    { id: 'mirror_shard',    price: 380 },
    { id: 'revenant_blade',  price: 450 },
    { id: 'void_grenade',    price: 340 }
  ];
  var shopState = { stock: null, panel: 'buy' };
  function generateShopStock() {
    // 4 random general items + 1 unique. Re-seeded each time the shop opens
    // for the first time on a level (persisted in shopState until level change).
    var pool = SHOP_GENERAL.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var general = pool.slice(0, 4);
    var unique = SHOP_UNIQUE[Math.floor(Math.random() * SHOP_UNIQUE.length)];
    return { general: general, unique: unique };
  }
  function openShop() {
    if (!shopState.stock) shopState.stock = generateShopStock();
    shopState.panel = 'buy';
    renderShop();
    showOverlay('shopOverlay');
    if (audioInitialized) GameEngine.playSound('phone_open');
  }
  function closeShop() {
    hideOverlay('shopOverlay');
    if (audioInitialized) GameEngine.playSound('phone_close');
  }
  function renderShop() {
    var coinsEl = el('shopCoinsDisplay');
    if (coinsEl) coinsEl.textContent = player.coins || 0;
    // Tab visibility
    el('shopPanelBuy').style.display  = shopState.panel === 'buy'  ? 'block' : 'none';
    el('shopPanelSell').style.display = shopState.panel === 'sell' ? 'block' : 'none';
    var tabs = document.querySelectorAll('.shop-tab');
    for (var ti = 0; ti < tabs.length; ti++) {
      tabs[ti].classList.toggle('active', tabs[ti].getAttribute('data-shop-tab') === shopState.panel);
    }
    // Buy grid
    var buyGrid = el('shopBuyGrid');
    buyGrid.innerHTML = '';
    var stk = shopState.stock || { general: [], unique: null };
    stk.general.forEach(function (entry) {
      buyGrid.appendChild(makeShopRow(entry.id, entry.price, false));
    });
    if (stk.unique) buyGrid.appendChild(makeShopRow(stk.unique.id, stk.unique.price, true));
    // Sell grid
    var sellGrid = el('shopSellGrid');
    sellGrid.innerHTML = '';
    var invKeys = Object.keys(player.inventory).filter(function (id) {
      // Persistent items (flashlight, radio, eternal_charm) aren't sellable —
      // they're either gameplay-critical equipment or the永遠の護符 reward.
      if (ITEMS[id] && ITEMS[id].persistent) return false;
      return player.inventory[id] > 0 && ITEMS[id];
    });
    if (invKeys.length === 0) {
      sellGrid.innerHTML = '<p class="shop-empty">売れる物がない</p>';
    } else {
      invKeys.forEach(function (id) {
        // Sell price = half the buy price if we have one, else 15 coin floor.
        var ref = SHOP_GENERAL.concat(SHOP_UNIQUE).find(function (p) { return p.id === id; });
        var sellPrice = ref ? Math.floor(ref.price * 0.5) : 15;
        sellGrid.appendChild(makeSellRow(id, sellPrice));
      });
    }
  }
  function makeShopRow(itemId, price, isUnique) {
    var item = ITEMS[itemId];
    var row = document.createElement('div');
    row.className = 'shop-row' + (isUnique ? ' unique' : '');
    var afford = (player.coins || 0) >= price;
    if (!afford) row.classList.add('disabled');
    var shopIconHtml = WEAPON_SVG[itemId]
      ? '<span class="shop-row-icon shop-row-svg">' + WEAPON_SVG[itemId] + '</span>'
      : '<span class="shop-row-icon">' + (item ? item.icon : '?') + '</span>';
    row.innerHTML =
      shopIconHtml +
      '<div class="shop-row-info">' +
        '<div class="shop-row-name">' + (item ? item.name : itemId) + '</div>' +
        '<div class="shop-row-desc">' + (item && item.desc ? item.desc.slice(0, 32) : '') + '</div>' +
      '</div>' +
      '<div class="shop-row-price">🪙 ' + price + '</div>';
    row.addEventListener('click', function () {
      if (!afford) {
        toast('コイン不足: あと ' + (price - (player.coins || 0)));
        return;
      }
      player.coins -= price;
      // Weapons gain a random ammo count, same rule as world pickups, so a
      // purchased pistol gives 2-4 shots instead of a single shot for 120
      // coins. Non-weapons add +1 as before.
      var addAmt = (item && item.category === 'weapon') ? _rollWeaponPickupCount(itemId) : 1;
      player.inventory[itemId] = (player.inventory[itemId] || 0) + addAmt;
      var nameStr = (item ? item.name : itemId) + (addAmt > 1 ? ' (×' + addAmt + ')' : '');
      toast('購入: ' + nameStr);
      if (audioInitialized) GameEngine.playSound('item_get');
      unlockAchievement('first_purchase');
      if (isUnique) unlockAchievement('bought_unique');
      renderShop();
    });
    return row;
  }
  function makeSellRow(itemId, price) {
    var item = ITEMS[itemId];
    var row = document.createElement('div');
    row.className = 'shop-row';
    var cnt = player.inventory[itemId] || 0;
    var sellIconHtml = WEAPON_SVG[itemId]
      ? '<span class="shop-row-icon shop-row-svg">' + WEAPON_SVG[itemId] + '</span>'
      : '<span class="shop-row-icon">' + (item ? item.icon : '?') + '</span>';
    row.innerHTML =
      sellIconHtml +
      '<div class="shop-row-info">' +
        '<div class="shop-row-name">' + (item ? item.name : itemId) + ' ×' + cnt + '</div>' +
        '<div class="shop-row-desc">' + (item && item.desc ? item.desc.slice(0, 32) : '') + '</div>' +
      '</div>' +
      '<div class="shop-row-price">+ 🪙 ' + price + '</div>';
    row.addEventListener('click', function () {
      if ((player.inventory[itemId] || 0) <= 0) return;
      player.inventory[itemId]--;
      if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
      player.coins = (player.coins || 0) + price;
      toast('売却: ' + (item ? item.name : itemId) + ' +🪙' + price);
      if (audioInitialized) GameEngine.playSound('ui_tap');
      unlockAchievement('first_sale');
      renderShop();
    });
    return row;
  }
  // Expose for inline triggers (action on shopkeeper tile)
  window.openShop = openShop;

  // Drop coins on enemy kill. Tuned so a careful run accumulates enough for
  // the Lv11 shop without making weapons feel pointless to use.
  var COIN_DROPS = {
    crawler: 2, hound: 3, smiler: 4, skinstealer: 6, wretch: 5,
    haruki: 8, echo: 3, faceling: 4, boss: 30, haruki_boss: 100,
    // Civilians are neutral — killing them gives a token coin (1) but a heavy
    // SAN hit (handled in _grantCoinsForKill) so it's never the easy path.
    civilian: 1,
    witness: 4,
    lurker: 5,
    shadow: 6,
    drowned: 5,
    vinewalker: 5
  };
  function _grantCoinsForKill(type, entity) {
    var amt = COIN_DROPS[type] || 1;
    player.coins = (player.coins || 0) + amt;
    if (amt >= 10) toast('+ ' + amt + ' コイン');
    // Track lifetime defeats for the bestiary. Stores count + first-kill
    // timestamp + last-kill level + (for bosses) the bossHp HP max so the
    // panel can show 「初討伐 / 最終討伐 / HP 上限」.
    try {
      var entry = defeatedEntities[type];
      if (typeof entry !== 'object') {
        entry = { count: (entry || 0), firstAt: Date.now(), lastLevel: currentLevel };
      }
      entry.count = (entry.count || 0) + 1;
      entry.lastAt = Date.now();
      entry.lastLevel = currentLevel;
      if (entity) {
        if (entity.bossHp !== undefined && (!entry.hpMaxSeen || entity.bossHp > entry.hpMaxSeen)) {
          entry.hpMaxSeen = entity.bossHp;
        } else if (entity.hpMax !== undefined && (!entry.hpMaxSeen || entity.hpMax > entry.hpMaxSeen)) {
          entry.hpMaxSeen = entity.hpMax;
        }
      }
      defeatedEntities[type] = entry;
      localStorage.setItem(DEFEATED_KEY, JSON.stringify(defeatedEntities));
    } catch (e) {}
    // Hidden boss kill grants the eternal_charm + persistent flag.
    if (entity && entity._isHidden) {
      try { grantEternalCharmIfHidden(entity); } catch (e) {}
    }
    // Final-boss kill on Lv9 arms the "wall-clip falling" cinematic — the
    // next time the player bumps a wall on the return trip, the screen
    // tilts, FPS view slides through the wall, and they fall into the void
    // before the regular ending screen. Designed per user request:
    // 「最終ボスのムービーのように動くムービーで帰り道に壁にぶつかった
    //   際にすり抜け地面に落ちていくような演出」
    if ((type === 'haruki_boss' || type === 'boss') && currentLevel === 9) {
      player._wallClipPending = true;
    }
    // Killing a civilian is morally costly: SAN -25, no coin toast (silent
    // shame), screen red-flashes. The Lv11 district is supposed to be the
    // game's one breath of safety — taking it from the civilians is a choice.
    if (type === 'civilian') {
      player.san = Math.max(0, player.san - 25);
      if (audioInitialized) {
        try { GameEngine.playSound('scream'); } catch (e) {}
        try { GameEngine.playSound('hit'); } catch (e) {}
      }
      try { GameEngine.redFlash(); GameEngine.shakeScreen(10, 0.5); } catch (e) {}
      toast('— 何かを失った。');
      try { unlockAchievement('civilian_killed'); } catch (e) {}
    }
    // Kill-conditional secret docs — when the player drops an enemy that
    // matches an undiscovered doc's acquisition.enemyType on the right level,
    // unlock the doc (showNoteViewer pauses gameplay anyway so the player
    // can read it immediately).
    for (var sdi = 0; sdi < SECRET_DOCS.length; sdi++) {
      var sdoc = SECRET_DOCS[sdi];
      var acq = sdoc.acquisition || {};
      if (acq.type !== 'kill') continue;
      if (acq.enemyType !== type) continue;
      if (acq.levelId !== currentLevel) continue;
      if (collectedSecretDocs[sdoc.id]) continue;
      discoverSecretDoc(sdoc.id);
      // discoverSecretDoc already opens the noteViewer; toast would just
      // stack with that briefly.
      break; // only one per kill
    }
  }

  // Damage multipliers per enemy type × weapon item. Default 1.0 (normal).
  // Higher numbers mean the weapon is "strong" against that enemy; lower
  // numbers mean it's "weak". Lets the bestiary surface 「有効」「無効」.
  var WEAPON_DAMAGE_MULT = {
    hound: {
      pistol: 1.2,  shotgun: 1.8,  revolver: 1.2, katana: 0.9,
      flare: 1.0,   architect_blade: 1.6, revenant_blade: 1.4,
      void_grenade: 1.5
    },
    smiler: {
      pistol: 0.8,  shotgun: 0.9,  revolver: 0.8, katana: 1.4,
      flare: 1.8,   architect_blade: 1.4, revenant_blade: 1.2,
      mirror: 1.5,  void_grenade: 0.8
    },
    skinstealer: {
      pistol: 1.0,  shotgun: 1.6,  revolver: 1.2, katana: 1.6,
      flare: 1.2,   architect_blade: 1.8, mirror: 2.0,
      revenant_blade: 1.4, void_grenade: 1.2
    },
    wretch: {
      pistol: 0.7,  shotgun: 1.0,  revolver: 0.8, katana: 0.6,
      flare: 1.8,   architect_blade: 1.2, soul_lantern: 2.0,
      siren_whistle: 1.6, void_grenade: 1.0
    },
    partygoer: {
      pistol: 1.2,  shotgun: 1.6,  revolver: 1.4, katana: 1.0,
      flare: 0.8,   architect_blade: 1.2, void_grenade: 1.5
    },
    crawler: {
      pistol: 1.0,  shotgun: 1.4,  revolver: 1.0, katana: 1.6,
      flare: 0.6,   architect_blade: 1.4, void_grenade: 1.2
    },
    haruki: {
      pistol: 0.5,  shotgun: 0.6,  revolver: 0.5, katana: 1.0,
      flare: 0.4,   architect_blade: 1.2, haruki_charm: 2.0,
      mirror_shard: 1.8, revenant_blade: 0.8
    },
    echo: {
      pistol: 0.8,  shotgun: 1.0,  katana: 0.6, flare: 1.6,
      siren_whistle: 2.0, void_grenade: 1.2
    },
    faceling: {
      pistol: 1.0,  shotgun: 1.4,  revolver: 1.0, katana: 1.2,
      mirror: 1.8,  mirror_shard: 1.6, architect_blade: 1.4
    },
    civilian: { /* attacks on civilians stay at 1.0 — the moral cost is the
                   real penalty, no need to also nerf damage */ },
    witness: {
      pistol: 1.0,  shotgun: 1.2,  revolver: 1.0, katana: 1.4,
      flare: 2.0,   mirror: 1.4,  mirror_shard: 1.6,
      architect_blade: 1.4
    },
    lurker: {
      pistol: 0.9,  shotgun: 1.2,  revolver: 1.0, katana: 1.6,
      flare: 1.4,   mirror: 1.6,  architect_blade: 1.5,
      void_grenade: 1.4, siren_whistle: 1.8
    },
    shadow: {
      pistol: 0.5,  shotgun: 0.6,  revolver: 0.5, katana: 0.8,
      flare: 2.2,   mirror: 1.4,  mirror_shard: 1.6,
      architect_blade: 1.2, soul_lantern: 2.4,
      siren_whistle: 1.4
    },
    drowned: {
      pistol: 1.2,  shotgun: 1.6,  revolver: 1.2, katana: 1.4,
      flare: 1.8,   architect_blade: 1.4, void_grenade: 1.5,
      soul_lantern: 1.6
    },
    vinewalker: {
      pistol: 0.8,  shotgun: 1.2,  revolver: 0.8, katana: 2.0,
      flare: 2.0,   architect_blade: 1.6, revenant_blade: 1.4,
      void_grenade: 1.4
    },
    mrhotel: {
      pistol: 0.4,  shotgun: 0.5,  katana: 1.4, flare: 0.6,
      architect_blade: 1.8, mirror: 2.0, revenant_blade: 1.2,
      haruki_charm: 1.6
    },
    boss: {
      pistol: 0.6,  shotgun: 0.8,  revolver: 0.7, katana: 1.0,
      architect_blade: 1.4, void_grenade: 1.2
    },
    haruki_boss: {
      pistol: 0.4,  shotgun: 0.5,  revolver: 0.5, katana: 1.2,
      architect_blade: 1.6, mirror: 1.8, mirror_shard: 1.6,
      haruki_charm: 0.0,  // charm WARDS, doesn't damage
      void_grenade: 1.0,  revenant_blade: 1.0
    }
  };
  function _weaponDamageMultiplier(weaponId, enemyType) {
    var row = WEAPON_DAMAGE_MULT[enemyType];
    if (!row) return 1.0;
    var v = row[weaponId];
    return (v === undefined) ? 1.0 : v;
  }
  // Expose for bestiary lookup
  window.WEAPON_DAMAGE_MULT = WEAPON_DAMAGE_MULT;
  window._weaponDamageMultiplier = _weaponDamageMultiplier;

  function _attackForward(p, opts) {
    var bestE = null, bestDist = Infinity;
    var ang = p.angle;
    var coneRad = opts.coneDeg * Math.PI / 180;
    var maxDist = opts.rangeTiles * TS;
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e.alive) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) continue;
      var relAng = Math.atan2(dy, dx) - ang;
      while (relAng > Math.PI) relAng -= Math.PI * 2;
      while (relAng < -Math.PI) relAng += Math.PI * 2;
      if (Math.abs(relAng) > coneRad / 2) continue;
      if (d < bestDist) { bestDist = d; bestE = e; }
    }
    if (!bestE) return null;
    // Apply per-enemy weapon damage multiplier when caller specifies which
    // weapon (opts.weaponId). Falls back to 1.0 for legacy callers.
    var wMul = opts.weaponId ? _weaponDamageMultiplier(opts.weaponId, bestE.type) : 1.0;
    var dmg = opts.dmg * (cheatActive ? 3 : 1) * wMul;
    var killed = false;
    if (bestE.type === 'boss' || bestE.type === 'haruki_boss') {
      bestE.bossHp = (bestE.bossHp !== undefined ? bestE.bossHp : 200) - dmg;
      if (bestE.bossHp <= 0) {
        bestE.alive = false;
        killed = true;
        unlockAchievement('defeat_boss');
        toast(bestE.type === 'haruki_boss' ? '★ ハルキ 撃破! ★' : '★ BOSS 撃破!');
        _grantCoinsForKill(bestE.type, bestE);
      }
    } else {
      bestE.hp = (bestE.hp !== undefined ? bestE.hp : 100) - dmg;
      if (bestE.hp <= 0) {
        bestE.alive = false;
        killed = true;
        bestE.deathAt = performance.now();
        toast(getEntityLabel(bestE.type) + ' 撃破');
        _grantCoinsForKill(bestE.type, bestE);
      }
    }
    // Mark the entity as just hit — renderSprite reads _lastHitAt
    // and tints it red briefly, sells the hit-confirmation feel.
    bestE._lastHitAt = performance.now();
    // Stronger hit-flash for weak-point hits (wMul >= 1.5) so the
    // player gets visual confirmation that this weapon works on this
    // enemy. renderSprite reads _hitWasCrit alongside _lastHitAt.
    bestE._hitWasCrit = wMul >= 1.4;
    // Crit if the weapon multiplier is > 1.2 against this enemy.
    var isCrit = wMul >= 1.4;
    // Damage popup always shown for the hit. On kill we ALSO spawn a
    // separate KILL banner at a different vertical position so the two
    // don't visually overlap (user report: 「ダメージとkillが重なって
    // しまう」). The KILL banner is delayed slightly so the player can
    // see the damage value first.
    _spawnDamagePopup(dmg, { crit: isCrit, kill: false });
    if (killed) {
      setTimeout(function () { _spawnKillBanner(); }, 120);
    }
    _flashHitMarker(killed);
    // Blood/spark feedback at the hit location
    _hitParticles(bestE, 6, 'spark');
    return bestE;
  }
  // Separate KILL banner popup — top of screen, large red, no overlap
  // with damage numbers in the screen-center band.
  function _spawnKillBanner() {
    if (typeof document === 'undefined' || !document.body) return;
    var node = document.createElement('div');
    node.className = 'damage-popup kill-banner';
    node.textContent = '★ KILL ★';
    document.body.appendChild(node);
    setTimeout(function () {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }, 950);
  }
  // ── Hit marker ──
  // Flash 4 diagonal ticks around the reticle. Red+rotate on kill hits.
  function _flashHitMarker(isKill) {
    var hm = el('hitMarker');
    if (!hm) return;
    hm.classList.remove('show');
    hm.classList.remove('kill');
    void hm.offsetWidth;
    if (isKill) hm.classList.add('kill');
    hm.classList.add('show');
    setTimeout(function () {
      if (hm) { hm.classList.remove('show'); hm.classList.remove('kill'); }
    }, isKill ? 460 : 290);
  }
  function getEntityLabel(t) {
    return ({ hound: 'HOUND', skinstealer: 'SKIN-STEALER', smiler: 'SMILER',
              partygoer: 'PARTYGOER', boss: 'BOSS', haruki: 'HARUKI',
              haruki_boss: 'HARUKI 真', crawler: 'CRAWLER' })[t] || t;
  }
  // Register weapons into the global ITEMS map (defined above).
  // Each effect() now layers: muzzle flash overlay, multi-track SE, screen
  // shake, hit particles. The look/feel is intentionally over-the-top
  // because the player only gets a handful of shots per level.
  ITEMS.pistol = {
    id: 'pistol', name: '拳銃', icon: '🔫',
    desc: '中距離・低反動。1発で hound 系を倒せる。所持数=残弾。',
    category: 'weapon',
    effect: function (p) {
      _muzzleFlash('#fff2c0');
      if (audioInitialized) {
        GameEngine.playSound('hit');
        GameEngine.playSound('clock_tick'); // sharp click as report
      }
      var hit = _attackForward(p, { dmg: 60, rangeTiles: 8, coneDeg: 14, weaponId: 'pistol' });
      _spawnTracer(p, { hit: hit, rangeTiles: 8, color: 'rgba(255,240,160,0.95)', width: 2 });
      GameEngine.shakeScreen(6, 0.2);
      if (hit) _hitParticles(hit, 4, 'spark');
      if (navigator.vibrate) navigator.vibrate(15);
      toast(hit ? '命中: ' + getEntityLabel(hit.type) : '空振り');
    }
  };
  ITEMS.shotgun = {
    id: 'shotgun', name: 'ショットガン', icon: '💥',
    desc: '近距離・広範囲。大ダメージだが弾数少。',
    category: 'weapon',
    effect: function (p) {
      _muzzleFlash('#ffd070');
      if (audioInitialized) {
        GameEngine.playSound('hit');
        GameEngine.playSound('thunder');
      }
      var hits = 0, lastHit = null;
      for (var s = 0; s < 5; s++) {
        var h = _attackForward(p, { dmg: 35, rangeTiles: 4.5, coneDeg: 55, weaponId: 'shotgun' });
        if (h) { hits++; lastHit = h; }
        // One tracer per pellet — wide spread reads as a shotgun blast.
        _spawnTracer(p, { hit: h, rangeTiles: 4.5, color: 'rgba(255,180,100,0.9)', width: 2 });
      }
      GameEngine.shakeScreen(14, 0.45);
      GameEngine.redFlash();
      if (lastHit) _hitParticles(lastHit, 12, 'spark');
      if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
      toast(hits ? hits + 'ヒット' : '空振り');
    }
  };
  ITEMS.katana = {
    id: 'katana', name: '刀', icon: '🗡',
    desc: '近接・即斬。命中で1消費、空振りは消費しない。Boss にも有効。',
    category: 'weapon',
    effect: function (p) {
      _muzzleFlash('#c0d8ff'); // cool blue slash gleam
      if (audioInitialized) {
        GameEngine.playSound('hit');
        GameEngine.playSound('paper'); // sharp swish-like overlay
      }
      var hit = _attackForward(p, { dmg: 95, rangeTiles: 1.6, coneDeg: 80, weaponId: 'katana' });
      GameEngine.shakeScreen(7, 0.22);
      if (hit) _hitParticles(hit, 10, 'spark');
      if (navigator.vibrate) navigator.vibrate(20);
      toast(hit ? '斬撃: ' + getEntityLabel(hit.type) : '空振り');
      return hit ? true : false; // miss = no consume
    }
  };
  // ── eternal_charm: persistent across runs once the hidden boss is killed.
  // While held (always, since 'persistent: true' + lifetime localStorage flag),
  // it lifts the item-use consume rule entirely so every item count reads ∞.
  ITEMS.eternal_charm = {
    id: 'eternal_charm', name: '永遠の護符 (隠しボス報酬)', icon: '♾',
    desc: '隠しボスを倒した者だけが受け取れる護符。\n所持中、全アイテム/武器の所持数と使用上限が無限になる。\nリセットしない限り、新規ゲームでも引き継がれる。',
    persistent: true,
    effect: function (p) {
      // No-op when "used" — its effect is passive.
      toast('永遠の護符 — 既に全アイテムが無限。');
      return false; // never consume
    }
  };

  ITEMS.revolver = {
    id: 'revolver', name: 'リボルバー', icon: '🔫',
    desc: '長距離・高貫通。6発まで装填、命中力高い。',
    category: 'weapon',
    effect: function (p) {
      _muzzleFlash('#ffe080');
      if (audioInitialized) {
        GameEngine.playSound('hit');
        GameEngine.playSound('stinger');
      }
      var hit = _attackForward(p, { dmg: 85, rangeTiles: 12, coneDeg: 8, weaponId: 'revolver' });
      _spawnTracer(p, { hit: hit, rangeTiles: 12, color: 'rgba(255,220,120,0.95)', width: 3 });
      GameEngine.shakeScreen(9, 0.3);
      if (hit) _hitParticles(hit, 6, 'spark');
      if (navigator.vibrate) navigator.vibrate(25);
      toast(hit ? '貫通: ' + getEntityLabel(hit.type) : '空振り');
    }
  };

  // ── UNIQUE MINI-GAME REWARDS ────────────────────────────
  // These items only spawn as mini-game prizes and are intentionally rare.
  ITEMS.soul_lantern = {
    id: 'soul_lantern', name: '灯霊 (ユニーク)', icon: '🏮',
    desc: 'ユニーク。10秒間、近くの全エンティティ位置を脳裏に映す。',
    category: 'consumable',
    useSound: 'stinger',
    effect: function (p) {
      // Stash a timestamp so the renderer can reveal nearby entities.
      p._soulLanternUntil = performance.now() + 10000;
      toast('★ 灯霊 — 全エンティティ位置が見える');
      if (audioInitialized) GameEngine.playSound('item_get');
    }
  };
  ITEMS.haruki_charm = {
    id: 'haruki_charm', name: 'ハルキの護符 (ユニーク)', icon: '🪬',
    desc: 'ユニーク。30秒間、ハルキ系エンティティが接近不能になる。',
    category: 'consumable',
    useSound: 'whisper',
    effect: function (p) {
      p._harukiWardUntil = performance.now() + 30000;
      toast('★ ハルキの護符 — 30秒間 ハルキを退ける');
      if (audioInitialized) GameEngine.playSound('item_get');
    }
  };
  ITEMS.architect_blade = {
    id: 'architect_blade', name: '建築家の刃 (ユニーク武器)', icon: '⚔',
    desc: 'ユニーク武器。前方扇形に巨大なダメージ。命中で1消費、空振りは消費しない。',
    category: 'weapon',
    effect: function (p) {
      var hit = _attackForward(p, { dmg: 150, rangeTiles: 5, coneDeg: 100, weaponId: 'architect_blade' });
      if (audioInitialized) { GameEngine.playSound('hit'); GameEngine.playSound('thunder'); }
      GameEngine.shakeScreen(12, 0.5);
      GameEngine.redFlash();
      toast(hit ? '★ 神撃: ' + getEntityLabel(hit.type) : '空振り');
      return hit ? true : false;
    }
  };
  ITEMS.siren_whistle = {
    id: 'siren_whistle', name: 'サイレンの笛 (ユニーク)', icon: '🔔',
    desc: 'ユニーク。全エンティティを5秒間スタンさせ、視認不能にする。',
    category: 'consumable',
    effect: function (p) {
      for (var sw = 0; sw < entities.length; sw++) {
        if (entities[sw].alive) entities[sw].stunTimer = Math.max(entities[sw].stunTimer || 0, 5);
      }
      if (audioInitialized) { GameEngine.playSound('stinger'); GameEngine.playSound('whisper'); }
      GameEngine.shakeScreen(8, 0.3);
      toast('★ サイレン — 全敵スタン 5秒');
    }
  };
  ITEMS.mirror_shard = {
    id: 'mirror_shard', name: '鏡片 (ユニーク)', icon: '💎',
    desc: 'ユニーク。15秒間、被ダメージを跳ね返す。',
    category: 'consumable',
    useSound: 'glass_rattle',
    effect: function (p) {
      p._mirrorShardUntil = performance.now() + 15000;
      if (audioInitialized) GameEngine.playSound('item_get');
      toast('★ 鏡片 — 15秒間 反射防御');
    }
  };
  ITEMS.revenant_blade = {
    id: 'revenant_blade', name: '亡者の刃 (ユニーク武器)', icon: '🗡',
    desc: 'ユニーク武器。命中時 HP +12 回復。中距離扇形。空振りは消費しない。',
    category: 'weapon',
    effect: function (p) {
      var hit = _attackForward(p, { dmg: 80, rangeTiles: 3, coneDeg: 70, weaponId: 'revenant_blade' });
      if (hit) {
        p.hp = Math.min(p.hpMax, p.hp + 12);
        toast('★ 吸血: ' + getEntityLabel(hit.type) + ' HP +12');
      } else {
        toast('空振り');
      }
      if (audioInitialized) GameEngine.playSound('hit');
      GameEngine.shakeScreen(5, 0.2);
      return hit ? true : false;
    }
  };
  ITEMS.void_grenade = {
    id: 'void_grenade', name: '虚無の手榴弾 (ユニーク武器)', icon: '💣',
    desc: 'ユニーク武器。プレイヤー周囲 3 タイル全方向に強ダメージ。',
    category: 'weapon',
    effect: function (p) {
      var killed = 0;
      for (var vg = 0; vg < entities.length; vg++) {
        var ve = entities[vg];
        if (!ve.alive) continue;
        var vdx = ve.x - p.x, vdy = ve.y - p.y;
        var vd = Math.sqrt(vdx * vdx + vdy * vdy);
        if (vd < 3 * TS) {
          ve._lastHitAt = performance.now();
          ve._hitWasCrit = true; // explosion is always a crit-style impact
          if (ve.type === 'boss' || ve.type === 'haruki_boss') {
            ve.bossHp = (ve.bossHp !== undefined ? ve.bossHp : 200) - 70;
            if (ve.bossHp <= 0) { ve.alive = false; ve.deathAt = performance.now(); killed++; }
          } else {
            ve.hp = (ve.hp !== undefined ? ve.hp : 100) - 120;
            if (ve.hp <= 0) { ve.alive = false; ve.deathAt = performance.now(); killed++; }
          }
        }
      }
      if (audioInitialized) { GameEngine.playSound('thunder'); GameEngine.playSound('hit'); }
      GameEngine.shakeScreen(20, 0.7);
      GameEngine.redFlash();
      toast('★ 虚無爆発: ' + killed + ' 撃破');
    }
  };

  // ── ITEMS POOL BY LEVEL ─────────────────────────────────
  var LEVEL_ITEM_POOLS = {
    0: ['almond_water', 'bandage', 'flashlight', 'almond_milk', 'antacid', 'compass'],
    1: ['almond_water', 'bandage', 'energy_bar', 'keycard', 'flare', 'antacid', 'lockpick'],
    2: ['almond_water', 'bandage', 'energy_bar', 'flare', 'antacid'],
    3: ['almond_water', 'bandage', 'flashlight', 'radio', 'flare', 'lockpick', 'pistol'],
    4: ['almond_water', 'keycard', 'energy_bar', 'radio', 'mirror', 'lockpick', 'antacid', 'pistol'],
    5: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'flare', 'compass', 'antacid', 'pistol', 'katana'],
    6: ['almond_water', 'flashlight', 'bandage', 'flare', 'compass', 'pistol', 'shotgun'],
    7: ['energy_bar', 'almond_water', 'flare', 'antacid', 'shotgun', 'katana'],
    8: ['almond_water', 'bandage', 'radio', 'mirror', 'flare', 'antacid', 'pistol', 'katana'],
    11: ['almond_water', 'flashlight', 'energy_bar', 'flare', 'compass', 'shotgun'],
    12: ['almond_water', 'energy_bar', 'voucher', 'bandage', 'flare', 'antacid', 'pistol', 'revolver'],
    // Lv9: final-boss arena — extra firepower available.
    9: ['almond_water', 'voucher', 'bandage', 'energy_bar', 'almond_milk', 'lockpick',
        'pistol', 'shotgun', 'katana', 'revolver'],
    13: ['almond_water', 'energy_bar', 'compass', 'flare', 'pistol', 'katana'],
    14: ['almond_water', 'bandage', 'flare', 'antacid', 'flashlight', 'pistol', 'katana'],
    15: ['almond_water', 'bandage', 'energy_bar', 'compass', 'flare', 'pistol', 'shotgun']
  };

  // ── SECRET DOCUMENTS (太平洋戦争 帝国軍秘匿部隊「九四四班」 lore) ──
  // 9 fragments, each placed on a specific level. Collecting ALL of them
  // before defeating HARUKI unlocks the TRUE END. Discovery is persistent
  // across runs via localStorage 'thebackrooms_secret_docs_v1'.
  // Each entry has an `acquisition` describing how to unlock it. The Archive
  // shows this hint on locked rows so the player knows where/how to look:
  //   { type: 'pickup', levelId } — find an 'S' tile in that level
  //   { type: 'kill',   levelId, enemyType, label } — defeat a specific
  //                                                   entity on that level
  var SECRET_DOCS = [
    { id: 'sd_1', levelId: 0,
      acquisition: { type: 'pickup', levelId: 0 },
      title: '秘匿書類 — 第一号',
      text:
        '機密 — 第九四四特別作戦班\n昭和十九年六月\n\n大本営直轄、満洲奥地に置かれた当班は、\n敵性勢力の士気を内側から崩壊させる「精神兵器」\nの開発を目的とする。\n\n第一段階 — 「壁を抜ける」現象の再現実験、進行中。' },
    { id: 'sd_2', levelId: 1,
      acquisition: { type: 'pickup', levelId: 1 },
      title: '秘匿書類 — 第二号',
      text:
        '研究日誌 / 班長 春木保 (はるき たもつ)\n昭和十九年八月\n\n第七実験室にて、被験者三名が同時に「消失」。\n物質的に検出不能。しかし、彼らの声は\n依然として壁の向こうで響き続けている。\n\nこれは ── 別の階層に「降りた」のではないか。' },
    { id: 'sd_3', levelId: 2,
      acquisition: { type: 'pickup', levelId: 2 },
      title: '秘匿書類 — 第三号',
      text:
        '報告書 — 観測室 B-7\n昭和十九年十月\n\n「黄色い無限の壁紙」「湿った絨毯」── 被験者\nの帰還報告が一致。だが、誰も帰還していない。\n声だけが、彼らが「降りた」階層から届く。\n\n班長春木は、「自分も降りてみたい」と申し出た。' },
    { id: 'sd_4', levelId: 3,
      acquisition: { type: 'kill', levelId: 3, enemyType: 'wretch', label: 'WRETCH を撃破' },
      title: '秘匿書類 — 第四号',
      text:
        '緊急電 — 司令部宛\n昭和十九年十一月\n\n春木班長、第七実験室に単独入室。\n三時間後、室内の壁紙が「黄色く」変色。\n春木の所在、不明。\n音声記録のみ残存 ──「ここは、深い」\n\n— 焼け焦げた小型録音機より回収。' },
    { id: 'sd_5', levelId: 4,
      acquisition: { type: 'pickup', levelId: 4 },
      title: '秘匿書類 — 第五号',
      text:
        '内部報告 — 第二補佐官\n昭和十九年十二月\n\n春木の妹、晴美 (はるみ) が当班に編入された。\n兄を救出するためと本人は主張するが、\n上層部の真の意図は、彼女を「次の鍵」とする\nことにあるという。\n\n彼女は実に、嬉しそうだった。' },
    { id: 'sd_6', levelId: 5,
      acquisition: { type: 'kill', levelId: 5, enemyType: 'mrhotel', label: 'MR.HOTEL を撃破' },
      title: '秘匿書類 — 第六号',
      text:
        '観測室 C-3 — 音声記録\n昭和二十年三月\n\n春木保の声、確認。\n「ここに、誰もいない。\nだが、誰もが、ここにいる。\nおかえり。」\n\n— 春木晴美、行方不明。\n\n録音機は MR.HOTEL の遺骸から発見された。' },
    { id: 'sd_7', levelId: 7,
      acquisition: { type: 'pickup', levelId: 7 },
      title: '秘匿書類 — 第七号',
      text:
        '機密 — 終戦直前\n昭和二十年八月\n\n第九四四班、解散命令。\n実験施設、爆破。資料、焼却。\n\nだが ── 階層は、閉じない。\n壁の向こうで、二人は今も、待っている。' },
    { id: 'sd_8', levelId: 8,
      acquisition: { type: 'kill', levelId: 8, enemyType: 'faceling', label: 'FACELING を撃破' },
      title: '秘匿書類 — 第八号',
      text:
        '匿名の手記 — 戦後\n\n父は第九四四班の主任だった。\n父は「黄色い夢」を毎晩見るようになり、\nそして消えた。\n\n姉も同じ夢を見た後、消えた。\n\n私の夢にも、最近、黄色が見える。\n\n— 手記は顔のないものの胸から見つかった。' },
    { id: 'sd_9', levelId: 9,
      acquisition: { type: 'pickup', levelId: 9 },
      title: '秘匿書類 — 第九号 / 最終',
      text:
        '「私は春木晴美。\n兄を捜してここに降りた。\n兄はもう、ハルキではない。\nここの全てが、ハルキだ。\n\nもし、これを読んでいる貴方が\n全ての書類を集めたなら ──\n\n出口は、扉ではない。\n書類こそが、鍵だ。」' },
    // ── 後追加された補遺 (post-script docs) — Lv11/13/15 ──
    { id: 'sd_10', levelId: 11,
      acquisition: { type: 'pickup', levelId: 11 },
      title: '秘匿書類 — 補遺甲 / 戦後の証言',
      text:
        '元参謀本部 嘱託員の証言録 (1962)\n\n「九四四班は実在した。\n班長春木は満洲奥地から消えた。\n妹晴美が後を追ったのも事実だ。\n\nだが我々が罪に問われなかったのは、\n彼らが「存在しない」階層に\n降りてしまったからだ。\n\n誰もが、見て見ぬふりをした。」' },
    { id: 'sd_11', levelId: 13,
      acquisition: { type: 'kill', levelId: 13, enemyType: 'haruki_boss',
                     label: '祭壇に祈り、隠しボスを撃破' },
      title: '秘匿書類 — 補遺乙 / 祭壇の意味',
      text:
        '図書館深部より発掘された手稿\n\n「九四四班は、満洲の山中に\n祭壇を組み、被験者を捧げた。\nこの祭壇こそが、最初の no-clip 点だった。\n\nハルキは祭壇に祈る者を、\nもう一度試そうとする。\n\n勝てば ── 護符を手に入れる。」' },
    { id: 'sd_12', levelId: 15,
      acquisition: { type: 'pickup', levelId: 15 },
      title: '秘匿書類 — 補遺丙 / 庭園の記録',
      text:
        '春木晴美の手記 (最終ページ)\n\n「ここは、私が母と来た庭園に似ている。\n手入れされ続けるけれど、\n誰も訪れない庭。\n\n私はここで兄を待つ。\nそして、兄はここで私を待つ。\n\n貴方が全ての書類を集めたなら、\n私たちを、一緒に解放してください。」' },
    // ── 条件付き入手 (低 SAN / 読書数) ──
    { id: 'sd_13', levelId: 0,
      acquisition: { type: 'low_san', levelId: -1,  // -1 = どのレベルでも
                     label: 'SAN ≤ 25% で時間経過' },
      title: '秘匿書類 — 補遺丁 / 狂気の縁',
      text:
        '誰かの手記 (字がにじんでいる)\n\n「気が狂いそうな時にだけ、\n壁紙の柄の奥に文字が浮かび上がる。\n\n『我々は彼らに見られている』\n\n正気では絶対に読めない。\n SAN を消費せよ。代償として、知識を得る。」' },
    { id: 'sd_14', levelId: 0,
      acquisition: { type: 'discover_count', levelId: -1,
                     count: 15, label: '通常書類を 15 件以上収集' },
      title: '秘匿書類 — 補遺戊 / 読書狂への報奨',
      text:
        '匿名の司書からの私信\n\n「お前は、よく読んだ。\nお前は、よく集めた。\n\nこの世界の図書を 15 冊以上、\n壁の向こうから持ち帰った者は、\n初めてだ。\n\n— 報奨として、これを贈る。\n九四四班の最後の研究員は、\n図書館の地下に消えた。\n名は、まだ、刻まれていない。」' }
  ];

  // Collected secret docs — set keyed by doc id. Loaded from localStorage on
  // bootstrap; updated when a player picks up a hidden 'S' tile.
  var collectedSecretDocs = {};

  // ── NOTES ───────────────────────────────────────────────
  var NOTES_POOL = {
    0: [
      // 九四四班 lore hint — placed across regular notes as breadcrumb trail
      { title: 'メモ — 古い焼け焦げ',
        text: '何かの研究所の燃え残り。\n「第九 ── 班、解散」とだけ読める。\n誰の研究だ?\nまだここに、研究員が残っているのか?\n\n— 仮の整理を K-37 が試みた。' },
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
      // 九四四班 lore breadcrumb
      { title: 'M.E.G. 補遺 — 帝国軍研究',
        text: 'M.E.G. 派遣隊 14 補遺:\n本階層深部の倉庫壁面に、漢字で「九四四」と削り込まれていた。\n旧日本陸軍の符牒だと思われる。\n壁を抜けた先で、なぜ?\n\n上層部はこの記述を非公開扱いとした。' },
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
      // 九四四班 lore — hint at MR.HOTEL connection
      { title: 'フロントの記録 — 1945',
        text: '昭和二十年三月\n\n本日チェックインの客:\n- 春木 保 様\n- 春木 晴美 様\n\n備考: チェックアウト履歴なし。\n\n— 同名の宿泊が、毎日続いている。' },
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
      // 九四四班 lore — final breadcrumb pointing to the secret docs
      { title: '春木家の墓石',
        text: '苔の生えた墓石が、家々の合間にひっそりと並んでいる。\n刻まれた名は二つだけ —\n\n  春木 保     大正十年 — 昭和十九年\n  春木 晴美   昭和二年 — 昭和二十年\n\n秘匿書類を全て集めた者だけが、ここから先に進める。' },
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
    ],

    14: [
      { title: 'Trench 探索日誌',
        text: '海底ステーションへの入口を見つけた。\n壁を抜けた先 — 塩辛い水。\n足音は伝わらない。声も伝わらない。\nだが「視線」だけは届く。\n\n— BR-14 探検記' },
      { title: '溺れた同行者',
        text: '彼はここで「もう少し探そう」と言った。\nそれから、彼が振り返ることはなかった。\n\n水底に、彼の輪郭だけが残っている。\nたまに、こちらに手を伸ばすことがある。' },
      { title: '塩の柱',
        text: '中央広間に塩の柱が立っている。\n触れた者の手の感触が、徐々に塩に変わる。\n\n言い伝えでは、振り返らずに通り抜けたとき、\n柱の中から自分の名を呼ぶ声が聞こえる。\n返事をしてはならない。' },
      { title: 'M.E.G. 警告 #BR-14-α',
        text: '通称: THE TRENCH。\nLevel 14 — Backrooms 公式分類 C-3。\n\n潜水装備は機能しない。\nだが「呼吸が必要」と感じなくなった者から、\nここの住人になる。' },
      { title: 'ハルキの噂 (海底版)',
        text: '"水底にも、ハルキがいる"\n— ある no-clipper の最後の音声記録。\n\n録音時刻は、まだ海底に降りる前のはず。\nだが、ハルキは既にここに居た。' },
      { title: '帰路の図',
        text: '出口は南東の隔壁の向こう。\nバルブを 3 回 反時計回りに回すと、\n壁が一時的に no-clip 可能になる。\n\n— 急げ。タイドが変わる前に。' }
    ],

    13: [
      { title: 'THE LIBRARY 案内',
        text: 'バックルーム公式分類: Level 13 — THE LIBRARY。\n書架は無限に伸びている。\n\n蔵書索引はあるが、索引そのものが書架の一冊。\n探そうとすると、まず索引から探す必要がある。' },
      { title: '貸出記録',
        text: '貸出: 1947年5月8日\n貸出者: 春木保\n図書: 「精神兵器の理論」\n返却期日: 永遠\n\n— 司書の小さな字で、\n「彼はもう、この本を返せない」\nと添え書きされている。' },
      { title: '司書のスタンプ',
        text: 'カウンターには無人の司書席。\n古いスタンプ台に押印された痕跡:\n\n「FOR THE READER WHO CAME FROM THE WALL」' },
      { title: '書架の隙間',
        text: '本と本の間に、薄い紙片を見つけた。\n\n「もし、これを読んでいるのなら、\n隣の通路の三段目を確認してくれ。\n— もう一冊、隠してある。」' },
      { title: '禁書区画',
        text: '中央祭壇の周辺には、鎖で繋がれた書架がある。\n禁書 — 開けるには代償が要る。\n\n祈りを捧げる者だけが、\nここの本の真の意味を知ることになる。' },
      { title: '春木晴美のしおり',
        text: '一枚のしおりが床に落ちている。\n押し花の桜と、小さく書かれた名前 ──\n「兄へ」\n\nこの図書館に、彼女もいたのか?\n— あるいは、今もいるのか?' }
    ],

    15: [
      { title: '庭師の手記',
        text: 'この温室は誰のためのものか。\n私は知らない。\n剪定の時間だけが繰り返されていることを知っている。\n\n— 庭師 #1 (筆跡判定: 同一人物による複数代記述)' },
      { title: '生垣の中の窓',
        text: '迷路の生垣の根元に、時折「窓」が見える。\n覗き込むと別の階層の景色が見えるが、\n手を伸ばすと窓は消える。\n\n窓に映ったお前は、\nお前ではないかもしれない。' },
      { title: 'M.E.G. 報告 #BR-15-γ',
        text: 'Level 15 — THE GARDEN。\nFaceling 個体多数生息。\n\n顔のない者にも植物の手入れは可能であり、\nむしろ感情のない作業として最適化されている、\nという仮説あり。' },
      { title: '甘い実',
        text: '中央付近に赤い実をつける低木がある。\n甘い香り。\n食べた者は満たされた表情で立ち止まり、\n二度と動かなくなる。\n\n— 香りだけ嗅いで通り過ぎろ。' },
      { title: '永遠の春',
        text: '温度は常に 18.5 度。湿度 62%。\n季節は来ない。だから、終わりもない。\n\n但し、稀に「秋の匂い」が漂う日がある。\nその時だけ、no-clip しやすい。' },
      { title: 'ハルキの薔薇',
        text: '迷路の中心に、一輪だけ咲く黒い薔薇がある。\n誰が植えたか、誰も知らない。\n\nハルキはそれを毎晩、訪れる。\nお前が中心に辿り着いた時、\n薔薇は摘み取られた後かもしれない。' }
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
  // Player i-frame window after entering a new level. Prevents ambush spawns
  // (e.g. Lv7 hound cluster) from killing the player before they orient.
  var spawnGraceUntil = 0;
  var SPAWN_GRACE_MS = 2800;
  // Per-level overrides for ambush-prone floors. Lv7 packs hounds near spawn,
  // so the default 2.8s is not enough to read the corridor layout before contact.
  var SPAWN_GRACE_BY_LEVEL = { 7: 4500 };
  function getSpawnGraceMs(lv) {
    return SPAWN_GRACE_BY_LEVEL[lv] || SPAWN_GRACE_MS;
  }
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
    equippedWeapon: null,   // itemId of the currently equipped weapon — fired by weaponAttackBtn / R1
    coins: 0,               // shop currency — earned from kills / sold items
    flashlightOn: false,
    flashlightBattery: 0,    // 0-100 %; consumed at 1%/s while ON
    radioOn: false,
    inSafeZone: false,
    inHazard: false,
    inWater: false
  };

  var entities = [];         // current level entities (live, with state)
  // Decorative props (desks, beds, lamps, etc). Render-only — no AI / no
  // collision / no damage. Populated at level load from LEVEL_PROP_CONFIG.
  // Each entry: { gx, gy, kind, _wx, _wy, _wobble }.
  var props = [];
  var pickedUpItems = {};    // {levelId: {gx_gy: true}}
  var readNotes = {};        // {levelId: {gx_gy: true}}
  var pickupSpots = {};      // {gx_gy: itemId} (this level)
  var noteSpots = {};        // {gx_gy: noteObj}
  // Parallel render lists with precomputed world coords (avoid per-frame split).
  var pickupRenderList = []; // [{key, wx, wy, itemId}]
  var noteRenderList = [];   // [{key, wx, wy}]
  var doorStates = {};       // {gx_gy: {open}}

  // Cheat mode: persisted unlock flag + per-session toggle.
  // Unlocked once the player reaches any ending. While active:
  //   - item/weapon use does NOT decrement count (infinite)
  //   - weapons deal 3× damage (無双モード)
  //   - player takes 0.4× damage
  var cheatUnlocked = false;
  var cheatActive = false;
  try { cheatUnlocked = !!localStorage.getItem('thebackrooms_cheat_unlocked_v1'); } catch (e) {}

  // D-pad quick-use assignments (per mode)
  var dpadAssignments = { weapon: { up: '', down: '', left: '', right: '' },
                          item:   { up: '', down: '', left: '', right: '' } };
  var dpadMode = 'item'; // 'weapon' | 'item'
  function loadDpadAssignments() {
    try {
      var raw = localStorage.getItem('bk_dpad_assignments_v1');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          ['weapon', 'item'].forEach(function (mk) {
            if (p[mk] && typeof p[mk] === 'object') {
              ['up', 'down', 'left', 'right'].forEach(function (d) {
                if (typeof p[mk][d] === 'string') dpadAssignments[mk][d] = p[mk][d];
              });
            }
          });
        }
      }
      var m = localStorage.getItem('bk_dpad_mode_v1');
      if (m === 'weapon' || m === 'item') dpadMode = m;
    } catch (e) {}
  }
  function saveDpadAssignments() {
    try {
      localStorage.setItem('bk_dpad_assignments_v1', JSON.stringify(dpadAssignments));
      localStorage.setItem('bk_dpad_mode_v1', dpadMode);
    } catch (e) {}
  }
  loadDpadAssignments();

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

  // ── Save slots ──
  // User request 2026-06-08: 「IP アドレスごとにセーブデータを別に
  // 保存することはできないか」. True IP-based separation isn't
  // feasible in a static-site context (no backend, IP isn't visible
  // client-side; external APIs are unreliable + privacy-sensitive).
  // Named save slots cover the same use case (multiple users on the
  // same browser, or separate playthroughs by one user).
  // currentSaveSlot picks the suffix appended to SAVE_KEY. Other
  // cross-run state (achievements, defeated bestiary, lifetime notes,
  // cheat unlock) stays GLOBAL so the player keeps their meta
  // progression regardless of which slot they're playing.
  var SLOT_KEY = 'thebackrooms_current_slot_v1';
  var SLOT_NAMES_KEY = 'thebackrooms_slot_names_v1';
  var SLOT_COUNT = 5; // user spec 2026-06-08: 「セーブスロットは５つにする」
  var currentSaveSlot = 1;
  var slotNames = { 1: '', 2: '', 3: '', 4: '', 5: '' };
  try {
    var _stored = parseInt(localStorage.getItem(SLOT_KEY) || '1', 10);
    if (_stored >= 1 && _stored <= SLOT_COUNT) currentSaveSlot = _stored;
    var _sn = localStorage.getItem(SLOT_NAMES_KEY);
    if (_sn) {
      var _parsed = JSON.parse(_sn);
      if (_parsed && typeof _parsed === 'object') {
        for (var _si = 1; _si <= SLOT_COUNT; _si++) {
          if (typeof _parsed[_si] === 'string') slotNames[_si] = _parsed[_si];
        }
      }
    }
  } catch (e) {}
  function _saveSlotKey() { return 'thebackrooms_save_v1_s' + currentSaveSlot; }
  function _slotKeyFor(slotNum) { return 'thebackrooms_save_v1_s' + slotNum; }
  function slotHasSave(slotNum) {
    try { return !!localStorage.getItem(_slotKeyFor(slotNum)); } catch (e) { return false; }
  }
  function setCurrentSaveSlot(slotNum) {
    if (slotNum < 1 || slotNum > SLOT_COUNT) return;
    currentSaveSlot = slotNum;
    try { localStorage.setItem(SLOT_KEY, String(slotNum)); } catch (e) {}
  }
  function setSlotName(slotNum, name) {
    if (slotNum < 1 || slotNum > SLOT_COUNT) return;
    slotNames[slotNum] = String(name || '').slice(0, 12);
    try { localStorage.setItem(SLOT_NAMES_KEY, JSON.stringify(slotNames)); } catch (e) {}
  }

  // Save key — slot-aware accessor. Legacy code that reads SAVE_KEY
  // directly via property access still works because we redefine it
  // via a getter further down. To keep diff minimal we expose a
  // function and update the few save/load sites to call it.
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
    hound: { name: 'HOUND', desc: 'バックルーム公式分類 Class 3。\n低い四足の捕食者で人間の頭部を持つ。\n動くものに反応するため、走らずゆっくり歩け。', voice: 'にげるな。' },
    smiler: { name: 'SMILER', desc: 'バックルーム公式分類 Class 2。\n暗闇に浮かぶ無数の白い歯と目だけが見える。\n直視せず、視線を逸らせばすり抜ける。\n見つめ続けると引き込まれる。', voice: 'みて、いるよ。' },
    skinstealer: { name: 'SKIN-STEALER', desc: 'バックルーム公式分類 Class 4。\nLevel 4 オフィスに棲息。\n死体や同僚の皮を被って近付き、触れた者の皮を奪う。\n鏡を使えば本性を晒し、消滅させられる。', voice: 'おまえに、なる。' },
    partygoer: { name: 'PARTYGOER', desc: 'バックルーム公式分類 Class 3。\nLevel Fun=) の住人。塗装された笑顔と三角帽。\n陽気な暴力でお前を「祝う」。フレアで一時退避可能。', voice: 'いわって、あげる。' },
    crawler: { name: 'CRAWLER', desc: 'バックルーム公式分類 Class 2。\n複数の眼と長い四肢。配管や狭い空間を好む。\n静止 → 突進 → 撤退の三段階を繰り返す。', voice: 'かべの、なか。' },
    wretch: { name: 'WRETCH', desc: 'バックルーム公式分類 Class 3 (Watcher 型)。\n動かないが、視線を合わせた者の SAN を胸の空洞へ吸い込む。\n目を逸らせば実害は無い。', voice: 'みてはいけない。' },
    boss: { name: 'THE ARCHITECT', desc: 'バックルーム公式分類 Class 5 (Apex)。\nLevel 9 The Suburbs を構築・管理する存在。\n王冠と赤い目。3 段階で攻撃パターンが変化する。\nフレア (50dmg) / 鏡 (100dmg) で抵抗可能。', voice: 'よく、ここまで来た。' },
    mrhotel: { name: 'MR. HOTEL', desc: 'バックルーム公式分類 Class 4。\nLevel 5 ホテルの「支配人」。シルクハットに顔の無いスーツ。\n名前を尋ねられても答えるな。盗まれる。\n4 マス以内で SAN を継続吸引。', voice: 'いらっしゃい、ませ。' },
    haruki: { name: 'HARUKI', desc: '非公式。前ホテルからの no-clipper。\nお前を追って壁の向こうまで来た存在。\n姿は不定形だが、お前の最も恐ろしい記憶として現れる。\n電話のベルが近接の兆候。', voice: 'おかえり。' },
    haruki_boss: { name: 'HARUKI 真', desc: '— 全ての階層の終着点に、彼女は立っていた。\n3 段階の追跡形態。第3段階で影分身が出現する。\nハルキの護符 (ユニーク) があれば一時的に退避可能。', voice: 'もう、にがさない。' },
    echo: { name: 'ECHO', desc: 'バックルーム未分類。\nお前の動きを 0.6 秒遅れで完全模倣する亡霊。\n直視すると鏡を見ているような感覚に襲われ、SAN が削れる。\n振り切るには思考しない急な動きが有効。', voice: 'おまえは、わたし。' },
    faceling: { name: 'FACELING', desc: 'バックルーム公式分類 Class 1 (擬態型)。\nM.E.G. メンバーや過去の no-clipper の姿に化ける。\n顔は常に「ぼやけて」見える。\n敵対的ではないが、稀に視線を合わせると SAN を引き抜く。', voice: 'だれ...だっけ。' },
    witness: { name: 'WITNESS', desc: 'バックルーム公式分類 Class 1 (静止型)。\nLevel 6 暗闇の中で、ただ立ち、お前を見続ける。\n視線が交わる時、SAN だけが静かに削れていく。\n目を逸らせば実害は無いが、振り返ると ── まだ、そこにいる。', voice: '...見て、いる。' },
    lurker: { name: 'LURKER', desc: 'バックルーム公式分類 Class 2 (追跡型)。\n薄暗い角に潜み、お前から目を逸らした瞬間に一歩近付く。\n振り向く時には既に距離が縮まっている。\n直視している間は動かない。捕まれば SAN を大量に奪われる。', voice: 'いっぽ、ちかい。' },
    shadow: { name: 'SHADOW', desc: 'バックルーム公式分類 Class 3 (幻惑型)。\nLevel 9 でハルキの周辺に現れる影。\n4-6 マスの距離を保ち、視線が交わるとプレイヤーの SAN を絶え間なく削り続ける。\n光源 (フレア / 懐中電灯) で一時的に消滅する。', voice: 'かのじょの、もの。' },
    drowned: { name: 'DROWNED', desc: 'バックルーム未分類 (水生型)。\nLevel 14 の沈んだ通路に潜む溺死者。\n水タイル上では速くなり、しがみつく — 一度掴まれば離れない。\n陸 (乾いた床) では極端に遅い。光源で一時退散。', voice: 'みず、つめたい。' },
    vinewalker: { name: 'VINEWALKER', desc: 'バックルーム未分類 (植生型)。\nLevel 15 の庭園に棲息。\n生垣の影で静止し、プレイヤーが近付くと触手状の蔓を伸ばす。\n触れると掴まれ、徐々に SAN と HP を吸い取られる。\n刀 / フレアで一時的に焼き切れる。', voice: 'ねっこ、はる。' }
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
    // Default: □ (button 2) = toggle item-shortcut HUD on/off.
    // Flare moves to ◯ (button 1) so □ can be the HUD toggle by default.
    hudToggle: 2,
    flare: 1,
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
    // Update gamepad status UI (both title settings AND phone options card).
    var statusEl = el('tsGamepadStatus');
    var phoneStatusEl = el('phoneGpStatus');
    var statusText = gp ? (gp.id.split('(')[0].trim() + ' 接続中') : '未接続';
    if (statusEl) statusEl.textContent = statusText;
    if (phoneStatusEl) phoneStatusEl.textContent = statusText;
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
      var pressedLabels = [];
      for (var pi = 0; pi < gp.buttons.length; pi++) {
        if (gp.buttons[pi].pressed) {
          var lab = window._gpBtnLabels && window._gpBtnLabels[pi];
          pressedLabels.push(lab || ('B' + pi));
        }
      }
      pressedEl.textContent = pressedLabels.length > 0 ? '押下中: ' + pressedLabels.join(' + ') : '押下中: -';
    }
    // Gamepad diagram + assign listening hooks (when settings open)
    if (typeof window._gpDiagramHook === 'function') {
      try { window._gpDiagramHook(gp); } catch (e) {}
    }
    if (typeof window._gpListeningHook === 'function') {
      try {
        if (window._gpListeningHook(gp)) return; // captured a binding; skip game input
      } catch (e) {}
    }
    // Any-button-press for cinematic dismissal (level reach, encounter, intro)
    var anyBtn = false;
    for (var abi = 0; abi < gp.buttons.length; abi++) {
      if (gp.buttons[abi].pressed) { anyBtn = true; break; }
    }
    if (anyBtn && !gp._cineDismissPressed) {
      gp._cineDismissPressed = true;
      var lrOverlay = el('levelReachCinematic');
      if (lrOverlay && lrOverlay.style.display !== 'none') {
        lrOverlay.click();
        return;
      }
      var encOverlay = el('encounterCinematic');
      if (encOverlay && encOverlay.style.display !== 'none') {
        encOverlay.click();
        return;
      }
      var introOverlay = el('introOverlay');
      if (introOverlay && introOverlay.style.display !== 'none') {
        introOverlay.click();
        return;
      }
      // Discovery popup (item pickup) — dismiss with any button
      if (_discoveryActive && typeof window._discoveryCloseFn === 'function') {
        try { window._discoveryCloseFn(); } catch (e) {}
        return;
      }
    }
    if (!anyBtn) gp._cineDismissPressed = false;
    // Handle menu navigation when overlays are open (close on action / phone button)
    var pauseBtn = gp.buttons[gamepadMap.pause];
    var actionBtnRaw = gp.buttons[gamepadMap.action];
    var phoneBtnRaw = gp.buttons[gamepadMap.phone];
    var anyClose = (pauseBtn && pauseBtn.pressed) || (phoneBtnRaw && phoneBtnRaw.pressed);
    var anyConfirm = actionBtnRaw && actionBtnRaw.pressed;

    // ── MINIGAME GAMEPAD INPUT ─────────────────────────────────
    // Left stick / D-pad moves a virtual cursor on the minigame canvas, A
    // taps where the cursor sits. Holding A while moving emits drag events.
    // Mini-games already handle tap/drag via their def.onTap / def.onDrag,
    // so no per-game wiring needed.
    var mgOverlay = el('minigameOverlay');
    if (mgOverlay && mgOverlay.style.display !== 'none' && mgOverlay.style.display !== '' &&
        miniGameOpen && currentMiniGame) {
      var mgCanvas = el('minigameCanvas');
      if (mgCanvas) {
        if (!gp._mgCursor) {
          gp._mgCursor = { x: mgCanvas.width / 2, y: mgCanvas.height / 2 };
        }
        // Movement: left stick (axes 0,1) priority, fall back to D-pad
        var lx = gp.axes[0] || 0;
        var ly = gp.axes[1] || 0;
        if (Math.abs(lx) < 0.15) lx = 0;
        if (Math.abs(ly) < 0.15) ly = 0;
        var dpUp    = gp.buttons[12] && gp.buttons[12].pressed;
        var dpDown  = gp.buttons[13] && gp.buttons[13].pressed;
        var dpLeft  = gp.buttons[14] && gp.buttons[14].pressed;
        var dpRight = gp.buttons[15] && gp.buttons[15].pressed;
        if (dpLeft)  lx = -1;
        if (dpRight) lx =  1;
        if (dpUp)    ly = -1;
        if (dpDown)  ly =  1;
        var spd = Math.min(mgCanvas.width, mgCanvas.height) * 0.018;
        gp._mgCursor.x += lx * spd;
        gp._mgCursor.y += ly * spd;
        gp._mgCursor.x = Math.max(0, Math.min(mgCanvas.width  - 1, gp._mgCursor.x));
        gp._mgCursor.y = Math.max(0, Math.min(mgCanvas.height - 1, gp._mgCursor.y));
        // A button → tap (on press), B/× → close
        var mgConfirm = gp.buttons[gamepadMap.action] && gp.buttons[gamepadMap.action].pressed;
        var mgCancel  = gp.buttons[1] && gp.buttons[1].pressed;
        var def = MINI_GAMES && MINI_GAMES[currentMiniGame];
        if (def) {
          if (mgConfirm && !gp._mgConfirmPrev) {
            if (def.onTap) def.onTap(gp._mgCursor.x, gp._mgCursor.y, mgCanvas.width, mgCanvas.height);
          } else if (mgConfirm && (lx !== 0 || ly !== 0)) {
            if (def.onDrag) def.onDrag(gp._mgCursor.x, gp._mgCursor.y, mgCanvas.width, mgCanvas.height);
          }
        }
        gp._mgConfirmPrev = mgConfirm;
        if (mgCancel && !gp._mgCancelPrev) {
          try { closeMiniGame(); } catch (e) {}
        }
        gp._mgCancelPrev = mgCancel;
        // Render a cursor overlay so the player sees where the tap will land.
        try {
          var mgCtx = mgCanvas.getContext('2d');
          mgCtx.save();
          mgCtx.strokeStyle = '#ffd070';
          mgCtx.lineWidth = 2;
          mgCtx.beginPath();
          mgCtx.arc(gp._mgCursor.x, gp._mgCursor.y, 10, 0, Math.PI * 2);
          mgCtx.stroke();
          mgCtx.strokeStyle = 'rgba(0,0,0,0.85)';
          mgCtx.beginPath();
          mgCtx.arc(gp._mgCursor.x, gp._mgCursor.y, 12, 0, Math.PI * 2);
          mgCtx.stroke();
          mgCtx.restore();
        } catch (e) {}
        return; // do not pass input through to the world while a minigame is up
      }
    }

    // Global lock: any overlay close path can set window._gpGlobalLockUntil
    // to suppress the still-held button from confirming a title menu item.
    if (window._gpGlobalLockUntil && performance.now() < window._gpGlobalLockUntil) {
      gp._titleConfirm = true;
      gp._cursorClick = true;
      gp._menuClosePressed = true;
      return;
    }
    // Input lockout: after closing a menu, ignore action button for 400ms
    // (prevents the same press from triggering title nav / game start)
    if (gp._inputLockUntil && performance.now() < gp._inputLockUntil) {
      // Allow menu close (pause) but block action/start firing
      if (actionBtnRaw && actionBtnRaw.pressed) {
        gp._titleConfirm = true; // pre-set so we don't fire on lock release
        gp._cursorClick = true;
      }
    }

    // Cursor mode for any overlay that needs UI clicks.
    // Activates when any of these overlays is visible. Cursor moves with left stick
    // (or D-pad), action button clicks element under cursor.
    // noteViewerOverlay handled separately as any-button-close
    var cursorOverlays = ['phoneOverlay', 'titleSettingsOverlay', 'tutorialOverlay',
                          'levelSelectOverlay'];
    var cursorActive = false;
    for (var coi = 0; coi < cursorOverlays.length; coi++) {
      var coEl = el(cursorOverlays[coi]);
      if (coEl && coEl.style.display !== 'none' && coEl.style.display !== '') {
        cursorActive = true;
        break;
      }
    }
    if (cursorActive) {
      // Pause button: close phone or current settings overlay
      if (pauseBtn && pauseBtn.pressed && !gp._menuClosePressed) {
        gp._menuClosePressed = true;
        if (phoneOpen) { closePhone(); return; }
        var settingsEl = el('titleSettingsOverlay');
        if (settingsEl && settingsEl.style.display !== 'none') {
          hideOverlay('titleSettingsOverlay');
          gp._inputLockUntil = performance.now() + 400;
          return;
        }
        var tutEl2 = el('tutorialOverlay');
        if (tutEl2 && tutEl2.style.display !== 'none') {
          hideOverlay('tutorialOverlay');
          gp._inputLockUntil = performance.now() + 400;
          return;
        }
        var lvlEl = el('levelSelectOverlay');
        if (lvlEl && lvlEl.style.display !== 'none') {
          hideOverlay('levelSelectOverlay');
          gp._inputLockUntil = performance.now() + 400;
          return;
        }
      }
      if (!(pauseBtn && pauseBtn.pressed)) gp._menuClosePressed = false;

      var cur = el('gpCursor');
      if (cur) {
        if (cur.style.display === 'none') {
          cur._x = window.innerWidth / 2;
          cur._y = window.innerHeight / 2;
          cur.style.display = 'block';
        }
        // Left stick: smooth move
        var cx = gp.axes[0] || 0;
        var cy = gp.axes[1] || 0;
        var cm = Math.sqrt(cx * cx + cy * cy);
        if (cm > 0.15) {
          var step = 10 * (1 + cm * 2);
          cur._x += cx * step;
          cur._y += cy * step;
        }
        // D-pad: fixed step
        var dpadStep = 8;
        if (gp.buttons[12] && gp.buttons[12].pressed) cur._y -= dpadStep;
        if (gp.buttons[13] && gp.buttons[13].pressed) cur._y += dpadStep;
        if (gp.buttons[14] && gp.buttons[14].pressed) cur._x -= dpadStep;
        if (gp.buttons[15] && gp.buttons[15].pressed) cur._x += dpadStep;
        // Right stick: scroll the focused scroll container at cursor
        var sy = gp.axes[3] || 0;
        if (Math.abs(sy) > 0.15) {
          var scrollTarget = document.elementFromPoint(cur._x, cur._y);
          while (scrollTarget) {
            if (scrollTarget.scrollHeight > scrollTarget.clientHeight) {
              scrollTarget.scrollTop += sy * 14;
              break;
            }
            scrollTarget = scrollTarget.parentElement;
          }
        }
        // Clamp
        cur._x = Math.max(8, Math.min(window.innerWidth - 8, cur._x));
        cur._y = Math.max(8, Math.min(window.innerHeight - 8, cur._y));
        cur.style.left = cur._x + 'px';
        cur.style.top = cur._y + 'px';
        // Action: click at cursor
        if (actionBtnRaw && actionBtnRaw.pressed && !gp._cursorClick) {
          gp._cursorClick = true;
          var target = document.elementFromPoint(cur._x, cur._y);
          if (target) {
            try { target.click(); } catch (e) {}
            // If it's a slider, simulate slight value change by axis Y
            if (target.tagName === 'INPUT' && target.type === 'range') {
              // Allow horizontal nav on focused slider via D-pad left/right
            }
          }
          // If the click caused all cursor overlays to close, lock input briefly
          // so the still-held action button does NOT fall through to the title
          // menu (which would auto-confirm "START"). Title-settings close bug fix.
          var stillCursorActive = false;
          for (var coj = 0; coj < cursorOverlays.length; coj++) {
            var coEl2 = el(cursorOverlays[coj]);
            if (coEl2 && coEl2.style.display !== 'none' && coEl2.style.display !== '') {
              stillCursorActive = true;
              break;
            }
          }
          if (!stillCursorActive) {
            gp._inputLockUntil = performance.now() + 500;
            gp._titleConfirm = true;
          }
        } else if (!(actionBtnRaw && actionBtnRaw.pressed)) {
          gp._cursorClick = false;
        }
        // R1 / L1: nudge focused slider value if any
        if (gp.buttons[5] && gp.buttons[5].pressed && !gp._sliderUpPressed) {
          gp._sliderUpPressed = true;
          var st = document.elementFromPoint(cur._x, cur._y);
          if (st && st.tagName === 'INPUT' && st.type === 'range') {
            st.value = Math.min(parseInt(st.max, 10), parseInt(st.value, 10) + 5);
            st.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else if (!(gp.buttons[5] && gp.buttons[5].pressed)) gp._sliderUpPressed = false;
        if (gp.buttons[4] && gp.buttons[4].pressed && !gp._sliderDownPressed) {
          gp._sliderDownPressed = true;
          var st2 = document.elementFromPoint(cur._x, cur._y);
          if (st2 && st2.tagName === 'INPUT' && st2.type === 'range') {
            st2.value = Math.max(parseInt(st2.min, 10), parseInt(st2.value, 10) - 5);
            st2.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else if (!(gp.buttons[4] && gp.buttons[4].pressed)) gp._sliderDownPressed = false;
      }
      return;
    } else {
      // Hide cursor when no cursor overlay is active
      var curHide = el('gpCursor');
      if (curHide && curHide.style.display !== 'none') curHide.style.display = 'none';
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
    // Note viewer → any button closes (truly any controller button)
    // Gate: the same press that opened the note (拾う) must not close it.
    // Wait for the open-grace period, AND for the button to first be released
    // (so close requires a fresh press, not the still-held pickup button).
    var nveEl = el('noteViewerOverlay');
    if (nveEl && nveEl.style.display !== 'none') {
      var sinceOpen = performance.now() - _noteViewerOpenedAt;
      if (sinceOpen < NOTE_INPUT_LOCK_MS) {
        // Force: any button held during grace counts as still-held; mark as pressed
        // so we don't fire close right after grace ends from the same press.
        if (anyBtn) gp._menuClosePressed = true;
        return;
      }
      if (!anyBtn) {
        // Button released after grace — arm the global close gate so the next
        // fresh press (or any keyup/touchend that already fired) can close.
        gp._menuClosePressed = false;
        if (typeof _armNoteCloseIfReady === 'function') _armNoteCloseIfReady();
      }
      if (anyBtn && !gp._menuClosePressed) {
        gp._menuClosePressed = true;
        if (typeof _armNoteCloseIfReady === 'function') _armNoteCloseIfReady();
        var closeNoteBtn = el('closeNoteBtn');
        if (closeNoteBtn) closeNoteBtn.click();
        gp._inputLockUntil = performance.now() + 400;
      }
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

    // Title screen — D-pad up/down to navigate, action to confirm
    if (state === ST.TITLE) {
      var ts = el('titleScreen');
      if (ts && ts.style.display !== 'none') {
        // Cache button list to avoid per-frame querySelectorAll. Refresh only when
        // visible button count changes (e.g., continue/freeRoam become visible).
        if (!gp._titleBtns) gp._titleBtns = ts.querySelectorAll('.title-menu .menu-btn');
        var visBtns = [];
        for (var bi = 0; bi < gp._titleBtns.length; bi++) {
          if (gp._titleBtns[bi].offsetParent !== null) visBtns.push(gp._titleBtns[bi]);
        }
        if (visBtns.length > 0) {
          if (gp._titleIdx === undefined) gp._titleIdx = 0;
          var dpadUp = (gp.buttons[12] && gp.buttons[12].pressed) || (gp.axes[1] || 0) < -0.5;
          var dpadDown = (gp.buttons[13] && gp.buttons[13].pressed) || (gp.axes[1] || 0) > 0.5;
          if (dpadDown && !gp._titleNav) {
            gp._titleNav = true;
            gp._titleIdx = (gp._titleIdx + 1) % visBtns.length;
          } else if (dpadUp && !gp._titleNav) {
            gp._titleNav = true;
            gp._titleIdx = (gp._titleIdx - 1 + visBtns.length) % visBtns.length;
          } else if (!dpadUp && !dpadDown) {
            gp._titleNav = false;
          }
          for (var bi2 = 0; bi2 < visBtns.length; bi2++) {
            visBtns[bi2].style.outline = (bi2 === gp._titleIdx) ? '2px solid #d4b340' : '';
          }
          if (anyConfirm && !gp._titleConfirm) {
            gp._titleConfirm = true;
            visBtns[gp._titleIdx].click();
          }
          if (!anyConfirm) gp._titleConfirm = false;
        }
      }
      return;
    }

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
      // Toggle: same button closes the phone if it's already open.
      if (phoneOpen) { closePhone(); }
      else            { openPhone(); }
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
    // Item-shortcut HUD toggle (default □) — show/hide the D-pad assignment
    // overlay so the player can hide it when not needed.
    if (typeof gamepadMap.hudToggle === 'number') {
      var hudBtn = gp.buttons[gamepadMap.hudToggle];
      if (hudBtn && hudBtn.pressed && !gp._hudTogglePressed) {
        gp._hudTogglePressed = true;
        var dh = el('dpadHud');
        if (dh) {
          var isHidden = dh.style.display === 'none';
          dh.style.display = isHidden ? 'block' : 'none';
          toast('ショートカット HUD ' + (isHidden ? '表示' : '非表示'));
        }
      } else if (!(hudBtn && hudBtn.pressed)) {
        gp._hudTogglePressed = false;
      }
    }
    // L1 (button 4): toggle D-pad mode (weapon ⇄ item)
    // R1 (button 5): fire equipped weapon (was mode toggle — user remap
    // per directive PPP).
    var l1Btn = gp.buttons[4];
    if (l1Btn && l1Btn.pressed && !gp._l1Pressed) {
      gp._l1Pressed = true;
      dpadMode = (dpadMode === 'weapon') ? 'item' : 'weapon';
      saveDpadAssignments();
      toast(dpadMode === 'weapon' ? '武器モード' : 'アイテムモード');
      updateDpadHud();
    } else if (!(l1Btn && l1Btn.pressed)) {
      gp._l1Pressed = false;
    }
    var r1Btn = gp.buttons[5];
    if (r1Btn && r1Btn.pressed && !gp._r1Pressed) {
      gp._r1Pressed = true;
      try { fireEquippedWeapon(); } catch (e) {}
    } else if (!(r1Btn && r1Btn.pressed)) {
      gp._r1Pressed = false;
    }
    // D-pad: quick-use assigned items (mode-specific)
    // Debounce: 250ms cooldown on the same direction so high-FPS rigs and
    // accidental held inputs don't multi-trigger item consumption.
    if (!gp._dpadHeld) gp._dpadHeld = { up: false, down: false, left: false, right: false };
    if (!gp._dpadLastFire) gp._dpadLastFire = { up: 0, down: 0, left: 0, right: 0 };
    var nowMs = performance.now();
    var dpadMap = [{ btn: 12, dir: 'up' }, { btn: 13, dir: 'down' },
                   { btn: 14, dir: 'left' }, { btn: 15, dir: 'right' }];
    for (var dpi = 0; dpi < dpadMap.length; dpi++) {
      var dbtn = gp.buttons[dpadMap[dpi].btn];
      var dpDir = dpadMap[dpi].dir;
      if (dbtn && dbtn.pressed && !gp._dpadHeld[dpDir]) {
        gp._dpadHeld[dpDir] = true;
        if (nowMs - gp._dpadLastFire[dpDir] >= 120) {
          gp._dpadLastFire[dpDir] = nowMs;
          var assignedId = (dpadAssignments[dpadMode] || {})[dpDir];
          if (assignedId) {
            // 「十字キーはあくまで武器選択、攻撃自体はr1か右の攻撃ボタン」
            // weapon mode → equip only. item mode → use directly.
            if (dpadMode === 'weapon' && ITEMS[assignedId] &&
                ITEMS[assignedId].category === 'weapon') {
              equipWeapon(assignedId);
            } else {
              quickUseAssignedItem(assignedId);
            }
          }
        }
      } else if (!(dbtn && dbtn.pressed)) {
        gp._dpadHeld[dpDir] = false;
      }
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
    // If a previous discovery is still showing, fire its close handler first to
    // clear its listeners (prevent listener stacking + race conditions).
    if (typeof window._discoveryCloseFn === 'function') {
      try { window._discoveryCloseFn(); } catch (e) {}
    }
    if (_discoveryTimer) clearTimeout(_discoveryTimer);
    // Discovery icon — accept either an emoji or an item id (so weapon
    // pickups can show the realistic SVG instead of the cartoon emoji).
    var iconEl = el('discoveryIcon');
    if (iconEl) {
      if (typeof icon === 'string' && ITEMS[icon] && WEAPON_SVG[icon]) {
        iconEl.innerHTML = '<span style="display:inline-block;width:48px;height:48px;vertical-align:middle">' + WEAPON_SVG[icon] + '</span>';
      } else {
        iconEl.textContent = icon;
      }
    }
    el('discoveryLabel').textContent = label;
    el('discoveryName').textContent = name;
    pop.classList.remove('show');
    pop.style.display = 'flex';
    // User report 2026-06-08: 「アイテムを拾うと硬直する」.
    // Root cause: pointer-events: 'auto' on the popup intercepted
    // touches in its screen area while it was visible (up to 2.6s),
    // blocking the joystick / look zone underneath. Now non-blocking
    // — the popup is purely informational; auto-dismiss handles
    // cleanup so no tap is needed.
    pop.style.pointerEvents = 'none';
    void pop.offsetWidth; // force reflow
    pop.classList.add('show');
    _discoveryActive = true;

    var closed = false;
    var closeFn = function () {
      if (closed) return;
      closed = true;
      if (window._discoveryCloseFn === closeFn) window._discoveryCloseFn = null;
      pop.classList.remove('show');
      setTimeout(function () {
        pop.style.display = 'none';
        _discoveryActive = false;
      }, 400);
    };
    window._discoveryCloseFn = closeFn;
    // Auto-dismiss after 1.8s (was 2.6s) — input-non-blocking now so
    // it can clear faster without feeling rushed.
    _discoveryTimer = setTimeout(closeFn, 1800);
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
    // Entity-specific icons. Added entries for the new 2026-06 cast
    // (witness/lurker/shadow/drowned/vinewalker/civilian) so the
    // encounter card doesn't default to '⚠' for them.
    var entityIcons = {
      hound: '🐺', smiler: '😬', skinstealer: '🧥', partygoer: '🎉',
      crawler: '🕷', wretch: '👁', boss: '👑', mrhotel: '🎩',
      haruki: '👤', haruki_boss: '🩸', faceling: '🫥', echo: '🌀',
      witness: '👁‍🗨', lurker: '🕵', shadow: '🌑',
      drowned: '🫧', vinewalker: '🌿', civilian: '🧍'
    };
    el('encounterShape').textContent = entityIcons[entityType] || '⚠';
    el('encounterName').textContent = intro.name;
    el('encounterDesc').textContent = intro.desc + '\n\n[ 画面をタップして閉じる ]';
    showOverlay('encounterCinematic');
    // Speak the entity's signature voice line ~1.2s after the card opens
    // so it lands AFTER the jumpscare audio. Uses the raspy creep TTS
    // settings established this session (pitch 0.1, rate 0.45, layered
    // whisper+breath). Silent if no voice line is defined.
    if (intro.voice) {
      setTimeout(function () { try { _uncannySpeak(intro.voice); } catch (e) {} }, 1200);
    }
    if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 80]);
    // Tap-to-close (no auto-dismiss). Safety net: auto-close after 30s.
    var encOverlay = el('encounterCinematic');
    // Clean up any leftover listeners from a previous encounter (prevent stacking).
    if (encOverlay._cleanup) { try { encOverlay._cleanup(); } catch (e) {} }
    var encDone = false;
    var encCanClose = false;
    setTimeout(function () { encCanClose = true; }, 500);
    var encClose = function () {
      if (encDone || !encCanClose) return;
      encDone = true;
      encOverlay.removeEventListener('click', encClose);
      encOverlay.removeEventListener('touchstart', encClose);
      encOverlay._cleanup = null;
      hideOverlay('encounterCinematic');
      _inCinematic = false;
    };
    encOverlay._cleanup = function () {
      encDone = true;
      encOverlay.removeEventListener('click', encClose);
      encOverlay.removeEventListener('touchstart', encClose);
    };
    encOverlay.style.pointerEvents = 'auto';
    encOverlay.addEventListener('click', encClose);
    encOverlay.addEventListener('touchstart', encClose);
    setTimeout(function () { encCanClose = true; encClose(); }, 30000);
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
    pickupRenderList = [];
    // Index of weapon-only spots so we always roll a weapon for them.
    var weaponSpotSet = {};
    if (parsed.weaponSpots) {
      for (var wsi0 = 0; wsi0 < parsed.weaponSpots.length; wsi0++) {
        var ws0 = parsed.weaponSpots[wsi0];
        weaponSpotSet[gridKey(ws0.gx, ws0.gy)] = true;
      }
    }
    var weaponPool = pool.filter(function (id) {
      return ITEMS[id] && ITEMS[id].category === 'weapon';
    });
    // Ensure at least one weapon option even if the level pool has none — a
    // 'w' tile is a promise that the player will find a weapon here.
    if (weaponPool.length === 0) weaponPool = ['pistol'];

    // Build a level-specific BIASED weapon pool. For every entity placed on
    // this level, look up WEAPON_DAMAGE_MULT and add weapons that are strong
    // (mul > 1.0) against that enemy as extra entries so the random roll
    // is more likely to give the player something useful here.
    // Example: a level with WRETCHes will spawn more flares / soul_lanterns.
    var biasedWeapons = weaponPool.slice();
    if (def.entities) {
      for (var bei = 0; bei < def.entities.length; bei++) {
        var et = def.entities[bei].type;
        var mults = WEAPON_DAMAGE_MULT[et];
        if (!mults) continue;
        for (var wkey in mults) {
          if (!Object.prototype.hasOwnProperty.call(mults, wkey)) continue;
          if (mults[wkey] <= 1.05) continue;
          if (!weaponPool.indexOf || weaponPool.indexOf(wkey) < 0) continue;
          // Add a duplicate entry for every level above 1.0 — 1.4 → +1 entry,
          // 1.8 → +2 entries, 2.0 → +2 entries (caps to keep balance).
          var extra = Math.min(2, Math.floor((mults[wkey] - 1.0) * 2));
          for (var ee = 0; ee < extra; ee++) biasedWeapons.push(wkey);
        }
      }
    }

    // Per-difficulty spawn density. User request 2026-06-07:
    // 「武器orアイテムの出現箇所をもう少し増やしてもいい。chaos難易度
    //   だけ少ないようにする」.
    // We treat every non-weapon item spot as eligible for a difficulty-
    // gated drop chance. Chaos drops 30% of spots; easy keeps every spot.
    // Weapon-only 'w' tiles always spawn (they are the level designer's
    // promised drops — gating them would break the weapon budget logic).
    var DIFF_SPAWN_KEEP = { easy: 1.00, normal: 1.00, hard: 0.85, chaos: 0.50 };
    var keepChance = DIFF_SPAWN_KEEP[currentDifficulty] != null
                   ? DIFF_SPAWN_KEEP[currentDifficulty] : 1.0;
    // Skipped spots are kept aside so the required-items pass can still
    // place flashlight / keycard / lockpick on chaos when most rolls are
    // dropped.
    var _skippedSpots = [];
    for (var i = 0; i < parsed.itemSpots.length; i++) {
      var spot = parsed.itemSpots[i];
      var key = gridKey(spot.gx, spot.gy);
      // Skip if already picked up in this run
      if (pickedUpItems[levelId] && pickedUpItems[levelId][key]) continue;
      var itemId;
      if (weaponSpotSet[key]) {
        itemId = biasedWeapons[Math.floor(Math.random() * biasedWeapons.length)];
      } else {
        // Difficulty-gated drop: chaos = 50% kept, hard = 85%, normal/easy = 100%.
        if (keepChance < 1.0 && Math.random() > keepChance) {
          _skippedSpots.push({ key: key, gx: spot.gx, gy: spot.gy });
          continue;
        }
        // User request 2026-06-07: 「武器の出現確率をもっと上げて」.
        // ~45% of un-dedicated item spots now roll from biasedWeapons
        // (the level's level-appropriate weapon list). Falls back to the
        // generic pool roll otherwise — keeps the existing weapon-budget
        // cap working since over-cap weapons are downgraded below.
        if (biasedWeapons.length > 0 && Math.random() < 0.45) {
          itemId = biasedWeapons[Math.floor(Math.random() * biasedWeapons.length)];
        } else {
          itemId = pool[Math.floor(Math.random() * pool.length)];
        }
      }
      pickupSpots[key] = itemId;
      pickupRenderList.push({ key: key, wx: spot.gx * TS + TS / 2, wy: spot.gy * TS + TS / 2, itemId: itemId });
    }
    // ── Guarantee level-required items ──
    // Random pool rolls don't promise the player will actually find the
    // gating items the level needs (flashlight for dark levels, keycard
    // for the Lv4 gate, lockpick for Lv8). User report: 「灯りが必要な
    // 場所があるのに懐中電灯が入手できない」. Force one un-picked item
    // spot to hold the required item if no random roll did.
    var LEVEL_REQUIRED_ITEMS = {
      0:  ['flashlight'],
      1:  ['keycard'],     // Lv4 gate uses keycard — let player pre-stock
      3:  ['flashlight'],
      4:  ['keycard'],
      6:  ['flashlight'],
      7:  ['lockpick'],    // Lv8 gate uses lockpick
      8:  ['lockpick'],
      11: ['flashlight'],
      14: ['flashlight']
    };
    var required = LEVEL_REQUIRED_ITEMS[levelId];
    if (required && required.length) {
      // Candidate spots: any non-weapon tile in pickupSpots PLUS any
      // _skippedSpots that the difficulty-gate dropped. Skipped ones
      // get re-activated for required items so even chaos can't lock
      // the player out of the flashlight.
      var candidateSpots = []; // {key, gx, gy}
      for (var kk in pickupSpots) {
        if (!Object.prototype.hasOwnProperty.call(pickupSpots, kk)) continue;
        if (weaponSpotSet[kk]) continue;
        var rl = null;
        for (var rli = 0; rli < pickupRenderList.length; rli++) {
          if (pickupRenderList[rli].key === kk) { rl = pickupRenderList[rli]; break; }
        }
        if (rl) candidateSpots.push({ key: kk, gx: Math.floor(rl.wx / TS), gy: Math.floor(rl.wy / TS) });
      }
      for (var ssi = 0; ssi < _skippedSpots.length; ssi++) {
        candidateSpots.push(_skippedSpots[ssi]);
      }
      for (var ri = 0; ri < required.length; ri++) {
        var reqId = required[ri];
        var have = false;
        for (var pk in pickupSpots) { if (pickupSpots[pk] === reqId) { have = true; break; } }
        if (have) continue;
        if ((player.inventory[reqId] || 0) > 0) continue;
        if (candidateSpots.length > 0) {
          var c = candidateSpots.shift();
          if (pickupSpots[c.key]) {
            // Existing spot — just override the itemId and update render list.
            pickupSpots[c.key] = reqId;
            for (var pri = 0; pri < pickupRenderList.length; pri++) {
              if (pickupRenderList[pri].key === c.key) {
                pickupRenderList[pri].itemId = reqId;
                break;
              }
            }
          } else {
            // Was skipped by difficulty gate — register a fresh render entry.
            pickupSpots[c.key] = reqId;
            pickupRenderList.push({
              key: c.key,
              wx: c.gx * TS + TS / 2,
              wy: c.gy * TS + TS / 2,
              itemId: reqId
            });
          }
        }
      }
    }
    // Enforce weapon budget — even using every weapon found cannot clear the
    // floor of enemies. Lv9 is the only exception (boss arena, generous cap).
    // Any over-cap weapons are downgraded to a non-weapon roll from the pool.
    // Caps bumped 2026-06-07 in tandem with the 45% weapon bias on
    // un-dedicated item spots (user: 「武器の出現確率をもっと上げて」).
    // Roughly +50% across the board; Lv9 boss arena unchanged at 10.
    var WEAPON_BUDGET_BY_LEVEL = {
      3: 3, 4: 3, 5: 5, 6: 4, 7: 6, 8: 5, 11: 3, 12: 5, 13: 5,
      14: 3, 15: 5,
      9: 10  // final boss arena: user requested 武器を大量配置
    };
    var weaponCap = (WEAPON_BUDGET_BY_LEVEL[levelId] != null) ? WEAPON_BUDGET_BY_LEVEL[levelId] : 2;
    var nonWeaponPool = pool.filter(function (id) {
      return !(ITEMS[id] && ITEMS[id].category === 'weapon');
    });
    if (nonWeaponPool.length === 0) nonWeaponPool = ['almond_water'];
    // Collect weapon spot keys, EXCLUDING dedicated 'w' spots which are
    // promised weapon drops. Shuffle so the downgrade is fair.
    var weaponKeys = [];
    for (var wk in pickupSpots) {
      if (Object.prototype.hasOwnProperty.call(pickupSpots, wk)) {
        if (weaponSpotSet[wk]) continue;
        var wid = pickupSpots[wk];
        if (ITEMS[wid] && ITEMS[wid].category === 'weapon') weaponKeys.push(wk);
      }
    }
    // Weapon budget excludes the guaranteed 'w' spots (already counted as
    // intentional drops by the level designer).
    var dedicatedWeaponCount = parsed.weaponSpots ? parsed.weaponSpots.length : 0;
    var remainingCap = Math.max(0, weaponCap - dedicatedWeaponCount);
    for (var wsh = weaponKeys.length - 1; wsh > 0; wsh--) {
      var wj = Math.floor(Math.random() * (wsh + 1));
      var wt = weaponKeys[wsh]; weaponKeys[wsh] = weaponKeys[wj]; weaponKeys[wj] = wt;
    }
    if (weaponKeys.length > remainingCap) {
      for (var wOver = remainingCap; wOver < weaponKeys.length; wOver++) {
        var dk = weaponKeys[wOver];
        var newId = nonWeaponPool[Math.floor(Math.random() * nonWeaponPool.length)];
        pickupSpots[dk] = newId;
        // Update render list entry too
        for (var pri = 0; pri < pickupRenderList.length; pri++) {
          if (pickupRenderList[pri].key === dk) {
            pickupRenderList[pri].itemId = newId;
            break;
          }
        }
      }
    }

    // Assign notes randomly from pool (every run shows different notes)
    var notesPool = NOTES_POOL[levelId] || [];
    noteSpots = {};
    noteRenderList = [];
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
      noteRenderList.push({ key: nkey, wx: ns.gx * TS + TS / 2, wy: ns.gy * TS + TS / 2 });
    }

    return parsed;
  }

  function setLevel(levelId, instant) {
    var def = LEVELS[levelId];
    if (!def) {
      console.error('Unknown level', levelId);
      // Recover from a state stuck in LOADING — fall back to title so the
      // player isn't softlocked on a black screen if level progression bug fires.
      if (state === ST.LOADING) {
        try { returnToTitle(); } catch (e) {}
      }
      return;
    }
    currentLevel = levelId;
    currentLevelDef = def;
    visitedLevels[levelId] = true;
    inLevelTime = 0;
    // Refresh shop stock per level so each visit gets new wares
    shopState.stock = null;

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
      11: 'metal', 12: 'wood', 14: 'water', 15: 'gravel'
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
    // Key-item gate: a per-level whitelist of doors that start locked and
    // need a specific inventory item to unlock. Picked deterministically so
    // the same door is the gate every run. Unlike the generic 'keycard' lock,
    // these doors cannot be lockpicked — only the named key works.
    var LEVEL_KEY_GATES = {
      // Lv4 THE OFFICE: blueprint required to reach the deeper rooms.
      4: [{ rel: 'first', keyId: 'keycard', label: 'カードキー' }],
      // Lv8 THE HIVE: lockpick the staff-only inner door.
      8: [{ rel: 'last',  keyId: 'lockpick', label: 'ロックピック' }]
    };
    var gateSpec = LEVEL_KEY_GATES[levelId];
    if (gateSpec) {
      var doorKeys = Object.keys(doorStates).sort();
      for (var gsi = 0; gsi < gateSpec.length; gsi++) {
        var gs = gateSpec[gsi];
        var pickKey = (gs.rel === 'last') ? doorKeys[doorKeys.length - 1]
                    : (gs.rel === 'mid')  ? doorKeys[Math.floor(doorKeys.length / 2)]
                    :                       doorKeys[0];
        if (pickKey && doorStates[pickKey]) {
          doorStates[pickKey].locked = true;
          doorStates[pickKey].keyId = gs.keyId;
          doorStates[pickKey].keyLabel = gs.label;
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
        // Per-type HP base so CHAOS / NORMAL difficulty actually scales.
        // Boss-class values are the BOSS HP pool (bossHp), not regular hp.
        // User asked 2026-06-07 「ボスの耐久力をもっと高くする」 — bumped
        // boss/haruki_boss base from 200 / 200 → 600 / 900 so a hand-cannon
        // pistol mag no longer ends them in 4-5 hits.
        var hpBase = ({
          hound: 60,
          skinstealer: 80,
          smiler: 90,
          partygoer: 50,
          boss: 600,
          haruki_boss: 900
        })[ent.type] || 100;
        var isBoss = (ent.type === 'boss' || ent.type === 'haruki_boss');
        var diffMul = (DIFFICULTIES[currentDifficulty] && DIFFICULTIES[currentDifficulty].hpMul) || 1;
        // Enemy HP scales inversely to player hpMul — harder diff = tougher enemies.
        var enemyHp = Math.round(hpBase * (2 - diffMul));
        var spawn = {
          type: ent.type,
          x: ent.gx * TS + TS / 2,
          y: ent.gy * TS + TS / 2,
          angle: 0,
          state: 'wander',
          stateTimer: 0,
          targetX: ent.gx * TS + TS / 2,
          targetY: ent.gy * TS + TS / 2,
          alive: true,
          hp: enemyHp,
          hpMax: enemyHp,
          color: getEntityColor(ent.type),
          bodyColor: '#000000'
        };
        if (isBoss) {
          spawn.bossHp = enemyHp;     // overrides the legacy fallback of 200
          spawn.bossHpMax = enemyHp;
        }
        entities.push(spawn);
      }
    }

    // Add point lights for visibility (per-level pattern)
    GameEngine.pointLights = [];
    addLevelLights(levelId);

    // Decorative props (desks/beds/lamps/...) — render-only, no collision.
    // Populated from LEVEL_PROP_CONFIG using the actual built map so props
    // never end up inside a wall when the layout shifts.
    try { populateProps(levelId); } catch (e) { props = []; }

    // Per-level ambient particles (dust / embers / leaves / bubbles ...)
    try { initParticlesForLevel(levelId); } catch (e) { particles = []; particleConfig = null; }

    // Reset floor decals (blood splats etc.) — they're scoped to the
    // current level, no cross-level persistence.
    try { clearDecals(); } catch (e) { decals = []; }

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

    // Loading screen — then Level Reach cinematic before play.
    // User report 2026-06-08:
    //   1) 「レベル遷移に時間がかかる」 — 900ms ハードロード + 1100ms FPS
    //      descent が長く感じる。350ms に短縮し、cinematic への tap-gate
    //      も 400ms → 150ms に。
    //   2) 「レベル遷移時に画面サイズが変わるバグ」 — forceCanvasResize
    //      を遷移中に 4 箇所で呼んでおり、iOS Safari の URL バー出現と
    //      重なって canvas が複数回 reflow していた。最終 startPlaying
    //      直前の 1 回だけに集約。
    if (!instant) {
      showLoadingScreen(def);
      setTimeout(function () {
        hideOverlay('loadingScreen');
        var afterReach = function () {
          forceCanvasResize();
          startPlaying();
        };
        if (levelId === 9 && typeof playHarukiBossCutscene === 'function') {
          playHarukiBossCutscene(function () {
            playLevelReachCinematic(def, afterReach);
          });
        } else {
          playLevelReachCinematic(def, afterReach);
        }
      }, 350);
    } else {
      forceCanvasResize();
      startPlaying();
    }
  }

  // Idempotent resize — only triggers _resize + the global resize event
  // when the viewport actually changed since the previous call. Without
  // this guard, multiple back-to-back invocations during a transition
  // caused visible canvas size flickers (user 2026-06-08).
  var _lastResizeW = 0, _lastResizeH = 0;
  function forceCanvasResize() {
    var iw = window.innerWidth, ih = window.innerHeight;
    if (iw === _lastResizeW && ih === _lastResizeH) return;
    _lastResizeW = iw;
    _lastResizeH = ih;
    if (GameEngine._resize) GameEngine._resize();
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }

  // ── Haruki Boss Reveal Cutscene ──
  // ~8s animated CSS sequence: silhouette walks forward through rain,
  // lightning strikes twice, portrait zooms in, then transitions out.
  // Draw a stylised walking human silhouette. Used by the 3rd-person cutscene
  // canvases (boss approach, ending walk-away). Walking cycle driven by `t`
  // so each canvas controls its own animation timing.
  //   cx, cy:    centre of the figure (feet ground reference is cy + h*0.5)
  //   h:         total head-to-toe height in pixels
  //   t:         seconds elapsed (drives leg/arm swing)
  //   opts:      { color, facing ('forward'|'away'|'side'), hair (bool) }
  function drawWalkingFigure(ctx, cx, cy, h, t, opts) {
    opts = opts || {};
    var color = opts.color || '#000';
    var facing = opts.facing || 'forward';
    var hair = opts.hair !== false;
    var phase = Math.sin(t * 8); // walking cycle
    var headR = h * 0.13;
    var bodyTopY = cy - h * 0.30 + headR;
    var bodyH = h * 0.40;
    var bodyW = h * 0.20;
    var legY = bodyTopY + bodyH;
    var legH = h * 0.32;
    var armY = bodyTopY + h * 0.06;
    var armLen = h * 0.30;
    // Head
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.30, headR, 0, Math.PI * 2);
    ctx.fill();
    // Hair tuft (haruki silhouette flair) — only when facing forward
    if (hair && facing !== 'away') {
      ctx.beginPath();
      ctx.moveTo(cx - headR * 0.9, cy - h * 0.30 - headR * 0.3);
      ctx.lineTo(cx - headR * 1.1, cy - h * 0.30 + headR * 0.6);
      ctx.lineTo(cx - headR * 0.4, cy - h * 0.30 - headR * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + headR * 0.9, cy - h * 0.30 - headR * 0.3);
      ctx.lineTo(cx + headR * 1.1, cy - h * 0.30 + headR * 0.6);
      ctx.lineTo(cx + headR * 0.4, cy - h * 0.30 - headR * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    // Body (slight sway with walking phase)
    var swayX = phase * h * 0.012;
    ctx.beginPath();
    ctx.ellipse(cx + swayX, bodyTopY + bodyH * 0.5, bodyW * 0.5, bodyH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Arms — opposite-phase swing, with light thickness via stroke fallback
    ctx.lineWidth = Math.max(3, h * 0.04);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    var armSwingL = -phase * 0.6;
    var armSwingR =  phase * 0.6;
    function drawArm(side, swing) {
      var shoulderX = cx + side * bodyW * 0.5 + swayX;
      var shoulderY = armY;
      var handX = shoulderX + Math.sin(swing) * armLen * 0.6;
      var handY = shoulderY + Math.cos(swing) * armLen;
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(handX, handY);
      ctx.stroke();
    }
    drawArm(-1, armSwingL);
    drawArm( 1, armSwingR);
    // Legs — opposite-phase to arms
    ctx.lineWidth = Math.max(4, h * 0.05);
    var legSwingL =  phase * 0.5;
    var legSwingR = -phase * 0.5;
    function drawLeg(side, swing) {
      var hipX = cx + side * bodyW * 0.28 + swayX;
      var hipY = legY;
      var footX = hipX + Math.sin(swing) * legH * 0.5;
      var footY = hipY + Math.cos(swing) * legH;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(footX, footY);
      ctx.stroke();
    }
    drawLeg(-1, legSwingL);
    drawLeg( 1, legSwingR);
  }

  // 3rd-person HARUKI approach — walks toward the camera (growing larger) on
  // the red suburb background. Runs after the FPS approach hands off, so
  // the player sees themselves enter the area, then sees HARUKI walking
  // toward them before the lightning + portrait reveal.
  function runHbcCharApproach(startDelayMs, durationMs) {
    var cvs = el('hbcCharCanvas');
    if (!cvs) return function () {};
    var ctx = cvs.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    function resize() {
      var cw = cvs.clientWidth || window.innerWidth;
      var ch = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.max(280, Math.floor(cw * dpr));
      cvs.height = Math.max(200, Math.floor(ch * dpr));
    }
    resize();
    window.addEventListener('resize', resize);
    var cancelled = false;
    var rafId = 0;
    var fadeT = null;
    var startTime = null;
    var showT = setTimeout(function () {
      if (cancelled) return;
      cvs.classList.add('show');
      startTime = performance.now();
      rafId = requestAnimationFrame(step);
    }, startDelayMs);
    function cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (fadeT) clearTimeout(fadeT);
      if (showT) clearTimeout(showT);
      try { cvs.classList.remove('show'); } catch (e) {}
      try { window.removeEventListener('resize', resize); } catch (e) {}
    }
    fadeT = setTimeout(function () {
      try { cvs.classList.remove('show'); } catch (e) {}
      setTimeout(cancel, 800);
    }, startDelayMs + durationMs);
    function step(now) {
      if (cancelled) return;
      var t = (now - startTime) / 1000;
      var t01 = Math.min(1, (now - startTime) / durationMs);
      var w = cvs.width, h = cvs.height;
      ctx.clearRect(0, 0, w, h);
      // Ground vignette so the figure feels rooted in the world without
      // hiding the underlying CSS sky.
      var grdGround = ctx.createLinearGradient(0, h * 0.5, 0, h);
      grdGround.addColorStop(0, 'rgba(0,0,0,0)');
      grdGround.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = grdGround;
      ctx.fillRect(0, h * 0.5, w, h * 0.5);
      // HARUKI walks from far → close. Scale grows over time.
      var scale = 0.25 + t01 * 1.4;
      var figHeight = Math.min(w, h) * scale;
      var cx = w / 2 + Math.sin(t * 1.3) * w * 0.04;
      var cy = h * (0.62 - 0.05 * (1 - t01));
      drawWalkingFigure(ctx, cx, cy, figHeight, t, {
        color: 'rgba(8,4,4,0.92)',
        facing: 'forward',
        hair: true
      });
      // Red rim halo as she gets closer
      if (t01 > 0.5) {
        var glow = ctx.createRadialGradient(cx, cy, figHeight * 0.4,
                                             cx, cy, figHeight * 1.1);
        glow.addColorStop(0, 'rgba(180,30,30,0)');
        glow.addColorStop(1, 'rgba(180,30,30,' + ((t01 - 0.5) * 0.5).toFixed(2) + ')');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
      }
      rafId = requestAnimationFrame(step);
    }
    return cancel;
  }

  // Mini FPS raycaster for the boss-reveal cutscene. Plays at the start of the
  // cutscene to show the player walking down a dark suburban corridor toward
  // HARUKI before the lightning/silhouette reveal. Fades out via CSS after
  // `durationMs`. Returns a cancel() so finish() can stop the RAF loop early.
  function runHbcFpsApproach(durationMs) {
    var cvs = el('hbcFpsCanvas');
    if (!cvs) return function () {};
    var ctx = cvs.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    function resize() {
      var cw = cvs.clientWidth || window.innerWidth;
      var ch = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.max(280, Math.floor(cw * dpr));
      cvs.height = Math.max(200, Math.floor(ch * dpr));
    }
    resize();
    cvs.classList.add('show');
    window.addEventListener('resize', resize);
    var MAP_W = 5, MAP_H = 90;
    var map = new Uint8Array(MAP_W * MAP_H);
    for (var my = 0; my < MAP_H; my++) {
      for (var mx = 0; mx < MAP_W; mx++) {
        map[my * MAP_W + mx] = (mx === 0 || mx === MAP_W - 1) ? 1 : 0;
      }
    }
    var FOV = Math.PI / 3.2;
    var startT = performance.now();
    var lastNow = startT;
    var totalProgress = 0;
    var cancelled = false;
    var rafId = 0;
    var fadeT = null;
    function cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (fadeT) clearTimeout(fadeT);
      try { cvs.classList.remove('show'); } catch (e) {}
      try { window.removeEventListener('resize', resize); } catch (e) {}
    }
    // Schedule fade-out + cancel after `durationMs`. CSS does the fade; we just
    // toggle the class and stop the loop ~600ms later (= transition duration).
    fadeT = setTimeout(function () {
      try { cvs.classList.remove('show'); } catch (e) {}
      setTimeout(cancel, 700);
    }, durationMs);
    function step(now) {
      if (cancelled) return;
      var dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      // Suburban corridor — slow, dread-heavy walk. Picks up speed near the end.
      var t01 = (now - startT) / durationMs;
      var speed = 0.8 + t01 * 0.7;
      totalProgress += speed * dt;
      var py = 1 + (MAP_H - 4) * Math.min(0.97, totalProgress / 10);
      var px = MAP_W / 2 + Math.sin(now * 0.005) * 0.08;
      var w = cvs.width, h = cvs.height;
      // Sky → ground gradient (deep red suburb sky)
      var sg = ctx.createLinearGradient(0, 0, 0, h / 2);
      sg.addColorStop(0, '#080203');
      sg.addColorStop(1, '#2a060a');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h / 2);
      var fg = ctx.createLinearGradient(0, h / 2, 0, h);
      fg.addColorStop(0, '#0a0205');
      fg.addColorStop(1, '#1a0408');
      ctx.fillStyle = fg; ctx.fillRect(0, h / 2, w, h / 2);
      var bobY = Math.sin(now * 0.011) * 0.04;
      var stripW = 4;
      var rays = Math.ceil(w / stripW);
      var camAngle = Math.PI / 2;
      for (var i = 0; i < rays; i++) {
        var sx = i * stripW;
        var rayAng = camAngle - FOV / 2 + (i / rays) * FOV;
        var rcos = Math.cos(rayAng), rsin = Math.sin(rayAng);
        var mapX = Math.floor(px), mapY = Math.floor(py);
        var ddx = Math.abs(1 / rcos) || 1e9;
        var ddy = Math.abs(1 / rsin) || 1e9;
        var stepX, stepY, sdX, sdY;
        if (rcos < 0) { stepX = -1; sdX = (px - mapX) * ddx; }
        else          { stepX = 1;  sdX = (mapX + 1 - px) * ddx; }
        if (rsin < 0) { stepY = -1; sdY = (py - mapY) * ddy; }
        else          { stepY = 1;  sdY = (mapY + 1 - py) * ddy; }
        var hit = 0, side = 0, safety = 60;
        while (!hit && safety-- > 0) {
          if (sdX < sdY) { sdX += ddx; mapX += stepX; side = 0; }
          else           { sdY += ddy; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) { hit = 1; break; }
          if (map[mapY * MAP_W + mapX] === 1) hit = 1;
        }
        var dist = side === 0
          ? (mapX - px + (1 - stepX) / 2) / rcos
          : (mapY - py + (1 - stepY) / 2) / rsin;
        dist = Math.max(0.1, dist);
        var wallH = Math.min(h * 4, h / dist);
        var drawStart = (h - wallH) / 2 + bobY * h;
        // Wall color: warm sepia, fades to black at distance (heavy fog)
        var fog = Math.max(0.05, 1 - dist / 18);
        var base = side === 1 ? 0.7 : 1.0;
        ctx.fillStyle = 'rgb(' + Math.floor(70 * fog * base) + ',' +
                                  Math.floor(40 * fog * base) + ',' +
                                  Math.floor(24 * fog * base) + ')';
        ctx.fillRect(sx, drawStart, stripW + 1, wallH);
      }
      // Distant silhouette: a black shape grows on the horizon as we approach,
      // hinting at HARUKI waiting at the end of the corridor.
      var silProg = Math.min(1, t01 * 1.4);
      var silH = h * (0.18 + silProg * 0.45);
      var silW = silH * 0.4;
      var silX = w / 2 - silW / 2 + Math.sin(now * 0.003) * 4;
      var silY = h / 2 - silH * 0.55 + bobY * h;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.55 + silProg * 0.35).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(silX + silW / 2, silY + silH * 0.18, silW * 0.3, silH * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(silX, silY + silH * 0.15, silW, silH * 0.85);
      // Red sky lightning rim (subtle)
      if (Math.random() < 0.02 + t01 * 0.04) {
        ctx.fillStyle = 'rgba(180,40,40,0.15)';
        ctx.fillRect(0, 0, w, h * 0.5);
      }
      // Vignette
      var grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25,
                                          w / 2, h / 2, Math.max(w, h) * 0.7);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.9)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
    return cancel;
  }

  function playHarukiBossCutscene(onDone) {
    var overlay = el('harukiBossCutscene');
    if (!overlay) { onDone(); return; }
    _inCinematic = true;
    showOverlay('harukiBossCutscene');
    var lightning = el('hbcLightning');
    var portrait = el('hbcPortrait');
    var hbcText = el('hbcText');
    var skipBtn = el('hbcSkipBtn');
    if (portrait) portrait.classList.remove('zoom');
    if (hbcText) { hbcText.classList.remove('show'); hbcText.textContent = ''; }
    // FPS approach — player walks down a dark suburban corridor toward HARUKI.
    // Runs alongside the first text beats (LEVEL 9 → 月のような何か), then
    // fades out before the lightning + portrait reveal at ~4.2s.
    var hbcFpsCancel = runHbcFpsApproach(3800);
    // 3rd-person character approach: HARUKI walks toward the camera. Starts
    // at 3.0s (right as the FPS canvas begins to fade) and runs for 3s.
    // Visible behind the silhouette/lightning reveal so the player can clearly
    // see HER physically walking toward them.
    var hbcCharCancel = runHbcCharApproach(3000, 3000);
    if (audioInitialized) {
      GameEngine.startLoop('wind');
      GameEngine.playSound('breath_drone');
    }
    var cancelled = false;
    var timers = [];
    function later(ms, fn) {
      timers.push(setTimeout(function () { if (!cancelled) fn(); }, ms));
    }
    function setText(t) {
      if (!hbcText) return;
      hbcText.classList.remove('show');
      // Fade out the old line before swapping. Matches the intro fix so the
      // text doesn't snap mid-fade. CSS transition is 600ms.
      setTimeout(function () {
        if (cancelled) return;
        hbcText.textContent = t;
        requestAnimationFrame(function () {
          if (cancelled) return;
          hbcText.classList.add('show');
        });
      }, 600);
    }
    function flashLightning() {
      if (!lightning) return;
      lightning.classList.remove('flash');
      void lightning.offsetWidth;
      lightning.classList.add('flash');
      if (audioInitialized) GameEngine.playSound('thunder');
      GameEngine.shakeScreen(18, 0.5);
    }
    function finish() {
      if (cancelled) return;
      cancelled = true;
      for (var ti = 0; ti < timers.length; ti++) clearTimeout(timers[ti]);
      try { if (hbcFpsCancel) hbcFpsCancel(); } catch (e) {}
      try { if (hbcCharCancel) hbcCharCancel(); } catch (e) {}
      hideOverlay('harukiBossCutscene');
      if (audioInitialized) GameEngine.stopLoop('wind');
      _inCinematic = false;
      if (skipBtn) try { skipBtn.removeEventListener('click', finish); } catch (e) {}
      try { overlay.removeEventListener('click', finish); } catch (e) {}
      onDone();
    }
    if (skipBtn) skipBtn.addEventListener('click', finish);
    overlay.addEventListener('click', finish);
    // Scripted beats — timings widened so each line has ~3.5s of reading
    // time before the next beat overrides it.
    later(600,  function () { setText('— LEVEL 9 — THE SUBURBS'); });
    later(1100, function () { speakSituational('boss_approach', { cooldownMs: 20000 }); });
    later(2400, flashLightning);
    later(3200, function () { setText('空に月はない。\n月のような、何かがある。'); });
    later(6200, flashLightning);
    later(6800, function () { setText('— 待っていたのは、ハルキだった。'); });
    later(9800, function () {
      if (portrait) portrait.classList.add('zoom');
      if (audioInitialized) {
        GameEngine.playSound('jumpscare');
        GameEngine.playSound('whisper');
      }
      GameEngine.shakeScreen(30, 1.2);
    });
    later(11200, function () {
      setText('— おかえり。');
      try { _uncannySpeak('おかえり。'); } catch (e) {}
    });
    later(14000, finish);
  }

  // Mini FPS raycaster for the ending sequence: player walks down a corridor
  // toward a bright sunrise at the end. Fades out via CSS class toggle after
  // durationMs to hand off to the existing sky/walk-away CSS.
  function runEsFpsWalkout(durationMs) {
    var cvs = el('esFpsCanvas');
    if (!cvs) return function () {};
    var ctx = cvs.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    function resize() {
      var cw = cvs.clientWidth || window.innerWidth;
      var ch = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.max(280, Math.floor(cw * dpr));
      cvs.height = Math.max(200, Math.floor(ch * dpr));
    }
    resize();
    cvs.classList.add('show');
    window.addEventListener('resize', resize);
    var MAP_W = 5, MAP_H = 60;
    var map = new Uint8Array(MAP_W * MAP_H);
    for (var my = 0; my < MAP_H; my++) {
      for (var mx = 0; mx < MAP_W; mx++) {
        map[my * MAP_W + mx] = (mx === 0 || mx === MAP_W - 1) ? 1 : 0;
      }
    }
    var FOV = Math.PI / 3;
    var startT = performance.now();
    var lastNow = startT;
    var totalProgress = 0;
    var cancelled = false;
    var rafId = 0;
    var fadeT = null;
    function cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (fadeT) clearTimeout(fadeT);
      try { cvs.classList.remove('show'); } catch (e) {}
      try { window.removeEventListener('resize', resize); } catch (e) {}
    }
    fadeT = setTimeout(function () {
      try { cvs.classList.remove('show'); } catch (e) {}
      setTimeout(cancel, 900);
    }, durationMs);
    function step(now) {
      if (cancelled) return;
      var dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      var t01 = (now - startT) / durationMs;
      var speed = 1.4 + t01 * 0.8;
      totalProgress += speed * dt;
      var py = 1 + (MAP_H - 4) * Math.min(0.97, totalProgress / 10);
      var px = MAP_W / 2 + Math.sin(now * 0.004) * 0.06;
      var w = cvs.width, h = cvs.height;
      // Bright sunrise sky → warm ground; brightens over time.
      var skyBri = 0.4 + Math.min(0.55, t01 * 0.9);
      var sg = ctx.createLinearGradient(0, 0, 0, h / 2);
      sg.addColorStop(0, 'rgba(255,244,200,' + skyBri.toFixed(2) + ')');
      sg.addColorStop(1, 'rgba(255,186,112,' + skyBri.toFixed(2) + ')');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h / 2);
      var fg = ctx.createLinearGradient(0, h / 2, 0, h);
      fg.addColorStop(0, '#3a2410');
      fg.addColorStop(1, '#1c1208');
      ctx.fillStyle = fg; ctx.fillRect(0, h / 2, w, h / 2);
      var bobY = Math.sin(now * 0.013) * 0.035;
      var stripW = 4;
      var rays = Math.ceil(w / stripW);
      var camAngle = Math.PI / 2;
      for (var i = 0; i < rays; i++) {
        var sx = i * stripW;
        var rayAng = camAngle - FOV / 2 + (i / rays) * FOV;
        var rcos = Math.cos(rayAng), rsin = Math.sin(rayAng);
        var mapX = Math.floor(px), mapY = Math.floor(py);
        var ddx = Math.abs(1 / rcos) || 1e9;
        var ddy = Math.abs(1 / rsin) || 1e9;
        var stepX, stepY, sdX, sdY;
        if (rcos < 0) { stepX = -1; sdX = (px - mapX) * ddx; }
        else          { stepX = 1;  sdX = (mapX + 1 - px) * ddx; }
        if (rsin < 0) { stepY = -1; sdY = (py - mapY) * ddy; }
        else          { stepY = 1;  sdY = (mapY + 1 - py) * ddy; }
        var hit = 0, side = 0, safety = 60;
        while (!hit && safety-- > 0) {
          if (sdX < sdY) { sdX += ddx; mapX += stepX; side = 0; }
          else           { sdY += ddy; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) { hit = 1; break; }
          if (map[mapY * MAP_W + mapX] === 1) hit = 1;
        }
        var dist = side === 0
          ? (mapX - px + (1 - stepX) / 2) / rcos
          : (mapY - py + (1 - stepY) / 2) / rsin;
        dist = Math.max(0.1, dist);
        var wallH = Math.min(h * 4, h / dist);
        var drawStart = (h - wallH) / 2 + bobY * h;
        var fog = Math.max(0.4, 1 - dist / 18);
        var base = side === 1 ? 0.78 : 1.0;
        // Warm yellow walls (backrooms exit feel)
        ctx.fillStyle = 'rgb(' + Math.floor(212 * fog * base) + ',' +
                                  Math.floor(170 * fog * base) + ',' +
                                  Math.floor(58 * fog * base) + ')';
        ctx.fillRect(sx, drawStart, stripW + 1, wallH);
      }
      // Bright bloom at the end of the corridor — grows as t01 → 1
      var bloomR = Math.min(w, h) * (0.25 + t01 * 0.7);
      var grdEnd = ctx.createRadialGradient(w / 2, h / 2 + bobY * h, 4,
                                             w / 2, h / 2 + bobY * h, bloomR);
      grdEnd.addColorStop(0, 'rgba(255,250,220,' + (0.6 + t01 * 0.4).toFixed(2) + ')');
      grdEnd.addColorStop(1, 'rgba(255,250,220,0)');
      ctx.fillStyle = grdEnd;
      ctx.fillRect(0, 0, w, h);
      // Full white-out flash at the very end
      if (t01 > 0.85) {
        ctx.fillStyle = 'rgba(255,250,230,' + ((t01 - 0.85) / 0.15).toFixed(2) + ')';
        ctx.fillRect(0, 0, w, h);
      }
      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
    return cancel;
  }

  // 3rd-person walk-away — player silhouette walks away from camera into a
  // bright sunrise. Mirror of the boss approach (shrinking instead of growing).
  function runEsCharWalkaway(startDelayMs, durationMs) {
    var cvs = el('esCharCanvas');
    if (!cvs) return function () {};
    var ctx = cvs.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    function resize() {
      var cw = cvs.clientWidth || window.innerWidth;
      var ch = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.max(280, Math.floor(cw * dpr));
      cvs.height = Math.max(200, Math.floor(ch * dpr));
    }
    resize();
    window.addEventListener('resize', resize);
    var cancelled = false;
    var rafId = 0;
    var fadeT = null;
    var startTime = null;
    var showT = setTimeout(function () {
      if (cancelled) return;
      cvs.classList.add('show');
      startTime = performance.now();
      rafId = requestAnimationFrame(step);
    }, startDelayMs);
    function cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (fadeT) clearTimeout(fadeT);
      if (showT) clearTimeout(showT);
      try { cvs.classList.remove('show'); } catch (e) {}
      try { window.removeEventListener('resize', resize); } catch (e) {}
    }
    fadeT = setTimeout(function () {
      try { cvs.classList.remove('show'); } catch (e) {}
      setTimeout(cancel, 900);
    }, startDelayMs + durationMs);
    function step(now) {
      if (cancelled) return;
      var t = (now - startTime) / 1000;
      var t01 = Math.min(1, (now - startTime) / durationMs);
      var w = cvs.width, h = cvs.height;
      ctx.clearRect(0, 0, w, h);
      // Warm ground horizon
      var grdGround = ctx.createLinearGradient(0, h * 0.5, 0, h);
      grdGround.addColorStop(0, 'rgba(120, 80, 40, 0)');
      grdGround.addColorStop(1, 'rgba(40, 24, 8, 0.55)');
      ctx.fillStyle = grdGround;
      ctx.fillRect(0, h * 0.5, w, h * 0.5);
      // Player walks AWAY: scale shrinks over time
      var scale = 0.95 - t01 * 0.65;
      var figHeight = Math.min(w, h) * scale;
      var cx = w / 2 + Math.sin(t * 0.9) * w * 0.02;
      var cy = h * (0.7 - t01 * 0.18);
      drawWalkingFigure(ctx, cx, cy, figHeight, t, {
        color: 'rgba(12,8,4,0.88)',
        facing: 'away',
        hair: false
      });
      // Sunrise bloom around the figure as they walk further
      if (t01 > 0.3) {
        var bloomR = Math.min(w, h) * (0.25 + t01 * 0.6);
        var bloom = ctx.createRadialGradient(cx, cy, figHeight * 0.4,
                                              cx, cy, bloomR);
        bloom.addColorStop(0, 'rgba(255,240,200,0)');
        bloom.addColorStop(1, 'rgba(255,240,200,' + ((t01 - 0.3) * 0.5).toFixed(2) + ')');
        ctx.fillStyle = bloom;
        ctx.fillRect(0, 0, w, h);
      }
      rafId = requestAnimationFrame(step);
    }
    return cancel;
  }

  // ── Wall-clip falling cinematic (post-final-boss return trip) ──
  // Played the first time the player bumps a wall after killing the
  // final boss on Lv9. Designed per user request: 「最終ボスのムービー
  // のように動くムービーで帰り道に壁にぶつかった際にすり抜け地面に
  // 落ちていくような演出」.
  // CSS animations drive the visual; this fn just shows the overlay,
  // sequences the text beats, and then chains into triggerEnding().
  function playWallClipFall() {
    var overlay = el('wallClipFall');
    if (!overlay) {
      // Fallback — just go straight to the ending.
      var t = hasAllSecretDocs() ? 'true_secret' : 'truend_bad';
      triggerEnding(t);
      return;
    }
    _inCinematic = true;
    var txt = el('wcfText');
    var cancelled = false;
    var timers = [];
    function later(ms, fn) {
      timers.push(setTimeout(function () { if (!cancelled) fn(); }, ms));
    }
    function setText(s, dim) {
      if (!txt) return;
      txt.classList.remove('show');
      setTimeout(function () {
        if (cancelled) return;
        txt.textContent = s;
        if (dim) txt.classList.add('dim'); else txt.classList.remove('dim');
        requestAnimationFrame(function () {
          if (cancelled) return;
          txt.classList.add('show');
        });
      }, 250);
    }
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    // Audio cues
    if (audioInitialized) {
      try { GameEngine.playSound('static'); } catch (e) {}
      try { GameEngine.playSound('thunder'); } catch (e) {}
      try { GameEngine.shakeScreen(28, 1.2); } catch (e) {}
    }
    if (navigator.vibrate) navigator.vibrate([100, 60, 200, 100, 400]);
    // Sequence:
    //   0.30s — text "壁が、抜けた。" (wall passes through scale animation)
    //   1.40s — text "ここは、終わりじゃない。" (streaks begin)
    //   3.00s — text "もう一度、落ちていく。" (void at full)
    //   4.50s — text "— TRUE FALL —" (final)
    //   6.50s — chain to triggerEnding
    later(300,  function () { setText('壁が、抜けた。'); });
    later(1400, function () { setText('ここは、終わりじゃない。'); });
    later(3000, function () { setText('もう一度、落ちていく。', true); });
    later(4500, function () { setText('— TRUE FALL —'); });
    later(6500, function () {
      cancelled = true;
      for (var ti = 0; ti < timers.length; ti++) clearTimeout(timers[ti]);
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
      _inCinematic = false;
      var endType = hasAllSecretDocs() ? 'true_secret' : 'truend_bad';
      triggerEnding(endType);
    });
  }
  // ── Ending Sequence (after final boss defeat) ──
  // Plays when the player passes the X tile on Lv9 after killing the boss.
  function playEndingSequence(onDone) {
    var overlay = el('endingSequence');
    if (!overlay) { onDone(); return; }
    _inCinematic = true;
    showOverlay('endingSequence');
    var esText = el('esText');
    if (esText) { esText.classList.remove('show'); esText.textContent = ''; }
    // FPS walk-out — player exits the corridor into sunrise during the first
    // ~3.5s, matching the "朝が来た" beat. Fades out before "歩き続ける".
    var esFpsCancel = runEsFpsWalkout(3500);
    // 3rd-person walk-away character animation: starts at 3.0s as the FPS
    // canvas begins fading, plays for ~5s through the "歩き続ける" beat.
    var esCharCancel = runEsCharWalkaway(3000, 5000);
    if (audioInitialized) {
      GameEngine.playSound('level_clear');
      GameEngine.playSound('stinger');
    }
    var cancelled = false;
    var timers = [];
    function later(ms, fn) {
      timers.push(setTimeout(function () { if (!cancelled) fn(); }, ms));
    }
    function setText(t) {
      if (!esText) return;
      esText.classList.remove('show');
      // Fade out before swap (matches intro / boss cinematics).
      setTimeout(function () {
        if (cancelled) return;
        esText.textContent = t;
        requestAnimationFrame(function () {
          if (cancelled) return;
          esText.classList.add('show');
        });
      }, 600);
    }
    function finish() {
      if (cancelled) return;
      cancelled = true;
      for (var ti = 0; ti < timers.length; ti++) clearTimeout(timers[ti]);
      try { if (esFpsCancel) esFpsCancel(); } catch (e) {}
      try { if (esCharCancel) esCharCancel(); } catch (e) {}
      hideOverlay('endingSequence');
      _inCinematic = false;
      try { overlay.removeEventListener('click', finish); } catch (e) {}
      onDone();
    }
    overlay.addEventListener('click', finish);
    // Slowed: each line now sits for ~4s before being replaced so the
    // player has time to actually read it.
    later(1500, function () { setText('— 朝が来た。'); });
    later(5800, function () { setText('お前は、歩き続ける。'); });
    later(10200, function () { setText('THE BACKROOMS — END'); });
    later(14500, finish);
  }

  // ── Unique Reward Visual Flash ──
  // Brief CSS-animated overlay shown when player wins a UNIQUE prize.
  function showUniqueRewardFlash(itemId) {
    var overlay = el('uniqueRewardFlash');
    var item = ITEMS[itemId];
    if (!overlay || !item) return;
    var icon = el('urfIcon');
    var name = el('urfName');
    if (icon) icon.textContent = item.icon || '✦';
    if (name) name.textContent = item.name || itemId;
    overlay.style.display = 'flex';
    overlay.classList.remove('hide');
    // CSS animations restart automatically because we just inserted content.
    setTimeout(function () {
      overlay.style.display = 'none';
    }, 1500);
  }

  // Mini FPS raycaster for level-reach cinematic: brief tumble / descent
  // shot themed to the level being entered. Tinted per-level so each
  // transition feels distinct.
  function runLrFpsDescent(levelDef, durationMs) {
    var cvs = el('lrFpsCanvas');
    if (!cvs) return function () {};
    // Performance: skip the raycaster entirely on LOW graphics quality. The
    // level-reach card by itself is plenty atmospheric and we save a 1.6s
    // RAF loop on every level transition.
    if (gfxQuality === 'low') return function () {};
    var ctx = cvs.getContext('2d');
    // Lower DPR than the boss/ending canvases — the descent is brief so we
    // can afford a chunkier image, and the savings on mobile are huge.
    var dpr = Math.min(window.devicePixelRatio || 1, 0.85);
    function resize() {
      var cw = cvs.clientWidth || window.innerWidth;
      var ch = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.max(240, Math.floor(cw * dpr));
      cvs.height = Math.max(180, Math.floor(ch * dpr));
    }
    resize();
    cvs.classList.add('show');
    window.addEventListener('resize', resize);
    // Per-level palette: try to pick a representative wall tone from levelDef
    // colors, else fall back to backrooms yellow.
    var wallR = 212, wallG = 170, wallB = 58;
    if (levelDef) {
      if (levelDef.id === 4) { wallR = 220; wallG = 230; wallB = 240; }   // hospital
      else if (levelDef.id === 5) { wallR = 100; wallG = 80; wallB = 60; } // mansion
      else if (levelDef.id === 6) { wallR = 80;  wallG = 120; wallB = 80; } // hospital green
      else if (levelDef.id === 7) { wallR = 70;  wallG = 60;  wallB = 50; } // suburb dim
      else if (levelDef.id === 8) { wallR = 130; wallG = 70;  wallB = 90; } // gallery
      else if (levelDef.id === 9) { wallR = 80;  wallG = 30;  wallB = 30; } // suburbs / boss
      else if (levelDef.id === 11) { wallR = 30;  wallG = 90;  wallB = 130; } // ocean
      else if (levelDef.id === 12) { wallR = 200; wallG = 200; wallB = 200; } // library
      else if (levelDef.id === 14) { wallR = 40;  wallG = 80;  wallB = 100; } // trench
      else if (levelDef.id === 15) { wallR = 80;  wallG = 130; wallB = 70; }  // garden
    }
    var MAP_W = 5, MAP_H = 40;
    var map = new Uint8Array(MAP_W * MAP_H);
    for (var my = 0; my < MAP_H; my++) {
      for (var mx = 0; mx < MAP_W; mx++) {
        map[my * MAP_W + mx] = (mx === 0 || mx === MAP_W - 1) ? 1 : 0;
      }
    }
    var startT = performance.now();
    var lastNow = startT;
    var totalProgress = 0;
    var cancelled = false;
    var rafId = 0;
    var fadeT = null;
    function cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (fadeT) clearTimeout(fadeT);
      try { cvs.classList.remove('show'); } catch (e) {}
      try { window.removeEventListener('resize', resize); } catch (e) {}
    }
    fadeT = setTimeout(function () {
      try { cvs.classList.remove('show'); } catch (e) {}
      setTimeout(cancel, 600);
    }, durationMs);
    function step(now) {
      if (cancelled) return;
      var dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      var t01 = (now - startT) / durationMs;
      // Tumble: fast walk with camera roll oscillation — feels like falling
      // through the no-clip into the new level.
      var speed = 3.5;
      totalProgress += speed * dt;
      var py = 1 + (MAP_H - 4) * Math.min(0.97, totalProgress / 12);
      var px = MAP_W / 2 + Math.sin(now * 0.012) * 0.15;
      var w = cvs.width, h = cvs.height;
      var rollAngle = Math.sin(now * 0.007) * 0.45 * (1 - t01 * 0.6);
      // Sky/floor — dark with subtle warmth
      ctx.fillStyle = '#040405';
      ctx.fillRect(0, 0, w, h);
      var bobY = Math.sin(now * 0.018) * 0.08;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rollAngle);
      ctx.translate(-w / 2, -h / 2);
      var FOV = Math.PI / 2.5;
      // Wider strip = half as many rays = ~50% cheaper per frame.
      var stripW = 8;
      var rays = Math.ceil(w / stripW);
      var camAngle = Math.PI / 2;
      for (var i = 0; i < rays; i++) {
        var sx = i * stripW;
        var rayAng = camAngle - FOV / 2 + (i / rays) * FOV;
        var rcos = Math.cos(rayAng), rsin = Math.sin(rayAng);
        var mapX = Math.floor(px), mapY = Math.floor(py);
        var ddx = Math.abs(1 / rcos) || 1e9;
        var ddy = Math.abs(1 / rsin) || 1e9;
        var stepX, stepY, sdX, sdY;
        if (rcos < 0) { stepX = -1; sdX = (px - mapX) * ddx; }
        else          { stepX = 1;  sdX = (mapX + 1 - px) * ddx; }
        if (rsin < 0) { stepY = -1; sdY = (py - mapY) * ddy; }
        else          { stepY = 1;  sdY = (mapY + 1 - py) * ddy; }
        var hit = 0, side = 0, safety = 40;
        while (!hit && safety-- > 0) {
          if (sdX < sdY) { sdX += ddx; mapX += stepX; side = 0; }
          else           { sdY += ddy; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) { hit = 1; break; }
          if (map[mapY * MAP_W + mapX] === 1) hit = 1;
        }
        var dist = side === 0
          ? (mapX - px + (1 - stepX) / 2) / rcos
          : (mapY - py + (1 - stepY) / 2) / rsin;
        dist = Math.max(0.1, dist);
        var wallH = Math.min(h * 4, h / dist);
        var drawStart = (h - wallH) / 2 + bobY * h;
        var fog = Math.max(0.1, 1 - dist / 12);
        var base = side === 1 ? 0.7 : 1.0;
        ctx.fillStyle = 'rgb(' + Math.floor(wallR * fog * base) + ',' +
                                  Math.floor(wallG * fog * base) + ',' +
                                  Math.floor(wallB * fog * base) + ')';
        ctx.fillRect(sx, drawStart, stripW + 1, wallH);
      }
      ctx.restore();
      // Flash flicker on entry
      if (Math.random() < 0.12) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, 0, w, h);
      }
      // Vignette pull
      var grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2,
                                          w / 2, h / 2, Math.max(w, h) * 0.7);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
    return cancel;
  }

  function playLevelReachCinematic(def, onDone) {
    el('lrLevelNum').textContent = def.name;
    // Progression indicator: order-index out of total reachable levels.
    var ORDER_FULL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 9];
    var idxNow = ORDER_FULL.indexOf(def.id);
    var subtitleHtml = def.subtitle;
    if (idxNow >= 0) {
      subtitleHtml += '  <span class="lr-step">' + (idxNow + 1) + ' / ' + ORDER_FULL.length + '</span>';
    }
    var subEl = el('lrSubtitle');
    if (subEl) subEl.innerHTML = subtitleHtml;
    // Build flavor text: intro flavor first (narrative beat), then a blank
    // line, then the hint (mechanics). Old version only used hint, which
    // hid the level's signature line entirely.
    var flavorLines = [];
    if (def.intro) flavorLines.push('— ' + def.intro);
    if (def.hint)  flavorLines.push(def.hint);
    flavorLines.push('[ 画面をタップして始める ]');
    el('lrFlavor').textContent = flavorLines.join('\n\n');
    showOverlay('levelReachCinematic');
    if (audioInitialized) GameEngine.playSound('stinger');
    // Sparse situational whisper on level entry — sells the "descent" theme.
    // 35% chance to fire; cooldown handled by speakSituational so it can't
    // chain across rapid no-clip transitions.
    if (Math.random() < 0.35) {
      setTimeout(function () { speakSituational('level_descent', { cooldownMs: 25000 }); }, 600);
    }
    var lrOverlay = el('levelReachCinematic');
    // FPS descent shot — shorter (1.1s) to reduce transition cost on mobile.
    // Skipped entirely when gfxQuality === 'low' (handled inside the runner).
    // Cancelled on advance() so skipping doesn't leave a RAF running.
    var lrFpsCancel = runLrFpsDescent(def, 800);
    // Clean up previous listeners (each setLevel re-uses this overlay)
    if (lrOverlay._cleanup) { try { lrOverlay._cleanup(); } catch (e) {} }
    var done = false;
    var canAdvance = false;
    // Shorter tap-gate (was 400ms) — perceived responsiveness, the
    // overlay still has enough display time to read.
    setTimeout(function () { canAdvance = true; }, 150);
    var advance = function () {
      if (done || !canAdvance) return;
      done = true;
      try { if (lrFpsCancel) lrFpsCancel(); } catch (e) {}
      lrOverlay.removeEventListener('click', advance);
      lrOverlay.removeEventListener('touchstart', advance);
      lrOverlay.style.pointerEvents = 'none';
      lrOverlay._cleanup = null;
      hideOverlay('levelReachCinematic');
      // forceCanvasResize is intentionally deferred to onDone (afterReach
      // in setLevel) so the canvas only reflows once — preventing the
      // visible size flicker the user reported on 2026-06-08.
      onDone();
    };
    lrOverlay._cleanup = function () {
      done = true;
      lrOverlay.removeEventListener('click', advance);
      lrOverlay.removeEventListener('touchstart', advance);
    };
    lrOverlay.style.pointerEvents = 'auto';
    lrOverlay.addEventListener('click', advance);
    lrOverlay.addEventListener('touchstart', advance);
    // Safety net: auto-advance after 4s (was 8s, then 60s). The level
    // reach card no longer needs that much hold time — the user can
    // tap to skip immediately, and we'd rather get them into play.
    setTimeout(function () { canAdvance = true; advance(); }, 4000);
  }

  function getEntityColor(type) {
    switch (type) {
      case 'hound': return '#2a1810';
      case 'smiler': return '#f0f0f0';
      case 'skinstealer': return '#a08070';
      case 'partygoer': return '#502828';
      case 'civilian': return '#cd9b6c'; // warm beige — clearly human, non-threatening
      case 'witness':  return '#0e0e12'; // near-black, just barely a silhouette
      case 'lurker':   return '#1a141e'; // deep purple-black
      case 'shadow':   return '#080010'; // pure ink-black
      case 'drowned':  return '#102838'; // cold deep-water blue-black
      case 'vinewalker': return '#1c2810'; // mossy dark green
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
    'ロア全収集 + 全実績で TRUE+ END 解放'
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

  // Set the player's equipped weapon. Used by Phone Item modal「装備」button
  // and by tap on the D-pad widget when in weapon mode.
  function equipWeapon(itemId) {
    if (!ITEMS[itemId] || ITEMS[itemId].category !== 'weapon') return;
    var prev = player.equippedWeapon;
    player.equippedWeapon = itemId;
    try { updateWeaponAttackBtn(); } catch (e) {}
    toast('装備: ' + ITEMS[itemId].name);
    if (audioInitialized) try { GameEngine.playSound('ui_tap'); } catch (e) {}
    // Slide-up animation on the FPS hand whenever the equipped weapon changes
    if (prev !== itemId) {
      var hand = el('weaponHand');
      if (hand) {
        hand.classList.remove('equip-in');
        void hand.offsetWidth;
        hand.classList.add('equip-in');
        setTimeout(function () {
          if (hand) hand.classList.remove('equip-in');
        }, 320);
      }
      // Pop the weapon name caption under the FPS hand for 2.4s
      var nameEl = el('weaponHandName');
      if (nameEl && ITEMS[itemId]) {
        nameEl.textContent = ITEMS[itemId].name;
        nameEl.classList.remove('show');
        void nameEl.offsetWidth;
        nameEl.classList.add('show');
      }
    }
  }
  // Refresh weapon attack button icon + count to reflect equipped weapon.
  function updateWeaponAttackBtn() {
    var btn = el('weaponAttackBtn');
    if (!btn) return;
    var ic = el('wabIcon');
    var cn = el('wabCount');
    var id = player.equippedWeapon;
    if (id && ITEMS[id]) {
      var it = ITEMS[id];
      if (ic) ic.innerHTML = getWeaponIconHTML(id);
      var cnt = player.inventory[id] || 0;
      var charm = hasEternalCharm();
      if (cn) cn.textContent = charm ? '∞' : ('×' + cnt);
      btn.classList.toggle('empty', cnt <= 0 && !charm);
      // Show only when in PLAYING state AND we actually have a weapon to fire.
      if (state === ST.PLAYING) btn.classList.add('show');
    } else {
      if (ic) ic.innerHTML = '<span class="weapon-emoji">⚔</span>';
      if (cn) cn.textContent = '—';
      btn.classList.add('empty');
      // No weapon equipped — hide the button entirely so the player isn't
      // pressing a disabled icon and wondering why nothing happens.
      btn.classList.remove('show');
    }
    // Mirror to FPS hand view
    var hand = el('weaponHand');
    var handIc = el('weaponHandIcon');
    if (hand && handIc) {
      if (id && ITEMS[id]) {
        handIc.innerHTML = getWeaponIconHTML(id);
        if (state === ST.PLAYING) hand.classList.add('show');
        // Greyscale the FPS hand sprite when out of ammo so the player
        // gets visual confirmation that firing won't work.
        var emptyState = (player.inventory[id] || 0) <= 0 && !hasEternalCharm();
        hand.classList.toggle('out-of-ammo', emptyState);
      } else {
        hand.classList.remove('show');
        hand.classList.remove('out-of-ammo');
      }
    }
  }
  // ── REALISTIC WEAPON SVG ICONS ──
  // User: 「武器のアイコンをもっとリアルなものにしたい。色も含め
  // 今はおもちゃっぽすぎる。ショットガンもフレアのように見える。
  // きちんとこだわって作成して」.
  // Per-weapon inline SVG with realistic silhouettes + materials
  // (gunmetal / wood / steel / brass / blood). Each viewBox is 0 0 100 100;
  // they render crisp at any size. The legacy emoji `icon` is kept as a
  // fallback in case a render path doesn't yet use getWeaponIconHTML.
  var WEAPON_SVG = {
    pistol:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Slide (top barrel housing) — dark gunmetal
      '<rect x="14" y="32" width="60" height="14" rx="2" fill="#3a3a3e" stroke="#1a1a1f" stroke-width="1.2"/>' +
      // Barrel tip
      '<rect x="70" y="35" width="14" height="8" fill="#202024" stroke="#0a0a0c" stroke-width="1"/>' +
      // Sight rib
      '<rect x="18" y="29" width="50" height="3" fill="#2a2a2e"/>' +
      // Trigger guard
      '<path d="M 30 46 Q 30 60 42 60 L 50 60 Q 58 60 56 50 Z" fill="none" stroke="#2a2a2e" stroke-width="2.5"/>' +
      // Trigger
      '<line x1="44" y1="51" x2="44" y2="58" stroke="#1a1a1f" stroke-width="2"/>' +
      // Grip
      '<path d="M 14 44 L 14 82 Q 14 88 22 88 L 38 88 Q 46 88 46 80 L 46 60 L 38 50 Z" fill="#2c2c30" stroke="#0a0a0c" stroke-width="1.2"/>' +
      // Grip texture lines
      '<line x1="20" y1="55" x2="20" y2="80" stroke="#404048" stroke-width="0.8"/>' +
      '<line x1="26" y1="55" x2="26" y2="80" stroke="#404048" stroke-width="0.8"/>' +
      '<line x1="32" y1="55" x2="32" y2="80" stroke="#404048" stroke-width="0.8"/>' +
      // Hammer
      '<rect x="10" y="30" width="6" height="6" fill="#1a1a1f"/>' +
      '</svg>',
    shotgun:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Long black barrel
      '<rect x="6" y="38" width="60" height="10" fill="#1a1a1f" stroke="#0a0a0c" stroke-width="1"/>' +
      // Barrel ring at muzzle
      '<rect x="3" y="36" width="5" height="14" fill="#0a0a0c"/>' +
      // Pump under barrel — wood grain
      '<rect x="16" y="50" width="22" height="8" fill="#6a3818" stroke="#3a1a08" stroke-width="1"/>' +
      '<line x1="18" y1="54" x2="36" y2="54" stroke="#4a2010" stroke-width="0.8"/>' +
      // Receiver
      '<rect x="58" y="38" width="14" height="14" fill="#404048" stroke="#1a1a1f" stroke-width="1"/>' +
      // Trigger guard
      '<path d="M 60 52 Q 60 62 68 62 L 72 62 Q 80 62 76 54 Z" fill="none" stroke="#202024" stroke-width="2.5"/>' +
      // Wood stock — brown
      '<path d="M 72 38 L 96 50 L 96 70 L 72 56 Z" fill="#7a4220" stroke="#3a1a08" stroke-width="1.5"/>' +
      // Stock grain
      '<line x1="76" y1="44" x2="92" y2="54" stroke="#5a3018" stroke-width="0.6"/>' +
      '<line x1="76" y1="50" x2="92" y2="60" stroke="#5a3018" stroke-width="0.6"/>' +
      // Sight
      '<rect x="44" y="34" width="3" height="5" fill="#404048"/>' +
      '</svg>',
    revolver:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Barrel
      '<rect x="50" y="36" width="34" height="8" fill="#5a5a62" stroke="#202028" stroke-width="1"/>' +
      // Muzzle
      '<rect x="80" y="34" width="4" height="12" fill="#1a1a22"/>' +
      // Cylinder
      '<circle cx="42" cy="42" r="14" fill="#6a6a72" stroke="#202028" stroke-width="1.5"/>' +
      '<circle cx="42" cy="42" r="11" fill="none" stroke="#3a3a42" stroke-width="0.8"/>' +
      // Chamber holes
      '<circle cx="42" cy="33" r="2.5" fill="#1a1a22"/>' +
      '<circle cx="50" cy="40" r="2.5" fill="#1a1a22"/>' +
      '<circle cx="48" cy="48" r="2.5" fill="#1a1a22"/>' +
      '<circle cx="38" cy="51" r="2.5" fill="#1a1a22"/>' +
      '<circle cx="32" cy="44" r="2.5" fill="#1a1a22"/>' +
      // Frame
      '<rect x="38" y="50" width="14" height="8" fill="#404048" stroke="#1a1a22" stroke-width="1"/>' +
      // Trigger guard
      '<path d="M 38 56 Q 38 66 46 66 L 50 66 Q 58 66 54 58 Z" fill="none" stroke="#202028" stroke-width="2.5"/>' +
      // Wooden grip (warm brown)
      '<path d="M 28 50 L 28 84 Q 28 90 34 90 L 44 90 Q 50 90 50 84 L 50 64 L 42 56 Z" fill="#5a2c14" stroke="#2a1208" stroke-width="1.2"/>' +
      // Grip diamonds
      '<line x1="32" y1="60" x2="46" y2="80" stroke="#3a1a0c" stroke-width="0.6"/>' +
      '<line x1="32" y1="80" x2="46" y2="60" stroke="#3a1a0c" stroke-width="0.6"/>' +
      // Hammer
      '<rect x="46" y="32" width="6" height="6" fill="#1a1a22"/>' +
      '</svg>',
    katana:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Long curved blade — polished steel
      '<path d="M 92 22 Q 70 28 38 52 Q 22 64 18 70 L 22 76 Q 28 74 42 64 Q 72 42 96 28 Z" fill="#d8d8dc" stroke="#6a6a72" stroke-width="1.4"/>' +
      // Hamon (temper line)
      '<path d="M 92 24 Q 72 32 42 56 Q 26 66 22 72" fill="none" stroke="#a8a8b0" stroke-width="0.8" stroke-dasharray="2 3"/>' +
      // Tsuba (guard) — bronze octagon
      '<polygon points="18,68 12,74 12,82 18,88 28,88 34,82 34,74 28,68" fill="#8a6028" stroke="#3a2008" stroke-width="1.2"/>' +
      '<rect x="18" y="74" width="10" height="8" fill="#5a3a18"/>' +
      // Tsuka (handle) — red ito wrap on dark wood
      '<rect x="20" y="82" width="22" height="14" fill="#2a0808" stroke="#1a0404" stroke-width="0.8" transform="rotate(35 30 90)"/>' +
      // Ito wrap diamonds
      '<g transform="rotate(35 30 90)">' +
      '<line x1="22" y1="84" x2="40" y2="94" stroke="#8a1010" stroke-width="0.9"/>' +
      '<line x1="22" y1="88" x2="40" y2="98" stroke="#8a1010" stroke-width="0.9"/>' +
      '<line x1="22" y1="92" x2="40" y2="82" stroke="#8a1010" stroke-width="0.7"/>' +
      '<line x1="22" y1="96" x2="40" y2="86" stroke="#8a1010" stroke-width="0.7"/>' +
      '</g>' +
      '</svg>',
    flare:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Flare body — bright red
      '<rect x="20" y="42" width="50" height="14" rx="3" fill="#d83020" stroke="#5a1008" stroke-width="1.2"/>' +
      // Label band — yellow
      '<rect x="25" y="44" width="40" height="3" fill="#f0d020"/>' +
      '<rect x="25" y="51" width="40" height="3" fill="#f0d020"/>' +
      // Cap
      '<rect x="68" y="40" width="6" height="18" fill="#1a1a1f"/>' +
      // Flame at end
      '<path d="M 18 38 Q 8 28 4 14 Q 10 26 14 44 Q 14 52 18 60 Q 22 50 22 44 Z" fill="#f08020" stroke="#a02000" stroke-width="1.2"/>' +
      '<path d="M 14 36 Q 8 28 6 18 Q 12 30 14 50 Z" fill="#ffd060"/>' +
      // Sparks
      '<circle cx="2" cy="20" r="1.5" fill="#ffe080"/>' +
      '<circle cx="6" cy="8" r="1" fill="#ffd040"/>' +
      '</svg>',
    mirror:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Frame — dark wood
      '<rect x="18" y="14" width="64" height="76" rx="4" fill="#5a3818" stroke="#2a1808" stroke-width="2"/>' +
      // Glass — bluish silver
      '<rect x="24" y="20" width="52" height="64" fill="#c8d8e0" stroke="#6a8090" stroke-width="0.8"/>' +
      // Reflection sheen
      '<polygon points="24,20 76,20 36,30 24,30" fill="#e8f0f4" opacity="0.8"/>' +
      // Crack pattern (the "cracked" mirror)
      '<line x1="40" y1="20" x2="52" y2="48" stroke="#3a4050" stroke-width="0.8"/>' +
      '<line x1="52" y1="48" x2="48" y2="68" stroke="#3a4050" stroke-width="0.8"/>' +
      '<line x1="52" y1="48" x2="70" y2="40" stroke="#3a4050" stroke-width="0.8"/>' +
      '<line x1="52" y1="48" x2="36" y2="56" stroke="#3a4050" stroke-width="0.6"/>' +
      '<line x1="52" y1="48" x2="64" y2="74" stroke="#3a4050" stroke-width="0.6"/>' +
      '</svg>',
    architect_blade:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Ornate golden longsword
      '<path d="M 90 18 L 18 90 L 22 96 L 96 22 Z" fill="#f0c850" stroke="#8a6018" stroke-width="1.4"/>' +
      // Center fuller
      '<path d="M 88 22 L 22 88 L 24 90 L 90 24 Z" fill="#fae080" opacity="0.7"/>' +
      // Cross-guard
      '<rect x="6" y="78" width="32" height="6" fill="#a07820" stroke="#4a3010" stroke-width="1.2" transform="rotate(-45 22 81)"/>' +
      // Pommel — round jewel
      '<circle cx="14" cy="86" r="6" fill="#a07820" stroke="#4a3010" stroke-width="1"/>' +
      '<circle cx="14" cy="86" r="2.5" fill="#d04040"/>' +
      // Engraving on blade
      '<line x1="76" y1="26" x2="80" y2="30" stroke="#5a4010" stroke-width="0.6"/>' +
      '<line x1="60" y1="42" x2="64" y2="46" stroke="#5a4010" stroke-width="0.6"/>' +
      '<line x1="44" y1="58" x2="48" y2="62" stroke="#5a4010" stroke-width="0.6"/>' +
      '</svg>',
    revenant_blade:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Dark cursed blade
      '<path d="M 88 14 L 14 88 L 20 94 L 94 20 Z" fill="#2a1a22" stroke="#0a0408" stroke-width="1.4"/>' +
      // Bloody fuller
      '<path d="M 86 18 L 18 86 L 20 88 L 88 20 Z" fill="#5a0a14" opacity="0.85"/>' +
      // Blood drip
      '<path d="M 60 38 Q 60 50 56 56 Q 52 50 52 38 Z" fill="#8a0a14"/>' +
      '<circle cx="56" cy="58" r="2.5" fill="#8a0a14"/>' +
      // Cross-guard — dark twisted
      '<path d="M 6 82 L 10 78 L 38 78 L 42 82 L 38 86 L 10 86 Z" fill="#1a0a14" stroke="#000" stroke-width="1.2" transform="rotate(-45 22 82)"/>' +
      // Pommel — black skull
      '<circle cx="10" cy="90" r="6" fill="#1a0a14" stroke="#000" stroke-width="1"/>' +
      '<circle cx="8" cy="89" r="1.2" fill="#8a0a14"/>' +
      '<circle cx="12" cy="89" r="1.2" fill="#8a0a14"/>' +
      '</svg>',
    void_grenade:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Body — dark sphere with grid
      '<circle cx="50" cy="58" r="30" fill="#2a2a30" stroke="#0a0a0e" stroke-width="2"/>' +
      // Grid pattern (pineapple style)
      '<line x1="30" y1="40" x2="70" y2="76" stroke="#0a0a0e" stroke-width="1"/>' +
      '<line x1="30" y1="76" x2="70" y2="40" stroke="#0a0a0e" stroke-width="1"/>' +
      '<line x1="22" y1="58" x2="78" y2="58" stroke="#0a0a0e" stroke-width="1"/>' +
      '<line x1="50" y1="28" x2="50" y2="88" stroke="#0a0a0e" stroke-width="1"/>' +
      // Top cap
      '<rect x="42" y="22" width="16" height="8" fill="#5a5a62" stroke="#0a0a0e" stroke-width="1"/>' +
      // Lever
      '<rect x="58" y="22" width="14" height="3" fill="#7a7a82" stroke="#0a0a0e" stroke-width="0.8"/>' +
      // Pin ring
      '<circle cx="74" cy="18" r="5" fill="none" stroke="#a0a0a8" stroke-width="2"/>' +
      // Void glow at base
      '<circle cx="50" cy="58" r="10" fill="#4a0050" opacity="0.6"/>' +
      '</svg>',
    soul_lantern:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Top cap
      '<rect x="36" y="14" width="28" height="6" fill="#404048" stroke="#1a1a22" stroke-width="1"/>' +
      // Handle
      '<path d="M 40 14 Q 50 4 60 14" fill="none" stroke="#2a2a32" stroke-width="2"/>' +
      // Lantern body — frame
      '<rect x="30" y="20" width="40" height="50" fill="#2a2a32" stroke="#0a0a0e" stroke-width="1.5"/>' +
      // Glass panels
      '<rect x="34" y="24" width="32" height="42" fill="#80c8e0" opacity="0.6"/>' +
      // Inner flame — glowing soul
      '<ellipse cx="50" cy="46" rx="9" ry="14" fill="#c0f0ff" opacity="0.95"/>' +
      '<ellipse cx="50" cy="46" rx="5" ry="9" fill="#fff" opacity="0.9"/>' +
      // Bottom base
      '<rect x="34" y="70" width="32" height="10" fill="#404048" stroke="#1a1a22" stroke-width="1"/>' +
      // Glow halo
      '<circle cx="50" cy="46" r="22" fill="#80e8ff" opacity="0.18"/>' +
      '</svg>',
    haruki_charm:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Omamori paper body
      '<path d="M 28 18 L 72 18 Q 76 18 76 22 L 76 78 Q 76 82 72 82 L 28 82 Q 24 82 24 78 L 24 22 Q 24 18 28 18 Z" fill="#c00020" stroke="#5a0008" stroke-width="1.5"/>' +
      // Gold accents at corners
      '<rect x="24" y="18" width="52" height="5" fill="#f0c050"/>' +
      '<rect x="24" y="77" width="52" height="5" fill="#f0c050"/>' +
      // Vertical kanji line
      '<rect x="48" y="28" width="4" height="44" fill="#f0c050"/>' +
      // Calligraphy (stylized strokes)
      '<line x1="42" y1="34" x2="58" y2="34" stroke="#1a1a1a" stroke-width="1.6"/>' +
      '<line x1="42" y1="44" x2="58" y2="44" stroke="#1a1a1a" stroke-width="1.6"/>' +
      '<line x1="46" y1="52" x2="54" y2="52" stroke="#1a1a1a" stroke-width="1.2"/>' +
      '<line x1="42" y1="62" x2="58" y2="62" stroke="#1a1a1a" stroke-width="1.6"/>' +
      // Tassel
      '<line x1="50" y1="82" x2="50" y2="92" stroke="#f0c050" stroke-width="2"/>' +
      '<circle cx="50" cy="94" r="3" fill="#f0c050"/>' +
      '</svg>',
    siren_whistle:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Whistle body — silver tube
      '<rect x="16" y="46" width="48" height="14" rx="3" fill="#d0d0d8" stroke="#404048" stroke-width="1.2"/>' +
      '<rect x="64" y="50" width="14" height="6" fill="#a0a0a8" stroke="#404048" stroke-width="1"/>' +
      // Mouthpiece
      '<rect x="78" y="48" width="6" height="10" fill="#80808a"/>' +
      // Air hole
      '<rect x="32" y="46" width="8" height="3" fill="#404048"/>' +
      // Cord ring
      '<circle cx="20" cy="53" r="4" fill="none" stroke="#404048" stroke-width="1.5"/>' +
      // Cord
      '<path d="M 16 53 Q 6 56 8 70 Q 10 80 22 78" fill="none" stroke="#5a2814" stroke-width="1.6"/>' +
      // Shine
      '<rect x="22" y="48" width="36" height="2" fill="#fff" opacity="0.6"/>' +
      '</svg>',
    mirror_shard:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' +
      // Sharp irregular glass shard
      '<polygon points="22,86 38,18 56,32 78,12 70,52 92,68 60,72 48,90 28,78" fill="#c0d8e8" stroke="#406070" stroke-width="1.2"/>' +
      // Inner reflection lines
      '<polygon points="38,18 48,40 56,32" fill="#e8f4fa" opacity="0.85"/>' +
      '<polygon points="56,32 60,72 78,12" fill="#a0c0d0" opacity="0.5"/>' +
      // Crack/edge lines
      '<line x1="38" y1="18" x2="22" y2="86" stroke="#406070" stroke-width="0.5"/>' +
      '<line x1="56" y1="32" x2="48" y2="90" stroke="#406070" stroke-width="0.5"/>' +
      // Blood-stain hint at tip
      '<polygon points="22,86 30,82 28,90" fill="#5a0010" opacity="0.6"/>' +
      '</svg>'
  };
  // Returns an icon HTML snippet — SVG if available, else emoji span.
  function getWeaponIconHTML(itemId) {
    if (WEAPON_SVG[itemId]) return WEAPON_SVG[itemId];
    var it = ITEMS[itemId];
    var emoji = (it && it.icon) ? it.icon : '⚔';
    return '<span class="weapon-emoji">' + emoji + '</span>';
  }
  window.getWeaponIconHTML = getWeaponIconHTML;
  // Weapons that emit a muzzle flash (guns / explosives).
  var WEAPON_FLASH_SET = { pistol: 1, shotgun: 1, revolver: 1, void_grenade: 1, flare: 1 };
  // Weapons with heavier kick (shotgun / grenade / unique blades).
  var WEAPON_HEAVY_RECOIL = { shotgun: 1, void_grenade: 1, architect_blade: 1 };
  // Trigger a brief tilt animation on the FPS hand view when the weapon fires.
  function _animateWeaponHandFire(weaponId) {
    var hand = el('weaponHand');
    if (!hand || !hand.classList.contains('show')) return;
    var heavy = WEAPON_HEAVY_RECOIL[weaponId];
    hand.classList.add('fire');
    if (heavy) hand.classList.add('heavy');
    var dur = heavy ? 180 : 110;
    setTimeout(function () {
      if (hand) { hand.classList.remove('fire'); hand.classList.remove('heavy'); }
    }, dur);
    // Muzzle flash for guns / explosives
    if (WEAPON_FLASH_SET[weaponId]) {
      var fl = el('weaponHandFlash');
      if (fl) {
        fl.classList.remove('flash');
        // force reflow so the animation can replay on rapid re-fire
        void fl.offsetWidth;
        fl.classList.add('flash');
      }
    }
  }
  // Fire the equipped weapon — used by weaponAttackBtn / R1 gamepad.
  function fireEquippedWeapon() {
    if (state !== ST.PLAYING) return;
    if (_inCinematic) return;
    if (typeof _isGamePaused === 'function' && _isGamePaused()) return;
    var id = player.equippedWeapon;
    if (!id) { toast('武器未装備'); return; }
    if (!ITEMS[id] || ITEMS[id].category !== 'weapon') return;
    _pendingItemId = id;
    _animateWeaponHandFire(id);
    confirmItemUse();
    updateWeaponAttackBtn();
  }
  // Expose for inline handlers / gamepad poll
  window.equipWeapon = equipWeapon;
  window.fireEquippedWeapon = fireEquippedWeapon;

  function startPlaying() {
    state = ST.PLAYING;
    updateChaosLayer();
    var rt = el('reticle'); if (rt) rt.classList.add('show');
    var wab = el('weaponAttackBtn'); if (wab) wab.classList.add('show');
    updateWeaponAttackBtn();
    // Give the player a brief invulnerability window to read the surroundings.
    var graceMs = getSpawnGraceMs(currentLevel);
    spawnGraceUntil = performance.now() + graceMs;
    var sgEl = el('spawnGraceHud');
    if (sgEl) {
      sgEl.style.display = 'flex';
      setTimeout(function () {
        var e2 = el('spawnGraceHud');
        if (e2) e2.style.display = 'none';
      }, graceMs);
    }
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
    // BB: quickItemBtn (right-side ⭐ item shortcut button) is intentionally
    // suppressed — D-pad shortcuts cover the same flow, the on-screen button
    // crowded the right edge. Kept in the DOM for compatibility / save-load.
    var _qib = el('quickItemBtn');
    if (_qib) { _qib.classList.remove('show'); _qib.style.display = 'none'; }
    updateDpadHud();
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
    '右上のスマホでステータス・マップ・記録を確認できる。',
    '武器を拾ったら 十字キーに割り当て → 押して装備、右下の青ボタンで攻撃。',
    '画面中央のレティクルが照準。視線を合わせて青ボタンを押せ。',
    'HP・SAN が半分以下になると赤い縁が脈打つ。回復薬・包帯で立て直せ。'
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

  // ============================================================
  //  PROPS — per-level decorative furniture / objects
  // ============================================================
  // Each prop kind has a hint about where it tends to look natural:
  //   wallSide: true  → prefers a floor tile orthogonally adjacent to a wall
  //   wallSide: false → standalone (rugs / plants / pillars)
  // count is per-level baseline; tweaked by gfxQuality (LOW halves to save fillrect cost).
  var PROP_KIND_DEFAULTS = {
    desk:     { wallSide: true,  hScale: 0.55, wScale: 1.05 },
    chair:    { wallSide: false, hScale: 0.50, wScale: 0.45 },
    pc:       { wallSide: false, hScale: 0.32, wScale: 0.45 },  // sits on desk if adjacent
    bed:      { wallSide: true,  hScale: 0.45, wScale: 1.30 },
    lamp:     { wallSide: false, hScale: 0.95, wScale: 0.22 },  // floor lamp — tall
    counter:  { wallSide: true,  hScale: 0.60, wScale: 1.25 },
    shelf:    { wallSide: true,  hScale: 1.05, wScale: 0.85 },
    bookcase: { wallSide: true,  hScale: 1.10, wScale: 0.80 },
    plant:    { wallSide: false, hScale: 0.85, wScale: 0.55 },
    crate:    { wallSide: false, hScale: 0.55, wScale: 0.65 },
    trashcan: { wallSide: false, hScale: 0.60, wScale: 0.40 },
    medical:  { wallSide: true,  hScale: 0.70, wScale: 0.65 },  // hospital cart
    tv:       { wallSide: true,  hScale: 0.45, wScale: 0.75 },
    bench:    { wallSide: false, hScale: 0.42, wScale: 1.00 },
    kiosk:    { wallSide: true,  hScale: 1.20, wScale: 0.90 },
    pillar:   { wallSide: false, hScale: 1.50, wScale: 0.50 },
    barrel:   { wallSide: false, hScale: 0.75, wScale: 0.60 },
    rug:      { wallSide: false, hScale: 0.04, wScale: 1.20, flat: true },
    candle:   { wallSide: false, hScale: 0.45, wScale: 0.15 },
    rock:     { wallSide: false, hScale: 0.40, wScale: 0.70 },
    coral:    { wallSide: false, hScale: 0.85, wScale: 0.45 },
    hedge:    { wallSide: true,  hScale: 0.85, wScale: 1.00 }
  };

  // Per-level prop placement plan. Numbers are total props of that kind;
  // populateProps picks valid floor tiles at level load. Keep counts modest
  // — every prop is a billboard, so 30+ per level starts to cost fillrect.
  var LEVEL_PROP_CONFIG = {
    0:  [ { kind: 'chair', n: 4 }, { kind: 'trashcan', n: 3 }, { kind: 'lamp', n: 2 } ],
    1:  [ { kind: 'crate', n: 6 }, { kind: 'barrel', n: 4 }, { kind: 'pillar', n: 3 } ],
    2:  [ { kind: 'crate', n: 4 }, { kind: 'barrel', n: 3 }, { kind: 'pillar', n: 2 } ],
    3:  [ { kind: 'crate', n: 3 }, { kind: 'rock', n: 5 }, { kind: 'plant', n: 2 } ],
    4:  [ { kind: 'desk', n: 6 }, { kind: 'chair', n: 8 }, { kind: 'pc', n: 5 },
          { kind: 'plant', n: 3 }, { kind: 'shelf', n: 2 } ],
    5:  [ { kind: 'bed', n: 4 }, { kind: 'lamp', n: 4 }, { kind: 'counter', n: 2 },
          { kind: 'plant', n: 2 }, { kind: 'tv', n: 2 } ],
    6:  [ { kind: 'candle', n: 6 }, { kind: 'crate', n: 2 } ],
    7:  [ { kind: 'rock', n: 6 }, { kind: 'plant', n: 3 }, { kind: 'hedge', n: 2 } ],
    8:  [ { kind: 'pillar', n: 4 }, { kind: 'barrel', n: 2 } ],
    9:  [ { kind: 'chair', n: 5 }, { kind: 'shelf', n: 3 }, { kind: 'candle', n: 4 },
          { kind: 'rug', n: 2 }, { kind: 'bookcase', n: 2 } ],
    11: [ { kind: 'bench', n: 4 }, { kind: 'kiosk', n: 2 }, { kind: 'plant', n: 4 },
          { kind: 'trashcan', n: 3 } ],
    12: [ { kind: 'crate', n: 3 }, { kind: 'pillar', n: 2 }, { kind: 'candle', n: 4 } ],
    13: [ { kind: 'bookcase', n: 8 }, { kind: 'shelf', n: 4 }, { kind: 'chair', n: 3 },
          { kind: 'desk', n: 2 }, { kind: 'lamp', n: 2 } ],
    14: [ { kind: 'coral', n: 6 }, { kind: 'rock', n: 4 } ],
    15: [ { kind: 'hedge', n: 6 }, { kind: 'plant', n: 5 }, { kind: 'bench', n: 2 } ]
  };

  // Returns true if the tile at (gx, gy) is open floor (walkable, not a door).
  function _propTileIsFloor(gx, gy) {
    if (!currentMap || gx < 0 || gy < 0 || gx >= currentMap.width || gy >= currentMap.height) return false;
    var t = currentMap.tiles[gy][gx];
    return t === 0 || t === 4;
  }
  // True if any 4-neighbour is a wall (or boundary). Used to bias furniture
  // toward the walls so beds/desks/shelves look anchored instead of floating.
  function _propTileNearWall(gx, gy) {
    if (!currentMap) return true;
    var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (var i = 0; i < dirs.length; i++) {
      var nx = gx + dirs[i][0], ny = gy + dirs[i][1];
      if (nx < 0 || ny < 0 || nx >= currentMap.width || ny >= currentMap.height) return true;
      var tt = currentMap.tiles[ny][nx];
      if (tt === 1 || tt === 8 || tt === 9) return true;
    }
    return false;
  }
  function _propSeededRng(seed) {
    var s = (seed | 0) || 1;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  // Light-emitting prop kinds. Each pushes a point light into the engine
  // so the surrounding walls/floor pick up the warm/cool tint instead of
  // staying flat-dark — adds a lot of perceived realism in dim levels.
  // intensity is kept modest so the existing scripted point lights stay
  // dominant; props contribute background glow.
  var PROP_LIGHT_PROFILES = {
    lamp:   { r: 255, g: 210, b: 130, radius: 4.0, intensity: 0.55, flicker: 0.06 },
    candle: { r: 255, g: 160, b: 70,  radius: 2.5, intensity: 0.45, flicker: 0.35 },
    pc:     { r: 110, g: 170, b: 230, radius: 2.0, intensity: 0.30, flicker: 0.04 },
    tv:     { r: 130, g: 160, b: 220, radius: 2.8, intensity: 0.40, flicker: 0.20 }
  };

  function populateProps(levelId) {
    props = [];
    var cfg = LEVEL_PROP_CONFIG[levelId];
    if (!cfg || !currentMap) return;
    // Gather candidate floor tiles (excluding tiles within 2 of the spawn so
    // the player isn't blocked-by-furniture on respawn).
    var sp = currentMap.spawn || { gx: 1, gy: 1 };
    var wallSideTiles = [];
    var openTiles = [];
    for (var y = 1; y < currentMap.height - 1; y++) {
      for (var x = 1; x < currentMap.width - 1; x++) {
        if (!_propTileIsFloor(x, y)) continue;
        if (Math.abs(x - sp.gx) + Math.abs(y - sp.gy) <= 2) continue;
        if (_propTileNearWall(x, y)) wallSideTiles.push([x, y]);
        else openTiles.push([x, y]);
      }
    }
    // gfxQuality LOW halves to keep fillrect under control on older phones.
    var qScale = (gfxQuality === 'low') ? 0.5 : (gfxQuality === 'high' ? 1.0 : 0.85);
    var rng = _propSeededRng(levelId * 9176 + 31);
    var used = {};
    function _key(t) { return t[0] + '_' + t[1]; }
    function _pickFrom(pool) {
      // shuffle a copy lazily — just pick a random unused one
      for (var tries = 0; tries < 18; tries++) {
        if (!pool.length) return null;
        var idx = (rng() * pool.length) | 0;
        var t = pool[idx];
        if (!used[_key(t)]) { used[_key(t)] = 1; return t; }
      }
      return null;
    }
    for (var ci = 0; ci < cfg.length; ci++) {
      var entry = cfg[ci];
      var def = PROP_KIND_DEFAULTS[entry.kind];
      if (!def) continue;
      var count = Math.max(1, Math.round(entry.n * qScale));
      var pool = def.wallSide ? wallSideTiles : openTiles;
      // Fallback to the other pool if the preferred one is exhausted.
      for (var k = 0; k < count; k++) {
        var t = _pickFrom(pool);
        if (!t) t = _pickFrom(def.wallSide ? openTiles : wallSideTiles);
        if (!t) break;
        var jitterX = (rng() - 0.5) * TS * 0.30;
        var jitterY = (rng() - 0.5) * TS * 0.30;
        var pp = {
          kind: entry.kind,
          gx: t[0], gy: t[1],
          _wx: t[0] * TS + TS / 2 + jitterX,
          _wy: t[1] * TS + TS / 2 + jitterY,
          _wobble: rng() * 6.28
        };
        props.push(pp);
        // Register a point light for emissive kinds. id namespaced as
        // 'prop_l' + index so removePointLight on level reload (entities
        // re-init clears GameEngine.pointLights anyway) doesn't collide
        // with the scripted level lights ('l_<n>').
        var lp = PROP_LIGHT_PROFILES[entry.kind];
        if (lp && GameEngine.addPointLight) {
          GameEngine.addPointLight('prop_l_' + props.length, t[0], t[1], {
            radius: lp.radius,
            r: lp.r, g: lp.g, b: lp.b,
            intensity: lp.intensity,
            flicker: lp.flicker,
            phase: pp._wobble
          });
        }
      }
    }
  }

  function isWalkable(wx, wy) {
    var gx = Math.floor(wx / TS);
    var gy = Math.floor(wy / TS);
    if (!currentMap) return false;
    if (gx < 0 || gy < 0 || gx >= currentMap.width || gy >= currentMap.height) return false;
    var t = currentMap.tiles[gy][gx];
    // Type 4 (F tile) is decorative floor — should be walkable. Previously
    // returned false here which made LV1/14/15 etc. partially unreachable
    // ("到達不可能な領域がある"). Walls (1), hives (8), pump rooms (9) stay
    // non-walkable.
    if (t === 1 || t === 8 || t === 9) return false;
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
  // Unified pause check — game world is frozen when any of these are true.
  // Used by updatePlayer + updateEntities to keep them consistent.
  function _isGamePaused() {
    if (state !== ST.PLAYING) return true;
    if (phoneOpen) return true;
    if (miniGameOpen) return true;
    if (_inCinematic) return true;
    // Discovery popup (item/entity-found) is informational — does NOT pause anymore.
    // Only the note viewer (text reader) pauses the game.
    var nv_ = el('noteViewerOverlay');
    if (nv_ && nv_.style.display !== 'none') return true;
    var iu_ = el('itemUseModal');
    if (iu_ && iu_.style.display !== 'none') return true;
    var ts_ = el('titleSettingsOverlay');
    if (ts_ && ts_.style.display !== 'none') return true;
    var tut_ = el('tutorialOverlay');
    if (tut_ && tut_.style.display !== 'none') return true;
    var lvl_ = el('levelSelectOverlay');
    if (lvl_ && lvl_.style.display !== 'none') return true;
    var sho_ = el('shopOverlay');
    if (sho_ && sho_.style.display !== 'none') return true;
    var ta_ = el('titleArchiveOverlay');
    if (ta_ && ta_.style.display !== 'none') return true;
    var pr_ = el('promptOverlay');
    if (pr_ && pr_.style.display !== 'none') return true;
    return false;
  }

  function updatePlayer(dt) {
    if (_isGamePaused()) return;

    var inp = GameEngine.input;
    // localStorage access is sync — at 60 fps two reads per frame =
    // ~0.5-2 ms steady cost on Safari mobile. Cache values and only
    // re-read every 60 frames (~1s). Settings changes propagate
    // within a second, which is fine for sliders.
    if (!player._setCache) player._setCache = { tick: 0, sens: 2.5, smF: 0 };
    player._setCache.tick = (player._setCache.tick + 1) | 0;
    if (player._setCache.tick > 60) {
      player._setCache.tick = 0;
      try {
        player._setCache.sens = 2.5 * (parseInt(localStorage.getItem('bk_sens') || '100', 10) / 100);
        var smP = parseInt(localStorage.getItem('bk_view_smooth') || '0', 10);
        player._setCache.smF = Math.max(0, Math.min(0.85, smP / 100 * 0.85));
      } catch (e) {}
    }
    var sens = player._setCache.sens;
    var smoothFactor = player._setCache.smF;
    var look = inp.lookDx || 0;
    if (smoothFactor > 0) {
      // EMA: smoothed look approaches target (raw look) at rate (1 - smoothFactor)
      // and decays toward 0 when no input — eventually clamping to 0 below
      // a very small threshold so the camera comes to a complete stop.
      player._smoothLook = (player._smoothLook || 0) * smoothFactor + look * (1 - smoothFactor);
      if (Math.abs(player._smoothLook) < 0.005) player._smoothLook = 0;
      player.angle += player._smoothLook * sens * dt;
    } else {
      // Default path — instant, no residual.
      player.angle += look * sens * dt;
      player._smoothLook = 0;
    }
    // Swipe-impulse look: applied directly (it's already a one-shot delta,
    // smoothing it would just delay it without benefit).
    if (inp.lookImpulse) {
      player.angle += inp.lookImpulse * sens;
      inp.lookImpulse = 0;
    }

    // Movement
    var speed = 130; // pixels per second
    if (player.inWater) speed *= 0.55;
    var sprint = inp.sprint && player.stam > 5;
    if (sprint) speed *= 1.7;
    // DROWNED grapple — player movement halved while grappled (recently touched).
    if (player._drownedGrabUntil && performance.now() < player._drownedGrabUntil) {
      speed *= 0.5;
    }
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
      var blockedX = !isWalkable(nx, player.y);
      if (!blockedX) player.x = nx;
      // Try Y
      var ny = player.y + moveY;
      var blockedY = !isWalkable(player.x, ny);
      if (!blockedY) player.y = ny;
      // Post-final-boss wall-clip falling cinematic — armed by
      // _grantCoinsForKill when the player kills the haruki_boss on Lv9.
      // Triggers the first time they push into a wall on the return trip.
      if (player._wallClipPending && (blockedX || blockedY) &&
          typeof playWallClipFall === 'function' && !_inCinematic) {
        player._wallClipPending = false;
        playWallClipFall();
      }

      // Footstep audio every ~24 px traveled. On water tiles, also emit
      // a small splash particle and play 'pipe_drip' as a wet-step variant
      // so the player hears + sees that they're in water.
      if (!player._footAccum) player._footAccum = 0;
      player._footAccum += len * speed * dt * 0.04;
      if (player._footAccum > 24) {
        player._footAccum = 0;
        if (audioInitialized) {
          if (player.inWater) {
            try { GameEngine.playSound('pipe_drip'); } catch (e) {}
          } else {
            GameEngine.playSound('footstep');
          }
        }
        // Water splash particles — only on water tiles, only every step
        if (player.inWater && GameEngine.addParticle) {
          for (var spi = 0; spi < 3; spi++) {
            var sx = (Math.random() - 0.5) * 30;
            var sy = (Math.random() - 0.5) * 30;
            GameEngine.addParticle('spark', player.x + sx, player.y + sy);
          }
        }
      }
      // Walk-bob class on the FPS hand. Stays for 0.3s after the last
      // movement frame so brief stops don't snap the bob off.
      if (!player._moving) {
        player._moving = true;
        var hb = el('weaponHand');
        if (hb) hb.classList.add('bobbing');
      }
      player._walkBobTimer = 0.3;
    } else if (player._moving) {
      player._walkBobTimer -= dt;
      if (player._walkBobTimer <= 0) {
        player._moving = false;
        var hb2 = el('weaponHand');
        if (hb2) hb2.classList.remove('bobbing');
      }
    }

    // Camera headbob — phase advances while walking, amp eases toward
    // a sprint/walk target so the bob ramps up smoothly. Read in
    // onRender to translate the world a few px each frame. ~3px walk
    // / ~5px sprint reads as physical without obscuring the reticle.
    if (len > 0.01) {
      player._headbobPhase = (player._headbobPhase || 0) + dt * (sprint ? 14 : 9);
      var _headbobTarget = sprint ? 5.0 : 2.8;
      player._headbobAmp = (player._headbobAmp || 0) * 0.92 + _headbobTarget * 0.08;
    } else {
      // Damped recovery so stopping doesn't snap the world up by 5px.
      player._headbobAmp = (player._headbobAmp || 0) * 0.85;
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

    // ── Auto-collect already-read notes ──
    // User request 2026-06-08: 「すでに読んだ書類は触ったら自動取得で
    // マップから消えるようにする」.
    // When the player walks onto (or directly adjacent to) a note tile
    // whose TITLE has been read in any past run (lifetimeNoteTitles),
    // silently mark this run's instance as read so the world glow
    // disappears and the player doesn't have to re-read it.
    // Same-tile + 4-neighbor sweep — the note glow is centered on the
    // tile, so touching adjacency reads as "通った時に拾う".
    if (noteSpots && lifetimeNoteTitles) {
      for (var aDy = -1; aDy <= 1; aDy++) {
        for (var aDx = -1; aDx <= 1; aDx++) {
          if (aDx !== 0 && aDy !== 0) continue; // 4-neighbor only (no diag)
          var nKey = gridKey(gx + aDx, gy + aDy);
          var nObj = noteSpots[nKey];
          if (!nObj) continue;
          if (!lifetimeNoteTitles[nObj.title]) continue; // not previously read
          if (!readNotes[currentLevel]) readNotes[currentLevel] = {};
          if (readNotes[currentLevel][nKey]) continue;   // already auto-collected this run
          readNotes[currentLevel][nKey] = true;
          stats.totalNotesRead++;
          // Toast + paper SE so the player knows the note was auto-acquired
          try { toast('既読の書類を自動取得: ' + nObj.title); } catch (e) {}
          if (audioInitialized) try { GameEngine.playSound('paper'); } catch (e) {}
        }
      }
    }

    // Tile interactions
    var here = currentMap.tiles[gy][gx];
    player.inWater = (here === 7);
    player.inHazard = (here === 10);
    player.inSafeZone = (here === 11);
    // Staircase teleport — when player steps on a stair-up tile they are sent
    // to the paired stair-down tile (and vice versa). Used by mansion-style
    // levels (Lv5) to simulate a 2F without needing a multi-floor renderer.
    if (currentMap.stairsUp && currentMap.stairsUp.length &&
        currentMap.stairsDown && currentMap.stairsDown.length) {
      var nowMs = performance.now();
      if (!player._stairCooldownUntil) player._stairCooldownUntil = 0;
      if (nowMs >= player._stairCooldownUntil) {
        var teleportTo = null;
        var dirLabel = '';
        for (var sui = 0; sui < currentMap.stairsUp.length; sui++) {
          if (currentMap.stairsUp[sui].gx === gx && currentMap.stairsUp[sui].gy === gy) {
            teleportTo = currentMap.stairsDown[sui] || currentMap.stairsDown[0];
            dirLabel = '2F';
            break;
          }
        }
        if (!teleportTo) {
          for (var sdi = 0; sdi < currentMap.stairsDown.length; sdi++) {
            if (currentMap.stairsDown[sdi].gx === gx && currentMap.stairsDown[sdi].gy === gy) {
              teleportTo = currentMap.stairsUp[sdi] || currentMap.stairsUp[0];
              dirLabel = '1F';
              break;
            }
          }
        }
        if (teleportTo) {
          player.x = teleportTo.gx * TS + TS / 2;
          player.y = teleportTo.gy * TS + TS / 2;
          player._stairCooldownUntil = nowMs + 1200;
          toast('— ' + dirLabel + ' —');
          if (audioInitialized) GameEngine.playSound('door');
          GameEngine.shakeScreen(3, 0.2);
        }
      }
    }

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
    // Safe area: no SAN drain (the safe-area regen below handles healing).
    if (player.inSafeZone) sanDrain = 0;
    player.san = Math.max(0, player.san - sanDrain * dt);
    // SAN-bucket transition triggers a sparse low-SAN whisper. We only fire on
    // *crosses* into a lower bucket so a long run at 25% SAN doesn't chatter.
    var sanPct = (player.san / player.sanMax) * 100;
    var newBucket = sanPct < 12 ? 'critical' : (sanPct < 30 ? 'low' : (sanPct < 55 ? 'mid' : 'high'));
    if (newBucket !== _sanBucket) {
      var order = { high: 3, mid: 2, low: 1, critical: 0 };
      // Only on transitions to a *lower* bucket
      if (order[newBucket] < order[_sanBucket]) {
        if (newBucket === 'critical' || newBucket === 'low') {
          speakSituational('low_san', { cooldownMs: 30000 });
        }
      }
      _sanBucket = newBucket;
    }

    // Flashlight battery drain: 1%/s while ON. When depleted, auto-swap to
    // the next spare flashlight if any. Otherwise turn it off.
    if (player.flashlightOn) {
      player.flashlightBattery = Math.max(0, (player.flashlightBattery || 0) - dt * 1);
      if (player.flashlightBattery <= 0) {
        if ((player.inventory.flashlight || 0) > 1) {
          player.inventory.flashlight--;
          player.flashlightBattery = 100;
          toast('予備バッテリーに交換 100%');
        } else {
          player.flashlightOn = false;
          toast('懐中電灯 — バッテリー切れ');
        }
      }
    }

    // Stamina regen
    if (sprint) player._sprintingDuration = (player._sprintingDuration || 0) + dt;
    else player._sprintingDuration = 0;

    // Heavy-breath audio loop — kicks in when stamina drops below 30%
    // (whether sprinting or just recovering from sprint exhaustion).
    // Period shortens as stamina worsens so the player feels the
    // exertion. 0.30 → 2.4s, 0.05 → 1.0s. Auto-silences once stam > 35%.
    var staRatio = player.stam / player.stamMax;
    if (player._breathT === undefined) player._breathT = 0;
    if (staRatio < 0.30) {
      var staClamp = Math.max(0.05, Math.min(0.30, staRatio));
      var breathPeriod = 1.0 + (staClamp - 0.05) / 0.25 * (2.4 - 1.0);
      player._breathT += dt;
      if (player._breathT >= breathPeriod) {
        player._breathT = 0;
        if (audioInitialized) try { GameEngine.playSound('breath'); } catch (e) {}
      }
    } else if (staRatio > 0.35) {
      player._breathT = 0;
    }

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
      // Low-HP vignette — pulse red around the screen edges. Three tiers:
      //   < 0.30 → soft pulse
      //   < 0.15 → fast, intense pulse
      //   >= 0.30 → off
      var vig = el('lowHpVignette');
      if (vig) {
        vig.classList.toggle('show', hpRatio < 0.30);
        vig.classList.toggle('critical', hpRatio < 0.15);
      }
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
    var coinNumEl = el('vitalCoinNum');
    if (coinNumEl && player._hudCache.coins !== player.coins) {
      coinNumEl.textContent = player.coins || 0;
      player._hudCache.coins = player.coins;
    }
    // ∞ 永遠の護符 indicator — once per state change, not per-frame DOM hit.
    var charmRow = el('vitalCharmRow');
    if (charmRow) {
      var charmNow = hasEternalCharm();
      if (player._hudCache.charm !== charmNow) {
        charmRow.style.display = charmNow ? 'flex' : 'none';
        player._hudCache.charm = charmNow;
      }
    }
    // Active-effect chips — flashlight (with battery %) / radio / compass.
    // Only touch the DOM when the state flips so this is essentially
    // free on the per-frame path.
    var effF = el('effFlashlight');
    if (effF) {
      var fOn = !!player.flashlightOn;
      var fBat = Math.round(player.flashlightBattery || 0);
      if (player._hudCache.flashOn !== fOn || player._hudCache.flashBat !== fBat) {
        effF.style.display = fOn ? 'inline-flex' : 'none';
        if (fOn) {
          var batEl = el('effFlashBat');
          if (batEl) batEl.textContent = fBat;
          effF.classList.toggle('low', fBat < 25);
        }
        player._hudCache.flashOn = fOn;
        player._hudCache.flashBat = fBat;
      }
    }
    var effR = el('effRadio');
    if (effR) {
      var rOn = !!player.radioOn;
      if (player._hudCache.radioOn !== rOn) {
        effR.style.display = rOn ? 'inline-flex' : 'none';
        player._hudCache.radioOn = rOn;
      }
    }
    var effC = el('effCompass');
    if (effC) {
      var cOn = !!player.compassOn;
      if (player._hudCache.compassOn !== cOn) {
        effC.style.display = cOn ? 'inline-flex' : 'none';
        player._hudCache.compassOn = cOn;
      }
    }
    // ── Boss HP banner ──
    // Show a top-of-screen HP bar whenever a boss/haruki_boss is alive.
    // Picks the closest alive boss in case of multiples.
    var bossEnt = null, bossBestD = Infinity;
    for (var bi = 0; bi < entities.length; bi++) {
      var be = entities[bi];
      if (!be.alive) continue;
      if (be.type !== 'boss' && be.type !== 'haruki_boss') continue;
      var bdx = be.x - player.x, bdy = be.y - player.y;
      var bd = bdx * bdx + bdy * bdy;
      if (bd < bossBestD) { bossBestD = bd; bossEnt = be; }
    }
    var bbn = el('bossHpBanner');
    if (bbn) {
      if (bossEnt) {
        var bMax = bossEnt.bossHpMax || bossEnt.bossHp || 200;
        var bCur = Math.max(0, bossEnt.bossHp || 0);
        var bPct = bMax > 0 ? bCur / bMax : 0;
        // Compute phase label that matches the AI thresholds.
        var bossPhaseLabel = '';
        if (bossEnt.type === 'boss' || bossEnt.type === 'haruki_boss') {
          if (bPct < 0.175 && bossEnt.type === 'haruki_boss') bossPhaseLabel = ' / 第4形態 残光';
          else if (bPct < 0.45) bossPhaseLabel = ' / 第3形態 影分身';
          else if (bPct < 0.75) bossPhaseLabel = ' / 第2形態 加速';
          else bossPhaseLabel = ' / 第1形態';
        }
        if (player._hudCache.bossPct !== bPct || player._hudCache.bossType !== bossEnt.type) {
          var fillEl = el('bossHpBarFill');
          var nameEl = el('bossHpName');
          var numEl = el('bossHpNum');
          if (fillEl) fillEl.style.width = (bPct * 100).toFixed(1) + '%';
          if (nameEl) nameEl.textContent =
            (bossEnt._isHidden ? '★ HIDDEN — 祭壇の影' :
             bossEnt.type === 'haruki_boss' ? 'HARUKI 真' :
             'THE ARCHITECT') + bossPhaseLabel;
          if (numEl) numEl.textContent = Math.ceil(bCur) + ' / ' + bMax;
          bbn.classList.toggle('low', bPct < 0.30);
          if (!bbn.classList.contains('show')) bbn.classList.add('show');
          player._hudCache.bossPct = bPct;
          player._hudCache.bossType = bossEnt.type;
        }
      } else if (player._hudCache.bossPct !== -1) {
        bbn.classList.remove('show');
        bbn.classList.remove('low');
        player._hudCache.bossPct = -1;
        player._hudCache.bossType = null;
      }
    }

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

    // Continuous low-HP heartbeat — starts at 30% HP, frequency ramps up
    // as HP drops to 5% (period 0.7s → 0.32s). Pulses the lowHpVignette
    // alongside so visual + audio stay in sync. Stops cleanly when HP
    // recovers above 32%.
    if (player._heartbeatT === undefined) player._heartbeatT = 0;
    if (hpRatio < 0.30) {
      // Lerp period: 0.30 → 0.7s, 0.05 → 0.32s. Clamped so even after
      // critical HP we don't fall below ~0.30s (audio quality / spam).
      var hpRatioClamp = Math.max(0.05, Math.min(0.30, hpRatio));
      var beatPeriod = 0.32 + (hpRatioClamp - 0.05) / 0.25 * (0.7 - 0.32);
      player._heartbeatT += dt;
      if (player._heartbeatT >= beatPeriod) {
        player._heartbeatT = 0;
        if (audioInitialized) try { GameEngine.playSound('heartbeat'); } catch (e) {}
        var vigPulse = el('lowHpVignette');
        if (vigPulse) {
          vigPulse.classList.remove('beat-pulse');
          void vigPulse.offsetWidth;
          vigPulse.classList.add('beat-pulse');
        }
      }
    } else if (hpRatio > 0.32) {
      // Recovery: clear the accumulator so next dip starts fresh.
      player._heartbeatT = 0;
    }

    // Threshold warnings (sound + toast on crossing 50% / 25%)
    if (!player._lastHpRatio) player._lastHpRatio = 1;
    if (!player._lastSanRatio) player._lastSanRatio = 1;
    if (player._lastHpRatio >= 0.25 && hpRatio < 0.25 && audioInitialized) {
      // One-shot stinger on crossing 25%. The continuous heartbeat loop
      // above keeps reinforcing the danger after this initial alert.
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

    // Per-level flavor lines — rolled at ~12s, cooldown 35s, separate from
    // the micro-event channel so each one feels like its own beat.
    if (typeof _isGamePaused !== 'function' || !_isGamePaused()) {
      if (!_inCinematic) {
        _flavorRollT = (_flavorRollT || 0) - dt;
        if (_flavorRollT <= 0) {
          _flavorRollT = 12;
          if (Math.random() < 0.35) maybeFireLevelFlavor();
        }
      }
    }

    // Level-specific ambient events — every ~8s rolls, with a 14s cooldown
    // inside maybeFireLevelAmbientEvent so each fires roughly once per 20s.
    if (typeof _isGamePaused !== 'function' || !_isGamePaused()) {
      if (!_inCinematic && !player.inSafeZone) {
        _levelEventRollT = (_levelEventRollT || 0) - dt;
        if (_levelEventRollT <= 0) {
          _levelEventRollT = 8;
          if (Math.random() < 0.5) maybeFireLevelAmbientEvent();
        }
      }
    }

    // Conditional secret docs — low_san / discover_count types check every
    // frame here. Once a condition is satisfied for a stretch of time
    // (low_san needs ≥5 sec of held low SAN), the doc unlocks. discover_count
    // is one-shot.
    if (!_inCinematic && state === ST.PLAYING) {
      for (var sci = 0; sci < SECRET_DOCS.length; sci++) {
        var sdoc2 = SECRET_DOCS[sci];
        if (collectedSecretDocs[sdoc2.id]) continue;
        var acq2 = sdoc2.acquisition || {};
        if (acq2.type === 'low_san') {
          var sanPct2 = (player.san / player.sanMax) * 100;
          if (sanPct2 <= 25) {
            player._lowSanSecretT = (player._lowSanSecretT || 0) + dt;
            if (player._lowSanSecretT >= 5) discoverSecretDoc(sdoc2.id);
          } else {
            player._lowSanSecretT = 0;
          }
        } else if (acq2.type === 'discover_count') {
          var lifetimeCnt = Object.keys(lifetimeNoteTitles || {}).length;
          if (lifetimeCnt >= (acq2.count || 15)) discoverSecretDoc(sdoc2.id);
        }
      }
    }

    // Ambient micro-events — break the monotony of long traversals with
    // scripted sensory beats. Rolled at ~5s intervals, never within 25s of
    // the previous beat so they stay surprising. Skipped during cutscenes,
    // chase, safe-area, or while the phone/settings overlay is open.
    if (typeof _isGamePaused !== 'function' || !_isGamePaused()) {
      // Per-level signature ambient particles are now driven by the
      // bounded `particles[]` pool in updateParticles(dt) (richer kinds:
      // dust/ember/bubble/leaf/spore/ash, gravity + drift, gfxQuality
      // gate). The legacy LEVEL_AMBIENT_PARTICLES → GameEngine.addParticle
      // path was deleted to avoid spawning both systems in parallel.
      if (!_inCinematic && !player.inSafeZone && !player._beingChased) {
        _ambientEventRollT = (_ambientEventRollT || 0) - dt;
        if (_ambientEventRollT <= 0) {
          _ambientEventRollT = 5;
          var nowAmb = performance.now();
          var cdAmb = 25000; // 25s minimum between events
          if (!_lastAmbientEventAt || (nowAmb - _lastAmbientEventAt) > cdAmb) {
            // Probability scales with low SAN and time spent in this level
            var sanPct2 = (player.san / player.sanMax) * 100;
            var pBase = 0.10;
            if (sanPct2 < 50) pBase += 0.05;
            if (sanPct2 < 25) pBase += 0.10;
            if (inLevelTime > 60) pBase += 0.05;
            if (Math.random() < pBase) {
              fireAmbientMicroEvent();
              _lastAmbientEventAt = nowAmb;
            }
          }
        }
      }
    }

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
    // User grain pref scales the SAN-modulated grain. Cached to avoid
    // a per-frame localStorage read (~0.2ms on mobile Safari).
    if (!player._grainCache) player._grainCache = { tick: 0, val: 1.0 };
    player._grainCache.tick = (player._grainCache.tick + 1) | 0;
    if (player._grainCache.tick > 60) {
      player._grainCache.tick = 0;
      try { player._grainCache.val = parseInt(localStorage.getItem('bk_grain') || '100', 10) / 100; } catch (e) {}
    }
    var userGrainPct = player._grainCache.val;
    if (gfxQuality === 'low') {
      GameEngine.vignetteIntensity = 0.15 + (1 - sanRatio) * 0.15;
      GameEngine.chromaticLevel = 0;
      GameEngine.grainIntensity = 0.05 * userGrainPct;
    } else {
      GameEngine.vignetteIntensity = (theme.vignette || 0.3) + (1 - sanRatio) * 0.4 + harukiNear * 0.3;
      GameEngine.chromaticLevel = (theme.chromatic || 0) + (1 - sanRatio) * 0.4 + harukiNear * 0.4;
      GameEngine.grainIntensity = ((theme.grain || 0.3) + (1 - sanRatio) * 0.2 + harukiNear * 0.2) * userGrainPct;
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
      else if ((ce.type === 'boss' || ce.type === 'haruki_boss') && ceD < 6 * TS) isBeingChased = true;
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
        // Keep visible while an enemy line is currently being shown, then hide.
        if (player._enemyLineShownUntil && performance.now() < player._enemyLineShownUntil) {
          if (hLayer.style.display === 'none') hLayer.style.display = 'block';
        } else if (hLayer.style.display !== 'none') {
          hLayer.style.display = 'none';
        }
      }
    }

    // FPS indicator + auto-downgrade if sustained low FPS
    var fpsEl = el('fpsIndicator');
    if (fpsEl && fpsEl.style.display !== 'none' && GameEngine._fpsEma) {
      var fps = Math.round(GameEngine._fpsEma);
      fpsEl.textContent = fps + ' FPS';
      fpsEl.style.color = fps >= 55 ? '#88c050' : fps >= 35 ? '#d4b340' : '#ff6040';
    }
    // Auto-downgrade: if FPS < 25 sustained for 8s, force LOW quality.
    if (GameEngine._fpsEma && gfxQuality === 'high') {
      if (GameEngine._fpsEma < 25) {
        player._lowFpsAccum = (player._lowFpsAccum || 0) + 1 / 60;
        if (player._lowFpsAccum > 8) {
          gfxQuality = 'low';
          try { localStorage.setItem(GFX_KEY, 'low'); } catch (e) {}
          if (typeof applyGfxQuality === 'function') applyGfxQuality();
          toast('低 FPS 検出 — グラフィック品質を LOW に自動切替');
          player._lowFpsAccum = 0;
        }
      } else {
        player._lowFpsAccum = 0;
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
    // Enemy dialogue layer: occasional spoken/whispered line from nearest
    // pursuing entity. Uses the existing hallucText HUD so we don't have to
    // wire a new DOM element. Scales rate by proximity AND threat level.
    if (nearestThreat && nearestThreatDist < 8 * TS) {
      var ENEMY_LINES = {
        haruki:      ['…見つけた', 'もう、逃げないで', 'ずっと、待ってた', '一緒に降りよう', '振り向かないで',
                      'お前のことは知っている', 'ここで終わりにしよう'],
        haruki_boss: ['お前の魂をくれ', 'ここが最期', '私のもとへおいで', '逃げ場はない', 'お前の名を呼ぶ',
                      '— おかえり', '迎えに来た', 'もう、休んでもいい'],
        boss:        ['訪問者よ', 'お前の階層は終わった', 'ここまでだ', '最後の一歩を'],
        hound:       ['グルル……', 'ガアアッ', '— 唸り声 —', '匂いだ', '— 接近する獣 —'],
        skinstealer: ['お前の顔をくれ', '今度はお前だ', '同じ顔だ', 'これを、剥がしてくれ'],
        smiler:      ['にっこり', '見えるよ', '— 笑い声 —', 'こっち見て'],
        partygoer:   ['一緒に踊ろう', 'パーティーは終わらない', 'おかわりは?'],
        crawler:     ['— 這う音 —', 'カサ……カサ……', '見ちゃダメ'],
        wretch:      ['たすけ……', 'もう、戻れない', '記憶が無い'],
        echo:        ['— 反響 —', 'こだま、こだま', '昔の声'],
        faceling:    ['顔が、ない', '名前を呼んで', '— 静寂 —'],
        mrhotel:     ['チェックインです', 'お部屋へご案内', 'ベルは、もう鳴った']
      };
      player._enemyLineTimer = (player._enemyLineTimer || 0) - (1 / 60);
      if (player._enemyLineTimer <= 0) {
        var lineProx = Math.max(0, 1 - nearestThreatDist / (8 * TS));
        // 10s far → 3s very close, modulated by threat
        player._enemyLineTimer = 10 - lineProx * 7 - threatLevel * 0.5 + Math.random() * 2;
        var bank = ENEMY_LINES[nearestThreat.type] || ENEMY_LINES.crawler;
        var line = bank[Math.floor(Math.random() * bank.length)];
        var htxt = el('hallucText');
        if (htxt) {
          htxt.textContent = line;
          htxt.classList.remove('show');
          void htxt.offsetWidth;
          htxt.classList.add('show');
        }
        // Force the hallucination layer visible briefly so the line shows
        // even when the player's SAN is high.
        var hLayerNow = el('hallucinationLayer');
        if (hLayerNow) {
          hLayerNow.style.display = 'block';
          player._enemyLineShownUntil = performance.now() + 1400;
        }
        // Bosses also play a whisper cue when they speak
        if ((nearestThreat.type === 'haruki_boss' || nearestThreat.type === 'haruki' || nearestThreat.type === 'boss')
            && audioInitialized) {
          GameEngine.playSound('whisper');
        }
        // Uncanny TTS — low pitch, slow rate. Only for ハルキ系 / boss to
        // preserve their menace; other entities stay subtitle-only.
        if (nearestThreat.type === 'haruki_boss' || nearestThreat.type === 'haruki'
            || nearestThreat.type === 'boss' || nearestThreat.type === 'wretch') {
          _uncannySpeak(line);
        }
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
        // Brief "追跡中" banner so the player gets a visual cue paired
        // with the BGM swap.
        try { _flashChaseBanner(); } catch (e) {}
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
    first_no_clip:    { name: 'はじめての no-clip', icon: '↓',
                        desc: '初めて壁を抜けて階層を降りた。' },
    five_clears:      { name: '5 階層クリア', icon: '◆',
                        desc: '5 つの階層を踏破した。' },
    all_clears:       { name: '全階層踏破', icon: '★',
                        desc: '12 階層すべてを通過した。' },
    no_damage_lv:     { name: '無傷で1階層クリア', icon: '◇',
                        desc: 'HP 95% 以上を保ったまま1階層を抜けた。' },
    found_safe_zone:  { name: 'セーフエリア発見', icon: '◉',
                        desc: '黄色いセーフタイルを発見した。HP/SAN が回復する。' },
    won_minigame:     { name: 'ミニゲーム勝利', icon: '🎯',
                        desc: 'いずれかのミニゲームで勝利した。' },
    san_zero_survive: { name: 'SAN 10% で生還', icon: '☉',
                        desc: '正気を失う一歩手前で階層を抜けた。' },
    collect_10_notes: { name: 'ロア 10 件収集', icon: '≡',
                        desc: '通常の書類を 10 件以上収集した。' },
    inventory_full:   { name: 'インベントリ満載', icon: '▣',
                        desc: '6 種類以上のアイテムを同時所持した。' },
    true_end:         { name: 'ハルキを倒し、扉に到達', icon: '🚪',
                        desc: '最終ボスを倒して脱出扉に到達した。' },
    defeat_boss:      { name: 'BOSS 撃破', icon: '☠',
                        desc: 'いずれかのボスを撃破した。' },
    endless_5_floors: { name: 'ENDLESS 5階突破', icon: '∇',
                        desc: 'ENDLESS モードで 5 フロアを生存した。' },
    endless_score_500:{ name: 'ENDLESS スコア 500', icon: '⚆',
                        desc: 'ENDLESS モードでスコア 500 に到達した。' },
    play_chaos:       { name: 'CHAOS 難易度プレイ', icon: '⚠',
                        desc: 'CHAOS 難易度で 1 階層クリアした。' },
    use_all_weapons:  { name: '全武器使用', icon: '⚔',
                        desc: '全ての武器カテゴリを少なくとも1回使用した。' },
    speed_demon:      { name: 'Level 7 を 60s 以内', icon: '⚡',
                        desc: '追跡廊下を 60 秒以内に抜けた。' },
    collect_all_items:{ name: '全アイテム入手', icon: '◈',
                        desc: '全種類のアイテムを少なくとも1回拾った。' },
    silent_run:       { name: '無音 1階クリア', icon: '◐',
                        desc: 'アイテムを一度も使わず1階層クリア。' },
    survive_haruki:   { name: 'HARUKI を振り切る', icon: '🩸',
                        desc: 'Level 5 のホテルからハルキを振り切った。' },
    encounter_haruki: { name: 'HARUKI と遭遇', icon: '👁',
                        desc: '最初にハルキと視線が交わった。' },
    first_purchase:   { name: '初めての買い物', icon: '🪙',
                        desc: 'Lv11 のショップで何かを購入した。' },
    first_sale:       { name: '初めての売却', icon: '💰',
                        desc: '手持ちの品をショップで売却した。' },
    bought_unique:    { name: 'ユニーク品を購入', icon: '★',
                        desc: '★ ユニーク武器を買い取った。' },
    civilian_killed:  { name: '何かを失った', icon: '🩸',
                        desc: 'Lv11 の市民を手にかけた。SAN -25。' },
    found_secret_doc: { name: '最初の秘匿書類', icon: '✉',
                        desc: '九四四班に関する文書を最初に見つけた。' },
    all_secret_docs:  { name: '九四四班 — 全資料', icon: '✦',
                        desc: '14 件の秘匿書類すべてを収集した。' },
    true_secret_end:  { name: '真の脱出 — TRUE END', icon: '∞',
                        desc: '全秘匿書類を集めてハルキを倒し、真の出口へ。' },
    altar_pray:       { name: '祭壇に祈りを捧げた', icon: '🕯', hidden: true,
                        desc: 'Lv12+ の祭壇に祈り、隠し相手を呼び出した。' },
    hidden_boss_kill: { name: '隠しボス撃破 — 永遠の護符', icon: '♾', hidden: true,
                        desc: '祭壇から呼び出された存在を倒し、∞ 護符を得た。' }
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

  // Lifetime defeats — keyed by entity type, value = count.
  var DEFEATED_KEY = 'thebackrooms_defeated_entities_v1';
  var defeatedEntities = {};
  function loadDefeated() {
    try {
      var s = localStorage.getItem(DEFEATED_KEY);
      if (s) defeatedEntities = JSON.parse(s) || {};
    } catch (e) { defeatedEntities = {}; }
  }

  var SECRET_DOCS_KEY = 'thebackrooms_secret_docs_v1';
  function loadSecretDocs() {
    try {
      var s = localStorage.getItem(SECRET_DOCS_KEY);
      if (s) collectedSecretDocs = JSON.parse(s) || {};
    } catch (e) { collectedSecretDocs = {}; }
  }
  function saveSecretDocs() {
    try { localStorage.setItem(SECRET_DOCS_KEY, JSON.stringify(collectedSecretDocs)); } catch (e) {}
  }
  function discoverSecretDoc(docId) {
    if (collectedSecretDocs[docId]) return false; // already had it
    var doc = null;
    for (var i = 0; i < SECRET_DOCS.length; i++) {
      if (SECRET_DOCS[i].id === docId) { doc = SECRET_DOCS[i]; break; }
    }
    if (!doc) return false;
    collectedSecretDocs[docId] = true;
    saveSecretDocs();
    // Achievement: first secret doc + all docs collected
    try { unlockAchievement('found_secret_doc'); } catch (e) {}
    var total = SECRET_DOCS.length;
    var have  = Object.keys(collectedSecretDocs).length;
    if (have >= total) {
      try { unlockAchievement('all_secret_docs'); } catch (e) {}
    }
    // Show the doc the same way regular notes are shown so the player reads it.
    // 重厚 mode renders the panel with serif font + amber tint so secret docs
    // feel distinct from regular lore notes.
    showNoteViewer(doc.title, doc.text, { weight: 'heavy' });
    if (audioInitialized) {
      try { GameEngine.playSound('paper'); } catch (e) {}
      // Double-layer paper SE — page-turn effect, sells the gravity.
      setTimeout(function () { try { GameEngine.playSound('paper'); } catch (e) {} }, 200);
    }
    return true;
  }
  function hasAllSecretDocs() {
    return Object.keys(collectedSecretDocs).length >= SECRET_DOCS.length;
  }
  // Expose for renderTitleArchive and TRUE END check
  window.SECRET_DOCS = SECRET_DOCS;
  window.collectedSecretDocs = collectedSecretDocs;
  window.hasAllSecretDocs = hasAllSecretDocs;

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
    applyHalfRespawnIfDied();
    player.inventory = {};
    if (hasEternalCharm()) player.inventory.eternal_charm = 1;
    player.flashlightOn = false;
    player.flashlightBattery = 0;
    player.radioOn = false;
    player.compassOn = false;
    player.equippedWeapon = null;
    player._wallClipPending = false;
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
    // Match the campaign level set so endless rotates through every level
    // the player has access to. Previously missed Lv13/14/15.
    var allLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 9];
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
    var prev = currentDifficulty;
    if (!DIFFICULTIES[id]) return;
    currentDifficulty = id;
    localStorage.setItem(DIFF_KEY, id);
    toast('難易度: ' + DIFFICULTIES[id].name);
    updateChaosLayer();
    // CHAOS difficulty gets a Resident-Evil-style stinger when first selected:
    // multi-track red flash + thunder + jumpscare + shake.
    if (id === 'chaos' && prev !== 'chaos') {
      try { GameEngine.redFlash(); } catch (e) {}
      try { GameEngine.shakeScreen(30, 1.0); } catch (e) {}
      if (audioInitialized) {
        try { GameEngine.playSound('thunder'); } catch (e) {}
        setTimeout(function () {
          try { GameEngine.playSound('jumpscare'); } catch (e) {}
        }, 120);
        setTimeout(function () {
          try { GameEngine.playSound('breath_drone'); } catch (e) {}
        }, 380);
      }
      if (navigator.vibrate) try { navigator.vibrate([60, 30, 120]); } catch (e) {}
    }
  }

  // CHAOS difficulty owns its own red full-screen overlay (chaosLayer):
  // visible only while the player is in active gameplay AND the difficulty is
  // 'chaos'. Hidden on title / settings / endings.
  function updateChaosLayer() {
    var layer = el('chaosLayer');
    if (!layer) return;
    var inPlay = (state === ST.PLAYING);
    var on = inPlay && currentDifficulty === 'chaos';
    layer.style.display = on ? 'block' : 'none';
  }
  window.updateChaosLayer = updateChaosLayer;

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
  // Per-level POOLS (was single id) — when a safe zone is touched we pick
  // a deterministic minigame from the level's pool keyed on the safe-zone
  // grid coords + per-run seed, so different safe zones in the same level
  // give different games and replays vary too. Fixes user report
  // 「同じミニゲームが何回も」.
  var LEVEL_MINIGAME_POOLS = {
    0:  ['vending', 'lockpick', 'reflex'],
    1:  ['lockpick', 'dial', 'memory'],
    2:  ['reflex', 'whackamole', 'snake'],
    4:  ['dial', 'cipher', 'memory'],
    5:  ['memory', 'pong', 'cipher'],
    7:  ['whackamole', 'reflex', 'snake'],
    8:  ['snake', 'pong', 'lockpick'],
    9:  ['cipher', 'memory', 'dial'],
    11: ['vending', 'memory', 'dial'],   // office district added
    12: ['pong', 'reflex', 'whackamole'],
    13: ['dial', 'cipher', 'memory'],
    14: ['reflex', 'pong', 'snake'],
    15: ['whackamole', 'lockpick', 'reflex']
  };
  // Persisted "minigame played" set — survives across runs so the same
  // safe zone can only be played ONCE EVER per user request:
  // 「プレイできる箇所がある。1回のみにする」.
  var MG_PLAYED_KEY = 'thebackrooms_mg_played_v1';
  function _loadMgPlayed() {
    try {
      var raw = localStorage.getItem(MG_PLAYED_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }
  function _saveMgPlayed() {
    try { localStorage.setItem(MG_PLAYED_KEY, JSON.stringify(mgPlayedPersistent)); } catch (e) {}
  }
  var mgPlayedPersistent = _loadMgPlayed();
  // Deterministic minigame chooser — same safe zone → same minigame, but
  // different safe zones → different minigames.
  function _pickMinigameForSafeZone(levelId, gx, gy) {
    var pool = LEVEL_MINIGAME_POOLS[levelId];
    if (!pool || !pool.length) return null;
    var h = ((levelId * 73856093) ^ (gx * 19349663) ^ (gy * 83492791)) >>> 0;
    return pool[h % pool.length];
  }

  // Mini-game definitions
  var MINI_GAMES = {

    // ── VENDING MACHINE ──
    vending: {
      title: '自動販売機',
      subtitle: 'タップしてリールを回転 → 3 個のアイテム獲得',
      // Adds weapons as rare drops so mini-games feel rewarding.
      itemPool: ['almond_water', 'bandage', 'energy_bar', 'flashlight',
                 'pistol', 'pistol', 'shotgun', 'katana', 'revolver'],
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
        // After reels finish, the action button changes to 終了 and tap
        // should close the minigame. Previously the early-return killed
        // that path so the player was stuck on the spin screen until
        // they manually re-tapped the X.
        if (mgState.phase === 'done') { closeMiniGame(); return; }
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
          // Award items. User request 2026-06-07: 「レベル一のリールはでた
          // アイテムがそのままもらえる」 — weapon rolls give a stacked count
          // matching their real pickup range instead of +1 per reel:
          //   pistol   → 7-11 per reel
          //   shotgun  → 2-4
          //   revolver → 1-3
          //   katana   → 4-7 (matches WEAPON_AMMO_PICKUP)
          //   other consumables stay +1
          var VENDING_RANGES = {
            pistol:   [7, 11],
            shotgun:  [2, 4],
            revolver: [1, 3],
            katana:   [4, 7]
          };
          var wonItems = [];
          for (var j = 0; j < 3; j++) {
            var itemId = MINI_GAMES.vending.itemPool[mgState.reels[j]];
            var rng = VENDING_RANGES[itemId];
            var addAmt = rng
              ? Math.floor(rng[0] + Math.random() * (rng[1] - rng[0] + 1))
              : 1;
            player.inventory[itemId] = (player.inventory[itemId] || 0) + addAmt;
            wonItems.push(ITEMS[itemId].name + (addAmt > 1 ? ' ×' + addAmt : ''));
            try { recordItemSeen(itemId); } catch (e) {}
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
        // Close on win/lose — previously the early-return blocked the
        // 終了 button after game end.
        if (mgState.phase === 'win' || mgState.phase === 'lose') {
          closeMiniGame(); return;
        }
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
      icons: ['🥤', '🩹', '🍫', '🔦', '🔑', '📻', '🔥', '🪞'],
      init: function () {
        // Harder: 6 pairs (12 cards), tighter attempt budget.
        var pool = MINI_GAMES.memory.icons.slice(0, 6); // 6 pairs
        var cards = pool.concat(pool); // 12 cards
        for (var i = cards.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
        }
        var revealed = [];
        for (var ri = 0; ri < cards.length; ri++) revealed.push(false);
        mgState = {
          cards: cards,
          revealed: revealed,
          flipped: [],
          matchedCount: 0,
          attempts: 0,
          maxAttempts: 14,
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
        var cols = 4, rows = 3;
        var gridY = 50;
        var gridH = h - 100;
        var cardW = (w - 40) / cols;
        var cardH = gridH / rows;
        // BUG FIX 2026-06-07: previously iterated `i < 8` so the bottom
        // row (cards 8..11) was visually drawn but untappable.
        // User report: 「カード合わせでタップできない箇所がある」.
        for (var i = 0; i < mgState.cards.length; i++) {
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
                if (mgState.matchedCount >= 6) {
                  mgState.phase = 'win';
                  setMGStatus('クリア! 試行 ' + mgState.attempts + ' 回');
                  // Reward: random useful item
                  var rewardId = ['pistol', 'shotgun', 'katana', 'flare'][Math.floor(Math.random() * 4)];
                  player.inventory[rewardId] = (player.inventory[rewardId] || 0) + 2;
                  toast('★ ' + ITEMS[rewardId].name + ' ×2 入手');
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
        var cols = 4, rows = 3;
        var gridY = 50;
        var gridH = h - 100;
        var cardW = (w - 40) / cols;
        var cardH = gridH / rows;
        for (var i = 0; i < mgState.cards.length; i++) {
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
      subtitle: 'スタートを押すと開始。ドットを5個食べると勝利 — タップで方向転換',
      init: function () {
        mgState = {
          phase: 'ready',
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
        setMGAction('スタート', 'green');
        setMGStatus('スタートを押して開始');
      },
      action: function () {
        if (mgState.phase === 'ready') {
          mgState.phase = 'play';
          setMGAction('閉じる', 'gray');
          setMGStatus('0 / 5');
          if (audioInitialized) try { GameEngine.playSound('ui_tap'); } catch (e) {}
          return;
        }
        closeMiniGame();
      },
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
            // Tiered reward pool. ~12% chance of a UNIQUE prize, otherwise a
            // standard weapon / consumable. Uniques are rare and powerful.
            var uniques = ['soul_lantern', 'haruki_charm', 'architect_blade',
                           'siren_whistle', 'mirror_shard', 'revenant_blade', 'void_grenade'];
            var commons = ['katana', 'pistol', 'flare', 'shotgun', 'revolver', 'almond_milk'];
            var rwd = (Math.random() < 0.12)
              ? uniques[Math.floor(Math.random() * uniques.length)]
              : commons[Math.floor(Math.random() * commons.length)];
            player.inventory[rwd] = (player.inventory[rwd] || 0) + 1;
            recordItemSeen(rwd);
            toast('★ ' + ITEMS[rwd].name + ' を入手');
            unlockAchievement('won_minigame');
            if (audioInitialized) {
              GameEngine.playSound('level_clear');
              if (uniques.indexOf(rwd) >= 0) GameEngine.playSound('stinger');
            }
            // Animated unique-reward flash overlay
            if (uniques.indexOf(rwd) >= 0 && typeof showUniqueRewardFlash === 'function') {
              showUniqueRewardFlash(rwd);
            }
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
                var rewards = ['revolver', 'katana', 'almond_milk', 'shotgun', 'mirror'];
                var rwd = rewards[Math.floor(Math.random() * rewards.length)];
                player.inventory[rwd] = (player.inventory[rwd] || 0) + 1;
                toast('★ ' + ITEMS[rwd].name + ' を入手');
                unlockAchievement('won_minigame');
                if (audioInitialized) GameEngine.playSound('level_clear');
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
        // AI movement — weakened per user request:
        //  * Only actively tracks when the ball is on the AI's half
        //    AND moving toward it (otherwise drifts toward center)
        //  * Tracking speed reduced 0.75 → 0.40
        //  * Small persistent positional error so it sometimes misjudges
        if (mgState._aiErr === undefined) mgState._aiErr = 0;
        // Slowly drift the error so the AI looks like a flawed opponent
        mgState._aiErr += (Math.random() - 0.5) * dt * 0.6;
        mgState._aiErr = clamp(mgState._aiErr, -0.10, 0.10);
        var aiActive = (mgState.ballX > 0.45 && mgState.ballVX > 0);
        var aiTarget = aiActive ? (mgState.ballY + mgState._aiErr) : 0.5;
        var aiDiff = aiTarget - mgState.aiY;
        var aiSpeed = aiActive ? 0.40 : 0.20;
        mgState.aiY += Math.sign(aiDiff) * Math.min(Math.abs(aiDiff), aiSpeed * dt);
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
    },

    // ── REFLEX (反射神経) ──
    // A target oscillates across a band; player must tap when it overlaps
    // the centre marker. 5 successful taps wins. Speed ramps up.
    reflex: {
      title: '反射神経',
      subtitle: 'マーカーを真ん中で捉えろ × 5',
      init: function () {
        mgState = {
          phase: 'play', pos: 0, dir: 1, speed: 0.45,
          hits: 0, misses: 0, goal: 5, cooldown: 0
        };
        setMGAction('終了', 'red');
        setMGStatus('0 / 5  ハート連打で挑戦');
      },
      action: function () { closeMiniGame(); },
      onTap: function () {
        if (mgState.phase !== 'play') return;
        if (mgState.cooldown > 0) return;
        // Centre tolerance window
        if (Math.abs(mgState.pos - 0.5) < 0.06) {
          mgState.hits++;
          mgState.speed += 0.08;
          if (audioInitialized) GameEngine.playSound('item_get');
        } else {
          mgState.misses++;
          if (audioInitialized) GameEngine.playSound('door');
          // Two whiffs = fail
          if (mgState.misses >= 2) {
            mgState.phase = 'lose';
            setMGStatus('失敗');
            setMGAction('終了', 'red');
            return;
          }
        }
        mgState.cooldown = 0.25;
        if (mgState.hits >= mgState.goal) {
          mgState.phase = 'win';
          setMGStatus('クリア! ユニーク報酬抽選');
          setMGAction('終了', 'green');
          var poolR = ['siren_whistle', 'mirror_shard', 'revenant_blade'];
          var rwdR = poolR[Math.floor(Math.random() * poolR.length)];
          player.inventory[rwdR] = (player.inventory[rwdR] || 0) + 1;
          recordItemSeen(rwdR);
          toast('★ ' + ITEMS[rwdR].name + ' 入手');
          unlockAchievement('won_minigame');
          if (audioInitialized) { GameEngine.playSound('level_clear'); GameEngine.playSound('stinger'); }
          if (typeof showUniqueRewardFlash === 'function') showUniqueRewardFlash(rwdR);
        } else {
          setMGStatus(mgState.hits + ' / ' + mgState.goal);
        }
      },
      update: function (dt) {
        if (mgState.phase !== 'play') return;
        mgState.cooldown = Math.max(0, mgState.cooldown - dt);
        mgState.pos += mgState.dir * mgState.speed * dt;
        if (mgState.pos > 1) { mgState.pos = 1; mgState.dir = -1; }
        if (mgState.pos < 0) { mgState.pos = 0; mgState.dir = 1; }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#080604';
        ctx.fillRect(0, 0, w, h);
        // Band
        ctx.fillStyle = '#382a08';
        ctx.fillRect(0.05 * w, h / 2 - 6, 0.9 * w, 12);
        // Centre marker
        ctx.fillStyle = '#88b033';
        ctx.fillRect(w * 0.5 - 0.05 * w, h / 2 - 14, 0.1 * w, 28);
        // Target
        var tx = (0.05 + 0.9 * mgState.pos) * w;
        ctx.fillStyle = mgState.cooldown > 0 ? '#888' : '#d4b340';
        ctx.beginPath();
        ctx.arc(tx, h / 2, 14, 0, Math.PI * 2);
        ctx.fill();
        // Hit counter dots
        for (var rd = 0; rd < mgState.goal; rd++) {
          ctx.fillStyle = rd < mgState.hits ? '#88b033' : '#382a08';
          ctx.beginPath();
          ctx.arc(0.1 * w + rd * 0.14 * w, h - 30, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },

    // ── DIAL LOCK (ダイヤルロック) ──
    // Three dials; tap to advance the highlighted dial, "action" locks it
    // and moves to the next. Player must reach a hidden target sequence.
    dial: {
      title: 'ダイヤルロック',
      subtitle: '3桁の暗号を当てろ。HIT は位置一致、NEAR は数字一致。',
      init: function () {
        var target = [Math.floor(Math.random() * 10),
                      Math.floor(Math.random() * 10),
                      Math.floor(Math.random() * 10)];
        // Difficulty bumped down per user feedback 2026-06-07
        // 「ダイヤルロックは難しすぎないか？」
        //   - Max tries 6 → 10
        //   - Feedback now splits HIT (correct digit & position) and
        //     NEAR (correct digit, wrong position) — Mastermind style
        //     so deductive play actually narrows the answer.
        //   - First-guess freebie: one random digit pre-revealed in
        //     the status line so the player can anchor a strategy.
        var hintPos = Math.floor(Math.random() * 3);
        mgState = {
          phase: 'play',
          target: target,
          dials: [0, 0, 0],
          active: 0,
          tries: 0,
          maxTries: 10,
          hintPos: hintPos,
          hintDigit: target[hintPos]
        };
        setMGAction('決定', 'green');
        setMGStatus('ヒント: ' + (hintPos + 1) + '桁目は ' + target[hintPos] + '  /  1桁目を選択 → 決定');
      },
      action: function () {
        if (mgState.phase === 'win' || mgState.phase === 'lose') {
          closeMiniGame(); return;
        }
        if (mgState.phase !== 'play') return;
        if (mgState.active < 2) {
          mgState.active++;
          setMGStatus((mgState.active + 1) + '桁目を選択 → 決定');
          if (audioInitialized) GameEngine.playSound('clock_tick');
          return;
        }
        // Final dial — evaluate (Mastermind-style HIT + NEAR)
        mgState.tries++;
        var hits = 0, near = 0;
        var usedT = [false, false, false];
        var usedG = [false, false, false];
        for (var d = 0; d < 3; d++) {
          if (mgState.dials[d] === mgState.target[d]) {
            hits++;
            usedT[d] = true; usedG[d] = true;
          }
        }
        for (var dg = 0; dg < 3; dg++) {
          if (usedG[dg]) continue;
          for (var dt = 0; dt < 3; dt++) {
            if (usedT[dt]) continue;
            if (mgState.dials[dg] === mgState.target[dt]) {
              near++; usedT[dt] = true; break;
            }
          }
        }
        if (hits === 3) {
          mgState.phase = 'win';
          setMGStatus('解錠! ユニーク報酬');
          setMGAction('終了', 'green');
          var poolD = ['void_grenade', 'architect_blade', 'soul_lantern', 'haruki_charm'];
          var rwdD = poolD[Math.floor(Math.random() * poolD.length)];
          player.inventory[rwdD] = (player.inventory[rwdD] || 0) + 1;
          recordItemSeen(rwdD);
          toast('★ ' + ITEMS[rwdD].name + ' 入手');
          unlockAchievement('won_minigame');
          if (audioInitialized) { GameEngine.playSound('key_unlock'); GameEngine.playSound('stinger'); }
          if (typeof showUniqueRewardFlash === 'function') showUniqueRewardFlash(rwdD);
        } else if (mgState.tries >= mgState.maxTries) {
          mgState.phase = 'lose';
          setMGStatus('失敗 (正解: ' + mgState.target.join('') + ')');
          setMGAction('終了', 'red');
        } else {
          // Reset to dial 0, show HIT + NEAR breakdown
          mgState.active = 0;
          setMGStatus('HIT ' + hits + ' / NEAR ' + near + '   残り ' + (mgState.maxTries - mgState.tries));
          if (audioInitialized) GameEngine.playSound('door');
        }
      },
      onTap: function () {
        if (mgState.phase !== 'play') return;
        mgState.dials[mgState.active] = (mgState.dials[mgState.active] + 1) % 10;
        if (audioInitialized) GameEngine.playSound('clock_tick');
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#080604';
        ctx.fillRect(0, 0, w, h);
        var dialW = w * 0.22, dialH = h * 0.5;
        var gap = (w - dialW * 3) / 4;
        for (var di = 0; di < 3; di++) {
          var x = gap + di * (dialW + gap);
          var y = h * 0.18;
          ctx.strokeStyle = di === mgState.active ? '#d4b340' : '#382a08';
          ctx.lineWidth = di === mgState.active ? 4 : 2;
          ctx.strokeRect(x, y, dialW, dialH);
          ctx.fillStyle = di === mgState.active ? '#d4b340' : '#786020';
          ctx.font = 'bold ' + Math.floor(dialH * 0.6) + 'px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(mgState.dials[di]), x + dialW / 2, y + dialH / 2);
        }
        ctx.fillStyle = '#786020';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TAP: 数字を進める / 決定: 次の桁へ', w / 2, h - 14);
      }
    },

    // ── WHACK-A-MOLE (もぐら叩き) ──
    // Tap appearing entity icons before they disappear. Reach the goal count.
    whackamole: {
      title: 'もぐら叩き',
      subtitle: '出現する敵を素早く叩け × 10',
      init: function () {
        mgState = {
          phase: 'play',
          targets: [],          // {x, y, life, max}
          spawnTimer: 0,
          spawnEvery: 0.7,
          hits: 0,
          misses: 0,
          goal: 10,
          maxMisses: 4,
          elapsed: 0
        };
        setMGAction('終了', 'red');
        setMGStatus('0 / 10');
      },
      action: function () { closeMiniGame(); },
      onTap: function (cx, cy, w, h) {
        if (mgState.phase !== 'play') return;
        for (var ti = mgState.targets.length - 1; ti >= 0; ti--) {
          var t = mgState.targets[ti];
          var dx = cx - t.x * w, dy = cy - t.y * h;
          if (Math.sqrt(dx * dx + dy * dy) < 28) {
            mgState.targets.splice(ti, 1);
            mgState.hits++;
            if (audioInitialized) GameEngine.playSound('hit');
            if (mgState.hits >= mgState.goal) {
              mgState.phase = 'win';
              setMGStatus('クリア! ユニーク報酬');
              setMGAction('終了', 'green');
              var poolW = ['siren_whistle', 'soul_lantern', 'revenant_blade',
                           'mirror_shard', 'void_grenade'];
              var rwdW = poolW[Math.floor(Math.random() * poolW.length)];
              player.inventory[rwdW] = (player.inventory[rwdW] || 0) + 1;
              recordItemSeen(rwdW);
              toast('★ ' + ITEMS[rwdW].name + ' 入手');
              unlockAchievement('won_minigame');
              if (audioInitialized) { GameEngine.playSound('level_clear'); GameEngine.playSound('stinger'); }
              if (typeof showUniqueRewardFlash === 'function') showUniqueRewardFlash(rwdW);
            } else {
              setMGStatus(mgState.hits + ' / ' + mgState.goal);
            }
            return;
          }
        }
      },
      update: function (dt) {
        if (mgState.phase !== 'play') return;
        mgState.elapsed += dt;
        mgState.spawnTimer -= dt;
        if (mgState.spawnTimer <= 0) {
          mgState.spawnTimer = Math.max(0.25, mgState.spawnEvery - mgState.elapsed * 0.03);
          mgState.targets.push({
            x: 0.1 + Math.random() * 0.8,
            y: 0.2 + Math.random() * 0.6,
            life: 1.4, max: 1.4
          });
        }
        // Decay & cull
        for (var ui = mgState.targets.length - 1; ui >= 0; ui--) {
          mgState.targets[ui].life -= dt;
          if (mgState.targets[ui].life <= 0) {
            mgState.targets.splice(ui, 1);
            mgState.misses++;
            if (mgState.misses >= mgState.maxMisses) {
              mgState.phase = 'lose';
              setMGStatus('失敗 (見逃しすぎ)');
              setMGAction('終了', 'red');
              return;
            }
          }
        }
      },
      draw: function (ctx, w, h) {
        ctx.fillStyle = '#080604';
        ctx.fillRect(0, 0, w, h);
        for (var di = 0; di < mgState.targets.length; di++) {
          var t = mgState.targets[di];
          var a = Math.max(0.1, t.life / t.max);
          ctx.fillStyle = 'rgba(220, 60, 60,' + a + ')';
          ctx.beginPath();
          ctx.arc(t.x * w, t.y * h, 22, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 255, 200,' + a + ')';
          ctx.font = 'bold 18px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', t.x * w, t.y * h);
        }
        ctx.fillStyle = '#786020';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('HIT ' + mgState.hits + ' / ' + mgState.goal +
                     '   MISS ' + mgState.misses + ' / ' + mgState.maxMisses, 10, 18);
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

  // Update the on-screen D-pad HUD (mode + 4 slots).
  // Without a gamepad the HUD doubles as a tap quick-bar: it's lifted higher
  // on screen (touch-mode class), each slot fires quickUseAssignedItem on
  // tap, and the mode label toggles items/weapons on tap.
  function updateDpadHud() {
    var hud = el('dpadHud');
    if (!hud) return;
    if (state !== ST.PLAYING) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = 'block';
    var touchMode = !gamepadConnected;
    hud.classList.toggle('touch-mode', touchMode);
    var modeEl = el('dpadHudMode');
    if (modeEl) modeEl.textContent = dpadMode === 'weapon' ? '武器' : 'アイテム';
    var hintEl = hud.querySelector('.hud-dpad-hint');
    if (hintEl) hintEl.textContent = touchMode ? 'タップで使用 / モードはタップ切替' : 'L1: モード切替 / R1: 武器使用';
    var slots = dpadAssignments[dpadMode] || {};
    var dirIds = ['Up', 'Down', 'Left', 'Right'];
    for (var i = 0; i < dirIds.length; i++) {
      var slotEl = el('dpadSlot' + dirIds[i]);
      if (!slotEl) continue;
      var id = slots[dirIds[i].toLowerCase()];
      if (id && ITEMS[id]) {
        var count = player.inventory[id] || 0;
        // Eternal charm makes every slot read as ∞ — the count is meaningless
        // because nothing actually decrements.
        var displayCount = hasEternalCharm() ? '∞' : ('×' + count);
        // Use the realistic SVG icon for weapons when available, else
        // fall back to the emoji string.
        var dpadIconHtml = WEAPON_SVG[id]
          ? '<span class="dpad-slot-icon dpad-slot-svg">' + WEAPON_SVG[id] + '</span>'
          : '<span class="dpad-slot-icon">' + ITEMS[id].icon + '</span>';
        slotEl.innerHTML = dpadIconHtml +
                           '<span class="dpad-slot-count' + (count === 0 && !hasEternalCharm() ? ' out' : '') + '">'
                           + displayCount + '</span>';
        slotEl.classList.remove('empty');
        // Highlight the slot that's currently equipped so the player can
        // see at-a-glance which weapon will fire when they tap the blue
        // attack button.
        slotEl.classList.toggle('equipped', player.equippedWeapon === id);
        slotEl.title = ITEMS[id].name +
                       (count > 0 ? ' ×' + count : ' (未所持)') +
                       (player.equippedWeapon === id ? ' [装備中]' : '');
      } else {
        slotEl.innerHTML = '';
        slotEl.classList.add('empty');
        slotEl.classList.remove('equipped');
        slotEl.title = '未割当';
      }
    }
    // Bind tap handlers once. Slots use stored direction string so we can use
    // the same updateDpadHud refresh each frame without re-binding.
    if (!hud._tapBound) {
      hud._tapBound = true;
      ['Up','Down','Left','Right'].forEach(function (d) {
        var s = el('dpadSlot' + d);
        if (!s) return;
        s.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state !== ST.PLAYING) return;
          var aid = (dpadAssignments[dpadMode] || {})[d.toLowerCase()];
          if (!aid) return;
          // 武器モード = 装備のみ。アイテムモード = 直接使用。
          if (dpadMode === 'weapon' && ITEMS[aid] && ITEMS[aid].category === 'weapon') {
            equipWeapon(aid);
          } else {
            quickUseAssignedItem(aid);
          }
        });
      });
      if (modeEl) {
        modeEl.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state !== ST.PLAYING) return;
          dpadMode = dpadMode === 'weapon' ? 'item' : 'weapon';
          try { localStorage.setItem('bk_dpad_mode_v1', dpadMode); } catch (er) {}
          updateDpadHud();
          if (audioInitialized) GameEngine.playSound('ui_tap');
        });
        modeEl.style.cursor = 'pointer';
      }
    }
  }

  // D-pad quick-use: skip the confirm modal and use directly
  function quickUseAssignedItem(itemId) {
    if (!itemId || !ITEMS[itemId]) return;
    if (state !== ST.PLAYING || phoneOpen || miniGameOpen) return;
    var it = ITEMS[itemId];
    var hasKey = Object.prototype.hasOwnProperty.call(player.inventory, itemId);
    var count = player.inventory[itemId] || 0;
    var charmOn = hasEternalCharm();
    if (!hasKey && !charmOn) {
      toast(it.name + ': 未所持');
      return;
    }
    // Wave YY: weapons stay in inventory at ×0 after depletion. quickUse should
    // tell the player the weapon is empty (not missing) so the binding feels
    // intentional, not broken. Eternal charm bypasses both checks.
    if (!charmOn && it.category === 'weapon' && count <= 0) {
      // Play the matching empty SE (gun click / blade snap / glass crack)
      // so the player gets audio confirmation even on the quick-use path.
      if (audioInitialized) {
        var QUICK_GUNS = { pistol:1, shotgun:1, revolver:1, void_grenade:1, flare:1 };
        var QUICK_BLADES = { katana:1, architect_blade:1, revenant_blade:1 };
        var QUICK_MIRRORS = { mirror:1, mirror_shard:1 };
        try {
          if (QUICK_GUNS[itemId])         GameEngine.playSound('empty_click');
          else if (QUICK_BLADES[itemId])  GameEngine.playSound('weapon_snap');
          else if (QUICK_MIRRORS[itemId]) GameEngine.playSound('glass_rattle');
          else                            GameEngine.playSound('empty_click');
        } catch (e) {}
      }
      var quickLabel = ({pistol:1,shotgun:1,revolver:1,void_grenade:1,flare:1})[itemId] ? '弾切れ'
                     : ({katana:1,architect_blade:1,revenant_blade:1})[itemId] ? '折れた'
                     : ({mirror:1,mirror_shard:1})[itemId] ? '砕けた' : '使用不可';
      toast(it.name + ': ' + quickLabel + ' (×0)');
      return;
    }
    if (!charmOn && count <= 0) {
      toast(it.name + ': 残数なし');
      return;
    }
    _pendingItemId = itemId;
    confirmItemUse();
  }

  // Item use custom modal
  var _pendingItemId = null;
  function openItemUseModal(itemId) {
    var it = ITEMS[itemId];
    if (!it) return;
    _pendingItemId = itemId;
    // Use SVG silhouette for weapons (the modal is large — emoji would
    // look like a sticker against the dark backdrop), fall back to emoji
    // for consumables.
    var iuIcEl = el('itemUseIcon');
    if (iuIcEl) {
      if (WEAPON_SVG[itemId]) {
        iuIcEl.innerHTML = '<span class="iu-icon-svg">' + WEAPON_SVG[itemId] + '</span>';
      } else {
        iuIcEl.textContent = it.icon;
      }
    }
    el('itemUseName').textContent = it.name;
    el('itemUseDesc').textContent = it.desc;
    // 装備する button only shown for weapons; also dims if already equipped.
    var equipBtn = el('itemUseEquipBtn');
    if (equipBtn) {
      if (it.category === 'weapon') {
        equipBtn.style.display = '';
        if (player.equippedWeapon === itemId) {
          equipBtn.textContent = '装備中';
          equipBtn.disabled = true;
        } else {
          equipBtn.textContent = '装備する';
          equipBtn.disabled = false;
        }
      } else {
        equipBtn.style.display = 'none';
      }
    }
    refreshIuAssignUI();
    showOverlay('itemUseModal');
  }

  // Update the assign-grid in the item-use modal to reflect which directions
  // (if any) the current item is bound to in the active dpad mode.
  function refreshIuAssignUI() {
    var hint = el('iuAssignHint');
    var dirs = ['up', 'down', 'left', 'right'];
    var mode = (_pendingItemId && ITEMS[_pendingItemId] && ITEMS[_pendingItemId].category === 'weapon')
      ? 'weapon' : 'item';
    var bound = [];
    var slots = dpadAssignments[mode] || {};
    dirs.forEach(function (d) {
      var btn = document.querySelector('.iu-assign-btn.iu-' + d);
      if (!btn) return;
      var isBound = slots[d] === _pendingItemId;
      btn.classList.toggle('bound', isBound);
      if (isBound) bound.push({ up: '↑', down: '↓', left: '←', right: '→' }[d]);
    });
    if (hint) {
      var modeLabel = mode === 'weapon' ? '武器モード' : 'アイテムモード';
      hint.textContent = bound.length
        ? '— ' + modeLabel + ': ' + bound.join(' / ')
        : '— ' + modeLabel + ': 未割当';
    }
  }

  // Bind the current modal item to a dpad direction (or clear all). Persists
  // immediately so the change is picked up by updateDpadHud next frame.
  function bindIuAssign(dir) {
    if (!_pendingItemId) return;
    var it = ITEMS[_pendingItemId];
    if (!it) return;
    var mode = (it.category === 'weapon') ? 'weapon' : 'item';
    if (!dpadAssignments[mode]) dpadAssignments[mode] = { up: '', down: '', left: '', right: '' };
    if (dir === 'clear') {
      // Remove this item from all 4 dpad slots in its mode
      ['up','down','left','right'].forEach(function (d) {
        if (dpadAssignments[mode][d] === _pendingItemId) dpadAssignments[mode][d] = '';
      });
      toast('割当を解除');
    } else {
      // Replace whatever was there with this item
      dpadAssignments[mode][dir] = _pendingItemId;
      var arrow = { up: '↑', down: '↓', left: '←', right: '→' }[dir];
      toast(it.name + ' を ' + arrow + ' に割当');
    }
    try {
      localStorage.setItem('bk_dpad_assignments_v1', JSON.stringify(dpadAssignments));
    } catch (e) {}
    if (audioInitialized) try { GameEngine.playSound('ui_tap'); } catch (e) {}
    refreshIuAssignUI();
    updateDpadHud();
  }
  window.bindIuAssign = bindIuAssign;
  function closeItemUseModal() {
    _pendingItemId = null;
    hideOverlay('itemUseModal');
  }
  function confirmItemUse() {
    if (!_pendingItemId) return;
    var itemId = _pendingItemId;
    var it = ITEMS[itemId];
    if (!it) { closeItemUseModal(); return; }
    // 0-ammo weapons can't be fired. Modal stays open so the player can pick
    // a different action (or close manually). Play a category-appropriate
    // SE (user request: 「弾切れの時は相応の音を出す。刀系も折れた音
    // などを出す」).
    if (it.category === 'weapon' && (player.inventory[itemId] || 0) <= 0) {
      var GUNS = { pistol:1, shotgun:1, revolver:1, void_grenade:1, flare:1 };
      var BLADES = { katana:1, architect_blade:1, revenant_blade:1 };
      var MIRRORS = { mirror:1, mirror_shard:1 };
      if (audioInitialized) {
        try {
          if (GUNS[itemId])         GameEngine.playSound('empty_click');
          else if (BLADES[itemId])  GameEngine.playSound('weapon_snap');
          else if (MIRRORS[itemId]) GameEngine.playSound('glass_rattle');
          else                       GameEngine.playSound('empty_click');
        } catch (e) {}
      }
      var label = GUNS[itemId] ? '弾切れ' : BLADES[itemId] ? '折れた' :
                  MIRRORS[itemId] ? '砕けた' : '使用不可';
      toast(it.name + ': ' + label + ' (×0)');
      return;
    }
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
        if (entities[mi].type !== 'skinstealer' && entities[mi].type !== 'boss' && entities[mi].type !== 'haruki_boss') continue;
        var mdx = entities[mi].x - player.x, mdy = entities[mi].y - player.y;
        if (Math.sqrt(mdx * mdx + mdy * mdy) < 8 * TS) { hasTarget = true; break; }
      }
      if (!hasTarget) {
        toast('鏡: 対象がいない (Skin-Stealer / Boss 8マス以内)');
        closeItemUseModal();
        return;
      }
    }
    // Item use SE — per-item useSound played alongside the effect so the
    // player gets audible feedback distinct from the generic item_get pickup.
    if (it.useSound && audioInitialized) {
      try { GameEngine.playSound(it.useSound); } catch (e) {}
    }
    // effect() may return `false` to signal "no consume" (e.g. melee weapons
    // on a clean miss). undefined / true => consume as usual.
    var consumed = it.effect(player);
    if (consumed === false) {
      closeItemUseModal();
      refreshPhoneUI();
      return;
    }
    // Weapons always consume on use even in cheat mode — "weapons are scarce"
    // is a core mechanic; non-weapon items stay infinite when cheat is on.
    var isWeapon = it.category === 'weapon';
    var infiniteFromCharm = hasEternalCharm();
    if (!it.persistent && !infiniteFromCharm && (!cheatActive || isWeapon)) {
      player.inventory[itemId]--;
      // Per user: weapons stay in inventory at ×0 (unusable state visible).
      // Non-weapons drop out entirely when fully consumed.
      if (player.inventory[itemId] <= 0) {
        if (isWeapon) {
          player.inventory[itemId] = 0;
        } else {
          delete player.inventory[itemId];
        }
      }
      player._itemsUsedThisLevel = (player._itemsUsedThisLevel || 0) + 1;
      if (!player._itemsUsedAllRun) player._itemsUsedAllRun = {};
      player._itemsUsedAllRun[itemId] = true;
      // 「全武器使用」 — was incorrectly checking only flare && mirror.
      // Now requires every base weapon to have been used in this run.
      // Unique weapons stay optional since they're rare and not always
      // obtainable in a given run.
      var REQUIRED_WEAPONS = ['pistol', 'shotgun', 'revolver', 'katana', 'flare', 'mirror'];
      var allUsed = true;
      for (var rwi = 0; rwi < REQUIRED_WEAPONS.length; rwi++) {
        if (!player._itemsUsedAllRun[REQUIRED_WEAPONS[rwi]]) { allUsed = false; break; }
      }
      if (allUsed) unlockAchievement('use_all_weapons');
    }
    if (navigator.vibrate) navigator.vibrate(30);
    closeItemUseModal();
    refreshPhoneUI();
    // 「武器を使用したらクイックの表示もすぐに減少反映されるようにする」
    try { updateDpadHud(); } catch (e) {}
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
    if (!currentMap || !currentMap.tiles) return;
    var gx = Math.floor(player.x / TS);
    var gy = Math.floor(player.y / TS);
    // Out-of-bounds guard: if player has somehow been pushed outside the map
    // (no-clip glitch, collision miss), bail safely instead of crashing.
    if (gy < 0 || gx < 0 || gy >= currentMap.height || gx >= currentMap.width) return;
    var row = currentMap.tiles[gy];
    if (!row) return;
    var t = row[gx];

    // Shop tile or adjacent shop tile: open Lv11 vendor overlay
    if (currentMap.shopSpots && currentMap.shopSpots.length) {
      for (var si = 0; si < currentMap.shopSpots.length; si++) {
        var sp = currentMap.shopSpots[si];
        if (Math.abs(sp.gx - gx) <= 1 && Math.abs(sp.gy - gy) <= 1) {
          openShop();
          return;
        }
      }
    }

    // Altar tile — open 「祈りを捧げますか？」 prompt. Only available on
    // levels 12+ per design. Each altar can only be used once per session.
    if (currentMap.altarSpots && currentMap.altarSpots.length && currentLevel >= 12) {
      for (var ali = 0; ali < currentMap.altarSpots.length; ali++) {
        var alt = currentMap.altarSpots[ali];
        if (Math.abs(alt.gx - gx) <= 1 && Math.abs(alt.gy - gy) <= 1) {
          openAltarPrompt(ali);
          return;
        }
      }
    }

    // Secret doc tile — picks up the next undiscovered doc for this level.
    // Each S tile is single-use per run (removed from secretSpots on pickup).
    if (currentMap.secretSpots && currentMap.secretSpots.length) {
      for (var sci = 0; sci < currentMap.secretSpots.length; sci++) {
        var sps = currentMap.secretSpots[sci];
        if (sps.gx === gx && sps.gy === gy) {
          // Pick the first undiscovered doc that belongs to currentLevel
          var pick = null;
          for (var dj = 0; dj < SECRET_DOCS.length; dj++) {
            var d = SECRET_DOCS[dj];
            if (d.levelId !== currentLevel) continue;
            if (collectedSecretDocs[d.id]) continue;
            pick = d; break;
          }
          if (pick) {
            discoverSecretDoc(pick.id);
            // Remove this S spot so it doesn't show up again this session.
            // (No toast — the noteViewer already interrupts and shows the
            // title prominently.)
            currentMap.secretSpots.splice(sci, 1);
            return;
          } else {
            toast('既に読んだ書類');
            return;
          }
        }
      }
    }

    // No-clip exit
    if (t === 3) {
      tryNoClip();
      return;
    }

    // Safe zone with mini-game
    if (t === 11) {
      var mgId = _pickMinigameForSafeZone(currentLevel, gx, gy);
      if (mgId) {
        var safeKey = currentLevel + '_' + gridKey(gx, gy);
        // Per-run lock only (was "single use ever" — user report
        // 2026-06-08「レベル〇のミニゲームが消えている」 was caused
        // by the cross-run lock from earlier persistent play).
        // mgPlayedAt resets at startNewGame/Endless/FreeRoam, so each
        // new run gets fresh minigames at every safe zone.
        if (mgPlayedAt[safeKey]) {
          toast('このセーフエリアは利用済み (この run)');
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
          // Per-door key whitelist: doors with a specific keyId require that
          // exact item; generic locked doors accept 'keycard' as before.
          var requiredKey = ds.keyId || 'keycard';
          var requiredLabel = ds.keyLabel || 'カードキー';
          if (player.inventory[requiredKey]) {
            ds.locked = false;
            ds.open = true;
            player.inventory[requiredKey]--;
            if (player.inventory[requiredKey] <= 0) delete player.inventory[requiredKey];
            toast(requiredLabel + 'で解錠');
            if (audioInitialized) GameEngine.playSound('key_unlock');
          } else {
            toast(requiredLabel + 'が必要');
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
    // Sequence: silence → deep rumble → red flash → encounter cinematic.
    // Bug fix (2026-06-07): user reported "ムービー後動けない" — earlier
    // version used overlapping setTimeout chains with no tap-to-close and
    // no defensive _inCinematic clear. Now there is a single finish()
    // path that always clears _inCinematic, hides the overlay, restores
    // ambient/BGM, and removes its own tap handler. Tap or wait 7500ms.
    _inCinematic = true;
    if (audioInitialized) {
      GameEngine.stopAll();
      GameEngine.playSound('thunder');
    }
    GameEngine.redFlash();
    var encOverlay = el('encounterCinematic');
    var done = false;
    var timers = [];
    function later(ms, fn) {
      timers.push(setTimeout(function () { if (!done) fn(); }, ms));
    }
    function finish() {
      if (done) return;
      done = true;
      for (var ti = 0; ti < timers.length; ti++) clearTimeout(timers[ti]);
      try { hideOverlay('encounterCinematic'); } catch (e) {}
      _inCinematic = false;
      if (encOverlay) {
        encOverlay.style.pointerEvents = 'none';
        try { encOverlay.removeEventListener('click', finish); } catch (e) {}
        try { encOverlay.removeEventListener('touchstart', finish); } catch (e) {}
      }
      try {
        var theme = THEMES[currentLevelDef.theme];
        if (theme && theme.ambientLoop && audioInitialized) GameEngine.startLoop(theme.ambientLoop);
        if (theme && theme.bgmLoop && audioInitialized) GameEngine.startLoop(theme.bgmLoop);
      } catch (e) {}
    }
    later(1500, function () {
      if (audioInitialized) {
        GameEngine.playSound('stinger');
        GameEngine.playSound('scream');
      }
      GameEngine.shakeScreen(25, 1.5);
      GameEngine.staticEffect(0.7);
      setTimeout(function () { GameEngine.staticEffect(0); }, 1200);
    });
    later(3200, function () {
      _inCinematic = false; // allow input during the read-the-intro card
      var intro = ENTITY_INTROS.boss;
      try { el('encounterShape').textContent = '👑'; } catch (e) {}
      try { el('encounterName').textContent = intro.name; } catch (e) {}
      try { el('encounterDesc').textContent = intro.desc + '\n\n[ 画面をタップして閉じる ]'; } catch (e) {}
      showOverlay('encounterCinematic');
      if (encOverlay) {
        encOverlay.style.pointerEvents = 'auto';
        encOverlay.addEventListener('click', finish);
        encOverlay.addEventListener('touchstart', finish);
      }
      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    });
    later(7500, finish); // hard auto-close (down from 4500 + no fallback)
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
    } else if (killerType === 'boss' || killerType === 'haruki_boss') {
      // Architect / Haruki真 — dramatic; haruki variant layers an extra whisper
      // and tinnitus for thematic continuity with the Lv5 haruki encounter.
      if (audioInitialized) {
        GameEngine.playSound('stinger');
        GameEngine.playSound('thunder');
        GameEngine.playSound('scream');
        if (killerType === 'haruki_boss') {
          GameEngine.playSound('whisper');
          GameEngine.playSound('tinnitus');
        }
      }
      GameEngine.redFlash();
      GameEngine.shakeScreen(killerType === 'haruki_boss' ? 40 : 30, 1.7);
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

  // Helper: record an item id in the lifetime-collected ledger so the D-pad
  // assignment UI (and any future "all items found" achievement) can detect
  // that the player has seen it at least once. Pickups and mini-game rewards
  // should both call this; new acquisition paths must remember to as well.
  function recordItemSeen(itemId) {
    try {
      var allKey2 = 'thebackrooms_items_collected_v1';
      var allColl2 = JSON.parse(localStorage.getItem(allKey2) || '{}');
      if (!allColl2[itemId]) {
        allColl2[itemId] = true;
        localStorage.setItem(allKey2, JSON.stringify(allColl2));
      }
    } catch (e) {}
  }

  // Civilian chatter — short greetings / small talk surfaced when the player
  // brushes past a Lv11 NPC. No TTS (uncanny voice would be tonally wrong);
  // just a brief flavor text via the existing halluc-text layer.
  var CIVILIAN_CHATTER = [
    // greetings
    'おはよう。', 'こんにちは。', 'こんばんは。', 'やあ。',
    // small-talk weather
    '今日は寒いね。', '天気いいね。', '雨、来そうだ。', '風が強い。',
    // service offers
    '何かお探し?', '案内が要る?', '寄ってかない?',
    // closings
    'お疲れさま。', '気をつけて。', 'また会おう。', 'いい一日を。', 'よく来たね。',
    // backrooms flavor
    'ここ、慣れる?', 'あなたも降りてきた人?', '出口は探さないほうがいい。',
    '長居しないことだ。', 'ハルキを見かけたら、目を逸らせ。',
    // shop hints
    '露店主、今日はいい品揃えだ。', '彼から物を買うといい。'
  ];
  var _lastCivilianChatterAt = 0;
  function maybeFireCivilianChatter() {
    var now = performance.now();
    if (now - _lastCivilianChatterAt < 6000) return;
    _lastCivilianChatterAt = now;
    var line = CIVILIAN_CHATTER[Math.floor(Math.random() * CIVILIAN_CHATTER.length)];
    var htxt = el('hallucText');
    if (!htxt) return;
    htxt.textContent = '— ' + line;
    htxt.classList.remove('show', 'flavor');
    void htxt.offsetWidth;
    htxt.classList.add('show', 'flavor');
    var hLayerC = el('hallucinationLayer');
    if (hLayerC) hLayerC.style.display = 'block';
    setTimeout(function () { if (htxt) htxt.classList.remove('show', 'flavor'); }, 2000);
  }

  // Per-level flavor lines — sells the setting that the geometry alone can't.
  // The user explicitly asked for "ホテルであればベッドや照明、カウンターなど、
  // オフィスであればデスクとチェアやpcなど小物もきちんと配置するように" — until
  // the engine can render props, these short flavor lines do the same job by
  // describing what the room SHOULD look like.
  var LEVEL_FLAVOR_LINES = {
    0:  ['湿った絨毯。', '蛍光灯のハム音。', '黄色い壁紙。',
         '空気がやけに乾いている。', '遠くで誰かの足音。',
         '— ここは、Level 0 だ。'],
    1:  ['冷たいコンクリートの匂い。', '遠くに M.E.G. の旗。',
         '誰かが走っていく。', '広い、広い倉庫。'],
    2:  ['配管から水が滴る。', '床は浅い水たまり。',
         '錆びた金属の匂い。', 'パイプの中で何かが動いた。'],
    3:  ['火花の臭い。', '剥き出しのケーブル。',
         '蛍光灯がチカチカと明滅する。', '感電に気をつけろ。'],
    4:  ['キュービクル間のデスク。', 'PC のモニターが微かに光っている。',
         '会議椅子が散らばっている。', '誰かの書類が床に。', 'コーヒーマシンが空回りしている。'],
    5:  ['ベッドメイクされたままの部屋。', 'シャンデリアの灯り。',
         'フロントカウンターに鈴。', '電話が、どこかで鳴っている。',
         '部屋番号が、毎回違う気がする。'],
    6:  ['消毒液の匂い。', 'カルテが床に散らかっている。',
         '点滴の音。', 'ストレッチャーが廊下に残されている。'],
    7:  ['芝生の上を歩く感触。', '誰もいない家々の窓。',
         '夕暮れの陽光。', '— 帰りたい。'],
    8:  ['ギャラリーの絵画。', '蜂の羽音が低く響く。',
         '甘い匂いがする。', '誰かが彫像の影に立っている。'],
    9:  ['ハルキ — そこに、いる。',
         '空に月はない。月のような、何か。',
         '— おかえり、と聞こえた気がした。'],
    11: ['露店主の呼び声。', '行き交うサラリーマン。', 'コーヒーの香り。',
         'パン屋の匂いが流れてくる。', '誰かが新聞を読んでいる。'],
    12: ['ピンクの照明。', '誰かが笑っている。',
         '甘いケーキの匂い。', 'パーティーは終わらない。'],
    13: ['古書の匂い。', '本棚の列が無限に伸びている。',
         '誰かが本を返却した音。', '司書のスタンプの音。'],
    14: ['冷たい海水。', '魚が泳いでいく影。',
         '海底の沈黙。', '深く、深く、潜る。'],
    15: ['生垣の影。', '夜の鳥の声。',
         '虫の音。', '迷路の終わりが見えない。']
  };
  var _flavorRollT = 12;
  var _lastFlavorAt = 0;
  function maybeFireLevelFlavor() {
    var lines = LEVEL_FLAVOR_LINES[currentLevel];
    if (!lines || !lines.length) return;
    var nowF = performance.now();
    if (nowF - _lastFlavorAt < 35000) return; // sparse — once per ~35s+
    _lastFlavorAt = nowF;
    var line = lines[Math.floor(Math.random() * lines.length)];
    var htxt = el('hallucText');
    if (htxt) {
      htxt.textContent = '— ' + line;
      htxt.classList.remove('show', 'flavor');
      void htxt.offsetWidth;
      htxt.classList.add('show', 'flavor');
      var hLayerF = el('hallucinationLayer');
      if (hLayerF) hLayerF.style.display = 'block';
      setTimeout(function () {
        if (htxt) { htxt.classList.remove('show', 'flavor'); }
      }, 2200);
    }
  }
  // Ambient micro-event state — see fireAmbientMicroEvent() below.
  var _lastAmbientEventAt = 0;
  var _ambientEventRollT = 5;

  // Pick and execute one random ambient micro-event. Sensory beats only —
  // never hurts the player, just thickens the atmosphere. Some events are
  // tuned to fire more often in specific levels.
  // ── LEVEL-SPECIFIC AMBIENT EVENTS ─────────────────────────
  // Each level rolls its own atmospheric beat every ~15s. Functions are
  // intentionally lightweight — small SE + brief hallu-text or shake.
  // Per-level signature ambient particles — emit a level-specific
  // particle near the player periodically. Adds visual life to the
  // static raycaster walls. User feedback: 「オブジェクトも少なく単調」.
  // Types map to engine particle types (spark / dust / fog).
  var LEVEL_AMBIENT_PARTICLES = {
    0:  { type: 'dust',  interval: 1.8, count: 1 },  // lobby motes
    1:  { type: 'dust',  interval: 2.0, count: 1 },  // concrete dust
    2:  { type: 'spark', interval: 0.9, count: 1 },  // water drips (re-tinted in render?)
    3:  { type: 'spark', interval: 0.5, count: 2 },  // electrical sparks
    4:  { type: 'dust',  interval: 2.2, count: 1 },  // office paper bits
    5:  { type: 'dust',  interval: 2.5, count: 1 },  // hotel hush
    6:  { type: 'fog',   interval: 1.6, count: 1 },  // dark fog
    7:  { type: 'dust',  interval: 1.5, count: 2 },  // corridor wind
    8:  { type: 'spark', interval: 1.2, count: 1 },  // hive glow
    9:  { type: 'fog',   interval: 1.0, count: 2 },  // suburb storm
    11: { type: 'dust',  interval: 1.4, count: 1 },  // street dust
    12: { type: 'spark', interval: 0.4, count: 3 },  // party confetti
    13: { type: 'dust',  interval: 2.0, count: 1 },  // library paper dust
    14: { type: 'spark', interval: 0.8, count: 2 },  // bubbles in water
    15: { type: 'dust',  interval: 1.6, count: 1 }   // garden pollen
  };
  // Per-level visual tint flash. Brief hallucinationLayer overlay so even
  // audio-only ambient events get a matching visual cue. Each level uses
  // a signature color so the player builds intuition about where they are.
  function _flashLevelTint(rgba, durMs) {
    var hl = el('hallucinationLayer');
    if (!hl) return;
    hl.style.display = 'block';
    var prevBg = hl.style.background;
    var prevOp = hl.style.opacity;
    hl.style.background = rgba;
    hl.style.opacity = '1';
    setTimeout(function () {
      if (!hl) return;
      hl.style.background = prevBg;
      hl.style.opacity = prevOp;
    }, durMs || 220);
  }
  var LEVEL_AMBIENT_EVENTS = {
    // Each level now has 3-5 events mixing audio + per-level visual tint
    // so the ambient roll never feels purely audio. User request: 「ボスの
    // レベルのような視覚的イベント設計を他のレベルでも適宜実装したい」.
    0: [ // LOBBY — fluorescent stutters, lemon-yellow flicker
      function () { try { GameEngine.playSound('fluorescent'); } catch (e) {} _flashLevelTint('rgba(255,240,140,0.55)', 90); },
      function () { _flashLevelTint('rgba(40,40,40,0.55)', 120); try { GameEngine.playSound('static'); } catch (e) {} },
      function () { _flashLevelTint('rgba(255,200,40,0.35)', 220); }
    ],
    1: [ // HABITABLE — warm sodium light, distant footstep echo
      function () { try { GameEngine.playSound('footstep'); } catch (e) {} _flashLevelTint('rgba(180,120,40,0.18)', 320); },
      function () { try { GameEngine.playSound('pipe_creak'); } catch (e) {} GameEngine.shakeScreen(2, 0.08); },
      function () { _flashLevelTint('rgba(110,70,30,0.30)', 260); }
    ],
    2: [ // PIPES — splash + steam burst, blue-cyan tint
      function () { try { GameEngine.playSound('pipe_drip'); } catch (e) {} _flashLevelTint('rgba(20,80,140,0.30)', 180); },
      function () { try { GameEngine.playSound('pipe_creak'); } catch (e) {} GameEngine.shakeScreen(4, 0.15); },
      function () { _flashLevelTint('rgba(180,220,240,0.30)', 220); } // steam puff
    ],
    3: [ // ELECTRICAL — strobe + sparks + tinted blue/white
      function () { try { GameEngine.playSound('static'); } catch (e) {} GameEngine.shakeScreen(5, 0.18); _flashLevelTint('rgba(180,220,255,0.85)', 80); },
      function () { _flashLevelTint('rgba(0,0,0,0.95)', 120); try { GameEngine.playSound('static'); } catch (e) {} },
      function () { _flashLevelTint('rgba(255,255,255,0.70)', 50); try { GameEngine.playSound('clock_tick'); } catch (e) {} }
    ],
    4: [ // OFFICE — phone ring + paper flutter + cubicle hum
      function () { try { GameEngine.playSound('phone'); } catch (e) {} _flashLevelTint('rgba(200,180,100,0.25)', 320); },
      function () { try { GameEngine.playSound('paper'); } catch (e) {} _flashLevelTint('rgba(255,250,220,0.30)', 220); },
      function () { try { GameEngine.playSound('clock_tick'); } catch (e) {} },
      function () { _flashLevelTint('rgba(40,40,60,0.45)', 180); try { GameEngine.playSound('whisper'); } catch (e) {} }
    ],
    5: [ // HOTEL — elevator ding + warm corridor flicker
      function () { try { GameEngine.playSound('glass_rattle'); } catch (e) {} _flashLevelTint('rgba(140,80,40,0.30)', 260); },
      function () { try { GameEngine.playSound('elevator_hum'); } catch (e) {} },
      function () { _flashLevelTint('rgba(200,150,80,0.40)', 300); try { GameEngine.playSound('phone'); } catch (e) {} }
    ],
    6: [ // DARK HALLWAY — flashlight glint of something + pitch black flash
      function () { _flashLevelTint('rgba(255,255,255,0.40)', 60); try { GameEngine.playSound('static'); } catch (e) {} },
      function () { _flashLevelTint('rgba(0,0,0,0.92)', 220); try { GameEngine.playSound('breath'); } catch (e) {} GameEngine.shakeScreen(3, 0.12); },
      function () { try { GameEngine.playSound('whisper'); } catch (e) {} _flashLevelTint('rgba(80,0,30,0.45)', 200); }
    ],
    7: [ // CORRIDOR — wind howl + horizon hint
      function () { try { GameEngine.playSound('wind'); } catch (e) {} _flashLevelTint('rgba(140,120,80,0.20)', 320); },
      function () { try { GameEngine.playSound('whisper'); } catch (e) {} _flashLevelTint('rgba(40,40,40,0.45)', 240); },
      function () { _flashLevelTint('rgba(200,180,120,0.18)', 360); } // distant sky band
    ],
    8: [ // HIVE — yellow honeycomb pulse + buzzing
      function () { try { GameEngine.playSound('breath'); } catch (e) {} _flashLevelTint('rgba(230,180,40,0.40)', 240); },
      function () { try { GameEngine.playSound('whisper'); } catch (e) {} GameEngine.shakeScreen(2, 0.10); },
      function () { _flashLevelTint('rgba(120,80,20,0.55)', 200); }
    ],
    9: [ // SUBURBS — boss arena: lightning + thunder + sky strobe
      function () { try { GameEngine.playSound('thunder'); } catch (e) {} GameEngine.shakeScreen(10, 0.4); _flashLevelTint('rgba(180,180,200,0.85)', 100); },
      function () { try { _uncannySpeak('まだ、いるよ。'); } catch (e) {} _flashLevelTint('rgba(100,0,30,0.35)', 320); },
      function () { _flashLevelTint('rgba(40,40,80,0.45)', 320); try { GameEngine.playSound('wind'); } catch (e) {} },
      function () { _flashLevelTint('rgba(220,220,255,0.75)', 50); try { GameEngine.playSound('thunder'); } catch (e) {} }
    ],
    11: [ // OFFICE DISTRICT — train rumble + neon strip
      function () { try { GameEngine.playSound('clock_tick'); } catch (e) {} _flashLevelTint('rgba(120,180,200,0.20)', 240); },
      function () { try { GameEngine.playSound('paper'); } catch (e) {} },
      function () { _flashLevelTint('rgba(40,180,200,0.50)', 80); try { GameEngine.playSound('static'); } catch (e) {} GameEngine.shakeScreen(6, 0.20); }, // train pass
      function () { _flashLevelTint('rgba(220,120,40,0.35)', 200); } // sodium light bleed
    ],
    12: [ // FUN — party strobe in 3 colors
      function () { try { GameEngine.playSound('stinger'); } catch (e) {} _flashLevelTint('rgba(200,80,160,0.60)', 110); },
      function () { _flashLevelTint('rgba(60,180,220,0.55)', 110); try { GameEngine.playSound('phone'); } catch (e) {} },
      function () { _flashLevelTint('rgba(220,220,80,0.55)', 110); GameEngine.shakeScreen(3, 0.1); },
      function () { _flashLevelTint('rgba(255,40,80,0.55)', 110); }
    ],
    13: [ // LIBRARY — golden book glow + page flip
      function () { try { GameEngine.playSound('paper'); } catch (e) {} _flashLevelTint('rgba(220,180,100,0.35)', 280); },
      function () { try { GameEngine.playSound('clock_tick'); } catch (e) {} },
      function () { try { GameEngine.playSound('whisper'); } catch (e) {} _flashLevelTint('rgba(40,30,15,0.55)', 200); },
      function () { _flashLevelTint('rgba(180,140,60,0.45)', 320); }
    ],
    14: [ // TRENCH — water splash + cold blue tint + bubble pop
      function () { try { GameEngine.playSound('pipe_drip'); } catch (e) {} _flashLevelTint('rgba(40,80,120,0.55)', 220); },
      function () { try { GameEngine.playSound('breath'); } catch (e) {} _flashLevelTint('rgba(0,0,0,0.85)', 160); }, // submerged
      function () { _flashLevelTint('rgba(120,180,200,0.40)', 320); GameEngine.shakeScreen(2, 0.10); }, // bubble surface
      function () { try { GameEngine.playSound('static'); } catch (e) {} _flashLevelTint('rgba(80,180,200,0.30)', 280); }
    ],
    15: [ // OUTDOOR/GRAVEL — sky brighten + wind + crow caw (whisper)
      function () { try { GameEngine.playSound('wind'); } catch (e) {} _flashLevelTint('rgba(180,180,220,0.30)', 320); },
      function () { try { GameEngine.playSound('whisper'); } catch (e) {} _flashLevelTint('rgba(220,200,160,0.40)', 240); }, // sun glare
      function () { _flashLevelTint('rgba(140,180,220,0.45)', 280); GameEngine.shakeScreen(2, 0.10); }, // distant rumble
      function () { _flashLevelTint('rgba(40,40,60,0.35)', 280); } // cloud shadow
    ]
  };
  var _levelEventRollT = 8;
  var _lastLevelEventAt = 0;
  function maybeFireLevelAmbientEvent() {
    var bank = LEVEL_AMBIENT_EVENTS[currentLevel];
    if (!bank || !bank.length) return;
    var now = performance.now();
    if (now - _lastLevelEventAt < 14000) return; // ~14s cooldown
    _lastLevelEventAt = now;
    var fn = bank[Math.floor(Math.random() * bank.length)];
    try { fn(); } catch (e) {}
  }

  function fireAmbientMicroEvent() {
    var pool = [
      'distant_footsteps', 'distant_door_slam', 'light_flicker',
      'whisper_pass', 'wall_knock', 'breathing_close', 'glitch_text'
    ];
    var ev = pool[Math.floor(Math.random() * pool.length)];
    var hl = el('hallucinationLayer');
    var htxt = el('hallucText');
    switch (ev) {
      case 'distant_footsteps':
        if (audioInitialized) {
          try { GameEngine.playSound('footstep'); } catch (e) {}
          setTimeout(function () { try { GameEngine.playSound('footstep'); } catch (e) {} }, 380);
          setTimeout(function () { try { GameEngine.playSound('footstep'); } catch (e) {} }, 760);
        }
        break;
      case 'distant_door_slam':
        if (audioInitialized) {
          try { GameEngine.playSound('door'); } catch (e) {}
          GameEngine.shakeScreen(6, 0.25);
        }
        break;
      case 'light_flicker':
        if (hl) {
          hl.style.display = 'block';
          var prevOp = hl.style.opacity;
          hl.style.opacity = '0.9';
          setTimeout(function () { if (hl) hl.style.opacity = '0.1'; }, 80);
          setTimeout(function () { if (hl) hl.style.opacity = '0.7'; }, 180);
          setTimeout(function () { if (hl) hl.style.opacity = prevOp || ''; }, 320);
        }
        if (audioInitialized) try { GameEngine.playSound('static'); } catch (e) {}
        break;
      case 'whisper_pass':
        if (audioInitialized) try { GameEngine.playSound('whisper'); } catch (e) {}
        break;
      case 'wall_knock':
        if (audioInitialized) try { GameEngine.playSound('hit'); } catch (e) {}
        if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) {}
        break;
      case 'breathing_close':
        if (audioInitialized) try { GameEngine.playSound('breath_drone'); } catch (e) {}
        break;
      case 'glitch_text':
        if (htxt) {
          var lines = ['...いる', 'みてる', 'まだ?', 'ここ', 'うしろ'];
          htxt.textContent = lines[Math.floor(Math.random() * lines.length)];
          htxt.classList.remove('show');
          void htxt.offsetWidth;
          htxt.classList.add('show');
          if (hl) {
            hl.style.display = 'block';
            setTimeout(function () { if (htxt) htxt.classList.remove('show'); }, 1000);
          }
        }
        break;
    }
  }

  // Situational TTS line banks. Categories are sparse on purpose so the voice
  // stays unsettling rather than chatty. Each category has its own cooldown
  // tracked in _ttsCategoryCooldown so categories don't crowd each other out.
  var TTS_LINES = {
    low_san: [
      'もう、いるよ。',
      'うしろを見るな。',
      '気づかれた。',
      '正気でいられるね。',
      'すぐ、そこに。',
      'もう、戻れない。'
    ],
    level_descent: [
      'ようこそ。',
      '降りてきたね。',
      'ここは、まだ浅い。',
      '深く、深く。',
      'もうすぐ、会える。'
    ],
    enemy_close: [
      '見つけた。',
      'こっちにおいで。',
      'ねえ。',
      'にげても、むだ。'
    ],
    boss_approach: [
      '待っていた。',
      'ようやく、来たね。',
      'もう、はなさない。'
    ],
    note_dread: [
      '読まないで。',
      'やめておけ。',
      '知ってしまったね。'
    ],
    item_uncanny: [
      'それは、私のだよ。',
      'うけとった?',
      '気をつけて。'
    ]
  };
  // Per-category cooldown so a low_san line doesn't immediately steal a slot
  // from a boss_approach line and vice versa.
  var _ttsCategoryCooldown = {};
  // Track SAN bucket so we only fire on threshold *crosses* — repeated ticks
  // at the same SAN range don't keep whispering.
  var _sanBucket = 'high';
  // Web Speech API helper for an uncanny low-pitch whisper voice. Used by the
  // enemy-line system for ハルキ系 / boss / wretch so the player physically
  // hears what they're saying. Throttled so it never queues up faster than
  // ~one utterance every 3 seconds, and falls back silently when the device
  // doesn't ship a TTS engine (notably some iOS Safari modes).
  var _lastUncannySpeakAt = 0;
  function _uncannySpeak(text) {
    try {
      if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return;
      // Respect the title-settings TTS toggle on the direct path too.
      // speakSituational already gates on this, but encounter cinematics
      // and a couple of scripted beats call _uncannySpeak directly.
      try { if (localStorage.getItem('bk_tts_voices') === '0') return; } catch (e) {}
      var now = performance.now();
      if (now - _lastUncannySpeakAt < 3000) return;
      _lastUncannySpeakAt = now;
      var seVol = parseInt(localStorage.getItem('bk_se_vol') || '100', 10) / 100;
      if (seVol <= 0) return;
      // User feedback 2026-06-07: 「音声があまりにもロボットすぎる。
      // しゃがれた気持ちの悪い怖い声にしたい」
      // Web Speech API doesn't let us post-process the synth audio, but
      // we can push the prosody params to the extreme low end AND layer
      // procedural texture (whisper + breath_drone + static) underneath
      // so the synthesized voice reads as a ghost inside a haunted room
      // rather than a clean robot TTS readout.
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 0.45;    // very slow (was 0.7) — gives a labored, breathy feel
      u.pitch = 0.1;    // near-floor (was 0.4) — deepest the API allows
      u.volume = Math.max(0.15, Math.min(0.85, seVol * 0.7));
      // Prefer a male Japanese voice if one is exposed — some platforms
      // ship multiple Japanese voices ("Otoya" male / "Kyoko" female).
      // Male voices sound deeper and more monstrous at low pitch.
      try {
        var voices = window.speechSynthesis.getVoices();
        var jpVoice = null, jpMaleVoice = null;
        var MALE_HINTS = ['otoya', 'ichiro', 'male', 'hiroshi', 'takeshi', 'kenji'];
        for (var vi = 0; vi < voices.length; vi++) {
          var v = voices[vi];
          if (!v || !v.lang || v.lang.toLowerCase().indexOf('ja') !== 0) continue;
          if (!jpVoice) jpVoice = v;
          var lname = (v.name || '').toLowerCase();
          for (var mhi = 0; mhi < MALE_HINTS.length; mhi++) {
            if (lname.indexOf(MALE_HINTS[mhi]) >= 0) { jpMaleVoice = v; break; }
          }
          if (jpMaleVoice) break;
        }
        u.voice = jpMaleVoice || jpVoice;
      } catch (e) {}
      // Layer texture: whisper + breath underneath so the voice feels
      // raspy/embedded. Quiet enough not to drown the speech itself.
      if (audioInitialized) {
        try { GameEngine.playSound('whisper'); } catch (e) {}
        try { GameEngine.playSound('breath_drone'); } catch (e) {}
        // tinnitus only on longer lines so short ones aren't piercing
        if (text && text.length > 5) try { GameEngine.playSound('tinnitus'); } catch (e) {}
      }
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // Public situational TTS — pick a random line from a TTS_LINES category and
  // speak it through _uncannySpeak, respecting per-category cooldown and the
  // user's bk_tts_voices toggle (default ON).
  function speakSituational(category, opts) {
    opts = opts || {};
    var bank = TTS_LINES[category];
    if (!bank || !bank.length) return;
    try {
      if (localStorage.getItem('bk_tts_voices') === '0') return;
    } catch (e) {}
    var now = performance.now();
    var lastCat = _ttsCategoryCooldown[category] || 0;
    var cdMs = opts.cooldownMs || 15000; // categories self-throttle ~15s
    if (now - lastCat < cdMs) return;
    _ttsCategoryCooldown[category] = now;
    var line = bank[Math.floor(Math.random() * bank.length)];
    _uncannySpeak(line);
  }

  // Weapons pick up with a randomised "ammo" count instead of always +1, so
  // a pistol you find might give 2 shots, a shotgun maybe 1, etc. Same-weapon
  // pickups stack on top of the current count. Once the count hits 0 the
  // weapon auto-deletes from inventory but the D-pad binding stays bound at
  // ×0 so the player can re-bind on re-pickup.
  var WEAPON_AMMO_PICKUP = {
    pistol:          [7, 11],  // 7–11 shots (user request 2026-06-07)
    shotgun:         [2, 4],   // shells
    revolver:        [3, 6],
    katana:          [4, 7],
    flare:           [1, 1],   // single use
    mirror:          [1, 1],   // single use
    soul_lantern:    [1, 1],
    haruki_charm:    [1, 1],
    architect_blade: [2, 4],
    siren_whistle:   [1, 1],
    mirror_shard:    [1, 1],
    revenant_blade:  [3, 5],
    void_grenade:    [1, 2]
  };
  function _rollWeaponPickupCount(itemId) {
    var range = WEAPON_AMMO_PICKUP[itemId];
    if (!range) return 1;
    return Math.floor(range[0] + Math.random() * (range[1] - range[0] + 1));
  }

  function pickUpItem(itemId, gx, gy) {
    var item = ITEMS[itemId];
    // First flashlight pickup grants a fresh battery (the player has no light
    // until they consume the first one). Subsequent flashlight pickups just
    // bank as spares — they refill battery on auto-swap when current dies.
    if (itemId === 'flashlight' && (!player.inventory.flashlight)
        && (player.flashlightBattery || 0) <= 0) {
      player.flashlightBattery = 100;
    }
    if (!item) return;
    var addAmount = 1;
    if (item.category === 'weapon') {
      addAmount = _rollWeaponPickupCount(itemId);
    }
    player.inventory[itemId] = (player.inventory[itemId] || 0) + addAmount;
    // Auto-equip if the player has no weapon currently equipped — the
    // attack button stays hidden until something is bound, so without
    // this the first weapon pickup felt invisible until the player
    // figured out the phone/equip flow.
    if (item.category === 'weapon' && !player.equippedWeapon) {
      try { equipWeapon(itemId); } catch (e) {}
      // Also auto-bind to the first empty d-pad slot in weapon mode so
      // the player can switch with the d-pad without going through the
      // phone equip modal.
      try {
        var wmSlots = dpadAssignments.weapon || (dpadAssignments.weapon = { up: '', down: '', left: '', right: '' });
        var DIRS = ['up', 'down', 'left', 'right'];
        for (var di = 0; di < DIRS.length; di++) {
          if (!wmSlots[DIRS[di]]) {
            wmSlots[DIRS[di]] = itemId;
            saveDpadAssignments();
            updateDpadHud();
            break;
          }
        }
      } catch (e) {}
    }
    if (!pickedUpItems[currentLevel]) pickedUpItems[currentLevel] = {};
    pickedUpItems[currentLevel][gridKey(gx, gy)] = true;
    delete pickupSpots[gridKey(gx, gy)];
    // Check lifetime-first-pickup BEFORE marking it seen below — used to
    // upgrade the discovery label to ★ 新発見 for the very first encounter.
    var isNewDiscovery = false;
    try {
      var allColl0 = JSON.parse(localStorage.getItem('thebackrooms_items_collected_v1') || '{}');
      isNewDiscovery = !allColl0[itemId];
    } catch (e) {}
    var nameLabel = item.name + (item.category === 'weapon' ? ' (×' + addAmount + ')' : '');
    var discoveryLabel = isNewDiscovery ? '★ 新発見! ★' : 'アイテム入手';
    // Pass the item id (not the emoji) so the discovery popup can use
    // the realistic SVG when available, falling back to icon otherwise.
    showDiscovery(WEAPON_SVG[itemId] ? itemId : item.icon, discoveryLabel, nameLabel);
    if (isNewDiscovery && audioInitialized) {
      try { GameEngine.playSound('stinger'); } catch (e) {}
    }
    if (audioInitialized) {
      // Weapons get the heavier metal-clink + chamber-chunk pickup;
      // consumables keep the lighter item_get chime.
      try {
        GameEngine.playSound(item.category === 'weapon' ? 'weapon_pickup' : 'item_get');
      } catch (e) {}
    }
    if (navigator.vibrate) navigator.vibrate(20);
    // Refresh the quick HUD so the slot bound to this item shows the new count
    // immediately (otherwise the change only surfaced on the next per-frame
    // refresh anchor).
    try { updateDpadHud(); } catch (e) {}
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
    // Skip the brief discoveryPopup for notes — the note viewer IS the main UI.
    // (Stacking both makes the screen messy + redundant.)
    showNoteViewer(note.title, note.text);
    if (audioInitialized) GameEngine.playSound('paper');
    if (navigator.vibrate) navigator.vibrate(15);
  }

  // Open time of the note viewer — used to gate close input so the same
  // button press that opens (拾う) doesn't immediately close it on the next frame.
  var _noteViewerOpenedAt = 0;
  var NOTE_INPUT_LOCK_MS = 900;
  // Close-arming state machine: a close attempt is honoured only after BOTH
  //   (a) the open-grace (NOTE_INPUT_LOCK_MS) has elapsed AND
  //   (b) at least one input release (keyup / touchend / mouseup / blur) has fired
  // since the note opened. This prevents the same press that opened the note
  // (or its auto-repeat, or its iOS-synthesized click) from closing it.
  var _noteCloseArmed = false;
  function _armNoteCloseIfReady() {
    if (performance.now() - _noteViewerOpenedAt >= NOTE_INPUT_LOCK_MS) {
      _noteCloseArmed = true;
    } else {
      // Release happened too early — re-check once the grace expires.
      setTimeout(function () { _noteCloseArmed = true; },
        Math.max(0, NOTE_INPUT_LOCK_MS - (performance.now() - _noteViewerOpenedAt)));
    }
  }
  function _isNoteOpen() {
    var nv = el('noteViewerOverlay');
    return nv && nv.style.display !== 'none' && nv.style.display !== '';
  }
  // Global release listeners — armed once per session.
  if (!window._noteReleaseListenersBound) {
    window._noteReleaseListenersBound = true;
    var onRelease = function () { if (_isNoteOpen()) _armNoteCloseIfReady(); };
    window.addEventListener('keyup', onRelease, true);
    window.addEventListener('touchend', onRelease, true);
    window.addEventListener('touchcancel', onRelease, true);
    window.addEventListener('mouseup', onRelease, true);
    window.addEventListener('blur', onRelease, true);
  }
  function _canCloseNote() {
    if (!_noteCloseArmed) return false;
    if (performance.now() - _noteViewerOpenedAt < NOTE_INPUT_LOCK_MS) return false;
    return true;
  }
  // Note viewer pagination state — for long secret docs, split into pages
  // at \n\n paragraph boundaries (~300 char target) and show ◀ X/Y ▶.
  var _notePages = [];
  var _notePageIdx = 0;
  function _splitNotePages(text, maxLen) {
    var paras = text.split(/\n\n+/);
    var pages = [], cur = '';
    paras.forEach(function (p) {
      var test = cur ? cur + '\n\n' + p : p;
      if (test.length > maxLen && cur) {
        pages.push(cur);
        cur = p;
      } else {
        cur = test;
      }
    });
    if (cur) pages.push(cur);
    return pages.length ? pages : [text];
  }
  function _renderNotePage() {
    el('noteText').textContent = _notePages[_notePageIdx] || '';
    var navEl = el('notePageNav');
    if (navEl) {
      if (_notePages.length > 1) {
        navEl.style.display = 'flex';
        var lbl = el('notePageLabel');
        if (lbl) lbl.textContent = (_notePageIdx + 1) + ' / ' + _notePages.length;
        var prev = el('notePrevBtn');
        var next = el('noteNextBtn');
        if (prev) prev.disabled = _notePageIdx === 0;
        if (next) next.disabled = _notePageIdx === _notePages.length - 1;
      } else {
        navEl.style.display = 'none';
      }
    }
  }
  function _bindNoteNavOnce() {
    var prev = el('notePrevBtn'), next = el('noteNextBtn');
    if (prev && !prev._bound) {
      prev._bound = true;
      prev.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_notePageIdx > 0) {
          _notePageIdx--;
          _renderNotePage();
          if (audioInitialized) try { GameEngine.playSound('paper'); } catch (er) {}
        }
      });
    }
    if (next && !next._bound) {
      next._bound = true;
      next.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_notePageIdx < _notePages.length - 1) {
          _notePageIdx++;
          _renderNotePage();
          if (audioInitialized) try { GameEngine.playSound('paper'); } catch (er) {}
        }
      });
    }
  }

  function showNoteViewer(title, text, opts) {
    el('noteTitle').textContent = title;
    // Paginate when the text would clearly overflow even in 重厚 mode.
    var heavy = !!(opts && opts.weight === 'heavy');
    var pageLen = heavy ? 320 : 600;
    _notePages = (text.length > pageLen) ? _splitNotePages(text, pageLen) : [text];
    _notePageIdx = 0;
    _bindNoteNavOnce();
    _renderNotePage();
    // Optional 重厚 mode for secret docs — serif + amber tint, applied via
    // CSS class on the note-panel.
    var panel = el('noteViewerOverlay') && el('noteViewerOverlay').querySelector('.note-panel');
    if (panel) panel.classList.toggle('weight-heavy', heavy);
    showOverlay('noteViewerOverlay');
    _noteViewerOpenedAt = performance.now();
    _noteCloseArmed = false;
    var closeBtn = el('closeNoteBtn');
    if (closeBtn) {
      closeBtn.disabled = true;
      closeBtn.style.opacity = '0.4';
      setTimeout(function () {
        closeBtn.disabled = false;
        closeBtn.style.opacity = '';
      }, NOTE_INPUT_LOCK_MS);
    }
    // Any-tap close: tapping anywhere on the overlay (after arm) closes the
    // note, matching gamepad any-button and keyboard any-key behavior.
    var nvOverlay = el('noteViewerOverlay');
    if (nvOverlay && !nvOverlay._anyTapBound) {
      nvOverlay._anyTapBound = true;
      var anyTapClose = function (ev) {
        if (!_canCloseNote()) return;
        // Ignore taps on the close button itself — it has its own handler.
        var t = ev.target;
        while (t && t !== nvOverlay) {
          if (t.id === 'closeNoteBtn') return;
          t = t.parentNode;
        }
        ev.preventDefault();
        var cb = el('closeNoteBtn');
        if (cb) cb.click();
      };
      nvOverlay.addEventListener('click', anyTapClose);
      nvOverlay.addEventListener('touchstart', anyTapClose, { passive: false });
    }
  }

  function tryNoClip() {
    if (player._noClipping) return; // prevent rapid-tap re-entry
    // Boss-gate: on levels marked bossRequired, the exit only opens once the
    // boss is dead. This applies to the final-floor ending door specifically.
    var def = LEVELS[currentLevel];
    if (def && def.bossRequired) {
      var bossAlive = false;
      for (var bi = 0; bi < entities.length; bi++) {
        if ((entities[bi].type === 'boss' || entities[bi].type === 'haruki_boss')
            && entities[bi].alive) { bossAlive = true; break; }
      }
      if (bossAlive) {
        toast(currentLevel === 9 ? '★ ハルキを倒さねば扉は開かない' : '★ BOSS を倒さねば扉は開かない');
        if (audioInitialized) GameEngine.playSound('door');
        return;
      }
    }
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
      // 通常の分岐エンドはすべてバッドエンド扱い。全秘匿書類を集めた状態
      // でのみ真のトゥルーエンドに到達。
      var endType = hasAllSecretDocs() ? 'true_secret' : 'truend_bad';
      triggerEnding(endType);
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
      // Triumphant chord stinger so clearing feels earned
      GameEngine.playSound('level_clear');
    }
    // Brief "→ LV<next>" label in the center of the flash so the
    // player knows where they're being sent.
    var nextDef = LEVELS[nextLevel];
    if (nextDef) {
      try {
        var lbl = document.createElement('div');
        lbl.className = 'noclip-next-label';
        lbl.innerHTML = '→ ' + nextDef.name + '<br><span class="ncl-sub">' + nextDef.subtitle + '</span>';
        document.body.appendChild(lbl);
        setTimeout(function () {
          if (lbl && lbl.parentNode) lbl.parentNode.removeChild(lbl);
        }, 950);
      } catch (e) {}
    }
    // No-clip flash — extended a beat so the celebration audio lands
    var flash = el('noclipFlash');
    flash.style.display = 'block';
    flash.classList.remove('show');
    requestAnimationFrame(function () { flash.classList.add('show'); });
    // Particle burst at player center
    if (GameEngine.addParticle) {
      for (var pburst = 0; pburst < 24; pburst++) {
        var pa = Math.random() * Math.PI * 2;
        var pr = Math.random() * 70;
        GameEngine.addParticle('spark',
          player.x + Math.cos(pa) * pr,
          player.y + Math.sin(pa) * pr);
      }
    }
    setTimeout(function () {
      flash.classList.remove('show');
      flash.style.display = 'none';
      setLevel(nextLevel);
    }, 900);
    toast('★ LEVEL CLEAR ★');
  }

  function getNextLevel(cur) {
    // Normal progression now: 0→1→2→3→4→5→6→7→8→!→Fun→13→14→15→9
    // Lv9 remains the final boss arena.
    var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 9];
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
    haruki_boss: { sound: 'whisper', prob: 0.006 },
    mrhotel: { sound: 'clock_tick', prob: 0.012 },
    haruki: { sound: 'phone', prob: 0.005 },
    echo: { sound: 'whisper', prob: 0.008 },
    faceling: { sound: 'whisper', prob: 0.005 },
    // New 2026-06 entities — give each one a signature ambient cue so
    // distant ones don't sit silent.
    witness: { sound: 'whisper', prob: 0.004 },   // exhale
    lurker:  { sound: 'breath', prob: 0.006 },     // shallow breath
    shadow:  { sound: 'tinnitus', prob: 0.005 },   // ringing
    drowned: { sound: 'pipe_drip', prob: 0.008 },  // water drip
    vinewalker: { sound: 'pipe_creak', prob: 0.005 } // creaking vines
  };

  function updateEntities(dt) {
    if (_isGamePaused()) return;
    var diffE = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    var sMul = diffE.enemySpeedMul;
    // Safe-area complete immunity: entities still wander/animate but their
    // ambient SAN drains (smiler gaze, echo mimic, etc.) and any direct
    // attackPlayer calls are reverted. We snapshot player.san here and
    // restore it after the iteration; attackPlayer() itself bails on
    // inSafeZone so HP is already protected.
    var _safeSanSnapshot = player.inSafeZone ? player.san : null;
    var _safeHpSnapshot  = player.inSafeZone ? player.hp  : null;

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

      // Per-entity walk tracking — feeds drawTypedEntity's bob/sway so
      // monsters visually walk instead of slide. Delta sampled at start
      // of each tick from previous frame's movement.
      if (e._prevX === undefined) { e._prevX = e.x; e._prevY = e.y; }
      var _delta = Math.sqrt((e.x - e._prevX) * (e.x - e._prevX) + (e.y - e._prevY) * (e.y - e._prevY));
      var _spd = _delta / Math.max(dt, 0.001);
      e._walkSpeed = (e._walkSpeed === undefined ? _spd : e._walkSpeed * 0.85 + _spd * 0.15);
      if (e._walkPhase === undefined) e._walkPhase = Math.random() * 6.28;
      // Phase rate: ~6 rad/sec at speed 80 (sprint) = ~1 step/sec; gives
      // a believable plodding cadence without going too cartoony.
      e._walkPhase += (e._walkSpeed || 0) * dt * 0.075;
      e._prevX = e.x; e._prevY = e.y;

      var dx = player.x - e.x;
      var dy = player.y - e.y;
      var distP = Math.sqrt(dx * dx + dy * dy);

      // Perf: skip AI when very far (>16 TS) — wretches and bosses always update
      if (distP > 16 * TS && e.type !== 'wretch' && e.type !== 'boss' && e.type !== 'haruki_boss') {
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
          attackPlayer(8 * dt, e);
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
          if (distP < 1 * TS) attackPlayer(20 * dt, e);
        }
      } else if (e.type === 'partygoer') {
        // Wanders, attacks if too close
        wanderEntity(e, dt, 40 * sMul);
        if (distP < 1.5 * TS) {
          attackPlayer(15 * dt, e);
        }
      } else if (e.type === 'vinewalker') {
        // Stationary plant predator: never chases. Extends a 2.5-tile "tendril
        // reach" that drains SAN + HP while the player is inside it.
        var vTether = 2.5 * TS;
        if (distP < vTether) {
          // Slight pull — player loses 8 HP/sec and 4 SAN/sec while caught
          player.hp = Math.max(0, player.hp - 8 * dt);
          player.san = Math.max(0, player.san - 4 * dt);
          // Hint visual: brief redFlash periodically so the player knows they're
          // being drained.
          e._vinePulseT = (e._vinePulseT || 0) - dt;
          if (e._vinePulseT <= 0) {
            e._vinePulseT = 0.6;
            try { GameEngine.shakeScreen(2, 0.1); } catch (eErr) {}
          }
        }
      } else if (e.type === 'drowned') {
        // Aquatic predator: 2× speed when its own tile is water (type 7),
        // 0.3× speed on dry land. Touch range deals chunky damage + slows
        // player. Repelled by flashlight ON.
        var drGx = Math.floor(e.x / TS), drGy = Math.floor(e.y / TS);
        var drTile = currentMap && currentMap.tiles[drGy] && currentMap.tiles[drGy][drGx];
        var drInWater = drTile === 7;
        var drSpd = (drInWater ? 90 : 18) * sMul;
        if (player.flashlightOn) drSpd *= 0.4; // light deters
        if (distP < 9 * TS && distP > 0.5 * TS) {
          var drx = (dx / distP) * drSpd * dt;
          var dry = (dy / distP) * drSpd * dt;
          if (isWalkable(e.x + drx, e.y)) e.x += drx;
          if (isWalkable(e.x, e.y + dry)) e.y += dry;
        }
        if (distP < 1.4 * TS) {
          attackPlayer(14 * dt, e);
          // Slow the player while grappled
          player._drownedGrabUntil = performance.now() + 200;
        }
      } else if (e.type === 'shadow') {
        // Hovers at mid range (4-6 tiles), drains SAN while in player FOV.
        // Repelled by player's flashlight ON (treat as light source).
        var shTargetDist = 5 * TS;
        var shErr = distP - shTargetDist;
        var shSpd = 25 * sMul;
        if (Math.abs(shErr) > TS) {
          var shx = (dx / distP) * Math.sign(shErr) * shSpd * dt;
          var shy = (dy / distP) * Math.sign(shErr) * shSpd * dt;
          if (isWalkable(e.x + shx, e.y)) e.x += shx;
          if (isWalkable(e.x, e.y + shy)) e.y += shy;
        }
        if (distP < 10 * TS && isFacingPlayer(e) && !player.flashlightOn) {
          player.san = Math.max(0, player.san - 2.5 * dt);
        }
      } else if (e.type === 'lurker') {
        // Weeping Angel rule: stops dead when in the player's view cone,
        // sneaks forward whenever the player looks away. SAN drains when
        // it gets close enough to touch (< 1.5 tiles).
        if (!isFacingPlayer(e) && distP > 1.4 * TS) {
          var luSpd = 60 * sMul;
          var lux = (dx / distP) * luSpd * dt;
          var luy = (dy / distP) * luSpd * dt;
          if (isWalkable(e.x + lux, e.y)) e.x += lux;
          if (isWalkable(e.x, e.y + luy)) e.y += luy;
        }
        if (distP < 1.5 * TS) {
          player.san = Math.max(0, player.san - 6 * dt);
          attackPlayer(8 * dt, e);
        }
      } else if (e.type === 'witness') {
        // Stationary observer: never moves, just stands. SAN drains slowly
        // when the player has it in FOV (similar to wretch but milder, and
        // unaffected by water tiles). Player can ignore it by averting eyes.
        e.x = e.x; e.y = e.y; // hold position
        if (distP < 10 * TS) {
          if (isFacingPlayer(e)) {
            player.san = Math.max(0, player.san - 1.0 * dt);
          }
        }
      } else if (e.type === 'civilian') {
        // Neutral NPC — wanders peacefully, never attacks. If player walks
        // up close, the civilian halts briefly (acknowledging presence) then
        // resumes wandering. Hostile only if attacked (handled in damage path).
        wanderEntity(e, dt, 22 * sMul);
        if (distP < 2.0 * TS) {
          // Stall their wander step by zeroing their angular drift this frame
          e.angle = (e.angle || 0) + (Math.random() - 0.5) * dt * 0.4;
          // Occasional chatter — every civilian rolls their own cooldown so a
          // group doesn't all greet at once.
          e._chatterCdT = (e._chatterCdT || 0) - dt;
          if (e._chatterCdT <= 0) {
            e._chatterCdT = 8 + Math.random() * 6;
            maybeFireCivilianChatter();
          }
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
              attackPlayer(22 * dt, e);
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
        if (distP < 0.8 * TS) attackPlayer(8 * dt, e);
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
        if (distP < 0.8 * TS) attackPlayer(6 * dt, e);
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
          attackPlayer(8 * dt, e);
          if (Math.random() < 0.002 && audioInitialized) {
            GameEngine.playPositionalSound('whisper', e.x, e.y);
          }
        }
      } else if (e.type === 'haruki') {
        // HARUKI 3-phase tracking:
        //  Phase 1 (>12 TS): 遠い - phone bell only, wanders slowly
        //  Phase 2 (6-12 TS): 視認 - approaches with female humming
        //  Phase 3 (<6 TS): 接触寸前 - sprint speed, breath/whisper, jumpscare risk
        // Haruki charm: while the ward is active, force haruki into a
        // wandering "repelled" state and skip the approach/contact phases.
        if (player._harukiWardUntil && performance.now() < player._harukiWardUntil) {
          e.state = 'repelled';
          wanderEntity(e, dt, 18 * sMul);
          continue;
        }
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
          attackPlayer(18 * dt, e);
          // Brief jumpscare
          if (Math.random() < 0.05) {
            var simg = GameEngine.images['assets/img/haruki_scary.png'];
            if (simg) GameEngine.flashImage(simg, 200);
            if (audioInitialized) GameEngine.playSound('jumpscare');
          }
        }
      } else if (e.type === 'boss' || e.type === 'haruki_boss') {
        // Boss: 4-phase, boss HP tracked separately.
        e.bossHp = e.bossHp !== undefined ? e.bossHp : 200;
        // 2026-06-07 boss HP bump: percent thresholds against bossHpMax so
        // phases still trigger at the correct ratios (75% / 45% / 17.5%)
        // instead of the old hardcoded 150/90/35 values which only fired
        // in the last quarter of the new 600/900 HP pool.
        var bMax = e.bossHpMax || e.bossHp || 200;
        var ratio = bMax > 0 ? e.bossHp / bMax : 0;
        var phase = 1;
        if (ratio < 0.75) phase = 2;
        if (ratio < 0.45) phase = 3;
        if (ratio < 0.175 && e.type === 'haruki_boss') phase = 4;
        // Phase transition VFX + audio + situational TTS. One-shot per phase
        // so transitions stay impactful. e._lastPhase tracks the previous fire.
        if (e._lastPhase !== phase) {
          var prevPh = e._lastPhase || 1;
          e._lastPhase = phase;
          // Skip the very first init firing (phase=1 → phase=1) to avoid a
          // VFX flash at boss spawn.
          if (phase > 1 || prevPh !== undefined) {
            if (phase === 2) {
              toast('ハルキ — 第2形態 加速');
              GameEngine.shakeScreen(14, 0.7);
              if (audioInitialized) GameEngine.playSound('stinger');
              if (e.type === 'haruki_boss') speakSituational('boss_approach', { cooldownMs: 8000 });
            } else if (phase === 3) {
              toast('ハルキ — 第3形態 影分身');
              GameEngine.shakeScreen(22, 1.1);
              if (audioInitialized) { GameEngine.playSound('stinger'); GameEngine.playSound('whisper'); }
              if (e.type === 'haruki_boss') speakSituational('boss_approach', { cooldownMs: 8000 });
            } else if (phase === 4) {
              toast('★ ハルキ — 残光形態 ★');
              GameEngine.shakeScreen(30, 1.4);
              if (audioInitialized) { GameEngine.playSound('jumpscare'); GameEngine.playSound('whisper'); }
              speakSituational('boss_approach', { cooldownMs: 6000 });
              // Berserk red tint
              try {
                var hl = el('hallucinationLayer');
                if (hl) {
                  hl.style.display = 'block';
                  hl.style.background = 'radial-gradient(circle at center, rgba(200,40,40,0.15) 0%, rgba(80,0,0,0.4) 100%)';
                  setTimeout(function () {
                    if (hl) hl.style.background = '';
                  }, 2400);
                }
              } catch (er) {}
            }
          }
        }
        // Phase-modulated speed. Berserk (phase 4) is ~2x phase 3.
        var phaseSpdMul = phase === 4 ? 2.1 : (1 + (phase - 1) * 0.5);
        var bossSpd = 50 * sMul * phaseSpdMul;
        // Haruki charm warding also blocks haruki_boss approach (the boss
        // becomes a slow wanderer and cannot close to attack range).
        var bossWarded = (e.type === 'haruki_boss'
                         && player._harukiWardUntil
                         && performance.now() < player._harukiWardUntil);
        if (bossWarded) bossSpd *= 0.25;
        wanderEntity(e, dt, bossSpd);
        // Move toward player if in range. Phase 4 has an extended chase range.
        var chaseRange = (phase === 4 ? 14 : 10) * TS;
        if (!bossWarded && distP < chaseRange) {
          var bsx = (dx / distP) * bossSpd * dt;
          var bsy = (dy / distP) * bossSpd * dt;
          if (isWalkable(e.x + bsx, e.y)) e.x += bsx;
          if (isWalkable(e.x, e.y + bsy)) e.y += bsy;
        }
        // Phase 2+ telegraphed dash: every ~4s, if player in mid-range, lunge.
        if (!bossWarded && phase >= 2 && distP > 2 * TS && distP < 8 * TS) {
          e._dashCdT = (e._dashCdT || 0) - dt;
          if (e._dashCdT <= 0) {
            e._dashCdT = phase >= 4 ? 1.8 : (phase === 3 ? 2.6 : 4.0);
            var dashSpd = bossSpd * (phase === 4 ? 3.2 : 2.4);
            var ddx = (dx / distP) * dashSpd * dt * 8;
            var ddy = (dy / distP) * dashSpd * dt * 8;
            if (isWalkable(e.x + ddx, e.y)) e.x += ddx;
            if (isWalkable(e.x, e.y + ddy)) e.y += ddy;
            if (audioInitialized && phase >= 3) GameEngine.playSound('hit');
          }
        }
        if (distP < 1.6 * TS) {
          attackPlayer((8 + phase * 4) * dt, e);
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
        // Phase 4: occasional hallucination flash + 1 extra shadow on entry
        if (phase === 4 && !e._spawnedBerserkShadow) {
          e._spawnedBerserkShadow = true;
          entities.push({
            type: 'crawler',
            x: e.x + (Math.random() - 0.5) * 5 * TS,
            y: e.y + (Math.random() - 0.5) * 5 * TS,
            angle: 0, state: 'wait', stateTimer: 0,
            alive: true, hp: 60, color: '#2a0a0a', bodyColor: '#100'
          });
        }
        if (phase === 4) {
          e._berserkPulseT = (e._berserkPulseT || 0) - dt;
          if (e._berserkPulseT <= 0) {
            e._berserkPulseT = 1.2;
            // Brief screen pulse — sells the residual-glow theme.
            try {
              var hl2 = el('hallucinationLayer');
              if (hl2) {
                hl2.style.display = 'block';
                hl2.style.opacity = '0.55';
                setTimeout(function () { if (hl2) hl2.style.opacity = ''; }, 180);
              }
            } catch (er) {}
          }
        }
      }

      // Common: collision with player triggers damage
      if (distP < 0.8 * TS && e.type !== 'skinstealer' && e.state !== 'corpse') {
        attackPlayer(10 * dt, e);
      }
    }
    // Safe-area: restore snapshots so ambient entity drains are reverted.
    if (_safeSanSnapshot !== null) player.san = _safeSanSnapshot;
    if (_safeHpSnapshot  !== null) player.hp  = _safeHpSnapshot;
  }

  function isFacingPlayer(e) {
    var angleTo = Math.atan2(player.y - e.y, player.x - e.x);
    var pAngleTo = Math.atan2(e.y - player.y, e.x - player.x);
    var rel = pAngleTo - player.angle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return Math.abs(rel) < Math.PI / 3.5; // within FOV cone
  }

  // Directional damage flash — brief red glow on the screen edge facing
  // the source of damage. Helps the player react when attacked from
  // behind or the side where the threat-compass arc is small.
  function _flashDamageDirection(srcEntity) {
    var pad = el('damageDirOverlay');
    if (!pad || !srcEntity) return;
    var dx = srcEntity.x - player.x;
    var dy = srcEntity.y - player.y;
    var worldAng = Math.atan2(dy, dx);
    var relAng = worldAng - player.angle;
    while (relAng > Math.PI) relAng -= Math.PI * 2;
    while (relAng < -Math.PI) relAng += Math.PI * 2;
    // Classify: forward / right / back / left band.
    var band = 'damage-back';
    if (relAng > -Math.PI / 4 && relAng < Math.PI / 4) band = 'damage-fwd';
    else if (relAng >= Math.PI / 4 && relAng < 3 * Math.PI / 4) band = 'damage-right';
    else if (relAng <= -Math.PI / 4 && relAng > -3 * Math.PI / 4) band = 'damage-left';
    pad.className = 'damage-dir-overlay ' + band;
    pad.classList.add('flash');
    setTimeout(function () { if (pad) pad.classList.remove('flash'); }, 320);
  }
  function attackPlayer(dmg, srcEntity) {
    // Spawn grace: for the first ~2.8s after entering a level, the player is
    // i-frame so that ambush-style entity placement (e.g. Lv7 hounds packed
    // around spawn) can't instakill before the player has even oriented.
    if (typeof spawnGraceUntil === 'number' && performance.now() < spawnGraceUntil) {
      return;
    }
    if (srcEntity) {
      try { _flashDamageDirection(srcEntity); } catch (e) {}
    }
    // No damage during encounter / scripted cinematics — player should never
    // be punished for events they can't react to.
    if (_inCinematic) return;
    // No damage while overlays freeze gameplay (phone, settings, note viewer)
    if (typeof _isGamePaused === 'function' && _isGamePaused()) return;
    // Safe-area complete immunity: while standing on a safe tile, no damage
    // can land. SAN drain is similarly skipped elsewhere via player.inSafeZone.
    if (player.inSafeZone) return;
    if (cheatActive) dmg *= 0.4;
    // Mirror shard: reflect 80% of incoming damage onto the nearest entity
    // and absorb the rest. While the shard is active, damage is greatly
    // reduced and the attacker takes the deflected hit.
    if (player._mirrorShardUntil && performance.now() < player._mirrorShardUntil) {
      var reflectedDmg = dmg * 0.8;
      dmg = dmg * 0.2;
      var bestM = null, bestMD = Infinity;
      for (var mri = 0; mri < entities.length; mri++) {
        var me = entities[mri];
        if (!me.alive) continue;
        var mdx = me.x - player.x, mdy = me.y - player.y;
        var mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mDist < bestMD) { bestMD = mDist; bestM = me; }
      }
      if (bestM && bestMD < 4 * TS) {
        if (bestM.type === 'boss' || bestM.type === 'haruki_boss') {
          bestM.bossHp = (bestM.bossHp !== undefined ? bestM.bossHp : 200) - reflectedDmg * 2;
          if (bestM.bossHp <= 0) { bestM.alive = false; }
        } else {
          bestM.hp = (bestM.hp !== undefined ? bestM.hp : 100) - reflectedDmg * 4;
          if (bestM.hp <= 0) { bestM.alive = false; bestM.deathAt = performance.now(); }
        }
      }
    }
    var prevHp = player.hp;
    player.hp = Math.max(0, player.hp - dmg);
    // Always provide damage feedback: red flash + shake + sound + vital pulse
    GameEngine.redFlash();
    var hpFillEl = document.querySelector('.vital-fill.vital-hp');
    if (hpFillEl) {
      hpFillEl.classList.remove('hit');
      // Force reflow so the animation can restart immediately on rapid hits
      void hpFillEl.offsetWidth;
      hpFillEl.classList.add('hit');
    }
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
    // Death-fade ramp — render loop has already gated alive-or-recent.
    // Apply globalAlpha + a vertical sink so dead bodies drop into the
    // floor as they fade out. Save/restore wraps the entire entity draw.
    var _hasFade = (!e.alive && typeof e._deathFade === 'number');
    if (_hasFade) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, e._deathFade);
      var sinkPx = spriteH * 0.5 * (e._deathSink || 0);
      startY += sinkPx;
    }

    // Walk-cycle bob — vertical bounce synced to per-entity walkPhase
    // (set in updateEntities from frame-to-frame movement). Amplitude
    // ramps with speed so stationary entities don't bob (only breath).
    // Capped at ~3% of sprite height so the cadence is felt without
    // turning every monster into a cartoon.
    var walkAmp = Math.min(1, (e._walkSpeed || 0) / 80);
    var walkBobPx = Math.sin(e._walkPhase || 0) * spriteH * 0.030 * walkAmp;
    startY += walkBobPx;
    // Subtle lateral sway at half the bob frequency — heavier entities
    // (bosses) get more sway for menacing gait.
    var swayMul = (e.type === 'boss' || e.type === 'haruki_boss') ? 0.020 : 0.008;
    var walkSwayPx = Math.sin((e._walkPhase || 0) * 0.5) * spriteW * swayMul * walkAmp;
    startX += walkSwayPx;
    screenX += walkSwayPx;

    var fogFactor = Math.max(0.15, 1 - depthTiles / maxDist);
    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;

    ctx.save();
    ctx.globalAlpha = fogFactor;

    // Foot shadow — short horizontal ellipse at the entity's floor line.
    // Grounds the sprite (otherwise entities feel like they're floating
    // a few pixels above the floor in the raycaster projection). Bigger
    // for bosses, scaled with depth.
    var _sCenterCol = Math.round(screenX);
    if (_sCenterCol >= 0 && _sCenterCol < w && zBuf[_sCenterCol] > depthTiles) {
      var _shadowR = spriteW * 0.42;
      var _shadowH = Math.max(2, spriteH * 0.035);
      var _shadowY = startY + spriteH - _shadowH * 0.4;
      var _shadowAlpha = (e.type === 'boss' || e.type === 'haruki_boss') ? 0.65 : 0.50;
      ctx.fillStyle = 'rgba(0,0,0,' + (_shadowAlpha * fogFactor).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(screenX, _shadowY, _shadowR, _shadowH, 0, 0, Math.PI * 2);
      ctx.fill();
    }

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
        // Mosaic Haruki's face — render the head from a pre-mosaicked
        // offscreen canvas instead of the raw image. Falls back to the
        // raw draw if the offscreen helper isn't available.
        var harukiHeadSrc = _getMosaickedHaruki(useImg);
        // Draw image columns with z-buffer occlusion (no full-rect overlays to avoid wall tinting)
        for (var col = startCol; col < endCol; col++) {
          if (zBuf[col] > depthTiles) {
            var srcX = ((col - headX) / headW) * harukiHeadSrc.width;
            ctx.drawImage(harukiHeadSrc, srcX, 0, 1, harukiHeadSrc.height, col, headY, 1, headH);
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
    } else if (e.type === 'boss' || e.type === 'haruki_boss') {
      // Large humanoid with crown and floating presence
      var bsH = spriteH * 1.1;
      var bsY = startY - spriteH * 0.05;
      var bsW = spriteW * 0.6;
      var bsX = screenX - bsW / 2;
      // Haruki variant: deeper crimson aura and use haruki head sprite instead of crown silhouette.
      var isHk = (e.type === 'haruki_boss');
      drawShapedSprite(ctx, bsX, bsY, bsW, bsH, screenX, depthTiles, zBuf, w,
        isHk ? '#2a0808' : '#1c0028',
        isHk ? '#100202' : '#0a0010');
      if (isHk) {
        // Haruki head: replace the crown with the haruki_scary.png portrait
        // floating above body. Pre-mosaicked via _getMosaickedHaruki.
        var hkBImg = GameEngine.images['assets/img/haruki_scary.png'] || GameEngine.images['assets/img/haruki.png'];
        if (hkBImg && hkBImg.complete && hkBImg.naturalWidth) {
          var hkBHeadH = bsH * 0.48;
          var hkBHeadW = hkBHeadH * (hkBImg.naturalWidth / hkBImg.naturalHeight);
          var hkBHeadX = screenX - hkBHeadW / 2;
          var hkBHeadY = bsY - hkBHeadH * 0.3;
          if (zBuf[Math.round(screenX)] > depthTiles) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, fogFactor * 1.2);
            ctx.drawImage(_getMosaickedHaruki(hkBImg), hkBHeadX, hkBHeadY, hkBHeadW, hkBHeadH);
            ctx.restore();
          }
        }
      }
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
      // Default — try the engine's detailed renderSprite path which has
      // bespoke face/body details for witness/lurker/shadow/drowned/
      // vinewalker/civilian/faceling. Fall back to the basic blob if
      // the engine doesn't expose drawEntity.
      if (typeof GameEngine.drawEntity === 'function') {
        // Close our own ctx.save (from the death-fade wrapper) first if
        // present, then re-open after. drawEntity manages its own save.
        try { GameEngine.drawEntity(e); } catch (err) {
          drawShapedSprite(ctx, startX, startY, spriteW, spriteH, screenX, depthTiles, zBuf, w,
            e.color || '#444', '#222');
        }
      } else {
        drawShapedSprite(ctx, startX, startY, spriteW, spriteH, screenX, depthTiles, zBuf, w,
          e.color || '#444', '#222');
      }
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
    // Close the death-fade wrapper save (added at the top of this fn).
    if (_hasFade) ctx.restore();
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
  // ── Mosaicked Haruki cache ──
  // Per user request 2026-06-07: ハルキの顔にモザイクをかける.
  // Pre-render each Haruki source image to a tiny offscreen canvas
  // (~16px wide) then upscale to original size with imageSmoothingEnabled
  // = false — gives a real blocky mosaic that survives the per-column
  // draw loop in the entity-sprite path. Cached per source image.
  var _harukiMosaicCache = new Map();
  function _getMosaickedHaruki(srcImg) {
    if (!srcImg || !srcImg.complete || !srcImg.naturalWidth) return srcImg;
    var cached = _harukiMosaicCache.get(srcImg);
    if (cached) return cached;
    var w = srcImg.naturalWidth;
    var h = srcImg.naturalHeight;
    // Mosaic block count — bumped to 8 wide blocks per user request
    // 2026-06-07 (顔が判別できないぐらいに). Lower count = bigger blocks.
    var blockCount = 8;
    var smallW = Math.max(3, Math.round(blockCount));
    var smallH = Math.max(3, Math.round(blockCount * (h / w)));
    var off1 = document.createElement('canvas');
    off1.width = smallW; off1.height = smallH;
    var c1 = off1.getContext('2d');
    c1.imageSmoothingEnabled = true; // smooth downscale
    c1.drawImage(srcImg, 0, 0, smallW, smallH);
    var off2 = document.createElement('canvas');
    off2.width = w; off2.height = h;
    var c2 = off2.getContext('2d');
    c2.imageSmoothingEnabled = false; // crisp upscale = mosaic
    c2.drawImage(off1, 0, 0, w, h);
    _harukiMosaicCache.set(srcImg, off2);
    return off2;
  }

  // ── Rasterized weapon SVG cache for world pickups ──
  // The WEAPON_SVG strings are SVG markup; the world pickup renderer
  // needs to drawImage them to the offscreen pickup canvas. We cache
  // an HTMLImageElement per weapon id so the encode-and-load happens
  // once per session.
  var _weaponWorldImgCache = {};
  function _getWeaponWorldImage(itemId) {
    if (_weaponWorldImgCache[itemId] !== undefined) return _weaponWorldImgCache[itemId];
    var svg = WEAPON_SVG[itemId];
    if (!svg) { _weaponWorldImgCache[itemId] = null; return null; }
    try {
      var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { /* keep blob URL alive — released on session end */ };
      img.onerror = function () { _weaponWorldImgCache[itemId] = null; };
      img.src = url;
      _weaponWorldImgCache[itemId] = img;
      return img;
    } catch (e) {
      _weaponWorldImgCache[itemId] = null;
      return null;
    }
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
    // User request 2026-06-08: 「道に落ちている武器のアイコンも
    // リアルなものに合わせて」. If this pickup is a weapon with a
    // SVG silhouette, switch to drawing the rasterized SVG instead of
    // the emoji glyph below. Falls back to emoji if the image hasn't
    // loaded yet (first-frame race).
    var harukiWeaponImg = (itemId && WEAPON_SVG[itemId]) ? _getWeaponWorldImage(itemId) : null;
    var useSvg = harukiWeaponImg && harukiWeaponImg.complete && harukiWeaponImg.naturalWidth > 0;
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
    // Icon with strong outline.
    octx.globalAlpha = 1;
    if (useSvg) {
      // Draw the realistic SVG weapon silhouette. Sized slightly larger
      // than the emoji glyph used to be so the silhouette reads as a
      // proper "pickup on the floor" instead of a tiny rune.
      var svgSize = iconSize * 1.35;
      var svgX = oCenterX - svgSize / 2;
      var svgY = offSize / 2 - svgSize / 2;
      // Subtle dark drop-shadow under the SVG so it pops off the
      // ground ring against bright wallpaper themes.
      octx.save();
      octx.shadowColor = 'rgba(0,0,0,0.75)';
      octx.shadowBlur = 6;
      octx.shadowOffsetY = 2;
      octx.drawImage(harukiWeaponImg, svgX, svgY, svgSize, svgSize);
      octx.restore();
    } else {
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
    }

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
  //  FLOOR DECALS — blood splats, scorch marks
  // ============================================================
  // Persistent floor stains. Spawned on entity death so kills leave a
  // visible trace at the corpse site, then fade after ~25s. Bounded
  // pool (oldest dropped) so corpse-spam levels stay performant.
  var DECAL_MAX = 30;
  var decals = []; // { kind, x, y, bornAt, life, radiusTiles, color }
  function pushDecal(kind, x, y, opts) {
    opts = opts || {};
    if (decals.length >= DECAL_MAX) decals.shift();
    decals.push({
      kind: kind,
      x: x, y: y,
      bornAt: performance.now(),
      life: opts.life || 25000, // ms
      radiusTiles: opts.radiusTiles || 0.55,
      color: opts.color || 'rgba(120,20,20,0.55)'
    });
  }
  function clearDecals() { decals = []; }
  function drawDecals(ctx) {
    if (!decals.length) return;
    var w = GameEngine.width;
    var h = GameEngine.height;
    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    var nowT = performance.now();
    for (var i = 0; i < decals.length; i++) {
      var d = decals[i];
      var age = nowT - d.bornAt;
      if (age > d.life) continue;
      var dx = d.x - player.x;
      var dy = d.y - player.y;
      var tX = -dx * sinT + dy * cosT;
      var tY = dx * cosT + dy * sinT;
      if (tY <= 0.1) continue;
      var depthTiles = tY / TS;
      if (depthTiles > 14) continue;
      var c = Math.round((w / 2) * (1 + tX / tY));
      if (c < 0 || c >= w || zBuf[c] <= depthTiles) continue;
      var fullH = Math.abs(h / depthTiles) * 0.8;
      var floorY = (h - fullH) / 2 + fullH - 1;
      var radPx = (d.radiusTiles * TS / tY) * (h / TS) * 0.55;
      // Fade last 40% of life
      var fadeR = 1 - Math.max(0, (age - d.life * 0.6) / (d.life * 0.4));
      ctx.fillStyle = d.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, fadeR)) * Math.max(0.10, 1 - depthTiles / 14);
      ctx.beginPath();
      ctx.ellipse(c, floorY, Math.max(1, radPx), Math.max(1, radPx * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ============================================================
  //  AMBIENT PARTICLES — dust motes, embers, bubbles, leaves
  // ============================================================
  // Bounded pool (PARTICLE_POOL_SIZE max) spawning around the player.
  // Each kind has gravity / drift / lifespan that fits the level theme.
  // gfxQuality === 'low' disables the whole system to spare mobile fillrate.
  var PARTICLE_POOL_SIZE = 36;
  var particles = []; // { kind, x, y, z, vx, vy, vz, life, lifeMax, size, _seedR }
  var particleConfig = null; // { kind, rate (spawns/sec) }

  // kind → physics + visual profile
  var PARTICLE_KINDS = {
    dust: {
      // White motes drifting through fluorescent light — backrooms-y
      gravity: -0.5,   // slight upward float
      driftX: 6, driftY: 6,
      life: 8.0,
      size: 0.7,
      color: [220, 220, 200],
      alphaMul: 0.45
    },
    ember: {
      // Glowing orange embers rising — Lv6/Lv9
      gravity: -4.0,
      driftX: 3, driftY: 3,
      life: 3.0,
      size: 0.9,
      color: [255, 140, 60],
      alphaMul: 0.85,
      glow: true
    },
    bubble: {
      // Upward bubbles in submerged Lv14
      gravity: -8.0,
      driftX: 2, driftY: 2,
      life: 4.0,
      size: 1.1,
      color: [200, 230, 255],
      alphaMul: 0.55,
      ring: true
    },
    leaf: {
      // Falling leaves in garden Lv15 / suburbs Lv7
      gravity: 1.5,
      driftX: 18, driftY: 18,
      life: 9.0,
      size: 1.2,
      color: [180, 140, 60],
      alphaMul: 0.80
    },
    spore: {
      // Pale green spores in Lv15 vine / Lv8 hive corners
      gravity: -0.8,
      driftX: 10, driftY: 10,
      life: 7.0,
      size: 0.6,
      color: [170, 230, 160],
      alphaMul: 0.55,
      glow: true
    },
    ash: {
      // Slow grey ash — Lv12 / Lv9 boss area
      gravity: 0.6,
      driftX: 8, driftY: 8,
      life: 7.5,
      size: 0.8,
      color: [180, 180, 175],
      alphaMul: 0.60
    }
  };

  // Per-level particle assignment. rate is in spawns/second.
  var LEVEL_PARTICLES = {
    0:  { kind: 'dust',   rate: 3.5 },
    1:  { kind: 'dust',   rate: 2.5 },
    2:  { kind: 'dust',   rate: 2.0 },
    3:  { kind: 'spore',  rate: 1.5 },
    4:  { kind: 'dust',   rate: 3.0 },
    5:  { kind: 'dust',   rate: 2.5 },
    6:  { kind: 'ember',  rate: 1.8 },
    7:  { kind: 'leaf',   rate: 2.2 },
    8:  { kind: 'spore',  rate: 1.8 },
    9:  { kind: 'ash',    rate: 2.4 },
    11: { kind: 'leaf',   rate: 1.6 },
    12: { kind: 'ash',    rate: 2.6 },
    13: { kind: 'dust',   rate: 4.0 },
    14: { kind: 'bubble', rate: 3.5 },
    15: { kind: 'leaf',   rate: 3.0 }
  };

  function initParticlesForLevel(levelId) {
    particles = [];
    particleConfig = LEVEL_PARTICLES[levelId] || null;
  }

  // Spawn a single particle near the player. Position is jittered within
  // 6 tiles around player so the system stays visually local and we
  // don't waste pool slots on far-off particles the player can't see.
  var _particleSpawnAcc = 0;
  function _spawnOneParticle() {
    if (!particleConfig || !PARTICLE_KINDS[particleConfig.kind]) return;
    if (particles.length >= PARTICLE_POOL_SIZE) return;
    var def = PARTICLE_KINDS[particleConfig.kind];
    var ang = Math.random() * Math.PI * 2;
    var dist = (1.5 + Math.random() * 4.5) * TS;
    var px = player.x + Math.cos(ang) * dist;
    var py = player.y + Math.sin(ang) * dist;
    // Verify roughly walkable so we don't spawn inside walls
    if (!isWalkable(px, py)) return;
    var z = 0.4 + Math.random() * 0.55; // 0..1 ceiling-relative height
    if (def.gravity < 0) z = Math.random() * 0.35; // upward → start low
    particles.push({
      kind: particleConfig.kind,
      x: px, y: py,
      z: z,
      vx: (Math.random() - 0.5) * def.driftX,
      vy: (Math.random() - 0.5) * def.driftY,
      vz: 0,
      life: def.life,
      lifeMax: def.life,
      size: def.size * (0.7 + Math.random() * 0.6),
      _seedR: Math.random()
    });
  }

  function updateParticles(dt) {
    if (gfxQuality === 'low') return;
    if (!particleConfig) return;
    _particleSpawnAcc += dt * particleConfig.rate;
    while (_particleSpawnAcc >= 1) {
      _spawnOneParticle();
      _particleSpawnAcc -= 1;
    }
    // Integrate + cull
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      var def = PARTICLE_KINDS[p.kind];
      if (!def) { particles.splice(i, 1); continue; }
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      // Vertical (z) motion — small steps, gravity controls upward float / fall
      p.z -= def.gravity * dt * 0.05;
      if (p.z < 0.02 || p.z > 1.05) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Drift wobble — natural sway
      p.vx += (Math.random() - 0.5) * def.driftX * dt * 0.5;
      p.vy += (Math.random() - 0.5) * def.driftY * dt * 0.5;
      // Decay velocity slightly so particles don't accelerate forever
      p.vx *= 0.97;
      p.vy *= 0.97;
    }
  }

  function drawParticles(ctx) {
    if (gfxQuality === 'low' || !particles.length) return;
    var w = GameEngine.width;
    var h = GameEngine.height;
    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var def = PARTICLE_KINDS[p.kind];
      if (!def) continue;
      var dx = p.x - player.x;
      var dy = p.y - player.y;
      var tX = -dx * sinT + dy * cosT;
      var tY = dx * cosT + dy * sinT;
      if (tY <= 0.1) continue;
      var depthTiles = tY / TS;
      if (depthTiles > 14) continue; // close-range only
      var screenX = (w / 2) * (1 + tX / tY);
      var c = Math.round(screenX);
      if (c < 0 || c >= w || zBuf[c] <= depthTiles) continue;
      var spriteH = Math.abs(h / depthTiles) * 0.8;
      // z=0 → floor, z=1 → ceiling. Translate to vertical screen offset.
      var floorY = (h - spriteH) / 2 + spriteH;
      var ceilY = (h - spriteH) / 2;
      var yScreen = floorY - (floorY - ceilY) * p.z;
      // Size in px; tiny near, smaller far.
      var sizePx = Math.max(1, p.size * (220 / depthTiles));
      var lifeRatio = p.life / p.lifeMax;
      // Fade in over first 12% of life, hold, fade out last 30%
      var fadeIn = Math.min(1, (1 - lifeRatio) * 8);
      var fadeOut = Math.min(1, lifeRatio / 0.3);
      var alpha = def.alphaMul * fadeIn * fadeOut * Math.max(0.15, 1 - depthTiles / 14);
      var col = def.color;
      ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha.toFixed(2) + ')';
      if (def.ring) {
        ctx.beginPath();
        ctx.arc(screenX, yScreen, sizePx, 0, Math.PI * 2);
        ctx.stroke && (ctx.strokeStyle = ctx.fillStyle, ctx.lineWidth = 1, ctx.stroke());
        ctx.fill();
      } else if (def.glow) {
        var glowR = sizePx * 3;
        var grd = ctx.createRadialGradient(screenX, yScreen, 0, screenX, yScreen, glowR);
        grd.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha.toFixed(2) + ')');
        grd.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
        ctx.fillStyle = grd;
        ctx.fillRect(screenX - glowR, yScreen - glowR, glowR * 2, glowR * 2);
      } else {
        ctx.beginPath();
        ctx.arc(screenX, yScreen, sizePx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ============================================================
  //  PROP RENDERER (decorative furniture / objects, billboard style)
  // ============================================================
  // Each kind paints a stylised silhouette using filled rects + the engine's
  // z-buffer for occlusion (so a desk hidden behind a wall is invisible).
  // Cheap on the GPU/CPU vs full entity sprites — no eyes / breathing /
  // per-row drawImage. ~3-8 rects per prop.
  function drawProp(ctx, p) {
    if (!currentMap) return;
    var w = GameEngine.width;
    var h = GameEngine.height;
    var dx = p._wx - player.x;
    var dy = p._wy - player.y;
    var cosT = Math.cos(player.angle);
    var sinT = Math.sin(player.angle);
    var tX = -dx * sinT + dy * cosT;
    var tY = dx * cosT + dy * sinT;
    if (tY <= 0.1) return;
    var depthTiles = tY / TS;
    var maxDist = 18;
    if (depthTiles > maxDist) return;

    var def = PROP_KIND_DEFAULTS[p.kind] || { hScale: 0.5, wScale: 0.6 };
    var screenX = (w / 2) * (1 + tX / tY);
    var fullH = Math.abs(h / depthTiles) * 0.8;
    var spriteH = fullH * def.hScale;
    var spriteW = fullH * def.wScale;
    // Floor-anchored: bottom of the sprite sits at the horizon (mid-screen),
    // top extends upward by spriteH.
    var floorY = (h - fullH) / 2 + fullH;
    var topY = floorY - spriteH;
    var startX = screenX - spriteW / 2;
    var endX = startX + spriteW;

    var zBuf = GameEngine._zBuffer;
    if (!zBuf) return;
    var fog = Math.max(0.10, 1 - depthTiles / maxDist);

    ctx.save();
    ctx.globalAlpha = fog;

    function _bar(x, y, ww, hh, col) {
      var sc = Math.max(0, Math.floor(x));
      var ec = Math.min(w, Math.ceil(x + ww));
      ctx.fillStyle = col;
      for (var c = sc; c < ec; c++) {
        if (c >= 0 && c < w && zBuf[c] > depthTiles) ctx.fillRect(c, y, 1, hh);
      }
    }
    function _dot(cx, cy, rr, col) {
      var c = Math.round(cx);
      if (c < 0 || c >= w || zBuf[c] <= depthTiles) return;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft floor shadow under every prop — small dark ellipse anchored at
    // floorY. Reads as a grounding pad so the prop doesn't feel cut-out.
    var shW = spriteW * 0.95;
    var shStartX = screenX - shW / 2;
    var shadowBar = Math.max(2, fullH * 0.018);
    _bar(shStartX, floorY - shadowBar * 0.4, shW, shadowBar, 'rgba(0,0,0,0.45)');

    switch (p.kind) {
      case 'desk': {
        // Wide rectangular top + 4 thin legs
        var topH = spriteH * 0.28;
        _bar(startX, topY, spriteW, topH, '#5a3820');
        // Highlight stripe at the front edge so it reads as a flat surface
        _bar(startX, topY + topH - 1, spriteW, 1, 'rgba(120,80,40,0.9)');
        var legH = spriteH - topH;
        var legW = Math.max(1, spriteW * 0.05);
        _bar(startX, topY + topH, legW, legH, '#2a1408');
        _bar(endX - legW, topY + topH, legW, legH, '#2a1408');
        break;
      }
      case 'chair': {
        // Back + seat + legs (single block silhouette)
        var seatH = spriteH * 0.20;
        var seatY = topY + spriteH * 0.55;
        var backH = spriteH * 0.55;
        _bar(startX, topY, spriteW, backH, '#2a1a12');
        _bar(startX, seatY, spriteW, seatH, '#3a2418');
        var cLegW = Math.max(1, spriteW * 0.10);
        _bar(startX, seatY + seatH, cLegW, spriteH * 0.25, '#180c06');
        _bar(endX - cLegW, seatY + seatH, cLegW, spriteH * 0.25, '#180c06');
        break;
      }
      case 'pc': {
        // Monitor + base
        var monH = spriteH * 0.65;
        _bar(startX, topY, spriteW, monH, '#181820');
        _bar(startX + 1, topY + 1, spriteW - 2, monH - 2, '#202d3a');
        // Screen glow (cool blue, slight pulse)
        var glowI = 0.55 + Math.sin(performance.now() * 0.004 + p._wobble) * 0.1;
        ctx.fillStyle = 'rgba(80,160,220,' + (fog * glowI * 0.6).toFixed(2) + ')';
        ctx.fillRect(startX + 2, topY + 2, Math.max(1, spriteW - 4), Math.max(1, monH - 4));
        // Base
        var baseW = spriteW * 0.45;
        var baseX = screenX - baseW / 2;
        _bar(baseX, topY + monH, baseW, spriteH * 0.10, '#101018');
        _bar(startX + spriteW * 0.2, topY + monH + spriteH * 0.10, spriteW * 0.6, spriteH * 0.06, '#181820');
        break;
      }
      case 'bed': {
        // Mattress (white sheets) + lower frame + headboard hint
        var mattH = spriteH * 0.55;
        _bar(startX, topY + spriteH * 0.10, spriteW, mattH, '#d6d2c4');
        _bar(startX, topY + spriteH * 0.10, spriteW, 2, '#f0ecdc'); // sheet highlight
        // Pillow (left or right random — use wobble)
        var pillowW = spriteW * 0.25;
        var pillowX = (p._wobble % 1 > 0.5) ? startX + 2 : endX - pillowW - 2;
        _bar(pillowX, topY + spriteH * 0.10, pillowW, spriteH * 0.16, '#f8f4e4');
        // Frame underneath
        _bar(startX, topY + spriteH * 0.65, spriteW, spriteH * 0.30, '#3a2a18');
        // Headboard
        _bar(startX, topY, spriteW * 0.15, spriteH, '#4a3220');
        break;
      }
      case 'lamp': {
        // Tall pole + shade
        var poleW = Math.max(1, spriteW * 0.20);
        _bar(screenX - poleW / 2, topY + spriteH * 0.25, poleW, spriteH * 0.70, '#2a201a');
        // Shade
        var shadeH = spriteH * 0.30;
        _bar(startX, topY, spriteW, shadeH, '#7a5a30');
        // Warm bulb glow
        var lglow = 0.65 + Math.sin(performance.now() * 0.005 + p._wobble) * 0.2;
        var lcx = screenX, lcy = topY + shadeH * 0.6;
        var lgrad = ctx.createRadialGradient(lcx, lcy, 0, lcx, lcy, spriteW * 1.4);
        lgrad.addColorStop(0, 'rgba(255,210,120,' + (fog * lglow * 0.7).toFixed(2) + ')');
        lgrad.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = lgrad;
        ctx.fillRect(lcx - spriteW * 1.4, lcy - spriteW * 1.4, spriteW * 2.8, spriteW * 2.8);
        // Base disc
        _bar(startX + spriteW * 0.25, topY + spriteH - 2, spriteW * 0.5, 2, '#1a1410');
        break;
      }
      case 'counter': {
        // Long low counter + edge highlight
        _bar(startX, topY, spriteW, spriteH, '#3a2a18');
        _bar(startX, topY, spriteW, Math.max(1, spriteH * 0.10), '#6a4a28');
        // Panel lines (3)
        for (var pn = 1; pn < 3; pn++) {
          var pnX = startX + (spriteW * pn / 3);
          _bar(pnX, topY + spriteH * 0.15, 1, spriteH * 0.80, 'rgba(0,0,0,0.5)');
        }
        break;
      }
      case 'shelf':
      case 'bookcase': {
        // Tall narrow rectangle + horizontal shelf lines + book color blocks
        _bar(startX, topY, spriteW, spriteH, '#2a1a10');
        // Shelves
        for (var sh = 1; sh <= 3; sh++) {
          var shY = topY + spriteH * (sh / 4);
          _bar(startX, shY, spriteW, 1, '#4a3218');
          // Book blocks on each shelf
          var bookCount = 4;
          for (var bk = 0; bk < bookCount; bk++) {
            var bx = startX + spriteW * (bk / bookCount) + 1;
            var bw = Math.max(1, spriteW / bookCount - 1.5);
            var bh = spriteH * 0.18;
            var hueSeed = ((sh * 7 + bk * 13 + ((p._wobble * 50) | 0)) % 6);
            var bookCols = ['#883030', '#306688', '#6a4a18', '#3a5a3a', '#583a6a', '#787018'];
            _bar(bx, shY - bh - 1, bw, bh, bookCols[hueSeed]);
          }
        }
        break;
      }
      case 'plant': {
        // Pot + leafy mass (sway slightly)
        var sway = Math.sin(performance.now() * 0.0015 + p._wobble) * 1.5;
        var potH = spriteH * 0.25;
        _bar(startX + spriteW * 0.15, topY + spriteH - potH, spriteW * 0.70, potH, '#5a3818');
        var leafW = spriteW * 0.95;
        var leafX = screenX - leafW / 2 + sway;
        var leafH = spriteH - potH - 2;
        _bar(leafX, topY, leafW, leafH, '#1a3a18');
        // Highlight strands
        _bar(leafX + leafW * 0.3, topY + 1, 1, leafH * 0.5, '#3a6a28');
        _bar(leafX + leafW * 0.6, topY + 2, 1, leafH * 0.6, '#2a5a20');
        break;
      }
      case 'crate': {
        _bar(startX, topY, spriteW, spriteH, '#6a4a20');
        _bar(startX, topY, spriteW, 1, '#8a6a30');
        _bar(startX, topY + spriteH - 1, spriteW, 1, '#3a2810');
        _bar(screenX, topY, 1, spriteH, '#3a2810'); // center plank
        break;
      }
      case 'trashcan': {
        _bar(startX, topY + spriteH * 0.05, spriteW, spriteH * 0.95, '#202020');
        _bar(startX, topY, spriteW, spriteH * 0.10, '#3a3a3a'); // lid rim
        break;
      }
      case 'medical': {
        // White cart + red cross
        _bar(startX, topY, spriteW, spriteH, '#e0e0d8');
        _bar(startX, topY + spriteH * 0.5, spriteW, 1, '#a0a098');
        // Red cross
        _bar(screenX - spriteW * 0.18, topY + spriteH * 0.20, spriteW * 0.36, spriteH * 0.10, '#c02020');
        _bar(screenX - spriteW * 0.06, topY + spriteH * 0.10, spriteW * 0.12, spriteH * 0.30, '#c02020');
        // Wheels
        _bar(startX + 1, topY + spriteH - 2, spriteW * 0.20, 2, '#101010');
        _bar(endX - spriteW * 0.20 - 1, topY + spriteH - 2, spriteW * 0.20, 2, '#101010');
        break;
      }
      case 'tv': {
        // Wall-mounted TV with grey casing + dark screen + faint hum
        _bar(startX, topY, spriteW, spriteH, '#181818');
        _bar(startX + 2, topY + 2, Math.max(1, spriteW - 4), Math.max(1, spriteH - 4), '#080820');
        var tvFlick = (Math.sin(performance.now() * 0.025 + p._wobble) > 0.7);
        if (tvFlick) {
          ctx.fillStyle = 'rgba(120,140,160,' + (fog * 0.5).toFixed(2) + ')';
          ctx.fillRect(startX + 3, topY + 3, Math.max(1, spriteW - 6), Math.max(1, spriteH - 6));
        }
        break;
      }
      case 'bench': {
        // Long flat seat + 2 legs
        _bar(startX, topY + spriteH * 0.30, spriteW, spriteH * 0.30, '#3a2818');
        var bLegW = Math.max(1, spriteW * 0.06);
        _bar(startX + 2, topY + spriteH * 0.60, bLegW, spriteH * 0.40, '#1a1008');
        _bar(endX - bLegW - 2, topY + spriteH * 0.60, bLegW, spriteH * 0.40, '#1a1008');
        break;
      }
      case 'kiosk': {
        // Tall narrow stand + sign on top (yellow/red)
        _bar(startX, topY, spriteW, spriteH, '#3a3028');
        // Sign panel
        _bar(startX, topY, spriteW, spriteH * 0.25, '#a83020');
        _bar(startX, topY + spriteH * 0.05, spriteW, 1, '#f0c060');
        break;
      }
      case 'pillar': {
        _bar(startX + spriteW * 0.10, topY, spriteW * 0.80, spriteH, '#202020');
        _bar(startX + spriteW * 0.10, topY, spriteW * 0.80, spriteH * 0.05, '#404040');
        _bar(startX + spriteW * 0.05, topY + spriteH - 2, spriteW * 0.90, 2, '#101010');
        break;
      }
      case 'barrel': {
        _bar(startX + spriteW * 0.10, topY, spriteW * 0.80, spriteH, '#4a3020');
        _bar(startX + spriteW * 0.10, topY + spriteH * 0.25, spriteW * 0.80, 1, '#6a4828');
        _bar(startX + spriteW * 0.10, topY + spriteH * 0.70, spriteW * 0.80, 1, '#6a4828');
        break;
      }
      case 'rug': {
        // Flat decor — short, wide ellipse hugging the floor line so it
        // reads as a rug seen forward through the perspective rather
        // than a tall vertical oval.
        ctx.fillStyle = 'rgba(120,40,40,' + (fog * 0.6).toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(screenX, floorY - 1, spriteW / 2, Math.max(1, fullH * 0.04), 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'candle': {
        var candleH = spriteH * 0.7;
        _bar(screenX - 1, topY + spriteH * 0.30, 2, candleH, '#e8d8b0');
        // Flame
        var flameY = topY + spriteH * 0.30;
        var flick = Math.sin(performance.now() * 0.012 + p._wobble) * 0.3 + 0.7;
        _dot(screenX, flameY, Math.max(1.5, spriteW * 0.45 * flick), 'rgba(255,180,80,' + (fog * 0.85).toFixed(2) + ')');
        _dot(screenX, flameY, Math.max(1, spriteW * 0.18 * flick), 'rgba(255,240,180,' + fog.toFixed(2) + ')');
        // Halo glow
        var clglow = ctx.createRadialGradient(screenX, flameY, 0, screenX, flameY, spriteW * 2.0);
        clglow.addColorStop(0, 'rgba(255,180,80,' + (fog * 0.4).toFixed(2) + ')');
        clglow.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = clglow;
        ctx.fillRect(screenX - spriteW * 2.0, flameY - spriteW * 2.0, spriteW * 4.0, spriteW * 4.0);
        break;
      }
      case 'rock': {
        _bar(startX + spriteW * 0.05, topY, spriteW * 0.90, spriteH, '#3a3a38');
        _bar(startX + spriteW * 0.30, topY, spriteW * 0.40, spriteH * 0.25, '#5a5a58');
        break;
      }
      case 'coral': {
        // Branchy under-sea decor — pink/orange tone
        _bar(screenX - spriteW * 0.10, topY, spriteW * 0.20, spriteH, '#a04050');
        _bar(screenX + spriteW * 0.10, topY + spriteH * 0.20, spriteW * 0.18, spriteH * 0.70, '#b85060');
        _bar(screenX - spriteW * 0.28, topY + spriteH * 0.30, spriteW * 0.16, spriteH * 0.55, '#a04848');
        break;
      }
      case 'hedge': {
        // Garden hedge — dark green with leaf jitter
        _bar(startX, topY, spriteW, spriteH, '#1a3618');
        for (var lf = 0; lf < 5; lf++) {
          var lfX = startX + spriteW * (lf / 5);
          _bar(lfX, topY + (lf % 2) * 2, Math.max(1, spriteW * 0.18), spriteH, '#244828');
        }
        break;
      }
      default:
        _bar(startX, topY, spriteW, spriteH, '#404040');
    }

    ctx.restore();
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function onRender(ctx) {
    if (!currentMap) return;
    if (state === ST.TITLE || state === ST.ENDED || state === ST.DEAD) return;

    // Camera headbob — translate the whole world a few px each frame
    // based on player walk phase. Wraps the entire render so map / props
    // / decals / entities / HUD-in-world / threat compass all bob in
    // sync. The ctx.restore at the end of this function reverts it.
    var _bobY = Math.sin(player._headbobPhase || 0) * (player._headbobAmp || 0);
    ctx.save();
    if (Math.abs(_bobY) > 0.05) ctx.translate(0, _bobY);

    GameEngine.drawMap();

    // Decorative props (desks/beds/lamps/...) — drawn after the map so the
    // z-buffer reflects wall occlusion, but before entities so monsters
    // visually overlap furniture they're standing in front of. Cheap
    // (3-8 fillrect per prop, depth-fog culled at 18 tiles).
    if (props && props.length) {
      for (var pp = 0; pp < props.length; pp++) {
        try { drawProp(ctx, props[pp]); } catch (e) {}
      }
    }

    // Floor decals (blood splats, scorch marks) — under everything else
    // so entities stand on top, but after props so a blood splat next
    // to a desk reads naturally.
    try { drawDecals(ctx); } catch (e) {}

    // Ambient atmospheric particles (dust / embers / bubbles / ...).
    // Cheap — bounded pool (36 max) and one fillrect/glow per particle.
    try { drawParticles(ctx); } catch (e) {}
    // Bullet tracers — drawn AFTER entities/props so the line passes in
    // front of the world. Lifespan ~120ms keeps them snappy.
    try { drawTracers(ctx); } catch (e) {}

    // Draw entities (type-aware). Dead entities linger for 700 ms with
    // a fade+sink so kills feel satisfying instead of popping out.
    var nowMs_ = performance.now();
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (e.alive) {
        drawTypedEntity(ctx, e);
      } else if (e.deathAt && nowMs_ - e.deathAt < 700) {
        var sinceDeath = nowMs_ - e.deathAt;
        var fade = 1 - sinceDeath / 700;
        // Hand off to engine.renderSprite via the typed path but with
        // tweaked opacity. drawTypedEntity reads no opacity field, so
        // we mark the entity and let engine.js pick it up.
        e._deathFade = fade;
        e._deathSink = sinceDeath / 700; // 0..1 sink ratio for vertical drop
        drawTypedEntity(ctx, e);
        // Spawn a blood decal exactly once per death (first frame after
        // death). Skip for bosses since the boss death cinematic already
        // dominates the visual; civilians use a slightly different colour.
        if (!e._decalSpawned) {
          e._decalSpawned = true;
          if (e.type !== 'boss' && e.type !== 'haruki_boss') {
            var isCiv = (e.type === 'civilian');
            pushDecal('blood', e.x, e.y, {
              radiusTiles: isCiv ? 0.45 : 0.60,
              color: isCiv ? 'rgba(140,30,30,0.45)' : 'rgba(120,20,20,0.60)',
              life: 30000
            });
          }
        }
      }
    }

    // Draw item / note / exit sprites (custom visible)
    var glowPhase = performance.now() * 0.003;
    for (var pi = 0; pi < pickupRenderList.length; pi++) {
      var prl = pickupRenderList[pi];
      if (!pickupSpots[prl.key]) continue; // already picked up
      drawWorldPickup(ctx, prl.wx, prl.wy, glowPhase, '#88c050', '📦', prl.itemId);
    }
    var readNotesLvl = readNotes[currentLevel];
    for (var nli = 0; nli < noteRenderList.length; nli++) {
      var nrl = noteRenderList[nli];
      if (readNotesLvl && readNotesLvl[nrl.key]) continue;
      drawWorldPickup(ctx, nrl.wx, nrl.wy, glowPhase + 1, '#5a82c8', '📄', null);
    }
    // Shop merchant marker — visible glowing icon so the player can find
    // the vendor on Lv11 / hotel / etc instead of brute-force scanning floor.
    if (currentMap.shopSpots && currentMap.shopSpots.length) {
      for (var shi = 0; shi < currentMap.shopSpots.length; shi++) {
        var ssp = currentMap.shopSpots[shi];
        var swx = ssp.gx * TS + TS / 2;
        var swy = ssp.gy * TS + TS / 2;
        drawWorldPickup(ctx, swx, swy, glowPhase + 0.5, '#f0c850', '🛒', null);
      }
    }
    // Altar marker (Lv12+) — purple ring, hidden after first use this run.
    if (currentMap.altarSpots && currentMap.altarSpots.length && currentLevel >= 12) {
      for (var ali2 = 0; ali2 < currentMap.altarSpots.length; ali2++) {
        var alt2 = currentMap.altarSpots[ali2];
        if (alt2._used) continue;
        var awx = alt2.gx * TS + TS / 2;
        var awy = alt2.gy * TS + TS / 2;
        drawWorldPickup(ctx, awx, awy, glowPhase + 1.5, '#c060f0', '⛩', null);
      }
    }
    // Secret doc marker — gold scroll. Each spot disappears after pickup
    // because pickHandler splices the entry out of secretSpots.
    if (currentMap.secretSpots && currentMap.secretSpots.length) {
      for (var sdi = 0; sdi < currentMap.secretSpots.length; sdi++) {
        var sds = currentMap.secretSpots[sdi];
        var sdwx = sds.gx * TS + TS / 2;
        var sdwy = sds.gy * TS + TS / 2;
        drawWorldPickup(ctx, sdwx, sdwy, glowPhase + 2.5, '#f0a040', '📜', null);
      }
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

    // Closes the ctx.save() at the top of onRender that applied the
    // camera headbob translate. Must run after EVERY return path that
    // could exit the function — currently only the early returns at the
    // top (before save was called), so a single restore at the end is
    // safe.
    ctx.restore();
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
      var poolHere = LEVEL_MINIGAME_POOLS[currentLevel];
      // Per-run only — drop the cross-run mgPlayedPersistent gate so
      // every fresh run shows PLAY on Lv0+ safe zones again.
      if (poolHere && poolHere.length && !mgPlayedAt[safeKey2]) {
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
      if (ft === 2) {
        showAct = true;
        // Show key-specific prompt when the facing door is locked so the
        // player knows what they need.
        var fds = doorStates[fkey];
        if (fds && fds.locked && fds.keyLabel) label = fds.keyLabel + 'で解錠';
        else if (fds && fds.locked) label = 'カードキーで解錠';
        else label = 'ドア';
      }
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
  // FPS counter throttle — only update DOM every ~10 frames.
  var _fpsCounterTickAcc = 0;
  function _updateFpsCounter(dt) {
    _fpsCounterTickAcc += dt;
    if (_fpsCounterTickAcc < 0.25) return;
    _fpsCounterTickAcc = 0;
    var fc = el('fpsCounter');
    if (!fc) return;
    var enabled = false;
    try { enabled = localStorage.getItem('bk_fps') === '1'; } catch (e) {}
    var visible = enabled && state === ST.PLAYING && !_inCinematic;
    if (!visible) {
      if (fc.style.display !== 'none') fc.style.display = 'none';
      return;
    }
    if (fc.style.display === 'none') fc.style.display = '';
    var f = Math.round(GameEngine._fpsEma || 0);
    fc.textContent = 'FPS ' + f;
    fc.classList.toggle('low', f < 30);
  }
  function onUpdate(dt) {
    pollGamepad();
    _updateFpsCounter(dt);
    if (state === ST.PLAYING && !phoneOpen && !miniGameOpen) {
      updatePlayer(dt);
      updateEntities(dt);
      GameEngine.updateParticles(dt);
      // Per-level ambient particles — new system (dust/ember/bubble/
      // leaf/spore/ash) supersedes the legacy fog/spark/dust spawn
      // block. Each kind has gravity / drift / lifespan + billboard
      // render gated by gfxQuality !== 'low'.
      updateParticles(dt);
      // Bullet tracers — short-lived (~120ms) so they don't accumulate.
      updateTracers(dt);
    }
    if (miniGameOpen) updateMiniGame(dt);
  }

  // ============================================================
  //  DEATH / ENDING
  // ============================================================
  function die(causeId, sub) {
    // Guard against re-entry. Multiple drain sources (entity touch + env SAN drain)
    // can fire the same-frame die() trigger, leading to double-count stats and
    // overlay stacking. Once we're in DEAD/ENDED, do not re-run death sequence.
    if (state === ST.DEAD || state === ST.ENDED) return;
    state = ST.DEAD;
    // Reset cinematic flag — if the player died mid-cinematic somehow
    // (rare edge case), continueGame would otherwise leave _inCinematic
    // stuck = true and _isGamePaused would never release.
    _inCinematic = false;
    updateChaosLayer();
    var rtD = el('reticle'); if (rtD) rtD.classList.remove('show');
    var wabD = el('weaponAttackBtn'); if (wabD) wabD.classList.remove('show');
    var whD = el('weaponHand'); if (whD) whD.classList.remove('show');
    // Stop any chase-related class on the hand sprite so the dead pose
    // doesn't keep bobbing during the fade-to-black.
    if (whD) { whD.classList.remove('bobbing'); whD.classList.remove('out-of-ammo'); }
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
    var _dh = el('dpadHud'); if (_dh) _dh.style.display = 'none';
    var _sg = el('spawnGraceHud'); if (_sg) _sg.style.display = 'none';
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
    summary.push('<span style="color:#b09040;">秘匿書類:</span> ' +
                 Object.keys(collectedSecretDocs).length + ' / ' + SECRET_DOCS.length);
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
    // Flag set on death so the next startNewGame/continueGame begins each
    // vital at 50% of max as a soft penalty.
    try { localStorage.setItem('thebackrooms_just_died_v1', '1'); } catch (e) {}
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
    if (type === 'true_secret') {
      // 真のトゥルーエンド: 全秘匿書類を集めた状態でのみ到達。
      // 春木保 / 晴美 兄妹の魂が解放され、プレイヤーは「鍵」を持って
      // バックルームの呪縛から本当の意味で脱出する。
      // 各 line に voice: true を付けたものは TTS で発声する。
      lines = [
        { text: '', delay: 1400 },
        { text: 'お前は黒い扉の前に立つ ── が、扉は開かなかった。', delay: 5200 },
        { text: '懐の中で、九つの書類が淡く光り出す。', delay: 5400 },
        { text: '「鍵は ── 書類だ」', delay: 4400, voice: '鍵は、書類だ。' },
        { text: '── 春木晴美の声。', delay: 4600 },
        { text: '九四四班の罪を、お前は読み解いた。', delay: 5600 },
        { text: '壁紙が剥がれ落ちる。', delay: 4400 },
        { text: '黄色の向こうに、本当の朝日が見える。', delay: 5400 },
        { text: '兄妹は微笑み、お前と共に壁を抜ける。', delay: 5800, voice: 'ありがとう。' },
        { text: 'バックルームは、閉じた。', delay: 5000 },
        { text: '─ THE TRUE END ─', delay: 5000 }
      ];
    } else if (type === 'truend' || type === 'truend_bad') {
      // ハルキ撃破後の「通常」エンド ── 全資料未収集ならバッド扱い。
      lines = [
        { text: '', delay: 1200 },
        { text: 'お前は黒い扉に手をかけた。', delay: 4200 },
        { text: '振り返れば、9 つの階層と無数の影。', delay: 4600 },
        { text: '前を向けば、何かが待っている。', delay: 4400 },
        { text: '扉が、開く。', delay: 3800 },
        { text: '── そこにあったのは、もう一つの階層だった。', delay: 5400, voice: 'まだ、いるよ。' },
        { text: 'お前はまだ、何も理解していない。', delay: 4800 },
        { text: '...', delay: 2400 }
      ];
    } else {
      lines = [
        { text: '', delay: 1200 },
        { text: 'お前は壁を抜けた。', delay: 4200 },
        { text: 'だが、これは出口ではなかった。', delay: 4600, voice: 'おかえり。' },
        { text: '...', delay: 3000 }
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
      // Fade out → setTimeout → swap → fade in, matching the intro / boss
      // cutscene flows. line.voice (if set) is spoken via uncanny TTS so
      // the user gets ガッツリ voice on key beats.
      setTimeout(function () {
        if (cancelled) return;
        lineEl.textContent = line.text;
        requestAnimationFrame(function () {
          if (cancelled) return;
          lineEl.classList.add('show');
        });
        if (line.voice) { try { _uncannySpeak(line.voice); } catch (e) {} }
      }, 600);
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
    // Unlock cheat mode on any ending — replay incentive ("無双モード")
    try {
      if (!localStorage.getItem('thebackrooms_cheat_unlocked_v1')) {
        localStorage.setItem('thebackrooms_cheat_unlocked_v1', '1');
        cheatUnlocked = true;
        toast('★ CHEAT MODE 解禁! タイトル画面で切替可能');
      }
    } catch (e) {}
    // For the real TRUE END, play the sunrise/walk-away cinematic sequence
    // first. truend_bad / frontrooms / loop skip it — the BAD ending should
    // feel anti-climactic.
    var afterEnding = function () {
      playEndingCinematic(type, function () {
        _showEndingScreen(type);
      });
    };
    if (type === 'true_secret' && typeof playEndingSequence === 'function') {
      playEndingSequence(afterEnding);
    } else {
      afterEnding();
    }
  }

  function _showEndingScreen(type) {
    var screen = el('endingScreen');
    var content = screen.querySelector('.ending-content');
    content.classList.remove('bad-ending', 'true-ending', 'lost-ending');

    var tag = el('endingTag');
    var title = el('endingTitle');
    var msg = el('endingMessage');

    // Pre-compute run summary used by every ending type.
    var totalNotes_ = 0;
    for (var lk in NOTES_POOL) totalNotes_ += NOTES_POOL[lk].length;
    var totalAch_ = Object.keys(ACHIEVEMENTS).length;
    var lifetimeCount_ = Object.keys(lifetimeNoteTitles).length;
    var sdHave_ = Object.keys(collectedSecretDocs).length;
    var sdTotal_ = SECRET_DOCS.length;
    var runSummary =
      '<hr style="border:none;border-top:1px solid #483910;margin:14px 0;">' +
      '<div style="font-size:11px;color:#b09040;letter-spacing:0.15em;line-height:1.8;">' +
      '生存: ' + formatTime(playTime) + '<br>' +
      '本ラン ノート: ' + discoveredNotes.length + '<br>' +
      '通算 ユニーク ノート: ' + lifetimeCount_ + ' / ' + totalNotes_ + '<br>' +
      '秘匿書類: ' + sdHave_ + ' / ' + sdTotal_ + '<br>' +
      '実績: ' + Object.keys(unlockedAchievements).length + ' / ' + totalAch_ + '<br>' +
      '難易度: ' + (DIFFICULTIES[currentDifficulty] ? DIFFICULTIES[currentDifficulty].name : 'NORMAL') +
      '</div>';

    if (type === 'true_secret') {
      // 真のトゥルーエンド ── 全秘匿書類を集めた状態でハルキ撃破。
      content.classList.add('true-ending');
      tag.textContent = '∞ TRUE ∞';
      title.textContent = 'TRUE END';
      msg.innerHTML =
        '九四四班の罪を、あなたは全て読み解いた。<br>' +
        '黒い扉の向こうに、本当の朝日が見えた。<br><br>' +
        '春木兄妹はあなたと共に、バックルームから永遠に解放された。<br>' +
        'あの黄色い壁紙は、もう、誰の悪夢にも現れない。' + runSummary;
      unlockAchievement('true_end');
      unlockAchievement('true_secret_end');
    } else if (type === 'truend_bad' || type === 'truend') {
      // 全秘匿書類を集めずにハルキ撃破 → バッドエンド扱い。
      content.classList.add('bad-ending');
      tag.textContent = 'BAD END';
      title.textContent = '虚偽の脱出';
      msg.innerHTML =
        'あなたはハルキを倒し、黒い扉を抜けた。<br>' +
        'しかし、扉の向こうも、また同じ黄色い廊下だった。<br><br>' +
        '九四四班の罪を読み解かない限り、出口は無い。<br>' +
        'アーカイブで「秘匿書類」を全て集めよ。' + runSummary;
      unlockAchievement('true_end'); // counts as ハルキ撃破
    } else if (type === 'frontrooms') {
      // FRONTROOMS は脱出に見えるが、バックルームの「擬装」 → bad-ending 扱い。
      content.classList.add('bad-ending');
      tag.textContent = 'BAD END';
      title.textContent = '見せかけの帰還';
      msg.innerHTML =
        'バックルームから脱出した、と思った。<br>' +
        'だが、蛍光灯のハム音は今も耳に残っている。<br>' +
        'これは本当の現実か、それとも、もう一つの階層か。' + runSummary;
    } else {
      // LOOP END / その他 = lost-ending (バッドエンド)
      content.classList.add('lost-ending');
      tag.textContent = 'BAD END';
      title.textContent = '永遠のループ';
      msg.innerHTML =
        '出口を見つけられないまま、永遠が経過した。<br>' +
        'そして次の no-clipper を待つ存在になった。' + runSummary;
    }

    el('vitalBars').classList.remove('show');
    el('joystickArea').style.display = 'none';
    el('lookArea').style.display = 'none';
    el('touchZoneLeft').style.display = 'none';
    el('touchZoneRight').style.display = 'none';
    el('actionBtn').style.display = 'none';
    el('phoneBtn').style.display = 'none';
    el('floorHUD').style.display = 'none';
    var _dh = el('dpadHud'); if (_dh) _dh.style.display = 'none';
    var _sg = el('spawnGraceHud'); if (_sg) _sg.style.display = 'none';

    GameEngine.fadeToBlack(1500, function () {
      showOverlay('endingScreen');
    });

    // Clear save on ending — current slot only.
    try { localStorage.removeItem(_saveSlotKey()); } catch (e) {}
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  // ============================================================
  //  PHONE UI
  // ============================================================
  function openPhone() {
    if (state !== ST.PLAYING) return;
    phoneOpen = true;
    refreshPhoneUI();
    try { refreshDpadConfigUI(); } catch (e) {}
    showOverlay('phoneOverlay');
    if (audioInitialized) GameEngine.playSound('phone_open');
  }
  function closePhone() {
    phoneOpen = false;
    hideOverlay('phoneOverlay');
    if (audioInitialized) GameEngine.playSound('phone_close');
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
    if (name === 'Options' || name === 'Inventory') refreshDpadConfigUI();
    refreshPhoneUI();
  }

  // Populate the D-pad config selects in the Options tab and bind handlers.
  // Idempotent — safe to call every time the Options tab opens.
  var _dpadConfigBound = false;
  function refreshDpadConfigUI() {
    // Build option list once per render: all known items grouped by category
    var ownedKeys = Object.keys(player.inventory);
    // Spoiler guard: only show items the player has ever collected in any
    // run (lifetime collection ledger). Currently held items always show
    // even if the ledger missed them. The "currentId" (already assigned)
    // also stays visible so existing assignments aren't accidentally cleared.
    var lifetimeOwned = {};
    try {
      lifetimeOwned = JSON.parse(localStorage.getItem('thebackrooms_items_collected_v1') || '{}');
    } catch (e) { lifetimeOwned = {}; }
    function buildOptions(currentId) {
      var html = '<option value="">未割当</option>';
      var weaponHtml = '', itemHtml = '';
      var iterIds = Object.keys(ITEMS);
      for (var i = 0; i < iterIds.length; i++) {
        var iid = iterIds[i];
        var it = ITEMS[iid];
        var owned = ownedKeys.indexOf(iid) >= 0;
        var everSeen = !!lifetimeOwned[iid];
        // Hide items the player has never encountered (spoiler prevention).
        // Always keep the currently-assigned id visible to avoid silent clearing.
        if (!everSeen && !owned && iid !== currentId) continue;
        var label = it.icon + ' ' + it.name + (owned ? ' (×' + player.inventory[iid] + ')' : '');
        var sel = (iid === currentId) ? ' selected' : '';
        var opt = '<option value="' + iid + '"' + sel + '>' + label + '</option>';
        if (it.category === 'weapon') weaponHtml += opt;
        else itemHtml += opt;
      }
      if (weaponHtml) html += '<optgroup label="武器">' + weaponHtml + '</optgroup>';
      if (itemHtml)   html += '<optgroup label="アイテム">' + itemHtml + '</optgroup>';
      return html;
    }
    var selects = document.querySelectorAll('.dpad-slot-select');
    for (var si = 0; si < selects.length; si++) {
      var sEl = selects[si];
      var dir = sEl.getAttribute('data-dpad-dir');
      var slots = dpadAssignments[dpadMode] || {};
      sEl.innerHTML = buildOptions(slots[dir] || '');
    }
    // Mode tab visual state
    var modeTabs = document.querySelectorAll('.dpad-mode-tab');
    for (var mi = 0; mi < modeTabs.length; mi++) {
      modeTabs[mi].classList.toggle('active', modeTabs[mi].getAttribute('data-dpad-mode') === dpadMode);
    }
    if (_dpadConfigBound) return;
    _dpadConfigBound = true;
    // Bind once
    for (var bi = 0; bi < modeTabs.length; bi++) {
      modeTabs[bi].addEventListener('click', function (ev) {
        var m = ev.currentTarget.getAttribute('data-dpad-mode');
        if (m !== 'weapon' && m !== 'item') return;
        dpadMode = m;
        saveDpadAssignments();
        updateDpadHud();
        refreshDpadConfigUI();
        if (audioInitialized) GameEngine.playSound('ui_tab');
      });
    }
    var selects2 = document.querySelectorAll('.dpad-slot-select');
    for (var ssi = 0; ssi < selects2.length; ssi++) {
      selects2[ssi].addEventListener('change', function (ev) {
        var d = ev.currentTarget.getAttribute('data-dpad-dir');
        var v = ev.currentTarget.value;
        if (!dpadAssignments[dpadMode]) dpadAssignments[dpadMode] = {};
        dpadAssignments[dpadMode][d] = v;
        saveDpadAssignments();
        updateDpadHud();
        if (audioInitialized) GameEngine.playSound('ui_tap');
      });
    }
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
      var coinsEl = el('statCoinsText');
      if (coinsEl) coinsEl.innerHTML = '<span class="status-coin-icon">🪙</span> ' + (player.coins || 0);
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
      // Equipped weapon line — shows the weapon name + ammo so the player
      // can see what will fire when they tap the attack button.
      var equipLine = '';
      if (player.equippedWeapon && ITEMS[player.equippedWeapon]) {
        var ew = ITEMS[player.equippedWeapon];
        var ewCnt = player.inventory[player.equippedWeapon] || 0;
        var ewCntStr = hasEternalCharm() ? '∞' : ('×' + ewCnt);
        equipLine = '<br>装備中: ' + ew.name + ' ' + ewCntStr;
      } else {
        equipLine = '<br>装備中: なし';
      }
      el('statProgText').innerHTML =
        'クリア: ' + clears + ' / 15 階層<br>' +
        '難易度: ' + diffName + equipLine +
        '<br>本階層ベスト: ' + bestStr + lifeStr;
    }

    // INVENTORY — split into items + weapons sections per user request
    if (activeTab === 'Inventory') {
      var gridItems = el('invGridItems');
      var gridWeapons = el('invGridWeapons');
      gridItems.innerHTML = '';
      gridWeapons.innerHTML = '';
      var keys = Object.keys(player.inventory);
      var itemCount = 0, weaponCount = 0;
      function makeSlot(id, item, cnt) {
        var slot = document.createElement('div');
        slot.className = 'inv-slot';
        // Mark the slot if this is the currently equipped weapon so the
        // player can see at a glance what's loaded.
        if (item.category === 'weapon' && player.equippedWeapon === id) {
          slot.classList.add('equipped');
        }
        var stateMark = '';
        if (item.id === 'flashlight') {
          var battPct = Math.round(player.flashlightBattery || 0);
          stateMark = '<span class="inv-state ' + (player.flashlightOn ? 'on' : 'off') + '">' +
                      (player.flashlightOn ? 'ON' : 'OFF') + ' ' + battPct + '%</span>';
        }
        if (item.id === 'radio') stateMark = '<span class="inv-state ' + (player.radioOn ? 'on' : 'off') + '">' + (player.radioOn ? 'ON' : 'OFF') + '</span>';
        // Weapons always show a count (it's their ammo). Other stackables
        // only show when > 1 to avoid noise. ∞ stays for persistent items
        // — and once the player owns the eternal_charm, ALL items render ∞.
        var isWeapon = item.category === 'weapon';
        var charmActive = hasEternalCharm();
        var countBadge = (item.persistent || charmActive)
          ? '<span class="inv-perm">∞</span>'
          : (isWeapon ? '<span class="inv-count ammo">×' + cnt + '</span>'
                      : (cnt > 1 ? '<span class="inv-count">' + cnt + '</span>' : ''));
        // Weapons get the realistic SVG; everything else stays emoji.
        var invIconHtml = WEAPON_SVG[id]
          ? '<span class="inv-svg">' + WEAPON_SVG[id] + '</span>'
          : '<span style="font-size:22px;">' + item.icon + '</span>';
        slot.innerHTML = invIconHtml +
          countBadge +
          stateMark +
          '<span class="inv-name">' + item.name.slice(0, 6) + '</span>';
        (function (itemId) {
          slot.addEventListener('click', function () { openItemUseModal(itemId); });
        })(id);
        return slot;
      }
      for (var ii = 0; ii < keys.length; ii++) {
        var id = keys[ii];
        var item = ITEMS[id];
        var cnt = player.inventory[id];
        if (!item) continue;
        var slot = makeSlot(id, item, cnt);
        if (item.category === 'weapon') {
          gridWeapons.appendChild(slot);
          weaponCount++;
        } else {
          gridItems.appendChild(slot);
          itemCount++;
        }
      }
      if (itemCount === 0)   gridItems.innerHTML   = '<p class="inv-empty">所持アイテムなし</p>';
      if (weaponCount === 0) gridWeapons.innerHTML = '<p class="inv-empty">所持武器なし</p>';
      var icE = el('invCountItems');   if (icE) icE.textContent = itemCount;
      var wcE = el('invCountWeapons'); if (wcE) wcE.textContent = weaponCount;
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
      // ── 書類 section (regular notes) ──
      var notesHeader = document.createElement('h3');
      notesHeader.className = 'phone-h3';
      notesHeader.textContent = '書類 (' + discoveredNotes.length + ' 件)';
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
      // ── 秘匿書類 section (lifetime collected secret docs) ──
      var secretHeader = document.createElement('h3');
      secretHeader.className = 'phone-h3';
      var sdHaveNow = Object.keys(collectedSecretDocs).length;
      var sdTotalNow = SECRET_DOCS.length;
      secretHeader.textContent = '秘匿書類 (' + sdHaveNow + ' / ' + sdTotalNow + ')';
      secretHeader.style.margin = '12px 0 8px';
      list.appendChild(secretHeader);
      if (sdHaveNow === 0) {
        var sdEmp = document.createElement('p');
        sdEmp.className = 'notes-empty';
        sdEmp.style.padding = '14px 16px';
        sdEmp.textContent = '秘匿された資料はまだ何も。';
        list.appendChild(sdEmp);
      } else {
        SECRET_DOCS.forEach(function (sd) {
          if (!collectedSecretDocs[sd.id]) return;
          var sdCard = document.createElement('div');
          sdCard.className = 'note-card';
          sdCard.style.borderLeftColor = '#d4b340';
          var sdPreview = sd.text.split('\n').join(' ').slice(0, 60) + '...';
          sdCard.innerHTML =
            '<div class="note-card-title">[LV' + sd.levelId + '] ' + sd.title + '</div>' +
            '<div class="note-card-preview">' + sdPreview + '</div>';
          sdCard.addEventListener('click', function () {
            showNoteViewer(sd.title, sd.text);
          });
          list.appendChild(sdCard);
        });
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
    // Soul lantern: while active, reveal every live entity as a glowing red
    // dot regardless of map discovery state. This is the lantern's payoff.
    if (player._soulLanternUntil && performance.now() < player._soulLanternUntil) {
      for (var sli = 0; sli < entities.length; sli++) {
        var se = entities[sli];
        if (!se.alive) continue;
        var sgx = se.x / TS, sgy = se.y / TS;
        ctx.fillStyle = 'rgba(220, 40, 40, 0.9)';
        ctx.beginPath();
        ctx.arc(ox + sgx * ts, oy + sgy * ts, Math.max(2, ts * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ox + sgx * ts, oy + sgy * ts, Math.max(4, ts * 0.9), 0, Math.PI * 2);
        ctx.stroke();
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
          coins: player.coins || 0,
          flashlightOn: player.flashlightOn,
          flashlightBattery: player.flashlightBattery || 0,
          radioOn: player.radioOn,
          compassOn: player.compassOn || false,
          equippedWeapon: player.equippedWeapon || null
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
      localStorage.setItem(_saveSlotKey(), JSON.stringify(data));
      // Brief save indicator — slides in the corner once per save so the
      // player has visible confirmation. Cooldown 4s so rapid-fire saves
      // (level transitions etc) don't spam the icon.
      try { _flashSaveIndicator(); } catch (e) {}
    } catch (e) { console.warn('Save failed', e); }
  }
  var _lastSaveFlashAt = 0;
  function _flashChaseBanner() {
    if (typeof document === 'undefined' || !document.body) return;
    var existing = document.getElementById('_chaseBanner');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var node = document.createElement('div');
    node.id = '_chaseBanner';
    node.className = 'chase-banner';
    node.textContent = '— 追跡されている —';
    document.body.appendChild(node);
    setTimeout(function () {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }, 2200);
  }
  function _flashSaveIndicator() {
    var now = performance.now();
    if (now - _lastSaveFlashAt < 4000) return;
    _lastSaveFlashAt = now;
    var ind = el('saveIndicator');
    if (!ind) return;
    ind.classList.remove('show');
    void ind.offsetWidth;
    ind.classList.add('show');
    setTimeout(function () { if (ind) ind.classList.remove('show'); }, 1600);
  }

  function loadGame() {
    try {
      // Slot-aware load — falls back to the legacy un-slotted key once
      // for backwards compatibility with players whose save existed
      // before slots were introduced.
      var s = localStorage.getItem(_saveSlotKey());
      if (!s) {
        var legacy = localStorage.getItem(SAVE_KEY);
        if (legacy && currentSaveSlot === 1) {
          // Promote legacy save into slot 1 so future operations are
          // slot-consistent. Removed from the un-slotted key.
          localStorage.setItem(_saveSlotKey(), legacy);
          try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
          s = legacy;
        }
      }
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
      player.coins = data.player.coins || 0;
      player.flashlightOn = data.player.flashlightOn || false;
      player.flashlightBattery = data.player.flashlightBattery || 0;
      player.radioOn = data.player.radioOn || false;
      player.compassOn = data.player.compassOn || false;
      // Guard against an equippedWeapon that's no longer in inventory
      // (e.g. legacy save schema or corrupted inventory) — otherwise
      // the attack button would point at nothing.
      var savedEquip = data.player.equippedWeapon || null;
      if (savedEquip && ITEMS[savedEquip] && (player.inventory[savedEquip] !== undefined)) {
        player.equippedWeapon = savedEquip;
      } else {
        player.equippedWeapon = null;
      }
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
      // Notify the user that the save existed but was corrupt — was
      // previously silently failing into the generic 「セーブデータが
      // 見つかりません」 path, which made the user think they had no
      // save when in fact the save was just unparseable.
      try { toast('セーブが壊れていたため読込失敗。新規ゲームを開始してください。', 4000); } catch (tx) {}
      return false;
    }
  }

  function hasSave() {
    try {
      if (localStorage.getItem(_saveSlotKey())) return true;
      // Legacy un-slotted save counts as slot-1 backing storage.
      if (currentSaveSlot === 1 && localStorage.getItem(SAVE_KEY)) return true;
    } catch (e) {}
    return false;
  }

  // ============================================================
  //  TITLE / NEW GAME
  // ============================================================
  // Intro cinematic — first-person POV with 3 scenes
  // Mini self-contained raycaster for the intro FPS shot.
  // Renders a straight yellow Backrooms-style corridor and animates the camera
  // forward for `duration` ms. No dependence on GameEngine state.
  function runIntroFpsScene(duration, onDone) {
    var cvs = el('introFpsCanvas');
    if (!cvs) { if (onDone) onDone(); return; }
    var ctx = cvs.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() {
      var cw = cvs.clientWidth || window.innerWidth;
      var ch = cvs.clientHeight || window.innerHeight;
      cvs.width = Math.max(320, Math.floor(cw * dpr));
      cvs.height = Math.max(240, Math.floor(ch * dpr));
    }
    resize();
    requestAnimationFrame(resize);
    window.addEventListener('resize', resize);
    var startT = performance.now();
    var cancelled = false;
    var rafId = 0;
    // Corridor map: 1 = wall, 0 = floor. Long enough to walk for the entire intro.
    var MAP_W = 5, MAP_H = 120;
    var map = new Uint8Array(MAP_W * MAP_H);
    for (var my = 0; my < MAP_H; my++) {
      for (var mx = 0; mx < MAP_W; mx++) {
        var t = (mx === 0 || mx === MAP_W - 1) ? 1 : 0;
        // Occasional doorway alcoves left/right for visual interest
        if ((my % 9 === 0) && my > 4 && my < MAP_H - 4) {
          if (mx === 0 || mx === MAP_W - 1) t = 0;
        }
        map[my * MAP_W + mx] = t;
      }
    }
    var FOV = Math.PI / 3;
    // Phase config — wall RGB, ceiling, floor, walk speed, flicker, bob amplitude,
    // tilt (camera roll). The intro narrative beats are encoded entirely as
    // raycaster parameters so the player ALWAYS sees a moving FPS view.
    //   street (0–3s)   dark blue back-alley
    //   wall   (3–4.5s) wall pressing close, very narrow FOV/slow walk
    //   fall   (4.5–6s) camera roll spins, fast walk, red flash
    //   yellow (6s–end) the canonical Backrooms yellow corridor
    function phaseAt(t01) {
      var sec = t01 * (duration / 1000);
      if (sec < 3.0) return 'street';
      if (sec < 4.5) return 'wall';
      if (sec < 6.0) return 'fall';
      return 'yellow';
    }
    var PHASES = {
      street: { wallR: 50,  wallG: 60,  wallB: 90,
                ceilTop: '#02030a', ceilBot: '#0b0e1c',
                floorTop: '#0a0a14', floorBot: '#15151c',
                speed: 1.0,  bobAmp: 0.05, tilt: 0,    fov: Math.PI/3,    flicker: 0.04 },
      wall:   { wallR: 30,  wallG: 28,  wallB: 18,
                ceilTop: '#0a0905', ceilBot: '#1a160c',
                floorTop: '#100c06', floorBot: '#1a1610',
                speed: 0.25, bobAmp: 0.02, tilt: 0,    fov: Math.PI/4.5,  flicker: 0.06 },
      fall:   { wallR: 140, wallG: 30,  wallB: 30,
                ceilTop: '#000', ceilBot: '#100',
                floorTop: '#000', floorBot: '#100',
                speed: 3.0,  bobAmp: 0.12, tiltSpin: true, fov: Math.PI/2.5, flicker: 0.18 },
      yellow: { wallR: 212, wallG: 170, wallB: 58,
                ceilTop: '#3d3008', ceilBot: '#5c4810',
                floorTop: '#1a1408', floorBot: '#2c2412',
                speed: 1.2,  bobAmp: 0.04, tilt: 0,    fov: Math.PI/3,    flicker: 0.05 }
    };
    var totalProgress = 0;
    var lastNow = performance.now();
    function step(now) {
      if (cancelled) return;
      var dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      var t01 = (now - startT) / duration;
      if (t01 >= 1) {
        if (onDone) onDone();
        return;
      }
      var phaseName = phaseAt(t01);
      var P = PHASES[phaseName];
      // Advance player Y at phase-specific speed.
      totalProgress += P.speed * dt;
      var py = 1 + (MAP_H - 4) * Math.min(0.98, totalProgress / 14);
      var w = cvs.width, h = cvs.height;
      var px = (MAP_W / 2);
      var bobY = Math.sin(now * 0.012) * P.bobAmp;
      var bobX = Math.sin(now * 0.006) * (P.bobAmp * 0.5);
      px += bobX;
      var camAngle = Math.PI / 2; // facing +Y
      // Falling phase: camera rotates wildly to feel like tumbling.
      var rollAngle = P.tiltSpin ? Math.sin(now * 0.008) * 0.6 : (P.tilt || 0);
      var fov = P.fov;
      // Ceiling/floor (per-phase gradient)
      var grad1 = ctx.createLinearGradient(0, 0, 0, h / 2);
      grad1.addColorStop(0, P.ceilTop);
      grad1.addColorStop(1, P.ceilBot);
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, w, h / 2);
      var grad2 = ctx.createLinearGradient(0, h / 2, 0, h);
      grad2.addColorStop(0, P.floorTop);
      grad2.addColorStop(1, P.floorBot);
      ctx.fillStyle = grad2;
      ctx.fillRect(0, h / 2, w, h / 2);
      // Roll the canvas if needed (cheap simulation of head tilt)
      var rolled = rollAngle !== 0;
      if (rolled) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rollAngle);
        ctx.translate(-w / 2, -h / 2);
      }
      var stripW = 4;
      var rays = Math.ceil(w / stripW);
      for (var i = 0; i < rays; i++) {
        var sx = i * stripW;
        var rayAng = camAngle - fov / 2 + (i / rays) * fov;
        var rcos = Math.cos(rayAng), rsin = Math.sin(rayAng);
        var mapX = Math.floor(px), mapY = Math.floor(py);
        var ddx = Math.abs(1 / rcos) || 1e9;
        var ddy = Math.abs(1 / rsin) || 1e9;
        var stepX, stepY, sdX, sdY;
        if (rcos < 0) { stepX = -1; sdX = (px - mapX) * ddx; }
        else          { stepX = 1;  sdX = (mapX + 1 - px) * ddx; }
        if (rsin < 0) { stepY = -1; sdY = (py - mapY) * ddy; }
        else          { stepY = 1;  sdY = (mapY + 1 - py) * ddy; }
        var hit = 0, side = 0, safety = 80;
        while (!hit && safety-- > 0) {
          if (sdX < sdY) { sdX += ddx; mapX += stepX; side = 0; }
          else           { sdY += ddy; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) { hit = 1; break; }
          if (map[mapY * MAP_W + mapX] === 1) hit = 1;
        }
        var dist;
        if (side === 0) dist = (mapX - px + (1 - stepX) / 2) / rcos;
        else            dist = (mapY - py + (1 - stepY) / 2) / rsin;
        dist = Math.max(0.1, dist);
        var wallH = Math.min(h * 4, h / dist);
        var drawStart = (h - wallH) / 2 + bobY * h;
        var fog = Math.max(0.18, 1 - dist / 30);
        var base = side === 1 ? 0.78 : 1.0;
        var r = Math.floor(P.wallR * fog * base);
        var g = Math.floor(P.wallG * fog * base);
        var b = Math.floor(P.wallB * fog * base);
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillRect(sx, drawStart, stripW + 1, wallH);
        // Subtle horizontal seam
        var seamY = h / 2 + (h / dist) * 0.42 + bobY * h;
        ctx.fillStyle = 'rgba(0,0,0,' + (0.4 * fog).toFixed(3) + ')';
        ctx.fillRect(sx, seamY, stripW + 1, 1);
      }
      if (rolled) ctx.restore();
      // Per-phase tint / flicker overlay
      if (phaseName === 'fall') {
        // Red flash during the fall
        ctx.fillStyle = 'rgba(180, 30, 30, ' + (0.18 + 0.12 * Math.sin(now * 0.03)) + ')';
        ctx.fillRect(0, 0, w, h);
      }
      var flicker = (Math.random() < P.flicker) ? 0.25 : 0.05;
      // Yellow flicker only for the yellow phase; otherwise neutral white flicker.
      if (phaseName === 'yellow') {
        ctx.fillStyle = 'rgba(255,240,170,' + flicker + ')';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,' + (flicker * 0.6) + ')';
      }
      ctx.fillRect(0, 0, w, h);
      // Vignette
      var grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25,
                                          w / 2, h / 2, Math.max(w, h) * 0.7);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
    return function cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      try { window.removeEventListener('resize', resize); } catch (e) {}
    };
  }

  function playIntroCinematic(onDone) {
    showOverlay('introOverlay');
    var eyes = el('introEyes');
    eyes.classList.remove('open', 'partial');
    var lineEl = el('introLine');
    lineEl.textContent = '';
    lineEl.classList.remove('show');
    var s0 = el('introScene0');
    var s1 = el('introScene1');
    var s2 = el('introScene2');
    var s3 = el('introScene3');
    [s0, s1, s2, s3].forEach(function (s) { if (s) s.classList.remove('active'); });
    if (audioInitialized) GameEngine.startLoop('wind');

    var cancelled = false;
    var footstepTimer = null;
    var fpsCancel = null;
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

    // Fade out the current line (~600ms), then swap the text and fade back in.
    // The previous implementation removed .show then re-added it in the next
    // RAF — opacity never actually animated to 0, so the swap looked abrupt.
    function setLine(text) {
      lineEl.classList.remove('show');
      // Wait for the opacity 1→0 transition to roughly finish before
      // mutating textContent so the player doesn't see the new text snap
      // into the still-bright previous line.
      setTimeout(function () {
        if (cancelled) return;
        lineEl.textContent = text;
        requestAnimationFrame(function () {
          if (cancelled) return;
          lineEl.classList.add('show');
        });
      }, 600);
    }

    var skipHandler;
    function finish() {
      if (cancelled) return;
      cancelled = true;
      stopFootsteps();
      if (fpsCancel) { try { fpsCancel(); } catch (e) {} fpsCancel = null; }
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

    // Opening is now entirely an FPS raycaster scene running for ~13s. The
    // narrative beats (street / wall / fall / yellow corridor) are encoded
    // as raycaster phase parameters in runIntroFpsScene, so the player sees
    // a continuously moving first-person view from the very first frame.
    // CSS layers (s1/s2/s3) are not used — only text overlay + scene 0 canvas.
    if (s0) {
      s0.classList.add('active');
      // Belt-and-braces: also force inline styles so any leftover CSS rule
      // can't fade the canvas out.
      s0.style.opacity = '1';
      s0.style.display = 'block';
    }
    if (s1) { s1.classList.remove('active'); s1.style.display = 'none'; }
    if (s2) { s2.classList.remove('active'); s2.style.display = 'none'; }
    if (s3) { s3.classList.remove('active'); s3.style.display = 'none'; }
    // Lengthened from 13.5s → 20s so each beat sits ~3.5-4s before the next.
    var INTRO_LEN = 20000;
    setTimeout(function () {
      if (cancelled) return;
      startFootsteps();
      setLine('...深夜、会社からの帰り道。');
      fpsCancel = runIntroFpsScene(INTRO_LEN, function () {
        if (cancelled) return;
        stopFootsteps();
        eyes.classList.add('partial');
        setLine('[ 画面をタップして開始 ]');
      });
    }, 200);
    // Narrative text beats — widened spacing so the player has time to read.
    setTimeout(function () { if (!cancelled) setLine('いつもの裏路地 — の、はずだった。'); }, 3600);
    setTimeout(function () {
      if (cancelled) return;
      setLine('— 壁が、近づく。');
      if (audioInitialized) GameEngine.playSound('static');
    }, 6400);
    setTimeout(function () {
      if (cancelled) return;
      setLine('— 足元の感触が、消えた。');
      if (audioInitialized) GameEngine.playSound('thunder');
      GameEngine.shakeScreen(22, 1.4);
    }, 9400);
    setTimeout(function () {
      if (cancelled) return;
      setLine('黄色い、無限の、壁紙の世界へ。');
      try { _uncannySpeak('ようこそ。'); } catch (e) {}
    }, 12400);
    setTimeout(function () {
      if (cancelled) return;
      setLine('— 立ち上がる。果てしなく続く、黄色い廊下。');
    }, 15400);
    setTimeout(function () {
      if (cancelled) return;
      setLine('— 遠くで、誰かが、笑った。');
      if (audioInitialized) GameEngine.playSound('whisper');
      try { _uncannySpeak('もう、戻れない。'); } catch (e) {}
    }, 18000);
    // No auto-finish — user taps overlay or skip button to advance
    // Safety net: auto-finish after 40s if no tap (was 30 — but intro now 20s)
    setTimeout(finish, 40000);
  }

  // Death penalty: after dying, every vital is clamped to 50% of max on the
  // next game start (normal new game / continue / endless restart). Flag is
  // consumed on use so a healthy run is not permanently penalised.
  function applyHalfRespawnIfDied() {
    var justDied = false;
    try {
      if (localStorage.getItem('thebackrooms_just_died_v1') === '1') {
        justDied = true;
        localStorage.removeItem('thebackrooms_just_died_v1');
      }
    } catch (e) {}
    if (!justDied) return;
    // User intent: "hp,sanは最大値の半分からスタート" — assign exactly half
    // (previously Math.min(current, half) could leave the player BELOW half
    //  if autosave caught them already wounded, which violated the spec).
    player.hp   = Math.round(player.hpMax  * 0.5);
    player.san  = Math.round(player.sanMax * 0.5);
    player.stam = Math.round(player.stamMax * 0.5);
    toast('— 再起。半身で立ち上がる。');
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
    // Clean leftover state from a previous run that may still be lingering
    // (entities animating during intro cinematic, dead-stuck cinematic flag,
    //  discovery popup, etc.). Without this, after ending → 新規ゲーム the
    //  player can be killed during the FPS opening.
    entities = [];
    _inCinematic = false;
    _discoveryActive = false;
    if (typeof window._discoveryCloseFn === 'function') {
      try { window._discoveryCloseFn(); } catch (e) {}
      window._discoveryCloseFn = null;
    }
    floatingMapOpen = false;
    var fmEl = el('floatingMap'); if (fmEl) fmEl.style.display = 'none';
    var _dh2 = el('dpadHud'); if (_dh2) _dh2.style.display = 'none';

    var diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    player.hpMax = Math.round(100 * diff.hpMul);
    player.san = player.sanMax = 100;
    player.stam = player.stamMax = 100;
    player.hp = player.hpMax;
    applyHalfRespawnIfDied();
    player.inventory = {};
    if (hasEternalCharm()) player.inventory.eternal_charm = 1;
    player.coins = 0;
    player.flashlightOn = false;
    player.flashlightBattery = 0;
    player.radioOn = false;
    player.compassOn = false;
    player.equippedWeapon = null;
    player._wallClipPending = false;
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
    // Death penalty also applies when resuming from save after a death (the
    // common path: retryBtn → continueGame). Without this, half-respawn only
    // triggered on brand-new runs and the user perceived the feature as dead.
    applyHalfRespawnIfDied();
    setLevel(currentLevel);
  }

  function returnToTitle() {
    state = ST.TITLE;
    // Clear lingering gameplay flags so a fresh start from the title
    // doesn't inherit them.
    _inCinematic = false;
    if (player) {
      player._beingChased = false;
      player._wallClipPending = false;
    }
    updateChaosLayer();
    var rt2 = el('reticle'); if (rt2) rt2.classList.remove('show');
    var wab2 = el('weaponAttackBtn'); if (wab2) wab2.classList.remove('show');
    var wh2 = el('weaponHand'); if (wh2) {
      wh2.classList.remove('show');
      wh2.classList.remove('bobbing');
      wh2.classList.remove('out-of-ammo');
    }
    // Also dismiss any in-game banner overlays so they don't bleed
    // into the title transition.
    var cbn = document.getElementById('_chaseBanner');
    if (cbn && cbn.parentNode) cbn.parentNode.removeChild(cbn);
    var bbn = el('bossHpBanner'); if (bbn) bbn.classList.remove('show');
    var dirOv = el('damageDirOverlay');
    if (dirOv) dirOv.classList.remove('flash');
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
    var _dh = el('dpadHud'); if (_dh) _dh.style.display = 'none';
    var _sg = el('spawnGraceHud'); if (_sg) _sg.style.display = 'none';
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
    if (diff) {
      diff.textContent = '難易度: ' + (DIFFICULTIES[currentDifficulty] ? DIFFICULTIES[currentDifficulty].name : 'NORMAL');
      diff.classList.toggle('chaos-on', currentDifficulty === 'chaos');
    }
    var cb = el('cheatBtn');
    if (cb) {
      cb.style.display = cheatUnlocked ? '' : 'none';
      cb.textContent = '無双モード: ' + (cheatActive ? 'ON' : 'OFF');
    }
    var ac = el('titleAchCounter');
    if (ac) {
      var acCount = Object.keys(unlockedAchievements).length;
      var acTotal = Object.keys(ACHIEVEMENTS).length;
      var extras = [];
      extras.push('🏆 ' + acCount + ' / ' + acTotal);
      // 永遠の護符 を一度でも入手済なら永続表示
      try { if (hasEternalCharm()) extras.push('♾ 永遠の護符'); } catch (e) {}
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
    var sb = el('titleSlotsBtn');
    if (sb) {
      var nm = (slotNames && slotNames[currentSaveSlot]) ? slotNames[currentSaveSlot] : '';
      sb.textContent = 'セーブスロット: ' + currentSaveSlot + (nm ? ' — ' + nm : '');
    }
  }

  function _slotSummary(slotNum) {
    try {
      var raw = localStorage.getItem(_slotKeyFor(slotNum));
      if (!raw) return null;
      var d = JSON.parse(raw);
      var lvl = (d && typeof d.currentLevel === 'number') ? d.currentLevel : 0;
      var def = LEVELS[lvl];
      var lvlName = def ? def.name : ('LEVEL ' + lvl);
      var hp = (d && d.player && typeof d.player.hp === 'number') ? Math.round(d.player.hp) : '?';
      var diff = (d && d.currentDifficulty) ? String(d.currentDifficulty).toUpperCase() : '';
      return { lvlName: lvlName, hp: hp, diff: diff };
    } catch (e) { return null; }
  }

  function renderTitleSlots() {
    var list = el('tslList');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 1; i <= SLOT_COUNT; i++) {
      (function (slotNum) {
        var row = document.createElement('div');
        row.className = 'tsl-row' + (slotNum === currentSaveSlot ? ' active' : '');

        var head = document.createElement('div');
        head.className = 'tsl-row-head';
        var num = document.createElement('div');
        num.className = 'tsl-num';
        num.textContent = '#' + slotNum;
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'tsl-name-input';
        nameInput.maxLength = 12;
        nameInput.placeholder = 'プレイヤー名 (任意)';
        nameInput.value = (slotNames && slotNames[slotNum]) || '';
        nameInput.addEventListener('change', function () {
          setSlotName(slotNum, nameInput.value);
          if (slotNum === currentSaveSlot) updateTitleButtons();
        });
        nameInput.addEventListener('blur', function () {
          setSlotName(slotNum, nameInput.value);
          if (slotNum === currentSaveSlot) updateTitleButtons();
        });
        head.appendChild(num);
        head.appendChild(nameInput);
        row.appendChild(head);

        var meta = document.createElement('div');
        var sum = _slotSummary(slotNum);
        if (sum) {
          meta.className = 'tsl-meta';
          meta.textContent = sum.lvlName + ' / HP ' + sum.hp + (sum.diff ? ' / ' + sum.diff : '');
        } else {
          meta.className = 'tsl-meta empty';
          meta.textContent = '— 空きスロット —';
        }
        row.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'tsl-row-actions';

        var selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'tsl-btn' + (slotNum === currentSaveSlot ? ' primary' : '');
        selectBtn.textContent = slotNum === currentSaveSlot ? '✓ 選択中' : '選択';
        selectBtn.addEventListener('click', function () {
          if (slotNum === currentSaveSlot) return;
          setCurrentSaveSlot(slotNum);
          // Re-load this slot's save into memory so つづきから immediately
          // picks up the right run. loadGame() only mutates state when it
          // finds a save, so empty slots leave defaults intact.
          try { loadGame(); } catch (e) {}
          updateTitleButtons();
          renderTitleSlots();
          try { if (audioInitialized) GameEngine.playSound('ui_tap'); } catch (e) {}
          toast('スロット ' + slotNum + ' を選択しました');
        });
        actions.appendChild(selectBtn);

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'tsl-btn danger';
        delBtn.textContent = '削除';
        delBtn.disabled = !sum;
        if (sum) {
          delBtn.addEventListener('click', function () {
            if (!confirm('スロット ' + slotNum + ' のセーブを削除しますか?')) return;
            try { localStorage.removeItem(_slotKeyFor(slotNum)); } catch (e) {}
            // Legacy un-slotted save also counts as slot 1; clear it too
            // so the slot reads as empty on the next render.
            if (slotNum === 1) {
              try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
            }
            updateTitleButtons();
            renderTitleSlots();
            toast('スロット ' + slotNum + ' を削除しました');
          });
        }
        actions.appendChild(delBtn);

        row.appendChild(actions);
        list.appendChild(row);
      })(i);
    }
  }

  function openLevelSelect() {
    var grid = el('lvlselGrid');
    grid.innerHTML = '';
    // Free-roam level order matches in-game progression
    // (0→1→…→8→11→12→13→14→15→9). 14 and 15 were missing previously.
    var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 9];
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
    if (hasEternalCharm()) player.inventory.eternal_charm = 1;
    player.flashlightOn = false;
    player.flashlightBattery = 0;
    player.radioOn = false;
    player.compassOn = false;
    player.equippedWeapon = null;
    player._wallClipPending = false;
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
    // iOS Safari fix: body has touch-action: none for canvas, which can leak
    // into overlays and stop their scroll containers from accepting
    // touchmove. We attach explicit touchstart/touchmove handlers to the
    // scrollable cards that translate finger drag into scrollTop changes,
    // bypassing the global touch-action.
    function bindManualScroll(el_) {
      if (!el_ || el_._manualScrollBound) return;
      el_._manualScrollBound = true;
      var startY = 0, startTop = 0, lastY = 0, lastT = 0;
      var velocity = 0, dragging = false, isScrolling = false;
      var DEAD_ZONE = 8;
      var momentumRaf = 0;
      function cancelMomentum() {
        if (momentumRaf) { cancelAnimationFrame(momentumRaf); momentumRaf = 0; }
      }
      function momentum() {
        if (Math.abs(velocity) < 0.05) { momentumRaf = 0; return; }
        var max = el_.scrollHeight - el_.clientHeight;
        el_.scrollTop = Math.max(0, Math.min(max, el_.scrollTop - velocity));
        velocity *= 0.93; // friction
        // Snap to boundary if hit
        if (el_.scrollTop <= 0 && velocity > 0) { velocity = 0; momentumRaf = 0; return; }
        if (el_.scrollTop >= max && velocity < 0) { velocity = 0; momentumRaf = 0; return; }
        momentumRaf = requestAnimationFrame(momentum);
      }
      el_.addEventListener('touchstart', function (e) {
        cancelMomentum();
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        startY = lastY = t.clientY;
        lastT = performance.now();
        startTop = el_.scrollTop;
        velocity = 0;
        dragging = true;
        isScrolling = false;
      }, { passive: true });
      el_.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dy = t.clientY - startY;
        if (!isScrolling && Math.abs(dy) < DEAD_ZONE) return;
        isScrolling = true;
        var now = performance.now();
        var dt = now - lastT;
        if (dt > 0) velocity = (t.clientY - lastY) / dt * 16; // ~px/frame @60fps
        lastY = t.clientY;
        lastT = now;
        el_.scrollTop = Math.max(0, Math.min(el_.scrollHeight - el_.clientHeight, startTop - dy));
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
      el_.addEventListener('touchend', function () {
        dragging = false;
        if (isScrolling && Math.abs(velocity) > 0.2) {
          // Kick off momentum scroll on flick
          momentumRaf = requestAnimationFrame(momentum);
        }
        isScrolling = false;
      }, { passive: true });
      el_.addEventListener('touchcancel', function () {
        dragging = false; isScrolling = false; velocity = 0;
      }, { passive: true });
    }
    bindManualScroll(el('titleArchiveOverlay') && el('titleArchiveOverlay').querySelector('.ta-card'));
    bindManualScroll(el('titleSettingsOverlay') && el('titleSettingsOverlay').querySelector('.ts-card'));
    bindManualScroll(el('shopOverlay') && el('shopOverlay').querySelector('.shop-card'));

    // Title archive: tab buttons (5 panels)
    var taTabs = document.querySelectorAll('.ta-tab');
    for (var taI = 0; taI < taTabs.length; taI++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var which = btn.getAttribute('data-ta-tab');
          var tabs = document.querySelectorAll('.ta-tab');
          for (var x = 0; x < tabs.length; x++) tabs[x].classList.toggle('active', tabs[x] === btn);
          var panels = {
            'notes':    'taPanelNotes',
            'secret':   'taPanelSecret',
            'items':    'taPanelItems',
            'bestiary': 'taPanelBestiary',
            'achs':     'taPanelAchs'
          };
          for (var k in panels) {
            var p = el(panels[k]);
            if (p) p.style.display = (which === k) ? 'block' : 'none';
          }
        });
      })(taTabs[taI]);
    }
    var taBackdrop = el('titleArchiveOverlay');
    if (taBackdrop) {
      taBackdrop.addEventListener('click', function (e) {
        if (e.target === taBackdrop) hideOverlay('titleArchiveOverlay');
      });
    }

    // Item-use modal: D-pad assignment buttons
    var iuAssignBtns = document.querySelectorAll('.iu-assign-btn');
    for (var ai = 0; ai < iuAssignBtns.length; ai++) {
      (function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          bindIuAssign(btn.getAttribute('data-iu-dir'));
        });
      })(iuAssignBtns[ai]);
    }

    // Shop overlay close + tab switching
    var scBtn = el('shopCloseBtn');
    if (scBtn) scBtn.addEventListener('click', closeShop);
    var shopOv = el('shopOverlay');
    if (shopOv) {
      shopOv.addEventListener('click', function (e) {
        // backdrop tap → close. Inside .shop-card stays open.
        if (e.target === shopOv) closeShop();
      });
    }
    var shopTabs = document.querySelectorAll('.shop-tab');
    for (var sti = 0; sti < shopTabs.length; sti++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          shopState.panel = btn.getAttribute('data-shop-tab');
          renderShop();
        });
      })(shopTabs[sti]);
    }

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
      // Clear all known keys (including dpad assignments + secret docs +
      // defeated entities + hidden boss flag — anything that persists).
      var keys = ['thebackrooms_save_v1', 'thebackrooms_ach_v1', 'thebackrooms_best_v1', 'thebackrooms_diff_v1', 'thebackrooms_tut_v1', 'thebackrooms_endless_v1', 'thebackrooms_stats_v1', 'thebackrooms_ent_seen_v1', 'thebackrooms_lifetime_notes_v1', 'thebackrooms_items_collected_v1', 'thebackrooms_gfx_v1', 'bk_master_vol', 'bk_bgm_vol', 'bk_se_vol', 'bk_sens', 'bk_grain',
        'bk_dpad_assignments_v1', 'bk_dpad_mode_v1',
        'thebackrooms_secret_docs_v1', 'thebackrooms_defeated_entities_v1',
        'thebackrooms_hidden_boss_kill_v1', 'thebackrooms_just_died_v1',
        'thebackrooms_cheat_unlocked_v1',
        // 2026-06-07 additions:
        'thebackrooms_mg_played_v1', // single-use minigame lock
        'bk_view_smooth',            // title settings view smoothing
        'bk_tts_voices',             // TTS uncanny voice toggle
        'thebackrooms_gamepad_v1',   // gamepad button map
        // 2026-06-08 additions:
        'thebackrooms_current_slot_v1', // active save slot
        'thebackrooms_slot_names_v1'];  // per-slot display names
      keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      // Per-slot save data — slot 1 covered by legacy key above, others
      // need explicit cleanup so the freshly-reset profile sees a clean
      // slate across all 5 slots.
      for (var _sk = 1; _sk <= 5; _sk++) {
        try { localStorage.removeItem('thebackrooms_save_v1_s' + _sk); } catch (e) {}
      }
      // Reset in-memory state
      unlockedAchievements = {};
      bestTimes = {};
      stats = { totalDeaths: 0, totalNoClips: 0, totalRuns: 0, totalPlayTime: 0, totalItemsCollected: 0, totalNotesRead: 0, totalDistanceWalked: 0 };
      entitySeenTypes = {};
      lifetimeNoteTitles = {};
      endlessBestScore = 0;
      tutorialDone = false;
      currentDifficulty = 'normal';
      dpadAssignments = { weapon: { up: '', down: '', left: '', right: '' },
                          item:   { up: '', down: '', left: '', right: '' } };
      dpadMode = 'item';
      collectedSecretDocs = {};
      defeatedEntities = {};
      toast('全データを削除しました (D-pad 割当も含む)');
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
      var dEl = el('difficultyBtn');
      dEl.textContent = '難易度: ' + DIFFICULTIES[next].name;
      dEl.classList.toggle('chaos-on', next === 'chaos');
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
      if (audioInitialized) GameEngine.playSound('ui_tap');
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
      if (audioInitialized) GameEngine.playSound('ui_tap');
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
        if (audioInitialized) GameEngine.playSound('ui_tab');
        if (navigator.vibrate) navigator.vibrate(8);
      });
    });

    el('closeNoteBtn').addEventListener('click', function (e) {
      // Final guard: ignore any synthetic clicks that slip past the disabled
      // attribute window — only close when armed (released-then-pressed AND
      // open-grace elapsed).
      if (!_canCloseNote()) {
        if (e && e.preventDefault) e.preventDefault();
        return;
      }
      hideOverlay('noteViewerOverlay');
      if (audioInitialized) GameEngine.playSound('paper_close');
    });

    // Item use modal
    el('itemUseConfirmBtn').addEventListener('click', function () {
      if (audioInitialized) GameEngine.playSound('ui_tap');
      confirmItemUse();
    });
    el('itemUseCancelBtn').addEventListener('click', function () {
      if (audioInitialized) GameEngine.playSound('ui_tap');
      closeItemUseModal();
    });
    // 「装備する」 — only shown for weapons. Sets player.equippedWeapon so
    // the lower-right weapon attack button fires this weapon on tap / R1.
    var iueBtn = el('itemUseEquipBtn');
    if (iueBtn) {
      iueBtn.addEventListener('click', function () {
        if (audioInitialized) GameEngine.playSound('ui_tap');
        if (_pendingItemId) equipWeapon(_pendingItemId);
        closeItemUseModal();
      });
    }
    // weaponAttackBtn → fire equipped weapon. Two-path binding:
    //   touchstart: fires immediately and is delivered even while the
    //               left thumb is holding the move zone (multitouch on
    //               iOS sometimes drops the synthetic click during an
    //               active touch, so player feedback was "ボタンが
    //               反応しない 移動中" — 2026-06-08 user report).
    //   click:      mouse + accessibility fallback. Debounced against
    //               the touch path so a single press doesn't double-fire.
    var wabBtn = el('weaponAttackBtn');
    if (wabBtn) {
      var _wabLastFire = 0;
      function _wabFireNow(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var now = performance.now();
        if (now - _wabLastFire < 250) return;
        _wabLastFire = now;
        fireEquippedWeapon();
      }
      wabBtn.addEventListener('touchstart', function (e) {
        e.preventDefault();
        _wabFireNow(e);
      }, { passive: false });
      wabBtn.addEventListener('click', _wabFireNow);
    }

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
      // Default grain bumped down to 0 — lightest setting for mobile performance.
      grainS.value = parseInt(localStorage.getItem('bk_grain') || '0', 10);
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
      if (confirm('現在のスロットのセーブを削除しますか?')) {
        try { localStorage.removeItem(_saveSlotKey()); } catch (e) {}
        try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
        // Also clear D-pad assignments so the slot UI starts fresh and the
        // spoiler guard re-evaluates from scratch on the next run.
        try {
          localStorage.removeItem('bk_dpad_assignments_v1');
          localStorage.removeItem('bk_dpad_mode_v1');
        } catch (e) {}
        dpadAssignments = { weapon: { up: '', down: '', left: '', right: '' },
                            item:   { up: '', down: '', left: '', right: '' } };
        dpadMode = 'item';
        toast('セーブを削除 (割当もリセット)');
        updateTitleButtons();
      }
    });
    // GFX quality toggle
    var gfxBtn = el('gfxQualityBtn');
    var gfxValueEl = el('gfxQualityValue');
    if (gfxBtn) {
      // Default graphics quality LOW — heavy mobile bias. Users can switch to HIGH manually.
      var gfxStored = localStorage.getItem(GFX_KEY);
      gfxQuality = (gfxStored === 'high') ? 'high' : 'low';
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

    // Performance toggles — individual switches in addition to the global
    // graphics quality. All persist in localStorage and apply immediately to
    // the engine flags. Default to ON for parity with current behaviour, but
    // mobile users on the LOW quality preset already get most of these off.
    function setupPerfToggle(btnId, valueId, flagKey, engineProp, defaultOn) {
      var btn = el(btnId);
      var valEl = el(valueId);
      if (!btn) return;
      var storedRaw = localStorage.getItem(flagKey);
      var on = (storedRaw === null) ? !!defaultOn : (storedRaw === '1');
      GameEngine[engineProp] = on;
      if (valEl) valEl.textContent = on ? 'ON' : 'OFF';
      btn.addEventListener('click', function () {
        on = !on;
        GameEngine[engineProp] = on;
        try { localStorage.setItem(flagKey, on ? '1' : '0'); } catch (e) {}
        if (valEl) valEl.textContent = on ? 'ON' : 'OFF';
        toast(btn.querySelector('.settings-label').textContent + ': ' + (on ? 'ON' : 'OFF'));
      });
    }
    setupPerfToggle('perfParticlesBtn', 'perfParticlesValue', 'bk_perf_particles', 'particlesEnabled', true);
    setupPerfToggle('perfPostFxBtn',    'perfPostFxValue',    'bk_perf_postfx',    'postFxEnabled',    true);
    setupPerfToggle('perfShakeBtn',     'perfShakeValue',     'bk_perf_shake',     'shakeEnabled',     true);
    setupPerfToggle('perfBgmBtn',       'perfBgmValue',       'bk_perf_bgm',       'bgmEnabled',       true);
    setupPerfToggle('perfLowResBtn',    'perfLowResValue',    'bk_perf_lowres',    'lowResMode',       false);

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

    // Pause / phone toggle: ESC or P. In-game = open phone (game pauses).
    // While an overlay is open, ESC closes it. Tab = floating map. M = map.
    window.addEventListener('keydown', function (e) {
      // Don't hijack typing in inputs (e.g. settings sliders)
      var tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')) return;
      // Note viewer: any key closes (after arm), matching gamepad any-button behavior.
      // Auto-repeat keydown events are ignored so holding the pickup key doesn't close.
      var nvAny = el('noteViewerOverlay');
      if (nvAny && nvAny.style.display !== 'none' && nvAny.style.display !== '') {
        if (!e.repeat && _canCloseNote()) {
          el('closeNoteBtn').click();
        }
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        // Close any open overlay in priority order
        var nv = el('noteViewerOverlay');
        if (nv && nv.style.display !== 'none' && nv.style.display !== '') {
          // Respect the arm-gate (release + grace) before honouring Esc.
          if (_canCloseNote()) {
            el('closeNoteBtn').click();
          }
          return;
        }
        var iu = el('itemUseModal');
        if (iu && iu.style.display !== 'none' && iu.style.display !== '') {
          closeItemUseModal(); return;
        }
        if (phoneOpen) { closePhone(); return; }
        var ts = el('titleSettingsOverlay');
        if (ts && ts.style.display !== 'none' && ts.style.display !== '') {
          window.__titleAction && window.__titleAction('closeSettings'); return;
        }
        var tut = el('tutorialOverlay');
        if (tut && tut.style.display !== 'none' && tut.style.display !== '') {
          hideOverlay('tutorialOverlay'); return;
        }
        // No overlay open & in-game → open phone (= pause)
        if (state === ST.PLAYING) { openPhone(); }
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && state === ST.PLAYING) {
        if (phoneOpen) closePhone();
        else openPhone();
        return;
      }
    });

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
    bindTitleSetting('tsViewSmooth', 'tsViewSmoothVal', 'bk_view_smooth',
      function (x) { return x + (x == 0 ? ' (硬)' : ''); });
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
    // Enforce vibrate toggle — wrap navigator.vibrate so existing
    // call sites automatically respect bk_vibrate. Previously the
    // toggle saved but every call still fired regardless.
    if (typeof navigator.vibrate === 'function' && !navigator._bkWrapped) {
      var _origVibrate = navigator.vibrate.bind(navigator);
      navigator.vibrate = function (pattern) {
        try {
          if (localStorage.getItem('bk_vibrate') === '0') return false;
        } catch (e) {}
        try { return _origVibrate(pattern); } catch (e) { return false; }
      };
      navigator._bkWrapped = true;
    }
    var tsFps = el('tsFpsToggle');
    if (tsFps) {
      var fpsOn = localStorage.getItem('bk_fps') === '1';
      tsFps.textContent = fpsOn ? 'ON' : 'OFF';
      tsFps.classList.toggle('off', !fpsOn);
      var fpsInd = el('fpsIndicator');
      if (fpsInd) fpsInd.style.display = fpsOn ? 'block' : 'none';
      tsFps.addEventListener('click', function () {
        fpsOn = !fpsOn;
        localStorage.setItem('bk_fps', fpsOn ? '1' : '0');
        tsFps.textContent = fpsOn ? 'ON' : 'OFF';
        tsFps.classList.toggle('off', !fpsOn);
        if (fpsInd) fpsInd.style.display = fpsOn ? 'block' : 'none';
      });
    }
    // TTS uncanny voices opt-out — defaults ON, persists as bk_tts_voices.
    var tsTts = el('tsTtsVoicesToggle');
    if (tsTts) {
      var ttsOn = localStorage.getItem('bk_tts_voices') !== '0';
      tsTts.textContent = ttsOn ? 'ON' : 'OFF';
      tsTts.classList.toggle('off', !ttsOn);
      tsTts.addEventListener('click', function () {
        ttsOn = !ttsOn;
        localStorage.setItem('bk_tts_voices', ttsOn ? '1' : '0');
        tsTts.textContent = ttsOn ? 'ON' : 'OFF';
        tsTts.classList.toggle('off', !ttsOn);
        if (!ttsOn) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
      });
    }
    // Title-screen Performance toggles (mirror of in-game Phone Options).
    // Same storage keys + engine flags so both UIs are in sync. Phone-options
    // already binds with setupPerfToggle on init; here we re-read storage so
    // toggling from either side reflects on the next overlay open.
    function setupTsPerfToggle(btnId, flagKey, engineProp, defaultOn) {
      var btn = el(btnId);
      if (!btn) return;
      function read() {
        var raw = localStorage.getItem(flagKey);
        return (raw === null) ? !!defaultOn : (raw === '1');
      }
      function paint(on) {
        btn.textContent = on ? 'ON' : 'OFF';
        btn.classList.toggle('off', !on);
      }
      paint(read());
      btn.addEventListener('click', function () {
        var on = !read();
        try { localStorage.setItem(flagKey, on ? '1' : '0'); } catch (e) {}
        GameEngine[engineProp] = on;
        paint(on);
        // Sync the matching phone-options pill if it's been initialised.
        var phonePill = el(btnId.replace(/^tsPerf/, 'perf').replace(/Btn$/, 'Value'));
        if (phonePill) phonePill.textContent = on ? 'ON' : 'OFF';
      });
      // Expose a refresh hook so openTitleSettings can re-sync state when
      // the user toggled the same flag from the in-game phone first.
      btn._refresh = function () { paint(read()); };
    }
    setupTsPerfToggle('tsPerfParticlesBtn', 'bk_perf_particles', 'particlesEnabled', true);
    setupTsPerfToggle('tsPerfPostFxBtn',    'bk_perf_postfx',    'postFxEnabled',    true);
    setupTsPerfToggle('tsPerfShakeBtn',     'bk_perf_shake',     'shakeEnabled',     true);
    setupTsPerfToggle('tsPerfBgmBtn',       'bk_perf_bgm',       'bgmEnabled',       true);
    setupTsPerfToggle('tsPerfLowResBtn',    'bk_perf_lowres',    'lowResMode',       false);
    // Called whenever titleSettingsOverlay is shown so the perf toggles re-read
    // storage in case the user toggled the same flag from the phone settings.
    window.refreshTitleSettingsState = function () {
      ['tsPerfParticlesBtn', 'tsPerfPostFxBtn', 'tsPerfShakeBtn',
       'tsPerfBgmBtn', 'tsPerfLowResBtn'].forEach(function (id) {
        var b = el(id);
        if (b && typeof b._refresh === 'function') b._refresh();
      });
      // Re-sync sliders/toggles that already have their own state — values
      // already auto-load from storage on bind, but vibrate/fps/gfx can be
      // changed elsewhere too.
      var tsGfx = el('tsGfxToggle');
      if (tsGfx) {
        var gq = localStorage.getItem('thebackrooms_gfx_v1') === 'low' ? 'low' : 'high';
        tsGfx.textContent = gq === 'high' ? 'HIGH' : 'LOW';
        tsGfx.classList.toggle('off', gq === 'low');
      }
      var tsVib = el('tsVibrateToggle');
      if (tsVib) {
        var vibOn = localStorage.getItem('bk_vibrate') !== '0';
        tsVib.textContent = vibOn ? 'ON' : 'OFF';
        tsVib.classList.toggle('off', !vibOn);
      }
      var tsFps2 = el('tsFpsToggle');
      if (tsFps2) {
        var fpsOn2 = localStorage.getItem('bk_fps') === '1';
        tsFps2.textContent = fpsOn2 ? 'ON' : 'OFF';
        tsFps2.classList.toggle('off', !fpsOn2);
      }
      var tsTts2 = el('tsTtsVoicesToggle');
      if (tsTts2) {
        var ttsOn2 = localStorage.getItem('bk_tts_voices') !== '0';
        tsTts2.textContent = ttsOn2 ? 'ON' : 'OFF';
        tsTts2.classList.toggle('off', !ttsOn2);
      }
    };
    // Gamepad mapping UI — visual diagram + "press a button to assign" flow
    // PS4/PS5 standard mapping. Most controllers (Xbox, Switch Pro via Bluetooth)
    // expose the same button indices, just with different physical labels.
    var BTN_LABELS = ['✕', '◯', '□', '△', 'L1', 'R1', 'L2', 'R2',
                       'SHARE', 'OPTIONS', 'L3', 'R3', '↑', '↓', '←', '→', 'PS'];
    // Expose for pollGamepad to label pressed buttons
    window._gpBtnLabels = BTN_LABELS;
    function btnLabel(idx) {
      if (idx === undefined || idx === null || idx < 0) return '未割当';
      return BTN_LABELS[idx] || ('B' + idx);
    }
    function refreshGpFnUI() {
      var fnBtns = document.querySelectorAll('.ts-gp-assign');
      for (var i = 0; i < fnBtns.length; i++) {
        var fn = fnBtns[i].getAttribute('data-fn');
        if (!fnBtns[i].classList.contains('listening')) {
          fnBtns[i].textContent = btnLabel(gamepadMap[fn]);
        }
      }
      // Highlight bound buttons in diagram
      var diag = el('tsGpDiagram');
      if (diag) {
        var els = diag.querySelectorAll('[data-gp-btn]');
        var bound = {};
        for (var k in gamepadMap) { if (typeof gamepadMap[k] === 'number') bound[gamepadMap[k]] = 1; }
        for (var ei = 0; ei < els.length; ei++) {
          var b = els[ei].getAttribute('data-gp-btn');
          if (b.indexOf('+') >= 0) continue; // dpad combo, skip
          els[ei].classList.toggle('bound', !!bound[parseInt(b, 10)]);
        }
      }
    }
    refreshGpFnUI();

    // Assign click handler: enter listening mode, next gamepad button press = bind
    var listeningFn = null;
    var listeningBtn = null;
    function startListening(fn, btn) {
      listeningFn = fn;
      listeningBtn = btn;
      btn.classList.add('listening');
      btn.textContent = '押してください...';
    }
    function stopListening() {
      if (listeningBtn) {
        listeningBtn.classList.remove('listening');
      }
      listeningFn = null;
      listeningBtn = null;
      refreshGpFnUI();
    }
    var assignBtns = document.querySelectorAll('.ts-gp-assign');
    for (var ai = 0; ai < assignBtns.length; ai++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var fn = btn.getAttribute('data-fn');
          if (listeningFn === fn) {
            // Cancel listening
            stopListening();
          } else {
            if (listeningBtn) listeningBtn.classList.remove('listening');
            startListening(fn, btn);
          }
        });
      })(assignBtns[ai]);
    }
    // Hook into pollGamepad: when listening, capture next button press
    window._gpListeningHook = function (gp) {
      if (!listeningFn) return false;
      for (var bi = 0; bi < gp.buttons.length; bi++) {
        if (gp.buttons[bi].pressed) {
          gamepadMap[listeningFn] = bi;
          try { localStorage.setItem(GAMEPAD_KEY, JSON.stringify(gamepadMap)); } catch (e) {}
          var assignedLabel = BTN_LABELS[bi] || ('B' + bi);
          stopListening();
          toast('「' + listeningFn + '」を ' + assignedLabel + ' に設定');
          return true; // signal handled
        }
      }
      return false;
    };
    // Diagram live highlight: pressed button glows
    // Only run when settings overlay is visible — early exit saves frame budget.
    var _gpDiagElsCache = null;
    window._gpDiagramHook = function (gp) {
      var overlay = el('titleSettingsOverlay');
      if (!overlay || overlay.style.display === 'none') return;
      if (!_gpDiagElsCache) {
        var diag = el('tsGpDiagram');
        if (!diag) return;
        _gpDiagElsCache = diag.querySelectorAll('[data-gp-btn]');
      }
      var els = _gpDiagElsCache;
      for (var ei = 0; ei < els.length; ei++) {
        var b = els[ei].getAttribute('data-gp-btn');
        var pressed = false;
        if (b.indexOf('+') >= 0) {
          // dpad combo
          var parts = b.split('+');
          for (var pi = 0; pi < parts.length; pi++) {
            var pIdx = parseInt(parts[pi], 10);
            if (gp.buttons[pIdx] && gp.buttons[pIdx].pressed) { pressed = true; break; }
          }
        } else {
          var bIdx = parseInt(b, 10);
          if (gp.buttons[bIdx] && gp.buttons[bIdx].pressed) pressed = true;
        }
        els[ei].classList.toggle('pressed', pressed);
      }
    };

    var gpReset = el('tsGpResetBtn');
    if (gpReset) {
      gpReset.addEventListener('click', function () {
        gamepadMap = Object.assign({}, DEFAULT_GAMEPAD_MAP);
        try { localStorage.setItem(GAMEPAD_KEY, JSON.stringify(gamepadMap)); } catch (e) {}
        refreshGpFnUI();
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
    try { loadSecretDocs(); } catch (e) {}
    try { loadDefeated(); } catch (e) {}

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
        // When tab is hidden, stop the chase BGM loop so audio doesn't
        // keep going in background. Resume on visibility return only
        // if the player is still in chase state.
        if (document.hidden) {
          try { if (GameEngine.stopAll) GameEngine.stopAll(); } catch (e) {}
        } else {
          // Re-arm theme loops on resume if still playing the level.
          try {
            if (state === ST.PLAYING && currentLevelDef) {
              var theme = THEMES[currentLevelDef.theme];
              if (theme && theme.ambientLoop && audioInitialized) GameEngine.startLoop(theme.ambientLoop);
              if (theme && theme.bgmLoop && audioInitialized) GameEngine.startLoop(theme.bgmLoop);
            }
          } catch (e) {}
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

  // ── TITLE ARCHIVE — lifetime collected notes + achievement gallery ──
  function renderTitleArchive() {
    // Build a title → { text, levelId } index from NOTES_POOL so we can show
    // the full text of any note the player has ever read.
    var byTitle = {};
    for (var lk in NOTES_POOL) {
      var arr = NOTES_POOL[lk] || [];
      for (var ai = 0; ai < arr.length; ai++) {
        byTitle[arr[ai].title] = { text: arr[ai].text, levelId: parseInt(lk, 10) };
      }
    }
    var totalNotes = Object.keys(byTitle).length;
    var lifetime = Object.keys(lifetimeNoteTitles || {});
    var ownedNotes = lifetime.filter(function (t) { return byTitle[t]; });
    var notesList = el('taNotesList');
    var notesCount = el('taNotesCount');
    if (notesCount) notesCount.textContent = ownedNotes.length + ' / ' + totalNotes + ' 書類';
    if (notesList) {
      notesList.innerHTML = '';
      if (ownedNotes.length === 0) {
        notesList.innerHTML = '<p class="ta-empty">まだ書類を読んでいない</p>';
      } else {
        // Group notes by level so the player drills down LEVEL → note
        // → content instead of scrolling one giant flat list. User
        // request: 「項目ごとにサブ項目で分けて、選択したらそれが
        // 表示されるようにする」.
        var groups = {};
        ownedNotes.forEach(function (title) {
          var info = byTitle[title];
          var lvl = info.levelId;
          if (!groups[lvl]) groups[lvl] = [];
          groups[lvl].push({ title: title, info: info });
        });
        var lvlKeys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
        // Count totals per level for the header (owned / total)
        var totalByLevel = {};
        Object.keys(byTitle).forEach(function (t) {
          var l = byTitle[t].levelId;
          totalByLevel[l] = (totalByLevel[l] || 0) + 1;
        });
        lvlKeys.forEach(function (lvl) {
          var arr = groups[lvl];
          arr.sort(function (a, b) {
            return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
          });
          var grp = document.createElement('div');
          grp.className = 'ta-level-group';
          var head = document.createElement('div');
          head.className = 'ta-level-head';
          // Include the level's subtitle (THE LOBBY / HABITABLE ZONE / etc.)
          // so the player has thematic context, not just a number.
          var lvlDef = LEVELS[lvl];
          var lvlSubtitle = lvlDef ? (lvlDef.subtitle || '') : '';
          head.innerHTML =
            '<span class="ta-level-head-name">LEVEL ' + lvl +
            (lvlSubtitle ? ' <small class="ta-level-head-sub">' + lvlSubtitle + '</small>' : '') +
            '</span>' +
            '<span class="ta-level-head-count">' + arr.length +
            ' / ' + (totalByLevel[lvl] || arr.length) + '</span>' +
            '<span class="ta-level-head-caret">▶</span>';
          var inner = document.createElement('div');
          inner.className = 'ta-level-inner';
          arr.forEach(function (entry) {
            var row = document.createElement('div');
            row.className = 'ta-note-row';
            row.innerHTML =
              '<div class="ta-note-title">' + entry.title + '</div>' +
              '<div class="ta-note-body">' + entry.info.text + '</div>';
            row.addEventListener('click', function (e) {
              e.stopPropagation();
              row.classList.toggle('open');
            });
            inner.appendChild(row);
          });
          head.addEventListener('click', function () { grp.classList.toggle('open'); });
          grp.appendChild(head);
          grp.appendChild(inner);
          notesList.appendChild(grp);
        });
      }
    }
    // Secret docs panel — placeholder rows for locked items so the player
    // sees the total count + which slots are still missing.
    var secretList = el('taSecretList');
    var secretCount = el('taSecretCount');
    var sdHave = Object.keys(collectedSecretDocs).length;
    var sdTotal = SECRET_DOCS.length;
    if (secretCount) {
      var prefix = (sdHave >= sdTotal) ? '★ 全資料収集 ★ ' : '';
      secretCount.textContent = prefix + sdHave + ' / ' + sdTotal + ' 秘匿書類';
      secretCount.classList.toggle('all-collected', sdHave >= sdTotal);
    }
    if (secretList) {
      secretList.innerHTML = '';
      SECRET_DOCS.forEach(function (doc, idx) {
        var unlocked = !!collectedSecretDocs[doc.id];
        var row = document.createElement('div');
        row.className = 'ta-note-row' + (unlocked ? '' : ' locked');
        if (unlocked) {
          row.innerHTML =
            '<div class="ta-note-title">' + doc.title + '</div>' +
            '<div class="ta-note-level">LEVEL ' + doc.levelId + '</div>' +
            '<div class="ta-note-body">' + doc.text + '</div>';
          row.addEventListener('click', function () { row.classList.toggle('open'); });
        } else {
          // Acquisition hint — pickup vs kill vs condition read differently
          var acqDesc;
          var acqHere = doc.acquisition || { type: 'pickup', levelId: doc.levelId };
          if (acqHere.type === 'kill') {
            acqDesc = 'LEVEL ' + acqHere.levelId + ' で ' + acqHere.label;
          } else if (acqHere.type === 'low_san') {
            acqDesc = acqHere.label || '低 SAN で時間経過';
          } else if (acqHere.type === 'discover_count') {
            acqDesc = acqHere.label || '通常書類 N 件以上で解禁';
          } else {
            acqDesc = 'LEVEL ' + acqHere.levelId + ' で取得可能';
          }
          row.innerHTML =
            '<div class="ta-note-title">— 第' + (idx + 1) + '号 (未収集)</div>' +
            '<div class="ta-note-level">' + acqDesc + '</div>';
        }
        secretList.appendChild(row);
      });
    }
    // Items panel — lifetime collected items + descriptions
    var itemsList = el('taItemsList');
    var itemsCount = el('taItemsCount');
    var lifetimeOwned = {};
    try { lifetimeOwned = JSON.parse(localStorage.getItem('thebackrooms_items_collected_v1') || '{}'); } catch (e) {}
    var allItemIds = Object.keys(ITEMS);
    var ownedItemIds = allItemIds.filter(function (id) { return !!lifetimeOwned[id]; });
    if (itemsCount) itemsCount.textContent = ownedItemIds.length + ' / ' + allItemIds.length + ' 道具/武器';
    if (itemsList) {
      itemsList.innerHTML = '';
      // Show owned first; locked rows show ??
      var weaponsHave = [], itemsHave = [], lockedAll = [];
      allItemIds.forEach(function (id) {
        var it = ITEMS[id];
        if (!it) return;
        if (lifetimeOwned[id]) {
          if (it.category === 'weapon') weaponsHave.push(id);
          else itemsHave.push(id);
        } else {
          lockedAll.push(id);
        }
      });
      function addItemRow(id, unlocked) {
        var it = ITEMS[id];
        var row = document.createElement('div');
        row.className = 'ta-note-row' + (unlocked ? '' : ' locked');
        if (unlocked) {
          var iconHtml = WEAPON_SVG[id]
            ? '<span class="ta-item-icon ta-item-icon-svg">' + WEAPON_SVG[id] + '</span>'
            : '<span class="ta-item-icon">' + it.icon + '</span>';
          row.innerHTML =
            '<div class="ta-item-head">' +
              iconHtml +
              '<span class="ta-item-name">' + it.name + '</span>' +
              '<span class="ta-item-cat">' + (it.category === 'weapon' ? '武器' : (it.persistent ? '装備' : '消耗品')) + '</span>' +
            '</div>' +
            '<div class="ta-note-body" style="display:block;">' + (it.desc || '').replace(/\n/g, '<br>') + '</div>';
        } else {
          row.innerHTML =
            '<div class="ta-item-head">' +
              '<span class="ta-item-icon">?</span>' +
              '<span class="ta-item-name">— 未発見 —</span>' +
            '</div>';
        }
        itemsList.appendChild(row);
      }
      var sec1 = document.createElement('h3'); sec1.className = 'ta-sub-h'; sec1.textContent = '武器';
      itemsList.appendChild(sec1);
      weaponsHave.forEach(function (id) { addItemRow(id, true); });
      var sec2 = document.createElement('h3'); sec2.className = 'ta-sub-h'; sec2.textContent = '道具';
      itemsList.appendChild(sec2);
      itemsHave.forEach(function (id) { addItemRow(id, true); });
      if (lockedAll.length > 0) {
        var sec3 = document.createElement('h3'); sec3.className = 'ta-sub-h'; sec3.textContent = '未発見';
        itemsList.appendChild(sec3);
        lockedAll.forEach(function (id) { addItemRow(id, false); });
      }
    }

    // Bestiary panel — entities the player has defeated, with weak/strong gear
    var bestList = el('taBestiaryList');
    var bestCount = el('taBestiaryCount');
    var BESTIARY_DATA = {
      hound:       { icon: '🐕', name: 'HOUND' },
      smiler:      { icon: '👁', name: 'SMILER' },
      skinstealer: { icon: '🧥', name: 'SKIN-STEALER' },
      partygoer:   { icon: '🍰', name: 'PARTYGOER' },
      crawler:     { icon: '🕷', name: 'CRAWLER' },
      wretch:      { icon: '🌀', name: 'WRETCH' },
      haruki:      { icon: '👤', name: 'HARUKI' },
      echo:        { icon: '🔁', name: 'ECHO' },
      faceling:    { icon: '🫥', name: 'FACELING' },
      civilian:    { icon: '🧍', name: 'CIVILIAN' },
      witness:     { icon: '👁‍🗨', name: 'WITNESS' },
      lurker:      { icon: '🕵', name: 'LURKER' },
      shadow:      { icon: '🌑', name: 'SHADOW' },
      drowned:     { icon: '🫧', name: 'DROWNED' },
      vinewalker:  { icon: '🌿', name: 'VINEWALKER' },
      mrhotel:     { icon: '🎩', name: 'MR.HOTEL' },
      boss:        { icon: '👹', name: 'BOSS' },
      haruki_boss: { icon: '🩸', name: 'HARUKI 真' }
    };
    // Helper — normalize legacy number format to object format on read
    function _bestEntry(t) {
      var v = defeatedEntities[t];
      if (!v) return null;
      if (typeof v === 'number') return { count: v };
      return v;
    }
    var allEntityIds = Object.keys(BESTIARY_DATA);
    var defeatedIds = allEntityIds.filter(function (t) { return (_bestEntry(t) || {}).count > 0; });
    if (bestCount) bestCount.textContent = defeatedIds.length + ' / ' + allEntityIds.length + ' 生物';
    if (bestList) {
      bestList.innerHTML = '';
      allEntityIds.forEach(function (t) {
        var d = BESTIARY_DATA[t];
        var entry = _bestEntry(t) || {};
        var killed = (entry.count || 0) > 0;
        var row = document.createElement('div');
        row.className = 'ta-note-row' + (killed ? '' : ' locked');
        if (killed) {
          // Find strongest / weakest weapons against this enemy
          var mults = WEAPON_DAMAGE_MULT[t] || {};
          var entries = Object.keys(mults).map(function (wId) {
            return { id: wId, mul: mults[wId], name: (ITEMS[wId] && ITEMS[wId].name) || wId };
          });
          entries.sort(function (a, b) { return b.mul - a.mul; });
          var strongest = entries.slice(0, 2).filter(function (e) { return e.mul > 1.0; });
          var weakest   = entries.slice(-2).filter(function (e) { return e.mul < 1.0; });
          var strongStr = strongest.length
            ? strongest.map(function (e) { return e.name + ' (×' + e.mul.toFixed(1) + ')'; }).join(' / ')
            : '— 特になし';
          var weakStr   = weakest.length
            ? weakest.map(function (e) { return e.name + ' (×' + e.mul.toFixed(1) + ')'; }).join(' / ')
            : '— 特になし';
          var intro = ENTITY_INTROS[t];
          var descHtml = intro
            ? '<div style="color:#d8d2bc;margin-top:6px;font-size:11px;line-height:1.6;white-space:pre-wrap;">' + intro.desc + '</div>'
            : '';
          // Detail record: first kill date + last level + HP seen
          var detailParts = [];
          if (entry.firstAt) detailParts.push('初討伐: ' + new Date(entry.firstAt).toLocaleDateString());
          if (entry.lastLevel !== undefined) detailParts.push('最終 LV' + entry.lastLevel);
          if (entry.hpMaxSeen) detailParts.push('HP 上限: ' + entry.hpMaxSeen);
          var detailHtml = detailParts.length
            ? '<div style="color:#806020;margin-top:4px;font-size:10px;letter-spacing:0.1em;">' +
              detailParts.join(' / ') + '</div>'
            : '';
          row.innerHTML =
            '<div class="ta-item-head">' +
              '<span class="ta-item-icon">' + d.icon + '</span>' +
              '<span class="ta-item-name">' + d.name + '</span>' +
              '<span class="ta-item-cat">×' + (entry.count || 0) + '</span>' +
            '</div>' +
            '<div class="ta-note-body" style="display:block;">' +
              '<div style="color:#88c050;">有効: ' + strongStr + '</div>' +
              '<div style="color:#c63a3a;">不得手: ' + weakStr + '</div>' +
              detailHtml +
              descHtml +
            '</div>';
        } else {
          row.innerHTML =
            '<div class="ta-item-head">' +
              '<span class="ta-item-icon">?</span>' +
              '<span class="ta-item-name">— ???</span>' +
            '</div>';
        }
        bestList.appendChild(row);
      });
    }

    // Achievements panel
    var achsList = el('taAchsList');
    var achsCount = el('taAchsCount');
    var achIds = Object.keys(ACHIEVEMENTS);
    var achUnlocked = achIds.filter(function (id) { return !!unlockedAchievements[id]; }).length;
    if (achsCount) achsCount.textContent = achUnlocked + ' / ' + achIds.length + ' 達成';
    if (achsList) {
      achsList.innerHTML = '';
      achIds.forEach(function (id) {
        var ach = ACHIEVEMENTS[id];
        var unlocked = !!unlockedAchievements[id];
        var hidden = !!ach.hidden;
        var row = document.createElement('div');
        row.className = 'ta-ach-row' + (unlocked ? '' : ' locked');
        // Hidden achievements show ??? until unlocked
        var iconStr = unlocked ? ach.icon : (hidden ? '?' : '?');
        var nameStr = unlocked ? ach.name : (hidden ? '— ??? —' : '— 未達成 —');
        var descStr = unlocked && ach.desc ? ach.desc
                    : (hidden ? '— 隠し条件 —' : '');
        row.innerHTML =
          '<span class="ta-ach-icon">' + iconStr + '</span>' +
          '<div class="ta-ach-info">' +
            '<div class="ta-ach-name">' + nameStr + '</div>' +
            (descStr ? '<div class="ta-ach-desc">' + descStr + '</div>' : '') +
          '</div>';
        achsList.appendChild(row);
      });
    }
  }

  // Global title action façade — used by inline onclick attrs as a robust fallback
  // so title buttons always work even if addEventListener fails for any reason.
  window.__titleAction = function (action) {
    var stage = 'enter';
    try {
      stage = 'audio_init';
      if (!audioInitialized) {
        try { GameEngine.initAudio(); } catch (e) {}
        audioInitialized = true;
        var hint = el('tapToStartHint');
        if (hint) hint.classList.add('hidden');
        // Start title BGM (classical horror loop) once audio is up
        setTimeout(function () {
          if (state === ST.TITLE) {
            try { GameEngine.startLoop('classical'); } catch (e) {}
          }
        }, 100);
      } else {
        // Already initialized — but iOS may have re-suspended audioCtx.
        try { GameEngine.initAudio(); } catch (e) {} // idempotent + re-resumes
      }
      // Tap SE for any title-screen action (start, settings, difficulty, etc.)
      try { if (audioInitialized) GameEngine.playSound('ui_tap'); } catch (e) {}
      stage = 'switch:' + action;
      switch (action) {
        case 'start':
          // Confirm-overwrite when a save already exists, so players don't
          // accidentally nuke a long run by tapping はじめから.
          stage = 'startNewGame';
          if (typeof hasSave === 'function' && hasSave()) {
            var ok = window.confirm('既存のセーブを上書きして最初から始めますか？');
            if (!ok) return;
          }
          startNewGame();
          break;
        case 'continue': stage = 'continueGame'; continueGame(); break;
        case 'endless': stage = 'startEndlessMode'; startEndlessMode(); break;
        case 'freeroam': stage = 'openLevelSelect'; openLevelSelect(); break;
        case 'difficulty':
          stage = 'difficulty';
          var order = ['easy', 'normal', 'hard', 'chaos'];
          var idx = order.indexOf(currentDifficulty);
          var nx = order[(idx + 1) % order.length];
          setDifficulty(nx);
          var dbtn = el('difficultyBtn');
          if (dbtn) {
            dbtn.textContent = '難易度: ' + DIFFICULTIES[nx].name;
            dbtn.classList.toggle('chaos-on', nx === 'chaos');
          }
          // Per-difficulty hint toast so the player understands what they
          // signed up for — especially chaos (sparse items per user spec).
          var DIFF_HINTS = {
            easy:   'EASY — HP 1.5倍 / 敵速度 0.7倍 / SAN drain 0.5倍',
            normal: 'NORMAL — 基準値',
            hard:   'HARD — HP 0.7倍 / 敵速度 1.3倍 / アイテム 85%',
            chaos:  'CHAOS — HP 0.5倍 / 敵速度 1.8倍 / アイテム 50% / SAN drain 2.5倍'
          };
          if (DIFF_HINTS[nx]) toast(DIFF_HINTS[nx]);
          break;
        case 'cheat':
          stage = 'cheat';
          if (!cheatUnlocked) { toast('一度クリアすると解禁'); break; }
          cheatActive = !cheatActive;
          var cb = el('cheatBtn');
          if (cb) cb.textContent = '無双モード: ' + (cheatActive ? 'ON' : 'OFF');
          toast(cheatActive ? '★ 無双モード ON — 全アイテム無限・3倍ダメージ' : '無双モード OFF');
          break;
        case 'controls': stage = 'controls'; showOverlay('tutorialOverlay'); break;
        case 'archive':
          stage = 'archive';
          renderTitleArchive();
          showOverlay('titleArchiveOverlay');
          break;
        case 'closeArchive':
          stage = 'closeArchive';
          hideOverlay('titleArchiveOverlay');
          break;
        case 'slots':
          stage = 'slots';
          renderTitleSlots();
          showOverlay('titleSlotsOverlay');
          break;
        case 'closeSlots':
          stage = 'closeSlots';
          hideOverlay('titleSlotsOverlay');
          break;
        case 'settings':
          stage = 'settings';
          if (typeof window.refreshTitleSettingsState === 'function') window.refreshTitleSettingsState();
          showOverlay('titleSettingsOverlay');
          break;
        case 'settingsFromPhone':
          stage = 'settingsFromPhone';
          // Close phone first so titleSettingsOverlay (z=55) isn't hidden by phone (z=60)
          try { if (typeof closePhone === 'function') closePhone(); } catch (e) {}
          if (typeof window.refreshTitleSettingsState === 'function') window.refreshTitleSettingsState();
          showOverlay('titleSettingsOverlay');
          // The phone options entry point is labelled "詳細設定 (ゲームパッド/振動 etc.)"
          // so the user expects to land at the gamepad section. Scroll the
          // overlay there after layout settles. Without this, the overlay
          // opens at the audio-volume top and looks like a wrong screen.
          setTimeout(function () {
            var ov = el('titleSettingsOverlay');
            var diag = el('tsGpDiagram');
            if (ov && diag) {
              try {
                var topInOverlay = diag.offsetTop - 12;
                ov.scrollTop = Math.max(0, topInOverlay);
              } catch (e) {}
            }
          }, 60);
          break;
        case 'closeSettings':
          stage = 'closeSettings';
          hideOverlay('titleSettingsOverlay');
          // Prevent the same press/tap from bleeding into the title menu under it.
          window._gpGlobalLockUntil = performance.now() + 450;
          break;
        case 'reset':
          stage = 'reset';
          if (!confirm('全データ削除しますか?')) return;
          if (!confirm('最終確認: 取り消せません。本当に?')) return;
          var keys = ['thebackrooms_save_v1', 'thebackrooms_ach_v1', 'thebackrooms_best_v1', 'thebackrooms_diff_v1', 'thebackrooms_tut_v1', 'thebackrooms_endless_v1', 'thebackrooms_stats_v1', 'thebackrooms_ent_seen_v1', 'thebackrooms_lifetime_notes_v1', 'thebackrooms_items_collected_v1', 'thebackrooms_gfx_v1', 'bk_master_vol', 'bk_bgm_vol', 'bk_se_vol', 'bk_sens', 'bk_grain'];
          keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          toast('全データを削除しました');
          setTimeout(function () { location.reload(); }, 1200);
          break;
      }
    } catch (e) {
      // Surface errors visibly so they're not silently swallowed
      console.error('titleAction failed at stage:', stage, e);
      var errBanner = document.createElement('div');
      errBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#400;color:#fff;padding:14px;text-align:center;z-index:99999;font-size:12px;line-height:1.5;font-family:monospace;';
      errBanner.innerHTML = 'エラー: ' + action + ' @ ' + stage + '<br>' + (e && e.message ? e.message : String(e)) + '<br><button onclick="this.parentNode.remove()" style="margin-top:8px;padding:6px 14px;background:#fff;color:#400;border:0;border-radius:4px;cursor:pointer;">閉じる</button>';
      document.body.appendChild(errBanner);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
