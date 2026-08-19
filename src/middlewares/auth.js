const jwt = require('jsonwebtoken');

// Middleware para verificar e decodificar token JWT
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token não fornecido ou formato inválido',
      },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });

    req.user = {
      id: decoded.sub || decoded.id,
      sub: decoded.sub || decoded.id,
      role: decoded.role,
      emailVerified: Boolean(decoded.emailVerified),
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expirado',
        },
      });
    }
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Token inválido ou com assinatura incorreta',
      },
    });
  }
};

// Middleware para autorização baseada em papéis (roles)
const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Não autenticado',
        },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Acesso negado para o seu perfil',
        },
      });
    }

    next();
  };
};

// Middleware para exigir e-mail verificado antes de acessar rota protegida
const requireEmailVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Não autenticado',
      },
    });
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: {
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Confirmação de e-mail obrigatória. Por favor, verifique sua caixa de entrada.',
      },
    });
  }

  next();
};

module.exports = {
  authenticate,
  checkRole,
  requireEmailVerified,
};
