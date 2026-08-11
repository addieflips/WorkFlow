// Shared passcode gate for Dispatch's serverless functions.
// Set APP_PASSCODE in Netlify: Site settings > Environment variables.
// The browser sends it as the x-dispatch-key header on every request.

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Returns null when the request is allowed, or a response object to return as-is.
function checkAuth(event) {
  const expected = process.env.APP_PASSCODE;

  if (!expected) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'missing_passcode',
        message:
          'Server is missing APP_PASSCODE. Add it in Netlify: Site settings > Environment variables, then redeploy.',
      }),
    };
  }

  const headers = event.headers || {};
  const provided = headers['x-dispatch-key'] || headers['X-Dispatch-Key'] || '';

  if (!timingSafeEqual(provided, expected)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  return null;
}

module.exports = { checkAuth };
