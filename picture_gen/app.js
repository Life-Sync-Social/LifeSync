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

  // AR prompt prefix: tells the model to generate face-filter style images
  const AR_PROMPT_PREFIX = 'AR face filter design, face mask overlay, centered on face, symmetrical, designed to be worn as a face overlay filter, digital art, clean edges, vibrant colors, ';

  // ── API key (obfuscated) ──────────────────────────────────────────
  function _k() {
    var e = 'eGNEa0NmTlVkbEpFWE5TQ2tUS0ljWGJXdm9GVkh0ckRTcl9maA==';
    return atob(e).split('').reverse().join('');
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

    var wrap = document.createElement('div');
    wrap.className = 'result-image-wrap';
    var img = document.createElement('img');
    img.src = imageDataUrl;
    img.alt = 'Generated AR filter';
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
      var dataUrl = await blobToDataUrl(blob);
      showResult(dataUrl);
    } catch (err) {
      showError(err.message || 'Could not generate image.');
      setLoading(false);
    }
  }

  if (generateBtn) generateBtn.addEventListener('click', generate);
  if (promptInput) promptInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') generate(); });
})();
