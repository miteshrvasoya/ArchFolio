/**
 * Zod schemas for every dashboard entity. Types are inferred from these, so
 * the schemas are the single source of truth for the data model.
 *
 * Conventions
 * - ids: nanoid strings
 * - calendar dates (deadlines, due dates): "YYYY-MM-DD"
 * - timestamps: ISO 8601 date-time strings
 * - money: integer rupees (INR). Never floats. See docs/dashboard.md.
 * - derived values (outstanding, overdue, payment status) are computed in
 *   lib/logic, never stored.
 */
import { z } from 'zod';

export const Id = z.string().min(1).max(64);
export const IsoDate = z.iso.date();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Rupees = z.number().int().min(0).max(1_000_000_000_000);
const Text = (max = 2000) => z.string().max(max);
const Tags = z.array(z.string().min(1).max(40)).max(30);

/* ---------- Client ---------- */
export const ClientStatus = z.enum(['lead', 'active', 'past', 'dormant']);
export const ClientSource = z.enum(['referral', 'instagram', 'friend', 'website', 'walk-in', 'repeat', 'other']);
export const ClientSchema = z.object({
  id: Id,
  name: z.string().min(1, 'Name is required').max(120),
  phone: Text(30),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  address: Text(300),
  city: Text(80),
  source: ClientSource,
  notes: Text(4000),
  tags: Tags,
  createdAt: IsoDateTime,
  status: ClientStatus
});
export type Client = z.infer<typeof ClientSchema>;

/* ---------- Project ---------- */
export const ProjectType = z.enum(['residential', 'commercial', 'interior', 'renovation', 'other']);
export const ProjectStatus = z.enum(['inquiry', 'agreement-pending', 'in-progress', 'on-hold', 'delivered', 'closed', 'cancelled']);
export const DateChange = z.object({
  changedAt: IsoDateTime,
  from: IsoDate.nullable(),
  to: IsoDate,
  reason: Text(1000),
  discussionId: Id.optional()
});
export type DateChange = z.infer<typeof DateChange>;
export const ProjectSchema = z.object({
  id: Id,
  clientId: Id,
  title: z.string().min(1, 'Title is required').max(160),
  type: ProjectType,
  siteLocation: Text(300),
  plotAreaSqft: z.number().int().min(0).nullable(),
  builtUpAreaSqft: z.number().int().min(0).nullable(),
  budgetMin: Rupees.nullable(),
  budgetMax: Rupees.nullable(),
  status: ProjectStatus,
  startDate: IsoDate.nullable(),
  originalDeadline: IsoDate.nullable(),
  currentDeadline: IsoDate.nullable(),
  deadlineHistory: z.array(DateChange),
  teamMembers: z.array(z.string().min(1).max(80)).max(20),
  tags: Tags,
  createdAt: IsoDateTime
});
export type Project = z.infer<typeof ProjectSchema>;

/* ---------- Phase ---------- */
export const PHASE_NAMES = ['Concept', 'Schematic design', '2D plans', '3D / visuals', 'Working drawings', 'Approvals / submission', 'Site support'] as const;
export const PhaseStatus = z.enum(['not-started', 'in-progress', 'in-review', 'revision', 'approved', 'delivered']);
export const PhaseSchema = z.object({
  id: Id,
  projectId: Id,
  name: z.string().min(1).max(80),
  description: Text(2000),
  deliverables: z.array(z.string().min(1).max(200)).max(40),
  startDate: IsoDate.nullable(),
  dueDate: IsoDate.nullable(),
  originalDueDate: IsoDate.nullable(),
  dueDateHistory: z.array(DateChange),
  status: PhaseStatus,
  revisionsAllowed: z.number().int().min(0).max(50),
  revisionsUsed: z.number().int().min(0).max(100),
  paymentMilestoneId: Id.nullable(),
  order: z.number().int().min(0)
});
export type Phase = z.infer<typeof PhaseSchema>;

/* ---------- Discussion / communication log ---------- */
export const Channel = z.enum(['call', 'whatsapp', 'meeting', 'email', 'site-visit']);
export const ActionItem = z.object({
  id: Id,
  text: z.string().min(1).max(500),
  owner: Text(80),
  due: IsoDate.nullable(),
  done: z.boolean()
});
export type ActionItem = z.infer<typeof ActionItem>;
export const Attachment = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(['call-recording', 'whatsapp-export', 'photo', 'drawing', 'document', 'link', 'other']),
  link: Text(1000),
  note: Text(500)
});
export const DiscussionSchema = z.object({
  id: Id,
  projectId: Id,
  at: IsoDateTime,
  channel: Channel,
  summary: z.string().min(1, 'Summary is required').max(8000),
  decisions: z.array(z.string().min(1).max(500)).max(50),
  actionItems: z.array(ActionItem).max(50),
  attachments: z.array(Attachment).max(30),
  scopeChange: z.boolean(),
  impact: z.object({ days: z.number().int().min(-365).max(3650), costInr: Rupees, notes: Text(1000) }).nullable(),
  tags: Tags
});
export type Discussion = z.infer<typeof DiscussionSchema>;

/* ---------- Requirements & references ---------- */
export const RequirementCategory = z.enum(['brief', 'space', 'style', 'budget', 'site', 'reference', 'other']);
export const RequirementSchema = z.object({
  id: Id,
  projectId: Id,
  text: z.string().min(1).max(4000),
  category: RequirementCategory,
  references: z.array(z.object({ label: z.string().min(1).max(160), url: Text(1000) })).max(30),
  receivedOn: IsoDate,
  version: z.number().int().min(1)
});
export type Requirement = z.infer<typeof RequirementSchema>;

/* ---------- Task ---------- */
export const TaskStatus = z.enum(['todo', 'doing', 'blocked', 'done']);
export const TaskPriority = z.enum(['low', 'medium', 'high']);
export const TaskSchema = z.object({
  id: Id,
  projectId: Id,
  phaseId: Id.nullable(),
  title: z.string().min(1, 'Title is required').max(300),
  assignee: Text(80),
  due: IsoDate.nullable(),
  status: TaskStatus,
  priority: TaskPriority
});
export type Task = z.infer<typeof TaskSchema>;

/* ---------- Agreement ---------- */
export const Milestone = z.object({
  id: Id,
  label: z.string().min(1).max(160),
  percent: z.number().int().min(0).max(100),
  trigger: Text(300)
});
export type Milestone = z.infer<typeof Milestone>;
export const PartyFirm = z.object({
  firmName: Text(160), architectName: Text(120), coaNumber: Text(60), address: Text(400), phone: Text(30), email: Text(160), gstin: Text(20)
});
export const PartyClient = z.object({ name: Text(160), address: Text(400), phone: Text(30), email: Text(160) });
export const AgreementContentSchema = z.object({
  parties: z.object({ architect: PartyFirm, client: PartyClient }),
  project: z.object({ title: Text(200), site: Text(300), type: Text(80), area: Text(120), brief: Text(4000) }),
  scope: z.object({ included: z.array(z.string().min(1).max(500)).max(60), exclusions: z.array(z.string().min(1).max(500)).max(60) }),
  phases: z.array(z.object({
    name: z.string().min(1).max(120),
    deliverables: z.array(z.string().min(1).max(300)).max(30),
    start: IsoDate.nullable(),
    end: IsoDate.nullable(),
    revisions: z.number().int().min(0).max(50)
  })).max(20),
  timeline: z.object({ overallDeadline: IsoDate.nullable(), dependencyClause: Text(3000), changeClause: Text(3000) }),
  fees: z.object({
    totalFee: Rupees,
    gstEnabled: z.boolean(),
    gstRatePercent: z.number().int().min(0).max(28),
    milestones: z.array(Milestone).max(20),
    paymentModes: z.array(z.string().min(1).max(60)).max(10),
    latePaymentTerms: Text(2000)
  }),
  revisions: z.object({ extraRevisionRate: Rupees, clause: Text(3000) }),
  communication: z.object({ officialChannels: z.array(z.string().min(1).max(60)).max(6), responseTime: Text(500), approvalDefinition: Text(1500) }),
  ownership: z.object({ clause: Text(3000), portfolioPermission: z.boolean() }),
  fileRelease: z.object({ clause: Text(3000) }),
  termination: z.object({ clause: Text(3000) }),
  legal: z.object({ confidentiality: Text(2000), disputeResolution: Text(2000), governingLaw: Text(300) })
});
export type AgreementContent = z.infer<typeof AgreementContentSchema>;

export const AgreementVersionStatus = z.enum(['draft', 'sent', 'viewed', 'accepted', 'superseded', 'cancelled']);
export const AgreementVersionSchema = z.object({
  id: Id,
  version: z.number().int().min(1),
  /** unguessable share token (nanoid, 24 chars) */
  token: z.string().min(22).max(64),
  status: AgreementVersionStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  sentAt: IsoDateTime.nullable(),
  viewedAt: IsoDateTime.nullable(),
  acceptedAt: IsoDateTime.nullable(),
  acceptedByName: Text(160).nullable(),
  /** SHA-256 of the canonical content the client accepted (from their receipt) */
  acceptanceHash: z.string().max(128).nullable(),
  changeNote: Text(1000),
  content: AgreementContentSchema
});
export type AgreementVersion = z.infer<typeof AgreementVersionSchema>;
export const AgreementSchema = z.object({
  id: Id,
  projectId: Id,
  title: z.string().min(1).max(200),
  templateId: Id.nullable(),
  createdAt: IsoDateTime,
  versions: z.array(AgreementVersionSchema).min(1)
});
export type Agreement = z.infer<typeof AgreementSchema>;

export const AgreementTemplateSchema = z.object({
  id: Id,
  name: z.string().min(1).max(120),
  description: Text(500),
  content: AgreementContentSchema
});
export type AgreementTemplate = z.infer<typeof AgreementTemplateSchema>;

/* ---------- Payment ---------- */
export const PaymentType = z.enum(['advance', 'milestone', 'final', 'extra-work']);
export const PaymentMode = z.enum(['upi', 'bank', 'cash', 'cheque']);
export const ReceiptSchema = z.object({
  id: Id,
  date: IsoDate,
  amount: Rupees.refine((v) => v > 0, 'Amount must be more than zero'),
  mode: PaymentMode,
  reference: Text(120),
  notes: Text(500)
});
export type Receipt = z.infer<typeof ReceiptSchema>;
export const PaymentSchema = z.object({
  id: Id,
  projectId: Id,
  agreementId: Id.nullable(),
  milestoneId: Id.nullable(),
  label: z.string().min(1).max(160),
  type: PaymentType,
  amount: Rupees,
  dueDate: IsoDate.nullable(),
  /** set when an invoice / payment request was sent; all other states are derived */
  invoicedAt: IsoDate.nullable(),
  receipts: z.array(ReceiptSchema).max(100),
  notes: Text(1000)
});
export type Payment = z.infer<typeof PaymentSchema>;
/** Derived, never stored. */
export const PaymentStatus = z.enum(['pending', 'invoiced', 'partially-paid', 'paid', 'overdue']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/* ---------- Document ---------- */
export const DocumentType = z.enum(['drawing', 'render', 'contract', 'invoice', 'other']);
export const DocumentSchema = z.object({
  id: Id,
  projectId: Id,
  name: z.string().min(1).max(200),
  type: DocumentType,
  version: Text(40),
  link: Text(1000),
  note: Text(1000),
  sharedWithClient: z.boolean(),
  releasedOn: IsoDate.nullable(),
  /** held back until the linked payment is cleared */
  locked: z.boolean(),
  releaseAfterPaymentId: Id.nullable()
});
export type Doc = z.infer<typeof DocumentSchema>;

/* ---------- Activity ---------- */
export const ActivityKind = z.enum([
  'client-created', 'project-created', 'project-status', 'agreement-created', 'agreement-version', 'agreement-sent',
  'agreement-accepted', 'agreement-revoked', 'payment-created', 'payment-received', 'deadline-changed', 'scope-change',
  'document-released', 'data-imported'
]);
export const ActivitySchema = z.object({
  id: Id,
  at: IsoDateTime,
  kind: ActivityKind,
  message: z.string().min(1).max(500),
  projectId: Id.nullable(),
  clientId: Id.nullable()
});
export type Activity = z.infer<typeof ActivitySchema>;

/* ---------- Settings ---------- */
export const SettingsSchema = z.object({
  firm: z.object({
    name: Text(160), architectName: Text(120), address: Text(400), city: Text(80), phone: Text(30), email: Text(160),
    website: Text(200), coaNumber: Text(60), gstin: Text(20), logoUrl: Text(1000)
  }),
  bank: z.object({ accountName: Text(160), bankName: Text(120), accountNumber: Text(40), ifsc: Text(20), upiId: Text(80) }),
  defaults: z.object({
    paymentModes: z.array(z.string().min(1).max(60)).max(10),
    latePaymentTerms: Text(2000),
    dependencyClause: Text(3000),
    changeClause: Text(3000),
    ownershipClause: Text(3000),
    fileReleaseClause: Text(3000),
    terminationClause: Text(3000),
    confidentiality: Text(2000),
    disputeResolution: Text(2000),
    governingLaw: Text(300)
  })
});
export type Settings = z.infer<typeof SettingsSchema>;

/* ---------- Whole database (what storage holds and what export/import carry) ---------- */
export const SCHEMA_VERSION = 1;
export const DatabaseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  clients: z.array(ClientSchema),
  projects: z.array(ProjectSchema),
  phases: z.array(PhaseSchema),
  discussions: z.array(DiscussionSchema),
  requirements: z.array(RequirementSchema),
  tasks: z.array(TaskSchema),
  agreements: z.array(AgreementSchema),
  templates: z.array(AgreementTemplateSchema),
  payments: z.array(PaymentSchema),
  documents: z.array(DocumentSchema),
  activity: z.array(ActivitySchema),
  settings: SettingsSchema
});
export type Database = z.infer<typeof DatabaseSchema>;
