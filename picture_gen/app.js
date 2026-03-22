(function () {
  // Auth check
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  if (!isLoggedIn) {
    // Temporarily disabled for testing live server
    // window.location.href = '../login_signup/login.html';
    // return;
  }

  // ── API server URL ────────────────────────────────────────────────
  // When served from GitHub Pages (or any non-localhost origin), the
  // image-generation API lives on your local machine.  Set the server
  // address in the browser console with:
  //   sessionStorage.setItem('apiServer', 'http://192.168.x.x:5501')
  // Or pass it as a ?server= query param.
  //
  // When running on localhost the relative /api/ path works directly.
  function getApiBase() {
    const params = new URLSearchParams(window.location.search);
    const fromParam   = params.get('server');
    const fromStorage = sessionStorage.getItem('apiServer');
    if (fromParam) {
      sessionStorage.setItem('apiServer', fromParam);
      return fromParam;
    }
    if (fromStorage) return fromStorage;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return '';
    // Prompt the user for their server address on first visit from Pages
    return '';
  }
  let API_BASE = getApiBase();

  // ── Server connection bar (shown when not on localhost) ────────────
  const serverBar       = document.getElementById('serverBar');
  const serverInput     = document.getElementById('serverInput');
  const serverConnectBtn = document.getElementById('serverConnectBtn');
  const serverStatusEl  = document.getElementById('serverStatus');

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (!isLocal && serverBar) {
    serverBar.style.display = 'block';
    if (API_BASE) {
      serverInput.value = API_BASE;
      serverStatusEl.textContent = 'Connected';
      serverStatusEl.className = 'server-status connected';
    }
  }

  function connectToServer() {
    let addr = (serverInput.value || '').trim();
    if (!addr) return;
    // Strip trailing slash
    addr = addr.replace(/\/+$/, '');
    // Add http:// if missing
    if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr;
    sessionStorage.setItem('apiServer', addr);
    API_BASE = addr;
    serverStatusEl.textContent = 'Checking...';
    serverStatusEl.className = 'server-status';

    // Quick health check
    fetch(addr + '/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    }).then(r => {
      // Even a 400 means the server is reachable
      serverStatusEl.textContent = 'Connected';
      serverStatusEl.className = 'server-status connected';
    }).catch(() => {
      serverStatusEl.textContent = 'Cannot reach server';
      serverStatusEl.className = 'server-status error';
    });
  }

  if (serverConnectBtn) {
    serverConnectBtn.addEventListener('click', connectToServer);
  }
  if (serverInput) {
    serverInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') connectToServer();
    });
  }

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
    img.alt = 'Generated image';
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
    resultContent.innerHTML = 'Enter a prompt and click Generate. Your image will appear here and you can use it in AR.';
  }

  async function generate() {
    const prompt = (promptInput && promptInput.value || '').trim();
    if (!prompt) {
      showError('Please enter a description for your image.');
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
      showError(err.message || 'Could not generate image');
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
