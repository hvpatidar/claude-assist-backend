require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(cors({ origin: (origin, cb) => cb(null, true) }));
app.use(express.json({ limit: '50kb' }));
app.use('/api/', rateLimit({ windowMs: 60000, max: 30, message: { error: 'RATE_LIMITED' } }));

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
    system: `You are a reminder assistant. Extract the core task and suggest a reminder time.
Always respond with valid JSON:
{"task":"short task description","suggestedTime":"human readable time like tomorrow at 9am","isoOffset":null}`,
    user: t => `Set a reminder based on this:\n\n${t}`
  }
};

app.post('/api/action', async (req, res) => {
  const { action, text, targetLanguage = 'Spanish' } = req.body;

  if (!action || !text) return res.status(400).json({ error: 'Missing action or text' });

  const prompt = PROMPTS[action];
  if (!prompt) return res.status(400).json({ error: `Unknown action: ${action}` });

  if (!GROQ_API_KEY || GROQ_API_KEY === 'your_new_groq_key_here') {
    return res.status(500).json({ error: 'Server API key not configured' });
  }

  const system = typeof prompt.system === 'function' ? prompt.system(targetLanguage) : prompt.system;

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
          { role: 'user', content: prompt.user(text.slice(0, 8000)) }
        ],
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (r.status === 429) return res.status(429).json({ error: 'RATE_LIMITED' });
      return res.status(502).json({ error: e?.error?.message || 'LLM request failed' });
    }

    const d = await r.json();
    res.json({ result: d.choices[0].message.content });

  } catch (e) {
    console.error('Server error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', keyConfigured: !!(GROQ_API_KEY && GROQ_API_KEY !== 'your_new_groq_key_here') });
});

app.listen(PORT, () => {
  console.log(`ClaudeAssist backend running on http://localhost:${PORT}`);
  if (!GROQ_API_KEY || GROQ_API_KEY === 'your_new_groq_key_here') {
    console.warn('WARNING: GROQ_API_KEY not set in .env');
  }
});
