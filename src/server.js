require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const { swaggerUi, swaggerSpec, swaggerMarkdown, swaggerMarkdownHtml } = require('./config/swagger');

const app = express();

// CORS simplificado para desenvolvimento/testes isolados (a política real de CORS é gerenciada pelo Edge Gateway)
app.use(cors());

app.use(express.json());

// Documentação da API
app.get('/docs/preview', (req, res) => res.send(swaggerMarkdownHtml));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));
app.get('/docs.md', (req, res) => res.type('text/markdown').send(swaggerMarkdown));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Endpoint de Health Check
app.get(['/health', '/auth/health'], (req, res) => res.json({ status: 'ok', service: 'auth-service' }));
app.use('/auth', authRoutes);

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Mongo conectado');

    // Auto-seed de usuários demo em staging/dev se o banco estiver vazio
    try {
      const seedDemoUsers = require('../scripts/seed-demo-users');
      await seedDemoUsers();
    } catch (seedErr) {
      console.warn('⚠️ [Auth Server] Aviso ao verificar seed:', seedErr.message);
    }

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
