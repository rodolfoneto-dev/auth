require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const { swaggerUi, swaggerSpec } = require('./config/swagger');

const app = express();
app.use(express.json());

// Documentação interativa Swagger
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));

// Endpoint de Health Check
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRoutes);

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Mongo conectado');

    app.listen(process.env.PORT, () => {
      console.log(`Auth rodando na porta ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Erro ao iniciar:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
