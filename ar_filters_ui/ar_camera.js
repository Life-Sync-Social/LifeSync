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

// ── Video-to-display coordinate mapping ─────────────────────────────────
function getVideoMapping(displayW, displayH) {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return null;
    // object-fit: cover
    const scale = Math.max(displayW / vw, displayH / vh);
    return {
        rw: vw * scale,
        rh: vh * scale,
        ox: (displayW - vw * scale) / 2,
        oy: (displayH - vh * scale) / 2,
    };
}

// ── Drawing: Landmark dots ──────────────────────────────────────────────
function drawLandmarkDots(landmarks, displayW, displayH) {
    landmarkCtx.clearRect(0, 0, displayW, displayH);
    if (!showLandmarks || !landmarks.length) return;
    const m = getVideoMapping(displayW, displayH);
    if (!m) return;

    landmarkCtx.fillStyle = 'rgba(53, 223, 164, 0.85)';
    landmarkCtx.shadowColor = 'rgba(53, 223, 164, 0.5)';
    landmarkCtx.shadowBlur = 3;
    const r = Math.max(1.2, Math.min(2, displayW / 450));

    for (const face of landmarks) {
        for (const pt of face) {
            landmarkCtx.beginPath();
            landmarkCtx.arc(pt.x * m.rw + m.ox, pt.y * m.rh + m.oy, r, 0, Math.PI * 2);
            landmarkCtx.fill();
        }
    }
    landmarkCtx.shadowBlur = 0;
}

// ── Face oval silhouette indices (MediaPipe canonical mesh) ─────────────
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
    361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
    176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109
];

// Interior points for denser mesh
const INTERIOR = [
    151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 0, 164,
    57, 287, 130, 359, 50, 280, 117, 346, 123, 352,
    187, 411, 205, 425,
];

const ALL_IDX = [...FACE_OVAL, ...INTERIOR];

// ── Draw AR overlay on face ─────────────────────────────────────────────
// Draws the AR image clipped to the face oval, stretched to the face
// bounding box. The face oval path from landmarks gives natural curvature
// as the user moves their head.
function drawArOverlay(landmarks, displayW, displayH) {
    arCtx.clearRect(0, 0, displayW, displayH);
    if (!arImage || !landmarks.length) return;

    const m = getVideoMapping(displayW, displayH);
    if (!m) return;

    const face = landmarks[0];

    // Convert face oval landmarks to display coordinates
    const ovalPts = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const idx of FACE_OVAL) {
        const pt = face[idx];
        if (!pt) continue;
        const x = pt.x * m.rw + m.ox;
        const y = pt.y * m.rh + m.oy;
        ovalPts.push({ x, y });
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    if (ovalPts.length < 3) return;

    const faceW = maxX - minX;
    const faceH = maxY - minY;
    if (faceW < 5 || faceH < 5) return;

    // Expand bounding box slightly so the image covers the full face
    const padX = faceW * 0.05;
    const padY = faceH * 0.05;
    const drawX = minX - padX;
    const drawY = minY - padY;
    const drawW = faceW + padX * 2;
    const drawH = faceH + padY * 2;

    arCtx.save();
    arCtx.globalAlpha = 0.75;

    // Clip to the face oval shape using landmark points
    arCtx.beginPath();
    arCtx.moveTo(ovalPts[0].x, ovalPts[0].y);
    for (let i = 1; i < ovalPts.length; i++) {
        arCtx.lineTo(ovalPts[i].x, ovalPts[i].y);
    }
    arCtx.closePath();
    arCtx.clip();

    // Draw the AR image stretched to the face bounding box
    arCtx.drawImage(arImage, drawX, drawY, drawW, drawH);

    arCtx.restore();
    arCtx.setTransform(1, 0, 0, 1, 0, 0);
    arCtx.globalAlpha = 1.0;
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
