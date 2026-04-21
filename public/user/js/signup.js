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