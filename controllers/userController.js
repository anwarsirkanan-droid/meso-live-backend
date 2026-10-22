import User from '../models/User.js';
import bcrypt from 'bcryptjs';

// Get My Profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update My Profile
export const updateProfile = async (req, res) => {
  try {
    const allowedFields = ['username', 'avatar', 'bio', 'region', 'language', 'customId'];
    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get Another User's Public Profile
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('username avatar customId bio wealthLevel charmLevel coins diamonds followers following');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Search Users
export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json([]);
    const users = await User.find({
      $or: [
        { username: { $regex: q.trim(), $options: 'i' } },
        { customId: { $regex: q.trim(), $options: 'i' } },
      ],
    })
      .select('username avatar customId')
      .limit(20);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Follow / Unfollow User
export const toggleFollow = async (req, res) => {
  try {
    const targetId = req.params.id;
    if (String(targetId) === String(req.user._id)) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    const me = await User.findById(req.user._id);
    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const isFollowing = me.following.some(
      (id) => String(id) === String(targetId)
    );

    if (isFollowing) {
      // Unfollow
      await User.updateOne({ _id: me._id }, { $pull: { following: targetId } });
      await User.updateOne({ _id: targetId }, { $pull: { followers: me._id } });
      return res.json({ following: false });
    }

    // Follow
    await User.updateOne({ _id: me._id }, { $addToSet: { following: targetId } });
    await User.updateOne({ _id: targetId }, { $addToSet: { followers: me._id } });
    res.json({ following: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get My Followers
export const getFollowers = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('followers', 'username avatar customId');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.followers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get My Following
export const getFollowing = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('following', 'username avatar customId');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.following);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Change Password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};