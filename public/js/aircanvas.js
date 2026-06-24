// ===================== AirCanvas — Browser Port =====================
// This file ports the original Python (OpenCV + MediaPipe) Air Canvas
// logic to the browser using @mediapipe/hands, drawing onto an HTML5
// <canvas> instead of a cv2 window. The gesture rules are the same:
//   - Index fingertip (landmark 8) position = drawing point
//   - Thumb tip (landmark 4) close to index tip (vertical gap < threshold)
//        => start a NEW stroke segment (like lifting the pen)
//   - Fingertip inside the top toolbar band => pick a color / clear
//   - Otherwise => append point to the currently selected color's stroke
// =======================================================================

const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');

// ---- Color state (mirrors colors[] / colorIndex in the Python script) ----
const COLORS = {
  blue:   '#3aa0ff',
  green:  '#37e08a',
  red:    '#ff4d5e',
  yellow: '#ffd23a',
};
let currentColor = 'blue';

// ---- Stroke storage (mirrors bpoints/gpoints/rpoints/ypoints deques) ----
// strokes[color] is an array of "segments"; each segment is an array of {x,y}
const strokes = {
  blue: [[]],
  green: [[]],
  red: [[]],
  yellow: [[]],
};

// Toolbar geometry (scaled to canvas width/height at draw time)
const TOOLBAR_Y = 65;          // px from top, same idea as Python's y<=65 band
const PINCH_THRESHOLD = 0.045; // normalized distance for "pinch = new stroke"
const PINCH_DEBOUNCE_FRAMES = 4;  // must stay pinched this many frames before it counts (kills false triggers from jitter)
const PINCH_COOLDOWN_FRAMES = 10; // frames to ignore re-pinch right after one fires (no rapid-fire segment breaks)
const SMOOTHING_ALPHA = 0.5;      // 0=no smoothing, 1=very smooth/laggy. Reduces jitter-induced breaks.
const MAX_JUMP_PX = 36;           // if a point lands further than this from the last one, interpolate steps in between
let smoothedPt = null;
let pinchStreak = 0;
let cooldown = 0;
let penDownStreak = 0;
let penUpStreak = 0;
let penIsDown = false;
const PEN_STATE_DEBOUNCE_FRAMES = 3; // frames needed to flip pen up/down, avoids flicker

function setActiveSwatch(color) {
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

function clearCanvas() {
  Object.keys(strokes).forEach(c => (strokes[c] = [[]]));
}

// Manual swatch clicks (mouse) still work, same as on-screen buttons in Python UI
document.querySelectorAll('.swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = btn.dataset.color;
    if (c === 'clear') {
      clearCanvas();
      return;
    }
    currentColor = c;
    setActiveSwatch(c);
  });
});

document.getElementById('resetBtn').addEventListener('click', clearCanvas);
document.getElementById('downloadBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `aircanvas-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ---- Camera + MediaPipe Hands setup ----
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

hands.onResults((results) => {
  resizeCanvasToVideo();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawToolbar();

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const lm = results.multiHandLandmarks[0];

    // Convert normalized landmarks to canvas pixel space.
    // NOTE: the video is CSS-mirrored (scaleX(-1)) only when using a
    // FRONT-facing camera, so it feels natural (move hand right, see it
    // move right). A rear camera is NOT mirrored. `isMirrored` is kept
    // in sync with which camera is active (see start()/flip button),
    // and we flip x here to match whatever the user visually sees —
    // same idea as cv2.flip(frame, 1) in the original Python script.
    const toPx = (point) => ({
      x: isMirrored ? (1 - point.x) * canvas.width : point.x * canvas.width,
      y: point.y * canvas.height,
    });

    const rawIndexTip = toPx(lm[8]);

    // --- Smoothing: exponential moving average kills jitter that was
    // causing both false pinch triggers and shaky/broken-looking lines.
    if (!smoothedPt) {
      smoothedPt = rawIndexTip;
    } else {
      smoothedPt = {
        x: smoothedPt.x + SMOOTHING_ALPHA * (rawIndexTip.x - smoothedPt.x),
        y: smoothedPt.y + SMOOTHING_ALPHA * (rawIndexTip.y - smoothedPt.y),
      };
    }
    const indexTip = smoothedPt;

    // --- Pen up/down gesture: index finger extended + middle finger
    // CURLED = pen down (draw). Index + middle BOTH extended ("peace
    // sign") = pen up (move freely, nothing gets drawn). This is what
    // lets you stop writing or reposition without dragging a line.
    // Landmark y grows downward, so "extended" means tip is above its
    // own knuckle (pip) in image space.
    const indexExtended = lm[8].y < lm[6].y;
    const middleExtended = lm[12].y < lm[10].y;
    const wantsPenDown = indexExtended && !middleExtended;

    if (wantsPenDown) {
      penDownStreak++;
      penUpStreak = 0;
    } else {
      penUpStreak++;
      penDownStreak = 0;
    }

    if (!penIsDown && penDownStreak >= PEN_STATE_DEBOUNCE_FRAMES) {
      penIsDown = true;
      strokes[currentColor].push([]); // fresh segment whenever pen comes back down
    } else if (penIsDown && penUpStreak >= PEN_STATE_DEBOUNCE_FRAMES) {
      penIsDown = false;
    }

    drawLandmarkDot(indexTip, penIsDown);

    // Pinch distance (normalized space, so use raw lm coords, not pixels)
    const dx = lm[8].x - lm[4].x;
    const dy = lm[8].y - lm[4].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const isPinchRaw = dist < PINCH_THRESHOLD;

    // --- Debounce: only treat it as a real pinch after several
    // consecutive frames, and only allow one trigger, then a cooldown.
    // Pinch still works as an explicit "start a new stroke right here"
    // shortcut, on top of the pen up/down gesture above.
    if (cooldown > 0) cooldown--;
    if (isPinchRaw) pinchStreak++; else pinchStreak = 0;
    const pinchFires = pinchStreak === PINCH_DEBOUNCE_FRAMES && cooldown === 0;

    if (pinchFires) {
      strokes[currentColor].push([]);
      cooldown = PINCH_COOLDOWN_FRAMES;
    } else if (indexTip.y <= TOOLBAR_Y) {
      handleToolbarHover(indexTip.x);
    } else if (penIsDown && pinchStreak === 0) {
      // Only draw when the pen is "down" AND we're confidently not mid-pinch.
      const segs = strokes[currentColor];
      const seg = segs[segs.length - 1];
      const last = seg[seg.length - 1];

      if (last) {
        const jump = Math.hypot(indexTip.x - last.x, indexTip.y - last.y);
        if (jump > MAX_JUMP_PX) {
          // --- Gap interpolation: bridge fast-motion jumps so the
          // line doesn't visually "break" when tracking drops a frame
          // or the finger moves faster than the camera frame rate.
          const steps = Math.ceil(jump / MAX_JUMP_PX);
          for (let s = 1; s <= steps; s++) {
            seg.push({
              x: last.x + ((indexTip.x - last.x) * s) / steps,
              y: last.y + ((indexTip.y - last.y) * s) / steps,
            });
          }
        } else {
          seg.push({ x: indexTip.x, y: indexTip.y });
        }
      } else {
        seg.push({ x: indexTip.x, y: indexTip.y });
      }
    }
  } else {
    // Hand lost for a frame (occlusion, edge of view, motion blur).
    // Reset smoothing/streak state but DO NOT start a new segment —
    // this is the other common cause of "broken" lines: previously,
    // losing tracking for one frame and regaining it elsewhere caused
    // a visible jump with no continuity. Now we just wait; the stroke
    // resumes cleanly once the hand is found again.
    smoothedPt = null;
    pinchStreak = 0;
    penDownStreak = 0;
    penUpStreak = 0;
    penIsDown = false;
  }

  drawAllStrokes();
});

function drawLandmarkDot(pt, penIsDownNow) {
  const color = penIsDownNow ? 'rgba(80,255,140,0.95)' : 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, penIsDownNow ? 7 : 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = penIsDownNow ? 14 : 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawAllStrokes() {
  Object.entries(strokes).forEach(([color, segments]) => {
    ctx.strokeStyle = COLORS[color];
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = COLORS[color];
    ctx.shadowBlur = 8;
    segments.forEach((seg) => {
      if (seg.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
      ctx.stroke();
    });
  });
  ctx.shadowBlur = 0;
}

// Toolbar zones mirror the Python rectangle coordinates, scaled to canvas width
function toolbarZones(width) {
  const scale = width / 636; // original Python frame width reference
  return [
    { name: 'clear', x1: 40 * scale, x2: 140 * scale },
    { name: 'blue', x1: 160 * scale, x2: 255 * scale },
    { name: 'green', x1: 275 * scale, x2: 370 * scale },
    { name: 'red', x1: 390 * scale, x2: 485 * scale },
    { name: 'yellow', x1: 505 * scale, x2: 600 * scale },
  ];
}

function handleToolbarHover(xPx) {
  const zones = toolbarZones(canvas.width);
  for (const zone of zones) {
    if (xPx >= zone.x1 && xPx <= zone.x2) {
      if (zone.name === 'clear') {
        clearCanvas();
      } else {
        currentColor = zone.name;
        setActiveSwatch(zone.name);
      }
      break;
    }
  }
}

function drawToolbar() {
  const zones = toolbarZones(canvas.width);
  const labels = { clear: 'CLEAR', blue: 'BLUE', green: 'GREEN', red: 'RED', yellow: 'YELLOW' };
  const colorMap = { clear: 'rgba(255,255,255,0.6)', ...COLORS };

  zones.forEach((zone) => {
    const w = zone.x2 - zone.x1;
    ctx.fillStyle = 'rgba(10,10,14,0.55)';
    roundRect(ctx, zone.x1, 6, w, 50, 10);
    ctx.fill();
    ctx.strokeStyle = currentColor === zone.name ? '#fff' : colorMap[zone.name];
    ctx.lineWidth = currentColor === zone.name ? 2.5 : 1.5;
    roundRect(ctx, zone.x1, 6, w, 50, 10);
    ctx.stroke();

    ctx.font = '600 12px Manrope, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(labels[zone.name], zone.x1 + w / 2, 36);
  });
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function resizeCanvasToVideo() {
  if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

// ---- Camera bootstrap (with front/back camera support for mobile) ----
let currentStream = null;
let currentFacingMode = 'user'; // 'user' = front/selfie camera, 'environment' = rear camera
let isMirrored = true;          // only mirror visually + in coordinate math for the front camera
let mediapipeCamera = null;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function applyMirrorState() {
  isMirrored = currentFacingMode === 'user';
  video.classList.toggle('mirrored', isMirrored);
}

async function openCamera(facingMode) {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }
  // Mobile gets a portrait-friendly ideal resolution; desktop stays widescreen.
  const constraints = {
    video: {
      facingMode,
      width: { ideal: isMobile ? 720 : 1280 },
      height: { ideal: isMobile ? 1280 : 720 },
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  currentStream = stream;
  currentFacingMode = facingMode;
  applyMirrorState();
  video.srcObject = stream;
  await video.play();
  // Canvas dimensions depend on the new stream's actual resolution.
  canvas.width = 0; // force resizeCanvasToVideo() to re-sync on next frame
}

document.getElementById('flipCameraBtn').addEventListener('click', async () => {
  const next = currentFacingMode === 'user' ? 'environment' : 'user';
  try {
    await openCamera(next);
  } catch (err) {
    // Some devices (most laptops) only have one camera — fail quietly.
    console.warn('Could not switch camera:', err);
    statusText.textContent = 'Only one camera available on this device';
    setTimeout(() => { statusText.textContent = 'Tracking live'; }, 2500);
  }
});

async function start() {
  try {
    // Default: front camera on phones/laptops alike (you gesture toward
    // the screen you're looking at). Use the Flip Camera button to switch.
    await openCamera(currentFacingMode);

    statusText.textContent = 'Tracking live';
    statusPill.classList.add('ready');

    mediapipeCamera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: isMobile ? 720 : 1280,
      height: isMobile ? 1280 : 720,
    });
    mediapipeCamera.start();
  } catch (err) {
    statusText.textContent = 'Camera access denied or unavailable';
    console.error(err);
  }
}

// Re-sync canvas size on rotation/resize so drawing coordinates stay aligned.
window.addEventListener('orientationchange', () => { canvas.width = 0; });
window.addEventListener('resize', () => { canvas.width = 0; });


start();
