(function () {
  // Auth check
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  if (!isLoggedIn) {
    window.location.href = '../login_signup/login.html';
    return;
  }

  const API_BASE = 'http://localhost:3001';
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
      window.location.href = '../ar_filters_ui/ar_filters.html';
    });

    resultContent.appendChild(wrap);
    resultContent.appendChild(useInAr);
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
        body: JSON.stringify({ prompt: prompt }),
      });
      const data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        showError(data.error || 'Could not generate image.');
        setLoading(false);
        return;
      }

      var dataUrl = data.imageDataUrl || null;
      if (data.imageBase64 && data.mimeType) {
        dataUrl = 'data:' + data.mimeType + ';base64,' + data.imageBase64;
      }
      if (data.imageUrl) {
        dataUrl = data.imageUrl;
      }

      if (dataUrl) {
        showResult(dataUrl);
      } else {
        showError('No image returned from server.');
      }
    } catch (err) {
      showError('Network error. Is the server running on ' + API_BASE + '?');
    }
    setLoading(false);
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
