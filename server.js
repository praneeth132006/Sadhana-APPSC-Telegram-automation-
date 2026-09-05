// ============================================================================
// Sadhana APPSC Question Dashboard — Local Server & API Proxy (server.js)
// ============================================================================
// What this file does:
// 1. Serves the web dashboard static assets (HTML, CSS, JS) from the dashboard/ directory.
// 2. Provides /api/config to automatically supply the Google Apps Script URL from .env.
// 3. Provides /api/ping to check Google Apps Script connection health directly from Node.
// 4. Provides /api/send to proxy question additions directly to Google Apps Script.
//
// What it brings:
// - Completely eliminates browser CORS (Cross-Origin Resource Sharing) restrictions.
// - Bypasses adblockers and browser extensions that interfere with googleusercontent.com.
// - Auto-fills the Sheet API URL so users do not need to manually paste it every time.
//
// Where changes can be seen:
// - Running `npm run dashboard` starts this server at http://localhost:3000.
// - The dashboard UI loads instantly with green connection indicator and zero network errors.
// ============================================================================

// Load environment variables from .env file into process.env
require('dotenv').config();

// Import built-in Node.js HTTP module to create the local web server
const http = require('http');
// Import built-in Node.js File System module to read static dashboard files
const fs = require('fs');
// Import built-in Node.js Path module to resolve filesystem directory paths
const path = require('path');
// Import built-in Node.js URL module to parse request URLs and query strings
const url = require('url');

// Define port for the dashboard local server (default: 3000)
const PORT = process.env.PORT || 3000;
// Define absolute directory path where dashboard frontend files reside
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');

// MIME types dictionary mapping file extensions to HTTP Content-Type headers
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',       // HTML documents
  '.css': 'text/css; charset=utf-8',          // Stylesheets
  '.js': 'text/javascript; charset=utf-8',    // Client-side scripts
  '.json': 'application/json; charset=utf-8', // JSON data
  '.png': 'image/png',                        // PNG images
  '.svg': 'image/svg+xml'                     // SVG vector graphics
};

/**
 * sendJSON — Helper function to send standardized JSON responses.
 * What it does: Sets Content-Type to application/json, adds CORS headers, and sends stringified body.
 * What it brings: Uniform API response formatting across all dashboard endpoints.
 * Where changes can be seen: HTTP response headers and JSON payload returned to the browser.
 *
 * @param {http.ServerResponse} res - Node HTTP response object
 * @param {number} statusCode - HTTP status code (e.g. 200, 400, 500)
 * @param {Object} data - JavaScript object to serialize as JSON
 */
function sendJSON(res, statusCode, data) {
  // Set the HTTP response status code
  res.statusCode = statusCode;
  // Set Content-Type header to JSON with UTF-8 encoding
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Add CORS headers to allow local requests without browser blocking
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Allow common request headers in preflight or simple requests
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Allow GET, POST, and OPTIONS HTTP methods
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // End response by writing the JSON stringified data
  res.end(JSON.stringify(data));
}

/**
 * serveStaticFile — Reads and serves a file from the dashboard/ directory.
 * What it does: Maps incoming URL path to a local file in dashboard/ and streams it to the client.
 * What it brings: Serves index.html, style.css, app.js without needing external npm packages.
 * Where changes can be seen: Browser loading the dashboard interface at http://localhost:3000.
 *
 * @param {http.ServerResponse} res - Node HTTP response object
 * @param {string} filePath - Absolute path to the file to serve
 */
function serveStaticFile(res, filePath) {
  // Extract file extension to determine the appropriate MIME type
  const ext = path.extname(filePath).toLowerCase();
  // Lookup MIME type or fallback to generic octet-stream binary
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Read file asynchronously from disk
  fs.readFile(filePath, function(err, content) {
    // Check if file read failed (e.g. file does not exist)
    if (err) {
      // If file not found, return 404 error response
      res.statusCode = 404;
      // Set plain text error message
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      // End response with not found text
      res.end('404 Not Found');
      return;
    }
    // Set 200 OK status code for successful file retrieval
    res.statusCode = 200;
    // Set matching Content-Type header
    res.setHeader('Content-Type', contentType);
    // Send file contents to client
    res.end(content);
  });
}

// Create the HTTP server instance handling incoming web requests
const server = http.createServer(async function(req, res) {
  // Parse incoming request URL and query parameters using modern WHATWG URL API
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  // Extract URL pathname (e.g. /, /api/config, /app.js)
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight OPTIONS requests from browser
  if (req.method === 'OPTIONS') {
    // Send 204 No Content with CORS headers
    res.statusCode = 204;
    // Allow any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Allow Content-Type header
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Allow GET, POST, OPTIONS methods
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Complete the response
    res.end();
    return;
  }

  // ==========================================================================
  // API Route: GET /api/config
  // What it does: Returns the configured Google Sheets Web App URL from .env.
  // What it brings: Automatic pre-population of the URL field in the dashboard UI.
  // Where changes can be seen: Dashboard header URL input box automatically has the URL.
  // ==========================================================================
  if (pathname === '/api/config' && req.method === 'GET') {
    // Read the Web App URL from environment variable
    const sheetUrl = process.env.GOOGLE_SHEET_WEBAPP_URL || '';
    // Return the URL as JSON response
    sendJSON(res, 200, { success: true, sheetUrl: sheetUrl });
    return;
  }

  // ==========================================================================
  // API Route: GET /api/ping
  // What it does: Sends a ping request to Google Apps Script from Node.js backend.
  // What it brings: Bypasses browser CORS so connection indicator works reliably.
  // Where changes can be seen: Colored status dot turns green next to the Sheet URL input.
  // ==========================================================================
  if (pathname === '/api/ping' && req.method === 'GET') {
    // Extract target URL from query parameter or fallback to .env configuration
    const targetUrl = parsedUrl.searchParams.get('url') || process.env.GOOGLE_SHEET_WEBAPP_URL || '';

    // Check if a URL was provided or configured
    if (!targetUrl) {
      // Return 400 Bad Request error if URL is missing
      sendJSON(res, 400, { success: false, error: 'No Google Sheet Web App URL configured' });
      return;
    }

    try {
      // Perform server-side HTTP GET request using Node.js native fetch with redirect follow
      const upstreamRes = await fetch(targetUrl + '?action=ping', { redirect: 'follow' });
      // Read response as text to inspect content before parsing
      const text = await upstreamRes.text();

      // Check if response contains HTML login page (indicates permissions need update)
      if (text.includes('accounts.google.com') || text.includes('<!DOCTYPE html') || text.includes('<!doctype html')) {
        // Return descriptive error explaining that "Who has access" must be set to "Anyone"
        sendJSON(res, 200, {
          success: false,
          status: 'auth_required',
          error: 'Google Apps Script requires login. Please redeploy with "Who has access: Anyone".'
        });
        return;
      }

      // Parse JSON response from Apps Script
      const parsed = JSON.parse(text);
      // Return successful ping result to client
      sendJSON(res, 200, { success: true, status: 'ok', data: parsed });
    } catch (err) {
      // Handle network or JSON parse errors
      sendJSON(res, 500, { success: false, status: 'offline', error: err.message });
    }
    return;
  }

  // ==========================================================================
  // API Route: POST /api/send
  // What it does: Receives questions payload from dashboard and forwards to Google Apps Script.
  // What it brings: Complete elimination of browser CORS and redirect issues during POST.
  // Where changes can be seen: Questions successfully append to Google Sheets with toast confirmation.
  // ==========================================================================
  if (pathname === '/api/send' && req.method === 'POST') {
    // Accumulate incoming request body chunks
    let body = '';

    // Listen for incoming data stream chunks
    req.on('data', function(chunk) {
      // Append chunk to body string
      body += chunk;
    });

    // Handle end of incoming request stream
    req.on('end', async function() {
      try {
        // Parse request body JSON
        const payload = JSON.parse(body);
        // Extract target URL from payload or fallback to .env configuration
        const targetUrl = payload.url || process.env.GOOGLE_SHEET_WEBAPP_URL || '';

        // Validate that target URL is present
        if (!targetUrl) {
          sendJSON(res, 400, { success: false, error: 'No Google Sheet Web App URL specified' });
          return;
        }

        // Validate that subject is present
        if (!payload.subject) {
          sendJSON(res, 400, { success: false, error: 'Missing "subject" in payload' });
          return;
        }

        // Validate that questions array is present and non-empty
        if (!payload.questions || payload.questions.length === 0) {
          sendJSON(res, 400, { success: false, error: 'No questions provided in payload' });
          return;
        }

        // Forward payload to Google Apps Script backend using server-to-server fetch
        const upstreamRes = await fetch(targetUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'addQuestions',                                  // Action identifier for Apps Script doPost handler
            subject: payload.subject,                                // Target subject sheet tab
            questions: payload.questions,                            // Array of question objects
            added_by: payload.added_by || payload.addedBy || ''      // Uploader user identity from Firebase Auth
          })
        });

        // Read upstream response as text
        const responseText = await upstreamRes.text();

        // Check if response returned HTML login page instead of JSON
        if (responseText.includes('accounts.google.com') || responseText.includes('<!DOCTYPE html') || responseText.includes('<!doctype html')) {
          sendJSON(res, 200, {
            success: false,
            error: 'Google Apps Script requires login. Please redeploy with "Who has access: Anyone".'
          });
          return;
        }

        // Parse JSON returned by Apps Script
        const result = JSON.parse(responseText);
        // Send result back to the dashboard frontend
        sendJSON(res, 200, result);
      } catch (err) {
        // Catch parsing or network errors and return failure response
        sendJSON(res, 500, { success: false, error: 'Proxy error: ' + err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // Static File Serving (dashboard/)
  // ==========================================================================
  // Default root URL "/" to "/index.html"
  const safePath = pathname === '/' ? '/index.html' : pathname;
  // Resolve absolute file path safely within the dashboard directory
  const filePath = path.join(DASHBOARD_DIR, safePath);

  // Prevent directory traversal attacks by verifying resolved path starts with DASHBOARD_DIR
  if (!filePath.startsWith(DASHBOARD_DIR)) {
    // Return 403 Forbidden if path is outside dashboard directory
    res.statusCode = 403;
    res.end('403 Forbidden');
    return;
  }

  // Check if file exists on disk
  fs.stat(filePath, function(err, stats) {
    // If file does not exist or is a directory, fallback to index.html or 404
    if (err || !stats.isFile()) {
      // Check if index.html exists as fallback
      const indexPath = path.join(DASHBOARD_DIR, 'index.html');
      fs.stat(indexPath, function(errIndex, statsIndex) {
        if (!errIndex && statsIndex.isFile()) {
          serveStaticFile(res, indexPath);
        } else {
          res.statusCode = 404;
          res.end('404 Not Found');
        }
      });
      return;
    }
    // Serve the requested static file
    serveStaticFile(res, filePath);
  });
});

// Start listening for incoming connections on the configured port
server.listen(PORT, function() {
  // Log server start confirmation with clickable local URL
  console.log('====================================================');
  console.log(`🚀 Sadhana APPSC Dashboard running at: http://localhost:${PORT}`);
  console.log(`📡 Google Sheets Web App URL: ${process.env.GOOGLE_SHEET_WEBAPP_URL ? 'Configured ✅' : 'Not set in .env ⚠️'}`);
  console.log('====================================================');
});

// Export server instance for testing or programmatic usage
module.exports = server;
