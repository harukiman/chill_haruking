/**
 * GameEngine - First-Person Raycasting Horror Game Engine
 * Mobile-first, procedural audio, distance fog darkness system
 */
(function () {
  'use strict';

  var TILE_SIZE = 48;

  // ───────────────────────────────────────────────
  // Noise texture cache for floor rendering
  // ───────────────────────────────────────────────
  var noiseCanvas = null;
  var noiseCtx = null;
  var noiseSize = 256;

  function buildNoiseTexture() {
    noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = noiseSize;
    noiseCanvas.height = noiseSize;
    noiseCtx = noiseCanvas.getContext('2d');
    var id = noiseCtx.createImageData(noiseSize, noiseSize);
    var d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = (Math.random() * 20) | 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 25;
    }
    noiseCtx.putImageData(id, 0, 0);
  }

  // ───────────────────────────────────────────────
  // Player view state (first-person camera)
  // ───────────────────────────────────────────────
  var playerAngle = 0; // radians, 0 = east, PI/2 = south
  var playerX = 0; // world position (pixels)
  var playerY = 0;
  var FOV = Math.PI / 3; // 60 degree field of view

  // ───────────────────────────────────────────────
  // Flashlight / fog state
  // ───────────────────────────────────────────────
  var currentFlashlightRadius = 200;
  var currentFlashlightFlicker = 0;

  // ───────────────────────────────────────────────
  // Shake state
  // ───────────────────────────────────────────────
  var shakeOffsetX = 0;
  var shakeOffsetY = 0;
  var shakeIntensity = 0;
  var shakeDuration = 0;
  var shakeTimer = 0;

  // ───────────────────────────────────────────────
  // Fade state
  // ───────────────────────────────────────────────
  var fadeAlpha = 0;
  var fadeTarget = 0;
  var fadeDuration = 0;
  var fadeTimer = 0;
  var fadeCb = null;
  var fading = false;

  // ───────────────────────────────────────────────
  // Flash image state
  // ───────────────────────────────────────────────
  var flashImg = null;
  var flashDuration = 0;
  var flashTimer = 0;
  var flashCb = null;

  // ───────────────────────────────────────────────
  // Red flash state
  // ───────────────────────────────────────────────
  var redFlashAlpha = 0;

  // ───────────────────────────────────────────────
  // Static effect state
  // ───────────────────────────────────────────────
  var staticIntensity = 0;
  var staticCanvas = null;
  var staticCtx = null;

  // ───────────────────────────────────────────────
  // Dialogue state
  // ───────────────────────────────────────────────
  var dialogueActive = false;
  var dialogueSpeaker = '';
  var dialogueFullText = '';
  var dialogueDisplayed = '';
  var dialogueCharIndex = 0;
  var dialogueCharTimer = 0;
  var dialogueComplete = false;
  var dialogueCb = null;
  var DIALOGUE_CHAR_DELAY = 0.03; // seconds per character

  // ───────────────────────────────────────────────
  // Audio state
  // ───────────────────────────────────────────────
  var audioCtx = null;
  var audioInitialized = false;
  var masterGain = null;
  var bgmGain = null;
  var seGain = null;
  var activeLoops = {};
  var masterVolume = 0.7;
  var bgmVolume = 0.9;
  var seVolume = 0.8;
  var heartbeatRate = 800; // ms between beats
  var proximityBoost = 0;  // 0-1 extra BGM gain from enemy proximity

  // ───────────────────────────────────────────────
  // Joystick state
  // ───────────────────────────────────────────────
  var joystickTouchId = null;
  var joystickCenterX = 0;
  var joystickCenterY = 0;
  var joystickActive = false;
  var lastTapTime = 0;

  // Look area state (right side camera control)
  var lookTouchId = null;
  var lookLastX = 0;
  var lookActive = false;

  // ───────────────────────────────────────────────
  // Action button state
  // ───────────────────────────────────────────────
  var actionTouchId = null;
  var actionWasPressed = false;

  // ───────────────────────────────────────────────
  // Game loop
  // ───────────────────────────────────────────────
  var lastTime = 0;
  var rafId = null;

  // ───────────────────────────────────────────────
  // Raycasting renderer functions
  // ───────────────────────────────────────────────

  function getWallColor(tile, side, dist, isLower) {
    var r, g, b;
    if (isLower) {
      // Wainscoting / dark wood panel (lower wall)
      switch (tile) {
        case 1: r = 85; g = 55; b = 35; break;   // Dark oak panel
        case 2: r = 130; g = 85; b = 40; break;   // Door (lighter wood)
        case 6: r = 45; g = 110; b = 45; break;   // Exit door (green)
        case 7: r = 75; g = 50; b = 30; break;    // Furniture (dark wood)
        case 9: r = 100; g = 100; b = 110; break;  // Elevator (brushed metal)
        case 10: r = 55; g = 65; b = 95; break;    // Window
        default: r = 85; g = 55; b = 35; break;
      }
    } else {
      // Upper wall — warm cream/beige wallpaper with subtle pattern
      switch (tile) {
        case 1: r = 155; g = 135; b = 105; break;  // Cream wallpaper
        case 2: r = 160; g = 110; b = 50; break;   // Door (wood)
        case 6: r = 60; g = 150; b = 60; break;    // Exit door (green)
        case 7: r = 100; g = 90; b = 80; break;    // Furniture
        case 9: r = 140; g = 140; b = 150; break;  // Elevator (metal)
        case 10: r = 80; g = 90; b = 130; break;   // Window (blue tint)
        default: r = 155; g = 135; b = 105; break;
      }
    }

    // Darken one side for depth
    if (side === 1) { r = r * 0.72 | 0; g = g * 0.72 | 0; b = b * 0.72 | 0; }

    // Distance fog — visible up to ~12 tiles out
    var maxViewDist = 12;
    var fogFactor = Math.max(0.05, 1 - dist / maxViewDist);

    // Flashlight flicker only slightly dims
    if (currentFlashlightFlicker > 0) {
      var flickerAdjust = currentFlashlightFlicker * (Math.random() * 0.15);
      fogFactor *= (1 - flickerAdjust);
    }

    r = (r * fogFactor) | 0;
    g = (g * fogFactor) | 0;
    b = (b * fogFactor) | 0;

    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function renderDoorStrip(ctx, x, sw, drawStart, wallH, wallX, tile, side, dim) {
    var drawEnd = drawStart + wallH;
    var sideDim = side === 1 ? 0.72 : 1;
    var d = dim * sideDim;

    // Door base colors
    var doorR, doorG, doorB;
    var frameR, frameG, frameB;
    if (tile === 6) {
      // Exit door — dark green with gold frame
      doorR = 35; doorG = 80; doorB = 40;
      frameR = 140; frameG = 120; frameB = 50;
    } else if (tile === 9) {
      // Elevator — brushed metal
      doorR = 110; doorG = 115; doorB = 120;
      frameR = 80; frameG = 82; frameB = 85;
    } else {
      // Regular door — rich dark wood
      doorR = 100; doorG = 55; doorB = 25;
      frameR = 65; frameG = 40; frameB = 20;
    }

    // Frame border (left/right 8%, top 5%, bottom 3%)
    var isFrame = wallX < 0.08 || wallX > 0.92;
    var topBorder = drawStart + wallH * 0.05;
    var bottomBorder = drawEnd - wallH * 0.03;

    if (isFrame) {
      // Door frame
      var r = (frameR * d) | 0;
      var g = (frameG * d) | 0;
      var b = (frameB * d) | 0;
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(x, drawStart, sw, wallH);
      return;
    }

    // Top frame strip
    var tR = (frameR * d) | 0;
    var tG = (frameG * d) | 0;
    var tB = (frameB * d) | 0;
    ctx.fillStyle = 'rgb(' + tR + ',' + tG + ',' + tB + ')';
    ctx.fillRect(x, drawStart, sw, topBorder - drawStart);

    // Main door panel
    // Add subtle vertical grain variation for wood texture
    var grain = 1;
    if (tile !== 9) {
      grain = 0.92 + Math.sin(wallX * 80) * 0.04 + Math.sin(wallX * 200) * 0.02;
    }
    var pR = (doorR * d * grain) | 0;
    var pG = (doorG * d * grain) | 0;
    var pB = (doorB * d * grain) | 0;
    ctx.fillStyle = 'rgb(' + pR + ',' + pG + ',' + pB + ')';
    ctx.fillRect(x, topBorder, sw, bottomBorder - topBorder);

    // Upper panel inset (decorative rectangle, top 15%-40%)
    var panelIn = wallX > 0.18 && wallX < 0.82;
    if (panelIn && tile !== 9) {
      var panelTop = drawStart + wallH * 0.12;
      var panelBot = drawStart + wallH * 0.38;
      var inR = ((doorR - 15) * d * grain) | 0;
      var inG = ((doorG - 10) * d * grain) | 0;
      var inB = ((doorB - 5) * d * grain) | 0;
      if (inR < 0) inR = 0;
      if (inG < 0) inG = 0;
      if (inB < 0) inB = 0;
      ctx.fillStyle = 'rgb(' + inR + ',' + inG + ',' + inB + ')';
      ctx.fillRect(x, panelTop, sw, panelBot - panelTop);
    }

    // Lower panel inset (50%-85%)
    if (panelIn && tile !== 9) {
      var lpTop = drawStart + wallH * 0.48;
      var lpBot = drawStart + wallH * 0.85;
      var lR = ((doorR - 15) * d * grain) | 0;
      var lG = ((doorG - 10) * d * grain) | 0;
      var lB = ((doorB - 5) * d * grain) | 0;
      if (lR < 0) lR = 0;
      if (lG < 0) lG = 0;
      if (lB < 0) lB = 0;
      ctx.fillStyle = 'rgb(' + lR + ',' + lG + ',' + lB + ')';
      ctx.fillRect(x, lpTop, sw, lpBot - lpTop);
    }

    // Doorknob — golden/brass circle at ~55% height, 82-88% from left
    if (wallX > 0.80 && wallX < 0.90) {
      var knobCenterY = drawStart + wallH * 0.55;
      var knobRadius = wallH * 0.025;
      var knobDist = Math.abs(wallX - 0.85);
      var knobNorm = knobDist / 0.05; // 0 at center, 1 at edge
      if (knobNorm < 1) {
        // Vertical extent check
        var knobTopY = knobCenterY - knobRadius;
        var knobBotY = knobCenterY + knobRadius;
        // Gold/brass highlight
        var kBright = (1 - knobNorm * knobNorm) * 0.8 + 0.2;
        var kR, kG, kB;
        if (tile === 6) {
          kR = (200 * d * kBright) | 0; kG = (180 * d * kBright) | 0; kB = (60 * d * kBright) | 0;
        } else {
          kR = (210 * d * kBright) | 0; kG = (175 * d * kBright) | 0; kB = (50 * d * kBright) | 0;
        }
        ctx.fillStyle = 'rgb(' + kR + ',' + kG + ',' + kB + ')';
        ctx.fillRect(x, knobTopY, sw, knobBotY - knobTopY);
      }
    }

    // Elevator: center line (split door effect)
    if (tile === 9 && wallX > 0.48 && wallX < 0.52) {
      var cR = (40 * d) | 0;
      var cG = (42 * d) | 0;
      var cB = (45 * d) | 0;
      ctx.fillStyle = 'rgb(' + cR + ',' + cG + ',' + cB + ')';
      ctx.fillRect(x, topBorder, sw, bottomBorder - topBorder);
    }

    // Bottom frame strip
    ctx.fillStyle = 'rgb(' + tR + ',' + tG + ',' + tB + ')';
    ctx.fillRect(x, bottomBorder, sw, drawEnd - bottomBorder);
  }

  function renderFirstPerson() {
    var ctx = engine.ctx;
    var w = engine.width;
    var h = engine.height;
    var map = engine.currentMap;
    if (!map) return;

    var tiles = map.tiles;
    var mapW = map.width;
    var mapH = map.height;
    var ts = TILE_SIZE;

    // Apply shake to angle for camera wobble
    var renderAngle = playerAngle + shakeOffsetX * 0.01;

    // Draw ceiling (hotel ceiling — warm off-white receding into dark)
    var ceilGrad = ctx.createLinearGradient(0, 0, 0, h / 2);
    ceilGrad.addColorStop(0, '#181614');
    ceilGrad.addColorStop(0.7, '#262018');
    ceilGrad.addColorStop(1, '#302a20');
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, w, h / 2);

    // Draw floor (deep burgundy/red hotel carpet)
    var floorGrad = ctx.createLinearGradient(0, h / 2, 0, h);
    floorGrad.addColorStop(0, '#1c1210');
    floorGrad.addColorStop(0.3, '#2d1815');
    floorGrad.addColorStop(1, '#3a2018');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, h / 2, w, h / 2);

    // Z-buffer for sprite clipping
    var zBuffer = new Float32Array(w);

    // Cast rays
    var stripWidth = 2; // 2px wide strips for mobile performance
    var numRays = Math.ceil(w / stripWidth);

    for (var i = 0; i < numRays; i++) {
      var screenX = i * stripWidth;
      var rayAngle = renderAngle - FOV / 2 + (i / numRays) * FOV;

      var sinA = Math.sin(rayAngle);
      var cosA = Math.cos(rayAngle);

      // DDA raycasting
      var mapX = Math.floor(playerX / ts);
      var mapY = Math.floor(playerY / ts);

      var deltaDistX = Math.abs(1 / cosA) || 1e10;
      var deltaDistY = Math.abs(1 / sinA) || 1e10;

      var stepX, stepY, sideDistX, sideDistY;

      if (cosA < 0) {
        stepX = -1;
        sideDistX = (playerX / ts - mapX) * deltaDistX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1 - playerX / ts) * deltaDistX;
      }
      if (sinA < 0) {
        stepY = -1;
        sideDistY = (playerY / ts - mapY) * deltaDistY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1 - playerY / ts) * deltaDistY;
      }

      // Step through grid
      var hit = false;
      var side = 0; // 0=NS wall, 1=EW wall
      var hitTile = 1;
      var maxSteps = 30;

      for (var step = 0; step < maxSteps; step++) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }

        if (mapX < 0 || mapX >= mapW || mapY < 0 || mapY >= mapH) break;

        var tile = tiles[mapY][mapX];
        // Check if this tile blocks rays
        var solid = false;
        if (engine.isTileSolid) {
          solid = engine.isTileSolid(tile, mapX, mapY);
        } else {
          solid = (tile === 1 || tile === 7 || tile === 10);
        }
        if (solid) {
          hit = true;
          hitTile = tile;
          break;
        }
      }

      if (!hit) {
        for (var si = 0; si < stripWidth; si++) {
          if (screenX + si < w) zBuffer[screenX + si] = 999;
        }
        continue;
      }

      // Calculate perpendicular distance (avoid fisheye)
      var perpDist;
      if (side === 0) {
        perpDist = (mapX - playerX / ts + (1 - stepX) / 2) / cosA;
      } else {
        perpDist = (mapY - playerY / ts + (1 - stepY) / 2) / sinA;
      }
      perpDist = Math.abs(perpDist);

      // Fix fisheye
      var correctedDist = perpDist * Math.cos(rayAngle - renderAngle);

      // Store in z-buffer
      for (var si2 = 0; si2 < stripWidth; si2++) {
        if (screenX + si2 < w) zBuffer[screenX + si2] = correctedDist;
      }

      // Calculate wall height
      var wallHeight = h / correctedDist;
      var drawStart = Math.max(0, (h - wallHeight) / 2);
      var drawEnd = Math.min(h, (h + wallHeight) / 2);

      // Wall X coordinate (0-1, where ray hit on tile surface)
      var wallX;
      if (side === 0) {
        wallX = (playerY / ts) + perpDist * sinA;
      } else {
        wallX = (playerX / ts) + perpDist * cosA;
      }
      wallX = wallX - Math.floor(wallX); // fractional part 0-1

      var wallH = drawEnd - drawStart;
      var fogDim = Math.max(0.05, 1 - correctedDist / 12);
      var flickDim = 1;
      if (currentFlashlightFlicker > 0) {
        flickDim = 1 - currentFlashlightFlicker * (Math.random() * 0.15);
      }
      var totalDim = fogDim * flickDim;

      // --- Door rendering (tile 2, 6, 9) ---
      if (hitTile === 2 || hitTile === 6 || hitTile === 9) {
        renderDoorStrip(ctx, screenX, stripWidth, drawStart, wallH, wallX, hitTile, side, totalDim);
      } else {
        // Regular wall: upper wallpaper + dado rail + lower wainscoting
        var splitY = drawStart + wallH * 0.62;
        var colorUpper = getWallColor(hitTile, side, correctedDist, false);
        var colorLower = getWallColor(hitTile, side, correctedDist, true);

        ctx.fillStyle = colorUpper;
        ctx.fillRect(screenX, drawStart, stripWidth, splitY - drawStart);

        var railH = Math.max(1, wallH * 0.015);
        var railR = (50 * totalDim) | 0;
        var railG = (35 * totalDim) | 0;
        var railB = (22 * totalDim) | 0;
        ctx.fillStyle = 'rgb(' + railR + ',' + railG + ',' + railB + ')';
        ctx.fillRect(screenX, splitY, stripWidth, railH);

        ctx.fillStyle = colorLower;
        ctx.fillRect(screenX, splitY + railH, stripWidth, drawEnd - splitY - railH);
      }
    }

    // Store z-buffer for sprite rendering
    engine._zBuffer = zBuffer;
  }

  function renderSprite(entity) {
    if (!entity || entity.visible === false) return;

    var dx = entity.x - playerX;
    var dy = entity.y - playerY;

    // Transform to camera space
    var renderAngle = playerAngle + shakeOffsetX * 0.01;
    var cosA = Math.cos(-renderAngle);
    var sinA = Math.sin(-renderAngle);
    var transformX = dx * cosA - dy * sinA;
    var transformY = dx * sinA + dy * cosA;

    // transformY = depth (forward), transformX = lateral
    if (transformY <= 0.1) return; // Behind camera

    var w = engine.width;
    var h = engine.height;
    var ts = TILE_SIZE;

    var spriteScreenX = (w / 2) * (1 + transformX / transformY);
    var spriteHeight = Math.abs(h / (transformY / ts)) * 0.8;
    var spriteWidth = spriteHeight;

    var drawStartY = (h - spriteHeight) / 2;
    var drawStartX = spriteScreenX - spriteWidth / 2;

    // Check z-buffer for visibility
    var zBuf = engine._zBuffer;
    if (!zBuf) return;

    // Distance fog — match wall fog (12 tiles)
    var fogDist = transformY / ts;
    var maxViewDist = 12;
    var fogFactor = Math.max(0.05, 1 - fogDist / maxViewDist);
    if (currentFlashlightFlicker > 0) {
      fogFactor *= (1 - currentFlashlightFlicker * (Math.random() * 0.15));
    }
    if (fogFactor <= 0.05) return;

    // Use entity image or color rectangle
    var img = entity.sprite ? engine.images[entity.sprite] : null;

    var ctx = engine.ctx;
    ctx.save();
    ctx.globalAlpha = fogFactor;

    var depthInTiles = transformY / ts;

    if (img) {
      // Draw sprite column by column, checking z-buffer
      var startCol = Math.max(0, Math.floor(drawStartX));
      var endCol = Math.min(w, Math.ceil(drawStartX + spriteWidth));
      for (var col = startCol; col < endCol; col++) {
        if (col >= 0 && col < w && zBuf[col] > depthInTiles) {
          var srcX = ((col - drawStartX) / spriteWidth) * img.width;
          ctx.drawImage(img, srcX, 0, 1, img.height, col, drawStartY, 1, spriteHeight);
        }
      }
    } else {
      // Fallback: colored rectangle
      ctx.fillStyle = entity.color || '#880000';
      var startCol2 = Math.max(0, Math.floor(drawStartX));
      var endCol2 = Math.min(w, Math.ceil(drawStartX + spriteWidth));
      for (var col2 = startCol2; col2 < endCol2; col2++) {
        if (zBuf[col2] > depthInTiles) {
          ctx.fillRect(col2, drawStartY, 1, spriteHeight);
        }
      }
    }

    ctx.restore();
  }

  // ───────────────────────────────────────────────
  // The Engine
  // ───────────────────────────────────────────────
  var engine = {
    // Constants
    TILE_SIZE: TILE_SIZE,

    // Canvas
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,

    // Map
    currentMap: null,

    // Camera
    camera: { x: 0, y: 0 },

    // Input
    input: {
      dx: 0,       // left joystick horizontal (strafe)
      dy: 0,       // left joystick vertical (forward/back)
      lookDx: 0,   // right look area horizontal (turn camera)
      action: false,
      actionJustPressed: false,
      sprint: false
    },

    // Images
    images: {},

    // Game loop hooks
    onUpdate: null,
    onRender: null,

    // Callback: game sets this to tell raycaster which tiles block rays
    // signature: isTileSolid(tileType, gx, gy) → boolean
    isTileSolid: null,

    // Z-buffer (set by raycasting renderer)
    _zBuffer: null,

    // State
    running: false,
    paused: false,

    // ─────────────────────────────────────────────
    // First-person camera API
    // ─────────────────────────────────────────────
    setPlayerView: function (x, y, angle) {
      playerX = x;
      playerY = y;
      playerAngle = angle;
    },

    getPlayerAngle: function () {
      return playerAngle;
    },

    // ─────────────────────────────────────────────
    // 1. INIT
    // ─────────────────────────────────────────────
    init: function (canvasId) {
      var self = this;
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext('2d');

      // Disable image smoothing for crisp pixel look
      this.ctx.imageSmoothingEnabled = false;

      this._resize();
      window.addEventListener('resize', function () { self._resize(); });

      buildNoiseTexture();
      this._buildStaticCanvas();
      this._initInput();

      // Preload images
      this.loadImage('assets/img/haruki.png');
      this.loadImage('assets/img/haruki_scary.png');

      this.running = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(function (t) { gameLoop(t); });
    },

    _resize: function () {
      var dpr = window.devicePixelRatio || 1;
      var w = window.innerWidth;
      var h = window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = w;
      this.height = h;
      this.ctx.imageSmoothingEnabled = false;
    },

    _buildStaticCanvas: function () {
      staticCanvas = document.createElement('canvas');
      staticCanvas.width = 128;
      staticCanvas.height = 128;
      staticCtx = staticCanvas.getContext('2d');
    },

    // ─────────────────────────────────────────────
    // 2. MAP SYSTEM
    // ─────────────────────────────────────────────
    loadMap: function (mapData) {
      this.currentMap = mapData;
    },

    getTile: function (gx, gy) {
      var m = this.currentMap;
      if (!m) return 1;
      if (gx < 0 || gy < 0 || gx >= m.width || gy >= m.height) return 1;
      return m.tiles[gy][gx];
    },

    isWalkable: function (wx, wy) {
      var g = this.worldToGrid(wx, wy);
      var t = this.getTile(g.x, g.y);
      // Walkable tiles: floor(0), door(2), front desk(3), room404(4), utility(5), exit(6), carpet(8)
      return t === 0 || t === 2 || t === 3 || t === 4 || t === 5 || t === 6 || t === 8;
    },

    worldToGrid: function (wx, wy) {
      return {
        x: Math.floor(wx / TILE_SIZE),
        y: Math.floor(wy / TILE_SIZE)
      };
    },

    gridToWorld: function (gx, gy) {
      return {
        x: gx * TILE_SIZE + TILE_SIZE / 2,
        y: gy * TILE_SIZE + TILE_SIZE / 2
      };
    },

    // ─────────────────────────────────────────────
    // 3. RENDERING
    // ─────────────────────────────────────────────
    drawMap: function () {
      if (!this.currentMap) return;
      renderFirstPerson();
    },

    _drawTile: function (ctx, type, sx, sy, gx, gy) {
      var ts = TILE_SIZE;
      switch (type) {
        case 0: // Floor
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(sx, sy, ts, ts);
          // Subtle noise texture
          ctx.drawImage(noiseCanvas,
            (gx * 17) % noiseSize, (gy * 13) % noiseSize, ts, ts,
            sx, sy, ts, ts);
          break;

        case 1: // Wall
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(sx, sy, ts, ts);
          // Border highlight
          ctx.strokeStyle = '#252525';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, ts - 1, ts - 1);
          break;

        case 2: // Door
          ctx.fillStyle = '#4a3000';
          ctx.fillRect(sx, sy, ts, ts);
          // Door frame
          ctx.strokeStyle = '#5a4010';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 2, sy + 2, ts - 4, ts - 4);
          // Handle
          ctx.fillStyle = '#7a6020';
          ctx.beginPath();
          ctx.arc(sx + ts - 10, sy + ts / 2, 3, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 3: // Front desk
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(sx, sy, ts, ts);
          // Counter detail
          ctx.fillStyle = '#3a3a2a';
          ctx.fillRect(sx + 4, sy + 4, ts - 8, ts - 8);
          ctx.strokeStyle = '#4a4a3a';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 4, sy + 4, ts - 8, ts - 8);
          break;

        case 4: // Room 404 floor
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(sx, sy, ts, ts);
          ctx.drawImage(noiseCanvas,
            (gx * 17) % noiseSize, (gy * 13) % noiseSize, ts, ts,
            sx, sy, ts, ts);
          break;

        case 5: // Utility room
          ctx.fillStyle = '#252520';
          ctx.fillRect(sx, sy, ts, ts);
          // Concrete texture
          ctx.drawImage(noiseCanvas,
            (gx * 23) % noiseSize, (gy * 19) % noiseSize, ts, ts,
            sx, sy, ts, ts);
          break;

        case 6: // Exit door
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(sx, sy, ts, ts);
          // Green trim
          ctx.strokeStyle = '#0a4a0a';
          ctx.lineWidth = 3;
          ctx.strokeRect(sx + 3, sy + 3, ts - 6, ts - 6);
          // Arrow indicator
          ctx.fillStyle = '#0a5a0a';
          ctx.beginPath();
          ctx.moveTo(sx + ts / 2, sy + 8);
          ctx.lineTo(sx + ts / 2 + 8, sy + ts / 2);
          ctx.lineTo(sx + ts / 2 - 8, sy + ts / 2);
          ctx.closePath();
          ctx.fill();
          break;

        case 7: // Furniture/obstacle
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(sx, sy, ts, ts);
          ctx.fillStyle = '#222222';
          ctx.fillRect(sx + 6, sy + 6, ts - 12, ts - 12);
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 6, sy + 6, ts - 12, ts - 12);
          break;

        case 8: // Carpet
          ctx.fillStyle = '#2d2428';
          ctx.fillRect(sx, sy, ts, ts);
          // Faint pattern
          ctx.fillStyle = 'rgba(60,40,50,0.15)';
          if ((gx + gy) % 2 === 0) {
            ctx.fillRect(sx, sy, ts, ts);
          }
          break;

        case 9: // Elevator door
          ctx.fillStyle = '#333333';
          ctx.fillRect(sx, sy, ts, ts);
          // Center seam
          ctx.strokeStyle = '#2a2a2a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + ts / 2, sy + 4);
          ctx.lineTo(sx + ts / 2, sy + ts - 4);
          ctx.stroke();
          // Metallic sheen
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(sx + 2, sy + 2, ts / 2 - 4, ts - 4);
          break;

        case 10: // Window
          ctx.fillStyle = '#1a1a2a';
          ctx.fillRect(sx, sy, ts, ts);
          // Faint blue tint
          ctx.fillStyle = 'rgba(30,30,80,0.3)';
          ctx.fillRect(sx + 4, sy + 4, ts - 8, ts - 8);
          // Frame
          ctx.strokeStyle = '#252525';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 3, sy + 3, ts - 6, ts - 6);
          break;

        default:
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(sx, sy, ts, ts);
      }
    },

    drawEntity: function (entity) {
      if (!entity || entity.visible === false) return;
      renderSprite(entity);
    },

    // ─────────────────────────────────────────────
    // DARKNESS / FLASHLIGHT SYSTEM
    // ─────────────────────────────────────────────
    drawDarkness: function (px, py, radius, flickerAmount) {
      currentFlashlightRadius = radius || 200;
      currentFlashlightFlicker = flickerAmount || 0;
      // Fog is applied during raycasting, so no separate overlay needed
      // But still apply a subtle vignette for atmosphere
      var ctx = this.ctx;
      var w = this.width;
      var h = this.height;
      var grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    },

    // ─────────────────────────────────────────────
    // SCREEN EFFECTS
    // ─────────────────────────────────────────────
    fadeScreen: function (alpha) {
      if (alpha <= 0) return;
      this.ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, alpha) + ')';
      this.ctx.fillRect(0, 0, this.width, this.height);
    },

    fadeToBlack: function (duration, cb) {
      fading = true;
      fadeAlpha = 0;
      fadeTarget = 1;
      fadeDuration = duration > 10 ? duration / 1000 : (duration || 1);
      fadeTimer = 0;
      fadeCb = cb || null;
    },

    fadeFromBlack: function (duration, cb) {
      fading = true;
      fadeAlpha = 1;
      fadeTarget = 0;
      fadeDuration = duration > 10 ? duration / 1000 : (duration || 1);
      fadeTimer = 0;
      fadeCb = cb || null;
    },

    shakeScreen: function (intensity, duration) {
      shakeIntensity = intensity || 5;
      shakeDuration = duration > 10 ? duration / 1000 : (duration || 0.3);
      shakeTimer = 0;
    },

    flashImage: function (imgElement, duration, cb) {
      flashImg = imgElement;
      // Accept ms or seconds: if > 10 assume ms
      flashDuration = duration > 10 ? duration / 1000 : (duration || 0.5);
      flashTimer = 0;
      flashCb = cb || null;
    },

    staticEffect: function (intensity) {
      staticIntensity = intensity || 0;
    },

    redFlash: function () {
      redFlashAlpha = 0.6;
    },

    // ─────────────────────────────────────────────
    // 4. INPUT SYSTEM
    // ─────────────────────────────────────────────
    _initInput: function () {
      var self = this;
      var canvas = this.canvas;

      // Prevent default touch behaviors on the whole document
      // But allow interaction on settings overlay (sliders, buttons)
      document.addEventListener('touchmove', function (e) {
        var settingsOverlay = document.getElementById('settingsOverlay');
        if (settingsOverlay && settingsOverlay.style.display !== 'none') return;
        var minimapOverlay = document.getElementById('minimapOverlay');
        if (minimapOverlay && minimapOverlay.style.display !== 'none') return;
        e.preventDefault();
      }, { passive: false });

      document.addEventListener('touchstart', function (e) {
        // Initialize audio on first touch (iOS requirement)
        if (!audioInitialized) {
          self.initAudio();
        }
      }, { passive: true });

      // --- Dynamic joystick system via touch zones ---
      var stickSize = 120; // matches CSS .virtual-stick width/height
      var maxDrag = 50;

      var leftStick = document.getElementById('joystickArea');
      var leftThumb = document.getElementById('joystickThumb');
      var rightStick = document.getElementById('lookArea');
      var rightThumb = document.getElementById('lookThumb');
      var leftZone = document.getElementById('touchZoneLeft');
      var rightZone = document.getElementById('touchZoneRight');

      function showStick(stickEl, thumbEl, cx, cy) {
        stickEl.style.left = (cx - stickSize / 2) + 'px';
        stickEl.style.top = (cy - stickSize / 2) + 'px';
        stickEl.classList.add('active');
        thumbEl.style.transform = 'translate(0px, 0px)';
      }

      function hideStick(stickEl, thumbEl) {
        stickEl.classList.remove('active');
        thumbEl.style.transform = 'translate(0px, 0px)';
      }

      function calcStick(touch, centerX, centerY) {
        var rawDx = touch.clientX - centerX;
        var rawDy = touch.clientY - centerY;
        var dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
        if (dist < 8) return { dx: 0, dy: 0, thumbX: 0, thumbY: 0 };
        var norm = Math.min(dist, maxDrag) / maxDrag;
        var thumbX = (rawDx / dist) * Math.min(dist, maxDrag);
        var thumbY = (rawDy / dist) * Math.min(dist, maxDrag);
        return { dx: (rawDx / dist) * norm, dy: (rawDy / dist) * norm, thumbX: thumbX, thumbY: thumbY };
      }

      // --- Left zone (movement joystick) ---
      if (leftZone) {
        leftZone.addEventListener('touchstart', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            if (joystickTouchId === null) {
              joystickTouchId = touch.identifier;
              joystickCenterX = touch.clientX;
              joystickCenterY = touch.clientY;
              joystickActive = true;
              showStick(leftStick, leftThumb, touch.clientX, touch.clientY);
              // Double tap = sprint
              var now = performance.now();
              if (now - lastTapTime < 300) self.input.sprint = true;
              lastTapTime = now;
            }
          }
          if (joystickActive && lookActive) self.input.sprint = true;
        }, { passive: false });

        leftZone.addEventListener('touchmove', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            if (touch.identifier === joystickTouchId) {
              var s = calcStick(touch, joystickCenterX, joystickCenterY);
              self.input.dx = s.dx;
              self.input.dy = s.dy;
              leftThumb.style.transform = 'translate(' + s.thumbX + 'px, ' + s.thumbY + 'px)';
            }
          }
        }, { passive: false });

        leftZone.addEventListener('touchend', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
              joystickTouchId = null;
              joystickActive = false;
              self.input.dx = 0;
              self.input.dy = 0;
              self.input.sprint = false;
              hideStick(leftStick, leftThumb);
            }
          }
        }, { passive: false });

        leftZone.addEventListener('touchcancel', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
              joystickTouchId = null;
              joystickActive = false;
              self.input.dx = 0;
              self.input.dy = 0;
              self.input.sprint = false;
              hideStick(leftStick, leftThumb);
            }
          }
        }, { passive: false });
      }

      // --- Right zone (camera joystick) ---
      if (rightZone) {
        var lookCenterX = 0, lookCenterY = 0;

        rightZone.addEventListener('touchstart', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            if (lookTouchId === null) {
              lookTouchId = touch.identifier;
              lookCenterX = touch.clientX;
              lookCenterY = touch.clientY;
              lookLastX = touch.clientX;
              lookActive = true;
              showStick(rightStick, rightThumb, touch.clientX, touch.clientY);
            }
          }
          if (joystickActive && lookActive) self.input.sprint = true;
        }, { passive: false });

        rightZone.addEventListener('touchmove', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            if (touch.identifier === lookTouchId) {
              var s = calcStick(touch, lookCenterX, lookCenterY);
              // Use horizontal as look direction
              self.input.lookDx = s.dx;
              rightThumb.style.transform = 'translate(' + s.thumbX + 'px, ' + s.thumbY + 'px)';
            }
          }
        }, { passive: false });

        rightZone.addEventListener('touchend', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === lookTouchId) {
              lookTouchId = null;
              lookActive = false;
              self.input.lookDx = 0;
              self.input.sprint = false;
              hideStick(rightStick, rightThumb);
            }
          }
        }, { passive: false });

        rightZone.addEventListener('touchcancel', function (e) {
          e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === lookTouchId) {
              lookTouchId = null;
              lookActive = false;
              self.input.lookDx = 0;
              hideStick(rightStick, rightThumb);
            }
          }
        }, { passive: false });
      }

      // --- Action button ---
      var actionBtn = document.getElementById('actionBtn');
      if (actionBtn) {
        actionBtn.addEventListener('touchstart', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!self.input.action) {
            self.input.actionJustPressed = true;
          }
          self.input.action = true;
          actionTouchId = e.changedTouches[0].identifier;
        }, { passive: false });

        actionBtn.addEventListener('touchend', function (e) {
          e.preventDefault();
          e.stopPropagation();
          self.input.action = false;
          actionTouchId = null;
        }, { passive: false });

        actionBtn.addEventListener('touchcancel', function (e) {
          e.preventDefault();
          self.input.action = false;
          actionTouchId = null;
        }, { passive: false });
      }

      // --- Keyboard fallback for development ---
      var keys = {};
      window.addEventListener('keydown', function (e) {
        keys[e.key] = true;
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'e' || e.key === 'E') {
          if (!self.input.action) {
            self.input.actionJustPressed = true;
          }
          self.input.action = true;
        }
        if (e.key === 'Shift') {
          self.input.sprint = true;
        }
        self._updateKeyboardInput(keys);
      });
      window.addEventListener('keyup', function (e) {
        keys[e.key] = false;
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'e' || e.key === 'E') {
          self.input.action = false;
        }
        if (e.key === 'Shift') {
          self.input.sprint = false;
        }
        self._updateKeyboardInput(keys);
      });
    },

    _updateKeyboardInput: function (keys) {
      // WASD = movement (left joystick equivalent)
      var dx = 0, dy = 0;
      if (keys['a'] || keys['A']) dx -= 1;
      if (keys['d'] || keys['D']) dx += 1;
      if (keys['w'] || keys['W']) dy -= 1;
      if (keys['s'] || keys['S']) dy += 1;
      // Normalize diagonal
      if (dx !== 0 && dy !== 0) {
        var inv = 1 / Math.sqrt(2);
        dx *= inv;
        dy *= inv;
      }
      // Only override if no joystick active
      if (!joystickActive) {
        this.input.dx = dx;
        this.input.dy = dy;
      }
      // Arrow keys = camera look (right look area equivalent)
      if (!lookActive) {
        var look = 0;
        if (keys['ArrowLeft']) look -= 1;
        if (keys['ArrowRight']) look += 1;
        this.input.lookDx = look;
      }
    },

    // ─────────────────────────────────────────────
    // 5. AUDIO SYSTEM (Procedural via Web Audio API)
    // ─────────────────────────────────────────────
    initAudio: function () {
      if (audioInitialized) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = masterVolume;
        masterGain.connect(audioCtx.destination);
        bgmGain = audioCtx.createGain();
        bgmGain.gain.value = bgmVolume;
        bgmGain.connect(masterGain);
        seGain = audioCtx.createGain();
        seGain.gain.value = seVolume;
        seGain.connect(masterGain);
        audioInitialized = true;

        // Resume context if suspended (iOS)
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      } catch (e) {
        console.warn('Web Audio API not supported:', e);
      }
    },

    playSound: function (type) {
      if (!audioCtx || audioCtx.state === 'suspended') {
        if (audioCtx) audioCtx.resume();
        return;
      }

      var now = audioCtx.currentTime;

      switch (type) {
        case 'footstep':
          this._playFootstep(now);
          break;
        case 'door':
          this._playDoor(now);
          break;
        case 'phone':
          this._playPhone(now);
          break;
        case 'heartbeat':
          this._playHeartbeat(now);
          break;
        case 'jumpscare':
          this._playJumpscare(now);
          break;
        case 'knock':
          this._playKnock(now);
          break;
        case 'breath':
          this._playBreath(now);
          break;
        case 'static':
          this._playStatic(now);
          break;
        case 'hit':
          this._playHit(now);
          break;
      }
    },

    startLoop: function (type) {
      if (!audioCtx) return;
      if (activeLoops[type]) return;

      if (audioCtx.state === 'suspended') audioCtx.resume();

      switch (type) {
        case 'ambient':
          activeLoops[type] = this._startAmbientLoop();
          break;
        case 'heartbeat':
          activeLoops[type] = this._startHeartbeatLoop();
          break;
        case 'phone':
          activeLoops[type] = this._startPhoneLoop();
          break;
        case 'breath':
          activeLoops[type] = this._startBreathLoop();
          break;
        case 'static':
          activeLoops[type] = this._startStaticLoop();
          break;
      }
    },

    stopLoop: function (type) {
      if (activeLoops[type]) {
        var loop = activeLoops[type];
        if (loop.stop) loop.stop();
        if (loop.nodes) {
          loop.nodes.forEach(function (n) {
            try { n.stop(); } catch (e) { /* ignore */ }
            try { n.disconnect(); } catch (e) { /* ignore */ }
          });
        }
        if (loop.gain) {
          try { loop.gain.disconnect(); } catch (e) { /* ignore */ }
        }
        if (loop.interval) clearInterval(loop.interval);
        delete activeLoops[type];
      }
    },

    stopAll: function () {
      var self = this;
      Object.keys(activeLoops).forEach(function (type) {
        self.stopLoop(type);
      });
    },

    setMasterVolume: function (vol) {
      masterVolume = Math.max(0, Math.min(1, vol));
      if (masterGain) {
        masterGain.gain.setValueAtTime(masterVolume, masterGain.context.currentTime);
      }
    },

    getMasterVolume: function () {
      return masterVolume;
    },

    setBgmVolume: function (vol) {
      bgmVolume = Math.max(0, Math.min(1, vol));
      if (bgmGain) {
        bgmGain.gain.setValueAtTime(bgmVolume, bgmGain.context.currentTime);
      }
    },

    getBgmVolume: function () {
      return bgmVolume;
    },

    setSeVolume: function (vol) {
      seVolume = Math.max(0, Math.min(1, vol));
      if (seGain) {
        seGain.gain.setValueAtTime(seVolume, seGain.context.currentTime);
      }
    },

    getSeVolume: function () {
      return seVolume;
    },

    // Set enemy proximity (0=far, 1=very close)
    // Controls heartbeat speed and BGM volume boost
    setProximity: function (value) {
      value = Math.max(0, Math.min(1, value));
      // Heartbeat rate: 800ms (far) → 300ms (close)
      heartbeatRate = Math.round(800 - value * 500);
      // BGM volume boost
      proximityBoost = value * 0.5;
      if (bgmGain && audioCtx) {
        var boosted = Math.min(1, bgmVolume + proximityBoost);
        bgmGain.gain.setTargetAtTime(boosted, audioCtx.currentTime, 0.1);
      }
    },

    // --- Sound implementations ---

    _playFootstep: function (now) {
      var dest = seGain || masterGain;
      var bufferSize = audioCtx.sampleRate * 0.05;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        var t = i / audioCtx.sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.3;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buffer;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.15;
      src.connect(gain);
      gain.connect(dest);
      src.start(now);
    },

    _playDoor: function (now) {
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.3);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.4);
    },

    _playPhone: function (now) {
      var dest = seGain || masterGain;
      var osc1 = audioCtx.createOscillator();
      var osc2 = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      osc1.type = 'sine';
      osc2.type = 'sine';
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.setValueAtTime(0, now + 0.5);
      gain.gain.setValueAtTime(0.15, now + 0.6);
      gain.gain.setValueAtTime(0, now + 1.0);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(dest);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.1);
      osc2.stop(now + 1.1);
    },

    _playHeartbeat: function (now) {
      var dest = bgmGain || masterGain;
      for (var i = 0; i < 2; i++) {
        var offset = i * 0.15;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50 - i * 10, now + offset);
        gain.gain.setValueAtTime(0.4, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.15);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      }
    },

    _playJumpscare: function (now) {
      var dest = seGain || masterGain;
      var bufferSize = audioCtx.sampleRate * 0.5;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
      }
      var noiseSrc = audioCtx.createBufferSource();
      noiseSrc.buffer = buffer;
      var noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.8, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      noiseSrc.connect(noiseGain);
      noiseGain.connect(dest);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.6);

      var freqs = [200, 212, 224, 237, 450, 477];
      for (var f = 0; f < freqs.length; f++) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[f];
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(g);
        g.connect(dest);
        osc.start(now);
        osc.stop(now + 0.55);
      }
    },

    _playKnock: function (now) {
      var dest = seGain || masterGain;
      for (var i = 0; i < 3; i++) {
        var offset = i * 0.12;
        var bufLen = audioCtx.sampleRate * 0.04;
        var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        var d = buf.getChannelData(0);
        for (var j = 0; j < bufLen; j++) {
          var t = j / audioCtx.sampleRate;
          d[j] = (Math.random() * 2 - 1) * Math.exp(-t * 120) * 0.6;
        }
        var src = audioCtx.createBufferSource();
        src.buffer = buf;
        var gain = audioCtx.createGain();
        gain.gain.value = 0.35;
        src.connect(gain);
        gain.connect(dest);
        src.start(now + offset);
      }
    },

    _playBreath: function (now) {
      var dest = bgmGain || masterGain;
      var bufferSize = audioCtx.sampleRate * 2;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        var t = i / audioCtx.sampleRate;
        var envelope = Math.sin(t * Math.PI);
        data[i] = (Math.random() * 2 - 1) * envelope * 0.2;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buffer;
      var filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = 2;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.25;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(now);
    },

    _playStatic: function (now) {
      var dest = bgmGain || masterGain;
      var bufferSize = audioCtx.sampleRate * 0.3;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buffer;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.3;
      src.connect(gain);
      gain.connect(dest);
      src.start(now);
    },

    _playHit: function (now) {
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.25);

      var bufLen = audioCtx.sampleRate * 0.08;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.4;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var g2 = audioCtx.createGain();
      g2.gain.value = 0.3;
      src.connect(g2);
      g2.connect(dest);
      src.start(now);
    },

    _playTextBlip: function (now) {
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 600 + Math.random() * 100;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.05);
    },

    // --- Loop sound implementations ---

    _startAmbientLoop: function () {
      var osc = audioCtx.createOscillator();
      var lfo = audioCtx.createOscillator();
      var lfoGain = audioCtx.createGain();
      var gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.value = 40;

      lfo.type = 'sine';
      lfo.frequency.value = 0.2;
      lfoGain.gain.value = 8;

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(bgmGain || masterGain);

      osc.start();
      lfo.start();

      return { nodes: [osc, lfo], gain: gain };
    },

    _startHeartbeatLoop: function () {
      var self = this;
      var running = true;
      function beat() {
        if (!running) return;
        if (audioCtx && audioCtx.state === 'running') {
          self._playHeartbeat(audioCtx.currentTime);
        }
        setTimeout(beat, heartbeatRate);
      }
      beat();
      return { stop: function () { running = false; } };
    },

    _startPhoneLoop: function () {
      var self = this;
      var intervalId = setInterval(function () {
        if (audioCtx && audioCtx.state === 'running') {
          self._playPhone(audioCtx.currentTime);
        }
      }, 3000); // ring 1s, silence 2s
      // Play immediately too
      if (audioCtx && audioCtx.state === 'running') {
        self._playPhone(audioCtx.currentTime);
      }
      return { interval: intervalId };
    },

    _startBreathLoop: function () {
      var self = this;
      var intervalId = setInterval(function () {
        if (audioCtx && audioCtx.state === 'running') {
          self._playBreath(audioCtx.currentTime);
        }
      }, 2500);
      if (audioCtx && audioCtx.state === 'running') {
        self._playBreath(audioCtx.currentTime);
      }
      return { interval: intervalId };
    },

    _startStaticLoop: function () {
      // Continuous white noise via a looping buffer
      var bufferSize = audioCtx.sampleRate * 2;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.4;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.2;
      src.connect(gain);
      gain.connect(bgmGain || masterGain);
      src.start();
      return { nodes: [src], gain: gain };
    },

    // ─────────────────────────────────────────────
    // 6. IMAGE LOADING
    // ─────────────────────────────────────────────
    loadImage: function (src) {
      var self = this;
      if (this.images[src]) {
        return Promise.resolve(this.images[src]);
      }
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          self.images[src] = img;
          resolve(img);
        };
        img.onerror = function () {
          console.warn('Failed to load image:', src);
          reject(new Error('Failed to load image: ' + src));
        };
        img.src = src;
      });
    },

    // ─────────────────────────────────────────────
    // 7. UI HELPERS
    // ─────────────────────────────────────────────
    showDialogue: function (speaker, text, cb) {
      dialogueActive = true;
      dialogueSpeaker = speaker || '';
      dialogueFullText = text || '';
      dialogueDisplayed = '';
      dialogueCharIndex = 0;
      dialogueCharTimer = 0;
      dialogueComplete = false;
      dialogueCb = cb || null;

      // Touch/click to advance
      var self = this;
      var handler = function (e) {
        e.preventDefault();
        if (!dialogueActive) {
          document.removeEventListener('touchstart', handler);
          document.removeEventListener('click', handler);
          return;
        }
        if (!dialogueComplete) {
          // Complete the text instantly
          dialogueDisplayed = dialogueFullText;
          dialogueCharIndex = dialogueFullText.length;
          dialogueComplete = true;
        } else {
          // Close dialogue
          dialogueActive = false;
          document.removeEventListener('touchstart', handler);
          document.removeEventListener('click', handler);
          if (dialogueCb) {
            var fn = dialogueCb;
            dialogueCb = null;
            fn();
          }
        }
      };
      // Small delay to avoid immediately triggering from the tap that opened it
      setTimeout(function () {
        document.addEventListener('touchstart', handler, { passive: false });
        document.addEventListener('click', handler);
      }, 100);
    },

    hideDialogue: function () {
      dialogueActive = false;
      dialogueCb = null;
    },

    showActionButton: function (text) {
      var btn = document.getElementById('actionBtn');
      if (btn) {
        btn.textContent = text || 'Action';
        btn.style.display = 'block';
      }
    },

    hideActionButton: function () {
      var btn = document.getElementById('actionBtn');
      if (btn) {
        btn.style.display = 'none';
      }
    },

    updateStamina: function (ratio) {
      var bar = document.getElementById('staminaBar');
      if (bar) {
        var pct = Math.max(0, Math.min(1, ratio)) * 100;
        bar.style.width = pct + '%';
        // Color shifts as stamina depletes
        if (ratio > 0.5) {
          bar.style.backgroundColor = '#4a4';
        } else if (ratio > 0.25) {
          bar.style.backgroundColor = '#aa4';
        } else {
          bar.style.backgroundColor = '#a44';
        }
      }
    },

    _drawDialogue: function (ctx) {
      if (!dialogueActive) return;

      var w = this.width;
      var h = this.height;
      var boxH = 120;
      var boxY = h - boxH - 10;
      var boxX = 10;
      var boxW = w - 20;

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(boxX, boxY, boxW, boxH);

      // Border
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Speaker name
      if (dialogueSpeaker) {
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = dialogueSpeaker === '\u30cf\u30eb\u30ad' ? '#c33' : '#ccc';
        ctx.fillText(dialogueSpeaker, boxX + 12, boxY + 24);
      }

      // Text
      ctx.font = '14px monospace';
      ctx.fillStyle = '#ddd';
      var textY = boxY + 48;
      var maxWidth = boxW - 24;

      // Word wrap the displayed text
      var lines = this._wrapText(ctx, dialogueDisplayed, maxWidth);
      for (var i = 0; i < lines.length && i < 3; i++) {
        ctx.fillText(lines[i], boxX + 12, textY + i * 20);
      }

      // Blinking cursor / advance indicator
      if (dialogueComplete) {
        var blink = (Date.now() % 1000) < 500;
        if (blink) {
          ctx.fillStyle = '#888';
          ctx.fillText('\u25BC', boxX + boxW - 30, boxY + boxH - 12);
        }
      }
    },

    _wrapText: function (ctx, text, maxWidth) {
      var words = text.split('');
      var lines = [];
      var currentLine = '';

      for (var i = 0; i < words.length; i++) {
        var testLine = currentLine + words[i];
        var metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = words[i];
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    },

    // ─────────────────────────────────────────────
    // INTERNAL: Update effects each frame
    // ─────────────────────────────────────────────
    _updateEffects: function (dt) {
      // Screen shake
      if (shakeTimer < shakeDuration) {
        shakeTimer += dt;
        var remaining = 1 - (shakeTimer / shakeDuration);
        shakeOffsetX = (Math.random() * 2 - 1) * shakeIntensity * remaining;
        shakeOffsetY = (Math.random() * 2 - 1) * shakeIntensity * remaining;
      } else {
        shakeOffsetX = 0;
        shakeOffsetY = 0;
      }

      // Fade
      if (fading) {
        fadeTimer += dt;
        var progress = Math.min(fadeTimer / fadeDuration, 1);
        fadeAlpha = fadeAlpha + (fadeTarget - fadeAlpha) * progress;

        if (fadeTimer >= fadeDuration) {
          fadeAlpha = fadeTarget;
          fading = false;
          if (fadeCb) {
            var fn = fadeCb;
            fadeCb = null;
            fn();
          }
        }
      }

      // Flash image
      if (flashImg) {
        flashTimer += dt;
        if (flashTimer >= flashDuration) {
          flashImg = null;
          if (flashCb) {
            var fn2 = flashCb;
            flashCb = null;
            fn2();
          }
        }
      }

      // Red flash decay
      if (redFlashAlpha > 0) {
        redFlashAlpha -= dt * 3;
        if (redFlashAlpha < 0) redFlashAlpha = 0;
      }

      // Dialogue typewriter
      if (dialogueActive && !dialogueComplete) {
        dialogueCharTimer += dt;
        while (dialogueCharTimer >= DIALOGUE_CHAR_DELAY && dialogueCharIndex < dialogueFullText.length) {
          dialogueCharTimer -= DIALOGUE_CHAR_DELAY;
          dialogueCharIndex++;
          dialogueDisplayed = dialogueFullText.substring(0, dialogueCharIndex);
          // Text blip sound every 2 characters
          if (dialogueCharIndex % 2 === 0 && audioCtx && audioCtx.state === 'running') {
            engine._playTextBlip(audioCtx.currentTime);
          }
        }
        if (dialogueCharIndex >= dialogueFullText.length) {
          dialogueComplete = true;
        }
      }
    },

    _renderEffects: function (ctx) {
      // Fade overlay
      if (fadeAlpha > 0.001) {
        this.fadeScreen(fadeAlpha);
      }

      // Flash image
      if (flashImg) {
        ctx.drawImage(flashImg, 0, 0, this.width, this.height);
      }

      // Static effect
      if (staticIntensity > 0) {
        this._drawStatic(ctx, staticIntensity);
      }

      // Red flash
      if (redFlashAlpha > 0) {
        ctx.fillStyle = 'rgba(180,0,0,' + redFlashAlpha + ')';
        ctx.fillRect(0, 0, this.width, this.height);
      }

      // Dialogue
      this._drawDialogue(ctx);
    },

    _drawStatic: function (ctx, intensity) {
      // Generate small noise and scale up for performance
      var sw = staticCanvas.width;
      var sh = staticCanvas.height;
      var id = staticCtx.createImageData(sw, sh);
      var d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = (intensity * 80) | 0;
      }
      staticCtx.putImageData(id, 0, 0);
      ctx.drawImage(staticCanvas, 0, 0, this.width, this.height);
    },

    _getAudioCtx: function () { return audioCtx; },
    _getSeGain: function () { return seGain; }
  };

  // ───────────────────────────────────────────────
  // Game Loop (module-level function)
  // ───────────────────────────────────────────────
  function gameLoop(timestamp) {
    if (!engine.running) return;

    var dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    if (!engine.paused) {
      // Update effects
      engine._updateEffects(dt);

      // Game update callback
      if (engine.onUpdate) {
        engine.onUpdate(dt);
      }

      // --- Render pipeline ---
      var ctx = engine.ctx;

      // Clear
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, engine.width, engine.height);

      // Tiles (drawn by game.js which controls the render order)

      // Custom render callback (entities, darkness, etc. are drawn by game.js)
      if (engine.onRender) {
        engine.onRender(ctx);
      }

      // Post-processing effects and UI
      engine._renderEffects(ctx);
    }

    // Reset per-frame input flags
    engine.input.actionJustPressed = false;

    rafId = requestAnimationFrame(gameLoop);
  }

  // Expose globally
  window.GameEngine = engine;

})();
