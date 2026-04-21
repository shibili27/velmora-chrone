import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/user.js';
import dotenv from "dotenv";
dotenv.config(); 



passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  '/auth/google/callback'
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const name  = profile.displayName;

    
    let user = await User.findOne({ email });

    if (user) {
 
      if (user.isBlocked) {
        return done(null, false, { message: 'Your account has been blocked. Contact admin for assistance.' });
      }
     
      return done(null, user);
    }

    
    user = await User.create({
      name,
      email,
      password:   null,  
      googleId:   profile.id,
      isVerified: true
    });

    return done(null, user);

  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

export default passport;