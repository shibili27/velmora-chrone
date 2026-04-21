import nodemailer from 'nodemailer';

export const sendOTP = async (email, otp) => {
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
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
