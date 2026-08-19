const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { authenticate } = require('../middlewares/auth');
const { authLimiter, recoveryLimiter } = require('../middlewares/rateLimit');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');

const router = express.Router();

// Helper para normalizar e-mail de forma estrita e uniforme em todo o serviço
const normalizeEmail = (email) => {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};

// Helper para emitir token JWT de acesso com claims padronizadas da plataforma
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user._id.toString(),
      id: user._id.toString(),
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
      iss: process.env.JWT_ISSUER || 'auth-service',
      aud: process.env.JWT_AUDIENCE || 'platform',
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TOKEN_TTL || '7d' }
  );
};

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Cadastro de novo usuário
 *     description: Cria um novo usuário no banco com emailVerified=false, gera hash da senha com bcrypt, cria token de confirmação seguro e envia e-mail transacional de ativação. Bloqueia privilege escalation para admin.
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
 *                 example: senhaForte123@
 *               role:
 *                 type: string
 *                 enum: [aluno, professor]
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
 *                 refreshToken:
 *                   type: string
 *                   example: 4a2b9c8e1f0...
 *       400:
 *         description: Campos obrigatórios ausentes ou dados inválidos
 *       409:
 *         description: Conflito - Email já cadastrado
 *       429:
 *         description: Muitas requisições (Rate limit atingido)
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Nome, email e senha são obrigatórios',
        },
      });
    }

    const cleanEmail = normalizeEmail(email);

    // Proteção contra Privilege Escalation: cadastro público NUNCA pode criar admin
    let safeRole = 'aluno';
    if (role === 'professor') {
      safeRole = 'professor';
    }

    // Instancia o usuário
    const user = new User({
      name: name.trim(),
      email: cleanEmail,
      password,
      role: safeRole,
    });

    // Gera token de confirmação de e-mail (hash SHA-256 no banco, expiração em 24h)
    const rawVerificationToken = user.generateEmailVerificationToken();

    // Gera o primeiro refresh token para a sessão inicial
    const rawRefreshToken = user.generateRefreshToken();

    // Salva usuário no banco (hash bcrypt da senha via pre-save hook)
    await user.save();

    // Dispara envio do e-mail de ativação (não bloqueia resposta caso em dev/log)
    await sendVerificationEmail(user.email, user.name, rawVerificationToken);

    // Geração do token JWT de acesso
    const token = generateAccessToken(user);

    return res.status(201).json({
      message: 'Usuário registrado com sucesso. Por favor, confirme seu e-mail.',
      user,
      token,
      refreshToken: rawRefreshToken,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Email já cadastrado',
        },
      });
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao registrar usuário',
      },
    });
  }
});

/**
 * @openapi
 * /auth/verify-email:
 *   get:
 *     summary: Confirmação de endereço de e-mail (GET)
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
 *   post:
 *     summary: Confirmação de endereço de e-mail (POST)
 *     description: Valida o token de confirmação informado no body JSON.
 *     tags:
 *       - Confirmação de E-mail
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: E-mail verificado com sucesso
 *       400:
 *         description: Token inválido, expirado ou não informado
 */
const handleVerifyEmail = async (req, res) => {
  try {
    const token = req.query.token || req.body?.token;

    if (!token) {
      return res.status(400).json({
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Token de verificação é obrigatório',
        },
      });
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
        error: {
          code: 'INVALID_OR_EXPIRED_TOKEN',
          message: 'Token de verificação inválido ou expirado',
        },
      });
    }

    // Ativa o e-mail e invalida o token de uso único
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
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao verificar e-mail',
      },
    });
  }
};

router.get('/verify-email', handleVerifyEmail);
router.post('/verify-email', handleVerifyEmail);

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     summary: Reenviar link de confirmação de e-mail
 *     description: Gera um novo token de confirmação e reenvia o e-mail caso o usuário ainda não esteja verificado. Resposta neutra anti-enumeração.
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
 *         description: Resposta neutra de confirmação enviada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Se o e-mail estiver cadastrado e não verificado, um novo link de confirmação foi enviado.
 *       400:
 *         description: Email não informado
 *       429:
 *         description: Limite de solicitações de verificação atingido
 */
router.post('/resend-verification', recoveryLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: {
          code: 'EMAIL_REQUIRED',
          message: 'Email é obrigatório',
        },
      });
    }

    const cleanEmail = normalizeEmail(email);
    const user = await User.findOne({ email: cleanEmail });

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
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao reenviar confirmação',
      },
    });
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Autenticação de usuário
 *     description: Valida o email e senha do usuário e retorna os dados do usuário, JWT de acesso e Refresh Token. Resposta com proteção anti-enumeração.
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
 *                 example: senhaForte123@
 *     responses:
 *       200:
 *         description: Autenticação realizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Login realizado com sucesso
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
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 refreshToken:
 *                   type: string
 *                   example: 9a8b7c6d5e4f...
 *       401:
 *         description: Credenciais inválidas (email ou senha incorretos)
 *       429:
 *         description: Muitas tentativas de login
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email e senha são obrigatórios',
        },
      });
    }

    const cleanEmail = normalizeEmail(email);

    // Busca usuário no banco por email normalizado
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Credenciais inválidas',
        },
      });
    }

    // Validação da senha com bcrypt via método seguro do model
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Credenciais inválidas',
        },
      });
    }

    // Geração do token JWT de acesso e do Refresh Token seguro
    const token = generateAccessToken(user);
    const refreshToken = user.generateRefreshToken();
    await user.save();

    return res.status(200).json({
      message: 'Login realizado com sucesso',
      user,
      token,
      refreshToken,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao realizar login',
      },
    });
  }
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Renovação de Token de Acesso (Refresh Token Rotation)
 *     description: Valida o Refresh Token ativo, detecta tentativas de reutilização, revoga a sessão anterior e emite um novo par de tokens.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: 9a8b7c6d5e4f3a2b1c0...
 *     responses:
 *       200:
 *         description: Novo par de tokens gerado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 refreshToken:
 *                   type: string
 *                   example: 1f2e3d4c5b6a7...
 *       401:
 *         description: Refresh token inválido, expirado ou revogado
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: {
          code: 'REFRESH_TOKEN_REQUIRED',
          message: 'Refresh token é obrigatório',
        },
      });
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Busca usuário que possua este token no histórico
    const user = await User.findOne({ 'refreshTokens.tokenHash': tokenHash });

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Refresh token inválido',
        },
      });
    }

    const tokenRecord = user.refreshTokens.find((t) => t.tokenHash === tokenHash);

    // Se o token encontrado já foi revogado, detectamos potencial reutilização maliciosa
    // Medida de segurança: revogar todas as sessões do usuário
    if (tokenRecord && tokenRecord.revokedAt) {
      user.revokeAllRefreshTokens();
      await user.save();
      return res.status(401).json({
        error: {
          code: 'REFRESH_TOKEN_REUSED',
          message: 'Tentativa de reutilização de token detectada. Todas as sessões foram encerradas por segurança.',
        },
      });
    }

    // Se o token estiver expirado
    if (tokenRecord && tokenRecord.expiresAt < new Date()) {
      tokenRecord.revokedAt = new Date();
      await user.save();
      return res.status(401).json({
        error: {
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Refresh token expirado. Por favor, faça login novamente.',
        },
      });
    }

    // Rotação segura de Refresh Token:
    // 1. Gera novo Refresh Token
    const newRefreshToken = user.generateRefreshToken();
    const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    // 2. Revoga o token atual marcando a substituição
    tokenRecord.revokedAt = new Date();
    tokenRecord.replacedByTokenHash = newRefreshTokenHash;

    // 3. Emite novo JWT de acesso
    const newAccessToken = generateAccessToken(user);

    await user.save();

    return res.status(200).json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao renovar token de acesso',
      },
    });
  }
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Encerramento de sessão (Logout)
 *     description: Revoga o Refresh Token informado no backend, invalidando sessões persistidas.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: 9a8b7c6d5e4f3a2b1c0...
 *     responses:
 *       200:
 *         description: Sessão encerrada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logout realizado com sucesso
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const user = await User.findOne({ 'refreshTokens.tokenHash': tokenHash });

      if (user) {
        user.revokeRefreshToken(refreshToken);
        await user.save();
      }
    }

    return res.status(200).json({
      message: 'Logout realizado com sucesso',
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao realizar logout',
      },
    });
  }
});

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Solicitação de recuperação de senha
 *     description: Gera token temporário de redefinição (1h) e envia e-mail com link seguro. Resposta neutra anti-enumeração.
 *     tags:
 *       - Recuperação de Senha
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
 *         description: Instruções de recuperação enviadas (se cadastrado)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Se o e-mail estiver cadastrado, as instruções para redefinição de senha foram enviadas.
 *       400:
 *         description: Email não informado
 *       429:
 *         description: Limite de solicitações de recuperação atingido
 */
router.post('/forgot-password', recoveryLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: {
          code: 'EMAIL_REQUIRED',
          message: 'Email é obrigatório',
        },
      });
    }

    const cleanEmail = normalizeEmail(email);
    const user = await User.findOne({ email: cleanEmail });

    if (user) {
      const rawToken = user.generatePasswordResetToken();
      await user.save();
      await sendPasswordResetEmail(user.email, user.name, rawToken);
    }

    // Resposta genérica anti-enumeração
    return res.status(200).json({
      message:
        'Se o e-mail estiver cadastrado, as instruções para redefinição de senha foram enviadas.',
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao solicitar recuperação de senha',
      },
    });
  }
});

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     summary: Redefinição de senha com token
 *     description: Valida token de uso único (1h), atualiza a senha no banco (hash bcrypt) e invalida todas as sessões/refresh tokens anteriores.
 *     tags:
 *       - Recuperação de Senha
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 example: a1b2c3d4e5f6...
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 example: novaSenhaSuperSegura123@
 *     responses:
 *       200:
 *         description: Senha alterada com sucesso
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
 *                   example: Senha redefinida com sucesso. Faça login com a nova senha.
 *       400:
 *         description: Token inválido, expirado ou nova senha fraca
 *       429:
 *         description: Limite de tentativas de redefinição atingido
 */
router.post('/reset-password', recoveryLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Token e nova senha são obrigatórios',
        },
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_TOO_SHORT',
          message: 'A nova senha deve ter no mínimo 6 caracteres',
        },
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        error: {
          code: 'INVALID_OR_EXPIRED_TOKEN',
          message: 'Token de recuperação inválido ou expirado',
        },
      });
    }

    // Atualiza senha e limpa tokens de reset
    user.password = newPassword;
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;

    // Revoga todas as sessões anteriores para exigir novo login com a senha atualizada
    user.revokeAllRefreshTokens();

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Senha redefinida com sucesso. Faça login com a nova senha.',
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao redefinir senha',
      },
    });
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
    user: {
      id: req.user.id,
      role: req.user.role,
      emailVerified: req.user.emailVerified,
    },
  });
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Consulta dados do perfil logado
 *     description: Retorna os dados completos atualizados do usuário autenticado a partir de consulta direta ao banco de dados.
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
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Usuário não encontrado',
        },
      });
    }
    return res.status(200).json({ user });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao buscar perfil',
      },
    });
  }
});

module.exports = router;
