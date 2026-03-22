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

  // ── Token management ──────────────────────────────────────────────
  // Token is stored in localStorage. Set it via ?token= URL param or
  // enter it in the setup modal on first visit.
  function getToken() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('token');
    if (fromUrl) {
      localStorage.setItem('hf_token', fromUrl);
      // Clean URL
      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', clean);
      return fromUrl;
    }
    return localStorage.getItem('hf_token') || '';
  }

  var hfToken = getToken();

  // ── DOM refs ──────────────────────────────────────────────────────
  const promptInput = document.getElementById('promptInput');
  const generateBtn = document.getElementById('generateBtn');
  const resultContent = document.getElementById('resultContent');
  const errorMsg = document.getElementById('errorMsg');
  const tokenSetup = document.getElementById('tokenSetup');
  const tokenInput = document.getElementById('tokenInput');
  const tokenSaveBtn = document.getElementById('tokenSaveBtn');
  const tokenStatus = document.getElementById('tokenStatus');
  let lastGeneratedDataUrl = null;

  // Show/hide token setup
  function updateTokenUI() {
    if (tokenSetup) {
      if (hfToken) {
        tokenSetup.classList.add('connected');
        tokenSetup.classList.remove('needed');
        if (tokenStatus) tokenStatus.textContent = 'API key saved';
        if (tokenInput) tokenInput.value = hfToken.substring(0, 6) + '...' + hfToken.substring(hfToken.length - 4);
      } else {
        tokenSetup.classList.add('needed');
        tokenSetup.classList.remove('connected');
        if (tokenStatus) tokenStatus.textContent = '';
      }
    }
  }

  function saveToken() {
    var val = (tokenInput && tokenInput.value || '').trim();
    if (!val || val.length < 10) {
      if (tokenStatus) { tokenStatus.textContent = 'Enter a valid HuggingFace token'; tokenStatus.style.color = '#c92a2a'; }
      return;
    }
    localStorage.setItem('hf_token', val);
    hfToken = val;
    updateTokenUI();
  }

  if (tokenSaveBtn) tokenSaveBtn.addEventListener('click', saveToken);
  if (tokenInput) tokenInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') saveToken(); });
  updateTokenUI();

  // ── UI helpers ────────────────────────────────────────────────────
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
        'Authorization': 'Bearer ' + hfToken,
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
      if (res.status === 401) throw new Error('Invalid API token. Check your HuggingFace key.');
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
    if (!hfToken) {
      showError('Please enter your HuggingFace API token first (see the setup bar above).');
      return;
    }

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
