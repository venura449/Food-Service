const Notification = require('../models/Notification');
const User = require('../models/User');

async function createNotification({
  userId,
  type,
  title,
  message,
  resourceType = '',
  resourceId = '',
}) {
  if (!userId || !title || !message) return null;
  return Notification.create({
    userId,
    type,
    title,
    message,
    resourceType,
    resourceId: resourceId ? String(resourceId) : '',
  });
}

module.exports = { createNotification };

async function createAdminNotifications(payload) {
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  if (!admins.length) return [];
  return Promise.all(
    admins.map((admin) =>
      createNotification({
        ...payload,
        userId: admin._id,
      })
    )
  );
}

module.exports = { createNotification, createAdminNotifications };
