import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  email: String,
  otp: String,
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 
  }
});

const OTP = mongoose.model("OTP", otpSchema);

export default OTP;