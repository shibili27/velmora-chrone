import ContactMessage from '../models/contact.js';

const VALID_SUBJECTS = ['general', 'order', 'repair', 'press', 'other'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ContactService {
  validatePayload({ fullName, email, subject, message }) {
    const errors = [];

    if (!fullName || fullName.trim().length < 2) {
      errors.push('Please enter your full name.');
    }
    if (!email || !EMAIL_REGEX.test(email.trim())) {
      errors.push('Please enter a valid email address.');
    }
    if (!subject || !VALID_SUBJECTS.includes(subject)) {
      errors.push('Please select a valid subject.');
    }
    if (!message || message.trim().length < 10) {
      errors.push('Message must be at least 10 characters.');
    }

    return errors;
  }

  async createMessage({ fullName, email, subject, message, userId = null }) {
    const errors = this.validatePayload({ fullName, email, subject, message });
    if (errors.length) {
      const err = new Error(errors[0]);
      err.statusCode = 400;
      err.details = errors;
      throw err;
    }

    const doc = await ContactMessage.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      subject,
      message: message.trim(),
      user: userId,
    });

    // Plug in your existing mailer here if you want an admin notification
    // or a confirmation email to the sender, e.g.:
    //
    // import { sendMail } from '../utils/mailer.js';
    // await sendMail({
    //   to: process.env.CONTACT_NOTIFY_EMAIL,
    //   subject: `New contact message: ${subject}`,
    //   text: `${fullName} (${email}) wrote:\n\n${message}`,
    // }).catch(err => console.error('Contact notify email failed:', err));

    return doc;
  }

  async listMessages({ status, page = 1, limit = 20 } = {}) {
    const filter = status ? { status } : {};
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ContactMessage.countDocuments(filter),
    ]);

    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async markStatus(id, status) {
    if (!['new', 'read', 'resolved'].includes(status)) {
      const err = new Error('Invalid status.');
      err.statusCode = 400;
      throw err;
    }
    const doc = await ContactMessage.findByIdAndUpdate(id, { status }, { new: true });
    if (!doc) {
      const err = new Error('Message not found.');
      err.statusCode = 404;
      throw err;
    }
    return doc;
  }
}

export default new ContactService();