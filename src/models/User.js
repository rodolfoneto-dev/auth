const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedByTokenHash: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nome é obrigatório'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email é obrigatório'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Formato de email inválido'],
    },
    password: {
      type: String,
      required: [true, 'Senha é obrigatória'],
      minlength: [6, 'Senha deve ter no mínimo 6 caracteres'],
    },
    role: {
      type: String,
      enum: {
        values: ['aluno', 'professor', 'admin'],
        message: 'Papel inválido. Valores permitidos: aluno, professor, admin',
      },
      default: 'aluno',
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'suspended', 'pending'],
        message: 'Status inválido. Valores permitidos: active, suspended, pending',
      },
      default: 'active',
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationTokenHash: {
      type: String,
      default: null,
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
    },
    refreshTokens: {
      type: [refreshTokenSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Hash automático da senha antes de salvar
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Método para validar senha
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Gera token criptografado para confirmação de e-mail (válido por 24 horas)
userSchema.methods.generateEmailVerificationToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationTokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  // Expiração em 24 horas
  this.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return rawToken;
};

// Gera token seguro para recuperação de senha (válido por 1 hora)
userSchema.methods.generatePasswordResetToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetTokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  // Expiração em 1 hora
  this.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

  return rawToken;
};

// Gera novo Refresh Token seguro (dias configuráveis) e anexa à lista de sessões
userSchema.methods.generateRefreshToken = function (customDays = null) {
  const rawToken = crypto.randomBytes(40).toString('hex');

  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  const defaultDays = Number(process.env.JWT_REFRESH_TOKEN_TTL_DAYS) || 30;
  const refreshTokenDays = typeof customDays === 'number' && customDays > 0 ? customDays : defaultDays;
  const expiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);

  if (!this.refreshTokens) {
    this.refreshTokens = [];
  }

  this.refreshTokens.push({
    tokenHash,
    expiresAt,
    createdAt: new Date(),
    revokedAt: null,
    replacedByTokenHash: null,
  });

  return rawToken;
};

// Revoga um refresh token específico
userSchema.methods.revokeRefreshToken = function (rawToken, replacedByToken = null) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  const replacedByHash = replacedByToken
    ? crypto.createHash('sha256').update(replacedByToken).digest('hex')
    : null;

  if (this.refreshTokens) {
    const tokenObj = this.refreshTokens.find((t) => t.tokenHash === tokenHash);
    if (tokenObj) {
      tokenObj.revokedAt = new Date();
      tokenObj.replacedByTokenHash = replacedByHash;
      return true;
    }
  }
  return false;
};

// Revoga todas as sessões ativas (usado em reset de senha e logout global)
userSchema.methods.revokeAllRefreshTokens = function () {
  if (this.refreshTokens && this.refreshTokens.length > 0) {
    const now = new Date();
    this.refreshTokens.forEach((t) => {
      if (!t.revokedAt) {
        t.revokedAt = now;
      }
    });
  }
};

// Remove campos sensíveis no retorno JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.emailVerificationTokenHash;
  delete obj.emailVerificationExpiresAt;
  delete obj.passwordResetTokenHash;
  delete obj.passwordResetExpiresAt;
  delete obj.refreshTokens;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
