const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Null for System
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  type: { 
    type: String, 
    enum: ['SYSTEM', 'NOTIFICATION', 'USER'], 
    required: true 
  },
  content: { type: String, required: true },
  giftData: {
    giftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gift', default: null },
    amount: { type: Number, default: 0 }
  },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

messageSchema.pre('validate', function validateDestination() {
  if (!this.receiverId && !this.roomId) {
    throw new Error('A message must have a receiver or room');
  }
});

module.exports = mongoose.model('Message', messageSchema);