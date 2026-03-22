(function () {
  // Auth check
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  if (!isLoggedIn) {
    // Temporarily disabled for testing
    // window.location.href = '../login_signup/login.html';
    // return;
  }

  // ── HuggingFace API config (client-side, no server needed) ────────
  const HF_IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell';
  const HF_API_URL = 'https://router.huggingface.co/hf-inference/models/' + HF_IMAGE_MODEL;

  // Prompt: generate close-up face paint that fills the whole image
  const AR_PROMPT_PREFIX = 'Extreme close-up of face paint design filling the entire image edge to edge, no background visible, no negative space, the painted pattern covers every pixel of the frame, front view of a face completely covered in detailed ';

  // ── API key (obfuscated) ──────────────────────────────────────────
  function _k() {
    var e = 'eGNEa0NmTlVkbEpFWE5TQ2tUS0ljWGJXdm9GVkh0ckRTcl9maA==';
    return atob(e).split('').reverse().join('');
  }

  // ── Background removal ────────────────────────────────────────────
  // Detects the background by sampling edge pixels and flood-fills
  // from all edges to remove it, leaving just the subject with
  // transparent pixels.
  function removeBackground(imgDataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var imgData = ctx.getImageData(0, 0, w, h);
        var px = imgData.data;

        // Sample edge pixels to find background color
        var edgeColors = [];
        // Top and bottom rows
        for (var x = 0; x < w; x += 2) {
          var ti = x * 4;
          edgeColors.push([px[ti], px[ti+1], px[ti+2]]);
          var bi = ((h-1)*w + x) * 4;
          edgeColors.push([px[bi], px[bi+1], px[bi+2]]);
        }
        // Left and right columns
        for (var y = 0; y < h; y += 2) {
          var li = (y*w) * 4;
          edgeColors.push([px[li], px[li+1], px[li+2]]);
          var ri = (y*w + w-1) * 4;
          edgeColors.push([px[ri], px[ri+1], px[ri+2]]);
        }

        // Find median background color
        edgeColors.sort(function(a,b) { return (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]); });
        var mid = Math.floor(edgeColors.length / 2);
        var bgR = edgeColors[mid][0], bgG = edgeColors[mid][1], bgB = edgeColors[mid][2];

        // Flood fill from edges - mark background pixels
        var visited = new Uint8Array(w * h);
        var queue = [];
        var tolerance = 55;

        function colorDist(i) {
          var dr = px[i] - bgR, dg = px[i+1] - bgG, db = px[i+2] - bgB;
          return Math.sqrt(dr*dr + dg*dg + db*db);
        }

        function isBg(i) {
          return colorDist(i * 4) < tolerance;
        }

        // Seed from all edge pixels
        for (var x2 = 0; x2 < w; x2++) {
          if (isBg(x2)) queue.push(x2);
          if (isBg((h-1)*w + x2)) queue.push((h-1)*w + x2);
        }
        for (var y2 = 0; y2 < h; y2++) {
          if (isBg(y2*w)) queue.push(y2*w);
          if (isBg(y2*w + w-1)) queue.push(y2*w + w-1);
        }

        // BFS flood fill
        while (queue.length > 0) {
          var idx = queue.pop();
          if (idx < 0 || idx >= w*h) continue;
          if (visited[idx]) continue;
          if (!isBg(idx)) continue;
          visited[idx] = 1;

          var ix = idx % w;
          var iy = Math.floor(idx / w);
          if (ix > 0) queue.push(idx - 1);
          if (ix < w-1) queue.push(idx + 1);
          if (iy > 0) queue.push(idx - w);
          if (iy < h-1) queue.push(idx + w);
        }

        // Set background pixels to transparent, feather edges
        for (var i = 0; i < w*h; i++) {
          var pi = i * 4;
          if (visited[i]) {
            // Check if near a non-visited pixel for feathering
            var ix2 = i % w;
            var iy2 = Math.floor(i / w);
            var nearSubject = false;
            for (var dx = -2; dx <= 2; dx++) {
              for (var dy = -2; dy <= 2; dy++) {
                var nx = ix2 + dx, ny = iy2 + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  if (!visited[ny * w + nx]) { nearSubject = true; break; }
                }
              }
              if (nearSubject) break;
            }
            px[pi+3] = nearSubject ? 80 : 0;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.src = imgDataUrl;
    });
  }

  // ── DOM refs ──────────────────────────────────────────────────────
  const promptInput = document.getElementById('promptInput');
  const generateBtn = document.getElementById('generateBtn');
  const resultContent = document.getElementById('resultContent');
  const errorMsg = document.getElementById('errorMsg');
  let lastGeneratedDataUrl = null;

  function setLoading(loading) {
    generateBtn.disabled = loading;
    generateBtn.querySelector('.generate-text').textContent = loading ? 'Generating...' : 'Generate';
    errorMsg.style.display = 'none';
  }

  function showError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = 'block';
  }

  function showResult(imageDataUrl) {
    lastGeneratedDataUrl = imageDataUrl;
    resultContent.innerHTML = '';
    resultContent.className = '';

    // Show with checkerboard bg so transparency is visible
    var wrap = document.createElement('div');
    wrap.className = 'result-image-wrap';
    var img = document.createElement('img');
    img.src = imageDataUrl;
    img.alt = 'Generated AR filter';
    img.style.background = 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 20px 20px';
    wrap.appendChild(img);

    var useInAr = document.createElement('button');
    useInAr.className = 'use-in-ar-btn';
    useInAr.innerHTML = '<span>🤳</span><span>Use in AR</span>';
    useInAr.addEventListener('click', function () {
      sessionStorage.setItem('arGeneratedImage', imageDataUrl);
      window.location.href = '../ar_filters_ui/ar_camera.html';
    });

    resultContent.appendChild(wrap);
    resultContent.appendChild(useInAr);
    setLoading(false);
  }

  function showPlaceholder() {
    lastGeneratedDataUrl = null;
    resultContent.className = 'result-placeholder';
    resultContent.innerHTML = 'Describe your AR filter and click Generate. The AI will create a face overlay image you can apply with the AR camera.';
  }

  // ── Image generation (direct HF API call from browser) ────────────
  async function callHuggingFaceImage(prompt, retries) {
    if (retries === undefined) retries = 2;

    var res = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + _k(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt.substring(0, 1000) }),
    });

    if (res.status === 503 && retries > 0) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      return callHuggingFaceImage(prompt, retries - 1);
    }

    if (!res.ok) {
      var errText = await res.text();
      var errMsg = errText;
      try { var j = JSON.parse(errText); errMsg = j.error || j.message || errText; } catch (_) {}
      if (res.status === 401) throw new Error('API authentication failed.');
      if (res.status === 429) throw new Error('Rate limited. Wait a moment and try again.');
      if (res.status === 503) throw new Error('Model is loading. Try again in ~30 seconds.');
      throw new Error(errMsg || 'Image generation failed (' + res.status + ')');
    }

    return await res.blob();
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Failed to read image')); };
      reader.readAsDataURL(blob);
    });
  }

  async function generate() {
    var prompt = (promptInput && promptInput.value || '').trim();
    if (!prompt) {
      showError('Please describe the AR filter you want.');
      return;
    }

    setLoading(true);
    showPlaceholder();

    try {
      var arPrompt = AR_PROMPT_PREFIX + prompt;
      var blob = await callHuggingFaceImage(arPrompt);
      var rawDataUrl = await blobToDataUrl(blob);

      // Remove background to create transparent PNG
      generateBtn.querySelector('.generate-text').textContent = 'Removing background...';
      var cleanDataUrl = await removeBackground(rawDataUrl);

      showResult(cleanDataUrl);
    } catch (err) {
      showError(err.message || 'Could not generate image.');
      setLoading(false);
    }
  }

  if (generateBtn) generateBtn.addEventListener('click', generate);
  if (promptInput) promptInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') generate(); });
})();
