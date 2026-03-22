require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load config.json if it exists, then fall back to .env
let config = {};
const configPath = path.join(__dirname, 'config.json');
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('[config] Loaded settings from config.json');
  }
} catch (e) {
  console.warn('[config] Could not parse config.json:', e.message);
}

const PLACEHOLDER_TOKENS = ['YOUR_HUGGINGFACE_API_KEY_HERE', 'your_hugging_face_token_here'];
const configToken = (config.HF_TOKEN && !PLACEHOLDER_TOKENS.includes(config.HF_TOKEN)) ? config.HF_TOKEN : null;
const HF_TOKEN = configToken || process.env.HF_TOKEN;
const HF_MODEL = config.HF_CHAT_MODEL || process.env.HF_CHAT_MODEL || 'HuggingFaceTB/SmolLM3-3B:hf-inference';
const HF_IMAGE_MODEL = config.HF_IMAGE_MODEL || process.env.HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell';
const PORT = config.PORT || process.env.PORT || 5500;

if (!HF_TOKEN || HF_TOKEN === 'YOUR_HUGGINGFACE_API_KEY_HERE' || HF_TOKEN === 'your_hugging_face_token_here') {
  console.error('Missing or invalid HF_TOKEN. Set your API key in picture_gen/config.json or picture_gen/.env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname, { index: 'index.html' }));
// Serve the parent Master directory so relative paths to ar_filters_ui/ work
app.use(express.static(path.join(__dirname, '..'), { index: false }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const MAX_PRIOR_TURNS = 5;

function buildPrompt(past_user_inputs, generated_responses, text) {
  const past = Array.isArray(past_user_inputs) ? past_user_inputs : [];
  const generated = Array.isArray(generated_responses) ? generated_responses : [];
  const cur = String(text).trim();
  const n = Math.min(past.length, generated.length, MAX_PRIOR_TURNS);
  let out = '';
  const start = Math.max(0, past.length - n);
  for (let i = start; i < past.length; i++) {
    out += `User: ${past[i]}\nBot: ${generated[i]}\n`;
  }
  out += `User: ${cur}\nBot:`;
  return out;
}

function stripThinkTags(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  const thinkRegex = /<think>[\s\S]*?<\/think>/gi;
  out = out.replace(thinkRegex, '').trim();
  if (/^<think>[\s\S]*/i.test(out)) {
    out = out.replace(/^<think>[\s\S]*/i, '').trim();
  }
  return out || text;
}

const HF_CHAT_URL = 'https://router.huggingface.co/v1/chat/completions';

async function callHuggingFace(prompt, retries = 1) {
  const res = await fetch(HF_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.8,
      stream: false,
    }),
  });

  if (res.status === 503 && retries > 0) {
    await new Promise(r => setTimeout(r, 2000));
    return callHuggingFace(prompt, retries - 1);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[HF]', res.status, data.error || data);
    const err = new Error(data.error || `HF API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const content = data.choices?.[0]?.message?.content;
  if (content != null) {
    const cleaned = stripThinkTags(content);
    return { generated_text: cleaned };
  }
  throw new Error(data.error || 'Invalid chat completion response');
}

app.post('/api/chat', async (req, res) => {
  try {
    const { past_user_inputs = [], generated_responses = [], text } = req.body;
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Missing or invalid "text"' });
    }

    const past = Array.isArray(past_user_inputs) ? past_user_inputs : [];
    const generated = Array.isArray(generated_responses) ? generated_responses : [];
    const prompt = buildPrompt(past, generated, text.trim());

    const data = await callHuggingFace(prompt);
    const reply = data.generated_text;
    if (reply == null) {
      return res.status(502).json({ error: 'Invalid response from model' });
    }
    res.json({ reply });
  } catch (e) {
    console.error('[chat]', e.status, e.message);
    const status = e.status || 500;
    const message = e.status === 401 ? 'Invalid API token' :
      e.status === 429 ? 'Rate limited' :
      e.status === 503 ? 'Model loading, try again shortly' :
      'Could not get reply';
    res.status(status).json({ error: message });
  }
});

const PLACEHOLDER_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function callHuggingFaceImage(prompt, retries = 2) {
  const model = HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell';
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;
  console.log('[generate-image] calling', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt.substring(0, 1000),
    }),
  });

  if (res.status === 503 && retries > 0) {
    await new Promise(r => setTimeout(r, 3000));
    return callHuggingFaceImage(prompt, retries - 1);
  }

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = errText;
    try {
      const j = JSON.parse(errText);
      errMsg = j.error || j.message || errText;
    } catch (_) {}
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { imageBase64: buf.toString('base64'), mimeType: 'image/png' };
}

app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing or invalid "prompt"' });
    }
    const trimmed = prompt.trim();
    if (trimmed.length > 2000) {
      return res.status(400).json({ error: 'Prompt too long' });
    }

    let imageBase64;
    let mimeType = 'image/png';

    if (HF_IMAGE_MODEL) {
      const out = await callHuggingFaceImage(trimmed);
      imageBase64 = out.imageBase64;
      mimeType = out.mimeType || mimeType;
    } else {
      imageBase64 = PLACEHOLDER_PNG_BASE64;
    }

    res.json({ imageBase64, mimeType, imageDataUrl: `data:${mimeType};base64,${imageBase64}` });
  } catch (e) {
    console.error('[generate-image]', e.status, e.message);
    const status = e.status || 500;
    const message = e.status === 401 ? 'Invalid API token' :
      e.status === 429 ? 'Rate limited' :
      e.status === 503 ? 'Model loading, try again shortly' :
      'Could not generate image';
    res.status(status).json({ error: message });
  }
});

const HOST = config.HOST || process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Picture Generator listening on http://${HOST}:${PORT}`);
  console.log(`Open http://localhost:${PORT}/index.html to use the app`);
  // Show LAN addresses for iPad / mobile testing
  if (HOST === '0.0.0.0') {
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  LAN: http://${net.address}:${PORT}`);
        }
      }
    }
  }
});
