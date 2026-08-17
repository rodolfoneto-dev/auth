require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const { swaggerUi, swaggerSpec, swaggerMarkdown, swaggerMarkdownHtml } = require('./config/swagger');

const app = express();
app.use(express.json());

// Documentação da API
app.get('/docs/preview', (req, res) => res.send(swaggerMarkdownHtml));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));
app.get('/docs.md', (req, res) => res.type('text/markdown').send(swaggerMarkdown));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
