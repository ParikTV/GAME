const mongoose = require('mongoose');
require('dotenv').config(); // Asegura que dotenv esté configurado

const connectDB = async () => {
  try {
    // Usa la variable de entorno MONGODB_URI
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error("Error: La variable de entorno MONGODB_URI no está definida.");
        process.exit(1);
    }

    const conn = await mongoose.connect(mongoUri);

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;