import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addSampleImages,
  createOrUpdateProduct,
  getAllWorkspaceData,
  importWorkspaceProducts,
  listWorkspaceMembers,
  recordSamplePriceUpdate,
  removeInvite,
  removeProduct,
  removeSample,
  removeSampleImage,
  removeTask,
  setMemberAccess,
  toggleApproveSample,
  updateSampleImageCaption,
  upsertSample,
  upsertTask,
} from './src/db/repository.ts';
import type { UserRole } from './src/db/users.ts';
import {
  requireAdmin,
  requireAuth,
  requireEditor,
  type AuthRequest,
} from './src/middleware/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

// Current authenticated user + workspace data
app.get('/api/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.dbUser });
});

app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
  try {
    const items = await getAllWorkspaceData();
    res.json({ products: items, user: req.dbUser });
  } catch (error: any) {
    console.error('GET /api/workspace error:', error);
    res.status(500).json({ error: error?.message || 'Failed to load workspace data.' });
  }
});

// Products
app.post('/api/products', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    const { id, name, category, launch, cycleStartYear, tasks } = req.body || {};
    if (!id || !name) {
      return res.status(400).json({ error: 'Product ID and name are required.' });
    }
    await createOrUpdateProduct(
      {
        id: String(id),
        name: String(name),
        category: String(category || ''),
        launch: String(launch || ''),
        cycleStartYear: Number(cycleStartYear) || 2026,
        tasks: Array.isArray(tasks) ? tasks : undefined,
      },
      req.user?.uid || ''
    );
    res.json({ ok: true });
  } catch (error: any) {
    console.error('POST /api/products error:', error);
    res.status(500).json({ error: error?.message || 'Failed to save product.' });
  }
});

app.delete('/api/products/:id', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    await removeProduct(String(req.params.id));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE /api/products error:', error);
    res.status(500).json({ error: error?.message || 'Failed to delete product.' });
  }
});

// Tasks
app.put(
  '/api/products/:productId/tasks/:taskId',
  requireAuth,
  requireEditor,
  async (req: AuthRequest, res) => {
    try {
      const productId = String(req.params.productId);
      const taskId = String(req.params.taskId);
      const body = req.body || {};
      if (!body.name) {
        return res.status(400).json({ error: 'Task name cannot be empty.' });
      }
      await upsertTask(productId, {
        id: taskId,
        stage: Number(body.stage) || 0,
        name: String(body.name),
        pic: String(body.pic || ''),
        status: String(body.status || 'not'),
        start: String(body.start || ''),
        end: String(body.end || ''),
        note: String(body.note || ''),
        isMilestone: Boolean(body.isMilestone),
        priority: body.priority === 'high' ? 'high' : 'normal',
        sortOrder: Number(body.sortOrder) || 0,
      });
      res.json({ ok: true });
    } catch (error: any) {
      console.error('PUT task error:', error);
      res.status(500).json({ error: error?.message || 'Failed to update task.' });
    }
  }
);

app.delete('/api/tasks/:taskId', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    await removeTask(String(req.params.taskId));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE task error:', error);
    res.status(500).json({ error: error?.message || 'Failed to delete task.' });
  }
});

// R&D Samples
app.put(
  '/api/products/:productId/samples/:sampleId',
  requireAuth,
  requireEditor,
  async (req: AuthRequest, res) => {
    try {
      const productId = String(req.params.productId);
      const sampleId = String(req.params.sampleId);
      const body = req.body || {};
      if (!body.rdCode) {
        return res.status(400).json({ error: 'RD code is required.' });
      }
      await upsertSample(
        productId,
        {
          id: sampleId,
          rdCode: String(body.rdCode),
          version: String(body.version || ''),
          pic: String(body.pic || ''),
          testDate: String(body.testDate || ''),
          testResult: String(body.testResult || 'pending'),
          isApproved: Boolean(body.isApproved),
          note: String(body.note || ''),
          cvsPrice: Number(body.cvsPrice) || 0,
          packagingCost: Number(body.packagingCost) || 0,
          sellPrice: Number(body.sellPrice) || 0,
          updatedAt: String(body.updatedAt || ''),
          priceHistory: Array.isArray(body.priceHistory) ? body.priceHistory : [],
          images: [],
        },
        req.dbUser?.email || ''
      );
      res.json({ ok: true });
    } catch (error: any) {
      console.error('PUT sample error:', error);
      res.status(500).json({ error: error?.message || 'Failed to save R&D sample.' });
    }
  }
);

app.post(
  '/api/products/:productId/samples/:sampleId/approve',
  requireAuth,
  requireEditor,
  async (req: AuthRequest, res) => {
    try {
      await toggleApproveSample(
        String(req.params.productId),
        String(req.params.sampleId),
        Boolean(req.body?.approve)
      );
      res.json({ ok: true });
    } catch (error: any) {
      console.error('POST approve sample error:', error);
      res.status(500).json({ error: error?.message || 'Failed to update sample approval status.' });
    }
  }
);

app.delete('/api/samples/:sampleId', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    await removeSample(String(req.params.sampleId));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE sample error:', error);
    res.status(500).json({ error: error?.message || 'Failed to delete R&D sample.' });
  }
});

// Price update logs
app.post(
  '/api/samples/:sampleId/price-logs',
  requireAuth,
  requireEditor,
  async (req: AuthRequest, res) => {
    try {
      const sampleId = String(req.params.sampleId);
      const { id, date, cvsPrice, packagingCost, sellPrice, reason } = req.body || {};
      if (!id || !date) {
        return res.status(400).json({ error: 'Effective date is required for price updates.' });
      }
      await recordSamplePriceUpdate(
        sampleId,
        {
          id: String(id),
          date: String(date),
          cvsPrice: Number(cvsPrice) || 0,
          packagingCost: Number(packagingCost) || 0,
          sellPrice: Number(sellPrice) || 0,
          reason: String(reason || ''),
        },
        req.dbUser?.email || ''
      );
      res.json({ ok: true });
    } catch (error: any) {
      console.error('POST price log error:', error);
      res.status(500).json({ error: error?.message || 'Failed to save price history.' });
    }
  }
);

// Sample evaluation images (multi-image upload)
app.post(
  '/api/samples/:sampleId/images',
  requireAuth,
  requireEditor,
  async (req: AuthRequest, res) => {
    try {
      const sampleId = String(req.params.sampleId);
      const images = Array.isArray(req.body?.images) ? req.body.images : [];
      if (!images.length) {
        return res.status(400).json({ error: 'No images were uploaded.' });
      }
      await addSampleImages(sampleId, images, req.dbUser?.email || '');
      res.json({ ok: true });
    } catch (error: any) {
      console.error('POST sample images error:', error);
      res.status(500).json({ error: error?.message || 'Failed to upload photos.' });
    }
  }
);

app.patch('/api/images/:imageId', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    await updateSampleImageCaption(String(req.params.imageId), String(req.body?.caption || ''));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('PATCH image caption error:', error);
    res.status(500).json({ error: error?.message || 'Failed to update photo caption.' });
  }
});

app.delete('/api/images/:imageId', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    await removeSampleImage(String(req.params.imageId));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE sample image error:', error);
    res.status(500).json({ error: error?.message || 'Failed to delete photo.' });
  }
});

// Batch import (JSON backup or localStorage migration)
app.post('/api/workspace/import', requireAuth, requireEditor, async (req: AuthRequest, res) => {
  try {
    const items = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!items.length) {
      return res.status(400).json({ error: 'No product data provided to import.' });
    }
    await importWorkspaceProducts(items, req.user?.uid || '');
    res.json({ ok: true, count: items.length });
  } catch (error: any) {
    console.error('POST import error:', error);
    res.status(500).json({ error: error?.message || 'Failed to import data into Cloud SQL.' });
  }
});

// Workspace member access control (Admin only)
app.get('/api/members', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const result = await listWorkspaceMembers();
    res.json(result);
  } catch (error: any) {
    console.error('GET /api/members error:', error);
    res.status(500).json({ error: error?.message || 'Failed to load workspace members.' });
  }
});

app.post('/api/members', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'editor') as UserRole;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    await setMemberAccess(email, role, req.dbUser?.email || '');
    res.json({ ok: true });
  } catch (error: any) {
    console.error('POST /api/members error:', error);
    res.status(500).json({ error: error?.message || 'Failed to update member permissions.' });
  }
});

app.delete('/api/members/:email', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    await removeInvite(String(req.params.email));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE /api/members error:', error);
    res.status(500).json({ error: error?.message || 'Failed to remove invite.' });
  }
});

// Serve Frontend (Vite middleware in dev, static dist in production)
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
