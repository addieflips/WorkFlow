// Netlify Function: persists the app's state server-side using Netlify Blobs,
// replacing browser localStorage so data survives across devices/browsers.

const { getStore } = require('@netlify/blobs');
const { checkAuth } = require('./_auth');

const KEY = 'state';

exports.handler = async function (event) {
  const denied = checkAuth(event);
  if (denied) return denied;

  const store = getStore('dispatch-state');

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
