const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate, checkRole } = require('../middlewares/auth');

const router = express.Router();

// Helper para gerar token JWT com id e role
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// POST /register - Cadastro de usuário
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validação de presença dos campos obrigatórios
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    // Criação do usuário (hash automático via pre-save hook do User model)
    const user = new User({ name, email, password, role });
    await user.save();

    // Geração de token JWT
    const token = generateToken(user);

    // Retorna usuário (sem senha, tratado por toJSON) e token
    return res.status(201).json({ user, token });
  } catch (err) {
    // Erro de duplicidade do MongoDB (índice único no email)
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    // Erros de validação do Mongoose (formato de email, tamanho de senha, role inválido)
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }

    return res.status(500).json({ error: 'Erro interno ao registrar usuário' });
  }
});

// POST /login - Autenticação
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validação de presença dos campos obrigatórios
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Busca usuário no banco
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Validação da senha com bcrypt via método do model
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Geração do token JWT
    const token = generateToken(user);

    return res.status(200).json({ user, token });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao realizar login' });
  }
});

// GET /validate - Validação de token para outros microsserviços
router.get('/validate', authenticate, (req, res) => {
  return res.status(200).json({
    valid: true,
    user: req.user,
  });
});

// GET /me - Consulta dos dados completos do usuário logado
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    return res.status(200).json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao buscar perfil' });
  }
});

module.exports = router;
