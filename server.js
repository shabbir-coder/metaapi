const express = require('express');
const connectDB = require('./connection/db');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const routes = require('./api/routes');
const { initializeSocket } = require('./api/middlewares/socket');

require('dotenv').config();

const app = express();
const port = 4008;

connectDB();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
}));

app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'dist')));

app.use('/api', routes);

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/index.html'));
});

const server = http.createServer(app);

server.listen(port, () => {
  console.log(`Secure WebSocket server is running at https://beta.izzan.org:${port}`);
});

const io = initializeSocket(server);
app.set('io', io);

app.get('*', (req, res) => {
   res.redirect('app');
});

module.exports = { io };
