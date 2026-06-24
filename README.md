
# AirCanvas — Web Edition

A browser-based hand-gesture drawing app, ported from your Python
(OpenCV + MediaPipe) Air Canvas script into an Express + EJS website
with a cinematic dark UI.


## Features

- Real-time hand-tracking drawing in the browser (no installs for the user)
- 4-color palette + clear, selectable by hovering a fingertip over the toolbar
- Pinch gesture (thumb + index) to start a new stroke without lifting your hand
- Jitter smoothing + debounced gestures so lines don't randomly break
- Gap interpolation so fast finger motion doesn't leave visible skips
- Save your drawing as a PNG
- Cinematic dark UI (film grain, vignette, glow accents)

## Tech stack

- **Backend**: Node.js, Express, EJS
- **Computer vision**: MediaPipe Hands (WASM, runs client-side)
- **Rendering**: HTML5 Canvas 2D API
- **Styling**: hand-written CSS (no framework)

## Troubleshooting: line breaking / jumpy lines

If lines still occasionally break or look choppy, it's almost always one of:

1. **Lighting** — MediaPipe's hand model loses confidence in low light, which
   causes tracking dropouts. Brighter, even lighting fixes most of it.
2. **Distance from camera** — keep your hand roughly 30–70cm from the webcam.
   Too close or too far reduces landmark accuracy.
3. **Sensitivity tuning** — in `public/js/aircanvas.js` you can adjust:
   - `SMOOTHING_ALPHA` (lower = smoother but more lag)
   - `PINCH_DEBOUNCE_FRAMES` (higher = harder to accidentally trigger a new stroke)
   - `MAX_JUMP_PX` (higher = more tolerant of fast motion before interpolating)
4. **Frame rate** — low-end devices/CPUs may drop frames under MediaPipe's
   load; closing other tabs/apps usually helps.



```
air-canvas-web/
├── server.js                 # Express app (2 routes: / and /canvas)
├── package.json
├── views/
│   ├── index.ejs             # Cinematic landing page
│   └── canvas.ejs            # The actual Air Canvas studio page
└── public/
    ├── css/style.css         # Dark, cinematic, glow-accented theme
    └── js/aircanvas.js       # Hand tracking + drawing logic (the "port")
```

## How the Python logic maps to the JS port

| Python (OpenCV) concept                          | Web (JS) equivalent                                  |
|----------------------------------------------------|-------------------------------------------------------|
| `cv2.VideoCapture(0)` + while-loop                 | `getUserMedia()` + MediaPipe `Camera` frame loop      |
| `mp.solutions.hands.Hands(...)`                    | `new Hands({...})` from `@mediapipe/hands`            |
| `landmarks[8]` (index fingertip)                   | `lm[8]` from `results.multiHandLandmarks[0]`          |
| `landmarks[4]` (thumb tip)                          | `lm[4]`                                                |
| `thumb[1]-fore_finger[1] < 30` → new deque          | normalized pinch distance < `PINCH_THRESHOLD` → new stroke segment |
| `fore_finger[1] <= 65` → toolbar row                | `indexTip.y <= TOOLBAR_Y` → toolbar row                |
| `bpoints/gpoints/rpoints/ypoints` deques            | `strokes = { blue: [[...]], green: [...], ... }`       |
| `cv2.rectangle` toolbar buttons                     | `drawToolbar()` draws rounded rects on `<canvas>`       |
| `cv2.line(...)` per point pair                      | `ctx.lineTo()` per point in each stroke segment         |
| `paintWindow` (separate canvas window)              | Save button → `canvas.toDataURL('image/png')` download |

The gesture rules are intentionally kept the same as your script so the
"feel" of drawing is identical — only the rendering target changed from
an OpenCV window to a browser `<canvas>`.



## How to run it

1. **Unzip** the project and open a terminal in the folder.
2. **Install dependencies** (Node.js 18+ required):
   ```bash
   npm install
   ```
3. **Start the server**:
   ```bash
   npm start
   ```
4. Open your browser at:
   ```
   http://localhost:3000
   ```
5. Click **"Launch Air Canvas"**, allow camera access when prompted, and
   raise your index finger to draw. Pinch thumb + index to start a new
   stroke segment. Hover your finger over a toolbar swatch (top of the
   video) to change color or clear the canvas.

> Optional: for auto-restart during development, run `npm run dev`
> (uses `nodemon`, included in devDependencies).

## Mobile support

- Default camera is front-facing (`facingMode: 'user'`); tap **Flip Camera**
  to switch to the rear camera (only shown as an option if the device has
  more than one — phones will, most laptops won't).
- The camera stage automatically uses a taller (3:4) aspect ratio on small
  portrait screens, and a wider (4:3) one in landscape, instead of a fixed
  desktop-style widescreen frame.
- Touch targets (color swatches, buttons) are sized to at least 44–48px,
  the standard comfortable minimum for finger taps.
- `touch-action: none` on the camera stage stops the browser from trying
  to interpret pinch/scroll gestures over the video while you're using
  pinch-to-draw.
- Works on iOS Safari and Android Chrome, but performance (frame rate of
  hand tracking) varies more by device than on desktop — older phones may
  feel laggier since MediaPipe's WASM model runs on the CPU/GPU you have.



- Chrome, Edge, or any modern Chromium-based browser works best (MediaPipe's
  WASM hand-tracking model is well-optimized there).
- Must be served over `http://localhost` or `https://` — browsers block
  camera access (`getUserMedia`) on plain HTTP from a non-localhost domain.
- If deploying publicly, you'll need HTTPS (e.g. via a reverse proxy like
  Nginx + Let's Encrypt, or a host that provides HTTPS automatically).

## Customizing

- **Colors**: edit `COLORS` in `public/js/aircanvas.js` and the matching
  `--c` CSS variables on the swatch buttons in `views/canvas.ejs`.
- **Gesture sensitivity**: tweak `PINCH_THRESHOLD` in `aircanvas.js`.
- **Theme**: all visual styling lives in `public/css/style.css`.
# AIRCANVAS
AIR Canvas is a computer vision-based application that allows users to draw and write in the air without touching a physical surface
 54503d0c6460d135e58391b42cfb2e52662e1bd8
