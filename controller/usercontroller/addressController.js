exports.addAddress = async (req, res) => {
  try {
    const { fullName, phone, line1, city, state, pincode, addressType } = req.body;

    if (!fullName || !phone || !line1 || !city || !state || !pincode) {
      return res.status(400).json({ 
        success: false, 
        message: 'All address fields are required' 
      });
    }

    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Enter a valid 10-digit phone number' 
      });
    }

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Enter a valid 6-digit PIN code' 
      });
    }

    const foundUser = await User.findById(req.session.user); 

    foundUser.addresses.push({
      fullName,
      phone,
      line1,
      city,
      state,
      pincode,
      addressType: addressType || 'Home',
    });

    await foundUser.save();

    return res.status(200).json({ success: true, message: 'Address saved.' });

  } catch (err) {
    console.error('addAddress error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};