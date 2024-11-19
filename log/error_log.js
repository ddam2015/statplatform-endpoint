const { firestoreDb } = require('../firebase-admin-config');
const dotenv = require('dotenv').config({path:'../.env'});
const moment = require('moment-timezone');
const geoip = require('geoip-lite');

// Utility function to get the current timestamp in Los Angeles time
const getLosAngelesTimestamp = () => {
  return moment.tz(new Date(), 'America/Los_Angeles').format();
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

// Function to determine if it's a dev or live environment
const isDevEnvironment = (req) => {
  return req.hostname.includes(process.env.SPP_DEV_STAT_PLATFORM);
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  // Get the requester's IP address
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
  const { country, region } = getGeoLocation(ip);
  const timestamp = getLosAngelesTimestamp();

  // Determine the appropriate collection (dev_error_logs or live_error_logs)
  const errorLogCollection = isDevEnvironment(req) ? 'dev_error_logs' : 'live_error_logs';

  // Create the error log entry
  const errorLogEntry = {
    error: err.message,
    method: req.method,
    url: req.originalUrl,
    status: res.statusCode || 500,
    ip,
    country,
    region,
    timestamp,
  };

  // Save the error log to Firestore under the appropriate collection
  firestoreDb.collection(errorLogCollection)
    .doc(new Date().toISOString()) // Auto-generate document ID
    .set(errorLogEntry)
    .then(() => {
      console.log(`Error log entry saved to ${errorLogCollection}.`);
    })
    .catch((error) => {
      console.error(`Failed to save error log entry to Firestore (${errorLogCollection}):`, error.message);
    });

  // Respond with a 500 status code and a message
  res.status(500).send('Critical Error');
};

// Export the errorLogger middleware
module.exports = { errorLogger };
