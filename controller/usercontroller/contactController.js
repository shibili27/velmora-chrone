import contactService from '../../services/contactService.js';

const getContactPage = (req, res) => {
  res.render('user/contact');
};

const submitContactMessage = async (req, res) => {
  try {
    const { fullName, email, subject, message } = req.body;
    const userId = req.user?._id || null;

    const doc = await contactService.createMessage({
      fullName,
      email,
      subject,
      message,
      userId,
    });

    return res.status(201).json({
      success: true,
      message: 'Your message has been sent successfully.',
      id: doc._id,
    });
  } catch (err) {
    console.error('Contact submission error:', err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? 'Something went wrong. Please try again.' : err.message,
    });
  }
};

export default {
  getContactPage,
  submitContactMessage,
};