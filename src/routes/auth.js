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

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Cadastro de novo usuário
 *     description: Cria um novo usuário no banco com senha criptografada via bcrypt e retorna os dados do usuário com um token JWT válido por 7 dias.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 example: João Silva
 *               email:
 *                 type: string
 *                 format: email
 *                 example: joao@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: senhaForte123
 *               role:
 *                 type: string
 *                 enum: [aluno, professor, admin]
 *                 default: aluno
 *                 example: aluno
 *     responses:
 *       201:
 *         description: Usuário criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: 64f1a2b3c4d5e6f7a8b9c0d1
 *                     name:
 *                       type: string
 *                       example: João Silva
 *                     email:
 *                       type: string
 *                       example: joao@example.com
 *                     role:
 *                       type: string
 *                       example: aluno
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Campos obrigatórios ausentes ou dados inválidos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Nome, email e senha são obrigatórios
 *       409:
 *         description: Conflito - Email já cadastrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Email já cadastrado
 *       500:
 *         description: Erro interno do servidor
 */
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

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Autenticação de usuário
 *     description: Valida o email e senha do usuário e retorna os dados do usuário e um token JWT se as credenciais estiverem corretas.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: joao@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: senhaForte123
 *     responses:
 *       200:
 *         description: Autenticação realizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: 64f1a2b3c4d5e6f7a8b9c0d1
 *                     name:
 *                       type: string
 *                       example: João Silva
 *                     email:
 *                       type: string
 *                       example: joao@example.com
 *                     role:
 *                       type: string
 *                       example: aluno
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Email ou senha não informados
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Email e senha são obrigatórios
 *       401:
 *         description: Credenciais inválidas (email não encontrado ou senha incorreta)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Credenciais inválidas
 *       500:
 *         description: Erro interno do servidor
 */
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

/**
 * @openapi
 * /auth/validate:
 *   get:
 *     summary: Validação de token JWT (Contrato para outros microsserviços)
 *     description: Valida o token JWT fornecido no header Authorization e retorna o payload decodificado ({ id, role }). Utilizado por academy, adm, comms, etc.
 *     tags:
 *       - Validação & Sessão
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token válido e ativo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: 64f1a2b3c4d5e6f7a8b9c0d1
 *                     role:
 *                       type: string
 *                       enum: [aluno, professor, admin]
 *                       example: professor
 *       401:
 *         description: Token não fornecido, formato inválido, expirado ou assinatura inválida
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Token inválido
 */
router.get('/validate', authenticate, (req, res) => {
  return res.status(200).json({
    valid: true,
    user: req.user,
  });
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Consulta dados do perfil logado
 *     description: Retorna os dados completos atualizados do usuário autenticado a partir do token JWT.
 *     tags:
 *       - Validação & Sessão
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dados do perfil retornados com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: 64f1a2b3c4d5e6f7a8b9c0d1
 *                     name:
 *                       type: string
 *                       example: João Silva
 *                     email:
 *                       type: string
 *                       example: joao@example.com
 *                     role:
 *                       type: string
 *                       example: aluno
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Não autorizado - Token ausente ou inválido
 *       404:
 *         description: Usuário não encontrado no banco
 *       500:
 *         description: Erro interno do servidor
 */
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
