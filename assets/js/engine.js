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
  // Seeded random for deterministic wall textures
  // ───────────────────────────────────────────────
  function seededRandom(a, b, c) {
    var x = Math.sin(a * 12.9898 + b * 78.233 + c * 45.164) * 43758.5453;
    return x - Math.floor(x);
  }

  // ───────────────────────────────────────────────
  // Particle system state
  // ───────────────────────────────────────────────
  var particles = [];
  var MAX_PARTICLES = 50;

  // ───────────────────────────────────────────────
  // BGM layer state
  // ───────────────────────────────────────────────
  var bgmLayerNodes = null;
  var bgmLayerGains = { drone: 0.06, dissonance: 0, melody: 0, pulse: 0 };
  var bgmMelodyIndex = 0;
  var bgmMelodyTimer = 0;
  var bgmPulsePhase = 0;

  // ───────────────────────────────────────────────
  // Enemy footstep state
  // ───────────────────────────────────────────────
  var enemyFootstepInterval = null;
  var enemyFootstepWX = 0;
  var enemyFootstepWY = 0;
  var footstepSurface = 'carpet';

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

  function getWallColor(tile, side, dist, isLower, wallX, mapX, mapY) {
    var r, g, b;
    var theme = engine.theme;
    // ── Theme override (Backrooms) ───────────────────────────
    if (theme && theme.wall) {
      var palette = theme.wall;
      var base;
      if (isLower && palette.lower && !palette.flat) {
        base = palette.lower[tile] || palette.lower['default'] || [85, 55, 35];
      } else {
        base = palette.upper[tile] || palette.upper['default'] || [155, 135, 105];
      }
      r = base[0]; g = base[1]; b = base[2];

      // Pattern overlay per palette.pattern
      if (palette.pattern && wallX !== undefined) {
        var pat = palette.pattern;
        if (pat === 'stripe') {
          var sp = (wallX * 10) | 0;
          if (sp % 2 === 0) { r = (r * 0.95) | 0; g = (g * 0.95) | 0; b = (b * 0.95) | 0; }
        } else if (pat === 'tile') {
          // Hard tile lines every 0.25
          var tilePos = (wallX * 4) % 1;
          if (tilePos < 0.04 || tilePos > 0.96) {
            r = (r * 0.65) | 0; g = (g * 0.65) | 0; b = (b * 0.65) | 0;
          }
        } else if (pat === 'concrete') {
          var noise = (Math.sin(wallX * 60 + (mapX || 0) * 7) * 0.06);
          r = Math.max(0, (r * (1 + noise)) | 0);
          g = Math.max(0, (g * (1 + noise)) | 0);
          b = Math.max(0, (b * (1 + noise)) | 0);
        } else if (pat === 'grain') {
          var g0 = 0.95 + Math.sin(wallX * 60) * 0.03 + Math.sin(wallX * 150) * 0.02;
          r = (r * g0) | 0; g = (g * g0) | 0; b = (b * g0) | 0;
        }
      }
    } else if (isLower) {
      // ── Default hotel theme (legacy) ─────────────────────────
      switch (tile) {
        case 1: r = 85; g = 55; b = 35; break;
        case 2: r = 130; g = 85; b = 40; break;
        case 6: r = 45; g = 110; b = 45; break;
        case 7: r = 75; g = 50; b = 30; break;
        case 9: r = 100; g = 100; b = 110; break;
        case 10: r = 55; g = 65; b = 95; break;
        default: r = 85; g = 55; b = 35; break;
      }
      if (wallX !== undefined) {
        var grain = 0.95 + Math.sin(wallX * 60) * 0.03 + Math.sin(wallX * 150) * 0.02;
        r = (r * grain) | 0;
        g = (g * grain) | 0;
        b = (b * grain) | 0;
      }
    } else {
      switch (tile) {
        case 1: r = 155; g = 135; b = 105; break;
        case 2: r = 160; g = 110; b = 50; break;
        case 6: r = 60; g = 150; b = 60; break;
        case 7: r = 100; g = 90; b = 80; break;
        case 9: r = 140; g = 140; b = 150; break;
        case 10: r = 80; g = 90; b = 130; break;
        default: r = 155; g = 135; b = 105; break;
      }
      if (wallX !== undefined) {
        var stripePhase = (wallX * 10) | 0;
        if (stripePhase % 2 === 0) {
          r = (r * 0.95) | 0;
          g = (g * 0.95) | 0;
          b = (b * 0.95) | 0;
        }
      }
    }

    // V1: Aging/stain — seeded random darker patches on ~20% of strips
    if (mapX !== undefined && mapY !== undefined) {
      var stainSeed = seededRandom(mapX, mapY, side);
      if (stainSeed < 0.20) {
        var stainDark = 0.85 + stainSeed * 0.5;
        r = (r * stainDark) | 0;
        g = (g * stainDark) | 0;
        b = (b * stainDark) | 0;
      }
      // V1: Wall cracks — thin dark lines at random wallX on ~10% of tiles
      if (wallX !== undefined && stainSeed > 0.20 && stainSeed < 0.30) {
        var crackPos = seededRandom(mapX * 3, mapY * 7, 99);
        if (Math.abs(wallX - crackPos) < 0.015) {
          r = (r * 0.5) | 0;
          g = (g * 0.5) | 0;
          b = (b * 0.5) | 0;
        }
      }
    }

    // V1: Blood stains
    if (mapX !== undefined && mapY !== undefined && engine.bloodTiles) {
      var bKey = mapY * 1000 + mapX;
      if (engine.bloodTiles[bKey]) {
        // Blood drip pattern using wallX
        if (wallX !== undefined) {
          var drip1 = seededRandom(mapX, mapY, 1);
          var drip2 = seededRandom(mapX, mapY, 2);
          var dripW = 0.06;
          if (Math.abs(wallX - drip1) < dripW || Math.abs(wallX - drip2) < dripW) {
            r = Math.min(255, r + 60);
            g = (g * 0.3) | 0;
            b = (b * 0.3) | 0;
          }
        }
      }
    }

    // Darken one side for depth
    if (side === 1) { r = r * 0.72 | 0; g = g * 0.72 | 0; b = b * 0.72 | 0; }

    // Distance fog — theme-driven view distance (default 12 tiles)
    var maxViewDist = (engine.theme && engine.theme.fogDist) || 12;
    var fogFactor = Math.max(0.05, 1 - dist / maxViewDist);

    // V5: Point light contributions (from precomputed grid)
    if (mapX !== undefined && mapY !== undefined && _lightGrid && mapX >= 0 && mapX < _lightGridW && mapY >= 0 && mapY < _lightGridH) {
      var wLIdx = (mapY * _lightGridW + mapX) * 3;
      if (_lightGrid[wLIdx] > 0 || _lightGrid[wLIdx + 1] > 0) {
        r = Math.min(255, r + (_lightGrid[wLIdx] * 0.3) | 0);
        g = Math.min(255, g + (_lightGrid[wLIdx + 1] * 0.3) | 0);
        b = Math.min(255, b + (_lightGrid[wLIdx + 2] * 0.3) | 0);
      }
    }

    r = (r * fogFactor) | 0;
    g = (g * fogFactor) | 0;
    b = (b * fogFactor) | 0;

    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function renderDoorStrip(ctx, x, sw, drawStart, wallH, wallX, tile, side, dim, mapX, mapY) {
    var drawEnd = drawStart + wallH;
    var sideDim = side === 1 ? 0.72 : 1;
    var d = dim * sideDim;

    // V4: Check for door style override
    var doorStyle = 'wood';
    if (mapX !== undefined && mapY !== undefined && engine.doorStyles) {
      var dsKey = mapX + ',' + mapY;
      if (engine.doorStyles[dsKey]) doorStyle = engine.doorStyles[dsKey];
    }

    // Door base colors
    var doorR, doorG, doorB;
    var frameR, frameG, frameB;
    if (tile === 6 || doorStyle === 'emergency') {
      // Exit / emergency door — dark green with gold frame
      doorR = 35; doorG = 80; doorB = 40;
      frameR = 140; frameG = 120; frameB = 50;
    } else if (tile === 9) {
      // Elevator — brushed metal
      doorR = 110; doorG = 115; doorB = 120;
      frameR = 80; frameG = 82; frameB = 85;
    } else if (doorStyle === 'steel') {
      // V4: Steel door — gray metal
      doorR = 90; doorG = 95; doorB = 100;
      frameR = 60; frameG = 62; frameB = 65;
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

    // V4: Steel door — rivets at corners, no panels
    if (doorStyle === 'steel') {
      // Rivets at corners
      var rivetPositions = [0.12, 0.88];
      for (var ri = 0; ri < rivetPositions.length; ri++) {
        if (Math.abs(wallX - rivetPositions[ri]) < 0.03) {
          var rivetY1 = drawStart + wallH * 0.08;
          var rivetY2 = drawStart + wallH * 0.92;
          var rivetSize = Math.max(1, wallH * 0.015);
          var rvR = Math.min(255, ((doorR + 40) * d) | 0);
          var rvG = Math.min(255, ((doorG + 40) * d) | 0);
          var rvB = Math.min(255, ((doorB + 40) * d) | 0);
          ctx.fillStyle = 'rgb(' + rvR + ',' + rvG + ',' + rvB + ')';
          ctx.fillRect(x, rivetY1, sw, rivetSize);
          ctx.fillRect(x, rivetY2, sw, rivetSize);
        }
      }
      // Industrial handle at 80-85%
      if (wallX > 0.78 && wallX < 0.87) {
        var handleY = drawStart + wallH * 0.45;
        var handleH = wallH * 0.12;
        var hR = Math.min(255, ((doorR + 30) * d) | 0);
        var hG = Math.min(255, ((doorG + 30) * d) | 0);
        var hB = Math.min(255, ((doorB + 30) * d) | 0);
        ctx.fillStyle = 'rgb(' + hR + ',' + hG + ',' + hB + ')';
        ctx.fillRect(x, handleY, sw, handleH);
      }
      // Bottom frame
      ctx.fillStyle = 'rgb(' + tR + ',' + tG + ',' + tB + ')';
      ctx.fillRect(x, bottomBorder, sw, drawEnd - bottomBorder);
      return;
    }

    // V4: Emergency door — EXIT text band + push bar
    if (doorStyle === 'emergency' && tile !== 6) {
      // EXIT text band at top 10-18%
      if (wallX > 0.2 && wallX < 0.8) {
        var exitTop = drawStart + wallH * 0.08;
        var exitH = wallH * 0.1;
        var exR = (200 * d) | 0;
        var exG = (220 * d) | 0;
        var exB = (200 * d) | 0;
        ctx.fillStyle = 'rgb(' + exR + ',' + exG + ',' + exB + ')';
        ctx.fillRect(x, exitTop, sw, exitH);
      }
      // Push bar at 55-60%
      if (wallX > 0.15 && wallX < 0.85) {
        var barY = drawStart + wallH * 0.55;
        var barH = wallH * 0.04;
        var bR = (160 * d) | 0;
        var bG = (160 * d) | 0;
        var bB = (160 * d) | 0;
        ctx.fillStyle = 'rgb(' + bR + ',' + bG + ',' + bB + ')';
        ctx.fillRect(x, barY, sw, barH);
      }
      ctx.fillStyle = 'rgb(' + tR + ',' + tG + ',' + tB + ')';
      ctx.fillRect(x, bottomBorder, sw, drawEnd - bottomBorder);
      return;
    }

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

  // ───────────────────────────────────────────────
  // Precomputed per-tile light grid (rebuilt each frame)
  // ───────────────────────────────────────────────
  var _lightGrid = null;   // Float32Array: [r, g, b] per tile, mapW*mapH*3
  var _lightGridW = 0;
  var _lightGridH = 0;

  function buildLightGrid(mapW, mapH, pointLights, ceilingLights, nowTime) {
    var sz = mapW * mapH * 3;
    if (!_lightGrid || _lightGridW !== mapW || _lightGridH !== mapH) {
      _lightGrid = new Float32Array(sz);
      _lightGridW = mapW;
      _lightGridH = mapH;
    }
    // Zero out
    for (var z = 0; z < sz; z++) _lightGrid[z] = 0;

    var ts = TILE_SIZE;
    var i, pl, gx, gy, r2, dx, dy, d2, falloff, intensity, contrib;

    // Point lights
    if (pointLights) {
      for (i = 0; i < pointLights.length; i++) {
        pl = pointLights[i];
        intensity = pl.intensity || 1;
        if (pl.flicker) {
          intensity *= (1 + Math.sin(nowTime * pl.flicker + (pl.phase || 0)) * 0.3);
        }
        var rad = pl.radius;
        r2 = rad * rad;
        var minGX = Math.max(0, (pl.gx - rad) | 0);
        var maxGX = Math.min(mapW - 1, (pl.gx + rad + 1) | 0);
        var minGY = Math.max(0, (pl.gy - rad) | 0);
        var maxGY = Math.min(mapH - 1, (pl.gy + rad + 1) | 0);
        for (gy = minGY; gy <= maxGY; gy++) {
          dy = gy + 0.5 - (pl.gy + 0.5);
          for (gx = minGX; gx <= maxGX; gx++) {
            dx = gx + 0.5 - (pl.gx + 0.5);
            d2 = dx * dx + dy * dy;
            if (d2 < r2) {
              falloff = 1 - Math.sqrt(d2) / rad;
              falloff = falloff * falloff;
              contrib = falloff * intensity;
              var idx = (gy * mapW + gx) * 3;
              _lightGrid[idx]     += (pl.r || 255) * contrib;
              _lightGrid[idx + 1] += (pl.g || 200) * contrib;
              _lightGrid[idx + 2] += (pl.b || 150) * contrib;
            }
          }
        }
      }
    }

    // Ceiling lights (add to same grid)
    if (ceilingLights) {
      for (i = 0; i < ceilingLights.length; i++) {
        var cl = ceilingLights[i];
        var clRad = cl.radius || 1.5;
        r2 = clRad * clRad;
        var flkr = 1;
        var cMinGX = Math.max(0, (cl.gx - clRad) | 0);
        var cMaxGX = Math.min(mapW - 1, (cl.gx + clRad + 1) | 0);
        var cMinGY = Math.max(0, (cl.gy - clRad) | 0);
        var cMaxGY = Math.min(mapH - 1, (cl.gy + clRad + 1) | 0);
        for (gy = cMinGY; gy <= cMaxGY; gy++) {
          for (gx = cMinGX; gx <= cMaxGX; gx++) {
            dx = gx + 0.5 - (cl.gx + 0.5);
            dy = gy + 0.5 - (cl.gy + 0.5);
            d2 = dx * dx + dy * dy;
            if (d2 < r2) {
              falloff = 1 - Math.sqrt(d2) / clRad;
              falloff = falloff * falloff;
              if (cl.flickerRate) {
                flkr = 0.7 + Math.sin(nowTime * cl.flickerRate + gx * 3.7) * 0.3;
              }
              contrib = falloff * flkr;
              var cidx = (gy * mapW + gx) * 3;
              // Ceiling lights are warm white
              _lightGrid[cidx]     += 225 * contrib;
              _lightGrid[cidx + 1] += 210 * contrib;
              _lightGrid[cidx + 2] += 170 * contrib;
            }
          }
        }
      }
    }
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

    // Per-frame flicker value (consistent across all strips)
    var frameFlicker = currentFlashlightFlicker > 0
      ? (1 - currentFlashlightFlicker * (0.05 + Math.sin(performance.now() * 0.03) * 0.1))
      : 1;

    // Apply shake to angle for camera wobble
    var renderAngle = playerAngle + shakeOffsetX * 0.01;

    // ── Theme-driven ceiling/floor backdrop ───────────────
    var themeBg = engine.theme && engine.theme.bg;
    var ceilStops = (themeBg && themeBg.ceiling) || ['#181614', '#262018', '#302a20'];
    var floorStops = (themeBg && themeBg.floor) || ['#1c1210', '#2d1815', '#3a2018'];

    var ceilGrad = ctx.createLinearGradient(0, 0, 0, h / 2);
    ceilGrad.addColorStop(0, ceilStops[0]);
    ceilGrad.addColorStop(0.7, ceilStops[1] || ceilStops[0]);
    ceilGrad.addColorStop(1, ceilStops[2] || ceilStops[1] || ceilStops[0]);
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, w, h / 2);

    var floorGrad = ctx.createLinearGradient(0, h / 2, 0, h);
    floorGrad.addColorStop(0, floorStops[0]);
    floorGrad.addColorStop(0.3, floorStops[1] || floorStops[0]);
    floorGrad.addColorStop(1, floorStops[2] || floorStops[1] || floorStops[0]);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, h / 2, w, h / 2);

    // Precompute light grid once per frame
    var nowTime = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    buildLightGrid(mapW, mapH, engine.pointLights, engine.ceilingLights, nowTime);

    // Z-buffer for sprite clipping
    var zBuffer = new Float32Array(w);

    // Cast rays
    // Adaptive strip width: lower quality on mobile / low-FPS, 2 default, 3 if engine.theme.lowQuality
    var stripWidth = (engine.theme && engine.theme.lowQuality) ? 3 : 2;
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
      var _fogDist = (engine.theme && engine.theme.fogDist) || 12;
      var fogDim = Math.max(0.05, 1 - correctedDist / _fogDist);
      var totalDim = fogDim * frameFlicker;

      // --- Door rendering (tile 2, 6, 9) ---
      if (hitTile === 2 || hitTile === 6 || hitTile === 9) {
        renderDoorStrip(ctx, screenX, stripWidth, drawStart, wallH, wallX, hitTile, side, totalDim, mapX, mapY);
      } else {
        // ── Theme override: flat wall (no wainscoting split) ─
        var themeWall = engine.theme && engine.theme.wall;
        if (themeWall && themeWall.flat) {
          var flatColor = getWallColor(hitTile, side, correctedDist, false, wallX, mapX, mapY);
          ctx.fillStyle = flatColor;
          ctx.fillRect(screenX, drawStart, stripWidth, wallH);
        } else {
          // Regular wall: upper wallpaper + dado rail + lower wainscoting
          var splitRatio = (themeWall && themeWall.splitRatio) || 0.62;
          var splitY = drawStart + wallH * splitRatio;
          var colorUpper = getWallColor(hitTile, side, correctedDist, false, wallX, mapX, mapY);
          var colorLower = getWallColor(hitTile, side, correctedDist, true, wallX, mapX, mapY);

          ctx.fillStyle = colorUpper;
          ctx.fillRect(screenX, drawStart, stripWidth, splitY - drawStart);

          var railH = Math.max(1, wallH * 0.015);
          var railRgb = (themeWall && themeWall.railColor) || [50, 35, 22];
          var railR = (railRgb[0] * totalDim) | 0;
          var railG = (railRgb[1] * totalDim) | 0;
          var railB = (railRgb[2] * totalDim) | 0;
          ctx.fillStyle = 'rgb(' + railR + ',' + railG + ',' + railB + ')';
          ctx.fillRect(screenX, splitY, stripWidth, railH);

          ctx.fillStyle = colorLower;
          ctx.fillRect(screenX, splitY + railH, stripWidth, drawEnd - splitY - railH);
        }
      }
    }

    // ─── V2: Floor & Ceiling Casting (optimized) ───
    var halfH = h / 2;
    var floorColors = engine.floorColors;

    for (var fi = 0; fi < numRays; fi++) {
      var fScreenX = fi * stripWidth;
      var fRayAngle = renderAngle - FOV / 2 + (fi / numRays) * FOV;
      var fSinA = Math.sin(fRayAngle);
      var fCosA = Math.cos(fRayAngle);
      var cosCorrect = Math.cos(fRayAngle - renderAngle);

      // Get the wall distance for this column — floor/ceiling must stop here
      var fWallDist = zBuffer[fScreenX];
      var fWallH = (fWallDist > 0.01 && fWallDist < 999) ? (h / fWallDist) : 0;
      var fWallBottom = ((h + fWallH) / 2) | 0;
      var fWallTop = ((h - fWallH) / 2) | 0;
      // Max perpendicular distance for floor/ceiling = wall distance (clamp to prevent see-through)
      var maxFloorDist = (fWallDist < 999) ? fWallDist : 10;

      // Floor: rows below wall bottom
      for (var fy = fWallBottom; fy < h; fy += 2) {
        var fyDenom = fy - halfH;
        if (fyDenom <= 0) continue;
        var fRowDist = halfH / fyDenom;
        if (fRowDist <= 0.01 || fRowDist > maxFloorDist) break;
        var fRayDist = fRowDist / cosCorrect;

        var fFloorX = playerX / ts + fCosA * fRayDist;
        var fFloorY = playerY / ts + fSinA * fRayDist;
        var fgx = fFloorX | 0;
        var fgy = fFloorY | 0;

        if (fgx < 0 || fgx >= mapW || fgy < 0 || fgy >= mapH) continue;

        // Default: theme-driven (else burgundy carpet)
        var defFloor = (engine.theme && engine.theme.floorDefault) || [60, 25, 22];
        var fR = defFloor[0], fG = defFloor[1], fB = defFloor[2];
        var fKey = fgy * 1000 + fgx;
        if (floorColors && floorColors[fKey]) {
          var fc = floorColors[fKey];
          fR = fc.r; fG = fc.g; fB = fc.b;
          if (fc.checker && ((fgx + fgy) & 1) === 0) {
            fR = (fR * 0.9) | 0; fG = (fG * 0.9) | 0; fB = (fB * 0.9) | 0;
          }
        }
        // Theme floor pattern overlay
        if (engine.theme && engine.theme.floorPattern === 'checker' && ((fgx + fgy) & 1) === 0) {
          fR = (fR * 0.92) | 0; fG = (fG * 0.92) | 0; fB = (fB * 0.92) | 0;
        } else if (engine.theme && engine.theme.floorPattern === 'damp') {
          var dampN = Math.sin(fgx * 1.7 + fgy * 2.3) * 0.06;
          fR = Math.max(0, (fR * (1 + dampN)) | 0);
          fG = Math.max(0, (fG * (1 + dampN)) | 0);
          fB = Math.max(0, (fB * (1 + dampN)) | 0);
        }

        // Distance fog (theme-driven)
        var _fcDist = (engine.theme && engine.theme.fogDist) || 12;
        var fFog = Math.max(0.05, 1 - fRowDist / _fcDist);

        // Light from precomputed grid (floor uses 0.25 multiplier)
        var fLIdx = (fgy * mapW + fgx) * 3;
        if (_lightGrid[fLIdx] > 0 || _lightGrid[fLIdx + 1] > 0) {
          fR = Math.min(255, fR + (_lightGrid[fLIdx] * 0.25) | 0);
          fG = Math.min(255, fG + (_lightGrid[fLIdx + 1] * 0.25) | 0);
          fB = Math.min(255, fB + (_lightGrid[fLIdx + 2] * 0.25) | 0);
        }

        fR = (fR * fFog) | 0;
        fG = (fG * fFog) | 0;
        fB = (fB * fFog) | 0;

        ctx.fillStyle = 'rgb(' + fR + ',' + fG + ',' + fB + ')';
        ctx.fillRect(fScreenX, fy, stripWidth, 2);
      }

      // Ceiling: rows above wall top
      for (var cy = fWallTop; cy >= 0; cy -= 2) {
        var cyDenom = halfH - cy;
        if (cyDenom <= 0) continue;
        var cRowDist = halfH / cyDenom;
        if (cRowDist <= 0.01 || cRowDist > maxFloorDist) break;
        var cRayDist = cRowDist / cosCorrect;

        var cFloorX = playerX / ts + fCosA * cRayDist;
        var cFloorY = playerY / ts + fSinA * cRayDist;
        var cgx = cFloorX | 0;
        var cgy = cFloorY | 0;

        if (cgx < 0 || cgx >= mapW || cgy < 0 || cgy >= mapH) continue;

        // Default ceiling: theme-driven (else dark warm tone)
        var defCeil = (engine.theme && engine.theme.ceilingDefault) || [30, 24, 20];
        var cR = defCeil[0], cG = defCeil[1], cB = defCeil[2];
        // Backrooms-style fluorescent grid ceiling
        if (engine.theme && engine.theme.ceilingPattern === 'grid') {
          var gridU = ((cgx + cgy) & 1);
          if (gridU === 0) {
            cR = Math.min(255, cR + 60);
            cG = Math.min(255, cG + 55);
            cB = Math.min(255, cB + 40);
          }
        } else if (engine.theme && engine.theme.ceilingPattern === 'pipes') {
          if ((cgx + cgy * 2) % 4 === 0) {
            cR = (cR * 0.6) | 0; cG = (cG * 0.6) | 0; cB = (cB * 0.6) | 0;
          }
        }

        // Light from precomputed grid (ceiling uses full contrib)
        var cLIdx = (cgy * mapW + cgx) * 3;
        if (_lightGrid[cLIdx] > 0 || _lightGrid[cLIdx + 1] > 0) {
          cR = Math.min(255, cR + _lightGrid[cLIdx] | 0);
          cG = Math.min(255, cG + _lightGrid[cLIdx + 1] | 0);
          cB = Math.min(255, cB + _lightGrid[cLIdx + 2] | 0);
        }

        var _ccDist = (engine.theme && engine.theme.fogDist) || 12;
        var cFog = Math.max(0.05, 1 - cRowDist / _ccDist);
        cR = (cR * cFog) | 0;
        cG = (cG * cFog) | 0;
        cB = (cB * cFog) | 0;

        ctx.fillStyle = 'rgb(' + cR + ',' + cG + ',' + cB + ')';
        ctx.fillRect(fScreenX, cy, stripWidth, 2);
      }
    }

    // Store z-buffer for sprite rendering
    engine._zBuffer = zBuffer;
  }

  function renderSprite(entity) {
    if (!entity || entity.visible === false) return;

    var dx = entity.x - playerX;
    var dy = entity.y - playerY;

    // Transform to camera space (standard raycaster sprite projection)
    var renderAngle = playerAngle + shakeOffsetX * 0.01;
    var cosT = Math.cos(renderAngle);
    var sinT = Math.sin(renderAngle);
    var transformX = -dx * sinT + dy * cosT;  // lateral (right+)
    var transformY = dx * cosT + dy * sinT;   // depth (forward+)

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

    // Distance fog — extended view distance for entities (20 tiles), minimum alpha 0.15
    var fogDist = transformY / ts;
    var maxViewDist = 20;
    var fogFactor = Math.max(0.15, 1 - fogDist / maxViewDist);
    if (fogFactor <= 0.15 && fogDist > maxViewDist) return;

    // Use entity image or color rectangle
    var img = entity.sprite ? engine.images[entity.sprite] : null;

    var ctx = engine.ctx;
    ctx.save();
    ctx.globalAlpha = fogFactor;

    var depthInTiles = transformY / ts;

    // If entity has a body, split into head (upper 40%) + body (lower 60%)
    var hasBody = !!entity.bodyColor;
    var headHeight = hasBody ? spriteHeight * 0.35 : spriteHeight;
    var bodyHeight = hasBody ? spriteHeight * 0.65 : 0;
    var headStartY = drawStartY;
    var bodyStartY = drawStartY + headHeight;
    var headWidth = hasBody ? spriteWidth * 0.8 : spriteWidth;
    var headStartX = hasBody ? drawStartX + (spriteWidth - headWidth) / 2 : drawStartX;
    var bodyWidth = hasBody ? spriteWidth * 0.55 : 0;
    var bodyStartX = drawStartX + (spriteWidth - bodyWidth) / 2;

    // Draw body first (behind head)
    if (hasBody) {
      var bStartCol = Math.max(0, Math.floor(bodyStartX));
      var bEndCol = Math.min(w, Math.ceil(bodyStartX + bodyWidth));
      // Body shape: slightly tapered, darker at edges
      for (var bc = bStartCol; bc < bEndCol; bc++) {
        if (bc >= 0 && bc < w && zBuf[bc] > depthInTiles) {
          var bNorm = (bc - bodyStartX) / bodyWidth; // 0-1 across body
          var edgeDim = 1 - Math.pow(Math.abs(bNorm - 0.5) * 2, 2) * 0.4;
          // Parse body color
          var br = entity._bodyR || 40;
          var bg = entity._bodyG || 40;
          var bb = entity._bodyB || 45;
          ctx.fillStyle = 'rgb(' + ((br * edgeDim) | 0) + ',' + ((bg * edgeDim) | 0) + ',' + ((bb * edgeDim) | 0) + ')';
          ctx.fillRect(bc, bodyStartY, 1, bodyHeight);
        }
      }
      // Shoulders (wider at top of body)
      var shoulderW = spriteWidth * 0.7;
      var shoulderX = drawStartX + (spriteWidth - shoulderW) / 2;
      var shoulderH = bodyHeight * 0.12;
      var sStartCol = Math.max(0, Math.floor(shoulderX));
      var sEndCol = Math.min(w, Math.ceil(shoulderX + shoulderW));
      for (var sc = sStartCol; sc < sEndCol; sc++) {
        if (sc >= 0 && sc < w && zBuf[sc] > depthInTiles) {
          var sNorm = (sc - shoulderX) / shoulderW;
          var sDim = 1 - Math.pow(Math.abs(sNorm - 0.5) * 2, 3) * 0.5;
          ctx.fillStyle = 'rgb(' + (((entity._bodyR || 40) * sDim) | 0) + ',' + (((entity._bodyG || 40) * sDim) | 0) + ',' + (((entity._bodyB || 45) * sDim) | 0) + ')';
          ctx.fillRect(sc, bodyStartY, 1, shoulderH);
        }
      }
    }

    // Draw head (face sprite or color)
    if (img) {
      var startCol = Math.max(0, Math.floor(headStartX));
      var endCol = Math.min(w, Math.ceil(headStartX + headWidth));
      for (var col = startCol; col < endCol; col++) {
        if (col >= 0 && col < w && zBuf[col] > depthInTiles) {
          var srcX = ((col - headStartX) / headWidth) * img.width;
          ctx.drawImage(img, srcX, 0, 1, img.height, col, headStartY, 1, headHeight);
        }
      }
    } else {
      ctx.fillStyle = entity.color || '#880000';
      var startCol2 = Math.max(0, Math.floor(drawStartX));
      var endCol2 = Math.min(w, Math.ceil(drawStartX + spriteWidth));
      for (var col2 = startCol2; col2 < endCol2; col2++) {
        if (zBuf[col2] > depthInTiles) {
          ctx.fillRect(col2, drawStartY, 1, spriteHeight);
        }
      }
    }

    // Red glow aura around entity for visibility in dark corridors
    if (entity.bodyColor && depthInTiles > 2) {
      var glowRadius = spriteHeight * 0.7;
      var glowCenterX = spriteScreenX;
      var glowCenterY = drawStartY + spriteHeight * 0.4;
      var glowAlpha = Math.min(0.25, fogFactor * 0.3);
      var grad = ctx.createRadialGradient(glowCenterX, glowCenterY, 0, glowCenterX, glowCenterY, glowRadius);
      grad.addColorStop(0, 'rgba(180,0,30,' + glowAlpha + ')');
      grad.addColorStop(1, 'rgba(180,0,30,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(glowCenterX - glowRadius, glowCenterY - glowRadius, glowRadius * 2, glowRadius * 2);
    }

    ctx.restore();
  }

  // Render a golden glow on the floor at a world position (for key card, etc.)
  function renderFloorGlow(wx, wy, phase) {
    var dx = wx - playerX;
    var dy = wy - playerY;
    var renderAngle = playerAngle + shakeOffsetX * 0.01;
    var cosT = Math.cos(renderAngle);
    var sinT = Math.sin(renderAngle);
    var tX = -dx * sinT + dy * cosT;
    var tY = dx * cosT + dy * sinT;
    if (tY <= 0.5) return;

    var w = engine.width;
    var h = engine.height;
    var ts = TILE_SIZE;
    var depthInTiles = tY / ts;

    // Z-buffer occlusion: check if a wall is closer at the screen center of the glow
    var zBuf = engine._zBuffer;
    var screenX = (w / 2) * (1 + tX / tY);
    var screenCol = Math.round(screenX);
    if (zBuf && screenCol >= 0 && screenCol < w && zBuf[screenCol] < depthInTiles) {
      return; // wall is in front — don't draw
    }

    var screenY = h / 2 + (h * 0.5) / depthInTiles;
    var glowSize = (h / depthInTiles) * 0.6;

    if (glowSize < 2 || glowSize > h) return;

    var fogFactor = Math.max(0, 1 - depthInTiles / 12);
    if (fogFactor <= 0.05) return;

    var pulse = 0.6 + Math.sin(phase) * 0.4;
    var ctx = engine.ctx;
    ctx.save();
    ctx.globalAlpha = fogFactor * 0.7;
    var grad = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, glowSize);
    grad.addColorStop(0, 'rgba(255,200,50,' + (0.5 * pulse) + ')');
    grad.addColorStop(0.5, 'rgba(255,180,0,' + (0.2 * pulse) + ')');
    grad.addColorStop(1, 'rgba(255,150,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(screenX - glowSize, screenY - glowSize, glowSize * 2, glowSize * 2);

    // Key icon (simple key shape)
    var iconSize = glowSize * 0.3;
    if (iconSize > 4) {
      ctx.globalAlpha = fogFactor * pulse * 0.8;
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = Math.max(1, iconSize * 0.15);
      ctx.beginPath();
      var kx = screenX;
      var ky = screenY - iconSize * 0.2;
      var kr = iconSize * 0.25;
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.moveTo(kx, ky + kr);
      ctx.lineTo(kx, ky + kr + iconSize * 0.5);
      ctx.moveTo(kx, ky + kr + iconSize * 0.3);
      ctx.lineTo(kx + iconSize * 0.15, ky + kr + iconSize * 0.3);
      ctx.moveTo(kx, ky + kr + iconSize * 0.45);
      ctx.lineTo(kx + iconSize * 0.12, ky + kr + iconSize * 0.45);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ───────────────────────────────────────────────
  // V7: Particle system renderer
  // ───────────────────────────────────────────────
  function renderParticles() {
    if (particles.length === 0) return;
    var ctx = engine.ctx;
    var w = engine.width;
    var h = engine.height;
    var ts = TILE_SIZE;
    var renderAngle = playerAngle + shakeOffsetX * 0.01;
    var cosT = Math.cos(renderAngle);
    var sinT = Math.sin(renderAngle);
    var zBuf = engine._zBuffer;

    ctx.save();
    for (var pi = 0; pi < particles.length; pi++) {
      var p = particles[pi];
      var dx = p.x - playerX;
      var dy = p.y - playerY;
      var tX = -dx * sinT + dy * cosT;
      var tY = dx * cosT + dy * sinT;
      if (tY <= 0.5) continue;

      var depthInTiles = tY / ts;
      if (depthInTiles > 10) continue;

      var screenX = (w / 2) * (1 + tX / tY);
      var screenY = h / 2; // particles float at mid-height
      var size = Math.max(1, (p.size || 2) * (h / tY) * 0.02);

      var col = Math.round(screenX);
      if (col < 0 || col >= w) continue;
      if (zBuf && zBuf[col] < depthInTiles) continue;

      var fogFactor = Math.max(0, 1 - depthInTiles / 12);
      var lifeRatio = p.life / p.maxLife;
      ctx.globalAlpha = fogFactor * lifeRatio * 0.6;

      if (p.type === 'dust') {
        ctx.fillStyle = 'rgba(200,190,170,1)';
      } else if (p.type === 'fog') {
        ctx.fillStyle = 'rgba(120,120,130,1)';
        size *= 3;
      } else if (p.type === 'spark') {
        ctx.fillStyle = 'rgba(255,220,80,1)';
      } else {
        ctx.fillStyle = 'rgba(180,180,180,1)';
      }
      ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
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

    // ── V1: Blood stain tiles ──
    bloodTiles: {},

    // ── V2: Floor colors per tile ──
    floorColors: {},

    // ── V3: Ceiling lights ──
    ceilingLights: [],

    // ── V4: Door styles ──
    doorStyles: {},

    // ── V5: Point lights ──
    pointLights: [],

    // ── V6: Post-effect settings ──
    grainIntensity: 0.3,
    chromaticLevel: 0,
    vignetteIntensity: 0.3,

    // ── Backrooms: Level theme (palette, fog, patterns) ──
    theme: null,

    // ── Optional hook: game.js can override walkable check ──
    isWalkableHook: null,

    // ── V7: Particle API ──
    particles: particles,

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

    // ── V5: Point light management ──
    addPointLight: function (id, gx, gy, opts) {
      opts = opts || {};
      // Remove existing with same id
      this.removePointLight(id);
      this.pointLights.push({
        id: id,
        gx: gx,
        gy: gy,
        radius: opts.radius || 4,
        r: opts.r || 255,
        g: opts.g || 200,
        b: opts.b || 150,
        intensity: opts.intensity || 1,
        flicker: opts.flicker || 0,
        phase: opts.phase || 0
      });
    },

    removePointLight: function (id) {
      for (var i = this.pointLights.length - 1; i >= 0; i--) {
        if (this.pointLights[i].id === id) {
          this.pointLights.splice(i, 1);
        }
      }
    },

    // ── V7: Particle system API ──
    addParticle: function (type, wx, wy) {
      if (particles.length >= MAX_PARTICLES) return;
      var p = { x: wx, y: wy, vx: 0, vy: 0, life: 0, maxLife: 2, type: type, size: 2 };
      if (type === 'dust') {
        p.vx = (Math.random() - 0.5) * 5;
        p.vy = (Math.random() - 0.5) * 5;
        p.maxLife = 3 + Math.random() * 3;
        p.size = 1;
      } else if (type === 'fog') {
        p.vx = (Math.random() - 0.5) * 8;
        p.vy = (Math.random() - 0.5) * 8;
        p.maxLife = 4 + Math.random() * 4;
        p.size = 4;
      } else if (type === 'spark') {
        p.vx = (Math.random() - 0.5) * 40;
        p.vy = (Math.random() - 0.5) * 40;
        p.maxLife = 0.3 + Math.random() * 0.3;
        p.size = 2;
      }
      p.life = p.maxLife;
      particles.push(p);
    },

    updateParticles: function (dt) {
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
        }
      }
    },

    // ── V7: Render particles (called from game render pipeline) ──
    drawParticles: function () {
      renderParticles();
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

      // Preload images (game-specific images loaded by game.js)

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
      // Hook for game to override walkability check
      if (this.isWalkableHook) {
        return this.isWalkableHook(wx, wy);
      }
      var g = this.worldToGrid(wx, wy);
      var t = this.getTile(g.x, g.y);
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

    drawFloorGlow: function (wx, wy, phase) {
      renderFloorGlow(wx, wy, phase);
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
      // But allow interaction on overlays (sliders, buttons, scroll)
      document.addEventListener('touchmove', function (e) {
        var allowScrollIds = ['phoneOverlay', 'noteViewerOverlay', 'tutorialOverlay', 'settingsOverlay', 'minimapOverlay', 'minigameOverlay', 'itemUseModal', 'levelSelectOverlay'];
        for (var i = 0; i < allowScrollIds.length; i++) {
          var ov = document.getElementById(allowScrollIds[i]);
          if (ov && ov.style.display !== 'none') return;
        }
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
        // S2: Environmental sounds
        case 'pipe_creak':
          this._playPipeCreak(now);
          break;
        case 'glass_rattle':
          this._playGlassRattle(now);
          break;
        case 'clock_tick':
          this._playClockTick(now);
          break;
        case 'elevator_hum':
          this._playElevatorHum(now);
          break;
        case 'item_get':
          this._playItemGet(now);
          break;
        case 'paper':
          this._playPaper(now);
          break;
        case 'key_unlock':
          this._playKeyUnlock(now);
          break;
        // S4: Horror stingers and whispers
        case 'stinger':
          this._playStinger(now);
          break;
        case 'whisper':
          this._playWhisper(now);
          break;
        case 'lullaby':
          this._playLullaby(now);
          break;
        case 'tinnitus':
          this._playTinnitus(now);
          break;
        case 'thunder':
          this._playThunder(now);
          break;
        case 'scream':
          this._playScream(now);
          break;
        case 'scream_short':
          this._playScreamShort(now);
          break;
      }
    },

    _playScream: function (now) {
      var dest = seGain || masterGain;
      // Female-ish scream: rapid pitch sweep + harmonic + noise
      var fundamental = audioCtx.createOscillator();
      fundamental.type = 'sawtooth';
      fundamental.frequency.setValueAtTime(440, now);
      fundamental.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      fundamental.frequency.exponentialRampToValueAtTime(660, now + 0.4);
      fundamental.frequency.exponentialRampToValueAtTime(220, now + 0.9);
      var fG = audioCtx.createGain();
      fG.gain.setValueAtTime(0, now);
      fG.gain.linearRampToValueAtTime(0.45, now + 0.08);
      fG.gain.setValueAtTime(0.45, now + 0.7);
      fG.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      fundamental.connect(fG);
      // Harmonic
      var harm = audioCtx.createOscillator();
      harm.type = 'square';
      harm.frequency.setValueAtTime(880, now);
      harm.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
      harm.frequency.exponentialRampToValueAtTime(440, now + 0.9);
      var hG = audioCtx.createGain();
      hG.gain.setValueAtTime(0, now);
      hG.gain.linearRampToValueAtTime(0.18, now + 0.08);
      hG.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
      harm.connect(hG);
      // Breath/throat noise
      var bufLen = (audioCtx.sampleRate * 1.0) | 0;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        var env = Math.sin(t * Math.PI);
        d[i] = (Math.random() * 2 - 1) * env * 0.4;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 4;
      var nG = audioCtx.createGain();
      nG.gain.value = 0.3;
      src.connect(bp); bp.connect(nG);
      fG.connect(dest); hG.connect(dest); nG.connect(dest);
      fundamental.start(now); harm.start(now); src.start(now);
      fundamental.stop(now + 1.05); harm.stop(now + 1.0); src.stop(now + 1.05);
    },

    _playScreamShort: function (now) {
      // Brief "ugh" / pain sound
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
      var g = audioCtx.createGain();
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(g); g.connect(dest);
      osc.start(now); osc.stop(now + 0.32);
      // Add breath noise burst
      var bufLen = (audioCtx.sampleRate * 0.3) | 0;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 6) * 0.5;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800;
      var ng = audioCtx.createGain();
      ng.gain.value = 0.4;
      src.connect(bp); bp.connect(ng); ng.connect(dest);
      src.start(now);
    },

    startLoop: function (type) {
      if (!audioCtx) return;
      if (activeLoops[type]) return;

      if (audioCtx.state === 'suspended') audioCtx.resume();

      switch (type) {
        case 'ambient':
          // S1: Start layered BGM system instead of simple drone
          this._startLayeredBGM();
          activeLoops[type] = {
            stop: function () { engine._stopLayeredBGM(); }
          };
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
        case 'fluorescent':
          activeLoops[type] = this._startFluorescentLoop();
          break;
        case 'pipe_drip':
          activeLoops[type] = this._startPipeDripLoop();
          break;
        case 'electric':
          activeLoops[type] = this._startElectricLoop();
          break;
        case 'wind':
          activeLoops[type] = this._startWindLoop();
          break;
        case 'classical':
          activeLoops[type] = this._startClassicalLoop();
          break;
        case 'lobby_music':
          activeLoops[type] = this._startLobbyMusicLoop();
          break;
        case 'nostalgic':
          activeLoops[type] = this._startNostalgicLoop();
          break;
        case 'chase':
          activeLoops[type] = this._startChaseLoop();
          break;
        case 'breath_drone':
          activeLoops[type] = this._startBreathDroneLoop();
          break;
      }
    },

    // Old jazz lobby waltz (broken 78rpm vinyl style) for Lv5 hotel
    _startLobbyMusicLoop: function () {
      var dest = bgmGain || masterGain;
      var ctx = audioCtx;
      var now = ctx.currentTime;
      // Vinyl crackle noise
      var bufLen = ctx.sampleRate * 3;
      var buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * 0.04;
      var crackle = ctx.createBufferSource();
      crackle.buffer = buf; crackle.loop = true;
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4000;
      var crG = ctx.createGain(); crG.gain.value = 0.12;
      crackle.connect(hp); hp.connect(crG); crG.connect(dest);
      crackle.start(now);

      // Waltz piano (3/4 time, Bb major key, with detuning for sad effect)
      // Notes: Bb-D-F (Bb chord), Eb-G-Bb (Eb), F-A-C, Bb...
      var waltzG = ctx.createGain();
      waltzG.gain.value = 0.13;
      // LowPass for radio/old-record feel
      var waltzLP = ctx.createBiquadFilter();
      waltzLP.type = 'lowpass';
      waltzLP.frequency.value = 1200;
      waltzG.connect(waltzLP); waltzLP.connect(dest);

      // Waltz pattern (sequence of notes, 3 beats each measure)
      // C minor waltz pattern
      var waltzNotes = [
        261.63, // C4 - downbeat
        311.13, // Eb4
        392.00, // G4
        261.63, // C4
        311.13, // Eb4
        392.00, // G4
        311.13, // Eb4
        349.23, // F4
        415.30, // Ab4
        311.13, // Eb4
        349.23, // F4
        415.30, // Ab4
        233.08, // Bb3
        311.13, // Eb4
        349.23, // F4
        261.63, // C4
        311.13, // Eb4
        392.00  // G4
      ];
      var waltzIdx = 0;
      var waltzTempo = 750; // 3 beats per second roughly

      function playWaltzNote() {
        if (!ctx || ctx.state !== 'running') {
          setTimeout(playWaltzNote, waltzTempo);
          return;
        }
        var t = ctx.currentTime;
        var freq = waltzNotes[waltzIdx % waltzNotes.length];
        // Detune slightly down for "broken record" effect
        freq *= 0.985;
        var osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        var nG = ctx.createGain();
        // Beat 1 (down beat) gets more emphasis
        var beatStrength = (waltzIdx % 3 === 0) ? 0.45 : 0.28;
        nG.gain.setValueAtTime(0, t);
        nG.gain.linearRampToValueAtTime(beatStrength, t + 0.02);
        nG.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.connect(nG); nG.connect(waltzG);
        osc.start(t);
        osc.stop(t + 0.7);
        waltzIdx++;
        setTimeout(playWaltzNote, waltzTempo);
      }
      var waltzTimer = setTimeout(playWaltzNote, 800);

      return {
        nodes: [crackle],
        gain: waltzG,
        interval: waltzTimer
      };
    },

    // Nostalgic suburban loop (warm but uncanny) for Lv9
    _startNostalgicLoop: function () {
      var dest = bgmGain || masterGain;
      var ctx = audioCtx;
      var now = ctx.currentTime;

      // Warm pad (major chord, C-E-G)
      var pad1 = ctx.createOscillator();
      pad1.type = 'sine'; pad1.frequency.value = 130.81; // C3
      var pad2 = ctx.createOscillator();
      pad2.type = 'sine'; pad2.frequency.value = 164.81; // E3
      var pad3 = ctx.createOscillator();
      pad3.type = 'sine'; pad3.frequency.value = 196.00; // G3
      var padG = ctx.createGain();
      padG.gain.value = 0.13;
      pad1.connect(padG); pad2.connect(padG); pad3.connect(padG); padG.connect(dest);
      pad1.start(now); pad2.start(now); pad3.start(now);

      // Slowly drifting tone
      var drift = ctx.createOscillator();
      drift.type = 'sine';
      drift.frequency.value = 0.07;
      var driftG = ctx.createGain();
      driftG.gain.value = 6;
      drift.connect(driftG); driftG.connect(pad2.frequency);
      drift.start(now);

      // Distant wind chimes (sparse high tones)
      var chimeTimer = setInterval(function () {
        if (!ctx || ctx.state !== 'running') return;
        if (Math.random() < 0.3) {
          var t = ctx.currentTime;
          var freqs = [1046.50, 1318.51, 1567.98]; // C6, E6, G6
          var freq = freqs[Math.floor(Math.random() * freqs.length)];
          var osc = ctx.createOscillator();
          osc.type = 'sine'; osc.frequency.value = freq;
          var cG = ctx.createGain();
          cG.gain.setValueAtTime(0.1, t);
          cG.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
          osc.connect(cG); cG.connect(dest);
          osc.start(t); osc.stop(t + 2.1);
        }
      }, 1500);

      return {
        nodes: [pad1, pad2, pad3, drift],
        gain: padG,
        interval: chimeTimer
      };
    },

    // Fast intense chase BGM for Lv7 / boss
    _startChaseLoop: function () {
      var dest = bgmGain || masterGain;
      var ctx = audioCtx;
      var now = ctx.currentTime;

      // Pulsing bass beat
      var bass = ctx.createOscillator();
      bass.type = 'square';
      bass.frequency.value = 55; // Low A
      var bassG = ctx.createGain();
      bassG.gain.value = 0;
      bass.connect(bassG); bassG.connect(dest);
      bass.start(now);

      // Pulse bass envelope at 140 BPM
      var pulseInterval = setInterval(function () {
        if (!ctx || ctx.state !== 'running') return;
        var t = ctx.currentTime;
        bassG.gain.setValueAtTime(0.25, t);
        bassG.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      }, 428); // ~140 BPM

      // High string-like screech with sweep
      var screech = ctx.createOscillator();
      screech.type = 'sawtooth';
      screech.frequency.value = 880;
      var screechFilter = ctx.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1500;
      screechFilter.Q.value = 6;
      var screechG = ctx.createGain();
      screechG.gain.value = 0.04;
      screech.connect(screechFilter); screechFilter.connect(screechG); screechG.connect(dest);
      screech.start(now);
      var screechLfo = ctx.createOscillator();
      screechLfo.type = 'sine';
      screechLfo.frequency.value = 0.3;
      var screechLfoG = ctx.createGain();
      screechLfoG.gain.value = 300;
      screechLfo.connect(screechLfoG); screechLfoG.connect(screechFilter.frequency);
      screechLfo.start(now);

      return {
        nodes: [bass, screech, screechLfo],
        gain: bassG,
        interval: pulseInterval
      };
    },

    // Subtle breath drone for added dread (Lv0 mix)
    _startBreathDroneLoop: function () {
      var dest = bgmGain || masterGain;
      var ctx = audioCtx;
      var now = ctx.currentTime;
      // Breath cycle: in (1.5s) -> hold (0.5s) -> out (1.8s) -> hold (1.2s) = 5s
      var bufLen = ctx.sampleRate * 5;
      var buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / ctx.sampleRate;
        var phase = (t / 5) % 1;
        var env = 0;
        if (phase < 0.3) env = phase / 0.3; // breath in
        else if (phase < 0.4) env = 1; // hold
        else if (phase < 0.76) env = (0.76 - phase) / 0.36; // breath out
        else env = 0;
        d[i] = (Math.random() * 2 - 1) * env * 0.35;
      }
      var src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 400;
      bp.Q.value = 3;
      var g = ctx.createGain();
      g.gain.value = 0.08;
      src.connect(bp); bp.connect(g); g.connect(dest);
      src.start(now);
      return { nodes: [src], gain: g };
    },

    _startClassicalLoop: function () {
      // Procedural minor-key classical-style horror BGM
      // Bass drone + sparse piano melody + cello pad
      var dest = bgmGain || masterGain;
      var ctx = audioCtx;
      var now = ctx.currentTime;

      // Bass drone (A2, 110Hz)
      var bass = ctx.createOscillator();
      bass.type = 'triangle';
      bass.frequency.value = 110;
      var bassG = ctx.createGain();
      bassG.gain.value = 0.18;
      bass.connect(bassG);
      bassG.connect(dest);
      bass.start(now);

      // Subtle bass LFO for movement
      var bassLfo = ctx.createOscillator();
      bassLfo.type = 'sine';
      bassLfo.frequency.value = 0.15;
      var bassLfoG = ctx.createGain();
      bassLfoG.gain.value = 0.04;
      bassLfo.connect(bassLfoG);
      bassLfoG.connect(bassG.gain);
      bassLfo.start(now);

      // Cello pad — two detuned saws around A3 (220Hz)
      var cello1 = ctx.createOscillator();
      cello1.type = 'sawtooth';
      cello1.frequency.value = 220;
      var cello2 = ctx.createOscillator();
      cello2.type = 'sawtooth';
      cello2.frequency.value = 222.5; // detune for chorus
      var celloFilter = ctx.createBiquadFilter();
      celloFilter.type = 'lowpass';
      celloFilter.frequency.value = 700;
      celloFilter.Q.value = 2;
      var celloG = ctx.createGain();
      celloG.gain.value = 0.05;
      cello1.connect(celloFilter);
      cello2.connect(celloFilter);
      celloFilter.connect(celloG);
      celloG.connect(dest);
      cello1.start(now);
      cello2.start(now);

      // Slow filter sweep on cello for atmosphere
      var celloSwoosh = ctx.createOscillator();
      celloSwoosh.type = 'sine';
      celloSwoosh.frequency.value = 0.08;
      var celloSwooshG = ctx.createGain();
      celloSwooshG.gain.value = 400;
      celloSwoosh.connect(celloSwooshG);
      celloSwooshG.connect(celloFilter.frequency);
      celloSwoosh.start(now);

      // Piano melody — minor pentatonic notes, slow tempo
      // A minor pentatonic: A, C, D, E, G
      var melodyNotes = [
        220.00,  // A3
        261.63,  // C4
        329.63,  // E4
        293.66,  // D4
        246.94,  // B3
        220.00,  // A3
        196.00,  // G3
        220.00   // A3
      ];
      var melodyG = ctx.createGain();
      melodyG.gain.value = 0.18;
      melodyG.connect(dest);
      var melodyIdx = 0;
      var melodyTempo = 3000; // 3 seconds per note (slow, somber)

      function playPianoNote() {
        if (!ctx || ctx.state !== 'running') {
          setTimeout(playPianoNote, melodyTempo);
          return;
        }
        var t = ctx.currentTime;
        var freq = melodyNotes[melodyIdx % melodyNotes.length];
        // Piano-like: sine + 2nd harmonic with quick decay
        var f1 = ctx.createOscillator();
        f1.type = 'sine';
        f1.frequency.value = freq;
        var f2 = ctx.createOscillator();
        f2.type = 'sine';
        f2.frequency.value = freq * 2;
        var f3 = ctx.createOscillator();
        f3.type = 'sine';
        f3.frequency.value = freq * 3;
        var noteG = ctx.createGain();
        noteG.gain.setValueAtTime(0, t);
        noteG.gain.linearRampToValueAtTime(0.5, t + 0.03);
        noteG.gain.exponentialRampToValueAtTime(0.05, t + 2.5);
        noteG.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
        var harmG = ctx.createGain();
        harmG.gain.value = 0.18;
        f2.connect(harmG);
        f3.connect(harmG);
        f1.connect(noteG);
        harmG.connect(noteG);
        noteG.connect(melodyG);
        f1.start(t);
        f2.start(t);
        f3.start(t);
        f1.stop(t + 3.1);
        f2.stop(t + 3.1);
        f3.stop(t + 3.1);
        melodyIdx++;
        setTimeout(playPianoNote, melodyTempo);
      }
      // Start melody after small delay
      var melodyTimer = setTimeout(playPianoNote, 1000);

      return {
        nodes: [bass, bassLfo, cello1, cello2, celloSwoosh],
        gain: bassG,
        interval: melodyTimer
      };
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
      this.stopEnemyFootsteps();
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
      // Volume scales with proximity: 0.3 base → 1.0 at max proximity
      var vol = 0.3 + proximityBoost * 1.4;
      for (var i = 0; i < 2; i++) {
        var offset = i * 0.15;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50 - i * 10, now + offset);
        gain.gain.setValueAtTime(vol, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now + offset);
        osc.stop(now + offset + 0.25);
      }
      // Sub-bass thump for more impact at close range
      if (proximityBoost > 0.2) {
        var sub = audioCtx.createOscillator();
        var subG = audioCtx.createGain();
        sub.type = 'sine';
        sub.frequency.value = 30;
        subG.gain.setValueAtTime(proximityBoost * 0.6, now);
        subG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        sub.connect(subG);
        subG.connect(dest);
        sub.start(now);
        sub.stop(now + 0.25);
      }
    },

    _playJumpscare: function (now) {
      var dest = seGain || masterGain;
      // Loud noise burst
      var bufferSize = audioCtx.sampleRate * 0.8;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
      }
      var noiseSrc = audioCtx.createBufferSource();
      noiseSrc.buffer = buffer;
      var noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(1.0, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
      noiseSrc.connect(noiseGain);
      noiseGain.connect(dest);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.9);

      // Dissonant chord — louder
      var freqs = [200, 212, 224, 237, 450, 477];
      for (var f = 0; f < freqs.length; f++) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[f];
        g.gain.setValueAtTime(0.5, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.connect(g);
        g.connect(dest);
        osc.start(now);
        osc.stop(now + 0.75);
      }

      // Low impact hit
      var hit = audioCtx.createOscillator();
      var hitG = audioCtx.createGain();
      hit.type = 'sine';
      hit.frequency.value = 60;
      hitG.gain.setValueAtTime(0.8, now);
      hitG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      hit.connect(hitG);
      hitG.connect(dest);
      hit.start(now);
      hit.stop(now + 0.5);
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
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.2);
      gain.gain.setValueAtTime(0.9, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.35);

      var bufLen = audioCtx.sampleRate * 0.12;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.7;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var g2 = audioCtx.createGain();
      g2.gain.value = 0.6;
      src.connect(g2);
      g2.connect(dest);
      src.start(now);
    },

    // ── S2: Environmental sounds ──

    _playPipeCreak: function (now) {
      var dest = seGain || masterGain;
      var bufferSize = (audioCtx.sampleRate * 1.5) | 0;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buffer;
      var bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(800, now);
      bp.frequency.linearRampToValueAtTime(1200, now + 0.7);
      bp.frequency.linearRampToValueAtTime(900, now + 1.5);
      bp.Q.value = 8;
      var gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.3);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.8);
      gain.gain.linearRampToValueAtTime(0, now + 1.5);
      src.connect(bp);
      bp.connect(gain);
      gain.connect(dest);
      src.start(now);
      src.stop(now + 1.6);
    },

    _playGlassRattle: function (now) {
      var dest = seGain || masterGain;
      var rattles = 3 + ((Math.random() * 2) | 0);
      for (var ri = 0; ri < rattles; ri++) {
        var offset = ri * (0.08 + Math.random() * 0.04);
        var bufLen = (audioCtx.sampleRate * 0.05) | 0;
        var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        var d = buf.getChannelData(0);
        for (var j = 0; j < bufLen; j++) {
          d[j] = (Math.random() * 2 - 1) * Math.exp(-j / audioCtx.sampleRate * 60);
        }
        var s = audioCtx.createBufferSource();
        s.buffer = buf;
        var hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2000;
        var g = audioCtx.createGain();
        g.gain.value = 0.12;
        s.connect(hp);
        hp.connect(g);
        g.connect(dest);
        s.start(now + offset);
      }
    },

    _playClockTick: function (now) {
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 2000;
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.03);
    },

    _playElevatorHum: function (now) {
      var dest = seGain || masterGain;
      var gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 1);
      gain.gain.setValueAtTime(0.15, now + 3);
      gain.gain.linearRampToValueAtTime(0, now + 4);
      var osc1 = audioCtx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.value = 30;
      osc1.connect(gain);
      var osc2 = audioCtx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 60;
      var g2 = audioCtx.createGain();
      g2.gain.value = 0.5;
      osc2.connect(g2);
      g2.connect(gain);
      gain.connect(dest);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 4.1);
      osc2.stop(now + 4.1);
    },

    _playItemGet: function (now) {
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.35);
      // Octave harmonic
      var osc2 = audioCtx.createOscillator();
      var g2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(800, now);
      osc2.frequency.exponentialRampToValueAtTime(1600, now + 0.2);
      g2.gain.setValueAtTime(0.12, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc2.connect(g2);
      g2.connect(dest);
      osc2.start(now);
      osc2.stop(now + 0.3);
    },

    _playPaper: function (now) {
      var dest = seGain || masterGain;
      var bufLen = (audioCtx.sampleRate * 0.1) | 0;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        var env = Math.sin(t / 0.1 * Math.PI);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 3;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.2;
      src.connect(bp);
      bp.connect(gain);
      gain.connect(dest);
      src.start(now);
    },

    _playKeyUnlock: function (now) {
      var dest = seGain || masterGain;
      // 3 clicks
      for (var ki = 0; ki < 3; ki++) {
        var offset = ki * 0.08;
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 3000;
        g.gain.setValueAtTime(0.2, now + offset);
        g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.01);
        osc.connect(g);
        g.connect(dest);
        osc.start(now + offset);
        osc.stop(now + offset + 0.015);
      }
      // Final clunk
      var clunk = audioCtx.createOscillator();
      var cg = audioCtx.createGain();
      clunk.type = 'sine';
      clunk.frequency.value = 200;
      cg.gain.setValueAtTime(0.3, now + 0.28);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.33);
      clunk.connect(cg);
      cg.connect(dest);
      clunk.start(now + 0.28);
      clunk.stop(now + 0.35);
    },

    // ── S4: Horror stingers and whispers ──

    _playStinger: function (now) {
      var dest = seGain || masterGain;
      for (var si = 0; si < 6; si++) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 200 + Math.random() * 400;
        g.gain.setValueAtTime(0.7, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(g);
        g.connect(dest);
        osc.start(now);
        osc.stop(now + 0.55);
      }
    },

    _playWhisper: function (now) {
      var dest = seGain || masterGain;
      var bufLen = (audioCtx.sampleRate * 2) | 0;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        // Amplitude modulated at 4Hz to simulate syllables
        var am = 0.5 + 0.5 * Math.sin(t * 4 * Math.PI * 2);
        d[i] = (Math.random() * 2 - 1) * am;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800;
      bp.Q.value = 5;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.15;
      src.connect(bp);
      bp.connect(gain);
      gain.connect(dest);
      src.start(now);
      src.stop(now + 2.1);
    },

    _playLullaby: function (now) {
      var dest = seGain || masterGain;
      // C4, E4, G4, E4, C4
      var notes = [261.63, 329.63, 392.00, 329.63, 261.63];
      for (var li = 0; li < notes.length; li++) {
        var offset = li * 0.4;
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = notes[li] * 0.98; // detuned -20 cents approx
        // Vibrato: 5Hz LFO on frequency
        var lfo = audioCtx.createOscillator();
        var lfoG = audioCtx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 5;
        lfoG.gain.value = notes[li] * 0.01;
        lfo.connect(lfoG);
        lfoG.connect(osc.frequency);
        g.gain.setValueAtTime(0.1, now + offset);
        g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.4);
        // Simple delay for reverb effect
        var delay = audioCtx.createDelay();
        delay.delayTime.value = 0.15;
        var delayG = audioCtx.createGain();
        delayG.gain.value = 0.3;
        osc.connect(g);
        g.connect(dest);
        g.connect(delay);
        delay.connect(delayG);
        delayG.connect(dest);
        osc.start(now + offset);
        lfo.start(now + offset);
        osc.stop(now + offset + 0.5);
        lfo.stop(now + offset + 0.5);
      }
    },

    _playTinnitus: function (now) {
      var dest = seGain || masterGain;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 8000;
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.setValueAtTime(0.1, now + 2);
      gain.gain.linearRampToValueAtTime(0, now + 3);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 3.1);
    },

    _playThunder: function (now) {
      var dest = seGain || masterGain;
      var bufLen = (audioCtx.sampleRate * 2) | 0;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2);
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.6;
      src.connect(lp);
      lp.connect(gain);
      gain.connect(dest);
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

    // ── Backrooms ambient loops ──

    _startFluorescentLoop: function () {
      // Iconic Backrooms hum: 60Hz hum + subtle high buzz with random flicker
      var dest = bgmGain || masterGain;
      var hum = audioCtx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 60;
      var humG = audioCtx.createGain();
      humG.gain.value = 0.25;
      hum.connect(humG);
      humG.connect(dest);
      hum.start();

      var hum2 = audioCtx.createOscillator();
      hum2.type = 'sine';
      hum2.frequency.value = 120;
      var hum2G = audioCtx.createGain();
      hum2G.gain.value = 0.12;
      hum2.connect(hum2G);
      hum2G.connect(dest);
      hum2.start();

      // Buzz/hiss
      var bufSize = audioCtx.sampleRate * 2;
      var buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      var bd = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) bd[i] = (Math.random() * 2 - 1) * 0.1;
      var noise = audioCtx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      var bp = audioCtx.createBiquadFilter();
      bp.type = 'highpass';
      bp.frequency.value = 6000;
      var noiseG = audioCtx.createGain();
      noiseG.gain.value = 0.08;
      noise.connect(bp); bp.connect(noiseG); noiseG.connect(dest);
      noise.start();

      // Random flicker LFO (volume dips)
      var flickerInterval = setInterval(function () {
        if (!audioCtx || audioCtx.state !== 'running') return;
        if (Math.random() < 0.2) {
          var t = audioCtx.currentTime;
          humG.gain.setValueAtTime(0.02, t);
          humG.gain.linearRampToValueAtTime(0.10, t + 0.15);
        }
      }, 700);

      return {
        nodes: [hum, hum2, noise],
        gain: humG,
        interval: flickerInterval
      };
    },

    _startPipeDripLoop: function () {
      // Random drips
      var self = this;
      var dripInterval = setInterval(function () {
        if (!audioCtx || audioCtx.state !== 'running') return;
        if (Math.random() < 0.3) {
          var t = audioCtx.currentTime;
          var dest = seGain || masterGain;
          var osc = audioCtx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800 + Math.random() * 400, t);
          osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);
          var g = audioCtx.createGain();
          g.gain.setValueAtTime(0.15, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.connect(g); g.connect(dest);
          osc.start(t); osc.stop(t + 0.25);
        }
      }, 1500);

      // Low pipe hum
      var dest2 = bgmGain || masterGain;
      var pipeHum = audioCtx.createOscillator();
      pipeHum.type = 'triangle';
      pipeHum.frequency.value = 45;
      var pipeG = audioCtx.createGain();
      pipeG.gain.value = 0.18;
      pipeHum.connect(pipeG);
      pipeG.connect(dest2);
      pipeHum.start();

      return { nodes: [pipeHum], gain: pipeG, interval: dripInterval };
    },

    _startElectricLoop: function () {
      var dest = bgmGain || masterGain;
      // Sub bass
      var sub = audioCtx.createOscillator();
      sub.type = 'sawtooth';
      sub.frequency.value = 50;
      var subG = audioCtx.createGain();
      subG.gain.value = 0.08;
      sub.connect(subG);
      subG.connect(dest);
      sub.start();

      // Random sparks / arcs
      var sparkInterval = setInterval(function () {
        if (!audioCtx || audioCtx.state !== 'running') return;
        if (Math.random() < 0.18) {
          var t = audioCtx.currentTime;
          var bufLen = (audioCtx.sampleRate * 0.15) | 0;
          var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
          var d = buf.getChannelData(0);
          for (var i = 0; i < bufLen; i++) {
            var tt = i / audioCtx.sampleRate;
            d[i] = (Math.random() * 2 - 1) * Math.exp(-tt * 40);
          }
          var src = audioCtx.createBufferSource();
          src.buffer = buf;
          var hp = audioCtx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 3000;
          var sg = audioCtx.createGain();
          sg.gain.value = 0.12;
          src.connect(hp); hp.connect(sg); sg.connect(seGain || masterGain);
          src.start(t);
        }
      }, 1200);

      return { nodes: [sub], gain: subG, interval: sparkInterval };
    },

    _startWindLoop: function () {
      var dest = bgmGain || masterGain;
      var bufSize = audioCtx.sampleRate * 4;
      var buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      var bd = buf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) bd[i] = (Math.random() * 2 - 1);
      var noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      var lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      var g = audioCtx.createGain();
      g.gain.value = 0.12;
      noise.connect(lp); lp.connect(g); g.connect(dest);
      noise.start();

      // Slow LFO modulating volume for breathing wind
      var lfo = audioCtx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.15;
      var lfoG = audioCtx.createGain();
      lfoG.gain.value = 0.06;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      lfo.start();

      return { nodes: [noise, lfo], gain: g };
    },

    // ─────────────────────────────────────────────
    // S1: Layered BGM System
    // ─────────────────────────────────────────────
    _bgmLayers: bgmLayerGains,

    setBGMLayers: function (obj) {
      if (obj.drone !== undefined) bgmLayerGains.drone = obj.drone;
      if (obj.dissonance !== undefined) bgmLayerGains.dissonance = obj.dissonance;
      if (obj.melody !== undefined) bgmLayerGains.melody = obj.melody;
      if (obj.pulse !== undefined) bgmLayerGains.pulse = obj.pulse;
      // Apply to live nodes
      if (bgmLayerNodes && audioCtx) {
        var now = audioCtx.currentTime;
        if (bgmLayerNodes.droneGain) bgmLayerNodes.droneGain.gain.setTargetAtTime(bgmLayerGains.drone, now, 0.3);
        if (bgmLayerNodes.dissonanceGain) bgmLayerNodes.dissonanceGain.gain.setTargetAtTime(bgmLayerGains.dissonance, now, 0.3);
        if (bgmLayerNodes.melodyGain) bgmLayerNodes.melodyGain.gain.setTargetAtTime(bgmLayerGains.melody, now, 0.3);
        if (bgmLayerNodes.pulseGain) bgmLayerNodes.pulseGain.gain.setTargetAtTime(bgmLayerGains.pulse, now, 0.3);
      }
    },

    _startLayeredBGM: function () {
      if (!audioCtx) return;
      var dest = bgmGain || masterGain;
      var now = audioCtx.currentTime;
      bgmLayerNodes = {};

      // Drone layer: low sine (35Hz) + triangle (55Hz)
      var droneOsc1 = audioCtx.createOscillator();
      droneOsc1.type = 'sine';
      droneOsc1.frequency.value = 35;
      var droneOsc2 = audioCtx.createOscillator();
      droneOsc2.type = 'triangle';
      droneOsc2.frequency.value = 55;
      var droneG = audioCtx.createGain();
      droneG.gain.value = bgmLayerGains.drone;
      droneOsc1.connect(droneG);
      droneOsc2.connect(droneG);
      droneG.connect(dest);
      droneOsc1.start(now);
      droneOsc2.start(now);
      bgmLayerNodes.droneGain = droneG;
      bgmLayerNodes.droneNodes = [droneOsc1, droneOsc2];

      // Dissonance layer: detuned oscillator pair (220Hz ± 3Hz)
      var disOsc1 = audioCtx.createOscillator();
      disOsc1.type = 'sine';
      disOsc1.frequency.value = 217;
      var disOsc2 = audioCtx.createOscillator();
      disOsc2.type = 'sine';
      disOsc2.frequency.value = 223;
      var disG = audioCtx.createGain();
      disG.gain.value = bgmLayerGains.dissonance;
      disOsc1.connect(disG);
      disOsc2.connect(disG);
      disG.connect(dest);
      disOsc1.start(now);
      disOsc2.start(now);
      bgmLayerNodes.dissonanceGain = disG;
      bgmLayerNodes.dissonanceNodes = [disOsc1, disOsc2];

      // Melody layer: quiet single notes [C3, Eb3, G3, B3] with long gaps
      var melodyG = audioCtx.createGain();
      melodyG.gain.value = bgmLayerGains.melody;
      melodyG.connect(dest);
      bgmLayerNodes.melodyGain = melodyG;
      var melodyNotes = [130.81, 155.56, 196.00, 246.94]; // C3, Eb3, G3, B3
      var self = this;
      bgmMelodyIndex = 0;
      function playNextMelodyNote() {
        if (!bgmLayerNodes) return;
        if (audioCtx.state !== 'running') {
          bgmMelodyTimer = setTimeout(playNextMelodyNote, 2000);
          return;
        }
        var t = audioCtx.currentTime;
        var osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = melodyNotes[bgmMelodyIndex % melodyNotes.length];
        var noteG = audioCtx.createGain();
        noteG.gain.setValueAtTime(0.15, t);
        noteG.gain.exponentialRampToValueAtTime(0.001, t + 3);
        osc.connect(noteG);
        noteG.connect(melodyG);
        osc.start(t);
        osc.stop(t + 3.1);
        bgmMelodyIndex++;
        var gap = 8000 + Math.random() * 4000;
        bgmMelodyTimer = setTimeout(playNextMelodyNote, gap);
      }
      bgmMelodyTimer = setTimeout(playNextMelodyNote, 3000);
      bgmLayerNodes.melodyTimer = bgmMelodyTimer;

      // Pulse layer: rhythmic sine at 60Hz synced to ~90 BPM
      var pulseG = audioCtx.createGain();
      pulseG.gain.value = bgmLayerGains.pulse;
      pulseG.connect(dest);
      bgmLayerNodes.pulseGain = pulseG;
      var pulseInterval = 60000 / 90; // ms per beat
      function playPulseBeat() {
        if (!bgmLayerNodes) return;
        if (audioCtx.state !== 'running') return;
        var t = audioCtx.currentTime;
        var osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 60;
        var pg = audioCtx.createGain();
        pg.gain.setValueAtTime(0.4, t);
        pg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(pg);
        pg.connect(pulseG);
        osc.start(t);
        osc.stop(t + 0.2);
      }
      bgmLayerNodes.pulseInterval = setInterval(playPulseBeat, pulseInterval);
    },

    _stopLayeredBGM: function () {
      if (!bgmLayerNodes) return;
      if (bgmLayerNodes.droneNodes) {
        bgmLayerNodes.droneNodes.forEach(function (n) { try { n.stop(); n.disconnect(); } catch (e) {} });
      }
      if (bgmLayerNodes.dissonanceNodes) {
        bgmLayerNodes.dissonanceNodes.forEach(function (n) { try { n.stop(); n.disconnect(); } catch (e) {} });
      }
      if (bgmLayerNodes.droneGain) try { bgmLayerNodes.droneGain.disconnect(); } catch (e) {}
      if (bgmLayerNodes.dissonanceGain) try { bgmLayerNodes.dissonanceGain.disconnect(); } catch (e) {}
      if (bgmLayerNodes.melodyGain) try { bgmLayerNodes.melodyGain.disconnect(); } catch (e) {}
      if (bgmLayerNodes.pulseGain) try { bgmLayerNodes.pulseGain.disconnect(); } catch (e) {}
      if (bgmLayerNodes.melodyTimer) clearTimeout(bgmLayerNodes.melodyTimer);
      if (bgmMelodyTimer) clearTimeout(bgmMelodyTimer);
      if (bgmLayerNodes.pulseInterval) clearInterval(bgmLayerNodes.pulseInterval);
      bgmLayerNodes = null;
    },

    // ─────────────────────────────────────────────
    // S3: Spatial/Positional Audio
    // ─────────────────────────────────────────────
    playPositionalSound: function (type, wx, wy) {
      if (!audioCtx || audioCtx.state !== 'running') return;
      var dx = wx - playerX;
      var dy = wy - playerY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var maxDist = TILE_SIZE * 10;
      var vol = Math.max(0, 1 - dist / maxDist);
      if (vol <= 0) return;

      // Calculate panning: angle to source relative to player facing
      var angleToSource = Math.atan2(dy, dx);
      var relAngle = angleToSource - playerAngle;
      // Normalize to -PI..PI
      while (relAngle > Math.PI) relAngle -= Math.PI * 2;
      while (relAngle < -Math.PI) relAngle += Math.PI * 2;
      var pan = Math.sin(relAngle); // -1 (left) to 1 (right)

      // Create panner and gain for positional audio
      var panner = audioCtx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      var posGain = audioCtx.createGain();
      posGain.gain.value = vol;

      // Temporarily redirect seGain output through positional nodes
      var origDest = seGain || masterGain;
      // We play the sound with custom routing
      var now = audioCtx.currentTime;
      this._playPositionalSoundInternal(type, now, panner, posGain, origDest);
    },

    _playPositionalSoundInternal: function (type, now, panner, posGain, dest) {
      // Route: sound → posGain → panner → dest
      posGain.connect(panner);
      panner.connect(dest);

      switch (type) {
        case 'footstep': {
          var bufferSize = (audioCtx.sampleRate * 0.05) | 0;
          var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
          var data = buffer.getChannelData(0);
          for (var i = 0; i < bufferSize; i++) {
            var t = i / audioCtx.sampleRate;
            data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.3;
          }
          var src = audioCtx.createBufferSource();
          src.buffer = buffer;
          src.connect(posGain);
          src.start(now);
          break;
        }
        case 'knock': {
          for (var ki = 0; ki < 3; ki++) {
            var offset = ki * 0.12;
            var bufLen = (audioCtx.sampleRate * 0.04) | 0;
            var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
            var d = buf.getChannelData(0);
            for (var j = 0; j < bufLen; j++) {
              var tk = j / audioCtx.sampleRate;
              d[j] = (Math.random() * 2 - 1) * Math.exp(-tk * 120) * 0.6;
            }
            var ks = audioCtx.createBufferSource();
            ks.buffer = buf;
            ks.connect(posGain);
            ks.start(now + offset);
          }
          break;
        }
        default: {
          // For other types, play through positional routing
          // Create a temporary gain to intercept
          var tmpG = audioCtx.createGain();
          tmpG.gain.value = 1;
          tmpG.connect(posGain);
          // Play the regular sound but swap dest
          var savedSeGain = seGain;
          // Simple approach: just play the sound normally via seGain since
          // complex re-routing is error-prone. Apply volume reduction instead.
          this.playSound(type);
          break;
        }
      }
    },

    // ─────────────────────────────────────────────
    // S5: Haruki (enemy) footstep system
    // ─────────────────────────────────────────────
    startEnemyFootsteps: function (interval) {
      this.stopEnemyFootsteps();
      var self = this;
      interval = interval || 600;
      enemyFootstepInterval = setInterval(function () {
        if (!audioCtx || audioCtx.state !== 'running') return;
        self._playEnemyFootstep();
      }, interval);
    },

    stopEnemyFootsteps: function () {
      if (enemyFootstepInterval) {
        clearInterval(enemyFootstepInterval);
        enemyFootstepInterval = null;
      }
    },

    setEnemyFootstepPosition: function (wx, wy) {
      enemyFootstepWX = wx;
      enemyFootstepWY = wy;
    },

    setFootstepSurface: function (type) {
      footstepSurface = type || 'carpet';
    },

    _playEnemyFootstep: function () {
      if (!audioCtx || audioCtx.state !== 'running') return;
      var now = audioCtx.currentTime;

      // Calculate positional audio
      var dx = enemyFootstepWX - playerX;
      var dy = enemyFootstepWY - playerY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var maxDist = TILE_SIZE * 10;
      var vol = Math.max(0, 1 - dist / maxDist);
      if (vol <= 0) return;

      var angleToSource = Math.atan2(dy, dx);
      var relAngle = angleToSource - playerAngle;
      while (relAngle > Math.PI) relAngle -= Math.PI * 2;
      while (relAngle < -Math.PI) relAngle += Math.PI * 2;
      var pan = Math.sin(relAngle);

      var panner = audioCtx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));

      // Heavier footstep: slower attack, lower pitch (40Hz→200Hz noise burst)
      var bufLen = (audioCtx.sampleRate * 0.1) | 0;
      var buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) {
        var t = i / audioCtx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.5;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = buf;

      var gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol * 0.3, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      // Surface filter
      var filter = audioCtx.createBiquadFilter();
      if (footstepSurface === 'carpet') {
        filter.type = 'lowpass';
        filter.frequency.value = 400;
      } else if (footstepSurface === 'metal') {
        filter.type = 'peaking';
        filter.frequency.value = 1000;
        filter.Q.value = 3;
        filter.gain.value = 6;
      } else {
        // tile — no filter, bright
        filter.type = 'allpass';
        filter.frequency.value = 1000;
      }

      src.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(seGain || masterGain);
      src.start(now);
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

      // V6: Film grain — subtle every frame
      if (this.grainIntensity > 0) {
        this._drawGrain(ctx, this.grainIntensity);
      }

      // Red flash — enhanced with noise spike
      if (redFlashAlpha > 0) {
        ctx.fillStyle = 'rgba(180,0,0,' + redFlashAlpha + ')';
        ctx.fillRect(0, 0, this.width, this.height);
        // Chromatic burst during damage
        if (redFlashAlpha > 0.3) {
          this._drawGrain(ctx, redFlashAlpha * 0.5);
        }
      }

      // V6: Dynamic vignette
      if (this.vignetteIntensity > 0) {
        var w = this.width;
        var h = this.height;
        var grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.85);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,' + this.vignetteIntensity + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // V6: Chromatic aberration at edges
      if (this.chromaticLevel > 0) {
        this._drawChromaticAberration(ctx, this.chromaticLevel);
      }

      // V6: Scanlines (subtle)
      this._drawScanlines(ctx);

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

    // V6: Subtle film grain overlay
    _drawGrain: function (ctx, intensity) {
      var sw = staticCanvas.width;
      var sh = staticCanvas.height;
      var id = staticCtx.createImageData(sw, sh);
      var d = id.data;
      var alpha = (intensity * 25) | 0;
      for (var i = 0; i < d.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = alpha;
      }
      staticCtx.putImageData(id, 0, 0);
      ctx.drawImage(staticCanvas, 0, 0, this.width, this.height);
    },

    // V6: Chromatic aberration at screen edges
    _drawChromaticAberration: function (ctx, level) {
      if (level <= 0) return;
      var w = this.width;
      var h = this.height;
      var shift = Math.ceil(level * 3); // 1-3 pixel shift
      var edgeW = Math.min(60, w * 0.1) | 0;
      if (edgeW < 4) return;

      try {
        // Left edge
        var leftData = ctx.getImageData(0, 0, edgeW, h);
        var ld = leftData.data;
        for (var i = 0; i < ld.length; i += 4) {
          var px = ((i / 4) % edgeW) | 0;
          var edgeFactor = 1 - (px / edgeW);
          var redShift = (shift * edgeFactor) | 0;
          if (redShift > 0) {
            var srcIdx = i - redShift * 4;
            if (srcIdx >= 0 && srcIdx < ld.length) {
              ld[i] = ld[srcIdx]; // shift red channel
            }
          }
        }
        ctx.putImageData(leftData, 0, 0);

        // Right edge
        var rightStart = w - edgeW;
        var rightData = ctx.getImageData(rightStart, 0, edgeW, h);
        var rd = rightData.data;
        for (var j = 0; j < rd.length; j += 4) {
          var rpx = ((j / 4) % edgeW) | 0;
          var rEdgeFactor = rpx / edgeW;
          var blueShift = (shift * rEdgeFactor) | 0;
          if (blueShift > 0) {
            var bSrcIdx = j + blueShift * 4 + 2;
            if (bSrcIdx >= 0 && bSrcIdx < rd.length) {
              rd[j + 2] = rd[bSrcIdx]; // shift blue channel
            }
          }
        }
        ctx.putImageData(rightData, rightStart, 0);
      } catch (e) {
        // getImageData may fail in some contexts, silently ignore
      }
    },

    // V6: Subtle scanlines
    _drawScanlines: function (ctx) {
      var h = this.height;
      var w = this.width;
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      for (var sy = 0; sy < h; sy += 4) {
        ctx.fillRect(0, sy, w, 1);
      }
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
