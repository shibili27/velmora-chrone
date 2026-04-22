import express from 'express';
import session from 'express-session';
import flash from 'connect-flash';
import dotenv from 'dotenv';
dotenv.config();
import MongoStore from 'connect-mongo';
import path from 'path';
import { fileURLToPath } from 'url';

import userRoutes from './router/userRouters.js';
import adminRoutes from './router/adminRoutes.js';
import connectDB from './config/db.js';
import passport from './config/passport.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

connectDB();

const app = express();

// ✅ FIX: increased limit to handle base64 image uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));


app.use(session({
  secret: process.env.SESSION_SECRET || 'superSecretKey123',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/velmora',
    ttl: 60 * 30
  }),
  cookie: {
    maxAge: 10000 * 60 * 30,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
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


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(express.static(path.join(__dirname, 'public')));

app.use('/', userRoutes);
app.use('/admin', adminRoutes);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));