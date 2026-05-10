/**
 * CHILL HARUKING - Game Logic
 * チル・ハルキング 〜ホテルの怪〜
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
    speed: 100,
    dir: 'down',
    color: '#880000',
    sprite: 'assets/img/haruki.png',
    active: false,
    visible: true,
    path: [],
    pathTimer: 0,
    chaseIntensity: 1.0,
    catchRadius: TS * 0.9
  };

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
    // Regular doors
    if (t === TILE.DOOR) {
      // find door
      for (var i = 0; i < doors.length; i++) {
        if (doors[i].gx === gx && doors[i].gy === gy) {
          if (doors[i].locked && !doors[i].open) return false;
          return true;
        }
      }
      return true; // unlisted door → walkable
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
    // Stick visuals are shown on touch, keep them available
    var el = document.getElementById('joystickArea');
    if (el) el.style.display = 'block';
    var la = document.getElementById('lookArea');
    if (la) la.style.display = 'block';
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
  }

  function onEnterFrontDesk() {
    hideOverlay('titleScreen');
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

    // Unlock room 404 door
    room404DoorRef = findDoor('404');
    if (room404DoorRef) {
      room404DoorRef.locked = false;
    }

    // Make the corridor slightly creepier
    phaseFlags.creepySoundTimer = 5; // first creepy sound after 5 sec
  }

  function onEnterEnterRoom() {
    // Player entered room 404
    phaseFlags.roomTimer = 0;
    phaseFlags.dialogueDone = false;

    queueDialogue([
      { speaker: 'あなた', text: '...お客様？ハルキ様？...誰もいない...？' }
    ], function () {
      phaseFlags.dialogueDone = true;
      phaseFlags.roomTimer = 0; // reset timer for exit delay
    });
  }

  function onEnterAttack() {
    hideActionBtn();
    hideJoystick();

    // JUMP SCARE SEQUENCE
    GameEngine.playSound('hit');
    GameEngine.shakeScreen(10, 300);

    setTimeout(function () {
      // Flash scary image
      var img = GameEngine.images['assets/img/haruki_scary.png'] || null;
      if (img) {
        GameEngine.flashImage(img, 400, function () {
          GameEngine.playSound('jumpscare');
          GameEngine.fadeToBlack(500, function () {
            // Pause in black
            setTimeout(function () {
              GameEngine.staticEffect(0.8);
              setTimeout(function () {
                setPhase(PHASES.WAKE_UP);
              }, 800);
            }, 1500);
          });
        });
      } else {
        // No image fallback
        GameEngine.playSound('jumpscare');
        GameEngine.redFlash();
        GameEngine.fadeToBlack(500, function () {
          setTimeout(function () {
            setPhase(PHASES.WAKE_UP);
          }, 1500);
        });
      }
    }, 200);
  }

  function onEnterWakeUp() {
    showJoystick();
    GameEngine.stopAll();

    // Teleport player to utility room
    var sp = gToW(2, 33);
    player.x = sp.x;
    player.y = sp.y;
    player.angle = Math.PI * 1.5; // facing up (north)
    player.dir = 'up';
    player.flashlightRadius = 100;
    player.flashlightFlicker = 0.8;
    player.hasKey = false;
    player.stamina = 1.0;

    // Reset items for explore phase
    resetItems();

    // Unlock rooms for exploration
    unlockExplorationDoors();

    GameEngine.fadeFromBlack(2000, function () {
      GameEngine.startLoop('breath');
      GameEngine.startLoop('ambient');

      queueDialogue([
        { speaker: 'あなた', text: '...うっ...頭が...ここは...用務室...？' },
        { speaker: 'あなた', text: '...出口を見つけないと...' }
      ], function () {
        setPhase(PHASES.EXPLORE);
      });
    });
  }

  function onEnterExplore() {
    showJoystick();
    showStamina();
    player.flashlightRadius = 100;
    player.flashlightFlicker = 0.6;
    creepyEventTimer = 8 + Math.random() * 7;
  }

  function onEnterChase1() {
    // Haruki appears!
    GameEngine.redFlash();
    GameEngine.startLoop('heartbeat');

    // Spawn Haruki at upper floor corridor
    var sp = gToW(14, 7);
    haruki.x = sp.x;
    haruki.y = sp.y;
    haruki.active = true;
    haruki.visible = true;
    haruki.chaseIntensity = 1.0;
    haruki.path = [];
    haruki.pathTimer = 0;

    // Brief dialogue flash
    queueDialogue([
      { speaker: '？？？', text: '...見ーつけた...' }
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

    GameEngine.fadeToBlack(1000, function () {
      setTimeout(function () {
        showOverlay('endingScreen');
      }, 500);
    });
  }

  function onEnterGameOver() {
    hideJoystick();
    hideStamina();
    hideActionBtn();
    GameEngine.stopAll();
    haruki.active = false;

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
    var labelsToUnlock = ['401', '402', '403', '405', '407', 'back1', 'back2', 'back3',
                          'utility', 'storage1', 'storage2'];
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

    var input = GameEngine.input;
    var turnSpeed = 2.5; // radians per second

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
  }

  function checkNearbyDoors() {
    var pg = wToG(player.x, player.y);
    for (var i = 0; i < doors.length; i++) {
      var d = doors[i];
      var dist = Math.abs(d.gx - pg.gx) + Math.abs(d.gy - pg.gy);
      if (dist <= 1 && !d.locked && !d.open) {
        d.open = true;
        GameEngine.playSound('door');
      }
    }
  }

  // =========================================================
  //  HARUKI AI UPDATE
  // =========================================================
  function updateHaruki(dt) {
    if (!haruki.active) return;

    // Increase chase intensity over time
    haruki.chaseIntensity += 0.02 * dt;
    var currentSpeed = haruki.speed * haruki.chaseIntensity;

    // Recalculate path periodically
    haruki.pathTimer -= dt;
    if (haruki.pathTimer <= 0) {
      haruki.pathTimer = 0.5;
      var hg = wToG(haruki.x, haruki.y);
      var pg = wToG(player.x, player.y);
      haruki.path = findPath(hg.gx, hg.gy, pg.gx, pg.gy) || [];
      // Remove the first element (current position)
      if (haruki.path.length > 0) haruki.path.shift();
    }

    // Follow path
    if (haruki.path.length > 0) {
      var next = haruki.path[0];
      var target = gToW(next.gx, next.gy);
      var ddx = target.x - haruki.x;
      var ddy = target.y - haruki.y;
      var dist = Math.sqrt(ddx * ddx + ddy * ddy);

      if (dist < 4) {
        haruki.x = target.x;
        haruki.y = target.y;
        haruki.path.shift();
      } else {
        var nx = ddx / dist;
        var ny = ddy / dist;
        haruki.x += nx * currentSpeed * dt;
        haruki.y += ny * currentSpeed * dt;

        // Update direction
        if (Math.abs(nx) > Math.abs(ny)) {
          haruki.dir = nx > 0 ? 'right' : 'left';
        } else {
          haruki.dir = ny > 0 ? 'down' : 'up';
        }
      }
    }

    // Check distance to player for heartbeat volume
    var pdx = player.x - haruki.x;
    var pdy = player.y - haruki.y;
    var pDist = Math.sqrt(pdx * pdx + pdy * pdy);

    // Catch check
    if (pDist < haruki.catchRadius) {
      // Caught!
      onHarukiCatchPlayer();
    }
  }

  function onHarukiCatchPlayer() {
    haruki.active = false;
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

    // Check if player is at Room 404 door
    var pg = wToG(player.x, player.y);
    var d404 = findDoor('404');
    if (d404 && !phaseFlags.knockShown) {
      var dist = Math.abs(pg.gx - d404.gx) + Math.abs(pg.gy - d404.gy);
      if (dist <= 1) {
        phaseFlags.knockShown = true;
        showActionBtn('ノックする', function () {
          GameEngine.playSound('knock');
          // Brief pause, then door opens
          setTimeout(function () {
            d404.locked = false;
            d404.open = true;
            GameEngine.playSound('door');
            setPhase(PHASES.ENTER_ROOM);
          }, 800);
        });
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
    // Random creepy events
    creepyEventTimer -= dt;
    if (creepyEventTimer <= 0) {
      triggerCreepyEvent();
      creepyEventTimer = 10 + Math.random() * 10;
    }

    // Flashlight flicker variation
    player.flashlightFlicker = 0.3 + Math.sin(phaseTimer * 2.5) * 0.15;
    if (Math.random() < 0.003) {
      player.flashlightFlicker = 1.0;
      setTimeout(function () { player.flashlightFlicker = 0.3; }, 150);
    }

    // Check for key card pickup
    if (keyCardItem && !keyCardItem.collected) {
      var pg = wToG(player.x, player.y);
      var dist = Math.abs(pg.gx - keyCardItem.gx) + Math.abs(pg.gy - keyCardItem.gy);
      if (dist <= 1 && !phaseFlags.keyActionShown) {
        phaseFlags.keyActionShown = true;
        showActionBtn('調べる', function () {
          keyCardItem.collected = true;
          player.hasKey = true;
          phaseFlags.keyActionShown = false;
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

    // Flashlight flicker intensifies
    player.flashlightFlicker = 0.4 + Math.sin(phaseTimer * 4) * 0.2;

    // Check if player reaches exit area
    var pg = wToG(player.x, player.y);
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

    // 5. Draw minimap
    if (phase === PHASES.EXPLORE || phase === PHASES.CHASE_1 || phase === PHASES.CHASE_FINAL ||
        phase === PHASES.WALK_TO_ROOM) {
      drawMinimap(ctx);
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
    if (!keyCardItem || keyCardItem.collected) return;

    // Render key card as a sprite in first-person
    var itemEntity = {
      x: keyCardItem.wx,
      y: keyCardItem.wy,
      w: 16,
      h: 16,
      color: '#ffcc00',
      visible: true
    };
    GameEngine.drawEntity(itemEntity);
  }

  function drawHarukiEntity(ctx) {
    // In first-person mode, the engine's sprite renderer handles Haruki
    GameEngine.drawEntity(haruki);
  }

  function drawMinimap(ctx) {
    var canvas = ctx.canvas;
    var mmW = 80;
    var mmH = 110;
    var mmX = canvas.width - mmW - 8;
    var mmY = 8;
    var tileSize = 2;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

    // Draw visited tiles
    ctx.fillStyle = '#333';
    var pg = wToG(player.x, player.y);

    for (var key in visitedTiles) {
      var parts = key.split(',');
      var gx = parseInt(parts[0]);
      var gy = parseInt(parts[1]);
      var tx = mmX + (gx / MAP_W) * mmW;
      var ty = mmY + (gy / MAP_H) * mmH;
      var t = MAP_TILES[gy] ? MAP_TILES[gy][gx] : 1;

      if (t === TILE.WALL || t === TILE.WINDOW) {
        ctx.fillStyle = '#555';
      } else {
        ctx.fillStyle = '#2a2a2a';
      }
      ctx.fillRect(tx, ty, tileSize + 1, tileSize + 1);
    }

    // Mark surrounding tiles as visited for discovery
    for (var dy = -3; dy <= 3; dy++) {
      for (var dx = -3; dx <= 3; dx++) {
        var vgx = pg.gx + dx;
        var vgy = pg.gy + dy;
        if (vgx >= 0 && vgy >= 0 && vgx < MAP_W && vgy < MAP_H) {
          visitedTiles[vgx + ',' + vgy] = true;
        }
      }
    }

    // Player dot
    var px = mmX + (pg.gx / MAP_W) * mmW;
    var py = mmY + (pg.gy / MAP_H) * mmH;
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(px - 1, py - 1, 3, 3);

    // Haruki dot (if active and within visited range)
    if (haruki.active) {
      var hg = wToG(haruki.x, haruki.y);
      if (visitedTiles[hg.gx + ',' + hg.gy]) {
        var hpx = mmX + (hg.gx / MAP_W) * mmW;
        var hpy = mmY + (hg.gy / MAP_H) * mmH;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(hpx - 1, hpy - 1, 3, 3);
      }
    }

    ctx.restore();
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

    updatePlayer(dt);
    updatePhase(dt);
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

    // Load the map
    var mapData = buildMapData();
    GameEngine.loadMap(mapData);

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
      startBtn.addEventListener('click', function () {
        if (phase !== PHASES.TITLE) return;
        if (!audioInitialized) {
          GameEngine.initAudio();
          audioInitialized = true;
        }
        setPhase(PHASES.FRONT_DESK);
      });
      startBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        if (phase !== PHASES.TITLE) return;
        if (!audioInitialized) {
          GameEngine.initAudio();
          audioInitialized = true;
        }
        setPhase(PHASES.FRONT_DESK);
      });
    }

    // Phone answer button
    var answerBtn = document.getElementById('answerBtn');
    if (answerBtn) {
      var handleAnswer = function () {
        if (phase !== PHASES.PHONE_CALL) return;
        hideOverlay('phoneUI');
        queueDialogue([
          { speaker: 'ハルキ', text: 'もしもし、フロント？404号室のハルキだけど...' },
          { speaker: 'ハルキ', text: 'バスタオルが部屋に無いんだけど、持ってきてくれない？' },
          { speaker: 'あなた', text: '（はぁ...面倒くさいな...）わかりました、すぐお持ちします。' },
          { speaker: 'ハルキ', text: 'ありがと〜、待ってるから。' }
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
      actionBtn.addEventListener('click', handleAction);
      actionBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
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

    // Title return button (ending)
    var titleReturnBtn = document.getElementById('titleReturnBtn');
    if (titleReturnBtn) {
      var handleReturn = function () {
        hideOverlay('endingScreen');
        setPhase(PHASES.TITLE);
      };
      titleReturnBtn.addEventListener('click', handleReturn);
      titleReturnBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        handleReturn();
      });
    }

    // Joystick handling
    bindJoystick();

    // Settings / pause
    bindSettingsButton();
  }

  // =========================================================
  //  VIRTUAL JOYSTICK (touch handled by engine via touch zones)
  // =========================================================
  function bindJoystick() {
    // Touch input is handled by engine.js touch zones.
    // No additional binding needed.
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
    var returnTitleBtn = document.getElementById('returnTitleFromSettings');

    if (!settingsBtn || !settingsOverlay) return;

    function syncSliders() {
      if (volumeSlider) volumeSlider.value = Math.round(GameEngine.getMasterVolume() * 100);
      if (bgmSlider) bgmSlider.value = Math.round(GameEngine.getBgmVolume() * 100);
      if (seSlider) seSlider.value = Math.round(GameEngine.getSeVolume() * 100);
      var vl = document.getElementById('volumeValue');
      var bl = document.getElementById('bgmValue');
      var sl = document.getElementById('seValue');
      if (vl) vl.textContent = Math.round(GameEngine.getMasterVolume() * 100) + '%';
      if (bl) bl.textContent = Math.round(GameEngine.getBgmVolume() * 100) + '%';
      if (sl) sl.textContent = Math.round(GameEngine.getSeVolume() * 100) + '%';
    }

    function openSettings() {
      if (phase === PHASES.TITLE) return;
      settingsOverlay.style.display = 'flex';
      GameEngine.paused = true;
      syncSliders();
    }

    settingsBtn.addEventListener('click', openSettings);
    settingsBtn.addEventListener('touchend', function (e) {
      e.preventDefault();
      openSettings();
    });

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', function () {
        settingsOverlay.style.display = 'none';
        GameEngine.paused = false;
      });
      closeSettingsBtn.addEventListener('touchend', function (e) {
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

    if (returnTitleBtn) {
      returnTitleBtn.addEventListener('click', function () {
        settingsOverlay.style.display = 'none';
        GameEngine.paused = false;
        setPhase(PHASES.TITLE);
      });
      returnTitleBtn.addEventListener('touchend', function (e) {
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
