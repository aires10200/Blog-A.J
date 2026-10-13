const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path'); // Adicionado para gerir caminhos de pastas
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN
    ? process.env.FRONTEND_ORIGIN.split(',').map((item) => item.trim())
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Visitor-Id', 'X-Admin-Token']
}));
app.use(express.json({ limit: '20kb' }));

// Middleware para servir a pasta pública onde está o frontend
app.use(express.static(path.join(__dirname, 'public')));

// Rota raiz redireciona diretamente para o blog.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blog.html'));
});

const postSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true, maxlength: 150 },
  resumo: { type: String, required: true, trim: true, maxlength: 10000 },
  data: { type: String, default: '' },
  curtidas: { type: Number, default: 0, min: 0 },
  curtidores: { type: [String], default: [] }
}, { timestamps: true });
const Post = mongoose.models.Post || mongoose.model('Post', postSchema);

function idVisitanteValido(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 120;
}
function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/posts', async (req, res) => {
  try {
    const filtro = {};
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const busca = escaparRegex(req.query.q.trim().slice(0, 100));
      filtro.$or = [
        { titulo: { $regex: busca,$options: 'i' } },
        { resumo: { $regex: busca,$options: 'i' } }
      ];
    }
    const visitorId = req.get('X-Visitor-Id');
    const posts = await Post.find(filtro).sort({ createdAt: -1 }).lean();
    res.json(posts.map(({ curtidores = [], ...post }) => ({
      ...post,
      jaCurtiu: idVisitanteValido(visitorId) && curtidores.includes(visitorId)
    })));
  } catch (error) {
    console.error('Erro ao buscar postagens:', error);
    res.status(500).json({ erro: 'Erro ao carregar as postagens.' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const titulo = typeof req.body.titulo === 'string' ? req.body.titulo.trim() : '';
    const resumo = typeof req.body.resumo === 'string' ? req.body.resumo.trim() : '';
    if (!titulo || !resumo) return res.status(400).json({ erro: 'Título e conteúdo são obrigatórios.' });
    if (titulo.length > 150 || resumo.length > 10000) return res.status(400).json({ erro: 'O título deve ter até 150 caracteres e o conteúdo até 10.000.' });
    const data = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
    const post = await Post.create({ titulo, resumo, data, curtidas: 0, curtidores: [] });
    res.status(201).json(post);
  } catch (error) {
    console.error('Erro ao publicar postagem:', error);
    res.status(500).json({ erro: 'Erro ao criar postagem.' });
  }
});

app.put('/api/posts/:id/like', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ erro: 'ID da postagem inválido.' });
    const visitorId = req.get('X-Visitor-Id');
    if (!idVisitanteValido(visitorId)) return res.status(400).json({ erro: 'Identificação do navegador ausente. Atualize a página e tente novamente.' });

    const post = await Post.findOneAndUpdate(
      { _id: req.params.id, curtidores: { $ne: visitorId } },
      { $addToSet: { curtidores: visitorId },$inc: { curtidas: 1 } },
      { new: true }
    );
    if (post) return res.json({ curtidas: post.curtidas, jaCurtiu: true });

    const existente = await Post.findById(req.params.id).select('curtidas curtidores').lean();
    if (!existente) return res.status(404).json({ erro: 'Postagem não encontrada.' });
    return res.status(200).json({ curtidas: existente.curtidas, jaCurtiu: true, mensagem: 'Você já curtiu esta postagem neste navegador.' });
  } catch (error) {
    console.error('Erro ao registrar curtida:', error);
    res.status(500).json({ erro: 'Erro ao registrar curtida.' });
  }
});

app.delete('/api/posts/:id', async (req, res) => {
  try {
    if (!ADMIN_TOKEN) return res.status(503).json({ erro: 'A exclusão está desativada. Configure ADMIN_TOKEN no arquivo .env do servidor.' });
    if (req.get('X-Admin-Token') !== ADMIN_TOKEN) return res.status(401).json({ erro: 'Senha administrativa incorreta.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ erro: 'ID da postagem inválido.' });
    const removido = await Post.findByIdAndDelete(req.params.id);
    if (!removido) return res.status(404).json({ erro: 'Postagem não encontrada.' });
    res.json({ mensagem: 'Postagem apagada com sucesso.' });
  } catch (error) {
    console.error('Erro ao apagar postagem:', error);
    res.status(500).json({ erro: 'Erro ao apagar postagem.' });
  }
});

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

async function iniciarServidor() {
  if (!MONGO_URI) throw new Error('Configure MONGO_URI no arquivo .env.');
  await mongoose.connect(MONGO_URI);
  console.log('Conectado ao MongoDB Atlas.');
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
}
iniciarServidor().catch((error) => {
  console.error('Não foi possível iniciar o servidor:', error.message);
  process.exit(1);
});