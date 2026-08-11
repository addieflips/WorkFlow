// Netlify Function: merges multiple email templates into one using the Anthropic API.
// Keeps the API key server-side. Set ANTHROPIC_API_KEY in Netlify env vars.

const { checkAuth } = require('./_auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const denied = checkAuth(event);
  if (denied) return denied;

  let instruction;
  try {
    ({ instruction } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  if (!instruction) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing instruction' }) };
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
        max_tokens: 3000,
        messages: [{ role: 'user', content: instruction }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return { statusCode: resp.status, body: JSON.stringify({ error: 'Anthropic API error', detail }) };
    }

    const data = await resp.json();
    const result = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!result) {
      return { statusCode: 502, body: JSON.stringify({ error: 'No result returned' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ result }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Unknown error' }) };
  }
};
