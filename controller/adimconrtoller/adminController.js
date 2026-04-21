import User from '../../models/user.js';

const getDashboard = async (req, res) => {
  try {
   
    const today = new Date();
    today.setHours(0, 0, 0, 0);

   
    const [
      totalUsers,
      blockedUsers,
      newUsersToday,
      totalAdmins
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ createdAt: { $gte: today } }),
      User.countDocuments({ role: 'admin' })
    ]);

    res.render('admin/dashboard', {
      stats: {
        totalUsers,
        blockedUsers,
        newUsersToday,
        totalAdmins
      },
      admin: req.session.user
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);

    res.status(500).render('error', {
      message: 'Error loading dashboard',
      error: {}
    });
  }
};

export default getDashboard;