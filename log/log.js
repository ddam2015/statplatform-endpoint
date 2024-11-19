const { firestoreDb } = require('../firebase-admin-config');
const dotenv = require('dotenv').config({path:'../.env'});
const moment = require('moment-timezone');
const geoip = require('geoip-lite');

// Request counter for tracking request counts for each endpoint
const requestCounter = {};
const collectionTracker = {}; // Track whether each endpoint should use dev_logs or live_logs
const isDev = process.env.SPP_DEV_STAT_PLATFORM;

// Utility function to sanitize the endpoint for Firestore collection names
const sanitizeEndpoint = (endpoint) => {
  return endpoint.replace(/[\/\?#:]/g, '_'); // Replace special characters
};

// Utility function to get the current year and month
const getYearMonth = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Ensure month is two digits
  return `${year}_${month}`; // Return in the format "YYYY_MM"
};

// Utility function to get the current timestamp in Los Angeles time
const getLosAngelesTimestamp = () => {
  return moment.tz(new Date(), 'America/Los_Angeles').format(); // Get timestamp in ISO 8601 format
};

// Function to get geolocation data (IP, country, region)
const getGeoLocation = (ip) => {
  const geo = geoip.lookup(ip);
  if (geo) {
    return {
      country: geo.country || 'Unknown',
      region: geo.region || 'Unknown',
    };
  }
  return { country: 'Unknown', region: 'Unknown' };
};

// Function to determine the correct collection (dev_logs or live_logs) based on the URL
const getCollectionName = (req) => {
  const urlContainsDev = req.hostname.includes(isDev);
  return urlContainsDev ? 'dev_logs' : 'live_logs';
};

// Middleware for logging requests
const requestLogger = (req, res, next) => {
  const endpoint = req.originalUrl;
  const sanitizedEndpoint = sanitizeEndpoint(endpoint); // Sanitize the endpoint name
  const logYearMonth = getYearMonth(); // Get the year and month

  // Track request count for each endpoint
  requestCounter[endpoint] = (requestCounter[endpoint] || 0) + 1;

  // Get the requester's IP address
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
  const { country, region } = getGeoLocation(ip); // Get country and region based on IP

  // Determine the collection based on whether the URL contains isDev
  const collectionName = getCollectionName(req);

  // Track the collection for each endpoint (so we can use it in `writeSummary`)
  collectionTracker[endpoint] = collectionName;

  // Start time for calculating load time
  const startTime = process.hrtime();

  // Log when the response is about to be sent
  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const loadTime = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3); // Convert to milliseconds
    const timestamp = getLosAngelesTimestamp(); // Get timestamp in Los Angeles time

    // Create log entry for the request
    const logEntry = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      loadTime: `${loadTime}ms`,
      timestamp,
      ip,
      country,
      region,
    };

    // Save log entry to Firestore in the desired hierarchical structure
    firestoreDb.collection(collectionName) // Save in either dev_logs or live_logs
      .doc(logYearMonth) // Year and month as document
      .collection(sanitizedEndpoint) // Endpoint as sub-collection
      .doc(getLosAngelesTimestamp()) // Auto-generate document ID for the log entry
      .set(logEntry)
      .catch((error) => {
        console.error(`Failed to save log entry to Firestore (${collectionName}):`, error.message);
      });
  });

  next();
};

// Function to write request summary to Firestore
const writeSummary = () => {
  console.log('writeSummary invoked'); // Debug log

  const logYearMonth = getYearMonth();

  Object.entries(requestCounter).forEach(([endpoint, count]) => {
    const sanitizedEndpoint = sanitizeEndpoint(endpoint); // Sanitize the endpoint name
    const collectionName = collectionTracker[endpoint] || 'live_logs'; // Use the tracked collection name or default to live_logs

    const summary = {
      endpoint,
      requests: count,
      timestamp: getLosAngelesTimestamp(), // Get timestamp in Los Angeles time
    };

    // Save summary to Firestore in the appropriate collection (dev_logs or live_logs)
    firestoreDb.collection(collectionName)
      .doc(logYearMonth) // Year and month as document
      .collection(sanitizedEndpoint) // Store the summary in the same sub-collection as logs
      .doc('0_summary') // Use a fixed document ID for the summary
      .set(summary, { merge: true }) // Merge so the summary gets updated with new counts
      .then(() => {
        console.log(`Request summary saved for ${collectionName}/${logYearMonth}/${sanitizedEndpoint}`);
      })
      .catch((error) => {
        console.error(`Failed to save request summary to Firestore (${collectionName}):`, error.message);
      });
  });
};

// Set up a periodic invocation of writeSummary (for testing)
setInterval(() => {
  writeSummary();
}, (6 * 60 * 60000)); // Write summary every 6 hours

// Export the middleware and the summary function
module.exports = {
  writeSummary,
  requestLogger
};
