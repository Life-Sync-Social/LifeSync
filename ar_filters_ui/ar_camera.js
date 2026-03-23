/*  ar_camera.js  –  AR Camera with facial-landmark-driven image overlay  */

// ── Auth guard ──────────────────────────────────────────────────────────
const isLoggedIn = sessionStorage.getItem('isLoggedIn');
if (!isLoggedIn) {
    // window.location.href = '../login_signup/login.html';
}

// ── DOM refs ────────────────────────────────────────────────────────────
const videoEl         = document.getElementById('video');
const videoContainer  = document.querySelector('.video-container');
const landmarkCanvas  = document.getElementById('landmarkCanvas');
const arOverlay       = document.getElementById('arOverlay');
const offscreen       = document.getElementById('offscreenCanvas');
const startBtn        = document.getElementById('startBtn');
const captureBtn      = document.getElementById('captureBtn');
const switchBtn       = document.getElementById('switchBtn');
const toggleLMBtn     = document.getElementById('toggleLandmarksBtn');
const stopBtn         = document.getElementById('stopBtn');
const statusBanner    = document.getElementById('status');
const arSourcePreview = document.getElementById('arSourcePreview');
const capturePreview  = document.getElementById('capturePreview');

const landmarkCtx = landmarkCanvas.getContext('2d');
const arCtx       = arOverlay.getContext('2d');
const offCtx      = offscreen.getContext('2d');

// ── MediaPipe CDN paths ─────────────────────────────────────────────────
const TASKS_VISION_URL   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_PATH          = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FALLBACK_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

// ── State ───────────────────────────────────────────────────────────────
let stream             = null;
let facingMode         = 'user';
let faceLandmarker     = null;
let animFrameId        = null;
let lastVideoTime      = -1;
let showLandmarks      = true;
let photoCount         = 0;
let arImage            = null;
let FaceLandmarkerCls  = null;
let FilesetResolverCls = null;

// ── Helpers ─────────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
    statusBanner.textContent = msg;
    statusBanner.classList.remove('info', 'success', 'error');
    statusBanner.classList.add(type);
}

function setControls(running) {
    startBtn.disabled    = running;
    captureBtn.disabled  = !running;
    switchBtn.disabled   = !running;
    toggleLMBtn.disabled = !running;
    stopBtn.disabled     = !running;
}

function updateMirror() {
    videoContainer.classList.toggle('mirror', facingMode === 'user');
}

// ── getUserMedia polyfill ───────────────────────────────────────────────
function getGetUserMedia() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        return (c) => navigator.mediaDevices.getUserMedia(c);
    }
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia ||
                   navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (legacy) {
        return (c) => new Promise((ok, fail) => legacy.call(navigator, c, ok, fail));
    }
    return null;
}

// ── Load AR source image + mask-shaped rotatable 3D preview ─────────────
function loadArImage() {
    const dataUrl = sessionStorage.getItem('arGeneratedImage');
    if (!dataUrl) {
        arSourcePreview.innerHTML = '<div class="preview-placeholder">No AR image. Generate one in Picture Generator first.</div>';
        return;
    }
    const img = new Image();
    img.onload = () => {
        arImage = img;
        arSourcePreview.innerHTML = '';
        buildRotatablePreview(dataUrl);
        setStatus('AR image loaded. Start the camera to begin.', 'success');
    };
    img.onerror = () => {
        arSourcePreview.innerHTML = '<div class="preview-placeholder">Failed to load AR image.</div>';
    };
    img.src = dataUrl;
}

function buildRotatablePreview(dataUrl) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ar-rotate-wrapper';

    const scene = document.createElement('div');
    scene.className = 'ar-rotate-scene';

    const card = document.createElement('div');
    card.className = 'ar-rotate-card';

    // Front face -- mask-shaped via clip-path
    const front = document.createElement('div');
    front.className = 'ar-rotate-face ar-rotate-front';
    const imgEl = document.createElement('img');
    imgEl.src = dataUrl;
    imgEl.alt = 'AR filter preview';
    imgEl.draggable = false;
    front.appendChild(imgEl);

    // Back face
    const back = document.createElement('div');
    back.className = 'ar-rotate-face ar-rotate-back';
    const imgBack = document.createElement('img');
    imgBack.src = dataUrl;
    imgBack.alt = 'AR filter back';
    imgBack.draggable = false;
    back.appendChild(imgBack);

    card.appendChild(front);
    card.appendChild(back);
    scene.appendChild(card);

    const hint = document.createElement('div');
    hint.className = 'ar-rotate-hint';
    hint.textContent = 'Drag to rotate';

    wrapper.appendChild(scene);
    wrapper.appendChild(hint);
    arSourcePreview.appendChild(wrapper);

    // Drag / touch rotation
    const MAX_DEG = 20;
    let isDragging = false, startX = 0, currentDeg = 0;

    function applyRotation(deg) {
        currentDeg = Math.max(-MAX_DEG, Math.min(MAX_DEG, deg));
        card.style.transform = 'rotateY(' + currentDeg + 'deg)';
    }

    scene.addEventListener('mousedown', (e) => { isDragging = true; startX = e.clientX - currentDeg; scene.style.cursor = 'grabbing'; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (isDragging) applyRotation(e.clientX - startX); });
    window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; scene.style.cursor = 'grab'; } });
    scene.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { isDragging = true; startX = e.touches[0].clientX - currentDeg; e.preventDefault(); } }, { passive: false });
    scene.addEventListener('touchmove', (e) => { if (isDragging && e.touches.length === 1) { applyRotation(e.touches[0].clientX - startX); e.preventDefault(); } }, { passive: false });
    scene.addEventListener('touchend', () => { isDragging = false; });

    applyRotation(0);
}

// ── Load MediaPipe Vision API ───────────────────────────────────────────
async function ensureVisionApi() {
    if (FaceLandmarkerCls && FilesetResolverCls) return;
    setStatus('Loading MediaPipe module...');
    const vision = await import(TASKS_VISION_URL);
    const mod = vision.default ?? vision;
    FaceLandmarkerCls  = mod.FaceLandmarker  ?? vision.FaceLandmarker  ?? null;
    FilesetResolverCls = mod.FilesetResolver ?? vision.FilesetResolver ?? null;
    if (!FaceLandmarkerCls || !FilesetResolverCls) throw new Error('MediaPipe missing FaceLandmarker or FilesetResolver');
}

async function ensureFaceLandmarker() {
    if (faceLandmarker) return faceLandmarker;
    await ensureVisionApi();
    setStatus('Loading face landmark model...');
    const fileset  = await FilesetResolverCls.forVisionTasks(WASM_PATH);
    const response = await fetch(FALLBACK_MODEL_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('Model fetch failed (' + response.status + ')');
    const buf = new Uint8Array(await response.arrayBuffer());
    faceLandmarker = await FaceLandmarkerCls.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: buf },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });
    setStatus('Face landmark model ready.', 'success');
    return faceLandmarker;
}

// ── Canvas sizing ───────────────────────────────────────────────────────
function syncCanvasSize(canvas) {
    const rect = videoContainer.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
    }
    return { w, h };
}

// ── Drawing: Landmark dots ──────────────────────────────────────────────
function drawLandmarkDots(landmarks, displayW, displayH) {
    landmarkCtx.clearRect(0, 0, displayW, displayH);
    if (!showLandmarks || !landmarks.length) return;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.max(displayW / vw, displayH / vh);
    const rw = vw * scale;
    const rh = vh * scale;
    const ox = (displayW - rw) / 2;
    const oy = (displayH - rh) / 2;

    landmarkCtx.fillStyle = 'rgba(53, 223, 164, 0.85)';
    const r = Math.max(1.2, Math.min(2.5, displayW / 400));

    for (const face of landmarks) {
        for (const pt of face) {
            landmarkCtx.beginPath();
            landmarkCtx.arc(pt.x * rw + ox, pt.y * rh + oy, r, 0, Math.PI * 2);
            landmarkCtx.fill();
        }
    }
}

// ── AR overlay: landmark-anchored mesh with expression reactivity ────────
// Uses a dense grid of face landmarks that respond to expressions
// (mouth open, smile, eye blink, eyebrow raise). UV coordinates are
// fixed (canonical) so the mask stays stable during head rotation.
// Temporal smoothing (EMA) prevents jitter.

// 11 columns x 15 rows grid of landmark indices
// Symmetric: right-side face → center → left-side face
// Includes expression-reactive landmarks (eyes, mouth, eyebrows)
const FACE_GRID = [
    // row 0: above forehead (outer boundary)
    [251, 298, 332, 297,  10,  67, 103,  54,  21],
    // row 1: forehead hairline
    [301, 283, 282, 295,  10, 65,  52,  53, 71],
    // row 2: upper forehead
    [389, 368, 336,   9, 151, 107, 139, 127, 162],
    // row 3: mid forehead
    [356, 264, 334, 333, 168, 104, 105,  34, 127],
    // row 4: brow line (expression-reactive: eyebrow raise)
    [454, 353, 276, 283, 168,  53,  46, 124, 234],
    // row 5: upper eyes (expression-reactive: blink/squint)
    [447, 380, 386, 259,   6,  29, 159, 153, 227],
    // row 6: lower eyes / upper cheek
    [366, 382, 362, 370,   4, 141, 133, 155, 137],
    // row 7: mid cheek / nose
    [361, 352, 282, 275,   4,  45,  52, 123, 132],
    // row 8: lower cheek / nostrils
    [435, 416, 326, 327,   2,  98,  97, 192, 215],
    // row 9: upper lip (expression-reactive: smile/mouth)
    [288, 411, 310, 312,  13,  82,  80, 187,  58],
    // row 10: mouth opening (expression-reactive: open/close)
    [375, 321, 405, 314,  17,  84, 181,  91, 146],
    // row 11: lower lip (expression-reactive)
    [291, 377, 403, 318,   0,  88, 179, 148,  61],
    // row 12: chin upper
    [397, 425, 307, 375, 152, 146, 78, 205, 172],
    // row 13: chin
    [365, 378, 400, 369, 152, 140, 176, 149, 136],
    // row 14: below chin (outer boundary)
    [435, 401, 396, 369, 152, 140, 172, 177, 215],
];

const G_ROWS = FACE_GRID.length;
const G_COLS = FACE_GRID[0].length;

// ── Canonical UV grid ───────────────────────────────────────────────────
// Fixed texture coordinates for each grid vertex.
// These never change regardless of head pose, so the mask texture
// stays stable when the face turns, tilts, or changes expression.
// UV range: [0,1] mapped to [0, imgW] and [0, imgH] at draw time.
const CANONICAL_UV = (function () {
    const uvs = [];
    for (let r = 0; r < G_ROWS; r++) {
        uvs[r] = [];
        const v = r / (G_ROWS - 1);
        for (let c = 0; c < G_COLS; c++) {
            // Slightly curved horizontal distribution to match face oval
            const t = c / (G_COLS - 1);  // 0 → 1 across columns
            // Apply subtle oval warp: center columns are wider, edges compress
            const centerDist = Math.abs(t - 0.5) * 2;  // 0 at center, 1 at edge
            const ovalFactor = 1 - 0.12 * (1 - centerDist * centerDist);
            const u = 0.5 + (t - 0.5) * ovalFactor / 0.5 * 0.5;
            uvs[r][c] = { u: Math.max(0, Math.min(1, u)), v };
        }
    }
    return uvs;
})();

// ── Edge expansion per row ──────────────────────────────────────────────
// Instead of uniform expansion, we expand more at forehead/chin (taller)
// and less at cheeks (face is narrower there).
const ROW_EXPAND = [
    0.30, // row 0:  above forehead – push up/out
    0.22, // row 1:  hairline
    0.15, // row 2:  upper forehead
    0.10, // row 3:  mid forehead
    0.08, // row 4:  brow line
    0.05, // row 5:  eyes
    0.05, // row 6:  lower eyes
    0.06, // row 7:  mid cheek
    0.08, // row 8:  lower cheek
    0.06, // row 9:  upper lip
    0.04, // row 10: mouth
    0.06, // row 11: lower lip
    0.10, // row 12: chin upper
    0.18, // row 13: chin
    0.28, // row 14: below chin – push down/out
];

// ── Temporal smoothing (EMA) ────────────────────────────────────────────
const SMOOTH_ALPHA = 0.45;  // lower = smoother but more lag (0.3–0.6 is good)
let prevSmoothedPts = null;

function smoothPoints(pts) {
    if (!prevSmoothedPts || prevSmoothedPts.length !== pts.length ||
        prevSmoothedPts[0].length !== pts[0].length) {
        // First frame or grid size changed – no smoothing
        prevSmoothedPts = pts.map(row => row.map(p => ({ x: p.x, y: p.y })));
        return prevSmoothedPts;
    }
    const out = [];
    for (let r = 0; r < pts.length; r++) {
        out[r] = [];
        for (let c = 0; c < pts[r].length; c++) {
            out[r][c] = {
                x: prevSmoothedPts[r][c].x + SMOOTH_ALPHA * (pts[r][c].x - prevSmoothedPts[r][c].x),
                y: prevSmoothedPts[r][c].y + SMOOTH_ALPHA * (pts[r][c].y - prevSmoothedPts[r][c].y),
            };
        }
    }
    prevSmoothedPts = out;
    return out;
}

function drawArOverlay(landmarks, displayW, displayH) {
    arCtx.clearRect(0, 0, displayW, displayH);
    if (!arImage || !landmarks.length) return;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;

    const vscale = Math.max(displayW / vw, displayH / vh);
    const rw = vw * vscale;
    const rh = vh * vscale;
    const ox = (displayW - rw) / 2;
    const oy = (displayH - rh) / 2;

    const isMirror = facingMode === 'user';
    const face = landmarks[0];
    const imgW = arImage.naturalWidth || arImage.width;
    const imgH = arImage.naturalHeight || arImage.height;

    // Build raw screen positions from landmarks
    const rawPts = [];
    for (let r = 0; r < G_ROWS; r++) {
        rawPts[r] = [];
        for (let c = 0; c < G_COLS; c++) {
            const lm = face[FACE_GRID[r][c]];
            let x, y;
            if (!lm) {
                x = displayW / 2; y = displayH / 2;
            } else {
                x = lm.x * rw + ox;
                y = lm.y * rh + oy;
            }
            // Apply mirror for selfie camera
            rawPts[r][c] = { x: isMirror ? displayW - x : x, y };
        }
    }

    // Compute face centroid for contour-aware expansion
    let sumX = 0, sumY = 0, cnt = 0;
    for (let r = 0; r < G_ROWS; r++) {
        for (let c = 0; c < G_COLS; c++) {
            sumX += rawPts[r][c].x;
            sumY += rawPts[r][c].y;
            cnt++;
        }
    }
    const cx = sumX / cnt;
    const cy = sumY / cnt;

    // Contour-aware expansion: each row gets its own expansion factor,
    // and edge columns expand more than center columns
    const expandedPts = [];
    for (let r = 0; r < G_ROWS; r++) {
        expandedPts[r] = [];
        const rowExp = ROW_EXPAND[r] || 0.10;
        for (let c = 0; c < G_COLS; c++) {
            const p = rawPts[r][c];
            // Edge columns get full expansion; center columns get minimal
            const colNorm = c / (G_COLS - 1);        // 0 → 1
            const edgeness = 1 - 2 * Math.abs(colNorm - 0.5);  // 0 at edges, 1 at center
            const colScale = 1 - edgeness * 0.6;     // edges=1.0, center=0.4
            const exp = rowExp * colScale;
            expandedPts[r][c] = {
                x: cx + (p.x - cx) * (1 + exp),
                y: cy + (p.y - cy) * (1 + exp),
            };
        }
    }

    // Apply temporal smoothing to reduce jitter
    const smoothed = smoothPoints(expandedPts);

    // Compute UV from canonical (fixed) coordinates
    const uvs = [];
    for (let r = 0; r < G_ROWS; r++) {
        uvs[r] = [];
        for (let c = 0; c < G_COLS; c++) {
            uvs[r][c] = {
                u: CANONICAL_UV[r][c].u * imgW,
                v: CANONICAL_UV[r][c].v * imgH,
            };
        }
    }

    arCtx.globalAlpha = 0.88;

    for (let r = 0; r < G_ROWS - 1; r++) {
        for (let c = 0; c < G_COLS - 1; c++) {
            const d00 = smoothed[r][c],     d10 = smoothed[r][c+1];
            const d01 = smoothed[r+1][c],   d11 = smoothed[r+1][c+1];
            const s00 = uvs[r][c],     s10 = uvs[r][c+1];
            const s01 = uvs[r+1][c],   s11 = uvs[r+1][c+1];

            drawTri(arCtx, arImage,
                s00.u, s00.v, d00.x, d00.y,
                s10.u, s10.v, d10.x, d10.y,
                s01.u, s01.v, d01.x, d01.y);

            drawTri(arCtx, arImage,
                s10.u, s10.v, d10.x, d10.y,
                s11.u, s11.v, d11.x, d11.y,
                s01.u, s01.v, d01.x, d01.y);
        }
    }

    arCtx.globalAlpha = 1.0;
}

function drawTri(ctx, img,
    sx0, sy0, dx0, dy0,
    sx1, sy1, dx1, dy1,
    sx2, sy2, dx2, dy2
) {
    const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(denom) < 0.5) return;
    const id = 1 / denom;

    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * id;
    const b = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * id;
    const cc= (dx0 * (sx1*sy2 - sx2*sy1) + dx1 * (sx2*sy0 - sx0*sy2) + dx2 * (sx0*sy1 - sx1*sy0)) * id;
    const d = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * id;
    const e = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * id;
    const f = (dy0 * (sx1*sy2 - sx2*sy1) + dy1 * (sx2*sy0 - sx0*sy2) + dy2 * (sx0*sy1 - sx1*sy0)) * id;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, d, b, e, cc, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
}

// ── Detection loop ──────────────────────────────────────────────────────
function stopLoop() {
    if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    lastVideoTime = -1;
    prevSmoothedPts = null;   // reset temporal smoothing on stop
    landmarkCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
    arCtx.clearRect(0, 0, arOverlay.width, arOverlay.height);
}

function startLoop() {
    if (!stream || !faceLandmarker) return;
    stopLoop();

    const step = () => {
        if (!stream || !faceLandmarker) return;

        if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            videoEl.currentTime !== lastVideoTime) {
            lastVideoTime = videoEl.currentTime;

            try {
                const result = faceLandmarker.detectForVideo(videoEl, performance.now());
                const faces  = result.faceLandmarks || [];

                const { w: w1, h: h1 } = syncCanvasSize(landmarkCanvas);
                drawLandmarkDots(faces, w1, h1);

                const { w: w2, h: h2 } = syncCanvasSize(arOverlay);
                drawArOverlay(faces, w2, h2);

                if (faces.length > 0) {
                    setStatus('Tracking face | AR overlay active', 'success');
                } else {
                    prevSmoothedPts = null;   // reset smoothing when face lost
                    setStatus('No face detected. Look at the camera.', 'info');
                }
            } catch (err) {
                console.error('Detection error:', err);
                setStatus('Detection error: ' + err.message, 'error');
            }
        }

        animFrameId = requestAnimationFrame(step);
    };

    animFrameId = requestAnimationFrame(step);
}

// ── Camera control ──────────────────────────────────────────────────────
async function startCamera() {
    const getUserMedia = getGetUserMedia();
    if (!getUserMedia) {
        const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        setStatus(isSecure ? 'Camera API not supported. Try Safari or Chrome.' : 'Camera requires HTTPS.', 'error');
        return;
    }

    setStatus('Preparing face landmarks...');
    try { await ensureFaceLandmarker(); } catch (err) {
        setStatus('Failed to load landmarker: ' + err.message, 'error');
        console.error(err);
        return;
    }

    stopCurrentStream();
    updateMirror();
    setStatus('Requesting camera permission...');

    try {
        stream = await getUserMedia({
            video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        videoEl.srcObject = stream;
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('webkit-playsinline', '');
        videoEl.muted = true;
        await videoEl.play();

        const track = stream.getVideoTracks()[0];
        const actual = track?.getSettings?.().facingMode;
        if (actual === 'user' || actual === 'environment') { facingMode = actual; updateMirror(); }

        setControls(true);
        setStatus('Camera ready. Tracking landmarks...', 'success');
        startLoop();
    } catch (err) {
        stopLoop();
        setControls(false);
        let msg = err.message || String(err);
        if (err.name === 'NotAllowedError') msg = 'Camera permission denied. Allow camera access in browser settings.';
        else if (err.name === 'NotFoundError') msg = 'No camera found on this device.';
        else if (err.name === 'NotReadableError' || err.name === 'AbortError') msg = 'Camera in use by another app.';
        setStatus(msg, 'error');
        console.error('Camera error:', err);
    }
}

function stopCurrentStream() {
    stopLoop();
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    videoEl.srcObject = null;
}

function capturePhoto() {
    if (!stream || !videoEl.videoWidth) return;
    offscreen.width  = videoEl.videoWidth;
    offscreen.height = videoEl.videoHeight;
    offCtx.drawImage(videoEl, 0, 0, offscreen.width, offscreen.height);
    if (arOverlay.width > 0 && arOverlay.height > 0) offCtx.drawImage(arOverlay, 0, 0, offscreen.width, offscreen.height);
    if (showLandmarks && landmarkCanvas.width > 0 && landmarkCanvas.height > 0) offCtx.drawImage(landmarkCanvas, 0, 0, offscreen.width, offscreen.height);

    offscreen.toBlob((blob) => {
        if (!blob) { setStatus('Capture failed.', 'error'); return; }
        photoCount++;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const name = 'lifesync_ar_' + ts + '.png';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; a.click();
        const item = document.createElement('div'); item.className = 'preview-item';
        const cap = document.createElement('div'); cap.className = 'preview-caption'; cap.textContent = 'Capture ' + photoCount;
        const img = document.createElement('img'); img.src = url; img.alt = 'AR capture';
        item.appendChild(cap); item.appendChild(img);
        capturePreview.innerHTML = ''; capturePreview.appendChild(item);
        setStatus('Captured ' + name, 'success');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, 'image/png');
}

// ── Event listeners ─────────────────────────────────────────────────────
startBtn.addEventListener('click', () => void startCamera());
switchBtn.addEventListener('click', () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; void startCamera(); });
captureBtn.addEventListener('click', () => capturePhoto());
toggleLMBtn.addEventListener('click', () => {
    showLandmarks = !showLandmarks;
    toggleLMBtn.textContent = showLandmarks ? 'Hide Landmarks' : 'Show Landmarks';
    if (!showLandmarks) landmarkCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
});
stopBtn.addEventListener('click', () => { stopCurrentStream(); setControls(false); setStatus('Stopped.', 'info'); });
window.addEventListener('beforeunload', () => { if (stream) stream.getTracks().forEach(t => t.stop()); });
window.addEventListener('resize', () => {});

// ── Init ────────────────────────────────────────────────────────────────
loadArImage();
setControls(false);
setStatus('Load an AR image from Picture Generator, then click Start Camera.', 'info');
