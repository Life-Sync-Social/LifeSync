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

// ── AR overlay: dense 33x33 grid (1024 quads, 2048 triangles) ───────────
// Uses 4 corner anchor landmarks to define a face quad, then generates
// a dense bilinear grid between them. Each cell is tiny so the affine
// warp per triangle is nearly lossless.

const GRID_N = 33;  // 33x33 points = 32x32 cells = 1024 quads = 2048 tris

// Anchor landmarks for the 4 corners of the face region
const LM_TOP    = 10;   // forehead top center
const LM_BOTTOM = 152;  // chin bottom center
const LM_LEFT   = 234;  // left ear
const LM_RIGHT  = 454;  // right ear
// Extra anchors for better corner estimates
const LM_LEFT_BROW  = 127;
const LM_RIGHT_BROW = 356;
const LM_LEFT_JAW   = 172;
const LM_RIGHT_JAW  = 397;

function getPt(face, idx, rw, rh, ox, oy) {
    const pt = face[idx];
    if (!pt) return null;
    return { x: pt.x * rw + ox, y: pt.y * rh + oy };
}

function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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

    // Get anchor points in raw video-mapped coordinates
    const top    = getPt(face, LM_TOP, rw, rh, ox, oy);
    const bottom = getPt(face, LM_BOTTOM, rw, rh, ox, oy);
    const left   = getPt(face, LM_LEFT, rw, rh, ox, oy);
    const right  = getPt(face, LM_RIGHT, rw, rh, ox, oy);
    const lBrow  = getPt(face, LM_LEFT_BROW, rw, rh, ox, oy);
    const rBrow  = getPt(face, LM_RIGHT_BROW, rw, rh, ox, oy);
    const lJaw   = getPt(face, LM_LEFT_JAW, rw, rh, ox, oy);
    const rJaw   = getPt(face, LM_RIGHT_JAW, rw, rh, ox, oy);

    if (!top || !bottom || !left || !right || !lBrow || !rBrow || !lJaw || !rJaw) return;

    // Build 4 corners of the face quad
    // top-left:     between forehead and left brow
    // top-right:    between forehead and right brow
    // bottom-left:  between chin and left jaw
    // bottom-right: between chin and right jaw
    let tl = { x: lBrow.x, y: top.y };
    let tr = { x: rBrow.x, y: top.y };
    let bl = { x: lJaw.x,  y: bottom.y };
    let br = { x: rJaw.x,  y: bottom.y };

    // Mirror for selfie mode
    if (isMirror) {
        tl.x = displayW - tl.x;
        tr.x = displayW - tr.x;
        bl.x = displayW - bl.x;
        br.x = displayW - br.x;
        // After mirroring, tl and tr swap sides, bl and br swap sides
        let tmp;
        tmp = tl; tl = tr; tr = tmp;
        tmp = bl; bl = br; br = tmp;
    }

    // Generate dense grid via bilinear interpolation of the 4 corners
    const grid = [];
    for (let r = 0; r < GRID_N; r++) {
        grid[r] = [];
        const v = r / (GRID_N - 1);  // 0=top, 1=bottom
        for (let c = 0; c < GRID_N; c++) {
            const u = c / (GRID_N - 1);  // 0=left, 1=right
            // Bilinear interpolation
            const topX = tl.x + (tr.x - tl.x) * u;
            const topY = tl.y + (tr.y - tl.y) * u;
            const botX = bl.x + (br.x - bl.x) * u;
            const botY = bl.y + (br.y - bl.y) * u;
            grid[r][c] = {
                x: topX + (botX - topX) * v,
                y: topY + (botY - topY) * v,
            };
        }
    }

    arCtx.globalAlpha = 0.85;

    // Draw 1024 quads (2048 triangles)
    for (let r = 0; r < GRID_N - 1; r++) {
        for (let c = 0; c < GRID_N - 1; c++) {
            const p_tl = grid[r][c];
            const p_tr = grid[r][c + 1];
            const p_bl = grid[r + 1][c];
            const p_br = grid[r + 1][c + 1];

            const su = (c / (GRID_N - 1)) * imgW;
            const sv = (r / (GRID_N - 1)) * imgH;
            const sw = (1 / (GRID_N - 1)) * imgW;
            const sh = (1 / (GRID_N - 1)) * imgH;

            drawWarpedQuad(arCtx, arImage,
                su, sv, sw, sh,
                p_tl, p_tr, p_bl, p_br);
        }
    }

    arCtx.globalAlpha = 1.0;
}

// Draw a source rectangle from the image warped into a destination quad
// by splitting into two triangles.
function drawWarpedQuad(ctx, img, su, sv, sw, sh, tl, tr, bl, br) {
    // Triangle 1: tl, tr, bl
    drawTriangle(ctx, img,
        su, sv,          tl.x, tl.y,
        su + sw, sv,     tr.x, tr.y,
        su, sv + sh,     bl.x, bl.y);

    // Triangle 2: tr, br, bl
    drawTriangle(ctx, img,
        su + sw, sv,     tr.x, tr.y,
        su + sw, sv + sh, br.x, br.y,
        su, sv + sh,     bl.x, bl.y);
}

// Draw one triangle of the source image mapped to a destination triangle
// using an affine transform.
function drawTriangle(ctx, img,
    sx0, sy0, dx0, dy0,
    sx1, sy1, dx1, dy1,
    sx2, sy2, dx2, dy2
) {
    const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(denom) < 0.5) return;
    const id = 1 / denom;

    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * id;
    const b = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * id;
    const cc = (dx0 * (sx1*sy2 - sx2*sy1) + dx1 * (sx2*sy0 - sx0*sy2) + dx2 * (sx0*sy1 - sx1*sy0)) * id;
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
