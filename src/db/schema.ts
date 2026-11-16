import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  role: text('role').notNull().default('viewer'), // 'admin' | 'editor' | 'viewer'
  createdAt: timestamp('created_at').defaultNow(),
});

export const workspaceInvites = pgTable('workspace_invites', {
  email: text('email').primaryKey(),
  role: text('role').notNull().default('editor'), // 'admin' | 'editor' | 'viewer'
  addedBy: text('added_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow(),
});

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  launch: text('launch').notNull().default(''),
  cycleStartYear: integer('cycle_start_year').notNull().default(2026),
  createdByUid: text('created_by_uid').notNull().default(''),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .references(() => products.id, { onDelete: 'cascade' })
    .notNull(),
  stage: integer('stage').notNull().default(0),
  name: text('name').notNull(),
  pic: text('pic').notNull().default(''),
  status: text('status').notNull().default('not'),
  start: text('start').notNull().default(''),
  end: text('end').notNull().default(''),
  note: text('note').notNull().default(''),
  isMilestone: boolean('is_milestone').notNull().default(false),
  priority: text('priority').notNull().default('normal'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const rdSamples = pgTable('rd_samples', {
  id: text('id').primaryKey(),
  productId: text('product_id')
    .references(() => products.id, { onDelete: 'cascade' })
    .notNull(),
  rdCode: text('rd_code').notNull(),
  version: text('version').notNull().default(''),
  pic: text('pic').notNull().default(''),
  testDate: text('test_date').notNull().default(''),
  testResult: text('test_result').notNull().default('pending'),
  isApproved: boolean('is_approved').notNull().default(false),
  note: text('note').notNull().default(''),
  cvsPrice: integer('cvs_price').notNull().default(0),
  packagingCost: integer('packaging_cost').notNull().default(0),
  sellPrice: integer('sell_price').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(''),
});

export const samplePriceLogs = pgTable('sample_price_logs', {
  id: text('id').primaryKey(),
  sampleId: text('sample_id')
    .references(() => rdSamples.id, { onDelete: 'cascade' })
    .notNull(),
  date: text('date').notNull().default(''),
  cvsPrice: integer('cvs_price').notNull().default(0),
  packagingCost: integer('packaging_cost').notNull().default(0),
  sellPrice: integer('sell_price').notNull().default(0),
  reason: text('reason').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
});

export const sampleImages = pgTable('sample_images', {
  id: text('id').primaryKey(),
  sampleId: text('sample_id')
    .references(() => rdSamples.id, { onDelete: 'cascade' })
    .notNull(),
  caption: text('caption').notNull().default(''),
  mimeType: text('mime_type').notNull().default('image/webp'),
  dataUrl: text('data_url').notNull(),
  uploadedBy: text('uploaded_by').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow(),
});

export const productsRelations = relations(products, ({ many }) => ({
  tasks: many(tasks),
  samples: many(rdSamples),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  product: one(products, {
    fields: [tasks.productId],
    references: [products.id],
  }),
}));

export const rdSamplesRelations = relations(rdSamples, ({ one, many }) => ({
  product: one(products, {
    fields: [rdSamples.productId],
    references: [products.id],
  }),
  priceHistory: many(samplePriceLogs),
  images: many(sampleImages),
}));

export const samplePriceLogsRelations = relations(samplePriceLogs, ({ one }) => ({
  sample: one(rdSamples, {
    fields: [samplePriceLogs.sampleId],
    references: [rdSamples.id],
  }),
}));

export const sampleImagesRelations = relations(sampleImages, ({ one }) => ({
  sample: one(rdSamples, {
    fields: [sampleImages.sampleId],
    references: [rdSamples.id],
  }),
}));
