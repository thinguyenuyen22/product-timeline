import { asc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  products,
  rdSamples,
  sampleImages,
  samplePriceLogs,
  tasks,
  users,
  workspaceInvites,
} from './schema.ts';
import type { UserRole } from './users.ts';

export interface SampleImageDto {
  id: string;
  caption: string;
  mimeType: string;
  dataUrl: string;
  uploadedBy: string;
}

export interface PriceLogDto {
  id: string;
  date: string;
  cvsPrice: number;
  packagingCost: number;
  sellPrice: number;
  reason: string;
  updatedBy?: string;
}

export interface SampleDto {
  id: string;
  rdCode: string;
  version: string;
  pic: string;
  testDate: string;
  testResult: string;
  isApproved: boolean;
  note: string;
  cvsPrice: number;
  packagingCost: number;
  sellPrice: number;
  updatedAt: string;
  priceHistory: PriceLogDto[];
  images: SampleImageDto[];
}

export interface TaskDto {
  id: string;
  stage: number;
  name: string;
  pic: string;
  status: string;
  start: string;
  end: string;
  note: string;
  isMilestone: boolean;
  priority: string;
  sortOrder?: number;
}

export interface ProductDto {
  id: string;
  name: string;
  category: string;
  launch: string;
  cycleStartYear: number;
  tasks: TaskDto[];
  samples: SampleDto[];
}

export async function getAllWorkspaceData(): Promise<ProductDto[]> {
  try {
    const [prodRows, taskRows, sampleRows, logRows, imgRows] = await Promise.all([
      db.select().from(products).orderBy(asc(products.launch), asc(products.name)),
      db.select().from(tasks).orderBy(asc(tasks.stage), asc(tasks.sortOrder), asc(tasks.name)),
      db.select().from(rdSamples),
      db.select().from(samplePriceLogs).orderBy(asc(samplePriceLogs.date)),
      db.select().from(sampleImages).orderBy(asc(sampleImages.createdAt)),
    ]);

    const logsBySample = new Map<string, PriceLogDto[]>();
    for (const l of logRows) {
      const list = logsBySample.get(l.sampleId) || [];
      list.push({
        id: l.id,
        date: l.date,
        cvsPrice: l.cvsPrice,
        packagingCost: l.packagingCost,
        sellPrice: l.sellPrice,
        reason: l.reason,
        updatedBy: l.updatedBy,
      });
      logsBySample.set(l.sampleId, list);
    }

    const imgsBySample = new Map<string, SampleImageDto[]>();
    for (const img of imgRows) {
      const list = imgsBySample.get(img.sampleId) || [];
      list.push({
        id: img.id,
        caption: img.caption,
        mimeType: img.mimeType,
        dataUrl: img.dataUrl,
        uploadedBy: img.uploadedBy,
      });
      imgsBySample.set(img.sampleId, list);
    }

    const samplesByProd = new Map<string, SampleDto[]>();
    for (const s of sampleRows) {
      const list = samplesByProd.get(s.productId) || [];
      list.push({
        id: s.id,
        rdCode: s.rdCode,
        version: s.version,
        pic: s.pic,
        testDate: s.testDate,
        testResult: s.testResult,
        isApproved: s.isApproved,
        note: s.note,
        cvsPrice: s.cvsPrice,
        packagingCost: s.packagingCost,
        sellPrice: s.sellPrice,
        updatedAt: s.updatedAt,
        priceHistory: logsBySample.get(s.id) || [],
        images: imgsBySample.get(s.id) || [],
      });
      samplesByProd.set(s.productId, list);
    }

    const tasksByProd = new Map<string, TaskDto[]>();
    for (const t of taskRows) {
      const list = tasksByProd.get(t.productId) || [];
      list.push({
        id: t.id,
        stage: t.stage,
        name: t.name,
        pic: t.pic,
        status: t.status,
        start: t.start,
        end: t.end,
        note: t.note,
        isMilestone: t.isMilestone,
        priority: t.priority,
        sortOrder: t.sortOrder,
      });
      tasksByProd.set(t.productId, list);
    }

    return prodRows.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      launch: p.launch,
      cycleStartYear: p.cycleStartYear,
      tasks: tasksByProd.get(p.id) || [],
      samples: samplesByProd.get(p.id) || [],
    }));
  } catch (error) {
    console.error('Database query failed in getAllWorkspaceData:', error);
    throw new Error('Failed to load workspace data from database.', { cause: error });
  }
}

export async function createOrUpdateProduct(
  payload: {
    id: string;
    name: string;
    category: string;
    launch: string;
    cycleStartYear: number;
    tasks?: TaskDto[];
  },
  uid: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(products)
        .values({
          id: payload.id,
          name: payload.name,
          category: payload.category,
          launch: payload.launch,
          cycleStartYear: payload.cycleStartYear,
          createdByUid: uid,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: products.id,
          set: {
            name: payload.name,
            category: payload.category,
            launch: payload.launch,
            cycleStartYear: payload.cycleStartYear,
            updatedAt: new Date(),
          },
        });

      if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
        for (let i = 0; i < payload.tasks.length; i++) {
          const t = payload.tasks[i];
          await tx
            .insert(tasks)
            .values({
              id: t.id,
              productId: payload.id,
              stage: t.stage,
              name: t.name,
              pic: t.pic || '',
              status: t.status || 'not',
              start: t.start || '',
              end: t.end || '',
              note: t.note || '',
              isMilestone: Boolean(t.isMilestone),
              priority: t.priority === 'high' ? 'high' : 'normal',
              sortOrder: t.sortOrder ?? i,
            })
            .onConflictDoNothing();
        }
      }
    });
  } catch (error) {
    console.error('Database error in createOrUpdateProduct:', error);
    throw new Error('Failed to save product.', { cause: error });
  }
}

export async function removeProduct(productId: string): Promise<void> {
  try {
    await db.delete(products).where(eq(products.id, productId));
  } catch (error) {
    console.error('Database error in removeProduct:', error);
    throw new Error('Failed to delete product.', { cause: error });
  }
}

export async function upsertTask(productId: string, task: TaskDto): Promise<void> {
  try {
    await db
      .insert(tasks)
      .values({
        id: task.id,
        productId,
        stage: task.stage,
        name: task.name,
        pic: task.pic || '',
        status: task.status || 'not',
        start: task.start || '',
        end: task.end || '',
        note: task.note || '',
        isMilestone: Boolean(task.isMilestone),
        priority: task.priority === 'high' ? 'high' : 'normal',
        sortOrder: task.sortOrder ?? 0,
      })
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          stage: task.stage,
          name: task.name,
          pic: task.pic || '',
          status: task.status || 'not',
          start: task.start || '',
          end: task.end || '',
          note: task.note || '',
          isMilestone: Boolean(task.isMilestone),
          priority: task.priority === 'high' ? 'high' : 'normal',
        },
      });
  } catch (error) {
    console.error('Database error in upsertTask:', error);
    throw new Error('Failed to save task.', { cause: error });
  }
}

export async function removeTask(taskId: string): Promise<void> {
  try {
    await db.delete(tasks).where(eq(tasks.id, taskId));
  } catch (error) {
    console.error('Database error in removeTask:', error);
    throw new Error('Failed to delete task.', { cause: error });
  }
}

export async function upsertSample(
  productId: string,
  sample: SampleDto,
  userEmail: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (sample.isApproved) {
        await tx
          .update(rdSamples)
          .set({ isApproved: false })
          .where(eq(rdSamples.productId, productId));
      }

      const existing = await tx
        .select({ id: rdSamples.id })
        .from(rdSamples)
        .where(eq(rdSamples.id, sample.id))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(rdSamples)
          .set({
            rdCode: sample.rdCode,
            version: sample.version || '',
            pic: sample.pic || '',
            testDate: sample.testDate || '',
            testResult: sample.testResult || 'pending',
            isApproved: Boolean(sample.isApproved),
            note: sample.note || '',
          })
          .where(eq(rdSamples.id, sample.id));
      } else {
        await tx.insert(rdSamples).values({
          id: sample.id,
          productId,
          rdCode: sample.rdCode,
          version: sample.version || '',
          pic: sample.pic || '',
          testDate: sample.testDate || '',
          testResult: sample.testResult || 'pending',
          isApproved: Boolean(sample.isApproved),
          note: sample.note || '',
          cvsPrice: Math.round(sample.cvsPrice || 0),
          packagingCost: Math.round(sample.packagingCost || 0),
          sellPrice: Math.round(sample.sellPrice || 0),
          updatedAt: sample.updatedAt || '',
        });

        for (const log of sample.priceHistory || []) {
          await tx
            .insert(samplePriceLogs)
            .values({
              id: log.id,
              sampleId: sample.id,
              date: log.date || '',
              cvsPrice: Math.round(log.cvsPrice || 0),
              packagingCost: Math.round(log.packagingCost || 0),
              sellPrice: Math.round(log.sellPrice || 0),
              reason: log.reason || '',
              updatedBy: log.updatedBy || userEmail,
            })
            .onConflictDoNothing();
        }
      }
    });
  } catch (error) {
    console.error('Database error in upsertSample:', error);
    throw new Error('Failed to save R&D sample.', { cause: error });
  }
}

export async function toggleApproveSample(
  productId: string,
  sampleId: string,
  approve: boolean
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (approve) {
        await tx
          .update(rdSamples)
          .set({ isApproved: false })
          .where(eq(rdSamples.productId, productId));
        const current = await tx
          .select({ testResult: rdSamples.testResult })
          .from(rdSamples)
          .where(eq(rdSamples.id, sampleId))
          .limit(1);
        const nextResult = current[0]?.testResult === 'pending' ? 'go' : current[0]?.testResult || 'go';
        await tx
          .update(rdSamples)
          .set({ isApproved: true, testResult: nextResult })
          .where(eq(rdSamples.id, sampleId));
      } else {
        await tx
          .update(rdSamples)
          .set({ isApproved: false })
          .where(eq(rdSamples.id, sampleId));
      }
    });
  } catch (error) {
    console.error('Database error in toggleApproveSample:', error);
    throw new Error('Failed to update sample approval status.', { cause: error });
  }
}

export async function removeSample(sampleId: string): Promise<void> {
  try {
    await db.delete(rdSamples).where(eq(rdSamples.id, sampleId));
  } catch (error) {
    console.error('Database error in removeSample:', error);
    throw new Error('Failed to delete R&D sample.', { cause: error });
  }
}

export async function recordSamplePriceUpdate(
  sampleId: string,
  log: PriceLogDto,
  userEmail: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(rdSamples)
        .set({
          cvsPrice: Math.round(log.cvsPrice || 0),
          packagingCost: Math.round(log.packagingCost || 0),
          sellPrice: Math.round(log.sellPrice || 0),
          updatedAt: log.date,
        })
        .where(eq(rdSamples.id, sampleId));

      await tx.insert(samplePriceLogs).values({
        id: log.id,
        sampleId,
        date: log.date,
        cvsPrice: Math.round(log.cvsPrice || 0),
        packagingCost: Math.round(log.packagingCost || 0),
        sellPrice: Math.round(log.sellPrice || 0),
        reason: log.reason,
        updatedBy: userEmail,
      });
    });
  } catch (error) {
    console.error('Database error in recordSamplePriceUpdate:', error);
    throw new Error('Failed to update sample price history.', { cause: error });
  }
}

export async function addSampleImages(
  sampleId: string,
  imgs: Array<{ id: string; caption: string; mimeType: string; dataUrl: string }>,
  uploadedBy: string
): Promise<void> {
  try {
    if (!imgs.length) return;
    await db.insert(sampleImages).values(
      imgs.map((img) => ({
        id: img.id,
        sampleId,
        caption: img.caption || '',
        mimeType: img.mimeType || 'image/webp',
        dataUrl: img.dataUrl,
        uploadedBy,
      }))
    );
  } catch (error) {
    console.error('Database error in addSampleImages:', error);
    throw new Error('Failed to save R&D sample photos.', { cause: error });
  }
}

export async function updateSampleImageCaption(imageId: string, caption: string): Promise<void> {
  try {
    await db.update(sampleImages).set({ caption }).where(eq(sampleImages.id, imageId));
  } catch (error) {
    console.error('Database error in updateSampleImageCaption:', error);
    throw new Error('Failed to update photo caption.', { cause: error });
  }
}

export async function removeSampleImage(imageId: string): Promise<void> {
  try {
    await db.delete(sampleImages).where(eq(sampleImages.id, imageId));
  } catch (error) {
    console.error('Database error in removeSampleImage:', error);
    throw new Error('Failed to delete sample photo.', { cause: error });
  }
}

export async function importWorkspaceProducts(items: ProductDto[], uid: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      for (const p of items) {
        await tx
          .insert(products)
          .values({
            id: p.id,
            name: p.name,
            category: p.category || '',
            launch: p.launch || '',
            cycleStartYear: p.cycleStartYear || 2026,
            createdByUid: uid,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: products.id,
            set: {
              name: p.name,
              category: p.category || '',
              launch: p.launch || '',
              cycleStartYear: p.cycleStartYear || 2026,
              updatedAt: new Date(),
            },
          });

        for (let i = 0; i < (p.tasks || []).length; i++) {
          const t = p.tasks[i];
          await tx
            .insert(tasks)
            .values({
              id: t.id,
              productId: p.id,
              stage: t.stage,
              name: t.name,
              pic: t.pic || '',
              status: t.status || 'not',
              start: t.start || '',
              end: t.end || '',
              note: t.note || '',
              isMilestone: Boolean(t.isMilestone),
              priority: t.priority === 'high' ? 'high' : 'normal',
              sortOrder: i,
            })
            .onConflictDoUpdate({
              target: tasks.id,
              set: {
                stage: t.stage,
                name: t.name,
                pic: t.pic || '',
                status: t.status || 'not',
                start: t.start || '',
                end: t.end || '',
                note: t.note || '',
                isMilestone: Boolean(t.isMilestone),
                priority: t.priority === 'high' ? 'high' : 'normal',
              },
            });
        }

        for (const s of p.samples || []) {
          await tx
            .insert(rdSamples)
            .values({
              id: s.id,
              productId: p.id,
              rdCode: s.rdCode,
              version: s.version || '',
              pic: s.pic || '',
              testDate: s.testDate || '',
              testResult: s.testResult || 'pending',
              isApproved: Boolean(s.isApproved),
              note: s.note || '',
              cvsPrice: Math.round(s.cvsPrice || 0),
              packagingCost: Math.round(s.packagingCost || 0),
              sellPrice: Math.round(s.sellPrice || 0),
              updatedAt: s.updatedAt || '',
            })
            .onConflictDoUpdate({
              target: rdSamples.id,
              set: {
                rdCode: s.rdCode,
                version: s.version || '',
                pic: s.pic || '',
                testDate: s.testDate || '',
                testResult: s.testResult || 'pending',
                isApproved: Boolean(s.isApproved),
                note: s.note || '',
                cvsPrice: Math.round(s.cvsPrice || 0),
                packagingCost: Math.round(s.packagingCost || 0),
                sellPrice: Math.round(s.sellPrice || 0),
                updatedAt: s.updatedAt || '',
              },
            });

          for (const log of s.priceHistory || []) {
            await tx
              .insert(samplePriceLogs)
              .values({
                id: log.id,
                sampleId: s.id,
                date: log.date || '',
                cvsPrice: Math.round(log.cvsPrice || 0),
                packagingCost: Math.round(log.packagingCost || 0),
                sellPrice: Math.round(log.sellPrice || 0),
                reason: log.reason || '',
                updatedBy: log.updatedBy || '',
              })
              .onConflictDoNothing();
          }

          for (const img of s.images || []) {
            await tx
              .insert(sampleImages)
              .values({
                id: img.id,
                sampleId: s.id,
                caption: img.caption || '',
                mimeType: img.mimeType || 'image/webp',
                dataUrl: img.dataUrl,
                uploadedBy: img.uploadedBy || '',
              })
              .onConflictDoNothing();
          }
        }
      }
    });
  } catch (error) {
    console.error('Database error in importWorkspaceProducts:', error);
    throw new Error('Failed to import data into Cloud SQL.', { cause: error });
  }
}

export async function listWorkspaceMembers() {
  try {
    const [signedUsers, invites] = await Promise.all([
      db.select().from(users).orderBy(asc(users.email)),
      db.select().from(workspaceInvites).orderBy(asc(workspaceInvites.email)),
    ]);
    return { users: signedUsers, invites };
  } catch (error) {
    console.error('Database error in listWorkspaceMembers:', error);
    throw new Error('Failed to load workspace members.', { cause: error });
  }
}

export async function setMemberAccess(
  email: string,
  role: UserRole,
  addedBy: string
): Promise<void> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    await db
      .insert(workspaceInvites)
      .values({ email: cleanEmail, role, addedBy })
      .onConflictDoUpdate({
        target: workspaceInvites.email,
        set: { role, addedBy },
      });
    await db.update(users).set({ role }).where(eq(users.email, cleanEmail));
  } catch (error) {
    console.error('Database error in setMemberAccess:', error);
    throw new Error('Failed to update member permissions.', { cause: error });
  }
}

export async function removeInvite(email: string): Promise<void> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    await db.delete(workspaceInvites).where(eq(workspaceInvites.email, cleanEmail));
  } catch (error) {
    console.error('Database error in removeInvite:', error);
    throw new Error('Failed to remove invite.', { cause: error });
  }
}
