require('dotenv').config();
const express = require('express');
const cors = require('cors');

const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = 'microsoft/DialoGPT-medium';
const PORT = process.env.PORT || 3001;

if (!HF_TOKEN || HF_TOKEN === 'your_hugging_face_token_here') {
  console.error('Missing or invalid HF_TOKEN. Set it in server/.env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

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

async function callHuggingFace(prompt, retries = 1) {
  const url = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { max_new_tokens: 100, temperature: 0.8 },
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

  return data;
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

app.listen(PORT, () => {
  console.log(`LifeSync chat API listening on http://localhost:${PORT}`);
});
