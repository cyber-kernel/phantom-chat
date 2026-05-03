require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.use('/api/users',    require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));

app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, '../client/admin.html')));

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '../client/index.html')));

require('./sockets/chat')(io);

const PORT = process.env.PORT || 3000;
const URI  = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/phantomchat';

mongoose.connect(URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () => {
      console.log(`🚀 http://localhost:${PORT}`);
      console.log(`🔐 http://localhost:${PORT}/admin`);
    });
  })
  .catch(err => { console.error('❌ MongoDB error:', err.message); process.exit(1); });