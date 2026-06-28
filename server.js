import express from 'express';
import session from 'express-session';
import flash from 'connect-flash';
import dotenv from 'dotenv';
dotenv.config();
import MongoStore from 'connect-mongo';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer }  from 'http';
import { Server } from 'socket.io';

import userRoutes  from './router/userRouters.js';
import adminRoutes from './router/adminRoutes.js';
import connectDB   from './config/db.js';
import passport    from './config/passport.js';
import { addClient } from './public/utils/ssemanager.js';
import { setIO }     from './utils/socket.js';
import { generateMissingReferralCodes } from './controller/usercontroller/profileController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

connectDB().then(() => {
  generateMissingReferralCodes();
});

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setIO(io);

io.on('connection', (socket) => {
  socket.on('join-admin', () => {
    socket.join('admin-room');
  });
});

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use(session({
  secret           : process.env.SESSION_SECRET || 'superSecretKey123',
 
  resave           : true,
  saveUninitialized: false,
  rolling          : true,
  store            : MongoStore.create({
    mongoUrl   : process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/velmora',
    ttl        : 60 * 60 * 24,
    autoRemove : 'native',
   
    touchAfter : 15 * 60,
  }),
  cookie: {
    maxAge  : 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure  : process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.success     = req.flash('success');
  res.locals.error       = req.flash('error');
  res.locals.currentUser = req.user || null;
  res.locals.currentPath = req.path;
  next();
});

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// SSE
app.get('/sse/products', (req, res) => addClient(res));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/',       userRoutes);
app.use('/admin',  adminRoutes);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));