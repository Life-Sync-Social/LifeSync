/*  ar_camera.js  –  AR Camera with facial-landmark-driven image overlay
 *
 *  Flow:
 *  1.  User generates an image in picture_gen and clicks "Use in AR"
 *  2.  The generated image dataURL is stored in sessionStorage('arGeneratedImage')
 *  3.  This page opens the camera, loads MediaPipe FaceLandmarker (478 points),
 *      and on every frame:
 *      a.  Detects face landmarks
 *      b.  Draws the AR image warped to the facial curvature on a canvas overlay
 *      c.  Optionally shows the raw landmark dots
 *  4.  User can capture a composite photo (video + AR overlay).
 *
 *  Adapted from artestprototype – uses the same MediaPipe Tasks Vision CDN
 *  approach with FaceLandmarker (not the older face-detection model).
 */

// ── Auth guard ──────────────────────────────────────────────────────────
const isLoggedIn = sessionStorage.getItem('isLoggedIn');
if (!isLoggedIn) {
    // window.location.href = '../login_signup/login.html';
}

// ── DOM refs ────────────────────────────────────────────────────────────
const videoEl        = document.getElementById('video');
const videoContainer = document.querySelector('.video-container');
const landmarkCanvas = document.getElementById('landmarkCanvas');
const arOverlay      = document.getElementById('arOverlay');
const offscreen      = document.getElementById('offscreenCanvas');
const startBtn       = document.getElementById('startBtn');
const captureBtn     = document.getElementById('captureBtn');
const switchBtn      = document.getElementById('switchBtn');
const toggleLMBtn    = document.getElementById('toggleLandmarksBtn');
const stopBtn        = document.getElementById('stopBtn');
const statusBanner   = document.getElementById('status');
const arSourcePreview = document.getElementById('arSourcePreview');
const capturePreview  = document.getElementById('capturePreview');

const landmarkCtx = landmarkCanvas.getContext('2d');
const arCtx       = arOverlay.getContext('2d');
const offCtx      = offscreen.getContext('2d');

// ── MediaPipe CDN paths (same versions as artestprototype) ──────────────
const TASKS_VISION_URL   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_PATH          = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FALLBACK_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

// ── State ───────────────────────────────────────────────────────────────
let stream            = null;
let facingMode        = 'user';
let faceLandmarker    = null;
let animFrameId       = null;
let lastVideoTime     = -1;
let showLandmarks     = true;
let photoCount        = 0;
let arImage           = null;      // HTMLImageElement of the generated picture
let FaceLandmarkerCls = null;
let FilesetResolverCls = null;

// ── Helpers ─────────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
    statusBanner.textContent = msg;
    statusBanner.classList.remove('info', 'success', 'error');
    statusBanner.classList.add(type);
}

function setControls(running) {
    startBtn.disabled          = running;
    captureBtn.disabled        = !running;
    switchBtn.disabled         = !running;
    toggleLMBtn.disabled       = !running;
    stopBtn.disabled           = !running;
}

function updateMirror() {
    videoContainer.classList.toggle('mirror', facingMode === 'user');
}

// ── Load AR source image from sessionStorage ────────────────────────────
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
        const previewImg = document.createElement('img');
        previewImg.src = dataUrl;
        previewImg.alt = 'AR filter source';
        arSourcePreview.appendChild(previewImg);
        setStatus('AR image loaded. Start the camera to begin.', 'success');
    };
    img.onerror = () => {
        arSourcePreview.innerHTML = '<div class="preview-placeholder">Failed to load AR image.</div>';
    };
    img.src = dataUrl;
}

// ── Load MediaPipe Vision API ───────────────────────────────────────────
async function ensureVisionApi() {
    if (FaceLandmarkerCls && FilesetResolverCls) return;
    setStatus('Loading MediaPipe module...');
    const vision = await import(TASKS_VISION_URL);
    const mod = vision.default ?? vision;
    FaceLandmarkerCls   = mod.FaceLandmarker   ?? vision.FaceLandmarker   ?? null;
    FilesetResolverCls  = mod.FilesetResolver  ?? vision.FilesetResolver  ?? null;
    if (!FaceLandmarkerCls || !FilesetResolverCls) {
        throw new Error('MediaPipe module missing FaceLandmarker or FilesetResolver');
    }
}

async function ensureFaceLandmarker() {
    if (faceLandmarker) return faceLandmarker;
    await ensureVisionApi();

    setStatus('Loading face landmark model...');
    const fileset  = await FilesetResolverCls.forVisionTasks(WASM_PATH);
    const response = await fetch(FALLBACK_MODEL_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Model fetch failed (${response.status})`);
    const buf = new Uint8Array(await response.arrayBuffer());

    faceLandmarker = await FaceLandmarkerCls.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: buf },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
    });

    setStatus('Face landmark model ready.', 'success');
    return faceLandmarker;
}

// ── Canvas sizing (DPR-aware, matching artestprototype) ─────────────────
function syncCanvasSize(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const rect = videoContainer.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const dw = Math.round(w * dpr);
    const dh = Math.round(h * dpr);
    if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width  = dw;
        canvas.height = dh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    landmarkCtx.fillStyle   = 'rgba(53, 223, 164, 0.85)';
    landmarkCtx.shadowColor = 'rgba(53, 223, 164, 0.5)';
    landmarkCtx.shadowBlur  = 3;
    const r = Math.max(1.2, Math.min(2, displayW / 450));

    for (const face of landmarks) {
        for (const pt of face) {
            const x = pt.x * rw + ox;
            const y = pt.y * rh + oy;
            landmarkCtx.beginPath();
            landmarkCtx.arc(x, y, r, 0, Math.PI * 2);
            landmarkCtx.fill();
        }
    }
    landmarkCtx.shadowBlur = 0;
}

// ── Drawing: AR image overlay with curvature ────────────────────────────
//
// We use the 478 face landmarks to define a triangulated mesh.  The AR
// image is texture-mapped onto the face oval (landmarks that trace the
// outer silhouette + forehead) by splitting the region into triangles
// and drawing each triangle of the source image warped to the
// corresponding landmark triangle.  This gives natural curvature
// because each small triangle follows the 3D surface normals.
//
// Key landmark indices for the face oval (MediaPipe canonical mesh):
//   Silhouette: 10,338,297,332,284,251,389,356,454,323,361,288,397,365,
//               379,378,400,377,152,148,176,149,150,136,172,58,132,93,
//               234,127,162,21,54,103,67,109
//
// We also include a few interior points (nose bridge, between eyes, etc.)
// to create a denser mesh for better curvature.

const FACE_OVAL_INDICES = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
    361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
    176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109
];

// Interior landmark indices for mesh density (forehead, nose, cheeks, chin)
const INTERIOR_INDICES = [
    151,   // top of forehead center
    9,     // forehead
    8,     // forehead lower
    168,   // between brows
    6,     // nose bridge top
    197,   // nose bridge mid
    195,   // nose tip
    5,     // nose lower
    4,     // nose bottom center
    1,     // upper lip center
    0,     // lower lip center
    164,   // chin area
    57,    // mouth left
    287,   // mouth right
    130,   // left cheek inner
    359,   // right cheek inner
    50,    // left cheek outer
    280,   // right cheek outer
    117,   // left eye outer lower
    346,   // right eye outer lower
    123,   // left cheek mid
    352,   // right cheek mid
    187,   // left jaw
    411,   // right jaw
    205,   // left lower cheek
    425,   // right lower cheek
];

const ALL_MESH_INDICES = [...FACE_OVAL_INDICES, ...INTERIOR_INDICES];

// Earcut-style triangulation for our specific point set would be ideal,
// but to keep it lightweight we use Delaunay via a simple approach:
// pre-triangulate on first detection using the normalised UV coords.
let meshTriangles = null;   // [[i,j,k], ...]

function triangulate(pts2d) {
    // Simple ear-clipping / fan triangulation is not great for concave
    // shapes.  Instead we do a basic Delaunay via the Bowyer-Watson algo
    // on the UV-normalised landmark positions.
    // For robustness we fall back to a simple fan if it fails.
    const n = pts2d.length;
    if (n < 3) return [];

    try {
        return bowyerWatson(pts2d);
    } catch (_) {
        // fallback: fan from centroid
        const cx = pts2d.reduce((s, p) => s + p[0], 0) / n;
        const cy = pts2d.reduce((s, p) => s + p[1], 0) / n;
        // sort points by angle from centroid
        const indexed = pts2d.map((p, i) => ({ i, a: Math.atan2(p[1] - cy, p[0] - cx) }));
        indexed.sort((a, b) => a.a - b.a);
        const tris = [];
        for (let k = 0; k < n; k++) {
            tris.push([indexed[k].i, indexed[(k + 1) % n].i, -1]);
        }
        // -1 means centroid  – we'll handle this specially
        return tris;
    }
}

function bowyerWatson(points) {
    // Bowyer-Watson Delaunay triangulation
    const n = points.length;
    // super triangle
    const stA = [-10, -10];
    const stB = [20, -10];
    const stC = [5, 20];
    const allPts = [...points, stA, stB, stC];
    const siA = n, siB = n + 1, siC = n + 2;

    let triangles = [{ v: [siA, siB, siC] }];

    for (let i = 0; i < n; i++) {
        const p = allPts[i];
        const bad = [];
        for (let t = 0; t < triangles.length; t++) {
            if (inCircumcircle(p, allPts, triangles[t].v)) {
                bad.push(t);
            }
        }

        // find boundary polygon
        const edges = [];
        for (const bi of bad) {
            const tri = triangles[bi].v;
            for (let e = 0; e < 3; e++) {
                const ea = tri[e], eb = tri[(e + 1) % 3];
                let shared = false;
                for (const bj of bad) {
                    if (bj === bi) continue;
                    const t2 = triangles[bj].v;
                    if ((t2.includes(ea) && t2.includes(eb))) { shared = true; break; }
                }
                if (!shared) edges.push([ea, eb]);
            }
        }

        // remove bad triangles (iterate in reverse)
        const badSet = new Set(bad);
        triangles = triangles.filter((_, idx) => !badSet.has(idx));

        for (const [ea, eb] of edges) {
            triangles.push({ v: [i, ea, eb] });
        }
    }

    // remove any triangle that uses a super-triangle vertex
    const result = [];
    for (const t of triangles) {
        if (t.v[0] >= n || t.v[1] >= n || t.v[2] >= n) continue;
        result.push(t.v);
    }
    return result;
}

function inCircumcircle(p, pts, tri) {
    const [ax, ay] = pts[tri[0]];
    const [bx, by] = pts[tri[1]];
    const [cx, cy] = pts[tri[2]];
    const dx = ax - p[0], dy = ay - p[1];
    const ex = bx - p[0], ey = by - p[1];
    const fx = cx - p[0], fy = cy - p[1];
    const det = dx * (ey * (fx * fx + fy * fy) - fy * (ex * ex + ey * ey))
              - dy * (ex * (fx * fx + fy * fy) - fx * (ex * ex + ey * ey))
              + (dx * dx + dy * dy) * (ex * fy - ey * fx);
    return det > 0;
}

function drawArOverlay(landmarks, displayW, displayH) {
    arCtx.clearRect(0, 0, displayW, displayH);
    if (!arImage || !landmarks.length) return;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.max(displayW / vw, displayH / vh);
    const rw = vw * scale;
    const rh = vh * scale;
    const ox = (displayW - rw) / 2;
    const oy = (displayH - rh) / 2;

    const face = landmarks[0];   // first face only

    // Collect the mesh points in display coords + normalised UV for texture
    const dstPts = [];   // [x,y] in canvas display space
    const uvPts  = [];   // [u,v] normalised 0..1 for the AR image texture

    // Compute bounding box of face oval for UV normalisation
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const idx of FACE_OVAL_INDICES) {
        const pt = face[idx];
        if (!pt) continue;
        const sx = pt.x * rw + ox;
        const sy = pt.y * rh + oy;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
    }
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;

    for (const idx of ALL_MESH_INDICES) {
        const pt = face[idx];
        if (!pt) { dstPts.push([displayW / 2, displayH / 2]); uvPts.push([0.5, 0.5]); continue; }
        const sx = pt.x * rw + ox;
        const sy = pt.y * rh + oy;
        dstPts.push([sx, sy]);
        uvPts.push([(sx - minX) / bw, (sy - minY) / bh]);
    }

    // Triangulate once (topology stays stable across frames)
    if (!meshTriangles) {
        meshTriangles = triangulate(uvPts);
    }

    // Draw each triangle: clip to triangle in dest space, draw transformed source
    const imgW = arImage.naturalWidth  || arImage.width;
    const imgH = arImage.naturalHeight || arImage.height;

    arCtx.globalAlpha = 0.75;

    for (const tri of meshTriangles) {
        const [i0, i1, i2] = tri;
        if (i0 < 0 || i1 < 0 || i2 < 0) continue;
        if (i0 >= dstPts.length || i1 >= dstPts.length || i2 >= dstPts.length) continue;

        // destination triangle (canvas coords)
        const dx0 = dstPts[i0][0], dy0 = dstPts[i0][1];
        const dx1 = dstPts[i1][0], dy1 = dstPts[i1][1];
        const dx2 = dstPts[i2][0], dy2 = dstPts[i2][1];

        // source triangle (image pixel coords)
        const su0 = uvPts[i0][0] * imgW, sv0 = uvPts[i0][1] * imgH;
        const su1 = uvPts[i1][0] * imgW, sv1 = uvPts[i1][1] * imgH;
        const su2 = uvPts[i2][0] * imgW, sv2 = uvPts[i2][1] * imgH;

        drawTexturedTriangle(
            arCtx,
            arImage,
            su0, sv0, su1, sv1, su2, sv2,
            dx0, dy0, dx1, dy1, dx2, dy2
        );
    }

    arCtx.globalAlpha = 1.0;
}

/**
 * Draw a triangle from a source image onto the canvas using affine
 * texture mapping.  This gives the curvature effect because each
 * small triangle is independently transformed.
 */
function drawTexturedTriangle(ctx, img,
    sx0, sy0, sx1, sy1, sx2, sy2,
    dx0, dy0, dx1, dy1, dx2, dy2
) {
    // Clip to destination triangle
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();

    // Compute affine transform: source triangle → dest triangle
    // We solve for M such that M * [sx, sy, 1]^T = [dx, dy]^T
    const denom = (sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1));
    if (Math.abs(denom) < 1e-8) { ctx.restore(); return; }

    const m11 = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denom;
    const m12 = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denom;
    const m13 = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / denom;
    const m21 = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denom;
    const m22 = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denom;
    const m23 = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / denom;

    ctx.setTransform(m11, m21, m12, m22, m13, m23);
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

                const { w: dw1, h: dh1 } = syncCanvasSize(landmarkCanvas, landmarkCtx);
                drawLandmarkDots(faces, dw1, dh1);

                const { w: dw2, h: dh2 } = syncCanvasSize(arOverlay, arCtx);
                drawArOverlay(faces, dw2, dh2);

                if (faces.length > 0) {
                    setStatus(`Tracking face | ${ALL_MESH_INDICES.length} mesh points | AR overlay active`, 'success');
                } else {
                    setStatus('No face detected. Look at the camera.', 'info');
                }
            } catch (err) {
                console.error('Detection error:', err);
                setStatus(`Detection error: ${err.message}`, 'error');
            }
        }

        animFrameId = requestAnimationFrame(step);
    };

    animFrameId = requestAnimationFrame(step);
}

// ── Camera control ──────────────────────────────────────────────────────
async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Camera API not available.', 'error');
        return;
    }

    setStatus('Preparing face landmarks...');
    try {
        await ensureFaceLandmarker();
    } catch (err) {
        setStatus(`Failed to load landmarker: ${err.message}`, 'error');
        console.error(err);
        return;
    }

    stopCurrentStream();
    updateMirror();
    setStatus('Requesting camera...');

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        videoEl.srcObject = stream;
        await videoEl.play();

        const track = stream.getVideoTracks()[0];
        const actual = track?.getSettings?.().facingMode;
        if (actual === 'user' || actual === 'environment') {
            facingMode = actual;
            updateMirror();
        }

        setControls(true);
        setStatus('Camera ready. Tracking landmarks...', 'success');
        meshTriangles = null;   // re-triangulate for new camera resolution
        startLoop();
    } catch (err) {
        stopLoop();
        setControls(false);
        setStatus(`Camera error: ${err.message}`, 'error');
        console.error(err);
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

    // Composite: video frame + AR overlay
    offscreen.width  = videoEl.videoWidth;
    offscreen.height = videoEl.videoHeight;

    offCtx.drawImage(videoEl, 0, 0, offscreen.width, offscreen.height);

    // Draw AR overlay scaled from display size to video size
    if (arOverlay.width > 0 && arOverlay.height > 0) {
        offCtx.drawImage(arOverlay, 0, 0, offscreen.width, offscreen.height);
    }
    // Draw landmark overlay too
    if (showLandmarks && landmarkCanvas.width > 0 && landmarkCanvas.height > 0) {
        offCtx.drawImage(landmarkCanvas, 0, 0, offscreen.width, offscreen.height);
    }

    offscreen.toBlob((blob) => {
        if (!blob) { setStatus('Capture failed.', 'error'); return; }

        photoCount++;
        const ts   = new Date().toISOString().replace(/[:.]/g, '-');
        const name = `lifesync_ar_${ts}.png`;
        const url  = URL.createObjectURL(blob);

        // Auto-download
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();

        // Show in preview
        const item = document.createElement('div');
        item.className = 'preview-item';
        const cap = document.createElement('div');
        cap.className = 'preview-caption';
        cap.textContent = `Capture ${photoCount}`;
        const img = document.createElement('img');
        img.src = url; img.alt = 'AR capture';
        item.appendChild(cap);
        item.appendChild(img);
        capturePreview.innerHTML = '';
        capturePreview.appendChild(item);

        setStatus(`Captured ${name}`, 'success');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, 'image/png');
}

// ── Event listeners ─────────────────────────────────────────────────────
startBtn.addEventListener('click', () => { void startCamera(); });

switchBtn.addEventListener('click', () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    meshTriangles = null;
    void startCamera();
});

captureBtn.addEventListener('click', () => { capturePhoto(); });

toggleLMBtn.addEventListener('click', () => {
    showLandmarks = !showLandmarks;
    toggleLMBtn.textContent = showLandmarks ? 'Hide Landmarks' : 'Show Landmarks';
    if (!showLandmarks) {
        landmarkCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
    }
});

stopBtn.addEventListener('click', () => {
    stopCurrentStream();
    setControls(false);
    setStatus('Stopped.', 'info');
});

window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
});

window.addEventListener('resize', () => {
    meshTriangles = null;   // force re-triangulation on resize
});

// ── Init ────────────────────────────────────────────────────────────────
loadArImage();
setControls(false);
setStatus('Load an AR image from Picture Generator, then click Start Camera.', 'info');
