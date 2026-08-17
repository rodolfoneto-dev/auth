const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { authenticate, checkRole, requireEmailVerified } = require('../middlewares/auth');
const { sendVerificationEmail } = require('../services/email');

const router = express.Router();

// Helper para gerar token JWT com id, role e status de verificação
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      emailVerified: user.emailVerified,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Cadastro de novo usuário
 *     description: Cria um novo usuário no banco com emailVerified=false, gera hash da senha com bcrypt, cria token de confirmação seguro e envia e-mail transacional de ativação.
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
 *         description: Usuário criado com sucesso e e-mail de confirmação enviado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Usuário registrado com sucesso. Por favor, confirme seu e-mail.
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
 *                     emailVerified:
 *                       type: boolean
 *                       example: false
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Campos obrigatórios ausentes ou dados inválidos
 *       409:
 *         description: Conflito - Email já cadastrado
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

    // Instancia o usuário
    const user = new User({ name, email, password, role });

    // Gera token de confirmação de e-mail (criptograficamente seguro, hash SHA-256 no banco)
    const rawVerificationToken = user.generateEmailVerificationToken();

    // Salva usuário no banco (hash bcrypt da senha via pre-save hook)
    await user.save();

    // Dispara envio do e-mail de ativação
    await sendVerificationEmail(user.email, user.name, rawVerificationToken);

    // Geração do token JWT
    const token = generateToken(user);

    return res.status(201).json({
      message: 'Usuário registrado com sucesso. Por favor, confirme seu e-mail.',
      user,
      token,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }

    return res.status(500).json({ error: 'Erro interno ao registrar usuário' });
  }
});

/**
 * @openapi
 * /auth/verify-email:
 *   get:
 *     summary: Confirmação de endereço de e-mail
 *     description: Valida o token de confirmação único enviado por e-mail, verifica expiração (24h) e marca emailVerified=true no usuário.
 *     tags:
 *       - Confirmação de E-mail
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token de confirmação de uso único
 *     responses:
 *       200:
 *         description: E-mail verificado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: E-mail verificado com sucesso!
 *                 user:
 *                   type: object
 *       400:
 *         description: Token inválido, expirado ou não informado
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token de verificação é obrigatório' });
    }

    // Calcula hash SHA-256 do token recebido para buscar no banco
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Busca usuário com token correspondente e não expirado
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        error: 'Token de verificação inválido ou expirado',
      });
    }

    // Ativa o e-mail e invalida o token
    user.emailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'E-mail verificado com sucesso!',
      user,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao verificar e-mail' });
  }
});

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     summary: Reenviar link de confirmação de e-mail
 *     description: Gera um novo token de confirmação e reenvia o e-mail caso o usuário ainda não esteja verificado.
 *     tags:
 *       - Confirmação de E-mail
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: joao@example.com
 *     responses:
 *       200:
 *         description: Mensagem de confirmação genérica (prevenção de enumeração de e-mails)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Se o e-mail estiver cadastrado e não verificado, um novo link foi enviado.
 *       400:
 *         description: Email não informado
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const user = await User.findOne({ email });

    // Se usuário existir e ainda não estiver verificado, gera novo token e reenvia
    if (user && !user.emailVerified) {
      const rawToken = user.generateEmailVerificationToken();
      await user.save();
      await sendVerificationEmail(user.email, user.name, rawToken);
    }

    // Resposta neutra por segurança (evita enumeração de contas)
    return res.status(200).json({
      message:
        'Se o e-mail estiver cadastrado e não verificado, um novo link de confirmação foi enviado.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao reenviar confirmação' });
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
 *                     emailVerified:
 *                       type: boolean
 *                       example: false
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Email ou senha não informados
 *       401:
 *         description: Credenciais inválidas (email não encontrado ou senha incorreta)
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
 *     description: Valida o token JWT fornecido no header Authorization e retorna o payload decodificado ({ id, role, emailVerified }). Utilizado por academy, adm, comms, etc.
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
 *                     emailVerified:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: Token não fornecido, formato inválido, expirado ou assinatura inválida
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
 *                     emailVerified:
 *                       type: boolean
 *                       example: true
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
