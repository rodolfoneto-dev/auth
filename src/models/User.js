const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

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

// Remove campos sensíveis no retorno JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.emailVerificationTokenHash;
  delete obj.emailVerificationExpiresAt;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
