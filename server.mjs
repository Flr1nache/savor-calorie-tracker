import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import OpenAI from 'openai';
import { z } from 'zod';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const maxPhotoSize = 10 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const webBuildDirectory = resolve('dist');
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPhotoSize, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error('Please upload a JPEG, PNG, WebP, or GIF photo.'));
      return;
    }
    callback(null, true);
  },
});

const scanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: 'You’ve reached the scan limit for this hour. Please try again later.' });
  },
});

const analysisSchema = z.object({
  mealName: z.string().min(1).max(100),
  calories: z.number().int().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  foods: z.array(z.object({
    name: z.string().min(1).max(80),
    portion: z.string().min(1).max(80),
    calories: z.number().int().nonnegative(),
  })).min(1).max(12),
});

app.use((request, response, next) => {
  const origin = request.get('origin');
  if (origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === request.get('host');
    } catch {
      response.status(400).json({ error: 'The request origin is invalid.' });
      return;
    }
    let localDevelopmentOrigin = false;
    if (process.env.NODE_ENV !== 'production') {
      const parsedOrigin = new URL(origin);
      localDevelopmentOrigin =
        ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname) &&
        ['http:', 'https:'].includes(parsedOrigin.protocol);
    }
    if (!sameOrigin && !localDevelopmentOrigin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: 'This website is not allowed to use the AI service.' });
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (request.method === 'OPTIONS') {
    if (!origin) {
      response.status(400).json({ error: 'The request origin is required.' });
      return;
    }
    response.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_request, response) => {
  response.json({ ok: true, aiReady: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/analyze', scanLimiter, upload.single('photo'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'Choose a food photo to scan.' });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: 'AI is not configured. Add OPENAI_API_KEY to the server .env file.' });
    return;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageUrl = `data:${request.file.mimetype};base64,${request.file.buffer.toString('base64')}`;

  let content = null;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_completion_tokens: 700,
      messages: [
        {
          role: 'system',
          content: [
            'You estimate nutrition from a photo of a meal.',
            'Return only a JSON object with this shape: {"mealName":"short meal title","calories":0,"protein":0,"carbs":0,"fat":0,"foods":[{"name":"food","portion":"estimated portion","calories":0}]}',
            'Use integer calories and grams for macronutrients. Include visible food items only. Estimate plausible portions and nutrition; make the food calorie values add up approximately to total calories. Do not give medical advice.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identify the visible food and estimate the meal’s calories and macronutrients.' },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
    });
    content = completion.choices[0]?.message.content ?? null;
  } catch (error) {
    console.error('Food photo analysis provider request failed:', error);
    response.status(502).json({ error: 'The AI service could not analyze this photo. Please try again.' });
    return;
  }

  if (!content) {
    console.error('Food photo analysis returned an empty response.');
    response.status(502).json({ error: 'The AI returned an empty result. Please try another photo.' });
    return;
  }

  let result;
  try {
    result = JSON.parse(content);
  } catch (error) {
    console.error('Food photo analysis returned invalid JSON:', error);
    response.status(502).json({ error: 'The AI returned an unreadable result. Please try again.' });
    return;
  }

  const parsed = analysisSchema.safeParse(result);
  if (!parsed.success) {
    console.error('Food photo analysis returned data outside the expected schema:', parsed.error.issues);
    response.status(502).json({ error: 'The AI returned an incomplete nutrition estimate. Please try again.' });
    return;
  }

  response.json(parsed.data);
});

app.use(express.static(webBuildDirectory, {
  index: false,
  maxAge: '1h',
  setHeaders: (response, filePath) => {
    if (filePath === resolve(webBuildDirectory, 'index.html')) {
      response.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.use((request, response, next) => {
  const indexPath = resolve(webBuildDirectory, 'index.html');
  if (request.method === 'GET' && !request.path.startsWith('/api/') && existsSync(indexPath)) {
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
    return;
  }
  next();
});

app.use((request, response) => {
  response.status(404).json({ error: `No route for ${request.method} ${request.path}.` });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'That photo is too large. Choose an image smaller than 10 MB.' });
      return;
    }
    response.status(400).json({ error: 'The photo upload could not be processed.' });
    return;
  }
  if (error instanceof Error && error.message === 'Please upload a JPEG, PNG, WebP, or GIF photo.') {
    response.status(415).json({ error: error.message });
    return;
  }
  console.error('Unexpected request error:', error);
  response.status(500).json({ error: 'The server could not process this request.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Savor AI server listening on port ${port}`);
});
