const geoip = require('geoip-lite');
const { firestoreDb } = require('../firebase-admin-config');

// Helper function to normalize IP address (convert IPv6-mapped IPv4 to IPv4)
const normalizeIP = (ip) => {
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7); // Strip the ::ffff: prefix
  }
  return ip; // Return the original IP if it's not IPv6-mapped
};

// Function to get blocked IPs and countries from Firestore
const getBlockedData = async () => {
  try {
    // Fetch the document that contains blocked countries
    const getCountry = await firestoreDb.collection('block').doc('country').get();
    // Fetch the document that contains blocked IPs
    const getIps = await firestoreDb.collection('block').doc('IPs').get();

    let blockedCountries = [];
    let blockedIPs = [];

    if (getCountry.exists) {
      const countryData = getCountry.data();
      blockedCountries = Object.values(countryData); // Extract country codes (values) into an array
    } else {
      console.log('No country document found in Firestore!');
    }

    if (getIps.exists) {
      const ipsData = getIps.data();
      blockedIPs = Object.values(ipsData); // Extract IPs (values) into an array
    } else {
      console.log('No IP document found in Firestore!');
    }

    return {
      blockedIPs: blockedIPs || [], // Array of blocked IPs
      blockedCountries: blockedCountries || [] // Array of blocked country codes
    };
  } catch (error) {
    console.error('Error fetching blocked data from Firestore:', error.message);
    return { blockedIPs: [], blockedCountries: [] };
  }
};

// Middleware to block requests based on IP or country
const ipAndCountryBlocker = async (req, res, next) => {
  try {
    const { blockedIPs, blockedCountries } = await getBlockedData(); // Fetch blocked IPs and countries

    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''; // Get the IP address
    ip = normalizeIP(ip); // Normalize the IP address to handle IPv6-mapped IPv4 addresses

    const geo = geoip.lookup(ip); // Get geolocation info

    // Check if IP is blocked
    if (blockedIPs.includes(ip)) {
      return res.status(403).send('Access forbidden');
    }

    // Check if the country is blocked
    if (geo && blockedCountries.includes(geo.country)) {
      return res.status(403).send('Access forbidden');
    }

    next(); // Proceed if neither IP nor country is blocked
  } catch (error) {
    console.error('Error in IP and Country Blocker:', error.message);
    res.status(500).send('Internal Server Error');
  }
};

module.exports = ipAndCountryBlocker;