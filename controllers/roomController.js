// POST /api/rooms/create — Room uumuu fi ownerId sirrii ta'e qabachuu
export const createRoom = async (req, res) => {
  try {
    const { title, category = 'For You', region = '', language = '' } = req.body;

    // User authenticated ta'e irraa maqaa fudhachuun title qopheessuu
    const user = await User.findById(req.user.id).select('username name');
    const ownerName = user?.name || user?.username || 'Anwar';
    const roomTitle = title || `${ownerName}'s Live Room`;

    // 25 seats grid uumuu
    const seats = Array.from({ length: 25 }, (_, seatIndex) => ({
      seatIndex,
      userId: seatIndex === 0 ? req.user.id : null, // Seat 0 (Host) irratti owner taa'a
    }));

    const room = await Room.create({
      title: roomTitle,
      ownerId: req.user.id, // 👈 Kun ANWAR ID qabachuu qaba
      category,
      region,
      language,
      seats,
      isLive: true
    });

    const populatedRoom = await Room.findById(room._id).populate('ownerId', 'username avatar customId role');
    return res.status(201).json({ message: 'Room created successfully', room: populatedRoom });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};