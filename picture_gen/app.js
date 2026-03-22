(function () {
  // Auth check
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  if (!isLoggedIn) {
    // Temporarily disabled for testing live server
    // window.location.href = '../login_signup/login.html';
    // return;
  }

  // ── API server URL ────────────────────────────────────────────────
  // On localhost:  use relative /api/ paths (local dev server)
  // On Pages:      use the Render-hosted server
  const RENDER_URL = 'https://lifesync-picgen.onrender.com';

  function getApiBase() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return '';
    return RENDER_URL;
  }
  const API_BASE = getApiBase();

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

    const wrap = document.createElement('div');
    wrap.className = 'result-image-wrap';
    const img = document.createElement('img');
    img.src = imageDataUrl;
    img.alt = 'Generated AR filter';
    wrap.appendChild(img);

    const useInAr = document.createElement('button');
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

  async function generate() {
    const prompt = (promptInput && promptInput.value || '').trim();
    if (!prompt) {
      showError('Please describe the AR filter you want.');
      return;
    }

    setLoading(true);
    showPlaceholder();

    try {
      const res = await fetch(API_BASE + '/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate image');
      }

      showResult(data.imageDataUrl);
    } catch (err) {
      showError(err.message || 'Could not generate image. Make sure the server is running.');
      setLoading(false);
    }
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', generate);
  }
  if (promptInput) {
    promptInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') generate();
    });
  }
})();
