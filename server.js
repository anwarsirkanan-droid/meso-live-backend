const express = require('express');
const app = express();

// Middleware tajaajilaman biroo...
app.use(express.json());

// --- ROUTEWWAN KEESSAN ASII TAA'U ---
// e.g., app.use('/api/rooms', roomRoutes);
// e.g., app.use('/api/users', userRoutes);

// ⚠️ ERROR HANDLING MIDDLEWARE ('next is not a function' fi Server errors qabaachuuf)
app.use((err, req, res, next) => {
  console.error("SERVER ERROR STACK:", err.stack);
  
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});