# 👁 Phantom Chat

> Self-destructing real-time chat. Messages vanish after being read. No traces left.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** v18+ — https://nodejs.org
- **MongoDB** (local or Atlas) — https://mongodb.com

---

## 📁 Project Structure

```
phantom-chat/
├── server/
│   ├── index.js          # Express + Socket.IO server entry
│   ├── .env              # Environment config
│   ├── package.json
│   ├── models/
│   │   ├── User.js       # Mongoose user schema
│   │   └── Message.js    # Mongoose message schema
│   ├── routes/
│   │   ├── users.js      # User API routes
│   │   └── messages.js   # Message/admin API routes
│   └── sockets/
│       └── chat.js       # All Socket.IO event handlers
└── client/
    ├── index.html        # Main chat app
    ├── admin.html        # Admin control panel
    ├── css/
    │   ├── style.css     # Chat UI styles
    │   └── admin.css     # Admin panel styles
    └── js/
        ├── app.js        # Chat frontend logic
        └── admin.js      # Admin panel logic
```

---

## ⚙️ Installation & Running Locally

### Step 1 — Install dependencies

```bash
cd phantom-chat/server
npm install
```

### Step 2 — Configure environment

Edit `server/.env`:

```env
MONGO_URI=mongodb://127.0.0.1:27017/phantomchat
PORT=3000
ADMIN_KEY=admin123
```

**Using MongoDB Atlas (cloud)?** Replace MONGO_URI with your Atlas connection string:
```env
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/phantomchat
```

### Step 3 — Start MongoDB (if running locally)

```bash
# macOS (with Homebrew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Windows
net start MongoDB
```

### Step 4 — Start the server

```bash
cd phantom-chat/server

# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

### Step 5 — Open the app

- **Chat app:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin

---

## 🔐 Admin Credentials

| Field    | Value      |
|----------|------------|
| Username | `admin`    |
| Password | `admin123` |

> To change credentials, edit `ADMIN_KEY` in `.env` and the constants in `client/js/admin.js`

---

## 💬 How to Use

### Chat
1. Open http://localhost:3000 in two different browser tabs/windows
2. Enter different usernames in each tab
3. Click a username in the sidebar to open a chat
4. Select a self-destruct timer (15s / 30s / 45s / 60s)
5. Send a message — the countdown starts when the receiver opens the chat

### Admin Panel
1. Go to http://localhost:3000/admin
2. Login with `admin` / `admin123`
3. **Users tab** — see all registered users and their online status
4. **Messages tab** — view, edit, or delete any message in real-time
5. **Conversations tab** — view all conversations, delete entire threads

---

## ⏱ Self-Destruct Flow

```
1. Sender picks timer (15/30/45/60s) and sends message
2. Message stored in DB with seen=false
3. Message appears in both users' UI with "👁 opens in Xs" label
4. When receiver opens the chat → message marked seen=true
5. Countdown timer starts (visible to both users)
6. Timer hits 0 → message deleted from DB, removed from both UIs instantly
```

---


## 🛡 Security Notes

- All user input is sanitized (XSS prevention via `xss` library + DOM text nodes)
- Message length capped at 500 characters
- Admin routes protected by `ADMIN_KEY` environment variable
- Socket admin events verify `adminKey` before executing
- Username characters restricted to alphanumeric + `_` and `-`

---

## 🔧 Customization

| What | Where |
|------|-------|
| Self-destruct timer options | `client/index.html` timer radio inputs |
| Message max length | `server/models/Message.js` + `client/js/app.js` |
| Admin credentials | `server/.env` (ADMIN_KEY) + `client/js/admin.js` |
| UI colors/theme | `client/css/style.css` CSS variables |
| MongoDB database name | `server/.env` MONGO_URI |

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Real-time | Socket.IO |
| Database | MongoDB + Mongoose |
| Frontend | Vanilla HTML/CSS/JS |
| Fonts | Space Mono + Syne (Google Fonts) |
