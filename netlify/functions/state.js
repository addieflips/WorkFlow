// Netlify Function: persists the app's state server-side using Netlify Blobs,
// replacing browser localStorage so data survives across devices/browsers.

const { getStore } = require('@netlify/blobs');
const { checkAuth } = require('./_auth');

const KEY = 'state';

// Netlify usually injects Blobs credentials automatically. When that automatic
// wiring is missing (MissingBlobsEnvironmentError), fall back to explicit
// credentials from environment variables so the store still works.
function openStore(consistency) {
  try {
    return getStore(consistency ? { name: 'dispatch-state', consistency } : 'dispatch-state');
  } catch (e) {
    const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
    if (siteID && token) {
      return getStore({ name: 'dispatch-state', siteID, token, ...(consistency ? { consistency } : {}) });
    }
    throw e;
  }
}

// Reads default to eventual consistency, which can hand back a copy up to a
// minute old: a page opened right after a save would load stale data and its
// next save would wipe the newer changes. Read strongly, and fall back to the
// default read only where strong reads aren't available.
async function readState() {
  try {
    return await openStore('strong').get(KEY, { type: 'json' });
  } catch (e) {
    return await openStore().get(KEY, { type: 'json' });
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
      const data = await readState();
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
      // Each save names the revision it was built on. If another tab or device
      // saved since, send the newer copy back (409) so the page can merge
      // instead of overwriting it.
      const headers = event.headers || {};
      const base = headers['x-base-rev'] || headers['X-Base-Rev'];
      const current = await readState();
      const currentRev = (current && current._rev) || 0;
      if (base !== undefined && current && String(currentRev) !== String(base)) {
        return { statusCode: 409, body: JSON.stringify({ error: 'conflict', state: current }) };
      }
      body._rev = currentRev + 1;
      await store.setJSON(KEY, body);
      return { statusCode: 200, body: JSON.stringify({ ok: true, rev: body._rev }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Save failed' }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
