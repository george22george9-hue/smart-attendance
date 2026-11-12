const fs = require('fs');
const path = require('path');
require('dotenv').config();

const envObject = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
};

const outputContent = `/**
 * Frontend Environment Configuration
 * Automatically generated from .env - DO NOT COMMIT TO GIT
 */
window.ENV = ${JSON.stringify(envObject, null, 2)};
`;

const destPath = path.join(__dirname, '..', 'public', 'js', 'env.js');
fs.writeFileSync(destPath, outputContent, 'utf8');
console.log('[ENV] Generated public/js/env.js from .env successfully!');
