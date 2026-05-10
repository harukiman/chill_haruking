/**
 * GameEngine - 2D Top-Down Horror Game Engine
 * Mobile-first, procedural audio, flashlight darkness system
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
  var activeLoops = {};
  var masterVolume = 0.7;

  // ───────────────────────────────────────────────
  // Joystick state
  // ───────────────────────────────────────────────
  var joystickTouchId = null;
  var joystickCenterX = 0;
  var joystickCenterY = 0;
  var joystickActive = false;
  var lastTapTime = 0;

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
      dx: 0,
      dy: 0,
      action: false,
      actionJustPressed: false,
      sprint: false
    },

    // Images
    images: {},

    // Game loop hooks
    onUpdate: null,
    onRender: null,

    // State
    running: false,
    paused: false,

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
      var ctx = this.ctx;
      var cam = this.camera;
      var m = this.currentMap;
      if (!m) return;

      var halfW = this.width / 2;
      var halfH = this.height / 2;

      // Camera offset with shake
      var ox = halfW - cam.x + shakeOffsetX;
      var oy = halfH - cam.y + shakeOffsetY;

      // Visible tile range (with 1-tile padding)
      var startGX = Math.max(0, Math.floor((cam.x - halfW) / TILE_SIZE) - 1);
      var startGY = Math.max(0, Math.floor((cam.y - halfH) / TILE_SIZE) - 1);
      var endGX = Math.min(m.width - 1, Math.ceil((cam.x + halfW) / TILE_SIZE) + 1);
      var endGY = Math.min(m.height - 1, Math.ceil((cam.y + halfH) / TILE_SIZE) + 1);

      for (var gy = startGY; gy <= endGY; gy++) {
        for (var gx = startGX; gx <= endGX; gx++) {
          var t = m.tiles[gy][gx];
          var sx = gx * TILE_SIZE + ox;
          var sy = gy * TILE_SIZE + oy;

          this._drawTile(ctx, t, sx, sy, gx, gy);
        }
      }
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

      var ctx = this.ctx;
      var cam = this.camera;
      var halfW = this.width / 2;
      var halfH = this.height / 2;

      var ox = halfW - cam.x + shakeOffsetX;
      var oy = halfH - cam.y + shakeOffsetY;

      var sx = entity.x + ox;
      var sy = entity.y + oy;

      // Frustum check
      var margin = Math.max(entity.w || 24, entity.h || 24);
      if (sx < -margin || sx > this.width + margin ||
        sy < -margin || sy > this.height + margin) return;

      var w = entity.w || 20;
      var h = entity.h || 20;
      var color = entity.color || '#aaa';

      if (entity.sprite && this.images[entity.sprite]) {
        var img = this.images[entity.sprite];
        ctx.drawImage(img, sx - w / 2, sy - h / 2, w, h);
      } else {
        // Draw body (rectangle)
        ctx.fillStyle = color;
        ctx.fillRect(sx - w / 4, sy - h / 6, w / 2, h / 2);

        // Draw head (circle)
        ctx.beginPath();
        ctx.arc(sx, sy - h / 3, w / 4, 0, Math.PI * 2);
        ctx.fill();

        // Direction indicator (small triangle)
        if (entity.dir !== undefined) {
          ctx.fillStyle = 'rgba(255,255,200,0.5)';
          ctx.save();
          ctx.translate(sx, sy);

          var angle = 0;
          switch (entity.dir) {
            case 'up': angle = -Math.PI / 2; break;
            case 'down': angle = Math.PI / 2; break;
            case 'left': angle = Math.PI; break;
            case 'right': angle = 0; break;
          }
          ctx.rotate(angle);

          ctx.beginPath();
          ctx.moveTo(w / 2 + 4, 0);
          ctx.lineTo(w / 4, -4);
          ctx.lineTo(w / 4, 4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    },

    // ─────────────────────────────────────────────
    // DARKNESS / FLASHLIGHT SYSTEM
    // ─────────────────────────────────────────────
    drawDarkness: function (px, py, radius, flickerAmount) {
      var ctx = this.ctx;
      var cam = this.camera;
      var halfW = this.width / 2;
      var halfH = this.height / 2;

      var ox = halfW - cam.x + shakeOffsetX;
      var oy = halfH - cam.y + shakeOffsetY;

      var screenX = px + ox;
      var screenY = py + oy;

      // Apply flicker
      var flicker = flickerAmount || 0;
      var actualRadius = radius * (1 - flicker * (Math.random() * 0.3));
      if (actualRadius < 10) actualRadius = 10;

      // Draw darkness overlay with radial gradient cutout
      ctx.save();

      // Create a radial gradient from transparent center to opaque edge
      var gradient = ctx.createRadialGradient(
        screenX, screenY, actualRadius * 0.1,
        screenX, screenY, actualRadius
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.4, 'rgba(0,0,0,0.3)');
      gradient.addColorStop(0.7, 'rgba(0,0,0,0.7)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.97)');

      // Draw the gradient circle on a temporary approach:
      // Fill entire screen with black, then "cut out" the flashlight

      // Method: draw dark overlay with the flashlight hole using compositing
      // First, draw the full darkness
      ctx.fillStyle = 'rgba(0,0,0,0.97)';
      ctx.fillRect(0, 0, this.width, this.height);

      // Now cut out the flashlight area using 'destination-out'
      ctx.globalCompositeOperation = 'destination-out';

      var lightGrad = ctx.createRadialGradient(
        screenX, screenY, 0,
        screenX, screenY, actualRadius
      );
      lightGrad.addColorStop(0, 'rgba(0,0,0,1)');
      lightGrad.addColorStop(0.3, 'rgba(0,0,0,0.9)');
      lightGrad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
      lightGrad.addColorStop(0.85, 'rgba(0,0,0,0.15)');
      lightGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = lightGrad;
      ctx.beginPath();
      ctx.arc(screenX, screenY, actualRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
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
      fadeDuration = duration || 1;
      fadeTimer = 0;
      fadeCb = cb || null;
    },

    fadeFromBlack: function (duration, cb) {
      fading = true;
      fadeAlpha = 1;
      fadeTarget = 0;
      fadeDuration = duration || 1;
      fadeTimer = 0;
      fadeCb = cb || null;
    },

    shakeScreen: function (intensity, duration) {
      shakeIntensity = intensity || 5;
      shakeDuration = duration || 0.3;
      shakeTimer = 0;
    },

    flashImage: function (imgElement, duration, cb) {
      flashImg = imgElement;
      flashDuration = duration || 0.5;
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
      document.addEventListener('touchmove', function (e) {
        e.preventDefault();
      }, { passive: false });

      document.addEventListener('touchstart', function (e) {
        // Initialize audio on first touch (iOS requirement)
        if (!audioInitialized) {
          self.initAudio();
        }
      }, { passive: true });

      // --- Joystick touch handling on canvas ---
      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var touch = e.changedTouches[i];

          // Left half = joystick
          if (touch.clientX < self.width / 2 && joystickTouchId === null) {
            joystickTouchId = touch.identifier;
            joystickCenterX = touch.clientX;
            joystickCenterY = touch.clientY;
            joystickActive = true;

            // Double tap detection for sprint
            var now = performance.now();
            if (now - lastTapTime < 300) {
              self.input.sprint = true;
            }
            lastTapTime = now;
          }
        }

        // Two finger touch = sprint
        if (e.touches.length >= 2) {
          self.input.sprint = true;
        }
      }, { passive: false });

      canvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var touch = e.changedTouches[i];
          if (touch.identifier === joystickTouchId) {
            var rawDx = touch.clientX - joystickCenterX;
            var rawDy = touch.clientY - joystickCenterY;
            var dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);

            // Dead zone
            if (dist < 10) {
              self.input.dx = 0;
              self.input.dy = 0;
            } else {
              var maxDist = 60;
              var norm = Math.min(dist, maxDist) / maxDist;
              self.input.dx = (rawDx / dist) * norm;
              self.input.dy = (rawDy / dist) * norm;
            }
          }
        }
      }, { passive: false });

      canvas.addEventListener('touchend', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var touch = e.changedTouches[i];
          if (touch.identifier === joystickTouchId) {
            joystickTouchId = null;
            joystickActive = false;
            self.input.dx = 0;
            self.input.dy = 0;
            self.input.sprint = false;
          }
        }
        if (e.touches.length < 2) {
          self.input.sprint = false;
        }
      }, { passive: false });

      canvas.addEventListener('touchcancel', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var touch = e.changedTouches[i];
          if (touch.identifier === joystickTouchId) {
            joystickTouchId = null;
            joystickActive = false;
            self.input.dx = 0;
            self.input.dy = 0;
            self.input.sprint = false;
          }
        }
      }, { passive: false });

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
      var dx = 0, dy = 0;
      if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= 1;
      if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 1;
      if (keys['ArrowUp'] || keys['w'] || keys['W']) dy -= 1;
      if (keys['ArrowDown'] || keys['s'] || keys['S']) dy += 1;
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

    // --- Sound implementations ---

    _playFootstep: function (now) {
      var bufferSize = audioCtx.sampleRate * 0.05; // 50ms
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
      gain.connect(masterGain);
      src.start(now);
    },

    _playDoor: function (now) {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.3);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.4);
    },

    _playPhone: function (now) {
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
      gain.connect(masterGain);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.1);
      osc2.stop(now + 1.1);
    },

    _playHeartbeat: function (now) {
      // Two thuds: lub-dub
      for (var i = 0; i < 2; i++) {
        var offset = i * 0.15;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50 - i * 10, now + offset);
        gain.gain.setValueAtTime(0.4, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      }
    },

    _playJumpscare: function (now) {
      // White noise burst
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
      noiseGain.connect(masterGain);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.6);

      // Dissonant chord (stacked minor 2nds)
      var freqs = [200, 212, 224, 237, 450, 477];
      for (var f = 0; f < freqs.length; f++) {
        var osc = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[f];
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.55);
      }
    },

    _playKnock: function (now) {
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
        gain.connect(masterGain);
        src.start(now + offset);
      }
    },

    _playBreath: function (now) {
      var bufferSize = audioCtx.sampleRate * 2;
      var buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        var t = i / audioCtx.sampleRate;
        var envelope = Math.sin(t * Math.PI); // Breathe in-out shape
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
      gain.connect(masterGain);
      src.start(now);
    },

    _playStatic: function (now) {
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
      gain.connect(masterGain);
      src.start(now);
    },

    _playHit: function (now) {
      // Low thud
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.25);

      // Noise burst
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
      g2.connect(masterGain);
      src.start(now);
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
      gain.connect(masterGain);

      osc.start();
      lfo.start();

      return { nodes: [osc, lfo], gain: gain };
    },

    _startHeartbeatLoop: function () {
      var self = this;
      var intervalId = setInterval(function () {
        if (audioCtx && audioCtx.state === 'running') {
          self._playHeartbeat(audioCtx.currentTime);
        }
      }, 800);
      return { interval: intervalId };
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
      gain.connect(masterGain);
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
    }
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

      // Tiles
      engine.drawMap();

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
