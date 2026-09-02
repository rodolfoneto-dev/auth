const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Lead = require('../models/Lead');
const AuditLog = require('../models/AuditLog');
const { authenticate, checkRole } = require('../middlewares/auth');
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
      name: user.name || '',
      email: user.email || '',
      role: user.role,
      status: user.status || 'active',
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
 * /auth/demo-token:
 *   post:
 *     summary: Emissão de token para contas de teste/demo (Dev Portal)
 *     description: Endpoint utilitário seguro para testes. Bloqueado em produção a menos que ALLOW_DEV_TOKENS=true.
 *     tags:
 *       - Autenticação
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [aluno, professor, admin]
 *                 default: admin
 *     responses:
 *       200:
 *         description: Token emitido com sucesso
 *       403:
 *         description: Desativado em produção
 */
router.post('/demo-token', async (req, res) => {
  // Guardrail de segurança: desativado em produção
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_TOKENS !== 'true') {
    return res.status(403).json({
      error: 'FEATURE_DISABLED',
      message: 'A emissão de tokens demo está desativada em produção.',
    });
  }

  const role = (req.body && req.body.role) || 'admin';
  if (!['aluno', 'professor', 'admin'].includes(role)) {
    return res.status(400).json({
      error: 'INVALID_ROLE',
      message: 'Role inválida. Escolha entre: aluno, professor ou admin.',
    });
  }

  const demoEmailMap = {
    admin: 'admin@upexperience.com.br',
    professor: 'professor@upexperience.com.br',
    aluno: 'aluno@upexperience.com.br',
  };
  const targetEmail = demoEmailMap[role];

  try {
    let user = await User.findOne({ email: targetEmail });
    if (!user) {
      user = await User.findOne({ role });
    }

    if (!user) {
      user = {
        _id: new mongoose.Types.ObjectId(),
        name: `Demo ${role.toUpperCase()}`,
        email: targetEmail,
        role: role,
        status: 'active',
        emailVerified: true,
      };
    }

    const token = generateAccessToken(user);

    return res.json({
      status: 'ok',
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      environment: process.env.NODE_ENV || 'staging',
    });
  } catch (err) {
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: `Erro ao emitir token demo: ${err.message}`,
    });
  }
});

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
const isRegistrationBlocked = () => {
  return (
    process.env.BLOCK_REGISTRATION === '1' ||
    process.env.BLOCK_REGISTRATION === 'true' ||
    process.env.VITE_BLOCK_REGISTRATION === '1' ||
    process.env.VITE_BLOCK_REGISTRATION === 'true'
  );
};

/**
 * @openapi
 * /auth/config:
 *   get:
 *     summary: Configurações públicas de autenticação
 *     description: Retorna flags de configuração pública da plataforma (ex. bloqueio de cadastro para staging).
 *     tags:
 *       - Autenticação
 *     responses:
 *       200:
 *         description: Configurações obtidas com sucesso
 */
router.get('/config', (req, res) => {
  return res.json({
    registrationBlocked: isRegistrationBlocked(),
  });
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    // Bloqueio de novos cadastros (Staging / Manutenção / Homologação controlada)
    if (isRegistrationBlocked()) {
      return res.status(403).json({
        error: {
          code: 'REGISTRATION_DISABLED',
          message: 'Novos cadastros estão temporariamente suspensos (ambiente de testes/staging).',
        },
      });
    }

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
 *               rememberMe:
 *                 type: boolean
 *                 default: true
 *                 example: true
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
    const { email, password, rememberMe } = req.body;

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

    if (user.status === 'suspended') {
      return res.status(403).json({
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Sua conta está suspensa (inadimplência ou inatividade). Regularize seu acesso com o suporte.',
        },
      });
    }

    // Geração do token JWT de acesso e do Refresh Token seguro (respeitando rememberMe)
    const token = generateAccessToken(user);
    const ttlDays = rememberMe === false ? 1 : (Number(process.env.JWT_REFRESH_TOKEN_TTL_DAYS) || 30);
    const refreshToken = user.generateRefreshToken(ttlDays);
    await user.save();

    return res.status(200).json({
      message: 'Login realizado com sucesso',
      user,
      token,
      refreshToken,
    });
  } catch (err) {
    console.error('❌ [Auth Error /login]:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao realizar login',
        details: err.message,
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
 * /auth/logout-all:
 *   post:
 *     summary: Encerramento de todas as sessões (Logout Global)
 *     description: Revoga todos os Refresh Tokens do usuário autenticado, desconectando todos os dispositivos.
 *     tags:
 *       - Autenticação
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Todas as sessões foram encerradas com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Todas as sessões foram encerradas com sucesso
 *       401:
 *         description: Não autenticado
 */
router.post('/logout-all', authenticate, async (req, res) => {
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

    user.revokeAllRefreshTokens();
    await user.save();

    return res.status(200).json({
      message: 'Todas as sessões foram encerradas com sucesso',
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao encerrar todas as sessões',
      },
    });
  }
});

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     summary: Alteração de senha da conta autenticada
 *     description: Valida a senha atual e define uma nova senha para o usuário autenticado, revogando todas as sessões anteriores.
 *     tags:
 *       - Autenticação
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 6
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
 *                   example: Senha alterada com sucesso!
 *       400:
 *         description: Dados inválidos ou nova senha muito curta
 *       401:
 *         description: Senha atual incorreta ou não autenticado
 */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Senha atual e nova senha são obrigatórias',
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

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Usuário não encontrado',
        },
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Senha atual incorreta',
        },
      });
    }

    user.password = newPassword;
    user.revokeAllRefreshTokens();
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Senha alterada com sucesso!',
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao alterar senha',
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
 *     description: Valida o token JWT fornecido no header Authorization e retorna o payload decodificado ({ id, name, email, role, emailVerified }). Utilizado por academy, adm, comms, chat, etc.
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
 *                     name:
 *                       type: string
 *                       example: João Silva
 *                     email:
 *                       type: string
 *                       example: joao@example.com
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
      name: req.user.name,
      email: req.user.email,
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
// ==========================================
// 8. Captação de Leads (Chat / Landing Page)
// ==========================================

/**
 * @openapi
 * /auth/leads:
 *   post:
 *     summary: Registrar novo lead captado pelo chat
 *     description: Salva os dados do lead coletados pela conversa no LeadChatWidget ou formulário institucional.
 *     tags:
 *       - Leads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - phone
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               level:
 *                 type: string
 *               plan:
 *                 type: string
 *                 enum: [start, pro, vip, consult]
 *               verifiedHuman:
 *                 type: boolean
 *               verificationStrategy:
 *                 type: string
 *               verificationToken:
 *                 type: string
 *     responses:
 *       201:
 *         description: Lead cadastrado com sucesso
 *       400:
 *         description: Dados obrigatórios ausentes
 */
router.post('/leads', async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      level,
      plan,
      notes,
      message,
      verifiedHuman,
      verificationStrategy,
      verificationToken,
    } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Nome, telefone WhatsApp e e-mail são obrigatórios',
        },
      });
    }

    const cleanEmail = normalizeEmail(email);

    const lead = new Lead({
      name: name.trim(),
      phone: phone.trim(),
      email: cleanEmail,
      level: level || 'Iniciante do zero',
      plan: plan || 'pro',
      notes: (notes || message || '').trim(),
      verifiedHuman: Boolean(verifiedHuman),
      verificationStrategy: verificationStrategy || 'up-captcha',
      verificationToken: verificationToken || null,
      status: 'new',
    });

    await lead.save();

    return res.status(201).json({
      message: 'Lead registrado com sucesso!',
      lead,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao salvar lead',
      },
    });
  }
});

// ==========================================
// 9. Módulo Administrativo (Admin Only)
// ==========================================

/**
 * @openapi
 * /auth/admin/leads:
 *   get:
 *     summary: Listar todos os leads captados (Admin)
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: plan
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de leads retornada
 *       403:
 *         description: Acesso restrito a administradores
 */
router.get('/admin/leads', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const { status, plan, search } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (plan && plan !== 'all') {
      filter.plan = plan;
    }
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
    }

    const leads = await Lead.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      total: leads.length,
      leads,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao listar leads',
      },
    });
  }
});

/**
 * @openapi
 * /auth/admin/leads/{id}/status:
 *   patch:
 *     summary: Atualizar status e notas de um lead (Admin)
 *     tags:
 *       - Admin
 */
router.patch('/admin/leads/:id/status', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    const allowedStatuses = ['new', 'contacted', 'enrolled', 'lost'];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Status inválido. Permitidos: new, contacted, enrolled, lost',
        },
      });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({
        error: {
          code: 'LEAD_NOT_FOUND',
          message: 'Lead não encontrado',
        },
      });
    }

    const previousStatus = lead.status;
    if (status) lead.status = status;
    if (typeof notes === 'string') lead.notes = notes;
    await lead.save();

    // Grava histórico de auditoria
    try {
      const actor = await getActorInfo(req);
      await AuditLog.create({
        actorId: actor.id,
        actorName: actor.name,
        actorEmail: actor.email,
        targetUserId: lead._id.toString(),
        targetType: 'lead',
        targetUserName: lead.name,
        targetUserEmail: lead.email,
        action: 'LEAD_STATUS_CHANGE',
        previousValue: previousStatus,
        newValue: lead.status,
        details: `Status do Lead alterado de ${previousStatus} para ${lead.status} (Plano: ${lead.plan || 'N/A'})`,
      });
    } catch (logErr) {
      console.error('[AuditLog] Erro ao gravar log de lead status:', logErr);
    }

    return res.status(200).json({
      message: 'Status do lead atualizado com sucesso',
      lead,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao atualizar lead',
      },
    });
  }
});

/**
 * @openapi
 * /auth/admin/leads/{id}:
 *   delete:
 *     summary: Excluir um lead (Admin)
 *     tags:
 *       - Admin
 */
router.delete('/admin/leads/:id', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
      return res.status(404).json({
        error: {
          code: 'LEAD_NOT_FOUND',
          message: 'Lead não encontrado',
        },
      });
    }

    // Grava histórico de auditoria
    try {
      const actor = await getActorInfo(req);
      await AuditLog.create({
        actorId: actor.id,
        actorName: actor.name,
        actorEmail: actor.email,
        targetUserId: lead._id.toString(),
        targetType: 'lead',
        targetUserName: lead.name,
        targetUserEmail: lead.email,
        action: 'LEAD_DELETED',
        previousValue: lead.status,
        newValue: 'deleted',
        details: `Lead ${lead.name} (${lead.email} - ${lead.phone || 'Sem telefone'}) excluído do CRM`,
      });
    } catch (logErr) {
      console.error('[AuditLog] Erro ao gravar log de lead deletion:', logErr);
    }

    return res.status(200).json({
      message: 'Lead excluído com sucesso',
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao excluir lead',
      },
    });
  }
});

/**
 * @openapi
 * /auth/admin/users:
 *   get:
 *     summary: Listar todos os usuários da plataforma (Admin)
 *     tags:
 *       - Admin
 */
router.get('/admin/users', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const { role, search } = req.query;
    const filter = {};

    if (role && role !== 'all') {
      filter.role = role;
    }
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: searchRegex }, { email: searchRegex }];
    }

    const users = await User.find(filter)
      .select('-password -refreshTokens -passwordResetToken -passwordResetExpires -emailVerificationToken')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      total: users.length,
      users,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao listar usuários',
      },
    });
  }
});

// Helper para capturar os dados do Admin responsável pela alteração
const getActorInfo = async (req) => {
  let actorName = 'Admin Master UP!';
  let actorEmail = 'admin@upexperience.com.br';
  if (req.user?.id) {
    try {
      const adminUser = await User.findById(req.user.id);
      if (adminUser) {
        actorName = adminUser.name;
        actorEmail = adminUser.email;
      }
    } catch {
      // fallback
    }
  }
  return {
    actorId: req.user?.id || 'admin',
    actorName,
    actorEmail,
  };
};

/**
 * @openapi
 * /auth/admin/users/{id}/role:
 *   patch:
 *     summary: Alterar papel (role) de um usuário (Admin)
 *     tags:
 *       - Admin
 */
router.patch('/admin/users/:id/role', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const allowedRoles = ['aluno', 'professor', 'admin'];

    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Papel inválido. Permitidos: aluno, professor, admin',
        },
      });
    }

    const currentUserId = req.user?._id || req.user?.id || req.user?.sub;
    if (currentUserId && currentUserId.toString() === req.params.id) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_SELF_MODIFICATION',
          message: 'Não é permitido alterar o próprio papel de administrador para evitar perda de acesso',
        },
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Usuário não encontrado',
        },
      });
    }

    if (user.role === 'admin' && role !== 'admin') {
      return res.status(403).json({
        error: {
          code: 'ADMIN_ROLE_PROTECTED',
          message: 'Contas com papel de Administrador são protegidas contra rebaixamento direto',
        },
      });
    }

    const previousRole = user.role || 'aluno';
    if (previousRole !== role) {
      user.role = role;
      await user.save();

      const actor = await getActorInfo(req);
      await AuditLog.create({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorEmail: actor.actorEmail,
        targetUserId: user._id.toString(),
        targetUserName: user.name,
        targetUserEmail: user.email,
        action: 'ROLE_CHANGE',
        previousValue: previousRole,
        newValue: role,
        details: `Papel alterado de ${previousRole} para ${role}`,
      });
    }

    return res.status(200).json({
      message: 'Papel do usuário atualizado com sucesso',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao atualizar papel do usuário',
      },
    });
  }
});

/**
 * @openapi
 * /auth/admin/users/{id}/status:
 *   patch:
 *     summary: Alterar status da conta do usuário (Admin)
 *     description: Permite ao administrador alterar o status de um usuário (active, suspended, pending) e gera log de auditoria.
 *     tags:
 *       - Admin
 */
router.patch('/admin/users/:id/status', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['active', 'suspended', 'pending'];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Status inválido. Permitidos: active, suspended, pending',
        },
      });
    }

    const currentUserId = req.user?._id || req.user?.id || req.user?.sub;
    if (currentUserId && currentUserId.toString() === req.params.id && status !== 'active') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_SELF_SUSPENSION',
          message: 'Não é permitido suspender ou inativar a própria conta de administrador',
        },
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Usuário não encontrado',
        },
      });
    }

    if (user.role === 'admin' && status !== 'active') {
      return res.status(403).json({
        error: {
          code: 'ADMIN_ACCOUNT_PROTECTED',
          message: 'Contas de administrador são protegidas contra suspensão',
        },
      });
    }

    const previousStatus = user.status || 'active';
    if (previousStatus !== status) {
      user.status = status;
      if (status === 'suspended') {
        user.revokeAllRefreshTokens();
      }
      await user.save();

      const actor = await getActorInfo(req);
      await AuditLog.create({
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorEmail: actor.actorEmail,
        targetUserId: user._id.toString(),
        targetUserName: user.name,
        targetUserEmail: user.email,
        action: 'STATUS_CHANGE',
        previousValue: previousStatus,
        newValue: status,
        details: `Status alterado de ${previousStatus} para ${status}`,
      });
    }

    return res.status(200).json({
      message: 'Status do usuário atualizado com sucesso',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao atualizar status do usuário',
      },
    });
  }
});

/**
 * @openapi
 * /auth/admin/audit-logs:
 *   get:
 *     summary: Listar histórico de auditoria e alterações administrativas (Admin)
 *     tags:
 *       - Admin
 */
router.get('/admin/audit-logs', authenticate, checkRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit);

    return res.status(200).json({
      total: logs.length,
      logs,
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro ao listar histórico de auditoria',
      },
    });
  }
});

module.exports = router;

