const Room = require('../models/roomModel'); // Maqaa model kee irratti hundaa'i

// 1. Room Uumuu (Create Room)
exports.createRoom = async (req, res, next) => {
  try {
    const { title, category, description } = req.body;

    // Fayyadamaan seeneeraa ykn hin seenne mirkaneessuu
    if (!req.user || !req.user._id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized: Please login first' 
      });
    }

    // Room haaraa deetaabeesii keessatti uumuu
    const newRoom = await Room.create({
      host: req.user._id,
      title: title || 'Meso Live Room',
      category: category || 'Party',
      isLive: true
    });

    // Room ID fi deebii guutuu erguu (Frontend 'roomId' akka argatuuf)
    return res.status(201).json({
      success: true,
      roomId: newRoom._id, // Rakkoo "The server did not return a room ID" hiikuuf
      room: newRoom,
      message: 'Room created successfully'
    });
  } catch (error) {
    // 'next is not a function' akka hin jenneef errorHandler-tti dabarsa
    next(error);
  }
};

// 2. Room-wwan Live jiran fiduu (Get All Live Rooms)
exports.getRooms = async (req, res, next) => {
  try {
    const rooms = await Room.find({ isLive: true }).populate('host', 'name username profilePic');
    
    return res.status(200).json({
      success: true,
      count: rooms.length,
      rooms: rooms || []
    });
  } catch (error) {
    next(error);
  }
};