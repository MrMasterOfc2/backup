// index.js
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();

// Increase event listeners limit
require('events').EventEmitter.defaultMaxListeners = 500;

// Create necessary directories
const directories = ['./session', './temp'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
});

// Create admin.json if it doesn't exist
const adminPath = './admin.json';
if (!fs.existsSync(adminPath)) {
    const defaultAdmins = ["94741856766"];
    fs.writeFileSync(adminPath, JSON.stringify(defaultAdmins, null, 2));
    console.log('Created admin.json with default admin');
}

// Create numbers.json if it doesn't exist
const numbersPath = './numbers.json';
if (!fs.existsSync(numbersPath)) {
    fs.writeFileSync(numbersPath, JSON.stringify([], null, 2));
    console.log('Created numbers.json');
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Import pair router
const pairRouter = require('./pair');
app.use('/pair', pairRouter);

// Route for pairing page
app.get('/pair-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Route for main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        server: '𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({
        status: 'error',
        message: 'Internal Server Error'
    });
});

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║    🤖 𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸 Bot Server Started!       ║
║                                                   ║
║    🌐 Server: http://localhost:${PORT}           ║
║    📁 Path: ${__dirname}                         ║
║    ⏰ Time: ${new Date().toLocaleString()}        ║
║    🚀 Ready for pairing!                         ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
});

module.exports = app;
