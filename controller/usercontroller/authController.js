import User from '../../models/user.js';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';


const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendOTP = async (email, otp) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}. It is valid for 5 minutes.`
    });

    console.log("OTP sent:", otp);
  } catch (error) {
    console.log("Error sending OTP:", error);
    throw error;
  }
};


const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    
    if (!user) {
      req.flash('authError',   'No account found with that email address.');
      req.flash('errorSource', 'email');
      req.flash('formEmail',   email);
      return res.redirect('/login');
    }

   
    if (user.isBlocked) {
      req.flash('authError',   'Your account has been blocked. Please contact support.');
      req.flash('errorSource', 'email');
      req.flash('formEmail',   email);
      return res.redirect('/login');
    }

   
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      req.flash('authError',   'The passcode you entered is incorrect.');
      req.flash('errorSource', 'password');
      req.flash('formEmail',   email);
      return res.redirect('/login');
    }

    req.session.user = user._id;

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    res.redirect('/');
  } catch (error) {
    console.log(error);
    res.status(500).send("Login error");
  }
};


const sendSignupOtp = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name?.trim())
      return res.status(400).json({ success: false, field: "name", message: "Full name is required." });
    if (!/^[a-zA-Z\s]+$/.test(name.trim()))
      return res.status(400).json({ success: false, field: "name", message: "Only letters and spaces allowed." });
    if (name.trim().length < 3)
      return res.status(400).json({ success: false, field: "name", message: "Name must be at least 3 characters." });
    if (!email?.trim())
      return res.status(400).json({ success: false, field: "email", message: "Email is required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, field: "email", message: "Invalid email format." });
    if (!password)
      return res.status(400).json({ success: false, field: "password", message: "Password is required." });
    if (password.length < 8)
      return res.status(400).json({ success: false, field: "password", message: "Minimum 8 characters required." });
    if (!/[A-Z]/.test(password))
      return res.status(400).json({ success: false, field: "password", message: "Add at least one uppercase letter." });
    if (!/[0-9]/.test(password))
      return res.status(400).json({ success: false, field: "password", message: "Add at least one number." });
    if (!/[^A-Za-z0-9]/.test(password))
      return res.status(400).json({ success: false, field: "password", message: "Add at least one special character." });
    if (!confirmPassword)
      return res.status(400).json({ success: false, field: "confirmPassword", message: "Confirm your password." });
    if (password !== confirmPassword)
      return res.status(400).json({ success: false, field: "confirmPassword", message: "Passwords do not match." });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, field: "email", message: "Email already registered." });

    const otp = generateOTP();

    req.session.signupOTP       = otp;
    req.session.signupEmail     = email;
    req.session.signupName      = name;
    req.session.signupPassword  = password;
    req.session.signupOTPExpiry = Date.now() + 5 * 60 * 1000;

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    await sendOTP(email, otp);

    return res.json({ success: true, message: "OTP sent successfully" });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Server error. Try again." });
  }
};


const verifySignupOTP = async (req, res) => {
  try {
    const otp      = req.body.otp ? req.body.otp.toString().trim() : '';
    const name     = req.session.signupName;
    const password = req.session.signupPassword;
    const email    = req.session.signupEmail;

    if (!req.session.signupOTP || !email) {
      return res.json({ success: false, message: "Session expired. Please signup again." });
    }

    if (!req.session.signupOTPExpiry || Date.now() > req.session.signupOTPExpiry) {
      return res.json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    if (otp !== req.session.signupOTP.toString().trim()) {
      return res.json({ success: false, message: "Invalid OTP. Please try again." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.json({ success: false, message: "Email already registered. Please login." });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed });
    await user.save();

    req.session.signupOTP       = null;
    req.session.signupEmail     = null;
    req.session.signupName      = null;
    req.session.signupPassword  = null;
    req.session.signupOTPExpiry = null;

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    return res.json({ success: true, message: "Account created! Redirecting to login..." });

  } catch (error) {
    console.log('verifySignupOTP error:', error);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};


const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: false, message: "Email not registered." });
    }

  
    if (user.isBlocked) {
      return res.json({ success: false, message: "Your account has been blocked. Please contact support." });
    }

    const otp = generateOTP();

    req.session.resetOTP       = otp;
    req.session.resetEmail     = email;
    req.session.resetOTPExpiry = Date.now() + 5 * 60 * 1000;

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    await sendOTP(email, otp);

    return res.json({ success: true, message: "OTP sent successfully." });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};


const verifyResetOTP = async (req, res) => {
  try {
    const otp = req.body.otp ? req.body.otp.toString().trim() : '';

    console.log('=== verifyResetOTP ===');
    console.log('body otp:', otp);
    console.log('session resetOTP:', req.session.resetOTP);
    console.log('session resetEmail:', req.session.resetEmail);

    if (!req.session.resetOTP || !req.session.resetEmail) {
      return res.json({ success: false, message: "Session expired. Please try again." });
    }

    if (!req.session.resetOTPExpiry || Date.now() > req.session.resetOTPExpiry) {
      return res.json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    if (otp !== req.session.resetOTP.toString().trim()) {
      return res.json({ success: false, message: "Invalid OTP. Please try again." });
    }

    req.session.otpVerified = true;

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    return res.json({ success: true, message: "OTP verified! Redirecting..." });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;

    if (!req.session.otpVerified) {
      return res.redirect('/forget-password');
    }

    if (password !== confirmPassword) {
      return res.render('user/newPassword', { error: "Passwords do not match" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await User.updateOne(
      { email: req.session.resetEmail },
      { $set: { password: hashed } }
    );

    req.session.resetOTP       = null;
    req.session.resetEmail     = null;
    req.session.resetOTPExpiry = null;
    req.session.otpVerified    = null;

    res.redirect("/login");
  } catch (error) {
    console.log(error);
    res.status(500).send("Reset password error");
  }
};

const resendOTP = async (req, res) => {
  try {
    const email = req.session.resetEmail || req.session.signupEmail;

    if (!email) {
      return res.json({ success: false, message: "Session expired. Please start again." });
    }

    const otp    = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;

    if (req.session.resetEmail) {
      req.session.resetOTP       = otp;
      req.session.resetOTPExpiry = expiry;
    } else {
      req.session.signupOTP       = otp;
      req.session.signupOTPExpiry = expiry;
    }

    await new Promise((resolve, reject) => {
      req.session.save(err => err ? reject(err) : resolve());
    });

    await sendOTP(email, otp);

    console.log('OTP resent:', otp);

    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: "Failed to resend OTP." });
  }
};

export default {
  login,
  sendSignupOtp,
  verifySignupOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  resendOTP
};