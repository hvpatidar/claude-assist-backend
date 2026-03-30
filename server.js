require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─── Trust Render's proxy ─────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security Headers ─────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS — only allow Chrome extensions ─────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1')
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed'));
    }
  }
}));

app.use(express.json({ limit: '20kb' }));

// ─── Rate Limiting — 20 requests per minute per IP ───────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED' }
}));

// ─── Allowed values (whitelist) ───────────────────────────────────────────
const ALLOWED_ACTIONS = ['summarize', 'explain', 'draft_reply', 'translate', 'reminder'];
const ALLOWED_LANGUAGES = [
  'Hindi', 'Spanish', 'French', 'German', 'Portuguese', 'Italian',
  'Japanese', 'Korean', 'Chinese (Simplified)', 'Arabic', 'Russian',
  'Turkish', 'Dutch', 'Polish', 'Swedish', 'Bengali', 'Urdu'
];
const MAX_TEXT_LENGTH = 8000;

// ─── Prompts ──────────────────────────────────────────────────────────────
const PROMPTS = {
  summarize: {
    system: 'You are a concise summarizer. Summarize the given text in 2-3 clear sentences. Be direct and factual.',
    user: t => `Summarize this:\n\n${t}`
  },
  explain: {
    system: 'You are a helpful explainer. Break down the given text in plain simple language.',
    user: t => `Explain this in simple terms:\n\n${t}`
  },
  draft_reply: {
    system: 'You are a professional writing assistant. Draft a clear reply to the given message. Return only the reply text.',
    user: t => `Draft a reply to this message:\n\n${t}`
  },
  translate: {
    system: lang => `You are a translator. Translate the given text to ${lang}. Return only the translated text.`,
    user: t => t
  },
  reminder: {
    system: 'You are a reminder assistant. Extract the core task and suggest a reminder time. Respond ONLY with valid JSON: {"task":"short task description","suggestedTime":"human readable time","isoOffset":null}',
    user: t => `Set a reminder based on this:\n\n${t}`
  }
};

// ─── Input Validation ─────────────────────────────────────────────────────
function validateRequest(req, res) {
  const { action, text, targetLanguage } = req.body;

  if (!action || typeof action !== 'string' || !ALLOWED_ACTIONS.includes(action)) {
    res.status(400).json({ error: 'Invalid action' });
    return false;
  }

  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Missing text' });
    return false;
  }

  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: 'Text too long' });
    return false;
  }

  if (targetLanguage && !ALLOWED_LANGUAGES.includes(targetLanguage)) {
    res.status(400).json({ error: 'Invalid language' });
    return false;
  }

  return true;
}

// ─── Main Action Endpoint ─────────────────────────────────────────────────
app.post('/api/action', async (req, res) => {
  if (!validateRequest(req, res)) return;

  const { action, text, targetLanguage = 'Spanish' } = req.body;

  if (!GROQ_API_KEY || GROQ_API_KEY === 'your_new_groq_key_here') {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const prompt = PROMPTS[action];
  const lang = ALLOWED_LANGUAGES.includes(targetLanguage) ? targetLanguage : 'Spanish';
  const system = typeof prompt.system === 'function' ? prompt.system(lang) : prompt.system;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt.user(text.slice(0, MAX_TEXT_LENGTH)) }
        ],
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      console.error('Groq error:', r.status);
      if (r.status === 429) return res.status(429).json({ error: 'RATE_LIMITED' });
      return res.status(502).json({ error: 'AI service unavailable. Please try again.' });
    }

    const d = await r.json();
    res.json({ result: d.choices[0].message.content });

  } catch (e) {
    console.error('Server error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Health Check ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    keyConfigured: !!(GROQ_API_KEY && GROQ_API_KEY !== 'your_new_groq_key_here')
  });
});

const keyStatus = GROQ_API_KEY && GROQ_API_KEY !== 'your_new_groq_key_here' ? 'configured' : 'NOT SET';
app.listen(PORT, () => {
  console.log(`ClaudeAssist backend running on http://localhost:${PORT}`);
  console.log(`GROQ_API_KEY: ${keyStatus}`);
});
