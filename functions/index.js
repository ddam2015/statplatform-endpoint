const express = require('express');
const app = express();
const axios = require('axios');
const serverless = require('serverless-http');
const router = express.Router();
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv').config({path:'../.env'});
const zlib = require('zlib');
// const { realtimeDb, firestoreDb } = require('../firebase-admin-config');
// const rateLimit = require('express-rate-limit');
const { requestLogger } = require('../log/log');
const { errorLogger } = require('../log/error_log');
const ipAndCountryBlocker = require('../access/black_list');

// List of allowed origins
const allowedOrigins = ['https://sportspassports.com', 'https://statplatform.sportspassports.com', 'http://dev.statplatform.sportspassports.com:8080', 'https://expressjs.sportspassports.com', 'http://dev.statplatform.sportspassports.com:19006', 'https://dev.sportspassports.com', 'http://dev.statplatform.sportspassports.com:3000'];

// CORS options
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if the origin is in the list of allowed origins
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
};

// Rate limit rule
// const limiter = rateLimit({
//   windowMs: 5 * 60 * 1000, // 5 minutes
//   max: 300,
//   message: 'Too many requests from this IP, please try again later.',
// });

const getRequestCount = {};

const customRateLimiter = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();

  if (!getRequestCount[ip]) {
    getRequestCount[ip] = { count: 1, timestamp: now };
  } else {
    const { count, timestamp } = getRequestCount[ip];

    if (now - timestamp < 5 * 60 * 1000) { // 5 minutes
      if (count < 1000) {
        getRequestCount[ip].count += 1;
      } else {
        return res.status(429).send('Too many requests. Please try again later.');
      }
    } else {
      getRequestCount[ip] = { count: 1, timestamp: now };
    }
  }
  next();
};

app.use(customRateLimiter);
app.use(cors(corsOptions));
app.use(compression());
// Body Parser: Get request body data
app.use(bodyParser.json());
// app.use(limiter);
app.use('/', router);
app.use(requestLogger);
app.use(ipAndCountryBlocker);

const siteUrl = (hostType) => {
  if(hostType.includes('dev.')){
    return 'https://dev.sportspassports.com';
  }else{
    return'https://sportspassports.com';
  }
}

// Firestore Route - Get Data
// app.get('/player-stats/:siteType/:eventId/:gameId/:playerId', async (req, res) => {
//   const getSiteType = req.params.siteType;
//   const getEventId = req.params.eventId;
//   const getGameId = req.params.gameId;
//   const getPlayerId = req.params.playerId;
//   try {

//     // Traverse through the Firestore collections and documents
//     const docRef = firestoreDb.collection(getSiteType).doc(getEventId).collection(getGameId).doc(getPlayerId);
    
//     const doc = await docRef.get();
//     if (!doc.exists) {
//       res.status(404).send('Document not found');
//     } else {
//       // Get all fields of the document
//       const playerData = doc.data();
//       res.json(playerData); // Send the entire document data as JSON
//     }
//   } catch (error) {
//     console.error('Error fetching document: ', error);
//     res.status(500).send('Error fetching document');
//   }
// });

// GET: Remote data
app.get('/api/v1/:requestType/:requestId/:argsId', cors(corsOptions), (req, res) => {
  const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  const getRequestType = req.params.requestType;
  const getRequestId = req.params.requestId;
  const getArgsId = req.params.argsId;
  let dataUrl = siteUrl(fullUrl) + '/wp-json/app-data-request/v1/' + getRequestType + '/' + getRequestId + '/' + getArgsId;
//   let dataUrl = siteUrl(fullUrl) + '/wp-json/app-data-request/v1/' + getRequestType + '/' + getRequestId;
//   (getRequestId) ? paramId = getRequestId : paramId = 0;
  if(getRequestType == 'stats'){
    dataUrl = 'https://sportspassports.com/features/v1/stat-leaderboard/?admin_keys=' + process.env.STAT_LEADERBOARD_ADMIN_KEY;
  }
//   const authToken = req.headers.authorization;
//   if(authToken && authToken.startsWith('Bearer ')){
//     const token = authToken.slice(7, authToken.length); // Remove "Bearer " from start
//     const authorizationSecretKeys = process.env.REACT_APP_SECRET_KEY;
//     if(token === authorizationSecretKeys){
      axios.get(`${dataUrl}`)
      .then(response => {
        // Handle the response data here
        res.json(response.data);
      })
      .catch(error => {
        // Handle any errors here
        console.error('Error:', error);
      });
//     }else{
//       res.status(401).send('Unauthorized');  
//     }
//   }else{
//     res.status(401).send('Unauthorized');
//   }
});

// POST: Remote request post data: submit player stats to spp
app.post('/post/api/v1/:requestType', async (req, res) => {
  const getRequestType = req.params.requestType;
  const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  const sppUrl = siteUrl(fullUrl) + '/wp-json/app-post-request/v1/' + getRequestType;
  const data = req.body;
  const authToken = req.headers.authorization;
  if(authToken && authToken.startsWith('Bearer ')){
    const token = authToken.slice(7, authToken.length); // Remove "Bearer " from start
    const authorizationSecretKeys = process.env.REACT_APP_SECRET_KEY;
    if(token === authorizationSecretKeys){
      try {
        const response = await axios.post(sppUrl, data, {
          // Use auth if login is required.
          // auth: {
          //   username: 'your_username',
          //   password: 'your_password'
          // }
        });
        res.send(response.data);
      } catch (error) {
        res.status(500).send(error.message);
      }
    }else{
      res.status(401).send('Unauthorized');  
    }
  }else{
    res.status(401).send('Unauthorized');
  }
});

// GET: player stats
app.get('/v1/api/player-stat/:eventId/:gameId', async (req, res) => {
  const getEventId = req.params.eventId;
  const getGameId = req.params.gameId;
  try {
//     // Get the full URL of the request
    const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    const sppUrl = siteUrl(fullUrl) + '/wp-json/get-player-stats/v1/' + getEventId + '/' + getGameId;
    const headers = {
      'Content-Type': 'application/json'
    };

    const response = await axios.get(sppUrl, { headers });
    const jsonString = JSON.stringify(response.data);
    // Compress the JSON string using gzip
    zlib.gzip(jsonString, (err, compressedData) => {
      if(err){
        // Handle error
        console.error('Error compressing data:', err);
        res.status(500).send('Internal Server Error');
        return;
      }
      // Set response headers to indicate gzip compression
      res.set({
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip'
      });
      // Send compressed data as response
      res.send(compressedData);
    });
  }
  catch (error) {
    const errorStatus = error.response ? error.response.status : 500;
    res.status(errorStatus).send(error.response ? error.response.data : 'Internal Server Error');
  }  
});

// app.get('/delete-stats/:siteType/:eventId', (req, res) => {
//   const getSiteType = req.params.siteType;
//   const getEventId = req.params.eventId;
// //   Get a reference to the database
//   const db = realtimeDb; // Use devRealTimeDB or realTimeDB based on your environment
// //   const db = getDatabase(getSiteType).database(); // Use devRealTimeDB or realTimeDB based on your environment

//   if (getEventId === '_' && getSiteType === '_') {
//     // Delete all data at the root level
//     db.ref('/').remove()
//       .then(() => {
//         console.log("Data deleted successfully.");
//         res.status(200).send("Data deleted successfully.");
//       })
//       .catch((error) => {
//         console.error("Error deleting data:", error);
//         res.status(500).send("Error deleting data:", error);
//       });
//   } 
//   else if (getEventId === '_') {
//     // Delete all data for a specific siteType
//     db.ref(`/playerStats/${getSiteType}`).remove()
//       .then(() => {
//         console.log("Data deleted successfully.");
//         res.status(200).send("Data deleted successfully.");
//       })
//       .catch((error) => {
//         console.error("Error deleting data:", error);
//         res.status(500).send("Error deleting data:", error);
//       });
//   } else {
//     // Delete data for a specific siteType and eventId
//     db.ref(`/playerStats/${getSiteType}/${getEventId}`).remove()
//       .then(() => {
//         console.log("Data deleted successfully.");
//         res.status(200).send("Data deleted successfully.");
//       })
//       .catch((error) => {
//         console.error("Error deleting data:", error);
//         res.status(500).send("Error deleting data:", error);
//       });
//   }
// });

app.get('/', (req, res) => {
  res.send('Hello 7000');
});


app.get('/welcome', (req, res) => {
  res.send('Welcome Stat Platform');
});

app.use(errorLogger);

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


module.exports.handler = serverless(app);