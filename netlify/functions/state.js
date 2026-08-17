// Netlify Function: persists the app's state server-side using Netlify Blobs,
// replacing browser localStorage so data survives across devices/browsers.

const { getStore } = require('@netlify/blobs');
const { checkAuth } = require('./_auth');

const KEY = 'state';

// Netlify usually injects Blobs credentials automatically. When that automatic
// wiring is missing (MissingBlobsEnvironmentError), fall back to explicit
// credentials from environment variables so the store still works.
function openStore() {
  try {
    return getStore('dispatch-state');
  } catch (e) {
    const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
    if (siteID && token) {
      return getStore({ name: 'dispatch-state', siteID, token });
    }
    throw e;
  }
}

exports.handler = async function (event) {
  const denied = checkAuth(event);
  if (denied) return denied;

  let store;
  try {
    store = openStore();
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'blobs_unconfigured',
        message: 'Netlify Blobs is not configured. Add BLOBS_SITE_ID and BLOBS_TOKEN environment variables, then redeploy.',
      }),
    };
  }

  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get(KEY, { type: 'json' });
      return { statusCode: 200, body: JSON.stringify(data || null) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Load failed' }) };
    }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
    try {
      await store.setJSON(KEY, body);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Save failed' }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
