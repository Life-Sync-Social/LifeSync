(function () {
  // Auth check
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  if (!isLoggedIn) {
    // Temporarily disabled for testing live server
    // window.location.href = '../login_signup/login.html';
    // return;
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
      const res = await fetch('/api/generate-image', {
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
