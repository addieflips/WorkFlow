// Netlify Function: keeps the Anthropic API key on the server, never exposed to the browser.
// Set ANTHROPIC_API_KEY in Netlify: Site settings > Environment variables.

const { checkAuth } = require('./_auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const denied = checkAuth(event);
  if (denied) return denied;

  let text, targetLang;
  try {
    ({ text, targetLang } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  if (!text || !targetLang) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing text or targetLang' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Netlify site settings.' }) };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Translate the following business email into ${targetLang}. Keep it natural and professional, as a native speaker would write it — do not translate word-for-word. Do NOT translate proper names or email addresses, leave them exactly as written. Preserve paragraph breaks and the overall structure. Return ONLY the translated email text, with no preamble, explanation, or quotation marks.\n\n---\n${text}`,
        }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return { statusCode: resp.status, body: JSON.stringify({ error: 'Anthropic API error', detail }) };
    }

    const data = await resp.json();
    const translated = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!translated) {
      return { statusCode: 502, body: JSON.stringify({ error: 'No translation returned' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ translated }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Unknown error' }) };
  }
};
