const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nome é obrigatório'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Telefone WhatsApp é obrigatório'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email é obrigatório'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Formato de email inválido'],
    },
    level: {
      type: String,
      default: 'Iniciante do zero',
      trim: true,
    },
    plan: {
      type: String,
      enum: {
        values: ['start', 'pro', 'vip', 'consult'],
        message: 'Plano inválido',
      },
      default: 'pro',
    },
    verifiedHuman: {
      type: Boolean,
      default: false,
    },
    verificationStrategy: {
      type: String,
      default: 'fox-captcha',
    },
    verificationToken: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ['new', 'contacted', 'enrolled', 'lost'],
        message: 'Status inválido. Permitidos: new, contacted, enrolled, lost',
      },
      default: 'new',
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

leadSchema.index({ email: 1 });
leadSchema.index({ phone: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
