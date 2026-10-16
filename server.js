const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Atlas Connected Successfully!'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Test Home Route
app.get('/', (req, res) => {
  res.send('Meso Backend API is running live!');
});

// Command API Route (404 Error Furuuf)
app.post('/api/command', async (req, res) => {
  try {
    const { command } = req.body;
    console.log('Received Command:', command);

    return res.status(200).json({
      success: true,
      message: 'Ajajni kee mirkanaa\'eera!',
      data: {
        receivedCommand: command,
        processedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});